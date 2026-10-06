import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {SceneModel} from "../SceneModel";
import {SceneVariant} from "./SceneVariant";
import type {SceneVariantSetParams} from "./SceneVariantSetParams";
import type {SceneVariantSetSelectionParams} from "./SceneVariantSetSelectionParams";

/**
 * A variant set in a {@link SceneModel}.
 *
 * A variant set declares alternative variants of the same logical
 * content. It stores metadata only: it does not own referenced SceneObjects and
 * does not store the currently active variant.
 */
export class SceneVariantSet {

  /**
   * Variant set ID, unique within its SceneModel.
   */
  public readonly id: string;

  /**
   * SceneModel that owns this variant set.
   */
  public readonly model: SceneModel;

  /**
   * Variants in this variant set, keyed by variant ID.
   */
  public readonly variants: {[id: string]: SceneVariant} = {};

  /**
   * ID of the default variant.
   */
  public readonly defaultVariantId: string;

  /**
   * Optional declarative selection metadata.
   */
  public readonly selection?: SceneVariantSetSelectionParams;

  /**
   * True after this variant set has been destroyed.
   */
  public destroyed = false;

  /**
   * @private
   */
  constructor(model: SceneModel, params: SceneVariantSetParams) {
    this.model = model;
    this.id = params.id;
    this.defaultVariantId = params.defaultVariantId;
    this.selection = params.selection ? {...params.selection} : undefined;
    for (let i = 0, len = params.variants.length; i < len; i++) {
      const variant = new SceneVariant(this, params.variants[i]);
      this.variants[variant.id] = variant;
    }
  }

  /**
   * Gets the default variant.
   */
  public get defaultVariant(): SceneVariant {
    return this.variants[this.defaultVariantId];
  }

  /**
   * Gets this variant set as parameters.
   */
  public toParams(): SceneVariantSetParams {
    return {
      id: this.id,
      defaultVariantId: this.defaultVariantId,
      selection: this.selection ? {...this.selection} : undefined,
      variants: Object.keys(this.variants).map((id) => this.variants[id].toParams())
    };
  }

  /**
   * Destroys this variant set.
   *
   * Referenced SceneObjects are not destroyed.
   */
  public destroy(): SDKResult<void> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneVariantSet.destroy] SceneVariantSet already destroyed"
      });
    }
    this.model._destroyVariantSet(this);
    this.destroyed = true;
    return {
      ok: true,
      value: undefined
    };
  }
}
