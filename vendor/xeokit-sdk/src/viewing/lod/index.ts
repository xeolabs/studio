/**
 * # Viewing LOD Variant Selection
 *
 * The `viewing.lod` module selects authored SceneModel variants on a
 * per-view basis. It does not generate shell geometry or create SceneModel
 * content. Shells, impostors and other LOD variants are authored in
 * `model.lod` and stored in {@link model!scene.SceneVariantSet | SceneVariantSet}
 * metadata.
 *
 * LOD suppression is separate from ordinary application visibility. Renderers
 * combine both states while drawing:
 *
 * ```text
 * effectiveVisible = applicationVisible && !lodSuppressed
 * ```
 *
 * Use {@link VariantLODSelector} to discover variant sets whose
 * selection metadata uses `"projectedSize"` and select one variant per
 * view.
 *
 * Variant selection is also the fast path for switching visibility of
 * large object groups. Instead of rewriting ordinary object visibility for
 * every object in a variant, the viewer records the selected
 * variant per View and lets renderers suppress non-selected
 * variant memberships at batch or draw-list granularity.
 *
 * ## Runtime Shape
 *
 * ```mermaid
 * classDiagram
 *     direction TB
 *     class VariantLODSelector {
 *       +enabled
 *       +setEnabled(enabled)
 *       +updateView(view)
 *       +updateAllViews()
 *       +getActiveVariantId(view, variantSet)
 *       +clear()
 *       +destroy()
 *     }
 *     class LODVisibility {
 *       +isSuppressed(viewId, objectId)
 *       +setSuppressed(viewId, objectIds, suppressed)
 *       +setSelectedVariant(viewId, selectionId, variants, selectedVariantId)
 *       +getViewVersion(viewId)
 *     }
 *     VariantLODSelector ..> LODVisibility : suppresses non-selected variants
 * ```
 *
 * ## Basic Usage
 *
 * The selector works with variant sets already present in loaded
 * SceneModels. Those sets can be authored offline, generated with
 * {@link model!lod.createShellVariant | model.lod.createShellVariant}, or loaded from a
 * format such as XGF that preserves variant metadata.
 *
 * Create the selector after the Viewer exists:
 *
 * ```ts
 * import {VariantLODSelector} from "@xeokit/sdk/viewing/lod";
 *
 * const selector = new VariantLODSelector({
 *   viewer
 * });
 * ```
 *
 * The selector discovers eligible variant sets automatically. A set is
 * eligible when its selection metadata uses the projected-size strategy:
 *
 * ```ts
 * sceneModel.createVariantSet({
 *   id: "floor3",
 *   defaultVariantId: "detailed",
 *
 *   selection: {
 *     strategy: "projectedSize",
 *     hysteresisPixels: 16
 *   },
 *
 *   variants: [
 *     {
 *       id: "detailed",
 *       objectIds: [
 *         "wall1",
 *         "wall2",
 *         "slab1"
 *       ],
 *       range: {
 *         minPixels: 160
 *       }
 *     },
 *     {
 *       id: "shell",
 *       objectIds: [
 *         "__floor3_shell"
 *       ],
 *       range: {
 *         maxPixels: 128
 *       }
 *     }
 *   ]
 * });
 * ```
 *
 * After the set exists, camera and viewport changes update selection for each
 * View. Applications normally do not need to call `updateView()` manually.
 *
 * ## Loading a Model With Variants
 *
 * For a model format that restores SceneModel variant sets, create the
 * selector once and load the model normally:
 *
 * ```ts
 * const selector = new VariantLODSelector({viewer});
 *
 * const sceneModel = scene.createModel({
 *   id: "hospital"
 * }).value;
 *
 * await xgfLoader.load({
 *   fileData,
 *   sceneModel
 * });
 *
 * // Newly loaded variant sets are discovered automatically.
 * ```
 *
 * ## Inspecting Selection
 *
 * Use `getActiveVariantId()` when UI or diagnostics need to show what a View is
 * currently using:
 *
 * ```ts
 * const variantSet = sceneModel.variantSets["floor3"];
 * const activeVariantId = selector.getActiveVariantId(view, variantSet);
 * const mode = selector.getMode(view, variantSet);
 *
 * console.log(activeVariantId, mode);
 * ```
 *
 * `getMode()` returns:
 *
 * - `"default"` when the set's default variant is selected,
 * - `"selected"` when another variant is selected,
 * - `"invalid"` when the set cannot currently be evaluated.
 *
 * ## Enable, Disable and Destroy
 *
 * Disabling the selector clears only selector-owned variant suppression.
 * It does not change ordinary object visibility:
 *
 * ```ts
 * selector.setEnabled(false); // all variants are unsuppressed again
 * selector.setEnabled(true);  // selection resumes
 *
 * selector.destroy();         // clears suppression and removes event handlers
 * ```
 *
 * ## Multiple Views
 *
 * Selection state is per View. Two Views can show different variants of
 * the same SceneModel at the same time:
 *
 * ```ts
 * const nearView = viewer.viewList[0];
 * const farView = viewer.viewList[1];
 * const variantSet = sceneModel.variantSets["floor3"];
 *
 * selector.updateView(nearView);
 * selector.updateView(farView);
 *
 * console.log(selector.getActiveVariantId(nearView, variantSet)); // "detailed"
 * console.log(selector.getActiveVariantId(farView, variantSet));  // "shell"
 * ```
 *
 * @module lod
 */
export * from "./LODVisibility";
export * from "./VariantLODSelector";
export * from "./VariantLODSelectorParams";

export * from "./LODVariantSelection";
export * from "./LODVariantMembership";
export * from "./LODSuppressionDelta";
export * from "./LODSuppressionDeltas";
export * from "./VariantLODMode";
