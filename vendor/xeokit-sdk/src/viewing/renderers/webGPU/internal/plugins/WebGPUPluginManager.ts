import {boundsViewDepth} from "../../../../rendering/plugins/internal/transparentOrder";
import {SDKErrorType} from "../../../../../base/core";
import {PerspectiveProjectionType, OrthoProjectionType} from "../../../../../base/constants";
import {decompressPositions3WithAABB3} from "../../../../../base/math/compression";
import {inverseMat4, mulMat4, transformVec4} from "../../../../../base/math/matrix";
import type {SceneMesh} from "../../../../../model/scene/SceneMesh";
import type {View} from "../../../../viewer/View";
import {PickResult} from "../../../../viewer/PickResult";
import type {PickParams} from "../../../../viewer/PickParams";
import type {RendererPluginRegistry} from "../../../../rendering/plugins/RendererPluginRegistry";
import type {RendererPluginInstanceStatus} from "../../../../rendering/plugins/RendererPluginInstanceStatus";
import type {WebGPURendererPluginAdapter} from "../../plugins/WebGPURendererPluginAdapter";
import type {WebGPURepresentationRuntime} from "../../plugins/WebGPURepresentationRuntime";
import type {WebGPURepresentationSnapshot} from "../../plugins/WebGPURepresentationSnapshot";
import type {Viewer} from "../../../../viewer/Viewer";
import type {MeshManager} from "../meshManager/MeshManager";
import type {WebGPUDeviceLike, WebGPUCommandEncoderLike} from "../../core/types";
import {WEBGPU_CLIP_SPACE_MATRIX} from "../constants";
import {GPUPluginResources} from "./GPUPluginResources";
import {GPUSceneResourceCache} from "./GPUSceneResourceCache";
import {GPUPluginCompositor} from "./GPUPluginCompositor";
import type {WebGPUPluginPipeline, WebGPUPluginBuffer} from "../../plugins";

type RuntimeEntry = {
  adapter: WebGPURendererPluginAdapter;
  runtime: WebGPURepresentationRuntime;
  host: GPUPluginResources;
};
type Prepared = {
  mesh: SceneMesh;
  snapshot: WebGPURepresentationSnapshot;
  status: RendererPluginInstanceStatus;
  entry?: RuntimeEntry;
};

/** Indexed scene routing and device-local compose-opaque execution. No domain-specific behavior lives here. */
export class WebGPUPluginManager {
  private readonly meshes = new Set<SceneMesh>();

  private readonly runtimes = new Map<string, RuntimeEntry>();

  private readonly pending = new Map<
    string,
    {adapter: WebGPURendererPluginAdapter; host: GPUPluginResources}
  >();

  private readonly initFailed = new Set<string>();

  private readonly failed = new Map<string, number>();

  private readonly frames = new Map<string, Prepared[]>();

  private readonly poses = new Map<
    SceneMesh,
    {version: number; colors?: Uint8Array; slots: {index: number; data: Float32Array}[]}
  >();

  private readonly unsubscribe: (() => void)[] = [];

  private readonly cache: GPUSceneResourceCache;

  private compositor?: GPUPluginCompositor;

  private readonly boundsHost: GPUPluginResources;

  private boundsPipeline?: WebGPUPluginPipeline;

  private boundsStarting = false;

  private readonly boundsBuffers = new Map<
    string,
    {vertices: WebGPUPluginBuffer; matrix: WebGPUPluginBuffer}
  >();

  private alive = true;

  constructor(
    private readonly viewer: Viewer,
    private readonly device: WebGPUDeviceLike,
    private readonly meshManager: MeshManager,
    private readonly registry: RendererPluginRegistry,
    private readonly linearDepth = true
  ) {
    this.cache = new GPUSceneResourceCache(device);
    this.boundsHost = new GPUPluginResources(device, this.cache, () => this.redraw());
    const scene = viewer.scene;
    const track = (mesh: SceneMesh) => {
      const bound = mesh.representationId !== undefined && !mesh.model.headless;
      if (!bound && !this.meshes.has(mesh)) return;
      if (bound) this.meshes.add(mesh);
      else this.meshes.delete(mesh);
      this.frames.clear();
      if (!mesh.model.building && !mesh.model.activeBatch) this.redraw();
    };
    for (const model of Object.values(scene.models))
      for (const mesh of Object.values(model.meshes)) track(mesh);
    this.unsubscribe.push(
      scene.events.onSceneMeshCreated.subscribe((_, mesh) => track(mesh)),
      scene.events.onSceneMeshRepresentationChanged.subscribe((_, mesh) => {
        this.releaseInstance(mesh);
        track(mesh);
        if (mesh.representationId === undefined) this.meshManager.restoreOrdinaryMesh(mesh);
      }),
      scene.events.onSceneMeshDestroyed.subscribe((_, mesh) => {
        if (!this.meshes.has(mesh)) return;
        this.releaseInstance(mesh);
        this.meshes.delete(mesh);
        this.poses.delete(mesh);
        this.registry._forget(this.identity(mesh));
        this.frames.clear();
      }),
      scene.events.onSceneRepresentationChanged.subscribe(() => {
        this.frames.clear();
        this.redraw();
      }),
      scene.events.onSceneDataResourceChanged.subscribe(() => {
        this.failed.clear();
        this.cache.prune();
        this.frames.clear();
        this.redraw();
      }),
      viewer.events.onViewDestroyed.subscribe((_, view) => {
        this.frames.delete(view.id);
        this.compositor?.releaseView(view.id);
        for (const entry of this.runtimes.values()) this.safely(() => entry.runtime.releaseView?.(view.id));
        for (const [key, buffers] of this.boundsBuffers)
          if (JSON.parse(key)[1] === view.id) {
            buffers.vertices.release();
            buffers.matrix.release();
            this.boundsBuffers.delete(key);
          }
      }),
      registry._subscribe(() => {
        this.initFailed.clear();
        this.failed.clear();
        this.syncRegistrations();
        this.redraw();
      })
    );
    this.syncRegistrations();
  }

  private identity(mesh: SceneMesh) {
    return {sceneId: mesh.model.scene.id, modelId: mesh.model.id, meshId: mesh.id};
  }

  private safely(work: () => void): void {
    try {
      work();
    } catch (error) {
      console.warn("Renderer plugin cleanup failed", error);
    }
  }

  private releaseInstance(mesh: SceneMesh): void {
    for (const entry of this.runtimes.values())
      this.safely(() => entry.runtime.releaseInstance?.(this.identity(mesh)));
    for (const [key, buffers] of this.boundsBuffers)
      if (JSON.parse(key)[0] === mesh.uniqueId) {
        buffers.vertices.release();
        buffers.matrix.release();
        this.boundsBuffers.delete(key);
      }
    for (const key of this.failed.keys()) if (JSON.parse(key)[0] === mesh.uniqueId) this.failed.delete(key);
  }

  private redraw(): void {
    if (this.alive) for (const view of this.viewer.viewList) view.needsRender();
  }

  private syncRegistrations(): void {
    for (const [type, entry] of this.runtimes)
      if (!this.registry._definitions().get(type)?.adapters.includes(entry.adapter)) {
        this.safely(() => entry.runtime.dispose());
        entry.host.destroy();
        this.runtimes.delete(type);
      }
    for (const [type, entry] of this.pending)
      if (!this.registry._definitions().get(type)?.adapters.includes(entry.adapter)) {
        entry.host.destroy();
        this.pending.delete(type);
      }
    for (const [type, definition] of this.registry._definitions()) {
      if (this.runtimes.has(type) || this.pending.has(type) || this.initFailed.has(type)) continue;
      const adapter = definition.adapters.find((a) => a.backend === "webgpu" && a.hostApiVersion === 1) as
        | WebGPURendererPluginAdapter
        | undefined;
      if (!adapter) continue;
      const host = new GPUPluginResources(this.device, this.cache, () => this.redraw());
      const pending = {adapter, host};
      this.pending.set(type, pending);
      // Promise identity prevents late completion of an unregistered or detached
      // factory from reviving stale device resources or changing a new registration.
      Promise.resolve()
        .then(() => adapter.create(host))
        .then((runtime) => {
          if (!this.alive || this.pending.get(type) !== pending) {
            this.safely(() => runtime.dispose());
            host.destroy();
            return;
          }
          if (!["compose-opaque", "transparent"].includes(runtime.stage) ||
              (runtime.stage === "transparent" && runtime.depth !== "test-only") ||
              !["none", "test-only", "actual-surface", "proxy"].includes(runtime.depth)) {
            this.safely(() => runtime.dispose());
            throw new Error("Plugin must declare depth semantics");
          }
          this.pending.delete(type);
          this.runtimes.set(type, {adapter, host, runtime});
          this.registry._ready(type, {ok: true, value: undefined});
          this.redraw();
        })
        .catch((error) => {
          host.destroy();
          if (!this.alive || this.pending.get(type) !== pending) return;
          this.pending.delete(type);
          this.initFailed.add(type);
          this.registry._ready(type, {
            ok: false,
            type: SDKErrorType.InitializationFailed,
            error: String(error),
          });
          this.redraw();
        });
    }
  }
  private snapshot(mesh: SceneMesh, view: View): WebGPURepresentationSnapshot {
    const representation = mesh.model.representations[mesh.representationId!];
    const geometry = mesh.geometry;
    let pose = this.poses.get(mesh);

    if (!pose || pose.version !== geometry.version) {
      pose = {
        version: geometry.version,
        colors: geometry.colorsCompressed ? new Uint8Array(geometry.colorsCompressed) : undefined,
        slots: [0, 1].map(() => ({index: -2, data: new Float32Array(geometry.positionsCompressed.length)})),
      };
      this.poses.set(mesh, pose);
    }

    let {stateAIndex: a, stateBIndex: b, factor} = mesh.vertexState;
    const states = geometry.vertexStatesCompressed;
    const frames = geometry.framesCompressed;

    if (frames?.length) {
      const time = frames[0].time + mesh.frameTime;
      a = 0;
      while (a + 1 < frames.length && frames[a + 1].time <= time) a++;
      b = Math.min(a + 1, frames.length - 1);
      factor =
        a === b ? 0 : Math.max(0, Math.min(1, (time - frames[a].time) / (frames[b].time - frames[a].time)));
    }

    let left = pose.slots.find((slot) => slot.index === a);
    let right = pose.slots.find((slot) => slot.index === b);
    const decode = (slot: (typeof pose.slots)[number], index: number) => {
      const source = frames?.[index] ?? states?.[index] ?? geometry;
      decompressPositions3WithAABB3(source.positionsCompressed, source.aabb, slot.data);
      slot.index = index;
    };

    if (!left) {
      left = pose.slots.find((slot) => slot !== right)!;
      decode(left, a);
    }
    if (!right) {
      right = a === b ? left : pose.slots.find((slot) => slot !== left)!;
      if (right !== left) decode(right, b);
    }

    const worldMatrix = new Float64Array(mesh.worldMatrix);
    const viewMatrix = new Float64Array(view.camera.viewMatrix);
    const projectionMatrix = new Float64Array(
      mulMat4(new Float64Array(WEBGPU_CLIP_SPACE_MATRIX), view.camera.projMatrix, new Float64Array(16))
    );
    const modelView = mulMat4(viewMatrix, worldMatrix, new Float64Array(16));
    const inverseMVP = inverseMat4(
      mulMat4(projectionMatrix, modelView, new Float64Array(16)),
      new Float64Array(16)
    );
    const inverseWorld = inverseMat4(worldMatrix, new Float64Array(16));
    const localEye = transformVec4(
      inverseWorld,
      new Float64Array([...view.camera.eye, 1]),
      new Float64Array(4)
    );
    const object = mesh.object ? view.objects[mesh.object.id] : undefined;
    const resources = Object.fromEntries(
      Object.entries(representation?.resources ?? {}).map(([name, id]) => [
        name,
        mesh.model.dataResources[id],
      ])
    );
    const color = new Float32Array(mesh.effectiveColor);
    if (object?.colorize) for (let i = 0; i < 3; i++) color[i] *= object.colorize[i];

    return {
      instance: this.identity(mesh),
      viewId: view.id,
      mode: mesh.representationMode,
      enabled: view.getRepresentationEnabled(mesh),
      styleBinIds: object?.styleBinIds ?? [],
      representation,
      resources,
      geometry: {
        primitive: geometry.primitive,
        positionsA: left.data,
        positionsB: right.data,
        stateA: a,
        stateB: b,
        factor,
        revision: geometry.version,
        colors: pose.colors,
      },
      worldMatrix,
      viewMatrix,
      projectionMatrix,
      inverseModelViewProjection: new Float64Array(inverseMVP),
      localEye: new Float64Array(localEye),
      projection:
        view.camera.projectionType === PerspectiveProjectionType
          ? "perspective"
          : view.camera.projectionType === OrthoProjectionType
          ? "orthographic"
          : "other",
      visible: object ? object.visible && !object.culled : true,
      pickable: object?.pickable ?? true,
      opacity: mesh.effectiveOpacity * (object?.opacity ?? 1),
      color,
      sectionPlanes:
        object?.clippable === false
          ? []
          : view.sectionPlanesList
              .filter((plane) => plane.active)
              .map((plane) => ({position: Array.from(plane.pos), direction: Array.from(plane.dir)})),
    };
  }

  /** Resolve per-view ownership before normal batches are classified or drawn. */
  prepareView(view: View): void {
    if (!this.meshes.size) return;
    const prepared: Prepared[] = [];

    for (const mesh of this.meshes) {
      if (mesh.destroyed || mesh.model.building) continue;
      const snapshot = this.snapshot(mesh, view);
      const rep = snapshot.representation;
      const definition = rep && this.registry._definitions().get(rep.type);
      const entry = rep && this.runtimes.get(rep.type);
      const policy = rep?.fallback ?? "bounds";
      let status: RendererPluginInstanceStatus = {state: "fallback", policy, reason: "plugin-missing"};

      if (!snapshot.enabled) {
        status = {state: "fallback", policy, reason: "disabled"};
      } else if (!rep || Object.values(snapshot.resources).some((resource) => !resource)) {
        status = {state: "fallback", policy, reason: "resource-unavailable"};
      } else if (definition) {
        if (!definition.schema.versions.includes(rep.schemaVersion))
          status = {state: "fallback", policy, reason: "schema-unsupported"};
        else if (!entry)
          status = {
            state: "fallback",
            policy,
            reason: this.pending.has(rep.type)
              ? "initializing"
              : this.initFailed.has(rep.type)
              ? "execution-failed"
              : "backend-unsupported",
          };
        else if (!this.linearDepth || mesh.morphWeights.length > 0)
          status = {
            state: "fallback",
            policy,
            reason: "capability-unsupported",
            detail:
              "This WebGPU adapter requires conventional depth and static or sampled vertex-state geometry",
          };
        else if (this.failed.get(JSON.stringify([mesh.uniqueId, view.id])) === rep.revision)
          status = {state: "failed", policy, reason: "execution-failed"};
        else {
          try {
            const issues = definition.schema.validate({
              representation: rep.toParams(),
              resources: snapshot.resources,
            });
            status = issues.length
              ? {
                  state: "fallback",
                  policy,
                  reason: "schema-invalid",
                  detail: issues.map((issue) => issue.message).join("; "),
                }
              : entry.runtime.validate(snapshot);
          } catch (error) {
            status = {state: "failed", policy, reason: "schema-invalid", detail: String(error)};
          }
        }
      }

      this.meshManager.routeRepresentation(mesh, view, mesh.representationMode === "augment" || (status.state !== "active" && status.policy === "standard"));
      this.registry._status(snapshot.instance, view.id, status);
      prepared.push({mesh, snapshot, status, entry});
    }

    this.frames.set(view.id, prepared);
  }

  hasWork(view: View): boolean {
    return (this.frames.get(view.id) ?? []).some(
      (item) =>
        item.snapshot.visible &&
        item.snapshot.opacity > 0 &&
        (item.status.state === "active" || item.status.policy === "bounds")
    );
  }

  transparentItems(view: View) {
    return (this.frames.get(view.id) ?? []).filter(item =>
      item.snapshot.enabled && item.snapshot.visible && item.snapshot.opacity > 0 &&
      item.status.state === "active" && item.entry?.runtime.stage === "transparent"
    ).map(item => ({
      key: JSON.stringify(item.snapshot.instance),
      depth: boundsViewDepth(item.snapshot.representation.localBounds, item.snapshot.viewMatrix, item.snapshot.worldMatrix),
      item
    }));
  }

  render(
    view: View,
    encoder: WebGPUCommandEncoderLike,
    width: number,
    height: number,
    color: unknown,
    depth: unknown,
    sampledDepth: unknown,
    transparent?: Prepared
  ): void {
    if (!this.hasWork(view)) return;
    this.compositor ??= new GPUPluginCompositor(this.device);
    for (const item of transparent ? [transparent] : (this.frames.get(view.id) ?? []).filter(item => item.status.state !== "active" || item.entry?.runtime.stage === "compose-opaque")) {
      if (!item.snapshot.visible || item.snapshot.opacity <= 0) continue;
      if (item.status.state === "active" && item.entry) {
        const {host, runtime} = item.entry;
        try {
          this.compositor.render(
            host,
            encoder,
            view.id,
            width,
            height,
            color,
            depth,
            sampledDepth,
            runtime.depth,
            (frame) => runtime.render(item.snapshot, frame),
            runtime.stage
          );
          continue;
        } catch (error) {
          item.status = {
            state: "failed",
            policy: item.snapshot.representation.fallback,
            reason: "execution-failed",
            detail: String(error),
          };
          this.failed.set(
            JSON.stringify([item.mesh.uniqueId, view.id]),
            item.snapshot.representation.revision
          );
          this.registry._status(item.snapshot.instance, view.id, item.status);
          this.redraw();
        }
      }
      if (item.status.state !== "active" && item.status.policy === "bounds")
        this.renderBounds(item, encoder, width, height, color, depth, sampledDepth);
    }
  }

  private renderBounds(
    item: Prepared,
    encoder: WebGPUCommandEncoderLike,
    width: number,
    height: number,
    color: unknown,
    depth: unknown,
    sampledDepth: unknown
  ): void {
    if (!this.boundsPipeline) {
      if (!this.boundsStarting) {
        this.boundsStarting = true;
        this.boundsHost
          .createPipeline({
            label: "Representation fallback bounds",
            target: "scene",
            depth: "test-only",
            topology: "line-list",
            bindings: ["uniform"],
            vertexBuffers: [
              {arrayStride: 12, attributes: [{shaderLocation: 0, offset: 0, format: "float32x3"}]},
            ],
            code: `@group(0) @binding(0) var<uniform> mvp: mat4x4f;
            @vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f {return mvp * vec4f(p, 1.0);}
            @fragment fn fs() -> @location(0) vec4f {return vec4f(1.0, 0.65, 0.2, 1.0);}`,
          })
          .then((pipeline) => {
            if (this.alive) {
              this.boundsPipeline = pipeline;
              this.redraw();
            }
          })
          .catch((error) => {
            if (this.alive) console.warn("Could not initialize representation bounds", error);
          });
      }
      return;
    }
    const key = JSON.stringify([item.mesh.uniqueId, item.snapshot.viewId]);
    const bounds = item.snapshot.representation?.localBounds ?? item.mesh.localBounds;
    const corners = Array.from({length: 8}, (_, i) => [
      bounds[i & 1 ? 3 : 0],
      bounds[i & 2 ? 4 : 1],
      bounds[i & 4 ? 5 : 2],
    ]);
    const indices = [0, 1, 0, 2, 0, 4, 1, 3, 1, 5, 2, 3, 2, 6, 3, 7, 4, 5, 4, 6, 5, 7, 6, 7];
    const vertices = new Float32Array(indices.flatMap((i) => corners[i]));
    const matrix = new Float32Array(
      inverseMat4(item.snapshot.inverseModelViewProjection, new Float64Array(16))
    );
    let buffers = this.boundsBuffers.get(key);
    if (!buffers) {
      buffers = {
        vertices: this.boundsHost.createBuffer(vertices, "vertex"),
        matrix: this.boundsHost.createBuffer(matrix, "uniform"),
      };
      this.boundsBuffers.set(key, buffers);
    } else {
      this.boundsHost.writeBuffer(buffers.vertices, vertices);
      this.boundsHost.writeBuffer(buffers.matrix, matrix);
    }
    this.compositor!.render(
      this.boundsHost,
      encoder,
      item.snapshot.viewId,
      width,
      height,
      color,
      depth,
      sampledDepth,
      "test-only",
      (frame) =>
        frame.draw((draw) => {
          draw.setPipeline(this.boundsPipeline!, [buffers!.matrix]);
          draw.setVertexBuffer(0, buffers!.vertices);
          draw.draw(24);
        })
    );
  }
  /** Merge CPU intersections with the ordinary renderer hit using world distance. */
  pick(view: View, params: PickParams, ordinary: PickResult | null): PickResult | null {
    if (!this.meshes.size || !params.canvasPos) return ordinary;
    let result = ordinary;
    const eye = view.camera.eye;
    let nearest = ordinary?.worldPos
      ? Math.hypot(...Array.from(ordinary.worldPos).map((x, i) => x - eye[i]))
      : Infinity;
    const x = (params.canvasPos[0] / view.htmlElement.clientWidth) * 2 - 1;
    const y = 1 - (params.canvasPos[1] / view.htmlElement.clientHeight) * 2;

    for (const item of this.frames.get(view.id) ?? []) {
      const s = this.snapshot(item.mesh, view);
      if (!s.pickable || (!s.visible && !params.pickInvisible)) continue;
      if (item.status.state !== "active" && item.status.policy !== "bounds") continue;
      const near = transformVec4(s.inverseModelViewProjection, [x, y, 0, 1], new Float64Array(4));
      const far = transformVec4(s.inverseModelViewProjection, [x, y, 1, 1], new Float64Array(4));
      const origin = Array.from(near)
        .slice(0, 3)
        .map((n) => n / near[3]);
      const direction = Array.from(far)
        .slice(0, 3)
        .map((n, i) => n / far[3] - origin[i]);
      const norm = Math.hypot(...direction);
      for (let i = 0; i < 3; i++) direction[i] /= norm;
      let hit;
      try {
        hit = item.status.state === "active" ? item.entry?.runtime.pick?.(s, origin, direction) : undefined;
      } catch {
        continue;
      }

      if (item.status.state !== "active") {
        const bounds = item.snapshot.representation?.localBounds ?? item.mesh.localBounds;
        let lo = -Infinity,
          hi = Infinity;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(direction[i]) < 1e-12) {
            if (origin[i] < bounds[i] || origin[i] > bounds[i + 3]) hi = -Infinity;
          } else {
            const a = (bounds[i] - origin[i]) / direction[i],
              b = (bounds[i + 3] - origin[i]) / direction[i];
            lo = Math.max(lo, Math.min(a, b));
            hi = Math.min(hi, Math.max(a, b));
          }
        }
        if (hi >= Math.max(0, lo))
          hit = {
            kind: "plugin-proxy",
            representation: "authored-bounds",
            localPosition: origin.map((n, i) => n + direction[i] * Math.max(0, lo)),
          };
      }

      if (!hit || hit.localPosition.length !== 3 || !hit.localPosition.every(Number.isFinite)) continue;
      const world = transformVec4(
        s.worldMatrix,
        new Float64Array([...hit.localPosition, 1]),
        new Float64Array(4)
      );
      const distance = Math.hypot(world[0] - eye[0], world[1] - eye[1], world[2] - eye[2]);
      if (distance >= nearest) continue;
      nearest = distance;
      result = new PickResult();
      result.view = view;
      result.sceneMesh = item.mesh;
      result.sceneObject = item.mesh.object;
      result.viewObject = item.mesh.object ? view.objects[item.mesh.object.id] : null;
      result.worldPos = [world[0], world[1], world[2]];
      result.canvasPos = params.canvasPos;
      result.classification =
        item.status.state !== "active"
          ? {
              kind: "bounds-fallback",
              pluginType: s.representation?.type ?? "unknown",
              reason: item.status.reason,
            }
          : hit.kind === "plugin-exact"
          ? {kind: "plugin-exact", pluginType: s.representation.type}
          : {
              kind: "plugin-proxy",
              pluginType: s.representation.type,
              representation: hit.representation ?? "unspecified-proxy",
            };
    }

    return result;
  }

  destroy(): void {
    this.alive = false;
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    for (const entry of this.pending.values()) entry.host.destroy();
    this.pending.clear();
    for (const entry of this.runtimes.values()) {
      this.safely(() => entry.runtime.dispose());
      entry.host.destroy();
    }
    this.runtimes.clear();
    this.compositor?.destroy();
    this.boundsHost.destroy();
    this.cache.destroy();
    this.frames.clear();
    this.poses.clear();
    this.meshes.clear();
    this.boundsBuffers.clear();
    this.registry._detached();
  }
}
