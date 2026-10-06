/**
 * Declarative selection hints for a variant set.
 *
 * The model stores this metadata only. It does not store the active
 * variant, because different views can choose different variants
 * at the same time.
 */
export interface SceneVariantSetSelectionParams {

  /**
   * Selection strategy name.
   *
   * `"projectedSize"` means the variant ranges describe projected
   * screen size thresholds.
   */
  strategy: "projectedSize";

  /**
   * Optional hysteresis width in pixels used by projected-size selection.
   */
  hysteresisPixels?: number;
}
