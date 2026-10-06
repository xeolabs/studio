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
import type {WebGLRendererPluginAdapter} from "../../plugins/WebGLRendererPluginAdapter";
import type {WebGLRepresentationRuntime} from "../../plugins/WebGLRepresentationRuntime";
import type {WebGLRepresentationSnapshot} from "../../plugins/WebGLRepresentationSnapshot";
import type {WebGLPluginTarget} from "../../plugins/WebGLPluginTarget";
import type {RenderContext} from "../RenderContext";
import type {MeshManager} from "../meshManager/MeshManager";
import {GLPluginResources, GLSceneResourceCache} from "./GLPluginResources";
import {withPluginState} from "./GLPluginState";

type RuntimeEntry = {

  adapter: WebGLRendererPluginAdapter;

  runtime: WebGLRepresentationRuntime;

  host: GLPluginResources;
};
type Prepared = {

  mesh: SceneMesh;

  snapshot: WebGLRepresentationSnapshot;

  status: RendererPluginInstanceStatus;

  entry?: RuntimeEntry;
};

/** Indexed representation routing, device resources and isolated compose-opaque execution.
 * This manager has no domain-specific branches. Its lifetime is the WebGL device lifetime.
 */
export class WebGLPluginManager {

  private readonly meshes = new Set<SceneMesh>();

  private readonly runtimes = new Map<string, RuntimeEntry>();

  private readonly failed = new Map<string, number>();

  private readonly frames = new Map<string, Prepared[]>();

  private readonly poses = new Map<
    SceneMesh,
    {

      version: number;

      colors?: Uint8Array;

      slots: {

        index: number;

        data: Float32Array;
      }[];
    }
  >();

  private readonly unsubscribe: (() => void)[] = [];

  private cache: GLSceneResourceCache;

  private host: GLPluginResources;

  private copy?: WebGLPluginTarget & {

    depth: WebGLTexture;
  };

  private bounds?: {

    program: WebGLProgram;

    vao: WebGLVertexArrayObject;

    buffer: WebGLBuffer;
  };

  constructor(
    private rc: RenderContext,
    private meshManager: MeshManager,
    private registry: RendererPluginRegistry,
    private uploadOrdinary: () => void
  ) {
    this.cache = new GLSceneResourceCache(rc.gl);
    this.host = new GLPluginResources(rc.gl, this.cache, () => this.redraw());

    const scene = rc.viewer.scene;
    const track = (mesh: SceneMesh) => {
      if (mesh.representationId !== undefined && !mesh.model.headless) this.meshes.add(mesh);
      else this.meshes.delete(mesh);
      this.frames.clear();
      this.redraw();
    };

    for (const model of Object.values(scene.models))
      for (const mesh of Object.values(model.meshes)) track(mesh);

    this.unsubscribe.push(
      scene.events.onSceneMeshCreated.subscribe((_, mesh) => track(mesh)),
      scene.events.onSceneMeshRepresentationChanged.subscribe((_, mesh) => {
        for (const entry of this.runtimes.values()) entry.runtime.releaseInstance?.(this.identity(mesh));
        track(mesh);
        if (!mesh.representationId) this.meshManager.restoreOrdinaryMesh(mesh);
      }),
      scene.events.onSceneMeshDestroyed.subscribe((_, mesh) => {
        this.meshes.delete(mesh);
        this.poses.delete(mesh);
        const identity = this.identity(mesh);
        for (const entry of this.runtimes.values()) entry.runtime.releaseInstance?.(identity);
        this.registry._forget(identity);
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
      rc.viewer.events.onViewDestroyed.subscribe((_, view) => {
        this.frames.delete(view.id);
        for (const entry of this.runtimes.values()) entry.runtime.releaseView?.(view.id);
      }),
      registry._subscribe(() => {
        this.syncRegistrations();
        this.failed.clear();
        this.redraw();
      })
    );

    this.syncRegistrations();
  }

  private identity(mesh: SceneMesh) {
    return {sceneId: mesh.model.scene.id, modelId: mesh.model.id, meshId: mesh.id};
  }

  private redraw(): void {
    for (const view of this.rc.viewer.viewList) view.needsRender();
  }

  private isolate<T>(work: () => T): T {
    try {
      return withPluginState(this.rc.gl, work);
    } finally {
      this.rc.lastProgramId = -1;
      this.rc.lastRenderPass = -1;
      this.rc.boundTexture2DUnits.fill(null);
      this.rc.boundCubemapTextureUnits.fill(null);
      this.rc.activeTextureUnit = -1;
    }
  }

  private syncRegistrations(): void {
    if (!this.runtimes.size && !this.registry._definitions().size) return;

    this.isolate(() => {
      for (const [type, entry] of this.runtimes) {
        if (!this.registry._definitions().get(type)?.adapters.includes(entry.adapter)) {
          try {
            entry.runtime.dispose();
          } catch (error) {
            console.warn("Renderer plugin disposal failed", error);
          } finally {
            entry.host.destroy();
          }
          this.runtimes.delete(type);
        }
      }

      for (const [type, definition] of this.registry._definitions()) {
        if (this.runtimes.has(type)) continue;
        const adapter = definition.adapters.find(
          (candidate) => candidate.backend === "webgl2" && candidate.hostApiVersion === 1
        ) as WebGLRendererPluginAdapter | undefined;
        if (!adapter) continue;
        const host = new GLPluginResources(this.rc.gl, this.cache, () => this.redraw());

        try {
          const runtime = adapter.create(host);
          if (!["compose-opaque", "transparent"].includes(runtime.stage) ||
              (runtime.stage === "transparent" && runtime.depth !== "test-only") ||
              !["none", "test-only", "actual-surface", "proxy"].includes(runtime.depth)) {
            try {
              runtime.dispose();
            } finally {
              throw new Error("Plugin must declare its output depth semantics");
            }
          }
          this.runtimes.set(type, {runtime, host, adapter});
          this.registry._ready(type, {ok: true, value: undefined});
        } catch (error) {
          host.destroy();
          this.registry._ready(type, {
            ok: false,
            type: SDKErrorType.InitializationFailed,
            error: String(error),
          });
        }
      }
    });
  }

  private snapshot(mesh: SceneMesh, view: View): WebGLRepresentationSnapshot {
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
    const projectionMatrix = new Float64Array(view.camera.projMatrix);
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
  prepareView(view: View, hdr: boolean): void {
    if (!this.meshes.size) return;
    const prepared: Prepared[] = [];
    let allocated = false;

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
        else if (!entry) status = {state: "fallback", policy, reason: "backend-unsupported"};
        else if (!hdr || mesh.morphWeights.length > 0)
          status = {
            state: "fallback",
            policy,
            reason: "capability-unsupported",
            detail: "This WebGL adapter requires HDR and supports static or sampled vertex-state geometry",
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

      allocated =
        this.meshManager.routeRepresentation(
          mesh,
          view,
          mesh.representationMode === "augment" || (status.state !== "active" && status.policy === "standard")
        ) || allocated;
      this.registry._status(snapshot.instance, view.id, status);
      prepared.push({mesh, snapshot, status, entry});
    }

    if (allocated) this.uploadOrdinary();
    this.frames.set(view.id, prepared);
  }

  private copyTarget(width: number, height: number) {
    if (this.copy?.width === width && this.copy.height === height) return this.copy;
    const gl = this.rc.gl;
    if (this.copy) {
      this.copy.release();
      gl.deleteTexture(this.copy.depth);
      this.copy = undefined;
    }
    const target = this.host.createTarget(width, height);
    const depth = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH24_STENCIL8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      target.release();
      gl.deleteTexture(depth);
      throw new Error("Plugin scene-copy attachment is incomplete");
    }
    this.copy = {...target, depth};
    return this.copy;
  }

  /** Compose into the active HDR scene target, preserving existing colour/depth on failure. */
  transparentItems(view: View) {
    return (this.frames.get(view.id) ?? []).filter(item =>
      item.snapshot.enabled && item.snapshot.visible && item.snapshot.opacity > 0 &&
      item.status.state === "active" && item.entry?.runtime.stage === "transparent"
    ).map(item => ({
      key: JSON.stringify(item.snapshot.instance),
      depth: boundsViewDepth(item.snapshot.representation.localBounds, item.snapshot.viewMatrix, item.snapshot.worldMatrix),
      draw: () => this.render(view, item)
    }));
  }

  render(view: View, transparent?: Prepared): void {
    const prepared = transparent ? [transparent] : this.frames.get(view.id)?.filter(item =>
      item.status.state !== "active" || item.entry?.runtime.stage === "compose-opaque");
    if (!prepared?.length) return;
    const gl = this.rc.gl,
      width = this.rc.sceneRenderWidth,
      height = this.rc.sceneRenderHeight;

    this.isolate(() => {
      const output = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

      for (const item of prepared) {
        const {snapshot, entry} = item;
        if (!snapshot.visible || snapshot.opacity <= 0) continue;

        if (item.status.state === "active" && entry) {
          let copy: ReturnType<WebGLPluginManager["copyTarget"]> | undefined;
          try {
            copy = this.copyTarget(width, height);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, output);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.framebuffer);
            gl.blitFramebuffer(
              0,
              0,
              width,
              height,
              0,
              0,
              width,
              height,
              gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT,
              gl.NEAREST
            );

            this.isolate(() => {
              entry.runtime.prepare?.(snapshot);
              gl.bindFramebuffer(gl.FRAMEBUFFER, output);
              gl.viewport(0, 0, width, height);
              if (entry.runtime.stage === "transparent") {
                gl.enable(gl.BLEND);
                gl.blendEquation(gl.FUNC_ADD);
                gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              } else gl.disable(gl.BLEND);
              if (entry.runtime.depth === "none") gl.disable(gl.DEPTH_TEST);
              else gl.enable(gl.DEPTH_TEST);
              gl.depthFunc(entry.runtime.depth === "test-only" ? gl.LEQUAL : gl.ALWAYS);
              gl.depthMask(entry.runtime.depth === "actual-surface" || entry.runtime.depth === "proxy");
              gl.colorMask(true, true, true, true);
              entry.runtime.render(snapshot, {
                width,
                height,
                stage: entry.runtime.stage,
                depthEncoding: view.camera.projMatrix[11] === 0
                  ? {kind: "projective", clipRange: "negative-one-to-one"}
                  : {kind: "logarithmic", clipRange: "negative-one-to-one", far: view.camera.perspectiveProjection.far},
                sceneColor: entry.runtime.stage === "compose-opaque" ? copy.texture : undefined,
                sceneDepth: copy.depth,
              });
            });
          } catch (error) {
            // Roll back this plugin only. The copy already includes preceding successful plugins.
            if (copy) {
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, copy.framebuffer);
              gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, output);
              gl.blitFramebuffer(
                0,
                0,
                width,
                height,
                0,
                0,
                width,
                height,
                gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT,
                gl.NEAREST
              );
            }
            item.status = {
              state: "failed",
              policy: snapshot.representation.fallback,
              reason: "execution-failed",
              detail: String(error),
            };
            this.failed.set(JSON.stringify([item.mesh.uniqueId, view.id]), snapshot.representation.revision);
            this.registry._status(snapshot.instance, view.id, item.status);
            this.redraw();
          }
        }

        if (item.status.state !== "active" && item.status.policy === "bounds") {
          gl.bindFramebuffer(gl.FRAMEBUFFER, output);
          gl.viewport(0, 0, width, height);
          this.drawBounds(item);
        }
      }
    });
  }

  private drawBounds(item: Prepared): void {
    const gl = this.rc.gl;

    if (!this.bounds) {
      const program = this.host.createProgram(
        `#version 300 es\nlayout(location=0) in vec3 p; uniform mat4 mvp; out float distanceToEye; void main(){gl_Position=mvp*vec4(p,1.0);distanceToEye=gl_Position.w;}`,
        `#version 300 es\nprecision highp float; out vec4 color; in float distanceToEye; uniform float logScale; void main(){color=vec4(0.65,0.3,0.06,1.0);gl_FragDepth=logScale>0.0?log2(1.0+distanceToEye)/logScale:gl_FragCoord.z;}`
      );
      const vao = this.host.createVertexArray();
      gl.bindVertexArray(vao);
      const buffer = this.host.createBuffer(new Float32Array(72));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      this.bounds = {program, vao, buffer};
    }

    const bounds = item.snapshot.representation?.localBounds ?? item.mesh.localBounds;
    const corners = Array.from({length: 8}, (_, i) => [
      bounds[i & 1 ? 3 : 0],
      bounds[i & 2 ? 4 : 1],
      bounds[i & 4 ? 5 : 2],
    ]);
    const indices = [0, 1, 0, 2, 0, 4, 1, 3, 1, 5, 2, 3, 2, 6, 3, 7, 4, 5, 4, 6, 5, 7, 6, 7];
    gl.useProgram(this.bounds.program);
    gl.bindVertexArray(this.bounds.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bounds.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(indices.flatMap((index) => corners[index])));
    const mvp = inverseMat4(item.snapshot.inverseModelViewProjection, new Float64Array(16));
    gl.uniformMatrix4fv(gl.getUniformLocation(this.bounds.program, "mvp"), false, new Float32Array(mvp));
    gl.uniform1f(gl.getUniformLocation(this.bounds.program, "logScale"), item.snapshot.projectionMatrix[11] === 0 ? 0 : Math.log2(this.rc.viewer.views[item.snapshot.viewId].camera.perspectiveProjection.far + 1));
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.LINES, 0, indices.length);
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
      const near = transformVec4(s.inverseModelViewProjection, [x, y, -1, 1], new Float64Array(4));
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

  restore(): void {
    this.disposeDevice();
    this.cache = new GLSceneResourceCache(this.rc.gl);
    this.host = new GLPluginResources(this.rc.gl, this.cache, () => this.redraw());
    this.failed.clear();
    this.syncRegistrations();
  }

  private disposeDevice(): void {
    for (const entry of this.runtimes.values()) {
      try {
        entry.runtime.dispose();
      } catch (error) {
        console.warn("Renderer plugin disposal failed", error);
      } finally {
        entry.host.destroy();
      }
    }
    this.runtimes.clear();
    if (this.copy) this.rc.gl.deleteTexture(this.copy.depth);
    this.copy = undefined;
    this.bounds = undefined;
    this.host.destroy();
    this.cache.destroy();
    this.frames.clear();
  }

  destroy(): void {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.disposeDevice();
    this.poses.clear();
    this.meshes.clear();
    this.registry._detached();
  }
}
