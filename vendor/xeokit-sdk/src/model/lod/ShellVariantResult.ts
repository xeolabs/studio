import type {SceneGeometry, SceneMaterial, SceneMesh, SceneObject, SceneVariantSet} from "../scene";
import type {ShellGeneratorResult} from "./ShellGenerator";

/**
 * Result from creating a shell variant set.
 *
 * @public
 */
export interface ShellVariantResult {
  /**
   * Generated shell data.
   */
  shell: ShellGeneratorResult;

  /**
   * Created variant set.
   */
  variantSet: SceneVariantSet;

  /**
   * Generated shell geometry.
   */
  geometry: SceneGeometry;

  /**
   * Generated shell mesh.
   */
  mesh: SceneMesh;

  /**
   * Generated shell SceneObject.
   */
  object: SceneObject;

  /**
   * Shell material. This might be an existing material reused by ID.
   */
  material: SceneMaterial;
}
