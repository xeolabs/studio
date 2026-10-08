import type {Data, DataObject, Relationship} from "@xeokit/sdk/model/data";
import type {TreeSearchEntry} from "../tree/treeSearchEntries";
import {naturalCompare} from "../tree/naturalCompare";
import {PagedTreeCollection} from "../tree/PagedTreeCollection";
import {PagedTreeState, type TreeBranchState} from "../tree/PagedTreeState";
import {ExplorerRefreshQueue} from "../tree/ExplorerRefreshQueue";
import {displayedTreeNodes} from "../tree/displayedTreeNodes";
import {summarizeVisibility} from "../tree/visibilitySummary";
import {collapseAABB3, createAABB3Float64, expandAABB3Point3, type AABB3} from "@xeokit/sdk/base/math/boundaries";
import {transformPoint3} from "@xeokit/sdk/base/math/matrix";
import type {Scene} from "@xeokit/sdk/model/scene";
import {StudioCameraFlight as CameraFlightAnimation} from "../../services/StudioCameraFlight";
import type {Viewer, View, ViewObjectStyleBinChangedEvent} from "@xeokit/sdk/viewing/viewer";
import type {DataObjectTreeEffectId, DataObjectTreeNodeState, DataObjectTreeState} from "./DataObjectTreeStore";

export interface DataObjectStoreysStoreParams {
  data: Data;
  scene: Scene;
  viewer: Viewer;
  view?: View;
  makeReactive?: <T extends object>(value: T) => T;
}

const STOREY_NODE_PREFIX = "ifc-storey:";
const STOREY_TYPE_NODE_PREFIX = "ifc-storey-type:";

const STYLE_BIN_BY_EFFECT: Partial<Record<DataObjectTreeEffectId, string>> = {
  selected: "selected",
  highlighted: "highlighted",
  xrayed: "xrayed"
};

export class DataObjectStoreysStore {
  readonly data: Data;
  readonly scene: Scene;
  readonly viewer: Viewer;
  readonly view: View;
  state: DataObjectTreeState = {
    roots: [],
    busy: false,
    revision: 0,
    activeNodeId: ""
  };

  private readonly _nodes = new Map<string, DataObjectTreeNodeState>();
  private readonly _pages = new PagedTreeState<DataObjectTreeNodeState, {id: string}>({
    roots: () => this.state.roots,
    nodes: this._nodes,
    children: node => this._childCollection(node),
    create: (spec, depth) => this._createChild(spec.id, depth),
    sync: node => this._syncNodeState(node),
    touch: () => this._touch()
  });
  get pageSize(): number { return this._pages.pageSize; }
  private _disposed = false;
  private readonly _storeyObjectIds = new Map<string, string[]>();
  private readonly _storeyTypeObjectIds = new Map<string, string[]>();
  private readonly _unsubscribers: Array<() => void> = [];
  private readonly _refreshQueue = new ExplorerRefreshQueue({
    structure: () => {
      this._populateRoots();
      this._syncAllMaterializedEffectStates();
    },
    state: () => this._syncAllMaterializedEffectStates()
  });
  private readonly _makeReactive?: <T extends object>(value: T) => T;
  private readonly _cameraFlight: CameraFlightAnimation;
  private _applyingTreeEffect = 0;

  constructor(params: DataObjectStoreysStoreParams) {
    this.data = params.data;
    this.scene = params.scene;
    this.viewer = params.viewer;
    this._makeReactive = params.makeReactive;
    if (this._makeReactive) {
      this.state = this._makeReactive(this.state);
    }
    this.view = params.view || params.viewer.viewList.find(Boolean);
    if (!this.view) {
      throw new Error("[DataObjectStoreysStore] Expected a View on the Viewer");
    }
    this._cameraFlight = new CameraFlightAnimation(this.view, {duration: 0.45});
    this._ensureStyleBins();
    this._populateRoots();
    this._syncAllMaterializedEffectStates();
    this._subscribe();
  }

  destroy(): void {
    this._disposed = true;
    this._pages.dispose();
    this._refreshQueue.dispose();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
    this._nodes.clear();
    this._storeyObjectIds.clear();
    this._storeyTypeObjectIds.clear();
    this.state.roots.splice(0);
    this._cameraFlight.destroy();
  }

  async toggleExpanded(node: DataObjectTreeNodeState): Promise<void> {
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
    } else if (node.expanded) {
      this._syncDisplayedMaterializedEffectStates();
    }
    this._touch();
  }

  toggleEffect(node: DataObjectTreeNodeState, effectId: DataObjectTreeEffectId): void {
    this.setEffect(node, effectId, !this._nodeHasEffect(node, effectId));
  }

  setEffect(node: DataObjectTreeNodeState, effectId: DataObjectTreeEffectId, nextActive: boolean): void {
    const objectIds = this._collectNodeObjectIds(node);
    if (objectIds.length === 0) {
      return;
    }
    this._applyingTreeEffect++;
    try {
      this._setEffect(objectIds, effectId, nextActive);
    } finally {
      this._applyingTreeEffect--;
    }
    this._syncAllMaterializedEffectStates();
  }

  fitObject(node: DataObjectTreeNodeState): void {
    const objectIds = this._collectNodeObjectIds(node);
    if (objectIds.length === 0) {
      return;
    }
    const aabb = getObjectsAABB(objectIds, this.scene);
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

  getViewObject(dataObjectId: string): any {
    return this.view.objects[dataObjectId] || null;
  }

  getNode(id: string): DataObjectTreeNodeState | null { return this._nodes.get(id) || null; }

  setPage(node: DataObjectTreeNodeState, page: number): void {
    this._pages.setPage(node, page);
    this._syncDisplayedMaterializedEffectStates();
  }
  revealChild(node: DataObjectTreeNodeState, id: string): void {
    this._pages.revealChild(node, id);
    this._syncDisplayedMaterializedEffectStates();
  }
  captureBranchStates(): Map<string, TreeBranchState> { return this._pages.capture(); }
  restoreBranchStates(states: ReadonlyMap<string, TreeBranchState>): void { this._pages.restore(states); }

  getObjectId(node: DataObjectTreeNodeState): string | null {
    const id = storeyIdFromNodeId(node.id) || node.id;
    return this.data.objects[id] ? id : null;
  }

  getNodeObjectIds(node: DataObjectTreeNodeState): string[] { return this._collectNodeObjectIds(node); }

  getObjectPath(objectId: string): string[] | null {
    if (this._storeyObjectIds.has(objectId)) return [storeyNodeId(objectId)];
    const object = this.data.objects[objectId];
    if (!object) return null;
    for (const [storeyId, ids] of this._storeyObjectIds) {
      if (ids.includes(objectId)) return [storeyNodeId(storeyId), typeNodeId(storeyId, object.type || "DataObject"), objectId];
    }
    return null;
  }

  *getSearchEntries(): Generator<TreeSearchEntry> {
    for (const [storeyId] of this._storeyObjectIds) {
      const root = storeyNodeId(storeyId);
      yield {id: storeyId, title: getObjectTitle(this.data.objects[storeyId]), type: "IfcBuildingStorey", kind: "object", objectId: storeyId, path: [root]};
      for (const type of this._getStoreyTypes(storeyId)) {
        const group = typeNodeId(storeyId, type);
        yield {id: group, title: type, type: "Type", kind: "typeGroup", path: [root, group], context: getObjectTitle(this.data.objects[storeyId])};
        for (const id of this._storeyTypeObjectIds.get(storeyTypeKey(storeyId, type)) || []) {
          yield {id, title: getObjectTitle(this.data.objects[id]), type, kind: "object", objectId: id, path: [root, group, id], context: getObjectTitle(this.data.objects[storeyId]) + " / " + type};
        }
      }
    }
  }

  private _populateRoots(): void {
    this._storeyObjectIds.clear();
    this._storeyTypeObjectIds.clear();
    const storeyIds = Object.values(this.data.objects)
      .filter((object) => isBuildingStorey(object))
      .map((object) => object.id)
      .sort(compareDataObjects(this.data));

    for (const storeyId of storeyIds) {
      const objectIds = this._collectDescendantObjectIds(storeyId)
        .filter((id) => id !== storeyId)
        .sort(compareDataObjects(this.data));
      this._storeyObjectIds.set(storeyId, objectIds);
      const byType = new Map<string, string[]>();
      for (const objectId of objectIds) {
        const object = this.data.objects[objectId];
        const type = object?.type || "DataObject";
        const ids = byType.get(type) || [];
        ids.push(objectId);
        byType.set(type, ids);
      }
      for (const [type, ids] of byType) {
        this._storeyTypeObjectIds.set(storeyTypeKey(storeyId, type), ids);
      }
    }

    const roots = storeyIds.map((id) => this._getOrCreateStoreyNode(id));
    this.state.roots.splice(0, this.state.roots.length, ...roots);
    this._pages.refresh();
    this._touch();
  }

  private _loadChildren(node: DataObjectTreeNodeState): void {
    this._pages.load(node);
    this._syncDisplayedMaterializedEffectStates();
  }

  private _childCollection(node: DataObjectTreeNodeState): PagedTreeCollection<{id: string}> {
    const storeyId = storeyIdFromNodeId(node.id);
    if (storeyId) {
      return new PagedTreeCollection(this._getStoreyTypes(storeyId),
        type => ({id: typeNodeId(storeyId, type)}), type => typeNodeId(storeyId, type));
    }
    const typeRef = typeRefFromNodeId(node.id);
    const ids = typeRef ? this._storeyTypeObjectIds.get(storeyTypeKey(typeRef.storeyId, typeRef.type)) || [] : [];
    return new PagedTreeCollection(ids, id => ({id}), id => id);
  }

  private _createChild(id: string, depth: number): DataObjectTreeNodeState {
    const ref = typeRefFromNodeId(id);
    return ref ? this._getOrCreateTypeNode(ref.storeyId, ref.type, depth) : this._getOrCreateObjectNode(id, depth);
  }

  private _getOrCreateStoreyNode(storeyId: string): DataObjectTreeNodeState {
    const id = storeyNodeId(storeyId);
    const object = this.data.objects[storeyId];
    const count = this._storeyObjectIds.get(storeyId)?.length || 0;
    let node = this._nodes.get(id);
    if (node) {
      node.title = getObjectTitle(object);
      node.type = object?.type || "IfcBuildingStorey";
      node.detail = `${node.type} - ${count} object${count === 1 ? "" : "s"}`;
      node.hasChildren = count > 0;
      node.hasSubtreeViewObjects = this._collectNodeObjectIds(node).length > 0;
      return node;
    }
    node = {
      id,
      title: getObjectTitle(object),
      type: object?.type || "IfcBuildingStorey",
      detail: `${object?.type || "IfcBuildingStorey"} - ${count} object${count === 1 ? "" : "s"}`,
      depth: 0,
      hasChildren: count > 0,
      expanded: false,
      loading: false,
      childrenLoaded: false,
      children: [],
      childCount: 0,
      pageIndex: 0,
      hasSubtreeViewObjects: false,
      effects: {
        visible: false,
        selected: false,
        highlighted: false,
        xrayed: false
      }
    };
    if (this._makeReactive) {
      node = this._makeReactive(node);
    }
    this._nodes.set(id, node);
    node.hasSubtreeViewObjects = this._collectNodeObjectIds(node).length > 0;
    return node;
  }

  private _getOrCreateTypeNode(storeyId: string, type: string, depth: number): DataObjectTreeNodeState {
    const id = typeNodeId(storeyId, type);
    const count = this._storeyTypeObjectIds.get(storeyTypeKey(storeyId, type))?.length || 0;
    let node = this._nodes.get(id);
    if (node) {
      node.depth = depth;
      node.title = type;
      node.type = "Type";
      node.detail = `${count} object${count === 1 ? "" : "s"}`;
      node.hasChildren = count > 0;
      node.hasSubtreeViewObjects = this._collectNodeObjectIds(node).length > 0;
      return node;
    }
    node = {
      id,
      title: type,
      type: "Type",
      detail: `${count} object${count === 1 ? "" : "s"}`,
      depth,
      hasChildren: count > 0,
      expanded: false,
      loading: false,
      childrenLoaded: false,
      children: [],
      childCount: 0,
      pageIndex: 0,
      hasSubtreeViewObjects: false,
      effects: {
        visible: false,
        selected: false,
        highlighted: false,
        xrayed: false
      }
    };
    if (this._makeReactive) {
      node = this._makeReactive(node);
    }
    this._nodes.set(id, node);
    node.hasSubtreeViewObjects = this._collectNodeObjectIds(node).length > 0;
    return node;
  }

  private _getOrCreateObjectNode(objectId: string, depth: number): DataObjectTreeNodeState {
    const object = this.data.objects[objectId];
    let node = this._nodes.get(objectId);
    if (node) {
      node.depth = depth;
      node.title = getObjectTitle(object);
      node.type = object?.type || "DataObject";
      node.detail = undefined;
      node.hasSubtreeViewObjects = !!this.view.objects[objectId];
      return node;
    }
    node = {
      id: objectId,
      title: getObjectTitle(object),
      type: object?.type || "DataObject",
      depth,
      hasChildren: false,
      expanded: false,
      loading: false,
      childrenLoaded: false,
      children: [],
      childCount: 0,
      pageIndex: 0,
      hasSubtreeViewObjects: !!this.view.objects[objectId],
      effects: {
        visible: false,
        selected: false,
        highlighted: false,
        xrayed: false
      }
    };
    if (this._makeReactive) {
      node = this._makeReactive(node);
    }
    this._nodes.set(objectId, node);
    return node;
  }

  private _getStoreyTypes(storeyId: string): string[] {
    const types = new Set<string>();
    for (const objectId of this._storeyObjectIds.get(storeyId) || []) {
      types.add(this.data.objects[objectId]?.type || "DataObject");
    }
    return Array.from(types).sort(naturalCompare);
  }

  private _collectDescendantObjectIds(rootId: string): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      if (this.data.objects[id]) {
        result.push(id);
      }
      const object = this.data.objects[id];
      if (!object) {
        return;
      }
      for (const relationships of Object.values(object.related)) {
        for (const relationship of relationships) {
          const child = relationship.relatedObject;
          if (child && this.data.objects[child.id]) {
            visit(child.id);
          }
        }
      }
    };
    visit(rootId);
    return result;
  }

  private _collectNodeObjectIds(node: DataObjectTreeNodeState): string[] {
    const storeyId = storeyIdFromNodeId(node.id);
    if (storeyId) {
      return (this._storeyObjectIds.get(storeyId) || []).filter((id) => !!this.view.objects[id]);
    }
    const typeRef = typeRefFromNodeId(node.id);
    if (typeRef) {
      return (this._storeyTypeObjectIds.get(storeyTypeKey(typeRef.storeyId, typeRef.type)) || []).filter((id) => !!this.view.objects[id]);
    }
    return this.view.objects[node.id] ? [node.id] : [];
  }

  private _setEffect(objectIds: string[], effectId: DataObjectTreeEffectId, active: boolean): void {
    if (effectId === "visible") {
      this.view.setObjectsVisible(objectIds, active);
      return;
    }
    if (effectId === "highlighted") {
      this.view.setObjectsColorized(objectIds, active ? [1, 0.86, 0.2] : null);
      this.view.setObjectsInStyleBin(STYLE_BIN_BY_EFFECT.highlighted!, objectIds, active);
      return;
    }
    if (effectId === "xrayed") {
      this.view.setObjectsOpacity(objectIds, active ? 0.28 : null);
      this.view.setObjectsInStyleBin(STYLE_BIN_BY_EFFECT.xrayed!, objectIds, active);
      return;
    }
    const styleBinId = STYLE_BIN_BY_EFFECT[effectId];
    if (styleBinId) {
      this.view.setObjectsInStyleBin(styleBinId, objectIds, active);
    }
  }

  private _nodeHasEffect(node: DataObjectTreeNodeState, effectId: DataObjectTreeEffectId): boolean {
    for (const id of this._collectNodeObjectIds(node)) {
      if (this._objectHasEffect(id, effectId)) {
        return true;
      }
    }
    return false;
  }

  private _objectHasEffect(objectId: string, effectId: DataObjectTreeEffectId): boolean {
    const viewObject = this.view.objects[objectId];
    if (!viewObject) {
      return false;
    }
    if (effectId === "visible") {
      return viewObject.visible;
    }
    if (effectId === "highlighted") {
      return !!viewObject.colorize || viewObject.hasStyleBin(STYLE_BIN_BY_EFFECT.highlighted!);
    }
    if (effectId === "xrayed") {
      return viewObject.opacityUpdated || viewObject.hasStyleBin(STYLE_BIN_BY_EFFECT.xrayed!);
    }
    const styleBinId = STYLE_BIN_BY_EFFECT[effectId];
    return !!styleBinId && viewObject.hasStyleBin(styleBinId);
  }

  private _syncAllMaterializedEffectStates(): void {
    for (const node of displayedTreeNodes(this.state.roots)) {
      this._syncNodeState(node);
    }
  }

  private _syncDisplayedMaterializedEffectStates(): void {
    for (const id of this._collectDisplayedNodeIds()) {
      const node = this._nodes.get(id);
      if (node) {
        this._syncNodeState(node);
      }
    }
    this._touch();
  }

  private _syncNodeState(node: DataObjectTreeNodeState): void {
    Object.assign(node, summarizeVisibility(this._collectNodeObjectIds(node), this.view.objects));
    node.effects.visible = node.visibleCount > 0;
    node.effects.selected = this._nodeHasEffect(node, "selected");
    node.effects.highlighted = this._nodeHasEffect(node, "highlighted");
    node.effects.xrayed = this._nodeHasEffect(node, "xrayed");
    node.hasSubtreeViewObjects = this._collectNodeObjectIds(node).length > 0;
  }

  private _collectDisplayedNodeIds(): string[] {
    const ids: string[] = [];
    const visit = (node: DataObjectTreeNodeState) => {
      ids.push(node.id);
      if (!node.expanded) {
        return;
      }
      for (const child of node.children) {
        visit(child);
      }
    };
    for (const root of this.state.roots) {
      visit(root);
    }
    return ids;
  }

  private _ensureStyleBins(): void {
    const bins = [
      {id: "selected", priority: 90, edges: true, edgeColor: [0.1, 0.45, 1], edgeWidth: 3, fillAlpha: 0.82},
      {id: "highlighted", priority: 80, edges: true, edgeColor: [1, 0.78, 0.05], edgeWidth: 2, fillAlpha: 0.72},
      {id: "xrayed", priority: 70, fillAlpha: 0.18, edges: true, edgeColor: [0.35, 0.7, 1], edgeWidth: 1}
    ];
    for (const bin of bins) {
      if (!this.view.styleBins.get(bin.id)) {
        this.view.styleBins.create(bin as any);
      }
    }
  }

  private _subscribe(): void {
    this._unsubscribers.push(
      this.data.events.onDataObjectCreated.subscribe(() => this._refreshStructure()),
      this.data.events.onDataObjectDestroyed.subscribe(() => this._refreshStructure()),
      this.data.events.onRelationshipCreated.subscribe((_data: Data, _relationship: Relationship) => this._refreshStructure()),
      this.data.events.onRelationshipDestroyed.subscribe((_data: Data, _relationship: Relationship) => this._refreshStructure()),
      this.viewer.events.onViewObjectCreated.subscribe((view: View) => {
        if (view === this.view) {
          this._refreshQueue.request("state");
        }
      }),
      this.viewer.events.onViewObjectDestroyed.subscribe((view: View) => {
        if (view === this.view) {
          this._refreshQueue.request("state");
        }
      }),
      this.viewer.events.onViewObjectVisibleChanged.subscribe((view: View) => {
        if (view === this.view && this._applyingTreeEffect === 0) {
          this._refreshQueue.request("state");
        }
      }),
      this.viewer.events.onViewObjectStyleBinChanged.subscribe((view: View, event: ViewObjectStyleBinChangedEvent) => {
        if (view === this.view && this._applyingTreeEffect === 0 && Object.values(STYLE_BIN_BY_EFFECT).includes(event.styleBinId)) {
          this._refreshQueue.request("state");
        }
      }),
      this.viewer.events.onViewObjectColorizeChanged.subscribe((view: View) => {
        if (view === this.view && this._applyingTreeEffect === 0) {
          this._refreshQueue.request("state");
        }
      }),
      this.viewer.events.onViewObjectOpacityChanged.subscribe((view: View) => {
        if (view === this.view && this._applyingTreeEffect === 0) {
          this._refreshQueue.request("state");
        }
      })
    );
  }

  private _refreshStructure(): void {
    this._refreshQueue.request("structure");
  }

  private _touch(): void {
    this.state.revision++;
  }
}

function isBuildingStorey(object: DataObject): boolean {
  return (object.type || "").toLowerCase() === "ifcbuildingstorey";
}

function storeyNodeId(storeyId: string): string {
  return `${STOREY_NODE_PREFIX}${encodeURIComponent(storeyId)}`;
}

function storeyIdFromNodeId(id: string): string | null {
  return id.startsWith(STOREY_NODE_PREFIX) ? decodeURIComponent(id.slice(STOREY_NODE_PREFIX.length)) : null;
}

function typeNodeId(storeyId: string, type: string): string {
  return `${STOREY_TYPE_NODE_PREFIX}${encodeURIComponent(storeyId)}:${encodeURIComponent(type)}`;
}

function typeRefFromNodeId(id: string): {storeyId: string; type: string} | null {
  if (!id.startsWith(STOREY_TYPE_NODE_PREFIX)) {
    return null;
  }
  const body = id.slice(STOREY_TYPE_NODE_PREFIX.length);
  const separator = body.indexOf(":");
  if (separator === -1) {
    return null;
  }
  return {
    storeyId: decodeURIComponent(body.slice(0, separator)),
    type: decodeURIComponent(body.slice(separator + 1))
  };
}

function storeyTypeKey(storeyId: string, type: string): string {
  return `${storeyId}\u0000${type}`;
}

function getObjectTitle(object: DataObject | undefined): string {
  if (!object) {
    return "Missing DataObject";
  }
  return object.name || object.description || object.originalSystemId || object.id;
}

function compareDataObjects(data: Data): (a: string, b: string) => number {
  return (a, b) => naturalCompare(getObjectTitle(data.objects[a]), getObjectTitle(data.objects[b])) || naturalCompare(a, b);
}

function getObjectsAABB(objectIds: string[], scene: Scene): AABB3 | null {
  const aabb = collapseAABB3(createAABB3Float64());
  let found = false;
  for (const objectId of objectIds) {
    const sceneObject = scene.objects[objectId];
    if (!sceneObject) {
      continue;
    }
    for (const mesh of sceneObject.meshes) {
      const geometryAABB = mesh.geometry.aabb;
      if (!geometryAABB) {
        continue;
      }
      expandTransformedAABB(aabb, geometryAABB, mesh.worldMatrix);
      found = true;
    }
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
