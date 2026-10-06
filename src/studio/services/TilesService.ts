import type {Scene} from "@xeokit/sdk/model/scene";
import type {Renderer} from "@xeokit/sdk/viewing/rendering/core";
import type {View} from "@xeokit/sdk/viewing/viewer";

export interface TilePanelTile {
  id: string;
  rtcCenter: [number, number, number];
  size: number;
  tileIndex: number;
  numMeshes: number;
}

export interface TileProjectionView {
  id: "top" | "front" | "side";
  label: string;
  axesLabel: string;
  ax0: number;
  ax1: number;
  flipV1: boolean;
}

export interface TilesPanelState {
  active: boolean;
  rendererLabel: string;
  tiles: TilePanelTile[];
  projectionViews: TileProjectionView[];
  cameraEye: [number, number, number];
  cameraLook: [number, number, number];
  tileCount: number;
  meshCount: number;
  minTileSize: number;
  maxTileSize: number;
  frameDrawCalls: number | null;
  framePrimitives: number | null;
  frameRtcTiles: number | null;
  frameMeshesWithRtcTile: number | null;
  supportsTileMap: boolean;
  statusText: string;
  refreshing: boolean;
}

export interface TilesServiceParams {
  scene: Scene;
  view: View;
  renderer: Renderer;
  rendererLabel: string;
  state: TilesPanelState;
}

type RendererWithInspector = Renderer & {
  getRenderInspector?: () => {ok: boolean; value?: {renderStats?: any}; error?: string};
  getViewRenderStats?: (viewIndex: number) => any;
};

export function createTilesPanelState(): TilesPanelState {
  return {
    active: false,
    rendererLabel: "",
    tiles: [],
    projectionViews: [
      {id: "top", label: "Top", axesLabel: "X / Z", ax0: 0, ax1: 2, flipV1: false},
      {id: "front", label: "Front", axesLabel: "X / Y", ax0: 0, ax1: 1, flipV1: true},
      {id: "side", label: "Side", axesLabel: "Y / Z", ax0: 1, ax1: 2, flipV1: true}
    ],
    cameraEye: [0, 0, 0],
    cameraLook: [0, 0, 0],
    tileCount: 0,
    meshCount: 0,
    minTileSize: 0,
    maxTileSize: 0,
    frameDrawCalls: null,
    framePrimitives: null,
    frameRtcTiles: null,
    frameMeshesWithRtcTile: null,
    supportsTileMap: false,
    statusText: "Waiting for renderer tiles.",
    refreshing: false
  };
}

export class TilesService {
  private readonly _scene: Scene;
  private readonly _view: View;
  private readonly _state: TilesPanelState;
  private readonly _unsubscribers: Array<() => void> = [];
  private _renderer: RendererWithInspector;
  private _rendererLabel: string;
  private _frame: number | null = null;
  private _tilesDirty = true;
  private _active = false;
  private _unsubscribeRenderer?: () => void;
  private _destroyed = false;

  constructor(params: TilesServiceParams) {
    this._scene = params.scene;
    this._view = params.view;
    this._renderer = params.renderer as RendererWithInspector;
    this._rendererLabel = params.rendererLabel;
    this._state = params.state;
    this._state.projectionViews = getProjectionViews(params.scene);
    this._subscribe();
    this.refresh();
  }

  setRenderer(renderer: Renderer, rendererLabel: string): void {
    this._unsubscribeRenderer?.();
    this._renderer = renderer as RendererWithInspector;
    this._rendererLabel = rendererLabel;
    this._state.rendererLabel = rendererLabel;
    this._subscribeRenderer();
    this.scheduleRefresh();
  }

  setActive(active: boolean): void {
    if (this._destroyed || this._active === active) return;
    this._active = active;
    if (active) this._scheduleUpdate();
    else this._cancelUpdate();
  }

  scheduleRefresh(): void {
    this._tilesDirty = true;
    this._scheduleUpdate();
  }

  private _scheduleUpdate(): void {
    if (this._destroyed || !this._active || this._frame !== null) return;
    this._state.refreshing = this._tilesDirty;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      if (this._destroyed || !this._active) return;
      if (this._tilesDirty) this.refresh();
      else this._updateFrame(this._getRenderStats());
    });
  }

  refresh(): void {
    if (this._destroyed) return;
    this._tilesDirty = false;
    const renderStats = this._getRenderStats();
    const tiles = Object.values(renderStats?.tiles || {})
      .map((tile: any) => normalizeTile(tile))
      .filter((tile): tile is TilePanelTile => !!tile)
      .sort((a, b) => a.tileIndex - b.tileIndex || a.id.localeCompare(b.id));
    const frameStats = this._getFrameStats(renderStats);
    let minTileSize = Infinity;
    let maxTileSize = 0;
    let meshCount = 0;
    for (const tile of tiles) {
      minTileSize = Math.min(minTileSize, tile.size);
      maxTileSize = Math.max(maxTileSize, tile.size);
      meshCount += tile.numMeshes;
    }

    this._state.rendererLabel = this._rendererLabel;
    this._state.tiles = tiles;
    this._state.projectionViews = getProjectionViews(this._scene);
    this._state.tileCount = tiles.length;
    this._state.meshCount = meshCount;
    this._state.minTileSize = Number.isFinite(minTileSize) ? minTileSize : 0;
    this._state.maxTileSize = maxTileSize;
    this._updateFrame(renderStats);
    this._state.supportsTileMap = tiles.length > 0 || !!renderStats?.tiles;
    this._state.statusText = tiles.length > 0
      ? `${tiles.length} RTC tile${tiles.length === 1 ? "" : "s"} tracked by ${this._rendererLabel}.`
      : this._emptyStatus(renderStats, frameStats);
    this._state.refreshing = false;
  }

  copyTilesJson(): Promise<void> {
    const json = JSON.stringify(this._state.tiles, null, 2);
    return navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(json)
      : Promise.resolve();
  }

  destroy(): void {
    this._destroyed = true;
    this._cancelUpdate();
    this._unsubscribeRenderer?.();
    this._unsubscribeRenderer = undefined;
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
  }

  private _cancelUpdate(): void {
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._state.refreshing = false;
  }

  private _updateFrame(renderStats: any | null): void {
    const {eye, look} = this._view.camera;
    if (this._state.cameraEye.some((value, i) => value !== eye[i])) this._state.cameraEye = toVec3(eye);
    if (this._state.cameraLook.some((value, i) => value !== look[i])) this._state.cameraLook = toVec3(look);
    const frame = this._getFrameStats(renderStats);
    this._state.frameDrawCalls = finiteOrNull(frame?.numDrawCalls);
    this._state.framePrimitives = finiteOrNull(frame?.numPrimitives ?? frame?.numPrims);
    this._state.frameRtcTiles = finiteOrNull(frame?.numRTCTiles);
    this._state.frameMeshesWithRtcTile = finiteOrNull(frame?.numMeshesWithRTCTile);
  }

  private _getRenderStats(): any | null {
    const result = this._renderer.getRenderInspector?.();
    if (!result?.ok) {
      return null;
    }
    return result.value?.renderStats || null;
  }

  private _getFrameStats(renderStats: any | null): any | null {
    const viewIndex = Number((this._view as any).viewIndex ?? 0);
    return this._renderer.getViewRenderStats?.(viewIndex) || renderStats?.views?.[viewIndex] || null;
  }

  private _emptyStatus(renderStats: any | null, frameStats: any | null): string {
    if (!renderStats) {
      return `Renderer diagnostics are not available from ${this._rendererLabel}.`;
    }
    if (frameStats?.numRTCTiles !== undefined) {
      return `${this._rendererLabel} reports ${frameStats.numRTCTiles} RTC tile${frameStats.numRTCTiles === 1 ? "" : "s"}, but does not expose tile rectangles for this minimap.`;
    }
    return "No RTC tiles to display for the current scene and renderer.";
  }

  private _subscribe(): void {
    const events = this._scene.events;
    const refresh = () => this.scheduleRefresh();
    this._unsubscribers.push(
      events.onSceneModelCreated.subscribe(refresh),
      events.onSceneModelDestroyed.subscribe(refresh),
      events.onSceneObjectCreated.subscribe(refresh),
      events.onSceneObjectDestroyed.subscribe(refresh),
      events.onSceneObjectMeshAdded.subscribe(refresh),
      events.onSceneObjectMeshRemoved.subscribe(refresh),
      events.onSceneMeshCreated.subscribe(refresh),
      events.onSceneMeshDestroyed.subscribe(refresh),
      events.onSceneMeshMatrixChanged.subscribe(refresh),
      events.onSceneMeshMoved.subscribe(refresh),
      events.onSceneModelBuildFinished.subscribe(refresh),
      events.onSceneModelBatchCommitted.subscribe(refresh),
      events.onSceneCoordSystemUpdated.subscribe(refresh),
      events.onSceneModelCoordSystemUpdated.subscribe(refresh),
      events.onSceneDestroyed.subscribe(() => this.destroy())
    );
    const viewerEvents = this._view.viewer?.events;
    if (viewerEvents?.onCameraViewMatrixUpdated?.subscribe) {
      this._unsubscribers.push(viewerEvents.onCameraViewMatrixUpdated.subscribe((view) => {
        if (view === this._view) this._scheduleUpdate();
      }));
    }
    this._subscribeRenderer();
  }

  private _subscribeRenderer(): void {
    const rendererEvents = this._renderer.events;
    if (rendererEvents?.onViewRendered?.subscribe) {
      this._unsubscribeRenderer = rendererEvents.onViewRendered.subscribe((_renderer, view) => {
        if (view === this._view) this._scheduleUpdate();
      });
    }
  }
}

function normalizeTile(tile: any): TilePanelTile | null {
  if (!tile || !Array.isArray(tile.rtcCenter) || tile.rtcCenter.length < 3 || !Number.isFinite(Number(tile.size))) {
    return null;
  }
  return {
    id: String(tile.id ?? tile.tileIndex ?? ""),
    rtcCenter: [Number(tile.rtcCenter[0]) || 0, Number(tile.rtcCenter[1]) || 0, Number(tile.rtcCenter[2]) || 0],
    size: Number(tile.size) || 0,
    tileIndex: Number(tile.tileIndex) || 0,
    numMeshes: Number(tile.numMeshes) || 0
  };
}

function getProjectionViews(scene: Scene): TileProjectionView[] {
  const coordinateSystem = scene.coordinateSystem;
  const upAxis = axisIndex(coordinateSystem.worldUp);
  const rightAxis = axisIndex(coordinateSystem.worldRight);
  const forwardAxis = axisIndex(coordinateSystem.worldForward);
  return [
    {id: "top", label: "Top", axesLabel: axisLabel(rightAxis, forwardAxis), ax0: rightAxis, ax1: forwardAxis, flipV1: false},
    {id: "front", label: "Front", axesLabel: axisLabel(rightAxis, upAxis), ax0: rightAxis, ax1: upAxis, flipV1: true},
    {id: "side", label: "Side", axesLabel: axisLabel(forwardAxis, upAxis), ax0: forwardAxis, ax1: upAxis, flipV1: true}
  ];
}

function axisIndex(vec: ArrayLike<number> | undefined | null): number {
  if (!vec || vec.length < 3) {
    return 1;
  }
  let bestAxis = 0;
  let bestMagnitude = Math.abs(vec[0]);
  for (let i = 1; i < 3; i++) {
    const magnitude = Math.abs(vec[i]);
    if (magnitude > bestMagnitude) {
      bestAxis = i;
      bestMagnitude = magnitude;
    }
  }
  return bestAxis;
}

function axisLabel(ax0: number, ax1: number): string {
  const names = ["X", "Y", "Z"];
  return `${names[ax0] || "?"} / ${names[ax1] || "?"}`;
}

function finiteOrNull(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toVec3(values: ArrayLike<number>): [number, number, number] {
  return [Number(values[0]) || 0, Number(values[1]) || 0, Number(values[2]) || 0];
}
