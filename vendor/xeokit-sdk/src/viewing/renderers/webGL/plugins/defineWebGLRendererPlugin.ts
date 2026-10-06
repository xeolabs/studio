import type {WebGLRendererPluginAdapter} from "./WebGLRendererPluginAdapter";

/**
 * Wraps a runtime factory with the WebGL2 backend and host-version discriminators.
 *
 * @param create Factory called once per renderer/device generation, not per mesh.
 * @returns An adapter to include in a RendererPluginDefinition.adapters array.
 */
export function defineWebGLRendererPlugin(
  create: WebGLRendererPluginAdapter["create"]
): WebGLRendererPluginAdapter {
  return {backend: "webgl2", hostApiVersion: 1, create};
}
