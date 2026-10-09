import type {Data} from "@xeokit/sdk/model/data";
import type {Scene, SceneModel, CoordinateSystemParams} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import {XGFViewStreamController, readXGFStreamingRuntimeIndex, type XGFStreamingIndex} from "@xeokit/sdk/formats/xgfstream";
import type {BundledModel} from "../app/bundledModels";
import type {LoadedModel} from "./LoadedModelsService";
import {StreamLifecycle} from "./StreamLifecycle";
import {fetchArrayBuffer, fetchJSON, mustOk} from "../runtime";

export interface BundledStreamState {
  id: string; title: string; loaded: number; total: number;
  phase: "loading" | "moving" | "ready" | "complete" | "error";
  error: string;
}

interface StreamSession {
  model: SceneModel;
  controller: XGFViewStreamController;
  lifecycle: StreamLifecycle;
  abort: AbortController;
  state: BundledStreamState;
  disposed: boolean;
}

export function resolveStreamIndex(index: XGFStreamingIndex, indexURL: string): XGFStreamingIndex {
  const resolve = (uri?: string) => uri ? new URL(uri, indexURL).href : undefined;
  return {...index, chunks: index.chunks.map(chunk => ({...chunk, uri: resolve(chunk.uri),
    dependencies: {...chunk.dependencies, chunks: chunk.dependencies?.chunks?.map(dependency =>
      ({...dependency, uri: resolve(dependency.uri)}))}
  }))};
}

/** Loads catalogue entries and keeps stream scheduling tied to model ownership. */
export class BundledModelsService {
  readonly initialModels: LoadedModel[] = [];
  readonly streams = new Map<string, StreamSession>();
  onChanged?: () => void;
  private readonly stops: Array<() => void> = [];
  private lastRefresh = 0;
  private lastSnapshot = "";
  private inspectedRenderer: any;
  private inspector: any;
  private started = false;
  private disposed = false;

  constructor(private readonly params: {
    scene: Scene; data: Data; view: View;
    baseURL: string;
    getRenderer: () => any;
    workspace: any;
  }) {
    this.stops.push(params.scene.events.onSceneModelDestroyed.subscribe((_scene, model) => this.remove(model.id)));
  }

  async prepare(models: BundledModel[]): Promise<void> {
    for (const entry of models) {
      this.params.workspace.setStatus(`Preparing ${entry.title}…`);
      const url = (path: string) => new URL(path, this.params.baseURL).href;
      const source = entry.source;
      if (source.kind === "xgf") {
        const model = mustOk(this.params.scene.createModel({id: entry.sceneModelId, updateMode: "static",
          coordinateSystem: await fetchJSON(url(source.coordinates))}));
        const metadata = mustOk(this.params.data.createModel({id: source.dataModelId}));
        const [{XGFLoader}, {DataModelImporter}] = await Promise.all([
          import("@xeokit/sdk/formats/xgf"), import("@xeokit/sdk/formats/datamodel")]);
        await new XGFLoader().load({fileData: await fetchArrayBuffer(url(source.geometry)), sceneModel: model});
        await new DataModelImporter().load({fileData: await fetchJSON(url(source.data)), dataModel: metadata});
        this.initialModels.push({id: `bundled:${entry.id}`, title: entry.title, sceneModelId: model.id, dataModelId: metadata.id});
      } else {
        const indexURL = url(source.index);
        const index = resolveStreamIndex(mustOk(readXGFStreamingRuntimeIndex(await fetchJSON(indexURL))), indexURL);
        const model = mustOk(this.params.scene.createModel({id: entry.sceneModelId, updateMode: "static",
          loadingMode: "streaming", coordinateSystem: index.coordinateSystem ? {...index.coordinateSystem,
            units: (index.coordinateSystem.units || "meters") as CoordinateSystemParams["units"],
            basis: index.coordinateSystem.basis ? new Float64Array(index.coordinateSystem.basis) : undefined,
            origin: index.coordinateSystem.origin ? new Float64Array(index.coordinateSystem.origin) : undefined} : undefined}));
        this.initialModels.push({id: `bundled:${entry.id}`, title: entry.title, sceneModelId: model.id});
        this.createStream(entry, model, index);
      }
    }
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    for (const session of this.streams.values()) session.lifecycle.start();
  }

  private createStream(entry: BundledModel, model: SceneModel, index: XGFStreamingIndex): void {
    const abort = new AbortController();
    const state: BundledStreamState = {id: entry.id, title: entry.title, loaded: 0,
      total: index.chunks.filter(chunk => chunk.role === "referencesOnly").length, phase: "loading", error: ""};
    let session: StreamSession;
    const fail = (error: unknown) => {
      if (!session || session.disposed || abort.signal.aborted) return;
      state.phase = "error";
      state.error = error instanceof Error ? error.message : String(error);
      session.lifecycle.destroy();
      abort.abort();
      this.params.workspace.appendOutput(`${entry.title}: ${state.error}`, "Streaming");
      this.params.workspace.appendEvent("stream", "failed", state.error, "error");
      this.publish(true);
    };
    const controller = new XGFViewStreamController({
      index, sceneModel: model, view: this.params.view,
      batchSize: 4, fetchConcurrency: 6, commitFrameBudgetMs: 0, progressCadenceMs: 100,
      frustumOnly: true, minProjectedChunkSizePixels: 3, chunkPriorityTarget: "eye", cameraDebounceMs: 140,
      enableLRUEviction: false, cacheFileData: false,
      loadOptions: {getFileData: async (manifest, signal?: AbortSignal) => {
        const response = await fetch(manifest.uri!, {signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal});
        if (!response.ok) throw new Error(`Could not load ${manifest.id}: HTTP ${response.status}`);
        return response.arrayBuffer();
      }},
      backpressure: {shouldPause: () => this.params.workspace.rendererSwitching || this.pendingSegments() >= 48,
        shouldResume: () => !this.params.workspace.rendererSwitching && this.pendingSegments() <= 16},
      onProgress: () => this.publish(),
      onChunkLoadStats: stats => {if (!stats.ok) fail(new Error(stats.error || `Failed to load ${stats.chunkId}`));},
      onError: fail
    });
    const {view} = this.params;
    const lifecycle = new StreamLifecycle({controller,
      subscribeCamera: changed => {
        const onCamera = (target: unknown) => {if (target === view || target === view.camera) changed();};
        const stops = [view.viewer.events.onCameraViewMatrixUpdated.subscribe(onCamera),
          view.viewer.events.onCameraProjMatrixUpdated.subscribe(onCamera)];
        return () => stops.forEach(stop => stop());
      },
      pendingSegments: () => this.params.workspace.rendererSwitching ? Infinity : this.pendingSegments(),
      seal: () => mustOk(model.seal()),
      onChanged: () => this.publish(lifecycle.complete)
    });
    session = {model, controller, lifecycle, abort, state, disposed: false};
    this.streams.set(model.id, session);
    this.publish(true);
  }

  private pendingSegments(): number {
    const renderer = this.params.getRenderer();
    if (renderer !== this.inspectedRenderer) {
      this.inspectedRenderer = renderer;
      const result = renderer?.getRenderInspector?.();
      this.inspector = result?.ok ? result.value : undefined;
      if (this.inspector) this.inspector.enabled = true;
    }
    return this.inspector?.renderStats?.views?.[this.params.view.viewIndex]?.numPendingSegments ?? 0;
  }

  private publish(force = false): void {
    if (this.disposed) return;
    const now = Date.now();
    if (!force && now - this.lastRefresh < 250) return;
    this.lastRefresh = now;
    const states = [...this.streams.values()].map(session => {
      const {state, controller, lifecycle} = session;
      state.loaded = controller.loadedChunkIds.size;
      if (state.phase !== "error") state.phase = lifecycle.complete ? "complete" : lifecycle.moving ? "moving"
        : !controller.loadingChunkIds.size && controller.queueProgress.loaded >= controller.queueProgress.queued ? "ready" : "loading";
      return {...state};
    });
    const snapshot = JSON.stringify(states);
    if (!force && snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    this.params.workspace.bundledStreams = states;
    this.onChanged?.();
  }

  private remove(modelId: string): void {
    const session = this.streams.get(modelId);
    if (!session) return;
    session.disposed = true;
    session.lifecycle.destroy();
    session.abort.abort();
    this.streams.delete(modelId);
    this.publish(true);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    for (const id of this.streams.keys()) this.remove(id);
    this.onChanged = undefined;
  }
}
