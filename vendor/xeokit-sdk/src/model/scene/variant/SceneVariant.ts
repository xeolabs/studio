import type {SceneVariantParams} from "./SceneVariantParams";
import type {SceneVariantRangeParams} from "./SceneVariantRangeParams";
import type {SceneVariantSet} from "./SceneVariantSet";

/**
 * One variant in a {@link SceneVariantSet}.
 *
 * A variant references one or more {@link SceneObject | SceneObjects}
 * that can stand in for the same logical content as the other variants
 * in the same variant set. It is generic metadata: it is not limited to
 * LOD, shells or impostors.
 */
export class SceneVariant {

  /**
   * Variant ID, unique within its variant set.
   */
  public readonly id: string;

  /**
   * The variant set that contains this variant.
   */
  public readonly variantSet: SceneVariantSet;

  /**
   * SceneObject IDs included in this variant.
   */
  public readonly objectIds: string[];

  /**
   * Optional projected-size selection hint.
   */
  public readonly range?: SceneVariantRangeParams;

  /**
   * @private
   */
  constructor(variantSet: SceneVariantSet, params: SceneVariantParams) {
    this.variantSet = variantSet;
    this.id = params.id;
    this.objectIds = params.objectIds.slice();
    this.range = params.range ? {...params.range} : undefined;
  }

  /**
   * Gets this variant as parameters.
   */
  public toParams(): SceneVariantParams {
    return {
      id: this.id,
      objectIds: this.objectIds.slice(),
      range: this.range ? {...this.range} : undefined
    };
  }
}
