import type {WebGPUPluginBuffer} from "./WebGPUPluginBuffer";
import type {WebGPUPluginTexture} from "./WebGPUPluginTexture";

/** Group-zero resource, in descriptor order. Texture views are read-only. */
export type WebGPUPluginBinding =
  | WebGPUPluginBuffer
  | WebGPUPluginTexture
  | "sampler-linear"
  | "sampler-nearest";
