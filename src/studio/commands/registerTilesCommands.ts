import type {StudioActions} from "../app/types";
import type {CommandRegistry} from "./CommandRegistry";
import {copyText} from "../ui/clipboard";

export interface RegisterTilesCommandsParams {
  commands: CommandRegistry;
  tilesPanelState: any;
  openToolWindow?: (panelId: string) => void;
  actions: Pick<StudioActions, "tilesActions">;
}

export function registerTilesCommands(params: RegisterTilesCommandsParams): void {
  params.commands.register({
    id: "tiles.refresh",
    title: "Refresh Tiles",
    category: "Tools: Tiles",
    enabled: () => !params.tilesPanelState.refreshing,
    run: () => {
      params.openToolWindow?.("tiles");
      params.actions.tilesActions.refresh();
    }
  });
  params.commands.register({
    id: "tiles.openAndRefresh",
    title: "Open and Refresh Tiles",
    category: "Tools: Tiles",
    enabled: () => !params.tilesPanelState.refreshing,
    run: () => {
      params.openToolWindow?.("tiles");
      params.actions.tilesActions.refresh();
    }
  });
  params.commands.register({
    id: "tiles.copyJson",
    title: "Copy Tiles as JSON",
    category: "Tools: Tiles",
    shortcut: "Ctrl+Alt+Shift+T",
    enabled: () => params.tilesPanelState.tiles.length > 0,
    run: () => {
      params.openToolWindow?.("tiles");
      params.actions.tilesActions.copyJson();
    }
  });
  params.commands.register({
    id: "tiles.copySummaryJson",
    title: "Copy Tile Summary as JSON",
    category: "Tools: Tiles",
    run: () => {
      void copyText(JSON.stringify(tileSummary(params.tilesPanelState), null, 2));
    }
  });
  params.commands.register({
    id: "tiles.copyFrameStatsJson",
    title: "Copy Tile Frame Stats as JSON",
    category: "Tools: Tiles",
    run: () => {
      void copyText(JSON.stringify({
        rendererLabel: params.tilesPanelState.rendererLabel,
        frameDrawCalls: params.tilesPanelState.frameDrawCalls,
        framePrimitives: params.tilesPanelState.framePrimitives,
        frameRtcTiles: params.tilesPanelState.frameRtcTiles,
        frameMeshesWithRtcTile: params.tilesPanelState.frameMeshesWithRtcTile,
        supportsTileMap: params.tilesPanelState.supportsTileMap
      }, null, 2));
    }
  });
  params.commands.register({
    id: "tiles.copyCameraJson",
    title: "Copy Tile Camera Snapshot as JSON",
    category: "Tools: Tiles",
    run: () => {
      void copyText(JSON.stringify({
        cameraEye: params.tilesPanelState.cameraEye,
        cameraLook: params.tilesPanelState.cameraLook,
        projectionViews: params.tilesPanelState.projectionViews
      }, null, 2));
    }
  });
}

function tileSummary(state: any): unknown {
  return {
    rendererLabel: state.rendererLabel,
    tileCount: state.tileCount,
    meshCount: state.meshCount,
    minTileSize: state.minTileSize,
    maxTileSize: state.maxTileSize,
    supportsTileMap: state.supportsTileMap,
    statusText: state.statusText,
    refreshing: state.refreshing
  };
}
