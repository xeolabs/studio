import type {SceneJsonObject} from "./SceneJsonObject";

/**
 * Portable representation parameter value. Numbers must be finite; arrays and
 * plain objects must be acyclic. Functions, undefined and typed arrays are rejected.
 * Store large numerical payloads in {@link SceneDataResource} instead.
 */
export type SceneJsonValue = null | boolean | number | string | SceneJsonObject | readonly SceneJsonValue[];
