/**
 * Projected-size range hint for a variant.
 *
 * This metadata is declarative. It does not select a variant by itself;
 * viewing-layer code can use it later when a variant set declares a
 * projected-size selection strategy.
 */
export interface SceneVariantRangeParams {

  /**
   * Minimum projected size, in pixels, for which this variant is a
   * candidate.
   */
  minPixels?: number;

  /**
   * Maximum projected size, in pixels, for which this variant is a
   * candidate.
   */
  maxPixels?: number;
}
