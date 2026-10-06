import type {SceneJsonValue} from "./SceneJsonValue";

/** Readonly JSON dictionary; parameter names and meanings belong to its representation schema. */
export interface SceneJsonObject {

  /** A finite JSON value; nested values are frozen when accepted by the model. */
  readonly [key: string]: SceneJsonValue;
}
