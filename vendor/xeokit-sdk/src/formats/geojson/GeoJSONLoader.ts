import {ModelLoader} from "../ModelLoader";
import {parse as parse_1_0_0} from "./versions/v1_0/parse";

/**
 * Loads GeoJSON into a {@link model!scene.SceneModel | SceneModel} and/or a
 * {@link model!data.DataModel | DataModel}.
 *
 * The loader supports `FeatureCollection`, `Feature`, geometry objects and
 * `GeometryCollection` members. Point and MultiPoint geometries become point
 * primitives, LineString and MultiLineString geometries become line primitives,
 * and Polygon and MultiPolygon geometries become triangulated surface meshes.
 *
 * For detailed usage, refer to {@link formats!geojson | @xeokit/sdk/formats/geojson}.
 */
export class GeoJSONLoader extends ModelLoader {

  /**
   * Constructs a GeoJSONLoader.
   */
  constructor() {
    super({
      format: "GeoJSON",
      fileDataType: "json",
      parsers: {
        "1.0.0": parse_1_0_0
      },
      getVersion: (): string => "1.0.0"
    });
    this.fileNameExtensions = ["geojson", "json"];
  }
}
