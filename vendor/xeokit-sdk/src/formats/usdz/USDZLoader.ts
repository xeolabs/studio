import {ModelLoader} from "../ModelLoader";
import {isUSDZ} from "./usdzArchive";
import {parse as parse_1_0} from "./versions/v1/parse";

/**
 * Loads Pixar USDZ (`.usdz`) packages into a
 * {@link model!scene.SceneModel | SceneModel}.
 *
 * Unpacks the USDZ ZIP package and decodes its root USD layer — binary
 * Crate (`.usdc`) or ASCII (`.usda`) — with the `tinyusdz` wasm reader,
 * producing geometry, `SceneTransform`s and UsdPreviewSurface materials.
 * ASCII USDA `xformOp:* .timeSamples` for rigid transforms are mapped to
 * `SceneAnimation` assets targeting the imported transforms. When another
 * USD scene adapter exposes sampled transform channels, those are mapped
 * through the same path. The bundled `tinyusdz@0.9.1` browser binding
 * currently exposes static binary-USDC transforms but not authored binary
 * time samples.
 *
 * **Browser only (v1):** the tinyusdz wasm is built web/worker-only, so
 * loading throws under Node (CLI / headless). Packaged textures, USD
 * skinning / variants and tinyusdz-backed time-sample extraction are not
 * handled yet — see the module docs.
 */
export class USDZLoader extends ModelLoader {

  /**
   * Constructs a USDZLoader.
   */
  constructor() {
    super({
      format: "usdz",
      fileDataType: "arraybuffer",
      parsers: {
        "1.0": parse_1_0,
      },
      getVersion: (fileData: any): string => isUSDZ(fileData) ? "1.0" : "",
    });
  }
}
