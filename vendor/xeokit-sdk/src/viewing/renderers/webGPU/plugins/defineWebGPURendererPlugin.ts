import type {WebGPURendererPluginAdapter} from "./WebGPURendererPluginAdapter";

/** Wrap a runtime factory with the supported WebGPU backend and host API identifiers. */
export function defineWebGPURendererPlugin(
  create: WebGPURendererPluginAdapter["create"]
): WebGPURendererPluginAdapter {
  return {backend: "webgpu", hostApiVersion: 1, create};
}
