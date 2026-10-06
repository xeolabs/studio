/** Stable identity of a mesh-bound representation instance; a View is deliberately separate. */
export interface RepresentationInstanceIdentity {

  /** Owning Scene ID. */
  sceneId: string;

  /** Owning SceneModel ID. */
  modelId: string;

  /** Bound mesh ID within the model. */
  meshId: string;
}
