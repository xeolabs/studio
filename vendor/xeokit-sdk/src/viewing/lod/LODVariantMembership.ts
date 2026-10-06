/** Cached membership shared by renderer meshes or batches. */
export interface LODVariantMembership {

  /** ID of the selection rule controlling this membership. */
  selectionId: string;

  /** Variants in that rule that contain these objects. */
  variantIds: readonly string[];
}
