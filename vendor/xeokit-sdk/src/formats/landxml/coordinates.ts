import type {CoordinateSystemParams} from "../../model/scene";

/** LandXML ordinate order is northing/easting/elevation; geometry is easting/northing/elevation. @internal */
export function landXMLCoordinates(linearUnit: string): CoordinateSystemParams {
  const units: Record<string, Pick<CoordinateSystemParams, "units" | "scaleToMeters">> = {
    meter: {units: "meters", scaleToMeters: 1},
    millimeter: {units: "millimeters", scaleToMeters: 0.001},
    centimeter: {units: "meters", scaleToMeters: 0.01},
    kilometer: {units: "meters", scaleToMeters: 1000},
    foot: {units: "feet", scaleToMeters: 0.3048},
    USSurveyFoot: {units: "feet", scaleToMeters: 1200 / 3937},
    inch: {units: "inches", scaleToMeters: 0.0254}
  };
  const unit = units[linearUnit];
  if (!unit) throw new Error(`[LandXML] Unsupported linearUnit '${linearUnit}'`);
  return {basis: [1, 0, 0, 0, 0, 1, 0, 1, 0], origin: [0, 0, 0], ...unit};
}
