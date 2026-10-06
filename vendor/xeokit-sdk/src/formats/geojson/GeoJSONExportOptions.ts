import type {ModelExportOptions} from "../ModelExportOptions";

/**
 * Options for {@link GeoJSONExporter.write | GeoJSONExporter.write}.
 */
export interface GeoJSONExportOptions extends ModelExportOptions {

  /**
   * World plane to project into GeoJSON `[x, y]` coordinates.
   *
   * The remaining axis is used as optional GeoJSON elevation when
   * {@link GeoJSONExportOptions.includeElevation | includeElevation} is enabled.
   *
   * Default is `"XY"`.
   */
  projectionPlane?: "XY" | "XZ" | "YZ";

  /**
   * When `true`, writes the remaining projected axis as GeoJSON elevation.
   * When `"auto"`, writes elevation only when the value is non-zero.
   *
   * Default is `"auto"`.
   */
  includeElevation?: boolean | "auto";

  /**
   * Maximum number of decimal places to write for coordinates.
   *
   * Default is `9`.
   */
  decimals?: number;

  /**
   * When `true`, writes a top-level and per-feature `bbox`.
   *
   * Default is `false`.
   */
  includeBbox?: boolean;
}
