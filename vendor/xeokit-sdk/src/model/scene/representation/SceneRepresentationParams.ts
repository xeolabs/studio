import type {SceneJsonObject} from "./SceneJsonObject";
import type {SceneRepresentationFallback} from "./SceneRepresentationFallback";

/**
 * Serializable instructions for interpreting scene geometry and numerical resources.
 *
 * Create through {@link SceneModel.createRepresentation}, then bind its ID to one
 * or more meshes. Each mesh supplies placement, visibility and sampled geometry.
 * The definition contains no renderer, View, shader, executable code or GPU handle.
 * Unknown types remain valid scene data and can be exported without a plugin.
 */
export interface SceneRepresentationParams {

  /** Nonempty ID, unique within the owning model's representation collection. */
  id: string;

  /** Application-owned semantic type, matched exactly against a plugin/schema type. */
  type: string;

  /** Positive integer identifying the parameter/resource schema, independent of XGF version. */
  schemaVersion: number;

  /** Finite, acyclic JSON. Creation and updates copy and recursively freeze this object. */
  parameters: SceneJsonObject;

  /** Semantic input names mapped to numerical resource IDs in the same model. Forward references are allowed. */
  resources: Readonly<Record<string, string>>;

  /**
   * Authored spatial extent `[minX, minY, minZ, maxX, maxY, maxZ]` in mesh-local coordinates.
   * Used by spatial queries and bounds fallback. This is not screen-space pass coverage.
   */
  localBounds: readonly [number, number, number, number, number, number];

  /** Presentation when no compatible consumer is available. Defaults to `"bounds"`. */
  fallback?: SceneRepresentationFallback;
}
