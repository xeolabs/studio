import {TrianglesPrimitive} from "../../../../base/constants";

/**
 * Maps a parsed tinyusdz scene onto a `SceneModel`.
 *
 * Pure and dependency-light by design: it takes the minimal slices of the
 * tinyusdz and SceneModel APIs it needs (see the `*Like` interfaces), so
 * it can be unit-tested with plain fakes — no wasm, and no dependency on
 * renderer state.
 *
 * Walks the node tree from the default root, preserving USD Xform/Mesh nodes
 * as `SceneTransform`s so authored transform animation can target them, and
 * emits:
 *
 *  - one `SceneTransform` per USD node,
 *  - one `SceneGeometry` per distinct tinyusdz mesh `contentId` (so
 *    instanced prims share geometry),
 *  - one `SceneMaterial` per distinct `materialId`
 *    (UsdPreviewSurface → PBR),
 *  - one `SceneMesh` per mesh-bearing node, attached to its node transform,
 *  - one `SceneObject` per mesh-bearing node (id from the USD prim path).
 *
 * Animation import is intentionally adapter-driven: when a USD scene adapter
 * can expose sampled transform channels, this mapper converts those semantic
 * samples to `SceneAnimation`s. The current tinyusdz JS binding only exposes
 * static `localMatrix` values, but this boundary keeps the xeokit side ready
 * for animated USD adapters without baking time back into geometry or meshes.
 *
 * tinyusdz returns already-triangulated meshes, so `faceVertexIndices`
 * are used as-is.
 *
 * @internal
 */

/** Minimal view of a tinyusdz node. */
export interface USDNodeLike {
  nodeType?: string;
  absPath?: string;
  primName?: string;
  /** 16-element local transform (column-major, composed down the tree). */
  localMatrix?: ArrayLike<number>;
  /** Index into the scene's mesh table, or < 0 / undefined for non-meshes. */
  contentId?: number;
  /** Plain array, or an embind vector exposing `size()` / `get(i)`. */
  children?: any;
}

/** Supported USD transform sample property after adapter-side xform-op interpretation. */
export type USDTransformAnimationProperty = "translation" | "rotation" | "scale";

/** Sampled transform channel exposed by a USD scene adapter. */
export interface USDTransformAnimationChannelLike {
  /** Absolute USD prim path, normally matching `USDNodeLike.absPath`. */
  targetPath?: string;
  /** Optional direct target node reference when path lookup is unavailable. */
  targetNode?: USDNodeLike;
  /** Semantic transform property represented by `values`. */
  property: USDTransformAnimationProperty;
  /** Finite, strictly increasing authored sample times. */
  times: ArrayLike<number>;
  /**
   * Flattened values in sample order. Translation and scale use three values
   * per sample; rotation uses quaternion xyzw with four values per sample.
   */
  values: ArrayLike<number>;
  /** Defaults to LINEAR. */
  interpolation?: "STEP" | "LINEAR";
}

/** Authored USD animation exposed by a USD scene adapter. */
export interface USDTransformAnimationLike {
  id?: string;
  name?: string;
  channels?: any;
}

/** Minimal view of a tinyusdz mesh. */
export interface USDMeshLike {
  points?: ArrayLike<number>;
  faceVertexIndices?: ArrayLike<number>;
  normals?: ArrayLike<number>;
  texcoords?: ArrayLike<number>;
  vertexColors?: ArrayLike<number>;
  materialId?: number;
}

/** Minimal view of a tinyusdz (UsdPreviewSurface) material. */
export interface USDMaterialLike {
  diffuseColor?: ArrayLike<number>;
  opacity?: number;
  metallic?: number;
  roughness?: number;
  diffuseColorTextureId?: number;
  normalTextureId?: number;
}

/** Minimal view of a tinyusdz scene. */
export interface USDSceneLike {
  getDefaultRootNode(): USDNodeLike;
  getMesh(contentId: number): USDMeshLike | null | undefined;
  getMaterial(materialId: number): USDMaterialLike | null | undefined;
  /** Optional adapter hook for authored USD transform animation samples. */
  getAnimations?(): any;
}

/** Minimal view of the SceneModel build API. */
export interface SceneModelLike {
  createTransform(params: any): any;
  createGeometry(params: any): any;
  createMaterial(params: any): any;
  createMesh(params: any): any;
  createObject(params: any): any;
  createAnimation?(params: any): any;
}

/** Counts of failed create-calls, surfaced for diagnostics. */
export interface BuildStats {
  transforms: number;
  geometries: number;
  materials: number;
  meshes: number;
  objects: number;
  animations: number;
  failures: number;
}

export function buildSceneModel(scene: USDSceneLike, sceneModel: SceneModelLike): BuildStats {
  const geomByContentId = new Map<number, string>();
  const matByMaterialId = new Map<number, string>();
  const usedObjectIds = new Set<string>();
  const usedTransformIds = new Set<string>();
  const usedAnimationIds = new Set<string>();
  const transformIdByNode = new WeakMap<USDNodeLike, string>();
  const transformIdByPath = new Map<string, string>();
  const stats: BuildStats = {transforms: 0, geometries: 0, materials: 0, meshes: 0, objects: 0, animations: 0, failures: 0};
  let meshSeq = 0;
  let transformSeq = 0;

  const ok = (r: any): boolean => {
    if (r && r.ok === false) { stats.failures++; return false; }
    return true;
  };

  const emitMaterial = (materialId: number | undefined): string | undefined => {
    if (materialId == null || materialId < 0) return undefined;
    const existing = matByMaterialId.get(materialId);
    if (existing) return existing;
    const m = scene.getMaterial(materialId);
    if (!m) return undefined;
    const id = `usd-material-${materialId}`;
    const params: any = {id};
    if (m.diffuseColor && m.diffuseColor.length >= 3) {
      params.color = [m.diffuseColor[0], m.diffuseColor[1], m.diffuseColor[2]];
    }
    if (typeof m.opacity === "number") params.opacity = m.opacity;
    if (typeof m.metallic === "number") params.metallic = m.metallic;
    if (typeof m.roughness === "number") params.roughness = m.roughness;
    if (!ok(sceneModel.createMaterial(params))) return undefined;
    matByMaterialId.set(materialId, id);
    stats.materials++;
    return id;
  };

  const emitTransform = (node: USDNodeLike, parentTransformId?: string): string | undefined => {
    const existing = transformIdByNode.get(node);
    if (existing) {
      return existing;
    }
    const base = node.absPath || node.primName || `usd-node-${transformSeq++}`;
    const transformId = uniqueId(`usd-transform-${base}`, usedTransformIds);
    const localMatrix = node.localMatrix && node.localMatrix.length === 16
      ? toMat4(node.localMatrix)
      : identity();
    const params: any = {id: transformId, matrix: localMatrix};
    if (parentTransformId) {
      params.parentTransformId = parentTransformId;
    }
    if (!ok(sceneModel.createTransform(params))) {
      return undefined;
    }
    transformIdByNode.set(node, transformId);
    if (node.absPath) {
      transformIdByPath.set(node.absPath, transformId);
    }
    stats.transforms++;
    return transformId;
  };

  const emitMesh = (node: USDNodeLike, parentTransformId: string | undefined): void => {
    const cid = node.contentId;
    if (cid == null || cid < 0) return;
    const mesh = scene.getMesh(cid);
    if (!mesh || !mesh.points || mesh.points.length === 0) return;

    let geometryId = geomByContentId.get(cid);
    if (!geometryId) {
      geometryId = `usd-geometry-${cid}`;
      const g: any = {id: geometryId, primitive: TrianglesPrimitive, positions: mesh.points};
      if (mesh.faceVertexIndices && mesh.faceVertexIndices.length) g.indices = mesh.faceVertexIndices;
      if (mesh.normals && mesh.normals.length) g.normals = mesh.normals;
      if (mesh.texcoords && mesh.texcoords.length) g.uvs = mesh.texcoords;
      if (mesh.vertexColors && mesh.vertexColors.length) g.colors = mesh.vertexColors;
      if (!ok(sceneModel.createGeometry(g))) return;
      geomByContentId.set(cid, geometryId);
      stats.geometries++;
    }

    const materialId = emitMaterial(mesh.materialId);

    const meshId = `usd-mesh-${meshSeq++}`;
    const meshParams: any = {id: meshId, geometryId, matrix: identity()};
    if (parentTransformId) meshParams.parentTransformId = parentTransformId;
    if (materialId) meshParams.materialId = materialId;
    if (!ok(sceneModel.createMesh(meshParams))) return;
    stats.meshes++;

    const objectId = uniqueId(node.absPath || node.primName || meshId, usedObjectIds);
    if (ok(sceneModel.createObject({id: objectId, meshIds: [meshId]}))) stats.objects++;
  };

  const walk = (node: USDNodeLike, parentTransformId?: string): void => {
    const transformId = emitTransform(node, parentTransformId);
    emitMesh(node, transformId);
    for (const child of childArray(node.children)) {
      walk(child, transformId);
    }
  };

  walk(scene.getDefaultRootNode());
  emitAnimations(scene, sceneModel, transformIdByNode, transformIdByPath, usedAnimationIds, stats, ok);
  return stats;
}

// ── helpers ───────────────────────────────────────────────────────────

/** Normalises tinyusdz children (plain array or embind vector). */
function childArray(children: any): USDNodeLike[] {
  if (!children) return [];
  if (Array.isArray(children)) return children;
  if (typeof children.size === "function" && typeof children.get === "function") {
    const out: USDNodeLike[] = [];
    for (let i = 0, n = children.size(); i < n; i++) out.push(children.get(i));
    return out;
  }
  return [];
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base; }
  let i = 1;
  while (used.has(`${base}_${i}`)) i++;
  const id = `${base}_${i}`;
  used.add(id);
  return id;
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function toMat4(m: ArrayLike<number>): number[] {
  const out = new Array(16);
  for (let i = 0; i < 16; i++) out[i] = m[i];
  return out;
}

function emitAnimations(
  scene: USDSceneLike,
  sceneModel: SceneModelLike,
  transformIdByNode: WeakMap<USDNodeLike, string>,
  transformIdByPath: Map<string, string>,
  usedAnimationIds: Set<string>,
  stats: BuildStats,
  ok: (r: any) => boolean
): void {
  if (!sceneModel.createAnimation || typeof scene.getAnimations !== "function") {
    return;
  }
  for (const animation of animationArray(scene.getAnimations())) {
    const channels: any[] = [];
    for (const channel of animationChannelArray(animation.channels)) {
      const transformId = resolveAnimationTransformId(channel, transformIdByNode, transformIdByPath);
      if (!transformId || !isTransformProperty(channel.property)) {
        continue;
      }
      const times = numberArray(channel.times);
      const values = numberArray(channel.values);
      const valueSize = channel.property === "rotation" ? 4 : 3;
      if (!isValidSampler(times, values, valueSize)) {
        continue;
      }
      channels.push({
        target: {
          type: "transform",
          transformId,
          property: channel.property
        },
        sampler: {
          times,
          values,
          interpolation: channel.interpolation === "STEP" ? "STEP" : "LINEAR"
        }
      });
    }
    if (channels.length === 0) {
      continue;
    }
    const id = uniqueId(animation.id || animation.name || "usd-animation", usedAnimationIds);
    if (ok(sceneModel.createAnimation({
      id,
      ...(animation.name ? {name: animation.name} : {}),
      channels
    }))) {
      stats.animations++;
    }
  }
}

function resolveAnimationTransformId(
  channel: USDTransformAnimationChannelLike,
  transformIdByNode: WeakMap<USDNodeLike, string>,
  transformIdByPath: Map<string, string>
): string | undefined {
  if (channel.targetNode) {
    const id = transformIdByNode.get(channel.targetNode);
    if (id) {
      return id;
    }
  }
  return channel.targetPath ? transformIdByPath.get(channel.targetPath) : undefined;
}

function isTransformProperty(property: any): property is USDTransformAnimationProperty {
  return property === "translation" || property === "rotation" || property === "scale";
}

function isValidSampler(times: number[], values: number[], valueSize: number): boolean {
  if (times.length === 0 || values.length !== times.length * valueSize) {
    return false;
  }
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || (i > 0 && times[i] <= times[i - 1])) {
      return false;
    }
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      return false;
    }
  }
  return true;
}

function numberArray(values: ArrayLike<number> | undefined): number[] {
  return values ? Array.from(values) : [];
}

function animationArray(animations: any): USDTransformAnimationLike[] {
  if (!animations) return [];
  if (Array.isArray(animations)) return animations;
  if (typeof animations.size === "function" && typeof animations.get === "function") {
    const out: USDTransformAnimationLike[] = [];
    for (let i = 0, n = animations.size(); i < n; i++) out.push(animations.get(i));
    return out;
  }
  return [];
}

function animationChannelArray(channels: any): USDTransformAnimationChannelLike[] {
  if (!channels) return [];
  if (Array.isArray(channels)) return channels;
  if (typeof channels.size === "function" && typeof channels.get === "function") {
    const out: USDTransformAnimationChannelLike[] = [];
    for (let i = 0, n = channels.size(); i < n; i++) out.push(channels.get(i));
    return out;
  }
  return [];
}
