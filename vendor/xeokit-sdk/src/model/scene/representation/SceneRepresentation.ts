import {type SDKResult} from "../../../base/core";
import type {SceneModel} from "../SceneModel";
import type {SceneRepresentationFallback} from "./SceneRepresentationFallback";
import type {SceneRepresentationParams} from "./SceneRepresentationParams";
import {copyRepresentationParams} from "./copyRepresentationParams";

/**
 * Model-owned, revisioned definition of how scene data should be interpreted.
 *
 * Create with {@link SceneModel.createRepresentation}; bind by setting a mesh's
 * representationId. Several meshes may share this definition while retaining
 * independent transforms and animation state. Update through the model so CPU
 * validation, revision changes and consumer notifications remain atomic.
 *
 * This class owns serializable data only. It never creates a renderer or device.
 */
export class SceneRepresentation {

  private params: Readonly<SceneRepresentationParams>;

  private _revision = 0;

  /** Whether the owning model has removed this definition. Do not set directly. */
  destroyed = false;

  /** @internal Construct through SceneModel.createRepresentation. */
  constructor(readonly model: SceneModel, params: SceneRepresentationParams) {
    this.params = copyRepresentationParams(params);
  }

  /** Stable identifier within model.representations. */
  get id() {
    return this.params.id;
  }

  /** Application-owned type matched by schemas and renderer plugins. */
  get type() {
    return this.params.type;
  }

  /** Version of the semantic parameter/resource schema. */
  get schemaVersion() {
    return this.params.schemaVersion;
  }

  /** Deeply frozen parameters. Replace through SceneModel.updateRepresentation. */
  get parameters() {
    return this.params.parameters;
  }

  /** Frozen semantic input names mapped to resource IDs in this model. */
  get resources() {
    return this.params.resources;
  }

  /** Frozen authored local AABB, independent of camera and renderer visibility. */
  get localBounds() {
    return this.params.localBounds;
  }

  /** Authored fallback intent, resolved to bounds when omitted at creation. */
  get fallback(): SceneRepresentationFallback {
    return this.params.fallback!;
  }

  /** Starts at zero and increments after each successful model-mediated update. */
  get revision() {
    return this._revision;
  }

  /**
   * Returns a portable definition with no executable state.
   *
   * @returns A new outer object whose nested values are immutable and safely shared.
   */
  toParams(): SceneRepresentationParams {
    return {...this.params};
  }

  /** @internal Called by the owning model only after atomic validation. */
  _replace(params: Readonly<SceneRepresentationParams>): void {
    this.params = params;
    this._revision++;
  }

  /**
   * Removes this definition through its owning model.
   *
   * @returns Success, or InvalidOperation when a mesh still binds this definition.
   */
  destroy(): SDKResult<void> {
    return this.model.destroyRepresentation(this.id);
  }
}
