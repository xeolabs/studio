/** One alternative object group supplied to the per-View LOD visibility store. */
export interface LODVariantSelection {

  /** Variant ID within the selected group. */
  id: string;

  /** SceneObject IDs participating when this variant is selected. */
  objectIds: readonly string[];
}
