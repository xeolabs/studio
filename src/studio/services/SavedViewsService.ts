import {OrbitNavigationMode} from "@xeokit/sdk/base/constants";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {SavedView, SavedViewSnapshot, SavedViewsState} from "../state/savedViewsState";
import type {SectionViewService} from "./SectionViewService";
import {capturePlanAppearance, restorePlanAppearance} from "./planAppearance";
import {viewIsolation} from "./ViewIsolation";
import {withoutViewHistory} from "./ViewHistoryService";
import {cancelStudioCameraFlights} from "./StudioCameraFlight";
import {readSavedViews, writeSavedViews, savedViewsModelKey, validSavedSnapshot} from "./savedViewsStorage";

export class SavedViewsService {
  private stops: Array<() => void> = [];
  private disposed = false;
  private refreshQueued = false;
  private dirty = true;
  private readable = true;
  private deleted: {item: SavedView; index: number} | null = null;

  constructor(private readonly params: {
    scene: Scene; view: View; section: SectionViewService; state: SavedViewsState;
    getStorage: () => Pick<Storage, "getItem" | "setItem">;
    getController: () => {navMode: number; pointerEnabled: boolean} | null;
    captureThumbnail: () => Promise<string>;
    beforeRestore: () => void;
    isBusy: () => boolean;
  }) {
    const events = params.scene.events;
    for (const event of [events.onSceneModelCreated, events.onSceneModelBuildFinished, events.onSceneModelDestroyed,
      events.onSceneObjectCreated, events.onSceneObjectDestroyed, events.onSceneModelCoordSystemUpdated,
      events.onSceneCoordSystemUpdated, events.onSceneMeshMoved]) {
      this.stops.push(event.subscribe(() => {
        this.dirty = true;
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        queueMicrotask(() => {this.refreshQueued = false; if (!this.disposed && this.params.state.open) this.refresh();});
      }));
    }
    this.refresh();
  }

  open(): void {this.refresh(true); this.params.state.open = true;}

  refresh(force = false): void {
    if (this.disposed || (!this.dirty && !force)) return;
    const {state, scene} = this.params;
    const key = savedViewsModelKey(scene);
    this.dirty = false;
    if (key === state.modelKey && !force) return;
    if (key !== state.modelKey) {this.deleted = null; state.undoName = ""; state.notice = "";}
    state.modelKey = key;
    state.error = "";
    this.readable = true;
    try {state.items = key ? readSavedViews(this.params.getStorage(), key) : [];}
    catch {
      this.readable = false;
      state.items = [];
      state.error = "Saved views could not be read from this browser. Existing views have been left untouched.";
    }
  }

  async save(value: unknown): Promise<void> {
    if (this.disposed || this.params.state.busy || this.params.isBusy()) return;
    this.refresh(true);
    const {state, view} = this.params, name = this.name(value);
    if (!name || !this.readable) return;
    if (!state.modelKey) {state.error = "Load a model before saving a view."; return;}
    cancelStudioCameraFlights(view);
    this.resetNavigation();
    const snapshot = this.capture();
    if (!validSavedSnapshot(snapshot)) {state.error = "This camera view cannot be saved. Choose a perspective or plan view."; return;}
    const key = state.modelKey;
    state.busy = true; state.error = ""; state.notice = "";
    try {
      const thumbnail = await this.params.captureThumbnail();
      if (this.disposed) return;
      this.refresh(true);
      if (state.modelKey !== key || this.params.isBusy()) {state.error = "The loaded models changed. Save the view again when loading finishes."; return;}
      const item: SavedView = {id: globalThis.crypto?.randomUUID?.() || `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name, thumbnail, createdAt: new Date().toISOString(),
        floorTitle: this.params.section.getPlanTitle(), snapshot};
      if (this.commit([item, ...state.items])) state.notice = thumbnail ? `Saved “${name}”.` : `Saved “${name}”. A preview was unavailable.`;
    } catch {state.error = "The view could not be saved. Please try again.";}
    finally {state.busy = false;}
  }

  restore(id: unknown): void {
    if (this.params.state.busy || this.params.isBusy() || this.disposed) return;
    this.refresh(true);
    const item = this.params.state.items.find(item => item.id === id);
    if (!item || !validSavedSnapshot(item.snapshot)) return;
    const saved = item.snapshot, {view, state, section} = this.params;
    if (!section.canRestoreSavedState(saved.section)) {state.error = "The floor for this view is not loaded. Load its model and try again."; return;}
    this.params.beforeRestore();
    cancelStudioCameraFlights(view);
    withoutViewHistory(view, () => {
      section.restoreSavedState(saved.section);
      this.resetNavigation(saved.camera.navMode);
      const camera = view.camera, c = saved.camera;
      camera.eye = new Float64Array(c.eye); camera.look = new Float64Array(c.look); camera.up = new Float64Array(c.up);
      Object.assign(camera.perspectiveProjection, {fov: c.fov, near: c.near, far: c.far});
      Object.assign(camera.orthoProjection, {scale: c.scale, near: c.orthoNear, far: c.orthoFar});
      camera.projectionType = c.projection;
      const ids = Object.keys(view.objects), existing = (ids: string[]) => ids.filter(id => !!view.objects[id]);
      view.setObjectsVisible(ids, true); view.setObjectsVisible(existing(saved.hidden), false);
      for (const style of ["xrayed", "highlighted"] as const) {
        view.setObjectsInStyleBin(style, ids, false);
        view.setObjectsInStyleBin(style, existing(saved[style]), true);
      }
      viewIsolation(view).restoreSession({label: saved.isolation.label,
        previous: saved.isolation.previous ? new Map(saved.isolation.previous) : null});
      restorePlanAppearance(view, {...saved.appearance, edges: {...saved.appearance.edges, edgeColor: new Float64Array(saved.appearance.edges.edgeColor)}});
    });
    state.error = ""; state.open = false;
    view.needsRender();
  }

  rename(id: unknown, value: unknown): void {
    if (!this.ready()) return;
    const name = this.name(value);
    if (!name || !this.params.state.items.some(item => item.id === id)) return;
    if (this.commit(this.params.state.items.map(item => item.id === id ? {...item, name} : item))) this.params.state.notice = `Renamed to “${name}”.`;
  }

  remove(id: unknown): void {
    if (!this.ready()) return;
    const {state} = this.params, index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;
    const item = state.items[index];
    if (this.commit(state.items.filter(item => item.id !== id))) {
      this.deleted = {item, index}; state.undoName = item.name; state.notice = `Deleted “${item.name}”.`;
    }
  }

  undoDelete(): void {
    if (!this.ready() || !this.deleted) return;
    const items = [...this.params.state.items];
    items.splice(this.deleted.index, 0, this.deleted.item);
    if (this.commit(items)) {this.deleted = null; this.params.state.undoName = ""; this.params.state.notice = "View restored.";}
  }

  destroy(): void {this.disposed = true; for (const stop of this.stops) stop();}

  private ready(): boolean {
    if (this.disposed || this.params.state.busy || this.params.isBusy()) return false;
    this.refresh(true);
    return this.readable && !!this.params.state.modelKey;
  }
  private name(value: unknown): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 100) {this.params.state.error = "Give this view a name (up to 100 characters)."; return "";}
    return name;
  }
  private commit(items: SavedView[]): boolean {
    const {state} = this.params;
    if (!this.readable) return false;
    try {writeSavedViews(this.params.getStorage(), state.modelKey, items);}
    catch {state.error = "Browser storage is unavailable or full. Your change was not saved; existing views are unchanged."; return false;}
    state.items = items; state.error = "";
    return true;
  }
  private resetNavigation(mode?: number): void {
    const controller = this.params.getController();
    if (!controller) return;
    const enabled = controller.pointerEnabled;
    controller.pointerEnabled = false;
    if (mode !== undefined) controller.navMode = mode;
    controller.pointerEnabled = enabled;
  }
  private capture(): SavedViewSnapshot {
    const {view} = this.params, camera = view.camera, isolation = viewIsolation(view).captureSession();
    const appearance = capturePlanAppearance(view);
    return {camera: {eye: Array.from(camera.eye), look: Array.from(camera.look), up: Array.from(camera.up),
      projection: camera.projectionType, scale: camera.orthoProjection.scale,
      fov: camera.perspectiveProjection.fov, near: camera.perspectiveProjection.near, far: camera.perspectiveProjection.far,
      orthoNear: camera.orthoProjection.near, orthoFar: camera.orthoProjection.far,
      navMode: this.params.getController()?.navMode ?? OrbitNavigationMode},
      section: this.params.section.captureSavedState(),
      hidden: Object.keys(view.objects).filter(id => !view.objects[id].visible),
      xrayed: Object.keys(view.objects).filter(id => view.objects[id].hasStyleBin("xrayed")),
      highlighted: Object.keys(view.objects).filter(id => view.objects[id].hasStyleBin("highlighted")),
      isolation: {label: isolation.label, previous: isolation.previous ? [...isolation.previous] : null},
      appearance: {...appearance, edges: {...appearance.edges, edgeColor: Array.from(appearance.edges.edgeColor)}}};
  }
}
