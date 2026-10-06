import type {WebGPUPluginTexture} from "./WebGPUPluginTexture";
import type {WebGPUPluginTarget} from "./WebGPUPluginTarget";
import type {WebGPUPluginDrawEncoder} from "./WebGPUPluginDrawEncoder";

/**
 * One host-scheduled transaction. Composition inputs include preceding successful
 * plugins; transparent draws have depth input only. Colour is linear HDR.
 * The host derives ordering from these sequential pass declarations. No fences are exposed.
 */
export interface WebGPUPluginFrame {

  /** Insertion point selected by the host. */
  readonly stage: import("../../../rendering/plugins/RendererPluginStage").RendererPluginStage;

  /** Storage mapping for sampled depth and fragment-depth output. */
  readonly depthEncoding: import("../../../rendering/plugins/RendererPluginDepthEncoding").RendererPluginDepthEncoding;
  /** Output width in physical pixels. */
  readonly width: number;

  /** Output height in physical pixels. */
  readonly height: number;

  /** Opaque-composition colour input; absent for transparent draws. Never aliases the writable composition attachment. */
  readonly sceneColor?: WebGPUPluginTexture;

  /** Immutable scene depth input, sampled with textureLoad. */
  readonly sceneDepth: WebGPUPluginTexture;

  /** Record a pass into an owned intermediate. Clear to transparent black by default. */
  prepare(
    target: WebGPUPluginTarget,
    draw: (encoder: WebGPUPluginDrawEncoder) => void,
    clear?: boolean
  ): void;

  /** Generate a target's mip chain after its preceding writes and before subsequent reads. */
  generateMipmaps(target: WebGPUPluginTarget): void;

  /** Record composition over preserved scene colour/depth. Scene input handles expire afterward. */
  draw(draw: (encoder: WebGPUPluginDrawEncoder) => void): void;
}
