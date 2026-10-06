import {ModelExporter} from "../ModelExporter";
import {encode as encode_1_0} from "./versions/v1_0/encode";

/**
 * Exports a {@link model!scene.SceneModel | SceneModel} and optional
 * {@link model!data.DataModel | DataModel} as a GeoJSON `FeatureCollection`.
 *
 * Point meshes become `Point` or `MultiPoint` geometries, line meshes become
 * `LineString` or `MultiLineString` geometries, and triangle meshes become
 * `Polygon` or `MultiPolygon` geometries made from their triangle faces.
 *
 * For detailed usage, refer to {@link formats!geojson | @xeokit/sdk/formats/geojson}.
 */
export class GeoJSONExporter extends ModelExporter {

  /**
   * Constructs a GeoJSONExporter.
   */
  constructor() {
    super({
      format: "GeoJSON",
      fileDataType: "json",
      encoders: {
        "1.0": encode_1_0
      },
      defaultVersion: "1.0"
    });
  }
}
