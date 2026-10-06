import type {SceneGeometry} from "../../../../../model/scene";
import type {WebGPUBufferLike} from "../../core";

export interface RendererGeometryFrameStorage {
  vertexCount: number;
  frameCount: number;
  times: Float32Array;
  unionAABB: Float32Array;
  positionBuffer: WebGPUBufferLike;
  positionDecodeBuffer: WebGPUBufferLike;
  normalBuffer: WebGPUBufferLike | null;
  uvBuffer: WebGPUBufferLike | null;
  hasNormals: boolean;
  hasUVs: boolean;
  destroy(): void;
}

export interface RendererGeometryFrameState {
  frameAOffset: number;
  frameBOffset: number;
  frameADecodeIndex: number;
  frameBDecodeIndex: number;
  normalAOffset: number;
  normalBOffset: number;
  factor: number;
  flags: number;
}

export interface RendererGeometry {
  geometry: SceneGeometry;
  renderAABB: Float32Array;
  positions: Float32Array;
  uvs: Float32Array | null;
  texCoords: {[channel: number]: Float32Array};
  normals: Float32Array | null;
  indices: Uint16Array | Uint32Array | null;
  edgeIndices: Uint16Array | Uint32Array | null;
  indexFormat: "uint16" | "uint32" | null;
  indexCount: number;
  edgeIndexCount: number;
  frameStorage: RendererGeometryFrameStorage | null;
  numMeshes: number;
}
