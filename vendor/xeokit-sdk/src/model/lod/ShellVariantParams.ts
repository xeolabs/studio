import type {Vec3} from "../../base/math/vector";
import type {
  SceneModel,
  SceneVariantRangeParams,
  SceneVariantSetSelectionParams
} from "../scene";
import type {ShellGenerationParams} from "./ShellGenerationParams";
import type {ShellGenerator} from "./ShellGenerator";

/**
 * Parameters for creating a shell variant set in a SceneModel.
 *
 * The created variant set has two variants:
 *
 * - a detailed variant referencing the supplied source SceneObjects
 * - a shell variant referencing one generated shell SceneObject
 *
 * All referenced SceneObjects belong to the same SceneModel. The helper does
 * not create cross-model variant sets.
 *
 * @public
 */
export interface ShellVariantParams {
  /**
   * SceneModel that owns the source objects, generated shell object and
   * resulting variant set.
   */
  model: SceneModel;

  /**
   * Variant set ID to create.
   */
  id: string;

  /**
   * Source SceneObject IDs for the detailed variant.
   */
  objectIds: string[];

  /**
   * Optional shell generator. Defaults to a new {@link ShellGenerator}.
   */
  generator?: ShellGenerator;

  /**
   * Shell generation settings.
   */
  generation?: ShellGenerationParams;

  /**
   * ID for the detailed variant.
   *
   * Default is `"detailed"`.
   */
  detailedVariantId?: string;

  /**
   * ID for the shell variant.
   *
   * Default is `"shell"`.
   */
  shellVariantId?: string;

  /**
   * Declarative selection hints for the created variant set.
   */
  selection?: SceneVariantSetSelectionParams;

  /**
   * Projected-size range for the detailed variant.
   */
  detailedRange?: SceneVariantRangeParams;

  /**
   * Projected-size range for the shell variant.
   */
  shellRange?: SceneVariantRangeParams;

  /**
   * ID for the generated shell geometry.
   *
   * Default is `"shellGeometry:${id}"`.
   */
  shellGeometryId?: string;

  /**
   * ID for the generated shell mesh.
   *
   * Default is `"shellMesh:${id}"`.
   */
  shellMeshId?: string;

  /**
   * ID for the generated shell SceneObject.
   *
   * Default is `"shellObject:${id}"`.
   */
  shellObjectId?: string;

  /**
   * ID for the shell material.
   *
   * Default is `"shellMaterial"`.
   */
  shellMaterialId?: string;

  /**
   * Shell material/mesh color.
   *
   * Default is `[0.72, 0.76, 0.78]`.
   */
  shellColor?: Vec3;

  /**
   * Shell material/mesh opacity.
   *
   * Default is `1`.
   */
  shellOpacity?: number;
}
