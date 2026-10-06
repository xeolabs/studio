import type {Vec3} from "../../base/math/vector";
import type {ModelLoadOptions} from "../ModelLoadOptions";

/**
 * Options for {@link GeoJSONLoader.load}.
 */
export interface GeoJSONLoadOptions extends ModelLoadOptions {

  /**
   * World-space coordinate subtracted from every GeoJSON coordinate before
   * scaling and axis mapping.
   *
   * When omitted, the loader uses the first coordinate in the file. This keeps
   * longitude/latitude-style coordinates numerically close to the origin and
   * avoids avoidable floating-point jitter in renderers.
   */
  origin?: Vec3;

  /**
   * Multiplier applied to source coordinates after origin subtraction.
   *
   * A single number applies the same scale to all axes; a three-element vector
   * applies per-axis scale. The default is `1`.
   */
  scale?: number | Vec3;

  /**
   * Elevation used when a GeoJSON coordinate omits its third ordinate.
   *
   * The default is `0`.
   */
  defaultElevation?: number;

  /**
   * Color used for point features when the feature does not specify a style.
   *
   * The default is `[0.9, 0.2, 0.16]`.
   */
  pointColor?: Vec3;

  /**
   * Color used for line features when the feature does not specify a style.
   *
   * The default is `[0.1, 0.32, 0.82]`.
   */
  lineColor?: Vec3;

  /**
   * Color used for polygon features when the feature does not specify a style.
   *
   * The default is `[0.22, 0.62, 0.36]`.
   */
  polygonColor?: Vec3;

  /**
   * Opacity assigned to polygon fill meshes.
   *
   * The default is `0.55`.
   */
  polygonOpacity?: number;
}
