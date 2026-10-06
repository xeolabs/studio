import type {DrawOp} from "./DrawOp";

/**
 * Collection of WebGPU draw operations for a primitive type, indexed by render
 * pass.
 *
 * @internal
 */
export interface RenderPassDrawOps {
  depthPrepass?: DrawOp;
  shadowDepth?: DrawOp;
  opaque?: DrawOp;
  opaqueDepthPrepassColor?: DrawOp;
  transparent?: DrawOp;
  noNormalsOpaque?: DrawOp;
  noNormalsOpaqueDepthPrepassColor?: DrawOp;
  noNormalsTransparent?: DrawOp;
  flatOpaque?: DrawOp;
  flatOpaqueDepthPrepassColor?: DrawOp;
  flatTransparent?: DrawOp;
  overlayOpaque?: DrawOp;
  overlayTransparent?: DrawOp;
  edges?: DrawOp;
  sectionPlaneCaps?: DrawOp;
  stencilMaskFront?: DrawOp;
  stencilMaskBack?: DrawOp;
  pick?: DrawOp;
  snapVertex?: DrawOp;
  snapEdge?: DrawOp;
}
