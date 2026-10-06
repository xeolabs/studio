import type {ModelExportOptions} from "../ModelExportOptions";

/** Writes Z-up easting/northing geometry as LandXML northing/easting/elevation. */
export interface LandXMLExportOptions extends ModelExportOptions {
  /** Output linear unit. Defaults to meter. No geographic CRS reprojection is performed. */
  linearUnit?: "meter" | "millimeter" | "foot" | "USSurveyFoot";
  /** Optional CRS description, written verbatim; this does not reproject coordinates. */
  coordinateSystemName?: string;
}
