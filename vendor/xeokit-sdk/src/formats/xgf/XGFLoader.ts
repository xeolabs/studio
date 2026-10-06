import {ModelLoader} from "../ModelLoader";
import {parse as parseV1} from "./versions/v1/parse";
import {parse as parseV2} from "./versions/v2/parse";
import {parse as parseV3} from "./versions/v3/parse";

/**
 * Loads an XGF file into a {@link model!scene.SceneModel | SceneModel} and/or a {@link model!data.DataModel | DataModel}.
 *
 * XGF v2 can restore fixed-topology geometry frames and per-mesh
 * `frameTime`. Geometry frame data is loaded once into
 * {@link model!scene.SceneGeometry | SceneGeometry}; each
 * {@link model!scene.SceneMesh | SceneMesh} then samples that shared frame
 * sequence independently through its mesh-local `frameTime`.
 *
 * XGF3 additionally restores scene representations, binary numerical resources and
 * mesh bindings. Plugin code is installed by the application, never read from XGF.
 *
 * For detailed usage, refer to {@link formats!xgf | @xeokit/sdk/formats/xgf}.
 */
export class XGFLoader extends ModelLoader {

  constructor() {
    super({
      format: "XGF",
      fileDataType: "arraybuffer",
      parsers: {
        "1": parseV1,
        "2": parseV2,
        "3": parseV3
      },
      getVersion: (fileData: any): string => "" + new DataView(fileData).getUint32(0, true)
    });
  }
}
