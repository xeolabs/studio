import type {DataModel} from "@xeokit/sdk/model/data";
import type {Issue} from "@xeokit/sdk/quality/dataModel/Issue";

export const DATA_REFERENCE_CLEANUPS: Readonly<Record<string, string>> = {
  OBJECT_DUPLICATE_PROPERTY_SET_REF: "Remove repeated references, keeping the first occurrence of each PropertySet. PropertySets and their values are preserved.",
  OBJECT_DANGLING_PROPERTY_SET_REF: "Remove references to missing or stale PropertySets. No replacement data is invented and no live PropertySets are deleted."
};

/** Shared objects are deliberately excluded: a model-scoped repair must not edit another model. */
export function canCleanDataIssue(model: DataModel, issue: Issue): boolean {
  const object = issue.resourceId ? model.objects[issue.resourceId] : null;
  return Object.prototype.hasOwnProperty.call(DATA_REFERENCE_CLEANUPS, issue.code) && !!object && object.models.length === 1 &&
    object.models[0] === model && model.data.objects[object.id] === object;
}

export function applyDataReferenceCleanup(model: DataModel, objectId: string, codes: ReadonlySet<string>): boolean {
  const object = model.objects[objectId];
  if (!object || object.models.length !== 1 || object.models[0] !== model || model.data.objects[objectId] !== object) return false;
  const current = object.propertySets || [];
  const next: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const propertySet of current) {
    if (!propertySet || model.propertySets[propertySet.id] !== propertySet || model.data.propertySets[propertySet.id] !== propertySet) {
      if (!codes.has("OBJECT_DANGLING_PROPERTY_SET_REF")) return false;
      changed = true;
      continue;
    }
    if (seen.has(propertySet.id)) {
      if (!codes.has("OBJECT_DUPLICATE_PROPERTY_SET_REF")) return false;
      changed = true;
      continue;
    }
    seen.add(propertySet.id);
    next.push(propertySet.id);
  }
  if (!changed) return false;
  const result = object.setPropertySetIds(next);
  if (result.ok === false) throw new Error(result.error);
  return true;
}
