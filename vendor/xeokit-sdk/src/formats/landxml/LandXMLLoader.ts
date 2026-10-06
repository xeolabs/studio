import {ModelLoader} from "../ModelLoader";
import type {ModelLoadParams} from "../ModelLoadParams";
import type {LandXMLLoadOptions} from "./LandXMLLoadOptions";
import {parse} from "./parse";

/** Imports TIN surfaces, CgPoints and straight PlanFeature linework; other civil elements produce warnings. */
export class LandXMLLoader extends ModelLoader {
  constructor() {
    super({format: "LandXML", fileDataType: "text", parsers: {"1": parse}, getVersion: () => "1"});
  }
  /** Text parsing requires DOMParser (native in browsers; supply a polyfill in Node). */
  load(params: ModelLoadParams, options: LandXMLLoadOptions = {}): Promise<void> {
    return super.load(params, options);
  }
}
