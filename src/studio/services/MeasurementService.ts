import {DistanceMeasurementTool, PointerDistanceMeasurementsControl, pickMeasurementPoint} from "@xeokit/sdk/tools/measurement/distance";
import {PointerLens} from "@xeokit/sdk/tools/measurement";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {Renderer} from "@xeokit/sdk/viewing/rendering";
import type {PickStrategy} from "@xeokit/sdk/spatial/picking";
import type {ModelNavigationController} from "@xeokit/sdk/viewing/navigation/model";
import type {MeasurementState, StudioMeasurement} from "../state/measurementState";
import type {SectionState} from "../state/sectionState";
import {formatMeasurementLength, measurementBounds, planMeasurementTarget} from "./measurementGeometry";
import {sceneMetersPerUnit} from "./planElevation";
import {planScale} from "./sectionGeometry";
import {StudioCameraFlight, cancelStudioCameraFlights} from "./StudioCameraFlight";

const DEFAULT_COLOR = "#126dac";
const SELECTED_COLOR = "#9a4b09";
type Removal = {items: StudioMeasurement[]; selectedId: string; label: string};

export class MeasurementService {
  private tool: DistanceMeasurementTool | null = null;
  private control: PointerDistanceMeasurementsControl | null = null;
  private lens: PointerLens | null = null;
  private canvas: HTMLElement | null = null;
  private renderer: Renderer | null = null;
  private floorId = "";
  private sequence = 0;
  private removals: Removal[] = [];
  private flight: StudioCameraFlight | null = null;
  private locateRevision = 0;
  private clickNavigation: {controller: ModelNavigationController; enabled: boolean} | null = null;
  private suspended: {controller: ModelNavigationController; enabled: boolean} | null = null;
  private unsubscribers: Array<() => void> = [];
  private queued = false;
  private disposed = false;

  constructor(private params: {
    scene: Scene; view: View; state: MeasurementState; section: SectionState;
    getPicker: () => PickStrategy | null; getRenderer: () => Renderer | null;
    getController: () => ModelNavigationController | null;
    isActive: () => boolean; isSwitching: () => boolean;
    showFloorPlan: (id: string, cutHeight?: number) => void;
    returnTo3D: () => void;
  }) {
    const {scene, view} = params;
    this.unsubscribers.push(scene.events.onSceneObjectDestroyed.subscribe((_scene, object) => {
      this.cancel();
      const affected = params.state.items.filter(item => item.objectIds.includes(object.id));
      this.discard(affected);
      // Unloading is permanent for this session, including previously deleted measurements.
      this.removals = this.removals.map(step => ({...step, items: step.items.filter(item => !item.objectIds.includes(object.id))}))
        .filter(step => step.items.length);
      this.publishUndo();
    }));
    const events = view.viewer.events;
    for (const event of [events.onViewObjectVisibleChanged, events.onSectionPlanePosChanged, events.onSectionPlaneDirChanged,
      events.onSectionPlaneActive, events.onSectionPlaneCreated, events.onSectionPlaneDestroyed]) {
      this.unsubscribers.push(event.subscribe(() => this.schedule()));
    }
    this.unsubscribers.push(scene.events.onSceneCoordSystemUnitsChanged.subscribe(() => this.schedule()),
      scene.events.onSceneCoordSystemScaleToMetersChanged.subscribe(() => this.schedule()));
  }

  sync(): void {
    if (this.disposed) return;
    const {view, state, section} = this.params;
    if (this.params.isSwitching()) {this.release(); return;}
    if (this.floorId !== section.planFloorId) {this.cancel(); this.floorId = section.planFloorId;}
    const renderer = this.params.getRenderer(), picker = this.params.getPicker();
    if (this.canvas !== view.htmlElement || this.renderer !== renderer) this.release();
    if (!this.tool && renderer && picker && (this.params.isActive() || state.items.length)) {
      this.canvas = view.htmlElement; this.renderer = renderer;
      this.tool = new DistanceMeasurementTool({view, picker, container: document.body, zIndex: 100001,
        defaultColor: DEFAULT_COLOR, formatLength: length => this.format(length)});
      this.lens = new PointerLens(view, renderer);
      for (const item of state.items) this.restoreMeasurement(item);
      this.reserveLabels();
      this.control = new PointerDistanceMeasurementsControl(this.tool, {
        pick: pos => {
          const current = this.params.getPicker();
          return current ? pickMeasurementPoint(current, view, pos, state.snapping) : null;
        },
        transformTarget: (origin, target) => section.planFloorId ? planMeasurementTarget(origin, target, this.params.scene.coordinateSystem.worldUp) : target,
        measurementParams: () => {
          const number = ++this.sequence;
          return {id: `studio-distance-${number}`, axisVisible: false,
            formatLength: (length: number) => `${number} · ${this.format(length)}`};
        },
        onTouchPlacement: placing => this.touchPlacement(placing),
        onPreview: (point, _type, pos) => {
          state.snapHint = point ? point.snap === "vertex" ? "Vertex" : point.snap === "edge" ? "Edge" : "Surface" : "";
          if (point && state.lensEnabled) this.lens?.show(pos, point.canvasPos, !!point.snap);
          else this.lens?.hide();
        },
        onStart: () => {state.pending = true; state.selectedId = ""; this.reserveLabels(); this.update();},
        onComplete: (measurement, start, end) => {
          const item: StudioMeasurement = {id: measurement.id, number: this.sequence,
            origin: [...measurement.origin] as StudioMeasurement["origin"], target: [...measurement.target] as StudioMeasurement["target"],
            objectIds: [start.objectId, end.objectId], floorId: section.planFloorId,
            floorTitle: section.planFloorTitle, planCutHeight: section.planFloorId ? section.planCutHeight : undefined,
            text: this.format(measurement.length)};
          state.items = [...state.items, item]; state.pending = false; state.selectedId = item.id;
          this.reserveLabels(); this.update();
        },
        onCancel: () => {state.pending = false; state.snapHint = ""; this.announce();}
      });
    }
    const controller = this.params.getController();
    if (this.clickNavigation && (!this.params.isActive() || this.clickNavigation.controller !== controller)) this.restoreClickNavigation();
    if (this.params.isActive()) {
      if (controller && !this.clickNavigation) {
        this.clickNavigation = {controller, enabled: controller.doublePickFlyTo}; controller.doublePickFlyTo = false;
      }
      this.control?.activate();
    } else this.control?.deactivate();
    if (!state.lensEnabled) this.lens?.hide();
    this.update();
  }
  cancel(): void {this.control?.cancel();}
  locate(id: string): void {
    const {state, section, view} = this.params;
    const item = state.items.find(item => item.id === id);
    if (!item || !item.objectIds.every(id => !!view.objects[id])) return;
    this.cancel();
    if (item.floorId) {
      if (!section.floors.some(floor => floor.id === item.floorId)) return;
      this.params.showFloorPlan(item.floorId, item.planCutHeight);
      if (section.planFloorId !== item.floorId) return;
    } else if (section.planFloorId) this.params.returnTo3D();
    state.selectedId = id; state.visible = true;
    view.setObjectsVisible(item.objectIds, true);
    this.sync();
    const revision = ++this.locateRevision;
    // Let plan controls and the canvas settle before calculating the frame.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.disposed || revision !== this.locateRevision || state.selectedId !== id ||
          section.planFloorId !== item.floorId || !state.items.includes(item)) return;
      this.frame(item);
    }));
  }
  remove(id: string): void {
    const item = this.params.state.items.find(item => item.id === id);
    if (!item) return;
    this.rememberRemoval([item], `Delete measurement ${item.number}`);
    this.discard([item]);
  }
  clear(): void {
    this.cancel();
    if (!this.params.state.items.length) return;
    this.rememberRemoval([...this.params.state.items], "Clear measurements");
    this.discard([...this.params.state.items]);
  }
  undoRemoval(): void {
    const step = this.removals.pop(); if (!step) return;
    const {state, view} = this.params;
    const restored = step.items.filter(item => item.objectIds.every(id => !!view.objects[id]) && !state.items.some(existing => existing.id === item.id));
    state.items = [...state.items, ...restored].sort((a, b) => a.number - b.number);
    if (restored.some(item => item.id === step.selectedId)) state.selectedId = step.selectedId;
    for (const item of restored) this.restoreMeasurement(item);
    this.publishUndo(); this.sync(); this.reserveLabels();
  }
  private rememberRemoval(items: StudioMeasurement[], label: string): void {
    this.removals.push({items, selectedId: this.params.state.selectedId, label});
    if (this.removals.length > 30) this.removals.shift();
    this.publishUndo();
  }
  private publishUndo(): void {this.params.state.undoLabel = this.removals.at(-1)?.label || ""; this.announce();}
  private discard(items: StudioMeasurement[]): void {
    const ids = new Set(items.map(item => item.id));
    for (const id of ids) this.tool?.destroyMeasurement(id);
    const {state} = this.params;
    state.items = state.items.filter(item => !ids.has(item.id));
    if (ids.has(state.selectedId)) {state.selectedId = ""; ++this.locateRevision; this.flight?.cancel();}
    this.announce();
  }
  private restoreMeasurement(item: StudioMeasurement): void {
    if (!this.tool || this.tool.measurements[item.id]) return;
    this.tool.createMeasurement({...item, axisVisible: false, formatLength: length => `${item.number} · ${this.format(length)}`});
  }
  private frame(item: StudioMeasurement): void {
    const {scene, view} = this.params;
    const bounds = measurementBounds(item.origin, item.target, sceneMetersPerUnit(scene.coordinateSystem));
    cancelStudioCameraFlights(view);
    this.flight ??= new StudioCameraFlight(view, {duration: .35});
    const rect = view.htmlElement.getBoundingClientRect();
    const center = [0, 1, 2].map(i => (bounds[i] + bounds[i + 3]) / 2);
    if (item.floorId) {
      const distance = Math.hypot(...[0, 1, 2].map(i => view.camera.eye[i] - view.camera.look[i]));
      this.flight.flyTo({look: new Float64Array(center),
        eye: Float64Array.from(center, (v, i) => v + scene.coordinateSystem.worldUp[i] * distance),
        up: scene.coordinateSystem.worldForward,
        orthoScale: planScale(bounds, scene.coordinateSystem.worldRight, scene.coordinateSystem.worldForward, rect.width, rect.height)});
    } else {
      // Perspective fitting uses a vertical FOV; leave room on narrow screens.
      const aspectPadding = Math.max(1, rect.height / Math.max(1, rect.width));
      this.flight.flyTo({aabb: Float64Array.from(bounds, (v, i) => center[i % 3] + (v - center[i % 3]) * aspectPadding), fitFOV: 30});
    }
  }
  private format(length: number): string {return formatMeasurementLength(length, this.params.scene.coordinateSystem, this.params.state.unit);}
  private announce(): void {window.dispatchEvent(new Event("studio-overlay-change"));}
  private reserveLabels(): void {
    document.querySelectorAll(".xeokit-distance-measurements .xeokit-distance-label").forEach(label => label.setAttribute("data-plan-label-obstacle", ""));
    this.announce();
  }
  private schedule(): void {
    if (this.queued) return; this.queued = true;
    queueMicrotask(() => {this.queued = false; if (!this.disposed) this.update();});
  }
  private update(): void {
    if (!this.tool) return;
    const {state, view, section} = this.params;
    for (const item of state.items) {
      const measurement = this.tool.measurements[item.id]; if (!measurement) continue;
      item.text = this.format(measurement.length);
      measurement.color = state.selectedId === item.id ? SELECTED_COLOR : DEFAULT_COLOR;
      measurement.visible = state.visible && item.floorId === section.planFloorId && item.objectIds.every(id => view.objects[id]?.visible)
        && [item.origin, item.target].every((point, index) => view.objects[item.objectIds[index] ?? item.objectIds[0]]?.clippable === false ||
          Object.values(view.sectionPlanes).every(plane => !plane.active ||
          plane.dir[0] * point[0] + plane.dir[1] * point[1] + plane.dir[2] * point[2] + plane.dist <= 1e-7));
    }
    this.tool.update(); this.announce();
  }
  private touchPlacement(placing: boolean): void {
    if (placing && !this.suspended) {
      const controller = this.params.getController();
      if (controller) {this.suspended = {controller, enabled: controller.pointerEnabled}; controller.pointerEnabled = false;}
    } else if (!placing && this.suspended) {
      this.suspended.controller.pointerEnabled = this.suspended.enabled; this.suspended = null;
    }
  }
  private restoreClickNavigation(): void {
    if (this.clickNavigation) this.clickNavigation.controller.doublePickFlyTo = this.clickNavigation.enabled;
    this.clickNavigation = null;
  }
  private release(): void {
    this.restoreClickNavigation();
    this.control?.destroy(); this.control = null;
    this.lens?.destroy(); this.lens = null;
    this.tool?.destroy(); this.tool = null;
    this.canvas = null; this.renderer = null;
  }
  destroy(): void {this.disposed = true; ++this.locateRevision; this.flight?.destroy(); this.release(); this.unsubscribers.forEach(stop => stop());}
}
