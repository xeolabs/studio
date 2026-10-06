import type {ModelParseParams} from "../../../ModelParseParams";
import type {LoaderProgress} from "../../../LoaderProgress";
import {unpackUSDZ} from "../../usdzArchive";
import {detectUSDLayer} from "../../usdLayer";
import {getTinyUSDZ} from "../../getTinyUSDZ";
import {buildSceneModel} from "./buildSceneModel";
import {adaptUSDScene} from "./usdSceneAdapter";
import {detectUSDAnimationSignals, hasLikelyTransformAnimation} from "./usdAnimationSignals";
import {extractUSDAAnimations} from "./extractUSDAAnimations";

/**
 * v1 USDZ parser.
 *
 * Unpacks the USDZ ZIP package, hands the **root USD layer** to the
 * `tinyusdz` wasm reader (which decodes both binary Crate `.usdc` and
 * ASCII `.usda`), then maps the resulting scenegraph onto the SceneModel
 * via {@link buildSceneModel}.
 *
 * Browser-only: `getTinyUSDZ()` throws under Node, since the tinyusdz
 * wasm is built web/worker-only.
 *
 * Textures packaged alongside the root layer are not resolved yet — we
 * feed tinyusdz only the root layer's bytes, not the whole package. When
 * texture support lands, feed the full `.usdz` (tinyusdz resolves
 * in-package assets) or wire an asset resolver onto this archive.
 *
 * @private
 */
export async function parse(params: ModelParseParams, options?: any): Promise<void> {
  const {fileData, sceneModel} = params;
  if (!sceneModel) {
    return;
  }

  const onProgress: ((p: LoaderProgress) => void) | undefined = options?.onProgress;
  onProgress?.({phase: "Loading USDZ", current: 0, total: 1});

  const archive = unpackUSDZ(fileData as ArrayBuffer);
  const root = archive.rootLayerName;
  if (!root) {
    throw new Error(
      `[USDZLoader] no root USD layer (.usdc / .usda / .usd) found in package; ` +
      `entries: ${archive.entries.map(e => e.name).join(", ") || "(none)"}`,
    );
  }
  const rootBytes = archive.byName.get(root) as Uint8Array;
  const kind = detectUSDLayer(rootBytes);
  const animationSignals = detectUSDAnimationSignals(rootBytes);
  const usdaAnimations = kind === "ascii"
    ? extractUSDAAnimations(new TextDecoder().decode(rootBytes))
    : [];

  const Module = await getTinyUSDZ();
  const usd = new Module.TinyUSDZLoaderNative();
  const loaded = usd.loadFromBinary(new Uint8Array(rootBytes), root);
  if (!loaded) {
    const err = typeof usd.error === "function" ? usd.error() : "unknown error";
    throw new Error(`[USDZLoader] tinyusdz failed to parse '${root}' (${kind}): ${err}`);
  }

  const stats = buildSceneModel(withExtractedAnimations(adaptUSDScene(usd), usdaAnimations), sceneModel);
  if (stats.animations === 0 && hasLikelyTransformAnimation(animationSignals)) {
    console.warn(
      `[USDZLoader] '${root}' contains USD time-sampled xform tokens, but the active tinyusdz ` +
      `JS/WASM binding exposed no transform animation channels. Static geometry was imported; ` +
      `USDZ animation playback requires a binding that exposes authored xform time samples.`
    );
  }

  onProgress?.({phase: "Loading USDZ", current: 1, total: 1});

  // eslint-disable-next-line no-console
  console.log(
    `[USDZLoader] loaded '${root}' (${kind}): transforms=${stats.transforms}, ` +
    `geometries=${stats.geometries}, materials=${stats.materials}, meshes=${stats.meshes}, ` +
    `objects=${stats.objects}, animations=${stats.animations}` +
    (stats.failures ? `, failures=${stats.failures}` : ""),
  );
}

function withExtractedAnimations(scene: any, extractedAnimations: any[]): any {
  if (extractedAnimations.length === 0) {
    return scene;
  }
  return {
    ...scene,
    getAnimations: () => {
      const existing = typeof scene.getAnimations === "function" ? scene.getAnimations() : [];
      return [...existing, ...extractedAnimations];
    }
  };
}
