import type {RendererPluginAdapter} from "../../../rendering/plugins/RendererPluginAdapter";
import type {WebGLPluginHost} from "./WebGLPluginHost";
import type {WebGLRepresentationRuntime} from "./WebGLRepresentationRuntime";

/** WebGL2 implementation of one representation type; install through renderer.plugins. */
export interface WebGLRendererPluginAdapter extends RendererPluginAdapter {

  /** Selects the WebGL2 host; WebGPU requires a separate adapter. */
  readonly backend: "webgl2";

  /** Initial public compose-opaque host contract. */
  readonly hostApiVersion: 1;

  /**
   * Creates renderer-owned executable state for one device generation.
   *
   * @param host Tracked allocation and shared-resource services.
   * @returns A runtime reused across instances and Views until teardown/context loss.
   * @throws An initialization error; the host releases partially created allocations.
   */
  create(host: WebGLPluginHost): WebGLRepresentationRuntime;
}
