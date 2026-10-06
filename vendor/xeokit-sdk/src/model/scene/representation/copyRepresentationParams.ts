import type {SceneJsonValue} from "./SceneJsonValue";
import type {SceneJsonObject} from "./SceneJsonObject";
import type {SceneRepresentationParams} from "./SceneRepresentationParams";

/** Copies finite JSON and freezes it so callers cannot bypass revisioned updates. */
function copyJson(value: unknown, ancestors = new Set<unknown>()): SceneJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value as SceneJsonValue;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value))
    throw new Error("Representation parameters must be finite, acyclic JSON");
  ancestors.add(value);
  let result: SceneJsonValue;
  if (Array.isArray(value)) {
    result = Object.freeze(value.map((item) => copyJson(item, ancestors)));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("Representation parameters must contain only plain JSON objects");
    }
    const object: Record<string, SceneJsonValue> = Object.create(null);
    for (const [key, item] of Object.entries(value)) object[key] = copyJson(item, ancestors);
    result = Object.freeze(object);
  }
  ancestors.delete(value);
  return result;
}

/** @internal Structural validation never requires a registered plugin. */
export function copyRepresentationParams(
  params: SceneRepresentationParams
): Readonly<SceneRepresentationParams> {
  if (
    typeof params.id !== "string" ||
    !params.id ||
    typeof params.type !== "string" ||
    !params.type ||
    !Number.isSafeInteger(params.schemaVersion) ||
    params.schemaVersion < 1
  ) {
    throw new Error("Representation requires id, type and a positive schemaVersion");
  }
  const b = params.localBounds;
  if (!b || b.length !== 6 || !b.every(Number.isFinite) || b[0] > b[3] || b[1] > b[4] || b[2] > b[5]) {
    throw new Error("Representation localBounds must be a finite ordered AABB");
  }
  if (!params.parameters || Array.isArray(params.parameters) || typeof params.parameters !== "object") {
    throw new Error("Representation parameters must be a JSON object");
  }
  const resources: Record<string, string> = Object.create(null);
  if (!params.resources || typeof params.resources !== "object" || Array.isArray(params.resources))
    throw new Error("Expected resource references");
  for (const [name, id] of Object.entries(params.resources)) {
    if (!name || typeof id !== "string" || !id) throw new Error("Invalid representation resource reference");
    resources[name] = id;
  }
  const fallback = params.fallback ?? "bounds";
  if (!["bounds", "hidden", "standard"].includes(fallback))
    throw new Error("Invalid representation fallback");
  return Object.freeze({
    id: params.id,
    type: params.type,
    schemaVersion: params.schemaVersion,
    parameters: copyJson(params.parameters) as SceneJsonObject,
    resources: Object.freeze(resources),
    localBounds: Object.freeze([...b]) as SceneRepresentationParams["localBounds"],
    fallback,
  });
}
