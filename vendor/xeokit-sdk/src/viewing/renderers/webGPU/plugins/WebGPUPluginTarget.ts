import type {WebGPUPluginTexture} from "./WebGPUPluginTexture";

/** Runtime-owned HDR intermediate. It may be sampled only outside its own write pass. */
export interface WebGPUPluginTarget extends WebGPUPluginTexture {
  /** Number of allocated mip levels, including level zero. */
  readonly mipLevelCount: number;

  /** Release the allocation; the host also releases it when the runtime ends. */
  release(): void;
}
