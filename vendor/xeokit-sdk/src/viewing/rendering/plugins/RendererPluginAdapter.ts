/**
 * Backend-neutral identity of an executable adapter, owned by an application.
 * Concrete backends extend this contract with their public host/runtime boundary.
 * Never store an adapter in SceneModel data or serialize it into XGF.
 */
export interface RendererPluginAdapter {

  /** Exact backend identifier, for example `webgl2`. */
  readonly backend: string;

  /** Version of the host/runtime contract, independent of the scene schema version. */
  readonly hostApiVersion: 1;
}
