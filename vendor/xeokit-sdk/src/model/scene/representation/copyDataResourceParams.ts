import type {SceneDataResourceParams} from "./SceneDataResourceParams";
import {validateDataResourceParams} from "./validateDataResourceParams";

/** @internal Validates metadata and copies the authored payload exactly once. */
export function copyDataResourceParams(params: SceneDataResourceParams): SceneDataResourceParams {
  validateDataResourceParams(params);
  return {...params, data: params.data.slice()} as SceneDataResourceParams;
}
