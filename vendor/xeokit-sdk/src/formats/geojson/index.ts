/**
 * # geojson - GeoJSON Importer / Exporter
 *
 * Import and visualize 2D or 2.5D GIS vector features using the
 * {@link https://geojson.org/ | GeoJSON} format.
 *
 * ## Overview
 *
 * {@link GeoJSONLoader} converts GeoJSON features into xeokit scene and data
 * models, while {@link GeoJSONExporter} serializes compatible SceneModel
 * geometry back to a GeoJSON `FeatureCollection`:
 *
 * - `Point` and `MultiPoint` become point primitives.
 * - `LineString` and `MultiLineString` become line primitives.
 * - `Polygon` and `MultiPolygon` become triangulated surface meshes.
 * - `Feature.properties` become a `GeoJSONProperties` property set on the
 *   matching {@link model!data.DataObject | DataObject}.
 *
 * Coordinates are imported in GeoJSON's native XY ground plane:
 * GeoJSON `[x, y, elevation]` becomes xeokit `[x, y, elevation]` after
 * subtracting {@link GeoJSONLoadOptions.origin} and applying
 * {@link GeoJSONLoadOptions.scale}. Use the target
 * {@link model!scene.SceneModel.coordinateSystem | SceneModel.coordinateSystem}
 * when an application wants to place that XY/Z-up data into another scene
 * basis. When no origin is supplied, the loader uses the first coordinate in
 * the file to keep geospatial coordinate magnitudes small.
 *
 * ## Example
 *
 * ```ts
 * import {GeoJSONLoader} from "@xeokit/sdk/formats/geojson";
 * import {Data} from "@xeokit/sdk/model/data";
 * import {Scene} from "@xeokit/sdk/model/scene";
 *
 * const scene = new Scene();
 * const data = new Data();
 * const sceneModel = scene.createModel({id: "site"}).value;
 * const dataModel = data.createModel({id: "site"}).value;
 * const fileData = await fetch("/site.geojson").then(response => response.json());
 *
 * await new GeoJSONLoader().load({fileData, sceneModel, dataModel}, {
 *   scale: 100000,
 *   polygonOpacity: 0.45
 * });
 * ```
 *
 * ## Export Example
 *
 * ```ts
 * import {GeoJSONExporter} from "@xeokit/sdk/formats/geojson";
 *
 * const fileData = await new GeoJSONExporter().write({sceneModel, dataModel}, {
 *   projectionPlane: "XY",
 *   includeBbox: true
 * });
 * ```
 *
 * @module geojson
 */
export * from "./GeoJSONExporter";
export * from "./GeoJSONExportOptions";
export * from "./GeoJSONLoader";
export * from "./GeoJSONLoadOptions";
