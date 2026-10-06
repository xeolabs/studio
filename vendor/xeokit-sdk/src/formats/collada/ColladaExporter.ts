import {ModelExporter} from "../ModelExporter";
import {encode as encode_1_0} from "./versions/v1_0/encode";

/**
 * Exports a {@link model!scene.SceneModel | SceneModel} as
 * COLLADA (`.dae`) text.
 *
 * Native `.skp` writing is intentionally not implemented in TypeScript. Use
 * the SketchUp C SDK or SketchUp's importer to convert the emitted `.dae` to
 * `.skp` when a native file is required.
 */
export class ColladaExporter extends ModelExporter {
  constructor() {
    super({
      format: "COLLADA",
      fileDataType: "text",
      encoders: {
        "1.0": encode_1_0
      },
      defaultVersion: "1.0"
    });
  }
}
