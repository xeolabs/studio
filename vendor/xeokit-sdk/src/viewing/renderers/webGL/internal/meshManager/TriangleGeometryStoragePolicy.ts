import type {SceneMesh} from "../../../../../model/scene";
import type {RendererMemoryPolicy, TriangleGeometryStorageKind} from "../gpuMemoryManager/BatchGPUResources";
import {resolveWebGLGeometryStorage, resolveWebGLMemoryPolicy, type WebGLUpdateModePolicies} from "../../WebGLUpdateModePolicies";

/**
 * Chooses the triangle geometry representation for a renderer batch.
 *
 * This keeps the storage policy next to batching, while leaving
 * {@link MeshManager} focused on registration and batch lookup.
 */
export function selectTriangleGeometryStorage(
  sceneMesh: SceneMesh,
  updateModePolicies: WebGLUpdateModePolicies = {}
): TriangleGeometryStorageKind {
  return resolveWebGLGeometryStorage(updateModePolicies, sceneMesh);
}

export function getRendererMemoryPolicyForMesh(
  sceneMesh: SceneMesh,
  updateModePolicies: WebGLUpdateModePolicies = {}
): RendererMemoryPolicy {
  return resolveWebGLMemoryPolicy(updateModePolicies, sceneMesh);
}
