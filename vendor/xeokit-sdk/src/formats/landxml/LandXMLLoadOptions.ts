import type {ModelLoadOptions} from "../ModelLoadOptions";

/** Options for the terrain/survey subset of LandXML 1.0, 1.1 and 1.2. */
export interface LandXMLLoadOptions extends ModelLoadOptions {
  /** Reports omitted civil design elements. Defaults to console.warn. */
  onWarning?: (message: string) => void;
}
