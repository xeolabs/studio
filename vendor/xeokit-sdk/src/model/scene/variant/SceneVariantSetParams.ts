import type {SceneVariantSetSelectionParams} from "./SceneVariantSetSelectionParams";
import type {SceneVariantParams} from "./SceneVariantParams";

/**
 * Parameters for a variant set in a {@link SceneModel}.
 *
 * A variant set groups alternative object collections for the same logical
 * content. The variant IDs are model/application defined; names such as
 * `"detailed"`, `"shell"` or `"impostor"` have no built-in meaning.
 */
export interface SceneVariantSetParams {

  /**
   * Variant set ID, unique within its SceneModel.
   */
  id: string;

  /**
   * ID of the variant to use when no selection policy applies.
   */
  defaultVariantId: string;

  /**
   * Alternative variants in this variant set.
   */
  variants: SceneVariantParams[];

  /**
   * Optional declarative selection metadata.
   */
  selection?: SceneVariantSetSelectionParams;
}
