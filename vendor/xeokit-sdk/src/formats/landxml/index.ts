/**
 * LandXML terrain/survey interchange: reads 1.0/1.1/1.2 and writes 1.2.
 *
 * ```ts
 * await new LandXMLLoader().load({fileData: xmlText, sceneModel, dataModel});
 * const xml = await new LandXMLExporter().write({sceneModel, dataModel});
 * ```
 *
 * Supports explicit TIN faces, CgPoints and straight PlanFeature segments.
 * Converts northing/easting/elevation to XYZ; declared linear units are honored.
 * File coordinates are converted into the target SceneModel coordinate system.
 * Geographic CRS descriptions are preserved in source property sets, not reprojected.
 * Export uses Z-up meters by default; names are taken from matching DataObjects.
 * Import requires DOMParser or an XML Document (install a DOMParser polyfill in Node).
 * Unsupported civil design elements produce warnings. Export is reconstructed terrain
 * geometry, not a lossless civil design round trip; analytic alignments, breakline
 * constraints, materials and animation are not preserved.
 *
 * @module landxml
 */
export {LandXMLLoader} from "./LandXMLLoader";
export {LandXMLExporter} from "./LandXMLExporter";
export type {LandXMLLoadOptions} from "./LandXMLLoadOptions";
export type {LandXMLExportOptions} from "./LandXMLExportOptions";
