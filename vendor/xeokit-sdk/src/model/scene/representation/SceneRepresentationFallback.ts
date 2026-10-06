/**
 * Authored fallback intent when a consumer cannot interpret a representation.
 *
 * - `"bounds"`: show an inspectable proxy for its authored spatial extent (default).
 * - `"hidden"`: omit this instance from rendering and picking.
 * - `"standard"`: render the bound source geometry normally, explicitly opting in
 *   because that geometry may otherwise be semantically misleading.
 *
 * This is portable scene data. A consumer reports the policy it can actually apply.
 */
export type SceneRepresentationFallback = "bounds" | "hidden" | "standard";
