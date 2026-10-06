/**
 * # Model LOD Shell Generation
 *
 * The `model.lod` module builds coarse triangle shells from existing
 * {@link model!scene.SceneObject | SceneObject}s and can install those shells
 * as SceneModel variant sets. A shell is generated in model space from
 * source triangle geometry, then referenced by a shell variant in the
 * same SceneModel as the detailed source objects.
 *
 * Shell generation is offline or setup-time work. It does not change scene
 * visibility and does not install any camera-driven switching. Use
 * {@link createShellVariant | createShellVariant} to author variant sets, and
 * {@link viewing!lod.VariantLODSelector | VariantLODSelector}
 * when you want runtime per-view LOD switching over those authored
 * variants.
 *
 * Public callers should normally use {@link ShellGenerator},
 * {@link generateShellFromSceneObjects} or {@link createShellVariant}. Lower-level
 * voxelization and extraction helpers are exported for SDK tests and tooling,
 * but are not part of the stable authored-LOD API.
 *
 * ## Pipeline
 *
 * ```mermaid
 * flowchart TD
 *     A["SceneObject[]"] --> B["collectShellSourceTriangles"]
 *     B --> C["voxelizeShellTriangles"]
 *     C --> D["floodShellExterior"]
 *     D --> E["extractShellMesh"]
 *     E --> F{"surfaceNets?"}
 *     F -- yes --> G["smoothShellMesh"]
 *     F -- no --> H["simplifyShellMesh"]
 *     G --> H
 *     H --> I["ShellGeneratorResult"]
 * ```
 *
 * ## Usage
 *
 * Generate a shell directly from loaded scene objects:
 *
 * ```javascript
 * import {ShellGenerator} from "@xeokit/sdk/model/lod";
 *
 * const generator = new ShellGenerator();
 * const result = generator.generate(objects, {
 *   shellResolution: 64,
 *   extraction: "surfaceNets",
 *   smoothing: {
 *     iterations: 4
 *   },
 *   simplification: {
 *     targetTriangleCount: 5000
 *   }
 * });
 *
 * console.log(result.positions, result.indices, result.stats);
 * ```
 *
 * Reuse collected triangles when comparing multiple shell settings:
 *
 * ```javascript
 * import {
 *   collectShellSourceTriangles,
 *   generateShellFromTriangles
 * } from "@xeokit/sdk/model/lod";
 *
 * const source = collectShellSourceTriangles(objects);
 * const coarse = generateShellFromTriangles(source, {shellResolution: 32});
 * const smooth = generateShellFromTriangles(source, {
 *   shellResolution: 96,
 *   extraction: "surfaceNets"
 * });
 * ```
 *
 * Create a SceneModel variant set from source objects:
 *
 * ```javascript
 * import {createShellVariant} from "@xeokit/sdk/model/lod";
 *
 * const result = createShellVariant({
 *   model: sceneModel,
 *   id: "tower-core-lod",
 *   objectIds: ["wall-01", "slab-01", "column-01"],
 *   generation: {
 *     shellResolution: 64,
 *     extraction: "surfaceNets"
 *   },
 *   selection: {
 *     strategy: "projectedSize",
 *     hysteresisPixels: 16
 *   },
 *   detailedRange: {
 *     minPixels: 128
 *   },
 *   shellRange: {
 *     maxPixels: 96
 *   }
 * });
 * ```
 *
 * @module lod
 * @public
 */
export * from "./ShellGenerationParams";
export * from "./ShellGenerationStats";
export * from "./ShellGenerator";
export * from "./ShellVariant";
export * from "./ShellVariantParams";

export * from "./ShellVariantResult";
export * from "./ShellVariantCreator";
