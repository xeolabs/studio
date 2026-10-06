import type {WebGPURenderBundleLike} from "./WebGPURenderBundleLike";
import type {WebGPURenderPassEncoderLike} from "./WebGPURenderPassEncoderLike";

/** @internal */
export interface WebGPURenderBundleEncoderLike extends WebGPURenderPassEncoderLike {
  finish(descriptor?: object): WebGPURenderBundleLike;
}
