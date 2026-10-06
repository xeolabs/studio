import type {WebGPUPluginPipeline} from "./WebGPUPluginPipeline";
import type {WebGPUPluginBuffer} from "./WebGPUPluginBuffer";
import type {WebGPUPluginBinding} from "./WebGPUPluginBinding";

/**
 * Records a draw list without access to a live GPU pass, device or queue.
 * Commands are discarded if the plugin callback throws. Do not retain this encoder.
 */
export interface WebGPUPluginDrawEncoder {
  /** Select a validated pipeline and bind its complete group-zero resource list. */
  setPipeline(pipeline: WebGPUPluginPipeline, bindings: readonly WebGPUPluginBinding[]): void;

  /** Bind a vertex/instance stream. Offset must be four-byte aligned. */
  setVertexBuffer(slot: number, buffer: WebGPUPluginBuffer, offset?: number): void;

  /** Bind unsigned integer indices with a suitably aligned byte offset. */
  setIndexBuffer(buffer: WebGPUPluginBuffer, format: "uint16" | "uint32", offset?: number): void;

  /** Record a non-indexed draw. Counts must be nonnegative integers. */
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;

  /** Record an indexed draw. The pipeline must have an index buffer bound. */
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number
  ): void;
}
