/**
 * <img style="padding:10px" src="https://xeokit.github.io/sdk/docs/assets/xeokit_components_icon.png"/>
 *
 * # USDZ
 *
 * Imports and exports Pixar USDZ (`.usdz`) packages — {@link USDZLoader}
 * reads one into a {@link model!scene.SceneModel | SceneModel};
 * {@link USDZExporter} writes a SceneModel back out.
 *
 * USDZ is an uncompressed ZIP package wrapping a root USD layer (binary
 * "Crate" `.usdc` or ASCII `.usda`) plus its textures. The loader unpacks
 * the ZIP and decodes the root layer with the `tinyusdz` wasm reader; the
 * exporter writes an ASCII `.usda` root layer in a stored, aligned ZIP.
 * USD Xform/Mesh nodes import as `SceneTransform` targets. ASCII USDA
 * rigid-transform time samples and adapter-provided sampled transform
 * channels import as `SceneAnimation` assets, although the bundled
 * `tinyusdz@0.9.1` browser binding currently exposes static binary-USDC
 * transforms but not authored binary time samples.
 *
 * **Loader is browser-only (v1):** the tinyusdz wasm is web/worker-only,
 * so loading throws under Node. The **exporter is pure JS and runs
 * anywhere**, Node included. Packaged textures, USD skinning / variants and
 * tinyusdz-backed time-sample extraction are not handled yet.
 *
 * ```javascript
 * import {USDZLoader, USDZExporter} from "@xeokit/sdk/formats/usdz";
 *
 * const fileData = await (await fetch("model.usdz")).arrayBuffer();
 * const sceneModel = scene.createModel({id: "myModel"}).value;
 * await new USDZLoader().load({fileData, sceneModel});
 *
 * const usdzBytes = await new USDZExporter().write({sceneModel});
 * ```
 *
 * @module usdz
 * @document ./README.md
 */
export {USDZLoader} from "./USDZLoader";
export {USDZExporter} from "./USDZExporter";
