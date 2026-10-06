import type {MemoryConfigs} from "../../../MemoryConfigs";
import {type RenderPassValue} from "../../RENDER_PASSES";
import type {RendererMemoryPolicy, TriangleGeometryStorageKind} from "../BatchGPUResources";
import type {BatchGeometryStorage} from "./BatchGeometryStorage";
import {DTXGeometryStorage} from "./DTXGeometryStorage";
import {VBOGeometryStorage} from "./VBOGeometryStorage";

export * from "./BatchGeometryStorage";
export * from "./DTXGeometryStorage";
export * from "./PrimRange";
export * from "./VBOGeometryStorage";

export function createBatchGeometryStorage(params: {
  kind: TriangleGeometryStorageKind;
  memoryPolicy?: RendererMemoryPolicy;
  gl: WebGL2RenderingContext;
  batchIndex: number;
  memoryConfigs: MemoryConfigs;
  bins: RenderPassValue[];
  getNumGeometries: () => number;
  primitive?: number;
  hasNormals?: boolean;
  hasFrames?: boolean;
}): BatchGeometryStorage {
  return params.kind === "vbo"
    ? new VBOGeometryStorage(params)
    : new DTXGeometryStorage(params);
}
