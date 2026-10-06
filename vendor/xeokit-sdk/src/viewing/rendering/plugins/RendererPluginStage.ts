/**
 * Renderer-owned insertion point for a representation runtime.
 *
 * `compose-opaque` reads completed opaque colour/depth and runs before transparency.
 * `transparent` joins ordinary transparent draws, sorted by the eye-space centre
 * of the representation's authored local bounds. It blends premultiplied linear
 * colour over the scene, tests depth and never writes depth. Sorting is approximate
 * at batch/instance granularity; intersecting volumes are not order independent.
 */
export type RendererPluginStage = "compose-opaque" | "transparent";
