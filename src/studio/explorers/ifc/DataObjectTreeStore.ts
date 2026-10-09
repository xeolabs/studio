import {objectHasEffect, setObjectEffect} from "../tree/objectEffects";
import type {Data, DataObject} from "@xeokit/sdk/model/data";
import {findObjectPath} from "./findObjectPath";
import {treeSearchEntries} from "../tree/treeSearchEntries";
import {naturalCompare} from "../tree/naturalCompare";
import {PagedTreeCollection} from "../tree/PagedTreeCollection";
import {PagedTreeState, type TreeBranchState} from "../tree/PagedTreeState";
import {ExplorerRefreshQueue} from "../tree/ExplorerRefreshQueue";
import {displayedTreeNodes} from "../tree/displayedTreeNodes";
import {summarizeVisibility, type VisibilitySummary} from "../tree/visibilitySummary";
import {collapseAABB3, createAABB3Float64, expandAABB3Point3, type AABB3} from "@xeokit/sdk/base/math/boundaries";
import {transformPoint3} from "@xeokit/sdk/base/math/matrix";
import type {Scene} from "@xeokit/sdk/model/scene";
import {StudioCameraFlight as CameraFlightAnimation} from "../../services/StudioCameraFlight";
import type {Viewer, View, ViewObjectStyleBinChangedEvent} from "@xeokit/sdk/viewing/viewer";

export type DataObjectTreeEffectId = "visible" | "selected" | "highlighted" | "xrayed";

export interface DataObjectTreeNodeState extends Partial<VisibilitySummary> {
  id: string;
  title: string;
  type: string;
  detail?: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  childrenLoaded: boolean;
  children: DataObjectTreeNodeState[];
  childCount: number;
  pageIndex: number;
  hasSubtreeViewObjects: boolean;
  effects: Record<DataObjectTreeEffectId, boolean>;
}

export interface DataObjectTreeState {
  roots: DataObjectTreeNodeState[];
  busy: boolean;
  revision: number;
  activeNodeId: string;
}

export interface DataObjectTreeStoreParams {
  data: Data;
  scene: Scene;
  viewer: Viewer;
  view?: View;
  makeReactive?: <T extends object>(value: T) => T;
}

const RELATIONSHIP_ORDER = [
  "IfcRelAggregates",
  "IfcRelContainedInSpatialStructure",
  "BasicAggregation"
];

const STYLE_BIN_BY_EFFECT: Partial<Record<DataObjectTreeEffectId, string>> = {
  selected: "selected",
  highlighted: "highlighted",
  xrayed: "xrayed"
};

export class DataObjectTreeStore {
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
    children: node => new PagedTreeCollection(this._getChildObjectIds(node.id), id => ({id}), id => id),
    create: (spec, depth) => this._getOrCreateNode(spec.id, depth),
    sync: node => this._syncNodeState(node),
    touch: () => this._touch()
  });
  get pageSize(): number { return this._pages.pageSize; }
  private _disposed = false;
  private readonly _unsubscribers: Array<() => void> = [];
  private readonly _refreshQueue = new ExplorerRefreshQueue({
    structure: () => this._refreshHierarchy(),
    state: () => this._syncAllMaterializedEffectStates()
  });
  private readonly _childObjectIdsCache = new Map<string, string[]>();
  private readonly _subtreeDataObjectIdsCache = new Map<string, string[]>();
  private readonly _subtreeViewObjectIdsCache = new Map<string, string[]>();
  private readonly _makeReactive?: <T extends object>(value: T) => T;
  private readonly _cameraFlight: CameraFlightAnimation;
  private _applyingTreeEffect = 0;

  constructor(params: DataObjectTreeStoreParams) {
    this.data = params.data;
    this.scene = params.scene;
    this.viewer = params.viewer;
    this._makeReactive = params.makeReactive;
    if (this._makeReactive) {
      this.state = this._makeReactive(this.state);
    }
    this.view = params.view || params.viewer.viewList.find(Boolean);
    if (!this.view) {
      throw new Error("[DataObjectTreeStore] Expected a View on the Viewer");
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
    this._invalidateHierarchyCaches();
    this._refreshQueue.dispose();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
    this._nodes.clear();
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

  async expandToDepth(depth: number): Promise<void> {
    const maxExpandedDepth = Math.max(0, Math.floor(depth) - 1);
    if (maxExpandedDepth < 0) {
      return;
    }
    this.state.busy = true;
    try {
      const visited = new Set<string>();
      let level = this.state.roots.slice();
      for (let currentDepth = 0; currentDepth <= maxExpandedDepth && level.length > 0; currentDepth++) {
        const nextLevel: DataObjectTreeNodeState[] = [];
        for (const node of level) {
          if (visited.has(node.id)) {
            continue;
          }
          visited.add(node.id);
          if (!node.hasChildren) {
            continue;
          }
          node.expanded = true;
          node.loading = true;
          await nextFrame();
          if (this._disposed) return;
          if (!node.childrenLoaded) {
            this._loadChildren(node);
          }
          node.loading = false;
          nextLevel.push(...node.children);
        }
        level = nextLevel;
      }
      this._syncDisplayedMaterializedEffectStates();
      this._touch();
    } finally {
      for (const node of this._nodes.values()) {
        node.loading = false;
      }
      this.state.busy = false;
    }
  }

  toggleEffect(node: DataObjectTreeNodeState, effectId: DataObjectTreeEffectId): void {
    this.setEffect(node, effectId, !this._subtreeHasEffect(node.id, effectId));
  }

  setEffect(node: DataObjectTreeNodeState, effectId: DataObjectTreeEffectId, nextActive: boolean): void {
    const objectIds = this._collectSubtreeObjectIds(node.id);
    if (objectIds.length === 0) {
      return;
    }
    this._applyingTreeEffect++;
    try {
      this._setEffect(objectIds, effectId, nextActive);
    } finally {
      this._applyingTreeEffect--;
    }
    this._syncEffectStatesAfterSubtreeToggle(node.id, effectId, nextActive);
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

  getObjectId(node: DataObjectTreeNodeState): string | null { return this.data.objects[node.id] ? node.id : null; }

  getNodeObjectIds(node: DataObjectTreeNodeState): string[] { return this._collectSubtreeObjectIds(node.id).slice(); }

  getObjectPath(objectId: string): string[] | null {
    return findObjectPath(this.state.roots.map((node) => node.id), (id) => this._getChildObjectIds(id), objectId);
  }

  getSearchEntries() {
    const spec = (id: string) => ({id, componentId: id, kind: "object", title: getObjectTitle(this.data.objects[id]), type: this.data.objects[id]?.type || "DataObject"});
    const store = this;
    return treeSearchEntries(this.state.roots.map((node) => spec(node.id)),
      function* (node) { for (const id of store._getChildObjectIds(node.id)) yield spec(id); }, () => true, (node) => node.type);
  }

  fitObject(node: DataObjectTreeNodeState): void {
    const objectIds = this._collectSubtreeObjectIds(node.id);
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

  private _populateRoots(): void {
    const rootIds = Object.keys(this.data.rootObjects)
      .filter((id) => !!this.data.objects[id])
      .sort(compareDataObjects(this.data));
    this.state.roots.splice(0, this.state.roots.length, ...rootIds.map((id) => this._getOrCreateNode(id, 0)));
    this._touch();
  }

  private _loadChildren(node: DataObjectTreeNodeState, syncEffects = true): void {
    this._pages.load(node);
    if (syncEffects) this._syncDisplayedMaterializedEffectStates();
  }

  private _getOrCreateNode(id: string, depth: number): DataObjectTreeNodeState {
    let node = this._nodes.get(id);
    const object = this.data.objects[id];
    if (node) {
      node.depth = depth;
      node.title = getObjectTitle(object);
      node.type = object?.type || "DataObject";
      node.hasChildren = this._getChildObjectIds(id).length > 0;
      node.hasSubtreeViewObjects = this._collectSubtreeObjectIds(id).length > 0;
      return node;
    }
    node = {
      id,
      title: getObjectTitle(object),
      type: object?.type || "DataObject",
      depth,
      hasChildren: this._getChildObjectIds(id).length > 0,
      expanded: false,
      loading: false,
      childrenLoaded: false,
      children: [],
      childCount: 0,
      pageIndex: 0,
      hasSubtreeViewObjects: this._collectSubtreeObjectIds(id).length > 0,
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
    return node;
  }

  private _getChildObjectIds(objectId: string): string[] {
    const cached = this._childObjectIdsCache.get(objectId);
    if (cached) {
      return cached;
    }
    const object = this.data.objects[objectId];
    if (!object) {
      return [];
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    const relationshipTypes = [
      ...RELATIONSHIP_ORDER,
      ...Object.keys(object.related).filter((type) => !RELATIONSHIP_ORDER.includes(type)).sort()
    ];
    for (const relationshipType of relationshipTypes) {
      const relationships = object.related[relationshipType] || [];
      for (const relationship of relationships) {
        const child = relationship.relatedObject;
        if (child && this.data.objects[child.id] && !seen.has(child.id)) {
          seen.add(child.id);
          ids.push(child.id);
        }
      }
    }
    const result = ids.sort(compareDataObjects(this.data));
    this._childObjectIdsCache.set(objectId, result);
    return result;
  }

  private _collectSubtreeDataObjectIds(rootId: string): string[] {
    const cached = this._subtreeDataObjectIdsCache.get(rootId);
    if (cached) {
      return cached;
    }
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
      for (const childId of this._getChildObjectIds(id)) {
        visit(childId);
      }
    };
    visit(rootId);
    this._subtreeDataObjectIdsCache.set(rootId, result);
    return result;
  }

  private _collectSubtreeObjectIds(rootId: string): string[] {
    const cached = this._subtreeViewObjectIdsCache.get(rootId);
    if (cached) {
      return cached;
    }
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      if (this.view.objects[id]) {
        result.push(id);
      }
      for (const childId of this._getChildObjectIds(id)) {
        visit(childId);
      }
    };
    visit(rootId);
    this._subtreeViewObjectIdsCache.set(rootId, result);
    return result;
  }

  private _setEffect(objectIds: string[], effectId: DataObjectTreeEffectId, active: boolean): void {
    setObjectEffect(this.view, objectIds, effectId, active);
  }

  private _subtreeHasEffect(rootId: string, effectId: DataObjectTreeEffectId): boolean {
    const ids = this._collectSubtreeObjectIds(rootId);
    for (const id of ids) {
      if (this._objectHasEffect(id, effectId)) {
        return true;
      }
    }
    return false;
  }

  private _objectHasEffect(objectId: string, effectId: DataObjectTreeEffectId): boolean {
    return objectHasEffect(this.view.objects[objectId], effectId);
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
    Object.assign(node, summarizeVisibility(this._collectSubtreeObjectIds(node.id), this.view.objects));
    node.effects.visible = node.visibleCount > 0;
    node.effects.selected = this._subtreeHasEffect(node.id, "selected");
    node.effects.highlighted = this._subtreeHasEffect(node.id, "highlighted");
    node.effects.xrayed = this._subtreeHasEffect(node.id, "xrayed");
    node.hasChildren = this._getChildObjectIds(node.id).length > 0;
    node.hasSubtreeViewObjects = this._collectSubtreeObjectIds(node.id).length > 0;
  }

  private _syncEffectStatesAfterSubtreeToggle(rootId: string, effectId: DataObjectTreeEffectId, active: boolean): void {
    const toggledDataIds = new Set(this._collectSubtreeDataObjectIds(rootId));
    for (const id of this._collectDisplayedNodeIds()) {
      const node = this._nodes.get(id);
      if (!node) {
        continue;
      }
      if (toggledDataIds.has(node.id)) {
        if (effectId === "visible") Object.assign(node, summarizeVisibility(this._collectSubtreeObjectIds(node.id), this.view.objects));
        node.effects[effectId] = active && node.hasSubtreeViewObjects;
      } else if (this._collectSubtreeDataObjectIds(node.id).includes(rootId)) {
        if (effectId === "visible") Object.assign(node, summarizeVisibility(this._collectSubtreeObjectIds(node.id), this.view.objects));
        node.effects[effectId] = this._subtreeHasEffect(node.id, effectId);
      }
    }
    this._touch();
  }

  private _collectDisplayedNodeIds(): string[] {
    return Array.from(displayedTreeNodes(this.state.roots), node => node.id);
  }

  private _invalidateHierarchyCaches(): void {
    this._childObjectIdsCache.clear();
    this._subtreeDataObjectIdsCache.clear();
    this._subtreeViewObjectIdsCache.clear();
  }

  private _invalidateViewObjectCaches(): void {
    this._subtreeViewObjectIdsCache.clear();
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
    const refresh = () => {
      this._invalidateHierarchyCaches();
      this._refreshQueue.request("structure");
    };
    this._unsubscribers.push(
      this.data.events.onDataObjectCreated.subscribe(refresh),
      this.data.events.onDataObjectDestroyed.subscribe(refresh),
      this.data.events.onRelationshipCreated.subscribe(refresh),
      this.data.events.onRelationshipDestroyed.subscribe(refresh),
      this.viewer.events.onViewObjectCreated.subscribe((view: View) => {
        if (view === this.view) {
          this._invalidateViewObjectCaches();
          this._refreshQueue.request("state");
        }
      }),
      this.viewer.events.onViewObjectDestroyed.subscribe((view: View) => {
        if (view === this.view) {
          this._invalidateViewObjectCaches();
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

  private _refreshHierarchy(): void {
    this._populateRoots();
    this._pages.refresh();
  }

  private _touch(): void {
    this.state.revision++;
  }
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
