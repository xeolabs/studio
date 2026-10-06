import type {SDKResult} from "../../../base/core";
import type {SceneModel} from "../SceneModel";
import type {SceneResourceArray} from "./SceneResourceArray";
import type {SceneDataResourceParams} from "./SceneDataResourceParams";
import {copyDataResourceParams} from "./copyDataResourceParams";

/**
 * Persistent CPU numerical data shared by representations in one SceneModel.
 *
 * Create through {@link SceneModel.createDataResource}. The model owns the copied
 * payload; GPU uploads, sampling and device recovery belong to its consumers.
 * Replacing values through the model preserves identity and increments revision,
 * allowing each consumer to refresh a shared upload once rather than per instance.
 */
export class SceneDataResource {

  private params: SceneDataResourceParams;

  private _revision = 0;

  /** Whether the owning model has removed this resource. Do not set directly. */
  destroyed = false;

  /** @internal Construct through SceneModel.createDataResource. */
  constructor(readonly model: SceneModel, params: SceneDataResourceParams) {
    this.params = copyDataResourceParams(params);
  }

  /** Stable ID within model.dataResources. */
  get id() {
    return this.params.id;
  }

  /** CPU layout discriminator, independent of any GPU representation. */
  get kind() {
    return this.params.kind;
  }

  /** Starts at zero; increments only after a successful replacement. */
  get revision() {
    return this._revision;
  }

  /**
   * Borrowed CPU storage, readonly by contract; typed arrays cannot be deeply frozen.
   * Never mutate this array or its underlying buffer. Use model.updateDataResource
   * to validate replacements and notify consumers. Use toParams for a writable copy.
   */
  get data(): Readonly<SceneResourceArray> {
    return this.params.data;
  }

  /** A new metadata object describing layout without copying the numerical payload. */
  get descriptor(): Readonly<
    | Omit<
        Extract<
          SceneDataResourceParams,
          {

            kind: "buffer";
          }
        >,
        "data"
      >
    | Omit<
        Extract<
          SceneDataResourceParams,
          {

            kind: "texture2d";
          }
        >,
        "data"
      >
  > {
    const {data, ...descriptor} = this.params;
    return descriptor;
  }

  /** @returns A portable descriptor and an independent, writable copy of its typed array. */
  toParams(): SceneDataResourceParams {
    return copyDataResourceParams(this.params);
  }

  /** @internal Transfers an already copied, validated replacement from the model. */
  _replaceFrom(resource: SceneDataResource): void {
    this.params = resource.params;
    this._revision++;
  }

  /** @returns Success, or InvalidOperation while any representation still references this resource. */
  destroy(): SDKResult<void> {
    return this.model.destroyDataResource(this.id);
  }
}
