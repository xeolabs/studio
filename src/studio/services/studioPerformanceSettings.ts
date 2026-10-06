import type {ViewParams} from "@xeokit/sdk/viewing/viewer";
import {WEBGPU_RENDER_CONFIG_PROFILES, type WebGPURendererCreateParams} from "@xeokit/sdk/viewing/renderers/webGPU";

export function createStudioPerformanceWebGPUSettings(): WebGPURendererCreateParams {
  return {
    memoryConfigs: {maxViews: 2, frustumCulling: true},
    requestAdapterOptions: {powerPreference: "high-performance"},
    renderConfigs: {...WEBGPU_RENDER_CONFIG_PROFILES.largeModel, logDepth: false, gpuTimestamps: false}
  };
}

/** Presentation-only defaults: keep source geometry/materials intact for inspection and export. */
export function createStudioPerformanceViewSettings(): Pick<ViewParams, "effects" | "lights" | "texturing" | "resolutionScale"> {
  return {
    effects: {
      sao: {enabled: false},
      edges: {enabled: false},
      bloom: {enabled: false},
      atmosphere: {enabled: false},
      depthOfField: {enabled: false},
      colorGrading: {enabled: false},
      tonemap: {enabled: false},
      antiAliasing: {enabled: false},
      shadows: {enabled: false},
      sky: {enabled: false},
      sectionPlaneCaps: {enabled: false},
      bodyHatch: {enabled: false}
    },
    lights: {ibl: {enabled: false}, hemispheric: {enabled: true}},
    texturing: {enabled: false},
    // Same interaction-first resolution as the performance drag/drop examples.
    resolutionScale: {enabled: true, resolutionScale: 0.65}
  };
}
