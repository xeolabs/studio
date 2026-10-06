/**
 * # collada — COLLADA Interchange
 *
 * Imports and exports COLLADA (`.dae`) files.
 *
 * Native SketchUp `.skp` files are proprietary and require Trimble's SketchUp
 * C SDK or SketchUp itself for supported read/write access. This module keeps
 * that boundary explicit: use {@link ColladaLoader} for `.dae` files, and
 * {@link ColladaExporter} to write `.dae` that SketchUp and other COLLADA
 * tools can import.
 *
 * ```ts
 * import {ColladaLoader} from "@xeokit/sdk/formats/collada";
 *
 * await new ColladaLoader().load({
 *   fileData: await fetch("model.dae").then(r => r.text()),
 *   sceneModel
 * });
 * ```
 */
export * from "./ColladaLoader";
export * from "./ColladaExporter";
