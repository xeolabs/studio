import {ModelExporter} from "../ModelExporter";
import type {ModelExportParams} from "../ModelExportParams";
import type {LandXMLExportOptions} from "./LandXMLExportOptions";
import {encode} from "./encode";

/** Writes LandXML 1.2 TIN surfaces, survey points and straight PlanFeatures. */
export class LandXMLExporter extends ModelExporter {
  constructor() {
    super({format: "LandXML", fileDataType: "text", defaultVersion: "1.2", encoders: {"1.2": encode}});
  }
  /** Returns XML text. Analytic alignments, design history, materials and animation are not exported. */
  write(params: ModelExportParams, options: LandXMLExportOptions = {}): Promise<string> {
    return super.write(params, options);
  }
}
