import {ModelExporter} from "../ModelExporter";
import {encode} from "./encode";

/**
 * Exports stored triangle geometry to STL, baking parent and mesh transforms.
 * `write({sceneModel, version: "ascii"})` selects ASCII; default is `"binary"`.
 * Both variants return an ArrayBuffer. STL carries no units, identities, materials or animation.
 */
export class STLExporter extends ModelExporter {
  constructor() {
    super({format: "STL", fileDataType: "arraybuffer", defaultVersion: "binary", encoders: {
      binary: (params, options) => encode(params, options, false),
      ascii: (params, options) => encode(params, options, true)
    }});
  }
}
