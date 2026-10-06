import type {Viewer} from "../viewer";

/**
 * Parameters for {@link VariantLODSelector}.
 */
export interface VariantLODSelectorParams {
  /**
   * Viewer whose attached Scene contains SceneModel variant sets.
   */
  viewer: Viewer;

  /**
   * Initial enabled state.
   *
   * When disabled, all LOD suppression managed by the selector is cleared.
   *
   * Default is `true`.
   */
  enabled?: boolean;
}
