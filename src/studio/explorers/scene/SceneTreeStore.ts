import {collapseAABB3, createAABB3Float64, expandAABB3Point3, type AABB3} from "@xeokit/sdk/base/math/boundaries";
import {treeSearchEntries} from "../tree/treeSearchEntries";
import {naturalCompare} from "../tree/naturalCompare";
import {ExplorerRefreshQueue} from "../tree/ExplorerRefreshQueue";
import {displayedTreeNodes} from "../tree/displayedTreeNodes";
import {PagedTreeCollection} from "../tree/PagedTreeCollection";
import {PagedTreeState, type TreeBranchState} from "../tree/PagedTreeState";
import {summarizeVisibility, type VisibilitySummary} from "../tree/visibilitySummary";
import {
  GaussianSplatsPrimitive,
  LinesPrimitive,
  PointsPrimitive,
  SolidPrimitive,
  SurfacePrimitive,
  TrianglesPrimitive
} from "@xeokit/sdk/base/constants";
import {transformPoint3} from "@xeokit/sdk/base/math/matrix";
import type {
  Scene,
  SceneGeometry,
  SceneMaterial,
  SceneMesh,
  SceneModel,
  SceneObject,
  SceneTexture,
  SceneTransform
} from "@xeokit/sdk/model/scene";
import type {SceneAnimation, SceneAnimationChannelParams} from "@xeokit/sdk/model/scene/animation";
import {COORDINATE_SYSTEM_PRESETS, type CoordinateSystemPreset} from "../../coordinateSystem";
import {CameraFlightAnimation} from "@xeokit/sdk/viewing/cameraFlight";
import type {Viewer, View} from "@xeokit/sdk/viewing/viewer";

export type SceneTreeNodeKind =
  | "scene"
  | "model"
  | "folder"
  | "object"
  | "mesh"
  | "geometry"
  | "transform"
  | "material"
  | "texture"
  | "textureBinding"
  | "animation"
  | "animationChannel"
  | "resourceRef"
  | "property"
  | "attribute";

export type SceneTreeResourceKind = "mesh" | "geometry" | "transform" | "material" | "texture" | "animation";
export type SceneTreeAttributeRole =
  | "positions"
  | "normals"
  | "uvs"
  | "colors"
  | "indices"
  | "edges"
  | "frames"
  | "morphs"
  | "splats"
  | "material"
  | "texture"
  | "property";

export interface SceneTreeNodeState extends Partial<VisibilitySummary> {
  id: string;
  kind: SceneTreeNodeKind;
  title: string;
  detail: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  childrenLoaded: boolean;
  children: SceneTreeNodeState[];
  childCount: number;
  pageIndex: number;
  settingsExpanded?: boolean;
  modelId?: string;
  componentId?: string;
  objectId?: string;
  resourceKind?: SceneTreeResourceKind;
  canonicalNodeId?: string;
  attributeRole?: SceneTreeAttributeRole;
  textureBindingTexCoord?: number;
  textureBindingUVTransform?: number[];
  modelCoordinateSystemPresetId?: string;
  visible: boolean;
  hasViewObject: boolean;
}

export interface SceneTreeState {
  roots: SceneTreeNodeState[];
  busy: boolean;
  revision: number;
  coordinateSystem: SceneTreeCoordinateSystemState;
}

export interface SceneTreeCoordinateSystemState {
  presets: CoordinateSystemPreset[];
}

export interface SceneTreeStoreParams {
  scene: Scene;
  viewer: Viewer;
  view?: View;
  makeReactive?: <T extends object>(value: T) => T;
  revealNode?: (nodeId: string) => Promise<void>;
  confirmDeleteModel?: (modelId: string) => boolean | Promise<boolean>;
  confirmDeleteObject?: (objectId: string, modelId: string) => boolean | Promise<boolean>;
}

interface SceneTreeNodeSpec {
  id: string;
  kind: SceneTreeNodeKind;
  title: string;
  detail?: string;
  modelId?: string;
  componentId?: string;
  objectId?: string;
  resourceKind?: SceneTreeResourceKind;
  canonicalNodeId?: string;
  attributeRole?: SceneTreeAttributeRole;
  textureBindingTexCoord?: number;
  textureBindingUVTransform?: number[];
  hasChildren?: boolean;
}

interface MaterialTextureBinding {
  label: string;
  texture: SceneTexture;
  texCoord: number;
  uvTransform: ArrayLike<number>;
}

type FolderKind = "objects" | "transforms" | "meshes" | "geometries" | "materials" | "textures" | "animations";

const FOLDER_LABELS: Record<FolderKind, string> = {
  objects: "Scene Objects",
  transforms: "Transforms",
  meshes: "Meshes",
  geometries: "Geometries",
  materials: "Materials",
  textures: "Textures",
  animations: "Animations"
};

const FOLDER_COMPONENT_KINDS: Record<FolderKind, SceneTreeNodeKind> = {
  objects: "object", transforms: "transform", meshes: "mesh", geometries: "geometry",
  materials: "material", textures: "texture", animations: "animation"
};

const tempPoint = new Float64Array(3);

export class SceneTreeStore {
  readonly scene: Scene;
  readonly viewer: Viewer;
  readonly view: View;
  state: SceneTreeState = {
    roots: [],
    busy: false,
    revision: 0,
    coordinateSystem: createCoordinateSystemState()
  };

  private readonly _nodes = new Map<string, SceneTreeNodeState>();
  /** Only ID arrays are cached. Never keep a descriptor/reactive node per source component. */
  private readonly _collections = new Map<string, PagedTreeCollection<SceneTreeNodeSpec>>();
  private readonly _pages = new PagedTreeState({
    roots: () => this.state.roots, nodes: this._nodes,
    children: (node: SceneTreeNodeState) => this._getCollection(node) || this._getChildSpecs(node),
    create: (spec: SceneTreeNodeSpec, depth: number) => this._getOrCreateNode(spec, depth),
    sync: (node: SceneTreeNodeState) => this._syncNodeState(node), touch: () => this._touch()
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
  private readonly _confirmDeleteObject?: (objectId: string, modelId: string) => boolean | Promise<boolean>;
  private readonly _cameraFlight: CameraFlightAnimation;
  private readonly _revealNode?: (nodeId: string) => Promise<void>;
  private _applyingVisibility = 0;
  private _defaultExpansionApplied = false;

  constructor(params: SceneTreeStoreParams) {
    this.scene = params.scene;
    this.viewer = params.viewer;
    this._makeReactive = params.makeReactive;
    this._confirmDeleteModel = params.confirmDeleteModel;
    this._confirmDeleteObject = params.confirmDeleteObject;
    this._revealNode = params.revealNode;
    if (this._makeReactive) {
      this.state = this._makeReactive(this.state);
    }
    this.view = params.view || params.viewer.viewList.find(Boolean);
    if (!this.view) {
      throw new Error("[SceneTreeStore] Expected a View on the Viewer");
    }
    this._cameraFlight = new CameraFlightAnimation(this.view, {duration: 0.45});
    this._populateRoots();
    this._subscribe();
  }

  destroy(): void {
    this._disposed = true;
    this._refreshQueue.dispose();
    this._cameraFlight.destroy();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
    this._nodes.clear();
    this._collections.clear();
    this._pages.dispose();
    this.state.roots.splice(0);
  }

  getNode(nodeId: string): SceneTreeNodeState | null {
    return this._nodes.get(nodeId) || null;
  }

  async toggleExpanded(node: SceneTreeNodeState): Promise<void> {
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

  getSearchEntries() {
    return treeSearchEntries<SceneTreeNodeSpec>(this.state.roots, (node) => this._iterateChildSpecs(node),
      (node) => ["scene", "model", "folder", "transform"].includes(node.kind));
  }

  getObjectPath(objectId: string): string[] | null {
    // A SceneObject may participate in multiple models. Reveal its first owning collection.
    for (const model of Object.values(this.scene.models)) {
      if (model.objects[objectId]) return ["scene", modelNodeId(model.id), folderNodeId(model.id, "objects"),
        componentNodeId(model.id, "object", objectId, folderNodeId(model.id, "objects"))];
    }
    return null;
  }

  setPage(node: SceneTreeNodeState, pageIndex: number): void {
    if (!this._disposed) this._pages.setPage(node, pageIndex);
  }

  /** Reveal a destination directly, without creating rows on preceding pages. */
  revealChild(node: SceneTreeNodeState, childId: string): void {
    if (!this._disposed) this._pages.revealChild(node, childId);
  }

  captureBranchStates(): Map<string, TreeBranchState> { return this._pages.capture(); }
  restoreBranchStates(states: ReadonlyMap<string, TreeBranchState>): void { this._pages.restore(states); }

  toggleObjectVisibility(node: SceneTreeNodeState): void {
    if (node.kind !== "object" || !node.objectId || !this.view.objects[node.objectId]) {
      return;
    }
    const nextVisible = !this.view.objects[node.objectId].visible;
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible([node.objectId], nextVisible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncObjectNode(node);
    this._touch();
  }

  setObjectVisibility(node: SceneTreeNodeState, visible: boolean): void {
    if (node.kind !== "object" || !node.objectId || !this.view.objects[node.objectId]) {
      return;
    }
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible([node.objectId], visible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncObjectNode(node);
    this._touch();
  }

  toggleModelVisibility(node: SceneTreeNodeState): void {
    if (node.kind !== "model" || !node.modelId) {
      return;
    }
    const objectIds = this._getModelViewObjectIds(node.modelId);
    if (objectIds.length === 0) {
      return;
    }
    const anyVisible = objectIds.some((objectId) => this.view.objects[objectId]?.visible);
    this._applyingVisibility++;
    try {
      this.view.setObjectsVisible(objectIds, !anyVisible);
    } finally {
      this._applyingVisibility--;
    }
    this._syncAllObjectNodes();
  }

  setModelVisibility(node: SceneTreeNodeState, visible: boolean): void {
    if (node.kind !== "model" || !node.modelId) {
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

  fitObject(node: SceneTreeNodeState): void {
    if (node.kind !== "object" || !node.objectId || !this.view.objects[node.objectId]) {
      return;
    }
    const sceneObject = this.scene.objects[node.objectId];
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

  fitScene(node: SceneTreeNodeState): void {
    if (node.kind !== "scene") {
      return;
    }
    const aabb = this._getSceneAABB();
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

  fitModel(node: SceneTreeNodeState): void {
    if (node.kind !== "model" || !node.modelId) {
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

  async confirmAndDeleteModel(node: SceneTreeNodeState): Promise<void> {
    if (node.kind !== "model" || !node.modelId) {
      return;
    }
    const confirmed = this._confirmDeleteModel
      ? await this._confirmDeleteModel(node.modelId)
      : globalThis.confirm(`Delete SceneModel "${node.modelId}"? This cannot be undone.`);
    if (confirmed) {
      this.deleteModel(node);
    }
  }

  deleteModel(node: SceneTreeNodeState): void {
    if (node.kind !== "model" || !node.modelId) {
      return;
    }
    this.scene.models[node.modelId]?.destroy();
  }

  deleteObject(node: SceneTreeNodeState): void {
    if (node.kind !== "object" || !node.modelId || !node.componentId) {
      return;
    }
    this.scene.models[node.modelId]?.objects[node.componentId]?.destroy();
  }

  async confirmAndDeleteObject(node: SceneTreeNodeState): Promise<void> {
    if (node.kind !== "object" || !node.modelId || !node.componentId) {
      return;
    }
    const confirmed = this._confirmDeleteObject
      ? await this._confirmDeleteObject(node.componentId, node.modelId)
      : globalThis.confirm(`Delete SceneObject "${node.componentId}"? This cannot be undone.`);
    if (confirmed) {
      this.deleteObject(node);
    }
  }

  fitMesh(node: SceneTreeNodeState): void {
    if (node.kind !== "mesh" || !node.modelId || !node.componentId) {
      return;
    }
    const mesh = this.scene.models[node.modelId]?.meshes[node.componentId];
    const aabb = mesh ? getSceneMeshAABB(mesh) : null;
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

  async revealReferencedResource(node: SceneTreeNodeState): Promise<void> {
    if (node.kind !== "resourceRef" || !node.modelId || !node.resourceKind || !node.canonicalNodeId) {
      return;
    }
    const folderKind = folderKindForResource(node.resourceKind);
    if (!folderKind) {
      return;
    }
    this.state.busy = true;
    try {
      const sceneNode = this.state.roots[0];
      if (!sceneNode) {
        return;
      }
      await this._ensureExpanded(sceneNode);
      const modelNode = this._nodes.get(modelNodeId(node.modelId));
      if (!modelNode) {
        return;
      }
      await this._ensureExpanded(modelNode);
      const folderNode = this._nodes.get(folderNodeId(node.modelId, folderKind));
      if (!folderNode) {
        return;
      }
      await this._ensureExpanded(folderNode);
      if (node.resourceKind !== "transform") this.revealChild(folderNode, node.canonicalNodeId);
      if (node.resourceKind === "transform") {
        const model = this.scene.models[node.modelId];
        const transform = model?.transforms[node.componentId || ""];
        if (model && transform) {
          await this._ensureTransformPathExpanded(model, transform);
        }
      }
      const canonicalNode = this._nodes.get(node.canonicalNodeId);
      if (canonicalNode) {
        canonicalNode.expanded = false;
      }
    } finally {
      this.state.busy = false;
      this._touch();
    }
    if (this._revealNode) {
      await this._revealNode(node.canonicalNodeId);
      return;
    }
    requestAnimationFrame(() => {
      document.querySelector(`[data-node-id="${cssEscape(node.canonicalNodeId!)}"]`)?.scrollIntoView({
        block: "center",
        inline: "nearest"
      });
    });
  }

  setModelCoordinateSystemPreset(node: SceneTreeNodeState, presetId: string): void {
    if (node.kind !== "model" || !node.modelId) {
      return;
    }
    const model = this.scene.models[node.modelId];
    const preset = COORDINATE_SYSTEM_PRESETS.find((candidate) => candidate.id === presetId);
    if (!model || !preset || !preset.basis) {
      this._syncModelNode(node);
      return;
    }
    model.coordinateSystem.basis = preset.basis;
    this._syncModelNode(node);
    this._touch();
  }

  private _populateRoots(): void {
    const spec: SceneTreeNodeSpec = {
      id: "scene",
      kind: "scene",
      title: "Scene",
      detail: `${Object.keys(this.scene.models).length} model${Object.keys(this.scene.models).length === 1 ? "" : "s"}`,
      hasChildren: Object.keys(this.scene.models).length > 0
    };
    const root = this._getOrCreateNode(spec, 0);
    this.state.roots.splice(0, this.state.roots.length, root);
    this._applyDefaultExpansion(root);
    this._refreshMaterializedChildren();
    this._touch();
  }

  private _loadChildren(node: SceneTreeNodeState): void {
    this._pages.load(node);
  }

  private _applyDefaultExpansion(root: SceneTreeNodeState): void {
    if (this._defaultExpansionApplied || Object.keys(this.scene.models).length === 0) {
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

  private async _ensureExpanded(node: SceneTreeNodeState): Promise<void> {
    if (!node.hasChildren) {
      return;
    }
    if (!node.expanded) {
      node.expanded = true;
    }
    if (!node.childrenLoaded) {
      node.loading = true;
      await nextFrame();
      if (this._disposed) return;
      this._loadChildren(node);
      node.loading = false;
    }
  }

  private async _ensureTransformPathExpanded(model: SceneModel, transform: SceneTransform): Promise<void> {
    if (transform.parentTransform) {
      await this._ensureTransformPathExpanded(model, transform.parentTransform);
    }
    const parentId = transform.parentTransform
      ? canonicalNodeIdForResource(model, "transform", transform.parentTransform.id)
      : folderNodeId(model.id, "transforms");
    const id = componentNodeId(model.id, "transform", transform.id, parentId);
    const parent = this._nodes.get(parentId);
    if (parent) this.revealChild(parent, id);
    const node = this._nodes.get(id);
    if (node) {
      await this._ensureExpanded(node);
    }
  }

  private _getOrCreateNode(spec: SceneTreeNodeSpec, depth: number): SceneTreeNodeState {
    let node = this._nodes.get(spec.id);
    if (node) {
      this._updateNode(node, spec, depth);
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
      objectId: spec.objectId,
      resourceKind: spec.resourceKind,
      canonicalNodeId: spec.canonicalNodeId,
      attributeRole: spec.attributeRole,
      textureBindingTexCoord: spec.textureBindingTexCoord,
      textureBindingUVTransform: spec.textureBindingUVTransform,
      modelCoordinateSystemPresetId: undefined,
      visible: false,
      hasViewObject: false
    };
    if (this._makeReactive) {
      node = this._makeReactive(node);
    }
    this._nodes.set(spec.id, node);
    this._syncNodeState(node);
    return node;
  }

  private _updateNode(node: SceneTreeNodeState, spec: SceneTreeNodeSpec, depth: number): void {
    node.kind = spec.kind;
    node.title = spec.title;
    node.detail = spec.detail || "";
    node.depth = depth;
    node.hasChildren = !!spec.hasChildren;
    node.modelId = spec.modelId;
    node.componentId = spec.componentId;
    node.objectId = spec.objectId;
    node.resourceKind = spec.resourceKind;
    node.canonicalNodeId = spec.canonicalNodeId;
    node.attributeRole = spec.attributeRole;
    node.textureBindingTexCoord = spec.textureBindingTexCoord;
    node.textureBindingUVTransform = spec.textureBindingUVTransform;
    this._syncNodeState(node);
  }

  private _getChildSpecs(node: SceneTreeNodeSpec): SceneTreeNodeSpec[] {
    if (node.kind === "scene") {
      return sortByTitle(Object.values(this.scene.models).map((model) => ({
        id: modelNodeId(model.id),
        kind: "model" as const,
        title: "SceneModel",
        detail: `${model.id}${model.updateMode ? ` - ${model.updateMode}` : ""}`,
        modelId: model.id,
        componentId: model.id,
        hasChildren: true
      })));
    }
    if (!node.modelId) {
      return [];
    }
    const model = this.scene.models[node.modelId];
    if (!model) {
      return [];
    }
    if (node.kind === "model") {
      return this._getModelFolderSpecs(model);
    }
    if (node.kind === "object") {
      const object = model.objects[node.componentId || ""];
      return object ? object.meshes.map((mesh) => meshSpec(model, mesh, node.id, "object mesh")) : [];
    }
    if (node.kind === "mesh") {
      const mesh = model.meshes[node.componentId || ""];
      return mesh ? this._getMeshChildSpecs(model, mesh, node.id) : [];
    }
    if (node.kind === "geometry") {
      const geometry = model.geometries[node.componentId || ""];
      return geometry ? getGeometryDetailSpecs(model, geometry, node.id) : [];
    }
    if (node.kind === "resourceRef" && node.resourceKind === "geometry") {
      const geometry = model.geometries[node.componentId || ""];
      return geometry ? getGeometryDetailSpecs(model, geometry, node.id) : [];
    }
    if (node.kind === "transform") {
      const transform = model.transforms[node.componentId || ""];
      return transform ? this._getTransformChildSpecs(model, transform, node.id) : [];
    }
    if (node.kind === "material") {
      const material = model.materials[node.componentId || ""];
      return material ? getMaterialDetailSpecs(model, material, node.id) : [];
    }
    if (node.kind === "resourceRef" && node.resourceKind === "material") {
      const material = model.materials[node.componentId || ""];
      return material ? getMaterialDetailSpecs(model, material, node.id) : [];
    }
    if (node.kind === "textureBinding") {
      const texture = model.textures[node.componentId || ""];
      const binding = texture ? {
        label: node.title,
        texture,
        texCoord: node.textureBindingTexCoord ?? 0,
        uvTransform: node.textureBindingUVTransform || [1, 0, 0, 1, 0, 0]
      } : null;
      return texture ? getTextureBindingDetailSpecs(model, texture, binding, node.id) : [];
    }
    if (node.kind === "texture") {
      const texture = model.textures[node.componentId || ""];
      return texture ? getTextureDetailSpecs(model, texture, node.id) : [];
    }
    if (node.kind === "resourceRef" && node.resourceKind === "texture") {
      const texture = model.textures[node.componentId || ""];
      return texture ? getTextureDetailSpecs(model, texture, node.id) : [];
    }
    if (node.kind === "animation") {
      const animation = model.animations[node.componentId || ""];
      return animation ? animation.channels.map((channel, index) => animationChannelSpec(model, animation, channel, index, node.id)) : [];
    }
    return [];
  }

  private _getModelFolderSpecs(model: SceneModel): SceneTreeNodeSpec[] {
    return ([
      ["objects", model.stats.numObjects],
      ["transforms", model.stats.numTransforms],
      ["meshes", model.stats.numMeshes],
      ["geometries", model.stats.numGeometries],
      ["materials", model.stats.numMaterials],
      ["textures", model.stats.numTextures],
      ["animations", Object.keys(model.animations).length]
    ] as Array<[FolderKind, number]>).map(([kind, count]) => folderSpec(model, kind, count));
  }

  private _getCollection(node: SceneTreeNodeSpec): PagedTreeCollection<SceneTreeNodeSpec> | null {
    if (node.kind !== "folder" || !node.modelId) return null;
    const model = this.scene.models[node.modelId];
    const kind = node.componentId as FolderKind;
    if (!model || !(kind in FOLDER_LABELS)) return null;
    let collection = this._collections.get(node.id);
    if (!collection) {
      let keys = Object.keys(model[kind]);
      if (kind === "transforms") keys = keys.filter(id => !model.transforms[id].parentTransform);
      keys.sort(naturalCompare);
      const componentKind = FOLDER_COMPONENT_KINDS[kind];
      collection = new PagedTreeCollection(keys, id => this._folderItemSpec(model, kind, id),
        id => componentNodeId(model.id, componentKind, id, node.id));
      this._collections.set(node.id, collection);
    }
    return collection;
  }

  private _folderItemSpec(model: SceneModel, kind: FolderKind, id: string): SceneTreeNodeSpec {
    const parent = folderNodeId(model.id, kind);
    switch (kind) {
      case "objects": return objectSpec(model, model.objects[id]);
      case "transforms": return transformSpec(model, model.transforms[id], parent, "root");
      case "meshes": return meshSpec(model, model.meshes[id], parent, "");
      case "geometries": return geometrySpec(model, model.geometries[id], parent);
      case "materials": return materialSpec(model, model.materials[id], parent);
      case "textures": return textureSpec(model, model.textures[id], parent);
      case "animations": return animationSpec(model, model.animations[id], parent);
    }
  }

  private *_iterateChildSpecs(node: SceneTreeNodeSpec): Generator<SceneTreeNodeSpec> {
    const model = node.modelId && this.scene.models[node.modelId];
    if (model && node.kind === "folder") {
      const kind = node.componentId as FolderKind;
      if (!(kind in FOLDER_LABELS)) return;
      // Search streams all source entries independently of the current page and row cache.
      for (const id in model[kind]) {
        if (!Object.prototype.hasOwnProperty.call(model[kind], id)) continue;
        if (kind === "transforms" && model.transforms[id].parentTransform) continue;
        yield this._folderItemSpec(model, kind, id);
      }
    } else {
      yield* this._getChildSpecs(node);
    }
  }

  private _getMeshChildSpecs(model: SceneModel, mesh: SceneMesh, parentId: string): SceneTreeNodeSpec[] {
    const specs: SceneTreeNodeSpec[] = [];
    specs.push(resourceRefSpec(model, "geometry", mesh.geometry.id, parentId, "SceneGeometry"));
    if (mesh.parentTransform) {
      specs.push(resourceRefSpec(model, "transform", mesh.parentTransform.id, parentId, "SceneTransform"));
    }
    if (mesh.material) {
      specs.push(resourceRefSpec(model, "material", mesh.material.id, parentId, "SceneMaterial"));
    }
    return specs;
  }

  private _getTransformChildSpecs(model: SceneModel, transform: SceneTransform, parentId: string): SceneTreeNodeSpec[] {
    const childTransforms = transform.childTransforms.map((child) => transformSpec(model, child, parentId, "child"));
    const childMeshes = transform.childMeshes.map((mesh) => meshSpec(model, mesh, parentId, "child mesh"));
    return sortByTitle([...childTransforms, ...childMeshes]);
  }

  private _refreshMaterializedChildren(): void {
    this._pages.refresh();
  }

  private _syncObjectNode(node: SceneTreeNodeState): void {
    if (node.kind === "model" && node.modelId) {
      const objectIds = this._getModelViewObjectIds(node.modelId);
      node.hasViewObject = objectIds.length > 0;
      Object.assign(node, summarizeVisibility(objectIds, this.view.objects));
      node.visible = node.visibleCount > 0;
      return;
    }
    if (node.kind !== "object" || !node.objectId) {
      node.hasViewObject = false;
      node.visible = false;
      return;
    }
    const viewObject = this.view.objects[node.objectId];
    Object.assign(node, summarizeVisibility([node.objectId], this.view.objects));
    node.hasViewObject = !!viewObject;
    node.visible = !!viewObject?.visible;
  }

  private _syncModelNode(node: SceneTreeNodeState): void {
    if (node.kind !== "model" || !node.modelId) {
      node.modelCoordinateSystemPresetId = undefined;
      return;
    }
    const model = this.scene.models[node.modelId];
    node.modelCoordinateSystemPresetId = model ? matchCoordinateSystemPreset(model.coordinateSystem.basis) : "custom";
  }

  private _syncNodeState(node: SceneTreeNodeState): void {
    this._syncObjectNode(node);
    this._syncModelNode(node);
  }

  private _getModelViewObjectIds(modelId: string): string[] {
    const model = this.scene.models[modelId];
    if (!model) {
      return [];
    }
    return Object.keys(model.objects).filter((objectId) => !!this.view.objects[objectId]);
  }

  private _getSceneAABB(): AABB3 | null {
    const aabb = collapseAABB3(createAABB3Float64());
    let found = false;
    for (const modelId of Object.keys(this.scene.models)) {
      const modelAABB = this._getModelAABB(modelId);
      if (!modelAABB) {
        continue;
      }
      expandAABB3Point3(aabb, modelAABB as any);
      tempPoint[0] = modelAABB[3];
      tempPoint[1] = modelAABB[4];
      tempPoint[2] = modelAABB[5];
      expandAABB3Point3(aabb, tempPoint as any);
      found = true;
    }
    return found ? aabb : null;
  }

  private _getModelAABB(modelId: string): AABB3 | null {
    const model = this.scene.models[modelId];
    if (!model) {
      return null;
    }
    const aabb = collapseAABB3(createAABB3Float64());
    let found = false;
    for (const sceneObject of Object.values(model.objects)) {
      const objectAABB = getSceneObjectAABB(sceneObject);
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

  private _syncAllObjectNodes(): void {
    for (const node of displayedTreeNodes(this.state.roots)) {
      this._syncObjectNode(node);
    }
  }

  private _subscribe(): void {
    const refresh = () => {
      this._refreshQueue.request("structure");
    };
    const refreshCollections = (kind?: FolderKind) => () => {
      for (const id of this._collections.keys()) {
        if (!kind || this._nodes.get(id)?.componentId === kind) this._collections.delete(id);
      }
      refresh();
    };
    const refreshModelCoordinateSystems = () => {
      for (const node of this._nodes.values()) {
        this._syncModelNode(node);
      }
      this._touch();
    };
    const refreshViewObjects = (view: View) => {
      if (view === this.view) {
        this._refreshQueue.request("state");
      }
    };
    this._unsubscribers.push(
      this.scene.events.onSceneModelCreated.subscribe(refresh),
      this.scene.events.onSceneModelCoordSystemUpdated.subscribe(refreshModelCoordinateSystems),
      this.scene.events.onSceneModelDestroyed.subscribe(refreshCollections()),
      this.scene.events.onSceneModelBuildFinished.subscribe(refreshCollections()),
      this.scene.events.onSceneObjectCreated.subscribe(refreshCollections("objects")),
      this.scene.events.onSceneObjectDestroyed.subscribe(refreshCollections("objects")),
      this.scene.events.onSceneObjectMeshAdded.subscribe(refresh),
      this.scene.events.onSceneObjectMeshRemoved.subscribe(refresh),
      this.scene.events.onSceneMeshCreated.subscribe(refreshCollections("meshes")),
      this.scene.events.onSceneMeshDestroyed.subscribe(refreshCollections("meshes")),
      this.scene.events.onSceneGeometryCreated.subscribe(refreshCollections("geometries")),
      this.scene.events.onSceneGeometryDestroyed.subscribe(refreshCollections("geometries")),
      this.scene.events.onSceneTransformCreated.subscribe(refreshCollections("transforms")),
      this.scene.events.onSceneTransformDestroyed.subscribe(refreshCollections("transforms")),
      this.scene.events.onSceneMaterialCreated.subscribe(refreshCollections("materials")),
      this.scene.events.onSceneMaterialDestroyed.subscribe(refreshCollections("materials")),
      this.scene.events.onSceneTextureCreated.subscribe(refreshCollections("textures")),
      this.scene.events.onSceneTextureDestroyed.subscribe(refreshCollections("textures")),
      this.scene.events.onSceneAnimationCreated.subscribe(refreshCollections("animations")),
      this.scene.events.onSceneAnimationDestroyed.subscribe(refreshCollections("animations")),
      this.viewer.events.onViewObjectCreated.subscribe(refreshViewObjects),
      this.viewer.events.onViewObjectDestroyed.subscribe(refreshViewObjects),
      this.viewer.events.onViewObjectVisibleChanged.subscribe((view: View) => {
        if (view === this.view && this._applyingVisibility === 0) {
          this._refreshQueue.request("state");
        }
      })
    );
  }

  private _touch(): void {
    this.state.revision++;
  }
}

function objectSpec(model: SceneModel, object: SceneObject): SceneTreeNodeSpec {
  const objectLabel = object.originalSystemId || object.id;
  return {
    id: componentNodeId(model.id, "object", object.id, folderNodeId(model.id, "objects")),
    kind: "object",
    title: "SceneObject",
    detail: `${objectLabel} - ${object.meshes.length} mesh${object.meshes.length === 1 ? "" : "es"}`,
    modelId: model.id,
    componentId: object.id,
    objectId: object.id,
    hasChildren: object.meshes.length > 0
  };
}

function meshSpec(model: SceneModel, mesh: SceneMesh, parentId: string, detail: string): SceneTreeNodeSpec {
  return {
    id: componentNodeId(model.id, "mesh", mesh.id, parentId),
    kind: "mesh",
    title: "SceneMesh",
    detail: detail ? `${mesh.id} - ${detail}` : mesh.id,
    modelId: model.id,
    componentId: mesh.id,
    hasChildren: true
  };
}

function geometrySpec(model: SceneModel, geometry: SceneGeometry, parentId: string): SceneTreeNodeSpec {
  const vertexCount = geometry.positionsCompressed ? Math.floor(geometry.positionsCompressed.length / 3) : 0;
  const indexCount = geometry.indices ? geometry.indices.length : 0;
  return {
    id: componentNodeId(model.id, "geometry", geometry.id, parentId),
    kind: "geometry",
    title: "SceneGeometry",
    detail: `${geometry.id} - ${vertexCount} vertices${indexCount > 0 ? `, ${indexCount} indices` : ""}`,
    modelId: model.id,
    componentId: geometry.id,
    hasChildren: true
  };
}

function transformSpec(model: SceneModel, transform: SceneTransform, parentId: string, detail: string): SceneTreeNodeSpec {
  const childCount = transform.childTransforms.length + transform.childMeshes.length;
  return {
    id: componentNodeId(model.id, "transform", transform.id, parentId),
    kind: "transform",
    title: "SceneTransform",
    detail: `${transform.id}${detail ? ` - ${detail}` : ""}${childCount > 0 ? ` - ${childCount} child${childCount === 1 ? "" : "ren"}` : ""}`,
    modelId: model.id,
    componentId: transform.id,
    hasChildren: childCount > 0
  };
}

function materialSpec(model: SceneModel, material: SceneMaterial, parentId: string): SceneTreeNodeSpec {
  const textureCount = getMaterialTextureBindings(material).length;
  return {
    id: componentNodeId(model.id, "material", material.id, parentId),
    kind: "material",
    title: "SceneMaterial",
    detail: `${material.id}${textureCount > 0 ? ` - ${textureCount} texture${textureCount === 1 ? "" : "s"}` : ""}`,
    modelId: model.id,
    componentId: material.id,
    hasChildren: true
  };
}

function textureSpec(model: SceneModel, texture: SceneTexture, parentId: string): SceneTreeNodeSpec {
  return {
    id: componentNodeId(model.id, "texture", texture.id, parentId),
    kind: "texture",
    title: "SceneTexture",
    detail: texture.id,
    modelId: model.id,
    componentId: texture.id,
    hasChildren: true
  };
}

function getGeometryDetailSpecs(model: SceneModel, geometry: SceneGeometry, parentId: string): SceneTreeNodeSpec[] {
  const specs: SceneTreeNodeSpec[] = [
    propertySpec(model, parentId, "Primitive", primitiveLabel(geometry.primitive), "property")
  ];
  if (geometry.aabb) {
    specs.push(propertySpec(model, parentId, "AABB", formatAABB(geometry.aabb), "property"));
  }
  specs.push(propertySpec(model, parentId, "Version", `${geometry.version}`, "property"));
  specs.push(attributeSpec(model, parentId, "Positions", geometry.positionsCompressed, "positions", 3, "quantized XYZ"));
  specs.push(attributeSpec(model, parentId, "Normals", geometry.normalsCompressed, "normals", 2, "oct-encoded"));
  specs.push(attributeSpec(model, parentId, "UVs", geometry.uvsCompressed, "uvs", 2, "channel 0"));
  const texCoords = geometry.texCoordsCompressed || {};
  for (const channel of Object.keys(texCoords).map(Number).sort((a, b) => a - b)) {
    if (channel === 0 && geometry.uvsCompressed === texCoords[channel]) {
      continue;
    }
    specs.push(attributeSpec(model, parentId, `UV Channel ${channel}`, texCoords[channel], "uvs", 2, "texture coordinates"));
  }
  specs.push(attributeSpec(model, parentId, "Colors", geometry.colorsCompressed, "colors", 4, "RGBA"));
  specs.push(attributeSpec(model, parentId, "Indices", geometry.indices, "indices", 1, "primitive connectivity"));
  specs.push(attributeSpec(model, parentId, "Edge Indices", geometry.edgeIndices, "edges", 1, "edge connectivity"));
  specs.push(collectionSpec(model, parentId, "Vertex States", geometry.vertexStatesCompressed?.length || 0, "frames"));
  specs.push(collectionSpec(model, parentId, "Frames", geometry.framesCompressed?.length || 0, "frames"));
  specs.push(collectionSpec(model, parentId, "Morph Targets", geometry.morphTargets?.length || 0, "morphs"));
  specs.push(attributeSpec(model, parentId, "Splat Scales", geometry.scales, "splats", 3, "per-splat scale"));
  specs.push(attributeSpec(model, parentId, "Splat Rotations", geometry.rotations, "splats", 4, "per-splat quaternion"));
  return specs.filter((spec) => spec.detail !== "absent");
}

function propertySpec(model: SceneModel, parentId: string, title: string, detail: string, role: SceneTreeAttributeRole): SceneTreeNodeSpec {
  return {
    id: componentNodeId(model.id, "property", `${title}:${detail}`, parentId),
    kind: "property",
    title,
    detail,
    modelId: model.id,
    attributeRole: role,
    hasChildren: false
  };
}

function attributeSpec(
  model: SceneModel,
  parentId: string,
  title: string,
  array: ArrayLike<number> | undefined,
  role: SceneTreeAttributeRole,
  tupleSize: number,
  note: string
): SceneTreeNodeSpec {
  if (!array) {
    return propertySpec(model, parentId, title, "absent", role);
  }
  const tupleCount = tupleSize > 1 ? Math.floor(array.length / tupleSize) : array.length;
  const typeName = arrayTypeName(array);
  const tupleLabel = tupleSize > 1 ? `${tupleCount} x ${tupleSize}` : `${tupleCount}`;
  return {
    id: componentNodeId(model.id, "attribute", title, parentId),
    kind: "attribute",
    title,
    detail: `${typeName}[${array.length}] - ${tupleLabel}${note ? `, ${note}` : ""}`,
    modelId: model.id,
    attributeRole: role,
    hasChildren: false
  };
}

function collectionSpec(model: SceneModel, parentId: string, title: string, count: number, role: SceneTreeAttributeRole): SceneTreeNodeSpec {
  return {
    id: componentNodeId(model.id, "attribute", title, parentId),
    kind: "attribute",
    title,
    detail: `${count}`,
    modelId: model.id,
    attributeRole: role,
    hasChildren: false
  };
}

function createCoordinateSystemState(): SceneTreeCoordinateSystemState {
  return {
    presets: COORDINATE_SYSTEM_PRESETS.filter((preset) => !!preset.basis)
  };
}

function matchCoordinateSystemPreset(basis: ArrayLike<number>): string {
  const preset = COORDINATE_SYSTEM_PRESETS.find((candidate) => candidate.basis && arraysEqual(candidate.basis, basis));
  return preset?.id || "custom";
}

function arraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0, len = a.length; i < len; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) {
      return false;
    }
  }
  return true;
}

function getMaterialDetailSpecs(model: SceneModel, material: SceneMaterial, parentId: string): SceneTreeNodeSpec[] {
  return [
    propertySpec(model, parentId, "Color", formatVec(material.color), "material"),
    propertySpec(model, parentId, "Emissive Color", formatVec(material.emissiveColor), "material"),
    propertySpec(model, parentId, "Opacity", formatNumber(material.opacity), "material"),
    propertySpec(model, parentId, "Roughness", formatNumber(material.roughness), "material"),
    propertySpec(model, parentId, "Metallic", formatNumber(material.metallic), "material"),
    propertySpec(model, parentId, "IOR", formatNumber(material.ior), "material"),
    propertySpec(model, parentId, "Clearcoat", formatNumber(material.clearcoat), "material"),
    propertySpec(model, parentId, "Clearcoat Roughness", formatNumber(material.clearcoatRoughness), "material"),
    propertySpec(model, parentId, "Sheen", formatNumber(material.sheen), "material"),
    propertySpec(model, parentId, "Sheen Roughness", formatNumber(material.sheenRoughness), "material"),
    propertySpec(model, parentId, "Transmission", formatNumber(material.transmission), "material"),
    propertySpec(model, parentId, "Thickness", formatNumber(material.thickness), "material"),
    propertySpec(model, parentId, "Attenuation Color", formatVec(material.attenuationColor), "material"),
    propertySpec(model, parentId, "Attenuation Distance", formatNumber(material.attenuationDistance), "material"),
    propertySpec(model, parentId, "Alpha Mode", alphaModeLabel(material.alphaMode), "material"),
    propertySpec(model, parentId, "Alpha Cutoff", formatNumber(material.alphaCutoff), "material"),
    propertySpec(model, parentId, "Triplanar Scale", formatNumber(material.triplanarScale), "material"),
    propertySpec(model, parentId, "Line Width", formatNumber(material.lineWidth), "material"),
    propertySpec(model, parentId, "Line Pattern", formatValue(material.linePattern), "material"),
    propertySpec(model, parentId, "Hatch Pattern", formatValue(material.hatchPattern), "material"),
    propertySpec(model, parentId, "Mesh References", `${material.numMeshes}`, "material"),
    ...getMaterialTextureSpecs(model, material, parentId)
  ];
}

function getTextureBindingDetailSpecs(
  model: SceneModel,
  texture: SceneTexture,
  binding: MaterialTextureBinding | null,
  parentId: string
): SceneTreeNodeSpec[] {
  const specs: SceneTreeNodeSpec[] = [];
  if (binding) {
    specs.push(propertySpec(model, parentId, "Texture Coordinate", `${binding.texCoord}`, "texture"));
    specs.push(propertySpec(model, parentId, "UV Transform", formatArray(binding.uvTransform), "texture"));
  }
  specs.push(resourceRefSpec(model, "texture", texture.id, parentId, "SceneTexture"));
  return specs;
}

function getTextureDetailSpecs(model: SceneModel, texture: SceneTexture, parentId: string): SceneTreeNodeSpec[] {
  const specs: SceneTreeNodeSpec[] = [
    propertySpec(model, parentId, "Size", `${texture.width} x ${texture.height}`, "texture"),
    propertySpec(model, parentId, "Compressed", String(texture.compressed), "texture"),
    propertySpec(model, parentId, "Media Type", texture.mediaType !== undefined ? `${texture.mediaType}` : "none", "texture"),
    propertySpec(model, parentId, "Encoding", `${texture.encoding}`, "texture"),
    propertySpec(model, parentId, "Min Filter", `${texture.minFilter}`, "texture"),
    propertySpec(model, parentId, "Mag Filter", `${texture.magFilter}`, "texture"),
    propertySpec(model, parentId, "Wrap S", `${texture.wrapS}`, "texture"),
    propertySpec(model, parentId, "Wrap T", `${texture.wrapT}`, "texture"),
    propertySpec(model, parentId, "Wrap R", `${texture.wrapR}`, "texture"),
    propertySpec(model, parentId, "Flip Y", String(texture.flipY), "texture"),
    propertySpec(model, parentId, "Mipmap", String(texture.mipmap), "texture"),
    propertySpec(model, parentId, "Texture Bytes", `${texture.textureBytes}`, "texture"),
    propertySpec(model, parentId, "Material References", `${texture.numMaterials}`, "texture")
  ];
  if (texture.src) {
    specs.push(propertySpec(model, parentId, "Source", shortenMiddle(texture.src, 84), "texture"));
  }
  if (texture.buffers) {
    specs.push(collectionSpec(model, parentId, "Buffers", texture.buffers.length, "texture"));
  }
  return specs;
}

function resourceRefSpec(
  model: SceneModel,
  resourceKind: SceneTreeResourceKind,
  resourceId: string,
  parentId: string,
  title: string
): SceneTreeNodeSpec {
  return {
    id: componentNodeId(model.id, "resourceRef", `${resourceKind}:${resourceId}`, parentId),
    kind: "resourceRef",
    title,
    detail: resourceId,
    modelId: model.id,
    componentId: resourceId,
    resourceKind,
    canonicalNodeId: canonicalNodeIdForResource(model, resourceKind, resourceId),
    hasChildren: resourceKind === "geometry" || resourceKind === "material" || resourceKind === "texture"
  };
}

function textureBindingSpec(model: SceneModel, binding: MaterialTextureBinding, parentId: string): SceneTreeNodeSpec {
  return {
    id: componentNodeId(model.id, "textureBinding", `${binding.label}:${binding.texture.id}`, parentId),
    kind: "textureBinding",
    title: binding.label,
    detail: binding.texture.id,
    modelId: model.id,
    componentId: binding.texture.id,
    textureBindingTexCoord: binding.texCoord,
    textureBindingUVTransform: Array.from(binding.uvTransform),
    hasChildren: true
  };
}

function animationSpec(model: SceneModel, animation: SceneAnimation, parentId: string): SceneTreeNodeSpec {
  const channelCount = animation.channels.length;
  return {
    id: componentNodeId(model.id, "animation", animation.id, parentId),
    kind: "animation",
    title: "SceneAnimation",
    detail: `${animation.name || animation.id} - ${channelCount} channel${channelCount === 1 ? "" : "s"}, ${formatSeconds(animation.startTime)}s-${formatSeconds(animation.endTime)}s`,
    modelId: model.id,
    componentId: animation.id,
    hasChildren: channelCount > 0
  };
}

function animationChannelSpec(
  model: SceneModel,
  animation: SceneAnimation,
  channel: SceneAnimationChannelParams,
  index: number,
  parentId: string
): SceneTreeNodeSpec {
  const target = formatAnimationTarget(channel.target);
  const sampleCount = channel.sampler.times.length;
  return {
    id: componentNodeId(model.id, "animationChannel", `${animation.id}:${index}`, parentId),
    kind: "animationChannel",
    title: `Channel ${index + 1}`,
    detail: `${target} - ${sampleCount} sample${sampleCount === 1 ? "" : "s"} ${channel.sampler.interpolation ?? "LINEAR"}`,
    modelId: model.id,
    componentId: `${animation.id}:${index}`,
    hasChildren: false
  };
}

function folderSpec(model: SceneModel, kind: FolderKind, count: number): SceneTreeNodeSpec {
  return {
    id: folderNodeId(model.id, kind),
    kind: "folder",
    title: FOLDER_LABELS[kind],
    detail: `${count}`,
    modelId: model.id,
    componentId: kind,
    hasChildren: count > 0
  };
}

function getMaterialTextureSpecs(model: SceneModel, material: SceneMaterial, parentId: string): SceneTreeNodeSpec[] {
  return getMaterialTextureBindings(material).map((binding) => textureBindingSpec(model, binding, parentId));
}

function getMaterialTextureBindings(material: SceneMaterial): MaterialTextureBinding[] {
  const bindings: MaterialTextureBinding[] = [];
  if (material.colorTexture) {
    bindings.push({
      label: "Color Texture",
      texture: material.colorTexture,
      texCoord: material.colorTextureTexCoord,
      uvTransform: material.colorTextureUVTransform
    });
  }
  if (material.metallicRoughnessTexture) {
    bindings.push({
      label: "Metallic-Roughness Texture",
      texture: material.metallicRoughnessTexture,
      texCoord: material.metallicRoughnessTextureTexCoord,
      uvTransform: material.metallicRoughnessTextureUVTransform
    });
  }
  if (material.normalsTexture) {
    bindings.push({
      label: "Normal Texture",
      texture: material.normalsTexture,
      texCoord: material.normalsTextureTexCoord,
      uvTransform: material.normalsTextureUVTransform
    });
  }
  if (material.occlusionTexture) {
    bindings.push({
      label: "Occlusion Texture",
      texture: material.occlusionTexture,
      texCoord: material.occlusionTextureTexCoord,
      uvTransform: material.occlusionTextureUVTransform
    });
  }
  if (material.emissiveTexture) {
    bindings.push({
      label: "Emissive Texture",
      texture: material.emissiveTexture,
      texCoord: material.emissiveTextureTexCoord,
      uvTransform: material.emissiveTextureUVTransform
    });
  }
  return bindings;
}

function formatAnimationTarget(target: SceneAnimationChannelParams["target"]): string {
  if (target.type === "transform") {
    return `Transform ${target.transformId} ${target.property}`;
  }
  if (target.type === "vertexState") {
    return `Mesh ${target.meshId} vertex state`;
  }
  return `Mesh ${target.meshId} morph weights`;
}

function formatSeconds(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "0";
}

function primitiveLabel(primitive: number): string {
  switch (primitive) {
    case PointsPrimitive:
      return "Points";
    case LinesPrimitive:
      return "Lines";
    case TrianglesPrimitive:
      return "Triangles";
    case SolidPrimitive:
      return "Solid";
    case SurfacePrimitive:
      return "Surface";
    case GaussianSplatsPrimitive:
      return "Gaussian Splats";
    default:
      return `Unknown (${primitive})`;
  }
}

function arrayTypeName(array: ArrayLike<number>): string {
  const typedArray = array as {constructor?: {name?: string}};
  return typedArray.constructor?.name || "Array";
}

function alphaModeLabel(alphaMode: number): string {
  return alphaMode === 1 ? "MASK" : alphaMode === 2 ? "BLEND" : "OPAQUE";
}

function formatVec(value: ArrayLike<number> | undefined): string {
  return value ? formatArray(value) : "none";
}

function formatArray(value: ArrayLike<number>): string {
  return `[${Array.from(value).map((item) => formatNumber(item)).join(", ")}]`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "none";
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return shortenMiddle(JSON.stringify(value), 84);
  } catch {
    return String(value);
  }
}

function shortenMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const sideLength = Math.max(4, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, sideLength)}...${value.slice(value.length - sideLength)}`;
}

function formatAABB(aabb: ArrayLike<number>): string {
  if (aabb.length < 6) {
    return "invalid";
  }
  return `[${formatNumber(aabb[0])}, ${formatNumber(aabb[1])}, ${formatNumber(aabb[2])}] - [${formatNumber(aabb[3])}, ${formatNumber(aabb[4])}, ${formatNumber(aabb[5])}]`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : String(value);
}

function modelNodeId(modelId: string): string {
  return `model:${modelId}`;
}

function folderNodeId(modelId: string, kind: FolderKind): string {
  return `folder:${modelId}:${kind}`;
}

function folderKindForResource(resourceKind: SceneTreeResourceKind): FolderKind | null {
  switch (resourceKind) {
    case "mesh":
      return "meshes";
    case "geometry":
      return "geometries";
    case "transform":
      return "transforms";
    case "material":
      return "materials";
    case "texture":
      return "textures";
    case "animation":
      return "animations";
    default:
      return null;
  }
}

function canonicalNodeIdForResource(model: SceneModel, resourceKind: SceneTreeResourceKind, resourceId: string): string | undefined {
  if (resourceKind === "transform") {
    const transform = model.transforms[resourceId];
    if (!transform) {
      return undefined;
    }
    const parentId = transform.parentTransform
      ? canonicalNodeIdForResource(model, "transform", transform.parentTransform.id)
      : folderNodeId(model.id, "transforms");
    return parentId ? componentNodeId(model.id, "transform", transform.id, parentId) : undefined;
  }
  const folderKind = folderKindForResource(resourceKind);
  return folderKind ? componentNodeId(model.id, resourceKind, resourceId, folderNodeId(model.id, folderKind)) : undefined;
}

function componentNodeId(modelId: string, kind: SceneTreeNodeKind, componentId: string, parentId: string): string {
  return `${kind}:${modelId}:${componentId}:in:${parentId}`;
}

function sortByTitle<T extends {title: string; id: string}>(items: T[]): T[] {
  return items.sort((a, b) => naturalCompare(a.title, b.title) || naturalCompare(a.id, b.id));
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

function getSceneMeshAABB(mesh: SceneMesh): AABB3 | null {
  const geometryAABB = mesh.geometry.aabb;
  if (!geometryAABB) {
    return null;
  }
  const aabb = collapseAABB3(createAABB3Float64());
  expandTransformedAABB(aabb, geometryAABB, mesh.worldMatrix);
  return aabb;
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

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
