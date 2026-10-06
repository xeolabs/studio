import type {RepresentationSchema} from "../../../model/scene/representation/RepresentationSchema";
import type {RendererPluginAdapter} from "./RendererPluginAdapter";

/**
 * Application-installed consumer for one semantic representation type.
 * Register on renderer.plugins. Each renderer creates its own device runtime;
 * definitions may be shared, but must not hold singleton mutable GPU state.
 */
export interface RendererPluginDefinition {

  /** CPU validator used before runtime capability validation. */
  readonly schema: RepresentationSchema;

  /** Backend implementations; an absent compatible adapter produces safe fallback. */
  readonly adapters: readonly RendererPluginAdapter[];
}
