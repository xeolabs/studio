/**
 * Ownership of a mesh with a representation binding.
 *
 * `replace` delegates the mesh's drawing to its representation or fallback.
 * `augment` keeps ordinary geometry rendering and adds the representation using
 * the same placement and object identity. Its fallback never draws a second
 * ordinary copy. Neither mode stores renderer or View state in the Scene.
 */
export type SceneRepresentationMode = "replace" | "augment";
