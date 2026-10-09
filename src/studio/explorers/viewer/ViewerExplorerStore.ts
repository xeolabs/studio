import {objectEffects, objectHasEffect, setObjectEffect, type ObjectEffectId, type ObjectEffects} from "../tree/objectEffects";
import {viewIsolation} from "../../services/ViewIsolation";
import {collapseAABB3, createAABB3Float64, expandAABB3Point3, type AABB3} from "@xeokit/sdk/base/math/boundaries";
import {transformPoint3} from "@xeokit/sdk/base/math/matrix";
import {
  CustomProjectionType,
  FrustumProjectionType,
  OrthoProjectionType,
  PerspectiveProjectionType
} from "@xeokit/sdk/base/constants";
import type {SceneObject} from "@xeokit/sdk/model/scene";
import {StudioCameraFlight as CameraFlightAnimation} from "../../services/StudioCameraFlight";
import {parseNumericInput} from "../tree/numericInput";
import {parseMatrixValue} from "./matrixInput";
import {naturalCompare} from "../tree/naturalCompare";
import {PagedTreeCollection, indexTreeCollection, recordKeys, type TreeCollectionSource} from "../tree/PagedTreeCollection";
import {PagedTreeState, type TreeBranchState} from "../tree/PagedTreeState";
import {ExplorerRefreshQueue} from "../tree/ExplorerRefreshQueue";
import {displayedTreeNodes} from "../tree/displayedTreeNodes";
import type {Renderer} from "@xeokit/sdk/viewing/rendering/core";
import type {View, Viewer, ViewLayer, ViewObject} from "@xeokit/sdk/viewing/viewer";

export type ViewerExplorerNodeKind =
  | "viewer"
  | "renderer"
  | "view"
  | "folder"
  | "layer"
  | "object"
  | "camera"
  | "cameraComponent"
  | "effects"
  | "effect"
  | "lights"
  | "light"
  | "sectionPlane"
  | "transform"
  | "property";

export type ViewerExplorerFolderKind =
  | "views"
  | "layers"
  | "objects"
  | "visibleObjects"
  | "colorizedObjects"
  | "opacityObjects"
  | "sectionPlanes"
  | "transforms"
  | "viewObjects"
  | "camera"
  | "effects"
  | "lights"
  | "properties";

export interface ViewerExplorerNodeState {
  id: string;
  kind: ViewerExplorerNodeKind;
  title: string;
  detail: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  childrenLoaded: boolean;
  children: ViewerExplorerNodeState[];
  childCount: number;
  pageIndex: number;
  viewId?: string;
  componentId?: string;
  folderKind?: ViewerExplorerFolderKind;
  visible: boolean;
  hasViewObject: boolean;
  canFit: boolean;
  controlsRevision: number;
  effects: ObjectEffects;
}

export type ViewerExplorerControlKind = "boolean" | "number" | "select" | "color" | "vec3" | "mat4";

export interface ViewerExplorerControlOption {
  label: string;
  value: string | number | boolean;
}

export interface ViewerExplorerControlState {
  id: string;
  label: string;
  kind: ViewerExplorerControlKind;
  value: string | number | boolean | number[];
  min?: number;
  max?: number;
  step?: number;
  options?: ViewerExplorerControlOption[];
}

export interface ViewerExplorerState {
  roots: ViewerExplorerNodeState[];
  busy: boolean;
  revision: number;
  activeNodeId: string;
}

export interface ViewerExplorerStoreParams {
  viewer: Viewer;
  renderer?: Renderer | null;
  rendererLabel?: string;
  makeReactive?: <T extends object>(value: T) => T;
}

interface ViewerExplorerNodeSpec {
  id: string;
  kind: ViewerExplorerNodeKind;
  title: string;
  detail?: string;
  viewId?: string;
  componentId?: string;
  folderKind?: ViewerExplorerFolderKind;
  hasChildren?: boolean;
  visible?: boolean;
  hasViewObject?: boolean;
  canFit?: boolean;
  effects?: ObjectEffects;
}

interface EffectControlDescriptor {
  id: string;
  label: string;
  kind: ViewerExplorerControlKind;
  min?: number;
  max?: number;
  step?: number;
  options?: ViewerExplorerControlOption[];
}

type ControlDescriptor = EffectControlDescriptor;

const VIEW_FOLDER_LABELS: Partial<Record<ViewerExplorerFolderKind, string>> = {
  camera: "Camera",
  layers: "ViewLayers",
  objects: "ViewObjects",
  visibleObjects: "Visible Objects",
  colorizedObjects: "Colorized Objects",
  opacityObjects: "Opacity Objects",
  effects: "Effects",
  lights: "Lights",
  sectionPlanes: "SectionPlanes",
  transforms: "ViewTransforms"
};

const EFFECT_CONTROL_DEFINITIONS: Record<string, EffectControlDescriptor[]> = {
  sao: [
    booleanControl("enabled", "Enabled"),
    numberControl("kernelRadius", "Kernel Radius", 0, 400, 1),
    numberControl("intensity", "Intensity", 0, 2, 0.01),
    numberControl("bias", "Bias", 0, 2, 0.01),
    numberControl("scale", "Scale", 0, 4, 0.01),
    numberControl("minResolution", "Min Resolution", 0, 1, 0.01),
    numberControl("numSamples", "Samples", 1, 64, 1),
    booleanControl("blur", "Blur"),
    numberControl("blendCutoff", "Blend Cutoff", 0, 1, 0.01),
    numberControl("blendFactor", "Blend Factor", 0, 4, 0.01),
    selectControl("debug", "Debug", [
      option("Off", false),
      option("Linear Depth", "linearDepth"),
      option("Normal", "normal"),
      option("Raw Occlusion", "rawOcclusion"),
      option("Blurred Occlusion", "blurredOcclusion"),
      option("Final Factor", "finalFactor")
    ])
  ],
  edges: [
    booleanControl("enabled", "Enabled"),
    colorControl("edgeColor", "Edge Color"),
    booleanControl("useMeshColor", "Use Mesh Color"),
    numberControl("edgeDarken", "Edge Darken", 0, 1, 0.01),
    numberControl("edgeAlpha", "Edge Alpha", 0, 1, 0.01),
    numberControl("edgeWidth", "Edge Width", 0, 8, 0.1),
    numberControl("edgeFadeStart", "Fade Start", 0, 1, 0.01),
    numberControl("edgeFadeEnd", "Fade End", 0, 1, 0.01)
  ],
  bloom: [
    booleanControl("enabled", "Enabled"),
    numberControl("threshold", "Threshold", 0, 16, 0.05),
    numberControl("knee", "Knee", 0, 4, 0.01),
    numberControl("intensity", "Intensity", 0, 4, 0.01)
  ],
  atmosphere: [
    booleanControl("enabled", "Enabled"),
    colorControl("color", "Color"),
    numberControl("startDistance", "Start Distance", 0, 1000, 1),
    numberControl("endDistance", "End Distance", 1, 3000, 1),
    numberControl("intensity", "Intensity", 0, 1, 0.01),
    numberControl("maxOpacity", "Max Opacity", 0, 1, 0.01),
    booleanControl("affectSky", "Affect Sky")
  ],
  depthOfField: [
    booleanControl("enabled", "Enabled"),
    numberControl("focusDistance", "Focus Distance", 0.1, 1000, 0.5),
    numberControl("focalRange", "Focal Range", 0.1, 1000, 0.5),
    numberControl("radius", "Radius", 0, 12, 0.1),
    numberControl("intensity", "Intensity", 0, 1, 0.01),
    numberControl("nearBlur", "Near Blur", 0, 1, 0.01),
    numberControl("farBlur", "Far Blur", 0, 1, 0.01)
  ],
  colorGrading: [
    booleanControl("enabled", "Enabled"),
    numberControl("brightness", "Brightness", -1, 1, 0.01),
    numberControl("contrast", "Contrast", 0, 4, 0.01),
    numberControl("saturation", "Saturation", 0, 4, 0.01),
    numberControl("gamma", "Gamma", 0.1, 4, 0.01),
    numberControl("temperature", "Temperature", -1, 1, 0.01),
    numberControl("tint", "Tint", -1, 1, 0.01)
  ],
  tonemap: [
    booleanControl("enabled", "Enabled"),
    numberControl("exposure", "Exposure", 0, 8, 0.01),
    selectControl("mode", "Mode", [
      option("None", "none"),
      option("Reinhard", "reinhard"),
      option("ACES", "aces")
    ]),
    booleanControl("sRGBEncode", "sRGB Encode"),
    numberControl("renderScale", "Render Scale", 0.25, 2, 0.05)
  ],
  antiAliasing: [
    booleanControl("enabled", "Enabled"),
    selectControl("mode", "Mode", [
      option("None", "none"),
      option("FXAA", "fxaa"),
      option("SMAA", "smaa")
    ])
  ],
  texturing: [
    booleanControl("enabled", "Enabled")
  ],
  resolutionScale: [
    booleanControl("enabled", "Enabled"),
    numberControl("resolutionScale", "Resolution Scale", 0.1, 1, 0.01)
  ],
  shadows: [
    booleanControl("enabled", "Enabled"),
    numberControl("intensity", "Intensity", 0, 1, 0.01),
    numberControl("bias", "Bias", 0, 0.02, 0.0001),
    numberControl("projectionSize", "Projection Size", 1, 500, 1),
    numberControl("lightDistance", "Light Distance", 1, 1000, 1),
    numberControl("resolution", "Resolution", 64, 8192, 64),
    vec3Control("direction", "Direction", -1, 1, 0.01),
    booleanControl("autoFit", "Auto Fit"),
    numberControl("maxDistance", "Max Distance", 1, 1000, 1),
    numberControl("padding", "Padding", 0.1, 4, 0.01),
    numberControl("pcfKernelSize", "PCF Kernel", 1, 7, 2),
    booleanControl("contactHardening", "Contact Hardening"),
    numberControl("lightRadius", "Light Radius", 0, 2, 0.01),
    selectControl("debug", "Debug", [
      option("Off", false),
      option("Factor", "factor"),
      option("Depth", "depth"),
      option("Raw Depth", "rawDepth"),
      option("Cascade", "cascade"),
      option("Reference Depth", "refDepth"),
      option("Bias", "bias"),
      option("Blocker Depth", "blockerDepth"),
      option("Filter Radius", "filterRadius"),
      option("Visibility", "visibility")
    ]),
    numberControl("normalOffsetBias", "Normal Offset Bias", 0, 0.05, 0.0001),
    numberControl("slopeBias", "Slope Bias", 0, 0.05, 0.0001),
    numberControl("cascadeCount", "Cascades", 1, 6, 1),
    numberControl("cascadeSplitLambda", "Cascade Split Lambda", 0, 1, 0.01)
  ],
  sky: [
    booleanControl("enabled", "Enabled"),
    colorControl("skyColor", "Sky Color"),
    colorControl("horizonColor", "Horizon Color"),
    colorControl("groundColor", "Ground Color"),
    numberControl("horizonBlend", "Horizon Blend", 0, 1, 0.01),
    booleanControl("sunEnabled", "Sun Enabled"),
    vec3Control("sunDirection", "Sun Direction", -1, 1, 0.01),
    colorControl("sunColor", "Sun Color"),
    numberControl("sunAngularSize", "Sun Angular Size", 0, 30, 0.1),
    numberControl("sunGlowSize", "Sun Glow Size", 0, 80, 0.5),
    numberControl("sunGlowIntensity", "Sun Glow Intensity", 0, 4, 0.01),
    vec3Control("worldUp", "World Up", -1, 1, 0.01)
  ],
  sectionPlaneCaps: [
    booleanControl("enabled", "Enabled")
  ],
  bodyHatch: [
    booleanControl("enabled", "Enabled")
  ]
};

const LIGHT_CONTROL_DEFINITIONS: Record<string, ControlDescriptor[]> = {
  ibl: [
    booleanControl("enabled", "Enabled"),
    numberControl("intensity", "Intensity", 0, 5, 0.01)
  ],
  hemispheric: [
    booleanControl("enabled", "Enabled"),
    numberControl("intensity", "Intensity", 0, 5, 0.01),
    colorControl("skyColor", "Sky Color"),
    colorControl("groundColor", "Ground Color"),
    vec3Control("worldUp", "World Up", -1, 1, 0.01)
  ],
  ambient: [
    colorControl("color", "Color"),
    numberControl("intensity", "Intensity", 0, 5, 0.01)
  ],
  dir: [
    vec3Control("dir", "Direction", -1, 1, 0.01),
    colorControl("color", "Color"),
    numberControl("intensity", "Intensity", 0, 5, 0.01)
  ],
  point: [
    vec3Control("pos", "Position", -200, 200, 0.1),
    colorControl("color", "Color"),
    numberControl("intensity", "Intensity", 0, 5, 0.01),
    numberControl("constantAttenuation", "Constant Attenuation", 0, 5, 0.01),
    numberControl("linearAttenuation", "Linear Attenuation", 0, 5, 0.01),
    numberControl("quadraticAttenuation", "Quadratic Attenuation", 0, 5, 0.01)
  ]
};

const CAMERA_CONTROL_DEFINITIONS: Record<string, ControlDescriptor[]> = {
  camera: [
    vec3Control("eye", "Eye", undefined, undefined, 0.1),
    vec3Control("look", "Look", undefined, undefined, 0.1),
    vec3Control("up", "Up", -1, 1, 0.01),
    booleanControl("constrainPitch", "Constrain Pitch"),
    booleanControl("gimbalLock", "Gimbal Lock"),
    selectControl("projectionType", "Projection Type", [
      option("Perspective", PerspectiveProjectionType),
      option("Orthographic", OrthoProjectionType),
      option("Frustum", FrustumProjectionType),
      option("Custom", CustomProjectionType)
    ])
  ],
  perspectiveProjection: [
    numberControl("fov", "FOV (degrees)", 1, 120, 0.1),
    selectControl("fovAxis", "FOV Axis", [
      option("Minimum Axis", "min"),
      option("X", "x"),
      option("Y", "y")
    ]),
    numberControl("near", "Near", 0.001, 100, 0.001),
    numberControl("far", "Far", 1, 100000, 1)
  ],
  orthoProjection: [
    numberControl("scale", "Scale", 0.01, 1000, 0.01),
    numberControl("near", "Near", 0.001, 100, 0.001),
    numberControl("far", "Far", 1, 100000, 1)
  ],
  frustumProjection: [
    numberControl("left", "Left", -10, 10, 0.01),
    numberControl("right", "Right", -10, 10, 0.01),
    numberControl("top", "Top", -10, 10, 0.01),
    numberControl("bottom", "Bottom", -10, 10, 0.01),
    numberControl("near", "Near", 0.001, 100, 0.001),
    numberControl("far", "Far", 1, 100000, 1)
  ],
  customProjection: [
    mat4Control("projMatrix", "Projection Matrix", -2, 2, 0.001)
  ]
};

export class ViewerExplorerStore {
  readonly viewer: Viewer;
  renderer: Renderer | null;
  rendererLabel: string;
  state: ViewerExplorerState = {
    roots: [],
    busy: false,
    revision: 0,
    activeNodeId: ""
  };

  private readonly _nodes = new Map<string, ViewerExplorerNodeState>();
  private readonly _collections = new Map<string, PagedTreeCollection<ViewerExplorerNodeSpec>>();
  private readonly _filteredDirty = new Set<ViewerExplorerFolderKind>();
  private readonly _pages = new PagedTreeState({
    roots: () => this.state.roots, nodes: this._nodes,
    children: (node: ViewerExplorerNodeState) => this._getCollection(node) || this._getChildSpecs(node),
    create: (spec: ViewerExplorerNodeSpec, depth: number) => this._getOrCreateNode(spec, depth),
    hasControls: (node: ViewerExplorerNodeState) => ["effect", "cameraComponent", "light"].includes(node.kind),
    touch: () => this._touch()
  });
  get pageSize(): number { return this._pages.pageSize; }
  private _disposed = false;
  private readonly _unsubscribers: Array<() => void> = [];
  private readonly _refreshQueue = new ExplorerRefreshQueue({
    structure: () => this._populateRoots(),
    state: () => this._syncDisplayedObjectNodes()
  });
  private readonly _rendererUnsubscribers: Array<() => void> = [];
  private readonly _makeReactive?: <T extends object>(value: T) => T;
  private readonly _cameraFlights = new Map<string, CameraFlightAnimation>();
  private _defaultExpansionApplied = false;
  private readonly _controlValues = new Map<string, string>();

  constructor(params: ViewerExplorerStoreParams) {
    this.viewer = params.viewer;
    this.renderer = params.renderer || null;
    this.rendererLabel = params.rendererLabel || "";
    this._makeReactive = params.makeReactive;
    if (this._makeReactive) {
      this.state = this._makeReactive(this.state);
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
    this._unsubscribeRenderer();
    for (const cameraFlight of this._cameraFlights.values()) {
      cameraFlight.destroy();
    }
    this._cameraFlights.clear();
    this._nodes.clear();
    this._collections.clear();
    this._filteredDirty.clear();
    this._pages.dispose();
    this._controlValues.clear();
    this.state.roots.splice(0);
  }

  getNode(nodeId: string): ViewerExplorerNodeState | null {
    return this._nodes.get(nodeId) || null;
  }

  getObjectPath(objectId: string): string[] | null {
    for (const view of this.viewer.viewList.filter(Boolean)) {
      if (view.objects[objectId]) {
        const folder = folderNodeId(view.id, "objects");
        return ["viewer", viewSpec(view).id, folder, nodeId("object", objectId, folder)];
      }
    }
    return null;
  }

  setPage(node: ViewerExplorerNodeState, page: number): void { if (!this._disposed) this._pages.setPage(node, page); }
  revealChild(node: ViewerExplorerNodeState, id: string): void { if (!this._disposed) this._pages.revealChild(node, id); }
  captureBranchStates(): Map<string, TreeBranchState> { return this._pages.capture(); }
  restoreBranchStates(states: ReadonlyMap<string, TreeBranchState>): void { this._pages.restore(states); }

  setRenderer(renderer: Renderer | null, rendererLabel = ""): void {
    this._unsubscribeRenderer();
    this.renderer = renderer;
    this.rendererLabel = rendererLabel;
    this._subscribeRenderer();
    this._populateRoots();
  }

  async toggleExpanded(node: ViewerExplorerNodeState): Promise<void> {
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
    if (node.expanded) this._syncDisplayedObjectNodes();
    this._touch();
  }

  getSearchEntries() {
    return treeSearchEntries<ViewerExplorerNodeSpec>(this.state.roots, (node) => this._iterateChildSpecs(node),
      (node) => ["viewer", "view", "camera", "effects", "lights"].includes(node.kind) ||
        (node.kind === "folder" && ["layers", "objects", "sectionPlanes", "transforms"].includes(node.folderKind || "")));
  }

  toggleObjectVisibility(node: ViewerExplorerNodeState): void {
    this.toggleObjectEffect(node, "visible");
  }

  toggleObjectEffect(node: ViewerExplorerNodeState, effect: ObjectEffectId): void {
    const object = this._getViewObject(node);
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    if (!view || !object) return;
    setObjectEffect(view, [object.id], effect, !objectHasEffect(object, effect));
    this._syncDisplayedObjectNodes();
  }

  isolateObject(node: ViewerExplorerNodeState): void {
    const object = this._getViewObject(node);
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    if (!view || !object) return;
    viewIsolation(view).isolate([object.id], object.id);
    this._syncDisplayedObjectNodes();
  }

  setObjectVisibility(node: ViewerExplorerNodeState, visible: boolean): void {
    const viewObject = this._getViewObject(node);
    if (!viewObject) {
      return;
    }
    viewObject.visible = visible;
    this._syncDisplayedObjectNodes();
  }

  fitObject(node: ViewerExplorerNodeState): void {
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    const viewObject = this._getViewObject(node);
    if (!view || !viewObject) {
      return;
    }
    const aabb = getSceneObjectAABB(viewObject.sceneObject);
    if (!aabb) {
      return;
    }
    let cameraFlight = this._cameraFlights.get(view.id);
    if (!cameraFlight) {
      cameraFlight = new CameraFlightAnimation(view, {duration: 0.45});
      this._cameraFlights.set(view.id, cameraFlight);
    }
    cameraFlight.flyTo({
      aabb,
      fitFOV: 45,
      duration: 0.45,
      arc: true
    });
  }

  getEffectControls(node: ViewerExplorerNodeState): ViewerExplorerControlState[] {
    const effectId = getEffectId(node);
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    const effect = view && effectId ? getEffectComponent(view, effectId) : null;
    if (!view || !effect || !effectId) {
      return [];
    }
    return (EFFECT_CONTROL_DEFINITIONS[effectId] || []).map((descriptor) => controlStateFromDescriptor(effect, descriptor));
  }

  getNodeControls(node: ViewerExplorerNodeState): ViewerExplorerControlState[] {
    const component = this._getControlComponent(node);
    if (!component) {
      return [];
    }
    return component.descriptors.map((descriptor) => controlStateFromDescriptor(component.target, descriptor));
  }

  /** Updates displayed property values without rebuilding trees or invalidating search. */
  refreshDisplayedControls(mountedIds?: ReadonlySet<string>): void {
    const sampled = new Set<string>();
    const visit = (nodes: ViewerExplorerNodeState[]) => {
      for (const node of nodes) {
        const view = node.viewId && this.viewer.views[node.viewId];
        if (node.kind === "camera" || (node.kind === "cameraComponent" && node.componentId === "camera")) {
          if (view) node.detail = projectionTypeLabel(view.camera.projectionType);
        }
        if (view && node.kind === "effects") node.detail = enabledEffectsDetail(view);
        if (!node.expanded) continue;
        if (view && ["camera", "effects", "lights"].includes(node.kind)) {
          const specs = new Map(this._getChildSpecs(node).map(spec => [spec.id, spec]));
          for (const child of node.children) {
            const spec = specs.get(child.id);
            if (spec) child.detail = spec.detail || "";
          }
        }
        if ((!mountedIds || mountedIds.has(node.id)) && ["cameraComponent", "effect", "light"].includes(node.kind)) {
          const values = JSON.stringify(this.getNodeControls(node).map(control => control.value));
          if (this._controlValues.get(node.id) !== values) {
            this._controlValues.set(node.id, values);
            node.controlsRevision++;
          }
          sampled.add(node.id);
        }
        visit(node.children);
      }
    };
    visit(this.state.roots);
    for (const id of this._controlValues.keys()) if (!sampled.has(id)) this._controlValues.delete(id);
  }

  setEffectControlValue(node: ViewerExplorerNodeState, controlId: string, value: string | number | boolean): void {
    const effectId = getEffectId(node);
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    const effect = view && effectId ? getEffectComponent(view, effectId) : null;
    const descriptor = effectId ? EFFECT_CONTROL_DEFINITIONS[effectId]?.find((control) => control.id === controlId) : null;
    if (!effect || !descriptor) {
      return;
    }
    if (descriptor.kind === "boolean") {
      effect[controlId] = value === true || value === "true";
    } else if (descriptor.kind === "number") {
      const numericValue = parseNumericInput(String(value), descriptor.min, descriptor.max);
      if (numericValue !== null) {
        effect[controlId] = numericValue;
      }
    } else if (descriptor.kind === "select") {
      effect[controlId] = parseSelectValue(descriptor, String(value));
    } else if (descriptor.kind === "color") {
      effect[controlId] = hexToColor(String(value));
    }
    this._refreshMaterializedChildren();
  }

  setNodeControlValue(node: ViewerExplorerNodeState, controlId: string, value: string | number | boolean): void {
    const component = this._getControlComponent(node);
    const descriptor = component?.descriptors.find((control) => control.id === controlId);
    if (!component || !descriptor) {
      return;
    }
    setControlValue(component.target, descriptor, value);
    this._refreshMaterializedChildren();
  }

  setEffectVectorComponent(node: ViewerExplorerNodeState, controlId: string, componentIndex: number, value: string | number): void {
    this.setNodeVectorComponent(node, controlId, componentIndex, value);
  }

  setNodeVectorComponent(node: ViewerExplorerNodeState, controlId: string, componentIndex: number, value: string | number): void {
    const component = this._getControlComponent(node);
    if (!component) {
      return;
    }
    const current = Array.from(component.target[controlId] || [0, 0, 0]).slice(0, 3);
    const descriptor = component.descriptors.find(control => control.id === controlId);
    const numericValue = parseNumericInput(value, descriptor?.min, descriptor?.max);
    if (!descriptor || numericValue === null) {
      return;
    }
    current[componentIndex] = numericValue;
    component.target[controlId] = current;
    this._refreshMaterializedChildren();
  }

  setNodeVector(node: ViewerExplorerNodeState, controlId: string, values: readonly number[]): void {
    const component = this._getControlComponent(node);
    const descriptor = component?.descriptors.find(control => control.id === controlId);
    if (!component || descriptor?.kind !== "vec3" || values.length !== 3 || values.some(value => parseNumericInput(value, descriptor.min, descriptor.max) === null)) return;
    if (controlId === "up" && values.every(value => value === 0)) return;
    component.target[controlId] = [...values];
    this._refreshMaterializedChildren();
  }

  setNodeMatrixValue(node: ViewerExplorerNodeState, controlId: string, value: string | ArrayLike<number>): boolean {
    const component = this._getControlComponent(node);
    if (!component) {
      return false;
    }
    const matrix = parseMatrixValue(value);
    if (!matrix) {
      return false;
    }
    component.target[controlId] = matrix;
    this._refreshMaterializedChildren();
    return true;
  }

  private _getControlComponent(node: ViewerExplorerNodeState): {target: any; descriptors: ControlDescriptor[]} | null {
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    if (!view) {
      return null;
    }
    if (node.kind === "effect") {
      const effectId = getEffectId(node);
      const effect = effectId ? getEffectComponent(view, effectId) : null;
      const descriptors = effectId ? EFFECT_CONTROL_DEFINITIONS[effectId] : null;
      return effect && descriptors ? {target: effect, descriptors} : null;
    }
    if (node.kind === "cameraComponent" && node.componentId) {
      const cameraComponent = getCameraComponent(view, node.componentId);
      const descriptors = CAMERA_CONTROL_DEFINITIONS[node.componentId];
      return cameraComponent && descriptors ? {target: cameraComponent, descriptors} : null;
    }
    if (node.kind === "light" && node.componentId) {
      const lightComponent = getLightComponent(view, node.componentId);
      return lightComponent ? {target: lightComponent.target, descriptors: lightComponent.descriptors} : null;
    }
    return null;
  }

  private _populateRoots(): void {
    const spec: ViewerExplorerNodeSpec = {
      id: "viewer",
      kind: "viewer",
      title: "Viewer",
      detail: `${this.viewer.id} - ${this.viewer.numViews} view${this.viewer.numViews === 1 ? "" : "s"}`,
      hasChildren: true
    };
    const root = this._getOrCreateNode(spec, 0);
    this.state.roots.splice(0, this.state.roots.length, root);
    this._applyDefaultExpansion(root);
    this._refreshMaterializedChildren();
    this._touch();
  }

  private _loadChildren(node: ViewerExplorerNodeState): void {
    this._pages.load(node);
  }

  private _applyDefaultExpansion(root: ViewerExplorerNodeState): void {
    if (this._defaultExpansionApplied || this.viewer.viewList.length === 0) {
      return;
    }
    root.expanded = true;
    if (!root.childrenLoaded) {
      this._loadChildren(root);
    }
    const firstViewNode = root.children.find((child) => child.kind === "view");
    if (!firstViewNode) {
      return;
    }
    firstViewNode.expanded = true;
    if (!firstViewNode.childrenLoaded) {
      this._loadChildren(firstViewNode);
    }
    this._defaultExpansionApplied = true;
  }

  private _getOrCreateNode(spec: ViewerExplorerNodeSpec, depth: number): ViewerExplorerNodeState {
    let node = this._nodes.get(spec.id);
    if (node) {
      updateNode(node, spec, depth);
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
      viewId: spec.viewId,
      componentId: spec.componentId,
      folderKind: spec.folderKind,
      visible: spec.visible !== false,
      hasViewObject: !!spec.hasViewObject,
      canFit: !!spec.canFit,
      controlsRevision: 0,
      effects: spec.effects || objectEffects()
    };
    if (this._makeReactive) {
      node = this._makeReactive(node);
    }
    this._nodes.set(spec.id, node);
    return node;
  }

  private _getChildSpecs(node: ViewerExplorerNodeSpec): ViewerExplorerNodeSpec[] {
    if (node.kind === "viewer") {
      const specs = this.viewer.viewList.filter(Boolean).map((view) => viewSpec(view));
      if (this.renderer) {
        specs.unshift(rendererSpec(this.renderer, this.rendererLabel));
      }
      return specs;
    }
    if (node.kind === "renderer") {
      return this.renderer ? rendererChildSpecs(this.renderer, node.id, this.rendererLabel) : [];
    }
    const view = node.viewId ? this.viewer.views[node.viewId] : null;
    if (!view) {
      return [];
    }
    if (node.kind === "view") {
      return viewChildSpecs(view);
    }
    if (node.kind === "layer") {
      const layer = view.layers[node.componentId || ""];
      return layer ? layerChildSpecs(layer, node.id) : [];
    }
    if (node.kind === "object") {
      const viewObject = view.objects[node.componentId || ""];
      return viewObject ? viewObjectChildSpecs(viewObject, node.id) : [];
    }
    if (node.kind === "camera") {
      return cameraChildSpecs(view, node.id);
    }
    if (node.kind === "cameraComponent") {
      return cameraComponentChildSpecs(view, node.id, node.componentId || "");
    }
    if (node.kind === "effects") {
      return effectsChildSpecs(view, node.id);
    }
    if (node.kind === "lights") {
      return lightsChildSpecs(view, node.id);
    }
    return [];
  }

  private _refreshMaterializedChildren(): void {
    this._pages.refresh();
  }

  private _getCollection(node: ViewerExplorerNodeSpec): PagedTreeCollection<ViewerExplorerNodeSpec> | null {
    const cached = this._collections.get(node.id);
    if (cached) return cached;
    const source = this._collectionSource(node);
    if (!source) return null;
    const collection = indexTreeCollection(source);
    this._collections.set(node.id, collection);
    return collection;
  }

  private _collectionSource(node: ViewerExplorerNodeSpec): TreeCollectionSource<ViewerExplorerNodeSpec> | null {
    const view = node.viewId && this.viewer.views[node.viewId];
    return view && node.kind === "folder" ? folderCollectionSource(view, node) : null;
  }

  private *_iterateChildSpecs(node: ViewerExplorerNodeSpec): Generator<ViewerExplorerNodeSpec> {
    const source = this._collectionSource(node);
    if (source) { for (const key of source.keys()) yield source.describe(key); }
    else yield* this._getChildSpecs(node);
  }

  private _syncDisplayedObjectNodes(): void {
    if (this._filteredDirty.size) {
      for (const node of this._nodes.values()) {
        if (!node.folderKind || !this._filteredDirty.has(node.folderKind) || !node.viewId) continue;
        const view = this.viewer.views[node.viewId];
        if (!view) continue;
        const count = node.folderKind === "visibleObjects" ? view.numVisibleObjects
          : node.folderKind === "colorizedObjects" ? view.numColorizedObjects : view.numOpacityObjects;
        node.detail = String(count); node.hasChildren = count > 0;
        this._collections.delete(node.id);
        if (node.expanded) this._pages.load(node);
        else { node.children = []; node.childrenLoaded = false; }
      }
      this._filteredDirty.clear();
      this._pages.prune();
      this._touch();
    }
    for (const node of displayedTreeNodes(this.state.roots)) {
      if (node.kind !== "object") continue;
      const object = this._getViewObject(node);
      node.visible = object?.visible !== false;
      node.effects = objectEffects(object || undefined);
      node.hasViewObject = !!object;
      if (!object) continue;
      node.detail = objectSpec(object, "").detail || "";
      if (node.expanded && node.childrenLoaded) {
        const specs = this._getChildSpecs(node);
        for (const child of node.children) {
          const spec = specs.find((candidate) => candidate.id === child.id);
          if (spec) updateNode(child, spec, child.depth);
        }
      }
    }
  }

  private _subscribe(): void {
    const refresh = () => { this._collections.clear(); this._refreshQueue.request("structure"); };
    const refreshViewState = refresh;
    const refreshObjects = () => this._refreshQueue.request("state");
    const refreshFiltered = (kind: ViewerExplorerFolderKind) => () => {
      this._filteredDirty.add(kind);
      refreshObjects();
    };
    this._unsubscribers.push(
      this.viewer.events.onViewCreated.subscribe(refresh),
      this.viewer.events.onViewDestroyed.subscribe(refresh),
      this.viewer.events.onViewLayerCreated.subscribe(refreshViewState),
      this.viewer.events.onViewLayerDestroyed.subscribe(refreshViewState),
      this.viewer.events.onViewObjectCreated.subscribe(refreshViewState),
      this.viewer.events.onViewObjectDestroyed.subscribe(refreshViewState),
      this.viewer.events.onViewObjectVisibleChanged.subscribe(refreshFiltered("visibleObjects")),
      this.viewer.events.onViewObjectStyleBinChanged.subscribe(refreshObjects),
      this.viewer.events.onViewObjectColorizeChanged.subscribe(refreshFiltered("colorizedObjects")),
      this.viewer.events.onViewObjectOpacityChanged.subscribe(refreshFiltered("opacityObjects")),
      this.viewer.events.onViewObjectPickableChanged.subscribe(refreshObjects),
      this.viewer.events.onSectionPlaneCreated.subscribe(refreshViewState),
      this.viewer.events.onSectionPlaneDestroyed.subscribe(refreshViewState),
      this.viewer.events.onViewTransformCreated.subscribe(refreshViewState),
      this.viewer.events.onViewTransformDestroyed.subscribe(refreshViewState),
      this.viewer.events.onEffectCreated.subscribe(refresh),
      this.viewer.events.onEffectDestroyed.subscribe(refresh),
      this.viewer.events.onSceneAttached.subscribe(refresh),
      this.viewer.events.onSceneDetached.subscribe(refresh)
    );
    this._subscribeRenderer();
  }

  private _subscribeRenderer(): void {
    if (!this.renderer) {
      return;
    }
    const refresh = () => this._refreshQueue.request("structure");
    this._rendererUnsubscribers.push(
      this.renderer.events.onViewerAttached.subscribe(refresh),
      this.renderer.events.onViewerDetached.subscribe(refresh),
      this.renderer.events.onRendererStarted.subscribe(refresh),
      this.renderer.events.onRendererStopped.subscribe(refresh),
      this.renderer.events.onRendererDestroyed.subscribe(refresh)
    );
  }

  private _unsubscribeRenderer(): void {
    while (this._rendererUnsubscribers.length > 0) {
      this._rendererUnsubscribers.pop()!();
    }
  }

  private _getViewObject(node: ViewerExplorerNodeState): ViewObject | null {
    if (!node.viewId || !node.componentId) {
      return null;
    }
    return this.viewer.views[node.viewId]?.objects[node.componentId] || null;
  }

  private _touch(): void {
    this.state.revision++;
  }
}

function updateNode(node: ViewerExplorerNodeState, spec: ViewerExplorerNodeSpec, depth: number): void {
  node.kind = spec.kind;
  node.title = spec.title;
  node.detail = spec.detail || "";
  node.depth = depth;
  node.hasChildren = !!spec.hasChildren;
  node.viewId = spec.viewId;
  node.componentId = spec.componentId;
  node.folderKind = spec.folderKind;
  node.visible = spec.visible !== false;
  node.hasViewObject = !!spec.hasViewObject;
  node.canFit = !!spec.canFit;
  node.effects = spec.effects || objectEffects();
}

function viewSpec(view: View): ViewerExplorerNodeSpec {
  return {
    id: viewNodeId(view.id),
    kind: "view",
    title: "View",
    detail: `${view.id} - ${view.numObjects} objects, ${Object.keys(view.layers).length} layers`,
    viewId: view.id,
    hasChildren: true
  };
}

function rendererSpec(renderer: Renderer, rendererLabel: string): ViewerExplorerNodeSpec {
  const name = rendererDisplayName(renderer, rendererLabel);
  return {
    id: "renderer",
    kind: "renderer",
    title: "Renderer",
    detail: `${name} - ${renderer.rendering ? "rendering" : "stopped"}`,
    hasChildren: true
  };
}

function rendererChildSpecs(renderer: Renderer, parentId: string, rendererLabel = ""): ViewerExplorerNodeSpec[] {
  const name = rendererDisplayName(renderer, rendererLabel);
  return [
    componentPropertySpec(parentId, "Class", name),
    componentPropertySpec(parentId, "Attached Viewer", renderer.viewer?.id || "none"),
    componentPropertySpec(parentId, "Rendering", renderer.rendering),
    componentPropertySpec(parentId, "Logging", renderer.logging)
  ];
}

function rendererDisplayName(renderer: Renderer, rendererLabel: string): string {
  return rendererLabel || renderer.constructor?.name || "Renderer";
}

function viewChildSpecs(view: View): ViewerExplorerNodeSpec[] {
  return [
    {
      id: folderNodeId(view.id, "camera"),
      kind: "camera",
      title: "Camera",
      detail: projectionTypeLabel(view.camera.projectionType),
      viewId: view.id,
      hasChildren: true
    },
    {
      id: folderNodeId(view.id, "effects"),
      kind: "effects",
      title: "Effects",
      detail: enabledEffectsDetail(view),
      viewId: view.id,
      hasChildren: true
    },
    {
      id: folderNodeId(view.id, "lights"),
      kind: "lights",
      title: "Lights",
      detail: `${view.lightsList.length} source${view.lightsList.length === 1 ? "" : "s"}, IBL ${view.lights.ibl.enabled ? "on" : "off"}, Hemi ${view.lights.hemispheric.enabled ? "on" : "off"}`,
      viewId: view.id,
      hasChildren: true
    },
    folderSpec(view, "layers", Object.keys(view.layers).length),
    folderSpec(view, "objects", view.numObjects),
    folderSpec(view, "visibleObjects", view.numVisibleObjects),
    folderSpec(view, "colorizedObjects", view.numColorizedObjects),
    folderSpec(view, "opacityObjects", view.numOpacityObjects),
    folderSpec(view, "sectionPlanes", Object.keys(view.sectionPlanes).length),
    folderSpec(view, "transforms", Object.keys(view.transforms).length)
  ];
}

function folderSpec(view: View, folderKind: ViewerExplorerFolderKind, count: number): ViewerExplorerNodeSpec {
  return {
    id: folderNodeId(view.id, folderKind),
    kind: "folder",
    title: VIEW_FOLDER_LABELS[folderKind] || folderKind,
    detail: `${count}`,
    viewId: view.id,
    folderKind,
    hasChildren: count > 0
  };
}

function folderCollectionSource(view: View, node: ViewerExplorerNodeSpec): TreeCollectionSource<ViewerExplorerNodeSpec> | null {
  const parentId = node.id;
  if (node.folderKind === "layers") {
    return {keys: () => recordKeys(view.layers), describe: id => layerSpec(view.layers[id], parentId),
      nodeId: id => nodeId("layer", id, parentId), compare: naturalCompare};
  }
  const objects = node.folderKind === "objects" ? view.objects : node.folderKind === "visibleObjects" ? view.visibleObjects
    : node.folderKind === "colorizedObjects" ? view.colorizedObjects : node.folderKind === "opacityObjects" ? view.opacityObjects
    : node.folderKind === "viewObjects" ? view.layers[node.componentId || ""]?.objects || {} : null;
  if (objects) {
    return {keys: () => recordKeys(objects), describe: id => objectSpec(objects[id], parentId),
      nodeId: id => nodeId("object", id, parentId), compare: naturalCompare};
  }
  if (node.folderKind === "sectionPlanes") {
    return {keys: () => recordKeys(view.sectionPlanes), nodeId: id => nodeId("sectionPlane", id, parentId), compare: naturalCompare,
      describe: id => { const sectionPlane = view.sectionPlanes[id]; return {
      id: nodeId("sectionPlane", sectionPlane.id, parentId),
      kind: "sectionPlane" as const,
      title: "SectionPlane",
      detail: `${sectionPlane.id} - ${sectionPlane.active ? "active" : "inactive"}`,
      viewId: view.id,
      componentId: sectionPlane.id,
      hasChildren: false
    }; }};
  }
  if (node.folderKind === "transforms") {
    return {keys: () => recordKeys(view.transforms), nodeId: id => nodeId("transform", id, parentId), compare: naturalCompare,
      describe: id => { const transform = view.transforms[id]; return {
      id: nodeId("transform", transform.id, parentId),
      kind: "transform" as const,
      title: "ViewTransform",
      detail: transform.id,
      viewId: view.id,
      componentId: transform.id,
      hasChildren: false
    }; }};
  }
  return null;
}

function layerSpec(layer: ViewLayer, parentId: string): ViewerExplorerNodeSpec {
  return {
    id: nodeId("layer", layer.id, parentId),
    kind: "layer",
    title: "ViewLayer",
    detail: `${layer.id} - ${layer.numObjects} objects, ${layer.numVisibleObjects} visible`,
    viewId: layer.view.id,
    componentId: layer.id,
    hasChildren: true
  };
}

function layerChildSpecs(layer: ViewLayer, parentId: string): ViewerExplorerNodeSpec[] {
  return [
    propertySpec(layer.view, parentId, "ID", layer.id),
    propertySpec(layer.view, parentId, "Auto Destroy", layer.autoDestroy),
    propertySpec(layer.view, parentId, "Objects", layer.numObjects),
    propertySpec(layer.view, parentId, "Visible Objects", layer.numVisibleObjects),
    propertySpec(layer.view, parentId, "Colorized Objects", layer.numColorizedObjects),
    propertySpec(layer.view, parentId, "Opacity Objects", layer.numOpacityObjects),
    {
      id: nodeId("folder", "viewObjects", parentId),
      kind: "folder",
      title: "ViewObjects",
      detail: `${layer.numObjects}`,
      viewId: layer.view.id,
      componentId: layer.id,
      folderKind: "viewObjects",
      hasChildren: layer.numObjects > 0
    }
  ];
}

function objectSpec(viewObject: ViewObject, parentId: string): ViewerExplorerNodeSpec {
  return {
    id: nodeId("object", viewObject.id, parentId),
    kind: "object",
    title: "ViewObject",
    detail: `${viewObject.id} - layer ${viewObject.layer.id}`,
    viewId: viewObject.view.id,
    componentId: viewObject.id,
    visible: viewObject.visible,
    effects: objectEffects(viewObject),
    hasViewObject: true,
    canFit: true,
    hasChildren: true
  };
}

function viewObjectChildSpecs(viewObject: ViewObject, parentId: string): ViewerExplorerNodeSpec[] {
  const styleBins = viewObject.styleBinIds;
  return [
    propertySpec(viewObject.view, parentId, "ID", viewObject.id),
    propertySpec(viewObject.view, parentId, "Original System ID", viewObject.originalSystemId || "none"),
    propertySpec(viewObject.view, parentId, "Layer", viewObject.layer.id),
    propertySpec(viewObject.view, parentId, "SceneObject", viewObject.sceneObject.id),
    propertySpec(viewObject.view, parentId, "Culled", viewObject.culled),
    propertySpec(viewObject.view, parentId, "Pickable", viewObject.pickable),
    propertySpec(viewObject.view, parentId, "Clippable", viewObject.clippable),
    propertySpec(viewObject.view, parentId, "Collidable", viewObject.collidable),
    propertySpec(viewObject.view, parentId, "Colorize", viewObject.colorize ? formatArray(viewObject.colorize) : "none"),
    propertySpec(viewObject.view, parentId, "Opacity", viewObject.opacity),
    propertySpec(viewObject.view, parentId, "Opacity Updated", viewObject.opacityUpdated),
    propertySpec(viewObject.view, parentId, "Style Bins", styleBins.length ? styleBins.join(", ") : "none")
  ];
}

function cameraChildSpecs(view: View, parentId: string): ViewerExplorerNodeSpec[] {
  return [
    cameraComponentSpec(view, parentId, "camera", "Camera", projectionTypeLabel(view.camera.projectionType)),
    cameraComponentSpec(
      view,
      parentId,
      "perspectiveProjection",
      "PerspectiveProjection",
      view.camera.projectionType === PerspectiveProjectionType ? "active" : "inactive"
    ),
    cameraComponentSpec(
      view,
      parentId,
      "orthoProjection",
      "OrthoProjection",
      view.camera.projectionType === OrthoProjectionType ? "active" : "inactive"
    ),
    cameraComponentSpec(
      view,
      parentId,
      "frustumProjection",
      "FrustumProjection",
      view.camera.projectionType === FrustumProjectionType ? "active" : "inactive"
    ),
    cameraComponentSpec(
      view,
      parentId,
      "customProjection",
      "CustomProjection",
      view.camera.projectionType === CustomProjectionType ? "active" : "inactive"
    )
  ];
}

function cameraComponentSpec(view: View, parentId: string, componentId: string, title: string, detail: string): ViewerExplorerNodeSpec {
  return {
    id: nodeId("cameraComponent", componentId, parentId),
    kind: "cameraComponent",
    title,
    detail,
    viewId: view.id,
    componentId,
    hasChildren: true
  };
}

function cameraComponentChildSpecs(view: View, parentId: string, componentId: string): ViewerExplorerNodeSpec[] {
  const camera = view.camera;
  if (componentId === "camera") {
    return [];
  }
  if (componentId === "perspectiveProjection") {
    return [];
  }
  if (componentId === "orthoProjection") {
    return [];
  }
  if (componentId === "frustumProjection") {
    return [];
  }
  if (componentId === "customProjection") {
    return [];
  }
  return [];
}

function effectsChildSpecs(view: View, parentId: string): ViewerExplorerNodeSpec[] {
  const effects: Array<[string, string, any]> = [
    ["sao", "SAO", view.effects.sao],
    ["edges", "Edges", view.effects.edges],
    ["bloom", "Bloom", view.effects.bloom],
    ["atmosphere", "Atmosphere", view.effects.atmosphere],
    ["depthOfField", "DepthOfField", view.effects.depthOfField],
    ["colorGrading", "ColorGrading", view.effects.colorGrading],
    ["tonemap", "Tonemap", view.effects.tonemap],
    ["antiAliasing", "AntiAliasing", view.effects.antiAliasing],
    ["texturing", "Texturing", view.texturing],
    ["resolutionScale", "ResolutionScale", view.resolutionScale],
    ["shadows", "Shadows", view.effects.shadows],
    ["sky", "Sky", view.effects.sky],
    ["sectionPlaneCaps", "SectionPlaneCaps", view.effects.sectionPlaneCaps],
    ["bodyHatch", "BodyHatch", view.effects.bodyHatch]
  ];
  return effects.map(([effectId, name, effect]) => ({
    id: nodeId("effect", effectId, parentId),
    kind: "effect" as const,
    title: name,
    detail: effect?.enabled === true ? "enabled" : "disabled",
    viewId: view.id,
    componentId: effectId,
    hasChildren: true
  }));
}

function lightsChildSpecs(view: View, parentId: string): ViewerExplorerNodeSpec[] {
  const specs: ViewerExplorerNodeSpec[] = [
    {
      id: nodeId("light", "IBL", parentId),
      kind: "light",
      title: "IBL",
      detail: view.lights.ibl.enabled ? "enabled" : "disabled",
      viewId: view.id,
      componentId: "IBL",
      hasChildren: true
    },
    {
      id: nodeId("light", "Hemispheric", parentId),
      kind: "light",
      title: "Hemispheric",
      detail: view.lights.hemispheric.enabled ? "enabled" : "disabled",
      viewId: view.id,
      componentId: "Hemispheric",
      hasChildren: true
    }
  ];
  for (const light of view.lightsList as any[]) {
    specs.push({
      id: nodeId("light", light.id, parentId),
      kind: "light",
      title: legacyLightTypeLabel(light),
      detail: `${light.id} - intensity ${formatValue(light.intensity)}`,
      viewId: view.id,
      componentId: light.id,
      hasChildren: true
    });
  }
  return specs;
}

function propertySpec(view: View, parentId: string, name: string, value: unknown): ViewerExplorerNodeSpec {
  return componentPropertySpec(parentId, name, value, view.id);
}

function componentPropertySpec(parentId: string, name: string, value: unknown, viewId?: string): ViewerExplorerNodeSpec {
  return {
    id: nodeId("property", `${name}:${formatValue(value)}`, parentId),
    kind: "property",
    title: name,
    detail: formatValue(value),
    viewId,
    hasChildren: false
  };
}

function enabledEffectsDetail(view: View): string {
  const enabled = [
    view.effects.sao.enabled && "SAO",
    view.effects.edges.enabled && "Edges",
    view.effects.bloom.enabled && "Bloom",
    view.effects.atmosphere.enabled && "Atmosphere",
    view.effects.depthOfField.enabled && "DOF",
    view.effects.colorGrading.enabled && "Color",
    view.effects.tonemap.enabled && "Tonemap",
    view.effects.antiAliasing.enabled && "AA",
    view.texturing.enabled && "Texturing",
    view.resolutionScale.enabled && "Resolution",
    view.effects.shadows.enabled && "Shadows",
    view.effects.sky.enabled && "Sky",
    view.effects.sectionPlaneCaps.enabled && "Caps",
    view.effects.bodyHatch.enabled && "Hatch"
  ].filter(Boolean);
  return enabled.length ? enabled.join(", ") : "none enabled";
}

function controlStateFromDescriptor(effect: any, descriptor: EffectControlDescriptor): ViewerExplorerControlState {
  const rawValue = effect[descriptor.id];
  let value: ViewerExplorerControlState["value"];
  if (descriptor.kind === "color") {
    value = colorToHex(rawValue);
  } else if (descriptor.kind === "vec3") {
    value = Array.from(rawValue || [0, 0, 0]).slice(0, 3).map((component) => Number(component));
  } else if (descriptor.kind === "mat4") {
    value = Array.from(rawValue || identityMatrixArray()).slice(0, 16).map((component) => Number(component));
  } else {
    value = rawValue;
  }
  return {
    id: descriptor.id,
    label: descriptor.label,
    kind: descriptor.kind,
    value,
    min: descriptor.min,
    max: descriptor.max,
    step: descriptor.step,
    options: descriptor.options
  };
}

function getEffectId(node: ViewerExplorerNodeState): string | null {
  return node.kind === "effect" && node.componentId ? node.componentId : null;
}

function getEffectComponent(view: View, effectId: string): any {
  if (effectId === "texturing") {
    return view.texturing;
  }
  if (effectId === "resolutionScale") {
    return view.resolutionScale;
  }
  return (view.effects as any)[effectId] || null;
}

function getCameraComponent(view: View, componentId: string): any {
  if (componentId === "camera") {
    return view.camera;
  }
  return (view.camera as any)[componentId] || null;
}

function getLightComponent(view: View, componentId: string): {target: any; descriptors: ControlDescriptor[]} | null {
  if (componentId === "IBL") {
    return {target: view.lights.ibl, descriptors: LIGHT_CONTROL_DEFINITIONS.ibl};
  }
  if (componentId === "Hemispheric") {
    return {target: view.lights.hemispheric, descriptors: LIGHT_CONTROL_DEFINITIONS.hemispheric};
  }
  const light = (view as any).lightSources?.[componentId] || (view.lightsList as any[]).find((candidate) => candidate.id === componentId);
  if (!light) {
    return null;
  }
  const type = getLegacyLightType(light);
  const descriptors = type ? LIGHT_CONTROL_DEFINITIONS[type] : null;
  return descriptors ? {target: light, descriptors} : null;
}

function getLegacyLightType(light: any): "ambient" | "dir" | "point" | null {
  if (light._type === "ambient") {
    return "ambient";
  }
  if ("dir" in light) {
    return "dir";
  }
  if ("pos" in light) {
    return "point";
  }
  return null;
}

function legacyLightTypeLabel(light: any): string {
  const type = getLegacyLightType(light);
  if (type === "ambient") {
    return "Ambient Light";
  }
  if (type === "dir") {
    return "Directional Light";
  }
  if (type === "point") {
    return "Point Light";
  }
  return "Light";
}

function setControlValue(target: any, descriptor: ControlDescriptor, value: string | number | boolean): void {
  if (descriptor.kind === "boolean") {
    target[descriptor.id] = value === true || value === "true";
  } else if (descriptor.kind === "number") {
    const numericValue = parseNumericInput(value as string | number, descriptor.min, descriptor.max);
    if (numericValue !== null) {
      target[descriptor.id] = numericValue;
    }
  } else if (descriptor.kind === "select") {
    target[descriptor.id] = parseSelectValue(descriptor, String(value));
  } else if (descriptor.kind === "color") {
    target[descriptor.id] = hexToColor(String(value));
  }
}

function parseSelectValue(descriptor: EffectControlDescriptor, value: string): string | number | boolean {
  for (const optionValue of descriptor.options || []) {
    if (String(optionValue.value) === value) {
      return optionValue.value;
    }
  }
  return value;
}

function colorToHex(value: ArrayLike<number> | undefined): string {
  const color = value || [0, 0, 0];
  const channels = [0, 1, 2].map((index) => {
    const channel = Math.max(0, Math.min(255, Math.round(Number(color[index]) * 255)));
    return channel.toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function hexToColor(value: string): number[] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value.slice(1) : "000000";
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  ];
}

function booleanControl(id: string, label: string): EffectControlDescriptor {
  return {id, label, kind: "boolean"};
}

function numberControl(id: string, label: string, min: number, max: number, step: number): EffectControlDescriptor {
  return {id, label, kind: "number", min, max, step};
}

function colorControl(id: string, label: string): EffectControlDescriptor {
  return {id, label, kind: "color"};
}

function vec3Control(id: string, label: string, min: number, max: number, step: number): EffectControlDescriptor {
  return {id, label, kind: "vec3", min, max, step};
}

function mat4Control(id: string, label: string, min: number, max: number, step: number): EffectControlDescriptor {
  return {id, label, kind: "mat4", min, max, step};
}

function selectControl(id: string, label: string, options: ViewerExplorerControlOption[]): EffectControlDescriptor {
  return {id, label, kind: "select", options};
}

function option(label: string, value: string | number | boolean): ViewerExplorerControlOption {
  return {label, value};
}

function sortByDetail<T extends {detail?: string; id: string}>(items: T[]): T[] {
  return items.sort((a, b) => naturalCompare(a.detail || "", b.detail || "") || naturalCompare(a.id, b.id));
}

function viewNodeId(viewId: string): string {
  return `view:${viewId}`;
}

function folderNodeId(viewId: string, folderKind: ViewerExplorerFolderKind): string {
  return `folder:${folderKind}:in:view:${viewId}`;
}

function nodeId(kind: string, componentId: string, parentId: string): string {
  return `${kind}:${componentId}:in:${parentId}`;
}

function formatArray(value: ArrayLike<number>): string {
  return `[${Array.from(value).map((num) => Number(num).toFixed(3)).join(", ")}]`;
}

function formatMatrix(value: ArrayLike<number>): string {
  const matrix = Array.from(value).slice(0, 16);
  return `[${matrix.map((num) => Number(num).toFixed(3)).join(", ")}]`;
}

function identityMatrixArray(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function projectionTypeLabel(value: number): string {
  if (value === PerspectiveProjectionType) {
    return "Perspective";
  }
  if (value === OrthoProjectionType) {
    return "Orthographic";
  }
  if (value === FrustumProjectionType) {
    return "Frustum";
  }
  if (value === CustomProjectionType) {
    return "Custom";
  }
  return String(value);
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
  let expanded = false;
  for (const mesh of sceneObject.meshes) {
    const geometryAABB = mesh.geometry.aabb;
    if (!geometryAABB) {
      continue;
    }
    expandTransformedAABB(aabb, geometryAABB, mesh.worldMatrix);
    expanded = true;
  }
  return expanded ? aabb : null;
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
import {treeSearchEntries} from "../tree/treeSearchEntries";
