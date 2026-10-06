/** One change to explicit object suppression in a View. */
export interface LODSuppressionDelta {

  /** SceneObject IDs whose explicit suppression changed. */
  objectIds: readonly string[];

  /** Whether those objects are now suppressed by LOD visibility. */
  suppressed: boolean;
}
