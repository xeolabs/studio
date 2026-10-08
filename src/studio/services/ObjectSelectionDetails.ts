import type {AABB3} from "@xeokit/sdk/base/math/boundaries";
import {collapseAABB3, createAABB3Float64, expandAABB3Point3} from "@xeokit/sdk/base/math/boundaries";
import {transformPoint3} from "@xeokit/sdk/base/math/matrix";
import type {Data, DataObject, PropertySet} from "@xeokit/sdk/model/data";
import type {Scene, SceneObject} from "@xeokit/sdk/model/scene";

export interface ObjectPropertyRow {
  readonly name: string;
  readonly value: string;
  readonly setName: string;
  readonly setId: string;
}

export interface ObjectSelectionDetails {
  readonly sceneObjectId: string;
  readonly sceneObjectName: string;
  readonly dataObjectId: string;
  readonly meshCount: number;
  readonly title: string;
  readonly type: string;
  readonly schema: string;
  readonly description: string;
  readonly floors: Array<{id: string; name: string}>;
  readonly propertyRows: ObjectPropertyRow[];
  readonly aabb: AABB3 | null;
}

export class ObjectSelectionDetailsResolver {
  readonly data: Data;
  readonly scene: Scene;

  private readonly _dataObjectsByOriginalSystemId = new Map<string, DataObject>();
  private readonly _unsubscribers: Array<() => void> = [];

  constructor(params: {data: Data; scene: Scene}) {
    this.data = params.data;
    this.scene = params.scene;
    this._rebuildOriginalSystemIdIndex();
    this._unsubscribers.push(
      this.data.events.onDataObjectCreated.subscribe(() => this._rebuildOriginalSystemIdIndex()),
      this.data.events.onDataObjectDestroyed.subscribe(() => this._rebuildOriginalSystemIdIndex())
    );
  }

  destroy(): void {
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
    this._dataObjectsByOriginalSystemId.clear();
  }

  resolveSceneObject(sceneObjectId: string): ObjectSelectionDetails | null {
    const sceneObject = this.scene.objects[sceneObjectId];
    if (!sceneObject) {
      return null;
    }
    const dataObject = this._findDataObject(sceneObjectId);
    return {
      sceneObjectId,
      sceneObjectName: getSceneObjectTitle(sceneObject),
      dataObjectId: dataObject?.id || "",
      meshCount: sceneObject.meshes.length,
      title: dataObject?.name || getSceneObjectTitle(sceneObject),
      type: dataObject?.type || "SceneObject",
      schema: dataObject?.schema || "",
      description: dataObject?.description || "",
      floors: dataObject ? collectFloors(dataObject) : [],
      propertyRows: dataObject ? collectPropertyRows(dataObject.propertySets || []) : [],
      aabb: getSceneObjectAABB(sceneObject)
    };
  }

  /** Name lookup for lists/minimaps, without collecting inspector properties or mesh bounds. */
  resolveSceneObjectTitle(sceneObjectId: string): string {
    return this._findDataObject(sceneObjectId)?.name || sceneObjectId;
  }

  private _findDataObject(sceneObjectId: string): DataObject | null {
    return this.data.objects[sceneObjectId] || this._dataObjectsByOriginalSystemId.get(sceneObjectId) || null;
  }

  private _rebuildOriginalSystemIdIndex(): void {
    this._dataObjectsByOriginalSystemId.clear();
    for (const dataObject of Object.values(this.data.objects)) {
      if (dataObject.originalSystemId) {
        this._dataObjectsByOriginalSystemId.set(dataObject.originalSystemId, dataObject);
      }
    }
  }
}

/** Follow spatial parents only: classifications and type links do not assign floors. */
function collectFloors(object: DataObject): Array<{id: string; name: string}> {
  const floors = new Map<string, {id: string; name: string}>();
  const visited = new Set<DataObject>();
  const queue = [object];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (visited.has(current)) continue;
    visited.add(current);
    if (current.type === "IfcBuildingStorey") {
      floors.set(current.id, {id: current.id, name: current.name || current.id});
      continue;
    }
    // In the SDK, `relating` holds incoming relationships to this object.
    for (const type of ["IfcRelContainedInSpatialStructure", "IfcRelAggregates", "IfcRelNests"]) {
      for (const relationship of current.relating?.[type] || []) {
        queue.push(relationship.relatingObject);
      }
    }
  }
  return [...floors.values()];
}

function collectPropertyRows(propertySets: readonly PropertySet[]): ObjectPropertyRow[] {
  const rows: ObjectPropertyRow[] = [];
  for (const propertySet of propertySets) {
    for (const property of propertySet.properties) {
      rows.push({
        setId: propertySet.id,
        setName: propertySet.name || propertySet.type || propertySet.id,
        name: property.name,
        value: formatValue(property.value)
      });
    }
  }
  return rows;
}

function getSceneObjectTitle(sceneObject: SceneObject): string {
  return sceneObject.id || "SceneObject";
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getSceneObjectAABB(sceneObject: SceneObject): AABB3 | null {
  const aabb = collapseAABB3(createAABB3Float64());
  let found = false;
  for (const mesh of sceneObject.meshes) {
    const geometryAABB = mesh.geometry.aabb;
    if (!geometryAABB) {
      continue;
    }
    expandTransformedAABB(aabb, geometryAABB, mesh.worldMatrix);
    found = true;
  }
  return found ? aabb : null;
}

function expandTransformedAABB(target: AABB3, source: AABB3, matrix: any): void {
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        tempPoint[0] = source[ix ? 3 : 0];
        tempPoint[1] = source[iy ? 4 : 1];
        tempPoint[2] = source[iz ? 5 : 2];
        transformPoint3(matrix, tempPoint as any, tempPoint as any);
        expandAABB3Point3(target, tempPoint as any);
      }
    }
  }
}

const tempPoint = new Float64Array(3);
