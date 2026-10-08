import {withoutViewHistory} from "./ViewHistoryService";
import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {SelectionService} from "./SelectionService";
import type {SectionViewService} from "./SectionViewService";
import {cancelStudioCameraFlights} from "./StudioCameraFlight";
import {modelTitle} from "./modelNames";
import {viewIsolation} from "./ViewIsolation";

export interface LoadedModel {
  id: string;
  title: string;
  sceneModelId?: string;
  dataModelId?: string;
  visibleCount?: number;
  objectCount?: number;
}

/** A model in the UI includes the geometry and metadata loaded together. */
export class LoadedModelsService {
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;
  private queued = false;

  constructor(private readonly params: {
    scene: Scene; data: Data; view: View;
    state: {loadedModels: LoadedModel[]};
    selection: SelectionService;
    section: SectionViewService;
    initialModels?: LoadedModel[];
    isBusy: () => boolean;
    onChanged?: () => void;
    onUnloaded?: (model: LoadedModel) => void;
  }) {
    for (const event of [params.scene.events.onSceneModelCreated, params.scene.events.onSceneModelDestroyed,
      params.data.events.onDataModelCreated, params.data.events.onDataModelDestroyed]) {
      this.unsubscribers.push(event.subscribe(() => {
        if (this.queued || this.disposed) return;
        this.queued = true;
        queueMicrotask(() => {this.queued = false; if (!this.disposed) this.refresh();});
      }));
    }
    const visibility = params.view.viewer?.events.onViewObjectVisibleChanged;
    if (visibility) {
      let pending = false;
      this.unsubscribers.push(visibility.subscribe(() => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => {pending = false; if (!this.disposed) this.refreshVisibility();});
      }));
    }
    this.refresh();
  }

  refresh(): void {
    const {scene, data, state} = this.params;
    const scenes = new Set(Object.keys(scene.models)), semantics = new Set(Object.keys(data.models));
    const models: LoadedModel[] = [];
    // The bundled example has distinct geometry and data IDs. Imports use the
    // same ID for both, so pairing never depends on overlapping object IDs.
    for (const model of this.params.initialModels || []) {
      const sceneModelId = model.sceneModelId && scenes.has(model.sceneModelId) ? model.sceneModelId : undefined;
      const dataModelId = model.dataModelId && semantics.has(model.dataModelId) ? model.dataModelId : undefined;
      if (!sceneModelId && !dataModelId) continue;
      models.push({...model, sceneModelId, dataModelId});
      if (sceneModelId) scenes.delete(sceneModelId);
      if (dataModelId) semantics.delete(dataModelId);
    }
    for (const id of new Set([...scenes, ...semantics])) models.push({
      id: `model:${id}`, title: modelTitle(scene.models[id] || data.models[id]),
      sceneModelId: scenes.has(id) ? id : undefined,
      dataModelId: semantics.has(id) ? id : undefined
    });
    state.loadedModels = models;
    this.refreshVisibility();
    this.params.onChanged?.();
  }

  objectIds(target: unknown): string[] {
    const model = this.find(target);
    return model?.sceneModelId ? Object.keys(this.params.scene.models[model.sceneModelId]?.objects || {})
      .filter(id => !!this.params.view.objects[id]) : [];
  }

  toggleVisibility(target: unknown): void {
    const ids = this.objectIds(target), {view} = this.params;
    view.setObjectsVisible(ids, !ids.some(id => view.objects[id].visible));
    this.refreshVisibility();
  }

  private refreshVisibility(): void {
    for (const model of this.params.state.loadedModels) {
      const ids = this.objectIds(model.id);
      model.objectCount = ids.length;
      model.visibleCount = ids.filter(id => this.params.view.objects[id].visible).length;
    }
  }

  find(target: unknown): LoadedModel | undefined {
    if (typeof target === "string") return this.params.state.loadedModels.find(model => model.id === target);
    if (!target || typeof target !== "object") return undefined;
    const {source, modelId} = target as {source?: string; modelId?: string};
    if (!modelId || (source !== "scene" && source !== "data")) return undefined;
    return this.params.state.loadedModels.find(model =>
      (source === "scene" ? model.sceneModelId : model.dataModelId) === modelId);
  }

  canUnload(target: unknown): boolean {
    if (this.disposed || this.params.isBusy()) return false;
    const model = this.find(target);
    return !!model && (!!(model.sceneModelId && this.params.scene.models[model.sceneModelId])
      || !!(model.dataModelId && this.params.data.models[model.dataModelId]));
  }

  unload(target: unknown): void {
    if (!this.canUnload(target)) return;
    withoutViewHistory(this.params.view, () => this.removeModel(target));
  }
  private removeModel(target: unknown): void {
    const model = this.find(target)!;
    const {scene, data, view, selection, section} = this.params;
    const geometry = model.sceneModelId ? scene.models[model.sceneModelId] : undefined;
    const metadata = model.dataModelId ? data.models[model.dataModelId] : undefined;
    cancelStudioCameraFlights(view);
    if (selection.selectedSceneObjectId && geometry?.objects[selection.selectedSceneObjectId]) selection.clear();
    // Use the SDK lifecycle to release renderer resources and preserve semantic
    // objects that are still owned by another DataModel.
    for (const part of [geometry, metadata]) if (part) {
      const result = part.destroy();
      if (result.ok === false) {this.refresh(); throw new Error(result.error);}
    }
    section.refresh(); // Exits a floor plan if its floor was unloaded.
    if (!Object.keys(scene.objects).length) section.clear();
    const isolation = viewIsolation(view);
    if (isolation.label && !Object.values(view.objects).some(object => object.visible)) isolation.restore();
    if (selection.selectedSceneObjectId) selection.selectSceneObject(selection.selectedSceneObjectId);
    this.refresh();
    this.params.onUnloaded?.(model);
    view.needsRender();
  }

  destroy(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }
}
