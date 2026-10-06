import type {SceneVariantRangeParams} from "./SceneVariantRangeParams";

/**
 * Parameters for one variant in a {@link SceneVariantSet}.
 *
 * A variant is one alternative object set for the same logical model
 * content. It references {@link SceneObject | SceneObjects}; it does not own
 * them and does not reference raw geometry or mesh resources.
 */
export interface SceneVariantParams {

  /**
   * Variant ID, unique within its variant set.
   */
  id: string;

  /**
   * SceneObject IDs included in this variant.
   */
  objectIds: string[];

  /**
   * Optional projected-size selection hint.
   */
  range?: SceneVariantRangeParams;
}
