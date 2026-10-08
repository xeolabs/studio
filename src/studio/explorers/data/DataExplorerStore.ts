import type {Data, DataModel, DataObject, PropertySet, Relationship} from "@xeokit/sdk/model/data";
import {treeSearchEntries} from "../tree/treeSearchEntries";
import {PagedTreeCollection, indexTreeCollection, recordKeys, arrayKeys, type TreeCollectionSource} from "../tree/PagedTreeCollection";
import {PagedTreeState, type TreeBranchState} from "../tree/PagedTreeState";
import {naturalCompare} from "../tree/naturalCompare";
import {ExplorerRefreshQueue} from "../tree/ExplorerRefreshQueue";
import {displayedTreeNodes} from "../tree/displayedTreeNodes";
import {summarizeVisibility, type VisibilitySummary} from "../tree/visibilitySummary";
import {collapseAABB3, createAABB3Float64, expandAABB3Point3, type AABB3} from "@xeokit/sdk/base/math/boundaries";
import {transformPoint3} from "@xeokit/sdk/base/math/matrix";
import type {Scene, SceneObject} from "@xeokit/sdk/model/scene";
import {StudioCameraFlight as CameraFlightAnimation} from "../../services/StudioCameraFlight";
import type {View} from "@xeokit/sdk/viewing/viewer";

export type DataExplorerNodeKind =
  | "data"
  | "model"
  | "folder"
  | "typeGroup"
  | "object"
  | "propertySet"
  | "relationship"
  | "property";

export type DataExplorerFolderKind =
  | "rootObjects"
  | "objectsByType"
  | "objectsOfType"
  | "propertySets"
  | "relationships"
  | "objectPropertySets"
  | "relatingRelationships"
  | "relatedRelationships"
  | "properties";

export interface DataExplorerNodeState extends Partial<VisibilitySummary> {
  id: string;
  kind: DataExplorerNodeKind;
  title: string;
  detail: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  childrenLoaded: boolean;
  children: DataExplorerNodeState[];
  childCount: number;
  pageIndex: number;
  modelId?: string;
  componentId?: string;
  folderKind?: DataExplorerFolderKind;
  relationshipIndex?: number;
  relationshipSide?: "relating" | "related";
  typeName?: string;
  visible: boolean;
  hasViewObject: boolean;
}

export interface DataExplorerState {
  roots: DataExplorerNodeState[];
  busy: boolean;
  revision: number;
}

export interface DataExplorerStoreParams {
  data: Data;
  scene?: Scene;
  view?: View;
  makeReactive?: <T extends object>(value: T) => T;
  confirmDeleteModel?: (modelId: string) => boolean | Promise<boolean>;
}

interface DataExplorerNodeSpec {
  id: string;
  kind: DataExplorerNodeKind;
  title: string;
  detail?: string;
  modelId?: string;
  componentId?: string;
  folderKind?: DataExplorerFolderKind;
  relationshipIndex?: number;
  relationshipSide?: "relating" | "related";
  typeName?: string;
  hasChildren?: boolean;
}

const MODEL_FOLDER_LABELS: Record<DataExplorerFolderKind, string> = {
  rootObjects: "Root Objects",
  objectsByType: "Objects By Type",
  objectsOfType: "Objects",
  propertySets: "Property Sets",
  relationships: "Relationships",
  objectPropertySets: "Property Sets",
  relatingRelationships: "Incoming Relationships",
  relatedRelationships: "Outgoing Relationships",
  properties: "Properties"
};

const tempPoint = new Float64Array(3);

export class DataExplorerStore {
  readonly data: Data;
  readonly scene: Scene | null;
  readonly view: View | null;
  state: DataExplorerState = {
    roots: [],
    busy: false,
    revision: 0
  };

  private readonly _nodes = new Map<string, DataExplorerNodeState>();
  private readonly _collections = new Map<string, PagedTreeCollection<DataExplorerNodeSpec>>();
  private readonly _pages = new PagedTreeState({
    roots: () => this.state.roots, nodes: this._nodes,
    children: (node: DataExplorerNodeState) => this._getCollection(node) || this._getChildSpecs(node),
    create: (spec: DataExplorerNodeSpec, depth: number) => this._getOrCreateNode(spec, depth),
    sync: (node: DataExplorerNodeState) => this._syncObjectNode(node), touch: () => this._touch()
  });
  get pageSize(): number { return this._pages.pageSize; }
  private _disposed = false;
  private readonly _refreshQueue = new ExplorerRefreshQueue({
    structure: () => this._populateRoots(),
    state: () => this._syncAllObjectNodes()
  });
  private readonly _unsubscribers: Array<() => void> = [];
  private readonly _makeReactive?: <T extends object>(value: T) => T;
  private readonly _confirmDeleteModel?: (modelId: string) => boolean | Promise<boolean>;
  private readonly _cameraFlight: CameraFlightAnimation | null = null;
  private _applyingVisibility = 0;
  private _defaultExpansionApplied = false;

  constructor(params: DataExplorerStoreParams) {
    this.data = params.data;
    this.scene = params.scene || null;
    this.view = params.view || null;
    this._makeReactive = params.makeReactive;
    this._confirmDeleteModel = params.confirmDeleteModel;
    if (this._makeReactive) {
      this.state = this._makeReactive(this.state);
    }
    if (this.view) {
      this._cameraFlight = new CameraFlightAnimation(this.view, {duration: 0.45});
    }
    this._populateRoots();
    this._subscribe();
  }

  destroy(): void {
    this._disposed = true;
    this._refreshQueue.dispose();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
    this._cameraFlight?.destroy();
    this._nodes.clear();
    this._collections.clear();
    this._pages.dispose();
    this.state.roots.splice(0);
  }

  getNode(nodeId: string): DataExplorerNodeState | null {
    return this._nodes.get(nodeId) || null;
  }

  getSearchEntries() {
    return treeSearchEntries<DataExplorerNodeSpec>(this.state.roots, (node) => this._iterateChildSpecs(node),
      (node) => node.kind === "data" || node.kind === "model" || node.kind === "typeGroup" ||
        (node.kind === "folder" && ["objectsByType", "propertySets", "relationships"].includes(node.folderKind || "")),
      (node) => node.kind === "object" ? `DataObject ${this.data.objects[node.componentId || ""]?.type || ""}` : node.title);
  }

  getObjectPath(objectId: string): string[] | null {
    for (const model of Object.values(this.data.models)) {
      const object = model.objects[objectId];
      if (!object) continue;
      const modelId = nodeId("model", model.id, "data");
      const folderId = nodeId("folder", "objectsByType", modelId);
      const typeId = nodeId("typeGroup", String(object.type), folderId);
      return ["data", modelId, folderId, typeId, nodeId("object", objectId, typeId)];
    }
    return null;
  }

  setPage(node: DataExplorerNodeState, page: number): void { if (!this._disposed) this._pages.setPage(node, page); }
  revealChild(node: DataExplorerNodeState, id: string): void { if (!this._disposed) this._pages.revealChild(node, id); }
  captureBranchStates(): Map<string, TreeBranchState> { return this._pages.capture(); }
  restoreBranchStates(states: ReadonlyMap<string, TreeBranchState>): void { this._pages.restore(states); }

  async toggleExpanded(node: DataExplorerNodeState): Promise<void> {
    if (!node.hasChildren) {
      return;
    }
    node.expanded = !node.expanded;
    if (node.expanded && !node.childrenLoaded) {
      this.state.busy = true;
      node.loading = true;
      await nextFrame();
      if (this._disposed) return;
      this._loadChildren(node);
      node.loading = false;
      this.state.busy = false;
    }
    if (node.expanded) this._syncAllObjectNodes();
    this._touch();
  }

  toggleObjectVisibility(node: DataExplorerNodeState): void {
    if (node.kind !== "object" || !node.componentId || !this.view?.objects[node.componentId]) {
      return;
    }
    const nextVisible = !this.view.objects[node.componentId].visible;
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible([node.componentId], nextVisible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncObjectNode(node);
    this._touch();
  }

  setObjectVisibility(node: DataExplorerNodeState, visible: boolean): void {
    if (node.kind !== "object" || !node.componentId || !this.view?.objects[node.componentId]) {
      return;
    }
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible([node.componentId], visible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncObjectNode(node);
    this._touch();
  }

  toggleModelVisibility(node: DataExplorerNodeState): void {
    if (node.kind !== "model" || !node.modelId || !this.view) {
      return;
    }
    const objectIds = this._getModelViewObjectIds(node.modelId);
    if (objectIds.length === 0) {
      return;
    }
    const anyVisible = objectIds.some((objectId) => this.view!.objects[objectId]?.visible);
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible(objectIds, !anyVisible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncAllObjectNodes();
  }

  setModelVisibility(node: DataExplorerNodeState, visible: boolean): void {
    if (node.kind !== "model" || !node.modelId || !this.view) {
      return;
    }
    const objectIds = this._getModelViewObjectIds(node.modelId);
    if (objectIds.length === 0) {
      return;
    }
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible(objectIds, visible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncAllObjectNodes();
  }

  toggleTypeVisibility(node: DataExplorerNodeState): void {
    if (node.kind !== "typeGroup" || !node.modelId || !node.typeName || !this.view) {
      return;
    }
    const objectIds = this._getTypeViewObjectIds(node.modelId, node.typeName);
    if (objectIds.length === 0) {
      return;
    }
    const anyVisible = objectIds.some((objectId) => this.view!.objects[objectId]?.visible);
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible(objectIds, !anyVisible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncAllObjectNodes();
  }

  setTypeVisibility(node: DataExplorerNodeState, visible: boolean): void {
    if (node.kind !== "typeGroup" || !node.modelId || !node.typeName || !this.view) {
      return;
    }
    const objectIds = this._getTypeViewObjectIds(node.modelId, node.typeName);
    if (objectIds.length === 0) {
      return;
    }
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible(objectIds, visible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncAllObjectNodes();
  }

  fitObject(node: DataExplorerNodeState): void {
    if (node.kind !== "object" || !node.componentId || !this.view?.objects[node.componentId] || !this.scene || !this._cameraFlight) {
      return;
    }
    const sceneObject = this.scene.objects[node.componentId];
    const aabb = sceneObject ? getSceneObjectAABB(sceneObject) : null;
    if (!aabb) {
      return;
    }
    this._cameraFlight.flyTo({
      aabb,
      fitFOV: 45,
      duration: 0.45,
      arc: true
    });
  }

  fitModel(node: DataExplorerNodeState): void {
    if (node.kind !== "model" || !node.modelId || !this.scene || !this._cameraFlight) {
      return;
    }
    const aabb = this._getModelAABB(node.modelId);
    if (!aabb) {
      return;
    }
    this._cameraFlight.flyTo({
      aabb,
      fitFOV: 45,
      duration: 0.45,
      arc: true
    });
  }

  fitType(node: DataExplorerNodeState): void {
    if (node.kind !== "typeGroup" || !node.modelId || !node.typeName || !this.scene || !this._cameraFlight) {
      return;
    }
    const aabb = this._getTypeAABB(node.modelId, node.typeName);
    if (!aabb) {
      return;
    }
    this._cameraFlight.flyTo({
      aabb,
      fitFOV: 45,
      duration: 0.45,
      arc: true
    });
  }

  async confirmAndDeleteModel(node: DataExplorerNodeState): Promise<void> {
    if (node.kind !== "model" || !node.modelId) {
      return;
    }
    const confirmed = this._confirmDeleteModel
      ? await this._confirmDeleteModel(node.modelId)
      : globalThis.confirm(`Delete DataModel "${node.modelId}"? This cannot be undone.`);
    if (confirmed) {
      this.deleteModel(node);
    }
  }

  deleteModel(node: DataExplorerNodeState): void {
    if (node.kind !== "model" || !node.modelId) {
      return;
    }
    this.data.models[node.modelId]?.destroy();
  }

  private _populateRoots(): void {
    const spec: DataExplorerNodeSpec = {
      id: "data",
      kind: "data",
      title: "Data",
      detail: `${Object.keys(this.data.models).length} model${Object.keys(this.data.models).length === 1 ? "" : "s"}`,
      hasChildren: Object.keys(this.data.models).length > 0
    };
    const root = this._getOrCreateNode(spec, 0);
    this.state.roots.splice(0, this.state.roots.length, root);
    this._applyDefaultExpansion(root);
    this._refreshMaterializedChildren();
    this._touch();
  }

  private _loadChildren(node: DataExplorerNodeState): void {
    this._pages.load(node);
  }

  private _applyDefaultExpansion(root: DataExplorerNodeState): void {
    if (this._defaultExpansionApplied || Object.keys(this.data.models).length === 0) {
      return;
    }
    root.expanded = true;
    if (!root.childrenLoaded) {
      this._loadChildren(root);
    }
    const firstModelNode = root.children.find((child) => child.kind === "model");
    if (!firstModelNode) {
      return;
    }
    firstModelNode.expanded = true;
    if (!firstModelNode.childrenLoaded) {
      this._loadChildren(firstModelNode);
    }
    this._defaultExpansionApplied = true;
  }

  private _getOrCreateNode(spec: DataExplorerNodeSpec, depth: number): DataExplorerNodeState {
    let node = this._nodes.get(spec.id);
    if (node) {
      updateNode(node, spec, depth);
      this._syncObjectNode(node);
      return node;
    }
    node = {
      id: spec.id,
      kind: spec.kind,
      title: spec.title,
      detail: spec.detail || "",
      depth,
      hasChildren: !!spec.hasChildren,
      expanded: false,
      loading: false,
      childrenLoaded: false,
      children: [],
      childCount: 0,
      pageIndex: 0,
      modelId: spec.modelId,
      componentId: spec.componentId,
      folderKind: spec.folderKind,
      relationshipIndex: spec.relationshipIndex,
      relationshipSide: spec.relationshipSide,
      typeName: spec.typeName,
      visible: false,
      hasViewObject: false
    };
    if (this._makeReactive) {
      node = this._makeReactive(node);
    }
    this._nodes.set(spec.id, node);
    this._syncObjectNode(node);
    return node;
  }

  private _getChildSpecs(node: DataExplorerNodeSpec): DataExplorerNodeSpec[] {
    if (node.kind === "data") {
      return sortByTitle(Object.values(this.data.models).map((model) => modelSpec(model, "data")));
    }
    if (!node.modelId) {
      return [];
    }
    const model = this.data.models[node.modelId];
    if (!model) {
      return [];
    }
    if (node.kind === "model") {
      return modelFolderSpecs(model, node.id);
    }
    if (node.kind === "object") {
      const object = this.data.objects[node.componentId || ""];
      return object ? objectChildSpecs(model, object, node.id) : [];
    }
    if (node.kind === "propertySet") {
      const propertySet = this.data.propertySets[node.componentId || ""];
      return propertySet ? propertySetChildSpecs(model, propertySet, node.id) : [];
    }
    if (node.kind === "relationship") {
      const relationship = getRelationship(model, node);
      return relationship ? relationshipChildSpecs(model, relationship, node.id) : [];
    }
    return [];
  }

  private _refreshMaterializedChildren(): void {
    this._pages.refresh();
  }

  private _getCollection(node: DataExplorerNodeSpec): PagedTreeCollection<DataExplorerNodeSpec> | null {
    const cached = this._collections.get(node.id);
    if (cached) return cached;
    const source = this._collectionSource(node);
    if (!source) return null;
    const collection = indexTreeCollection(source);
    this._collections.set(node.id, collection);
    return collection;
  }

  private _collectionSource(node: DataExplorerNodeSpec): TreeCollectionSource<DataExplorerNodeSpec> | null {
    const model = node.modelId && this.data.models[node.modelId];
    return model && (node.kind === "folder" || node.kind === "typeGroup") ? folderCollectionSource(model, node) : null;
  }

  private *_iterateChildSpecs(node: DataExplorerNodeSpec): Generator<DataExplorerNodeSpec> {
    const source = this._collectionSource(node);
    if (source) { for (const key of source.keys()) yield source.describe(key); }
    else yield* this._getChildSpecs(node);
  }

  private _subscribe(): void {
    const refresh = () => { this._collections.clear(); this._refreshQueue.request("structure"); };
    const refreshViewObjects = (view: View) => {
      if (view === this.view) {
        this._refreshQueue.request("state");
      }
    };
    this._unsubscribers.push(
      this.data.events.onDataModelCreated.subscribe(refresh),
      this.data.events.onDataModelDestroyed.subscribe(refresh),
      this.data.events.onDataObjectCreated.subscribe(refresh),
      this.data.events.onDataObjectDestroyed.subscribe(refresh),
      this.data.events.onDataObjectUpdated.subscribe(refresh),
      this.data.events.onRelationshipCreated.subscribe(refresh),
      this.data.events.onRelationshipDestroyed.subscribe(refresh),
      this.data.events.onPropertySetCreated.subscribe(refresh),
      this.data.events.onPropertySetDestroyed.subscribe(refresh)
    );
    const viewerEvents = this.view?.viewer?.events;
    if (viewerEvents) {
      this._unsubscribers.push(
        viewerEvents.onViewObjectCreated.subscribe(refreshViewObjects),
        viewerEvents.onViewObjectDestroyed.subscribe(refreshViewObjects),
        viewerEvents.onViewObjectVisibleChanged.subscribe((view: View) => {
          if (view === this.view && this._applyingVisibility === 0) {
            this._refreshQueue.request("state");
          }
        })
      );
    }
  }

  private _syncObjectNode(node: DataExplorerNodeState): void {
    if (node.kind === "model" && node.modelId && this.view) {
      const objectIds = this._getModelViewObjectIds(node.modelId);
      node.hasViewObject = objectIds.length > 0;
      Object.assign(node, summarizeVisibility(objectIds, this.view.objects));
      node.visible = node.visibleCount > 0;
      return;
    }
    if (node.kind === "typeGroup" && node.modelId && node.typeName && this.view) {
      const objectIds = this._getTypeViewObjectIds(node.modelId, node.typeName);
      node.hasViewObject = objectIds.length > 0;
      Object.assign(node, summarizeVisibility(objectIds, this.view.objects));
      node.visible = node.visibleCount > 0;
      return;
    }
    if (node.kind !== "object" || !node.componentId || !this.view) {
      node.hasViewObject = false;
      node.visible = false;
      return;
    }
    const viewObject = this.view.objects[node.componentId];
    Object.assign(node, summarizeVisibility([node.componentId], this.view.objects));
    node.hasViewObject = !!viewObject;
    node.visible = !!viewObject?.visible;
  }

  private _getModelViewObjectIds(modelId: string): string[] {
    const model = this.data.models[modelId];
    if (!model || !this.view) {
      return [];
    }
    return Object.keys(model.objects).filter((objectId) => !!this.view!.objects[objectId]);
  }

  getTypeViewObjectIds(node: DataExplorerNodeState): string[] {
    if (node.kind !== "typeGroup" || !node.modelId || !node.typeName) {
      return [];
    }
    return this._getTypeViewObjectIds(node.modelId, node.typeName);
  }

  private _getTypeViewObjectIds(modelId: string, typeName: string): string[] {
    const model = this.data.models[modelId];
    if (!model || !this.view) {
      return [];
    }
    return Object.keys(model.objectsByType[typeName] || {}).filter((objectId) => !!this.view!.objects[objectId]);
  }

  private _getModelAABB(modelId: string): AABB3 | null {
    const model = this.data.models[modelId];
    if (!model || !this.scene) {
      return null;
    }
    return getObjectsAABB(Object.keys(model.objects), this.scene);
  }

  private _getTypeAABB(modelId: string, typeName: string): AABB3 | null {
    const model = this.data.models[modelId];
    if (!model || !this.scene) {
      return null;
    }
    return getObjectsAABB(Object.keys(model.objectsByType[typeName] || {}), this.scene);
  }

  private _syncAllObjectNodes(): void {
    for (const node of displayedTreeNodes(this.state.roots)) {
      this._syncObjectNode(node);
    }
  }

  private _touch(): void {
    this.state.revision++;
  }
}

function updateNode(node: DataExplorerNodeState, spec: DataExplorerNodeSpec, depth: number): void {
  node.kind = spec.kind;
  node.title = spec.title;
  node.detail = spec.detail || "";
  node.depth = depth;
  node.hasChildren = !!spec.hasChildren;
  node.modelId = spec.modelId;
  node.componentId = spec.componentId;
  node.folderKind = spec.folderKind;
  node.relationshipIndex = spec.relationshipIndex;
  node.relationshipSide = spec.relationshipSide;
  node.typeName = spec.typeName;
}

function modelSpec(model: DataModel, parentId: string): DataExplorerNodeSpec {
  return {
    id: nodeId("model", model.id, parentId),
    kind: "model",
    title: "DataModel",
    detail: `${model.id}${model.schema ? ` - ${model.schema}` : ""}`,
    modelId: model.id,
    componentId: model.id,
    hasChildren: true
  };
}

function modelFolderSpecs(model: DataModel, parentId: string): DataExplorerNodeSpec[] {
  return [
    folderSpec(model, parentId, "rootObjects", Object.keys(model.rootObjects).length),
    folderSpec(model, parentId, "objectsByType", Object.keys(model.objectsByType).length),
    folderSpec(model, parentId, "propertySets", Object.keys(model.propertySets).length),
    folderSpec(model, parentId, "relationships", model.relationships.length)
  ];
}

function folderSpec(model: DataModel, parentId: string, folderKind: DataExplorerFolderKind, count: number): DataExplorerNodeSpec {
  return {
    id: nodeId("folder", folderKind, parentId),
    kind: "folder",
    title: MODEL_FOLDER_LABELS[folderKind],
    detail: `${count}`,
    modelId: model.id,
    folderKind,
    hasChildren: count > 0
  };
}

function folderCollectionSource(model: DataModel, node: DataExplorerNodeSpec): TreeCollectionSource<DataExplorerNodeSpec> | null {
  const parentId = node.id;
  const objects = node.kind === "typeGroup" ? model.objectsByType[node.typeName || ""] || {}
    : node.folderKind === "rootObjects" ? model.rootObjects : null;
  if (objects) {
    const label = (id: string) => { const o = objects[id]; return `${o.name || o.description || o.originalSystemId || o.id} - ${o.type}`; };
    return {keys: () => recordKeys(objects), describe: id => objectSpec(model, objects[id], parentId),
      nodeId: id => nodeId("object", id, parentId), compare: (a, b) => naturalCompare(label(a), label(b)) || naturalCompare(a, b)};
  }
  if (node.folderKind === "objectsByType") {
    return {keys: () => recordKeys(model.objectsByType), nodeId: name => nodeId("typeGroup", name, parentId), compare: naturalCompare,
      describe: typeName => ({
      id: nodeId("typeGroup", typeName, parentId),
      kind: "typeGroup",
      title: typeName,
      detail: `${Object.keys(model.objectsByType[typeName]).length}`,
      modelId: model.id,
      typeName,
      hasChildren: Object.keys(model.objectsByType[typeName]).length > 0
    })};
  }
  if (node.folderKind === "propertySets") {
    const sets = model.propertySets;
    const label = (id: string) => `${sets[id].name || id} - ${sets[id].type}`;
    return {keys: () => recordKeys(sets), describe: id => propertySetSpec(model, sets[id], parentId),
      nodeId: id => nodeId("propertySet", id, parentId), compare: (a, b) => naturalCompare(label(a), label(b)) || naturalCompare(a, b)};
  }
  if (node.folderKind === "relationships") {
    return {keys: () => arrayKeys(model.relationships), describe: key => relationshipSpec(model, model.relationships[Number(key)], Number(key), parentId),
      nodeId: key => relationshipNodeId(model.relationships[Number(key)], Number(key), parentId)};
  }
  if (node.folderKind === "objectPropertySets") {
    const object = node.componentId ? model.data.objects[node.componentId] : null;
    const sets = object?.propertySets || [];
    const label = (key: string) => { const set = sets[Number(key)]; return `${set.name || set.id} - ${set.type}`; };
    return {keys: () => arrayKeys(sets), describe: key => propertySetSpec(model, sets[Number(key)], parentId),
      nodeId: key => nodeId("propertySet", sets[Number(key)].id, parentId), compare: (a, b) => naturalCompare(label(a), label(b)) || naturalCompare(sets[Number(a)].id, sets[Number(b)].id)};
  }
  if (node.folderKind === "properties") {
    const propertySet = node.componentId ? model.data.propertySets[node.componentId] : null;
    const properties = propertySet?.properties || [];
    const id = (key: string) => nodeId("property", `${key}:${properties[Number(key)].name}`, parentId);
    return {keys: () => arrayKeys(properties), nodeId: id, describe: key => {
      const property = properties[Number(key)];
      return {id: id(key),
      kind: "property" as const,
      title: property.name,
      detail: `${formatValue(property.value)}${property.valueType !== undefined ? ` (${property.valueType})` : ""}`,
      modelId: model.id,
      hasChildren: false
    }; }};
  }
  if (node.folderKind === "relatingRelationships" || node.folderKind === "relatedRelationships") {
    const object = node.componentId ? model.data.objects[node.componentId] : null;
    const groups = node.folderKind === "relatingRelationships" ? object?.relating : object?.related;
    const relationships = Object.values(groups || {}).flat();
    const indices = new Map(model.relationships.map((relationship, index) => [relationship, index]));
    const index = (key: string) => indices.get(relationships[Number(key)]) ?? Number(key);
    return {keys: () => arrayKeys(relationships), describe: key => relationshipSpec(model, relationships[Number(key)], index(key), parentId),
      nodeId: key => relationshipNodeId(relationships[Number(key)], index(key), parentId)};
  }
  return null;
}

function objectSpec(model: DataModel, object: DataObject, parentId: string): DataExplorerNodeSpec {
  const label = object.name || object.description || object.originalSystemId || object.id;
  return {
    id: nodeId("object", object.id, parentId),
    kind: "object",
    title: "DataObject",
    detail: `${label} - ${object.type}`,
    modelId: model.id,
    componentId: object.id,
    hasChildren: true
  };
}

function objectChildSpecs(model: DataModel, object: DataObject, parentId: string): DataExplorerNodeSpec[] {
  const specs: DataExplorerNodeSpec[] = [
    propertySpec(model, parentId, "ID", object.id),
    propertySpec(model, parentId, "Original System ID", object.originalSystemId || "none"),
    propertySpec(model, parentId, "Name", object.name || "none"),
    propertySpec(model, parentId, "Description", object.description || "none"),
    propertySpec(model, parentId, "Type", object.type),
    propertySpec(model, parentId, "Schema", object.schema || "none")
  ];
  const propertySetCount = object.propertySets?.length || 0;
  specs.push({
    id: nodeId("folder", "objectPropertySets", parentId),
    kind: "folder",
    title: "Property Sets",
    detail: `${propertySetCount}`,
    modelId: model.id,
    componentId: object.id,
    folderKind: "objectPropertySets",
    hasChildren: propertySetCount > 0
  });
  const incomingCount = countRelationships(object.relating);
  specs.push({
    id: nodeId("folder", "relatingRelationships", parentId),
    kind: "folder",
    title: "Incoming Relationships",
    detail: `${incomingCount}`,
    modelId: model.id,
    componentId: object.id,
    folderKind: "relatingRelationships",
    hasChildren: incomingCount > 0
  });
  const outgoingCount = countRelationships(object.related);
  specs.push({
    id: nodeId("folder", "relatedRelationships", parentId),
    kind: "folder",
    title: "Outgoing Relationships",
    detail: `${outgoingCount}`,
    modelId: model.id,
    componentId: object.id,
    folderKind: "relatedRelationships",
    hasChildren: outgoingCount > 0
  });
  return specs;
}

function propertySetSpec(model: DataModel, propertySet: PropertySet, parentId: string): DataExplorerNodeSpec {
  return {
    id: nodeId("propertySet", propertySet.id, parentId),
    kind: "propertySet",
    title: "PropertySet",
    detail: `${propertySet.name || propertySet.id} - ${propertySet.type}`,
    modelId: model.id,
    componentId: propertySet.id,
    hasChildren: true
  };
}

function propertySetChildSpecs(model: DataModel, propertySet: PropertySet, parentId: string): DataExplorerNodeSpec[] {
  return [
    propertySpec(model, parentId, "ID", propertySet.id),
    propertySpec(model, parentId, "Original System ID", propertySet.originalSystemId || "none"),
    propertySpec(model, parentId, "Name", propertySet.name || "none"),
    propertySpec(model, parentId, "Type", propertySet.type),
    propertySpec(model, parentId, "Schema", propertySet.schema || "none"),
    {
      id: nodeId("folder", "properties", parentId),
      kind: "folder",
      title: "Properties",
      detail: `${propertySet.properties.length}`,
      modelId: model.id,
      componentId: propertySet.id,
      folderKind: "properties",
      hasChildren: propertySet.properties.length > 0
    }
  ];
}

function relationshipSpec(model: DataModel, relationship: Relationship, index: number, parentId: string): DataExplorerNodeSpec {
  return {
    id: relationshipNodeId(relationship, index, parentId),
    kind: "relationship",
    title: "Relationship",
    detail: `${relationship.type} - ${relationship.relatingObject.id} -> ${relationship.relatedObject.id}`,
    modelId: model.id,
    relationshipIndex: index,
    hasChildren: true
  };
}

function relationshipChildSpecs(model: DataModel, relationship: Relationship, parentId: string): DataExplorerNodeSpec[] {
  return [
    propertySpec(model, parentId, "Type", relationship.type),
    propertySpec(model, parentId, "Schema", relationship.schema || "none"),
    objectSpec(model, relationship.relatingObject, nodeId("relationshipEndpoint", "relating", parentId)),
    objectSpec(model, relationship.relatedObject, nodeId("relationshipEndpoint", "related", parentId))
  ];
}

function propertySpec(model: DataModel, parentId: string, name: string, value: unknown): DataExplorerNodeSpec {
  return {
    id: nodeId("property", `${name}:${formatValue(value)}`, parentId),
    kind: "property",
    title: name,
    detail: formatValue(value),
    modelId: model.id,
    hasChildren: false
  };
}

function getRelationship(model: DataModel, node: DataExplorerNodeSpec): Relationship | null {
  return node.relationshipIndex === undefined ? null : model.relationships[node.relationshipIndex] || null;
}

function relationshipNodeId(relationship: Relationship, index: number, parentId: string): string {
  return nodeId("relationship", `${index}:${relationship.type}:${relationship.relatingObject.id}:${relationship.relatedObject.id}`, parentId);
}

function countRelationships(groups: {[key: string]: Relationship[]}): number {
  return Object.values(groups).reduce((count, relationships) => count + relationships.length, 0);
}

function sortByTitle<T extends {title: string; detail?: string; id: string}>(items: T[]): T[] {
  return items.sort((a, b) => naturalCompare(a.title, b.title) || naturalCompare(a.detail || "", b.detail || "") || naturalCompare(a.id, b.id));
}

function nodeId(kind: string, componentId: string, parentId: string): string {
  return `${kind}:${componentId}:in:${parentId}`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "none";
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

function getSceneObjectAABB(sceneObject: SceneObject): AABB3 | null {
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

function getObjectsAABB(objectIds: string[], scene: Scene): AABB3 | null {
  const aabb = collapseAABB3(createAABB3Float64());
  let found = false;
  for (const objectId of objectIds) {
    const sceneObject = scene.objects[objectId];
    const objectAABB = sceneObject ? getSceneObjectAABB(sceneObject) : null;
    if (!objectAABB) {
      continue;
    }
    expandAABB3Point3(aabb, objectAABB as any);
    tempPoint[0] = objectAABB[3];
    tempPoint[1] = objectAABB[4];
    tempPoint[2] = objectAABB[5];
    expandAABB3Point3(aabb, tempPoint as any);
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
