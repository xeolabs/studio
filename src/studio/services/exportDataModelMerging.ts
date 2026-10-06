import type {DataModel, DataModelParams, DataObjectParams, PropertySetParams, RelationshipParams} from "@xeokit/sdk/model/data";

/** Union of models from one Data. Globally shared semantic IDs must not be namespaced. */
export function mergeDataModelParams(sourceParams: DataModelParams[], dataModels: DataModel[]): DataModelParams {
  if (sourceParams.length !== dataModels.length || dataModels.some(model => model.data !== dataModels[0].data)) {
    throw new Error("Export merging requires matching source DataModels from the same Data.");
  }
  const objects = new Map<string, DataObjectParams>();
  const propertySets = new Map<string, PropertySetParams>();
  const relationships = new Map<string, RelationshipParams>();

  // Data enforces compatible definitions for shared objects/property sets. Keep
  // each once: createObject/createPropertySet reject duplicates within one model.
  for (const params of sourceParams) {
    for (const propertySet of params.propertySets || []) {
      if (!propertySets.has(propertySet.id)) propertySets.set(propertySet.id, {...propertySet});
    }
    for (const object of params.objects || []) {
      const existing = objects.get(object.id);
      if (!existing) {
        objects.set(object.id, {...object, propertySetIds: object.propertySetIds?.slice()});
      } else {
        // toParams filters these references to sets owned by that source model.
        existing.propertySetIds = [...new Set([...(existing.propertySetIds || []), ...(object.propertySetIds || [])])];
      }
    }
    for (const relationship of params.relationships || []) {
      const key = JSON.stringify([relationship.type, relationship.schema, relationship.relatingObjectId, relationship.relatedObjectId]);
      if (!relationships.has(key)) relationships.set(key, {...relationship});
    }
  }

  const schema = dataModels[0]?.schema;
  return {
    id: "merged-data-export",
    schema: dataModels.every(model => model.schema === schema) ? schema : undefined,
    propertySets: [...propertySets.values()],
    objects: [...objects.values()],
    relationships: [...relationships.values()]
  };
}
