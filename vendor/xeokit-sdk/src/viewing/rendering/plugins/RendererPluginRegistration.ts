import {type SDKResult} from "../../../base/core";

/** Handle returned by RendererPluginRegistry.register after accepting a definition. */
export interface RendererPluginRegistration {

  /** Semantic type; pass to unregister to remove this consumer. */
  type: string;

  /**
   * Resolves once the attached backend initializes the runtime, or with an SDK
   * failure on unsupported backend, initialization failure or cancellation.
   * Registration before Viewer attachment remains pending until attachment.
   * This describes runtime initialization, not support for every instance/View.
   */
  ready: Promise<SDKResult<void>>;
}
