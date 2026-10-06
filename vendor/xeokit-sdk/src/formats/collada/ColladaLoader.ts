import {ModelLoader} from "../ModelLoader";
import {parse as parse_1_0} from "./versions/v1_0/parse";

/**
 * Loads COLLADA (`.dae`) assets into a
 * {@link model!scene.SceneModel | SceneModel} and/or
 * {@link model!data.DataModel | DataModel}.
 */
export class ColladaLoader extends ModelLoader {
  constructor() {
    super({
      format: "COLLADA",
      fileDataType: "text",
      parsers: {
        "1.0": parse_1_0
      },
      getVersion: (fileData: any): string => {
        if (fileData instanceof ArrayBuffer) {
          throw new Error("[ColladaLoader] Native .skp ArrayBuffer input is not supported; load a COLLADA .dae export instead.");
        }
        const text = String(fileData || "").trimStart();
        if (/^<\?xml[\s\S]*<COLLADA\b|^<COLLADA\b/.test(text)) {
          return "1.0";
        }
        throw new Error("[ColladaLoader] Unsupported input. Expected COLLADA .dae text; native .skp requires SketchUp or the SketchUp C SDK.");
      }
    });
  }
}
