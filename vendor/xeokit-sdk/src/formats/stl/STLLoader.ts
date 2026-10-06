import {ModelLoader} from "../ModelLoader";
import type {ModelLoadParams} from "../ModelLoadParams";
import type {ModelLoadOptions} from "../ModelLoadOptions";
import {parse} from "./parse";

/** Loads binary or ASCII STL. Units are caller-defined because STL does not encode units. */
export class STLLoader extends ModelLoader {
  constructor() {
    super({format: "STL", fileDataType: "arraybuffer", parsers: {"1": parse}, getVersion: () => "1"});
  }

  /** Accepts ASCII text, ArrayBuffer or an ArrayBuffer view. */
  load(params: ModelLoadParams, options: ModelLoadOptions = {}): Promise<void> {
    let fileData = params?.fileData;
    if (typeof fileData === "string") fileData = new TextEncoder().encode(fileData).buffer;
    else if (ArrayBuffer.isView(fileData)) fileData = new Uint8Array(new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength)).buffer;
    return super.load({...params, fileData}, options);
  }
}
