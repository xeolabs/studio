import type {RendererPluginAdapter} from "../../../rendering/plugins/RendererPluginAdapter";
import type {WebGPUPluginHost} from "./WebGPUPluginHost";
import type {WebGPURepresentationRuntime} from "./WebGPURepresentationRuntime";

/** Application-supplied implementation of a scene representation for WebGPURenderer. */
export interface WebGPURendererPluginAdapter extends RendererPluginAdapter {
  readonly backend: "webgpu";

  readonly hostApiVersion: 1;

  /** Create device resources. Registration.ready settles after asynchronous pipeline validation. */
  create(host: WebGPUPluginHost): WebGPURepresentationRuntime | Promise<WebGPURepresentationRuntime>;
}
