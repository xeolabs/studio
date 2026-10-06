import {LinesPrimitive, PointsPrimitive, TrianglesPrimitive} from "../../../base/constants";
import type {SceneMesh, SceneModel} from "../../../model/scene";
import type {RendererMemoryPolicy, TriangleGeometryStorageKind} from "./internal/gpuMemoryManager/BatchGPUResources";

export type WebGLGeometryStoragePolicy = "auto" | "dtx" | "vbo";
export type WebGLLineGeometryStoragePolicy = "auto" | "dtx";

export interface WebGLPrimitiveUpdateModePolicy {
  /**
   * Renderer-owned memory allocation intent for matching SceneModels.
   * Base geometry data textures grow while models are open or streaming.
   * `compact` trims unused tail rows once all models sharing the allocation
   * are sealed; `stream` retains spare capacity for reuse. This does not
   * disable permitted updates to existing geometry or object state.
   */
  memoryPolicy?: RendererMemoryPolicy;
}

export interface WebGLTriangleUpdateModePolicy extends WebGLPrimitiveUpdateModePolicy {
  /**
   * Geometry storage for triangle meshes and the triangle-derived edge, pick
   * and snap passes that render from the same triangle batch.
   *
   * `"vbo"` stores supported geometry in batch-owned WebGL buffers. `"dtx"`
   * stores geometry in data textures. `"auto"` uses the built-in WebGL mapping
   * for the model's update mode.
   */
  geometryStorage?: WebGLGeometryStoragePolicy;
}

export interface WebGLLineUpdateModePolicy extends WebGLPrimitiveUpdateModePolicy {
  /**
   * Geometry storage for authored line primitive meshes.
   *
   * Authored lines currently use data textures in WebGL. Triangle edge
   * rendering follows the triangle policy instead.
   */
  geometryStorage?: WebGLLineGeometryStoragePolicy;
}

export interface WebGLPointUpdateModePolicy extends WebGLPrimitiveUpdateModePolicy {
  /**
   * Geometry storage for point primitive meshes.
   *
   * Point meshes use VBO geometry by default, which avoids data-texture
   * geometry fetches for large point sets while keeping mesh/view/material
   * state in the existing WebGL data-texture tables.
   */
  geometryStorage?: WebGLGeometryStoragePolicy;
}

/**
 * WebGL renderer policy for models that declare renderer-neutral update mode.
 */
export interface WebGLUpdateModePolicy extends WebGLPrimitiveUpdateModePolicy {
  /**
   * Triangle mesh policy for this update mode. This also controls
   * triangle-derived edge, pick and snap paths.
   */
  triangles?: WebGLTriangleUpdateModePolicy;

  /**
   * Authored line-primitive mesh policy for this update mode. Triangle edges
   * are controlled by {@link WebGLUpdateModePolicy.triangles}.
   */
  lines?: WebGLLineUpdateModePolicy;

  /**
   * Point mesh policy for this update mode. Points use VBO geometry in the
   * built-in WebGL policies.
   */
  points?: WebGLPointUpdateModePolicy;
}

/**
 * WebGL update-mode policy lookup table.
 */
export interface WebGLUpdateModePolicies {
  /**
   * Fallback policy for models with `updateMode: "auto"` or no matching policy.
   */
  default?: WebGLUpdateModePolicy;

  /**
   * Policy for `SceneModel` instances with `updateMode: "static"`.
   */
  static?: WebGLUpdateModePolicy;

  /**
   * Policy for `SceneModel` instances with `updateMode: "dynamic"`.
   */
  dynamic?: WebGLUpdateModePolicy;
}

export const WEBGL_UPDATE_MODE_POLICIES: Required<WebGLUpdateModePolicies> = {
  default: {
    memoryPolicy: "stream",
    triangles: {geometryStorage: "dtx"},
    lines: {geometryStorage: "dtx"},
    points: {geometryStorage: "vbo"}
  },
  static: {
    memoryPolicy: "compact",
    triangles: {geometryStorage: "vbo"},
    lines: {geometryStorage: "dtx"},
    points: {geometryStorage: "vbo"}
  },
  dynamic: {
    memoryPolicy: "stream",
    triangles: {geometryStorage: "dtx"},
    lines: {geometryStorage: "dtx"},
    points: {geometryStorage: "vbo"}
  }
};

export function getWebGLUpdateModePolicyId(sceneModel?: SceneModel | null): keyof WebGLUpdateModePolicies {
  if (!sceneModel || sceneModel.updateMode === "auto") {
    return "default";
  }
  return sceneModel.updateMode;
}

export function resolveWebGLGeometryStorage(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh
): TriangleGeometryStorageKind {
  if ((sceneMesh.geometry.primitive !== TrianglesPrimitive && sceneMesh.geometry.primitive !== PointsPrimitive)
    || sceneMesh.billboard === "spherical") {
    return "dtx";
  }

  const primitiveFamily = sceneMesh.geometry.primitive === PointsPrimitive ? "points" : "triangles";
  const policyId = getWebGLUpdateModePolicyId(sceneMesh.model);
  const userPolicy = updateModePolicies[policyId] ?? updateModePolicies.default ?? {};
  const policy = userPolicy[primitiveFamily];
  const storage = policy?.geometryStorage ?? "auto";
  if (storage === "dtx" || storage === "vbo") {
    return storage;
  }
  return WEBGL_UPDATE_MODE_POLICIES[getWebGLUpdateModePolicyId(sceneMesh.model)]?.[primitiveFamily]?.geometryStorage === "vbo"
    ? "vbo"
    : "dtx";
}

export function resolveWebGLMemoryPolicy(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh
): RendererMemoryPolicy {
  const primitivePolicy = getPrimitivePolicy(updateModePolicies, sceneMesh);
  if (primitivePolicy?.memoryPolicy) {
    return primitivePolicy.memoryPolicy;
  }

  const policyId = getWebGLUpdateModePolicyId(sceneMesh.model);
  const userPolicy = updateModePolicies[policyId] ?? updateModePolicies.default ?? {};
  if (userPolicy.memoryPolicy) {
    return userPolicy.memoryPolicy;
  }

  return WEBGL_UPDATE_MODE_POLICIES[policyId]?.memoryPolicy ?? WEBGL_UPDATE_MODE_POLICIES.default.memoryPolicy;
}

function getPrimitivePolicy(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh
): WebGLPrimitiveUpdateModePolicy | undefined;
function getPrimitivePolicy(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh,
  primitiveFamily: "triangles"
): WebGLTriangleUpdateModePolicy | undefined;
function getPrimitivePolicy(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh,
  primitiveFamily: "lines"
): WebGLLineUpdateModePolicy | undefined;
function getPrimitivePolicy(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh,
  primitiveFamily: "points"
): WebGLPointUpdateModePolicy | undefined;
function getPrimitivePolicy(
  updateModePolicies: WebGLUpdateModePolicies,
  sceneMesh: SceneMesh,
  primitiveFamily?: "triangles" | "lines" | "points" | null
): WebGLPrimitiveUpdateModePolicy | undefined {
  const policyId = getWebGLUpdateModePolicyId(sceneMesh.model);
  const userPolicy = updateModePolicies[policyId] ?? updateModePolicies.default ?? {};
  const family = primitiveFamily ?? getPrimitiveFamily(sceneMesh.geometry.primitive);
  return family ? userPolicy[family] : undefined;
}

function getPrimitiveFamily(primitive: number): "triangles" | "lines" | "points" | null {
  switch (primitive) {
    case TrianglesPrimitive:
      return "triangles";
    case LinesPrimitive:
      return "lines";
    case PointsPrimitive:
      return "points";
    default:
      return null;
  }
}
