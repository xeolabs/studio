import type {SceneDataResource} from "../../../../model/scene/representation/SceneDataResource";
import type {WebGPUPluginBuffer} from "./WebGPUPluginBuffer";
import type {WebGPUPluginTexture} from "./WebGPUPluginTexture";
import type {WebGPUPluginTarget} from "./WebGPUPluginTarget";
import type {WebGPUPluginPipeline} from "./WebGPUPluginPipeline";
import type {WebGPUPluginPipelineDescriptor} from "./WebGPUPluginPipelineDescriptor";

/** Device-lifetime services. All allocations are tracked and released on failure, unregister or device loss. */
export interface WebGPUPluginHost {
  /** Compile and validate WGSL and its pipeline before permitting it in a frame. */
  createPipeline(descriptor: WebGPUPluginPipelineDescriptor): Promise<WebGPUPluginPipeline>;

  /** Allocate and initialize a private buffer. Uniform payloads must follow WGSL alignment rules. */
  createBuffer(data: ArrayBufferView, usage: "uniform" | "vertex" | "index" | "storage"): WebGPUPluginBuffer;

  /**
   * Update an owned buffer before recording its draws. Data and offset must be four-byte aligned.
   * Once referenced by a pass in the current transaction, a buffer cannot be written or released
   * until that transaction ends. Use separate uniforms for draws requiring different values.
   */
  writeBuffer(buffer: WebGPUPluginBuffer, data: ArrayBufferView, byteOffset?: number): void;

  /** Allocate a cached rgba16float intermediate, optionally with a full mip chain. */
  createTarget(width: number, height: number, mipmaps?: boolean): WebGPUPluginTarget;

  /** Obtain a shared immutable numerical texture, uploaded once per resource revision/device. */
  texture(resource: SceneDataResource): WebGPUPluginTexture;

  /** Schedule affected Views to redraw after application-owned asynchronous work. */
  requestRedraw(): void;
}
