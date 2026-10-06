import {renderTileProjectionSvg, renderMinimapCameraSvg} from "../../ui/minimapSvg";
import {createTileMinimapProjection, type MinimapProjection} from "../../ui/minimapProjection";
import {observePanelActivity, type PanelVisibilityApi} from "../../ui/observePanelActivity";
import type {TilesPanelState} from "../../services/TilesService";

export function createTilesPanel(Vue: any) {
  return {
    name: "StudioTilesPanel",
    props: ["params"],
    setup(props: {params?: {api?: PanelVisibilityApi}}) {
      const state = Vue.inject("tilesPanelState") as TilesPanelState;
      let stopActivity: (() => void) | undefined;
      Vue.onMounted(() => { stopActivity = observePanelActivity(props.params?.api, active => { state.active = active; }); });
      Vue.onBeforeUnmount(() => stopActivity?.());
      const commands = Vue.inject("commands") as any;
      const formatNumber = (value: number | null) => value === null || !Number.isFinite(value) ? "n/a" : Number(value).toLocaleString();
      const formatSize = (value: number) => Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} m` : "n/a";
      const projections = Vue.computed(() => state.projectionViews.map(projection => ({
        ...projection,
        frame: createTileMinimapProjection(state.tiles, projection),
        svg: renderTileProjectionSvg({tiles: state.tiles, projection})
      })));
      const renderCamera = (frame: MinimapProjection | null) => renderMinimapCameraSvg(frame, state.cameraEye, state.cameraLook);
      const runCommand = (commandId: string) => commands.execute(commandId);
      const commandEnabled = (commandId: string) => commands.isEnabled(commandId);
      return {commandEnabled, formatNumber, formatSize, projections, renderCamera, runCommand, state};
    },
    template: `
      <section class="studio-panel tiles-panel" aria-label="Renderer RTC tiles">
        <header class="tiles-toolbar">
          <div>
            <h1>Tiles</h1>
            <p>{{ state.rendererLabel || 'Renderer' }}</p>
          </div>
          <div class="tiles-toolbar-actions">
            <el-button size="small" @click="runCommand('tiles.copyJson')" :disabled="!commandEnabled('tiles.copyJson')">JSON</el-button>
            <el-button size="small" @click="runCommand('tiles.refresh')" :disabled="!commandEnabled('tiles.refresh')">{{ state.refreshing ? 'Refreshing' : 'Refresh' }}</el-button>
          </div>
        </header>
        <section class="tiles-summary" :data-empty="state.tiles.length === 0 ? 'true' : 'false'">
          <strong>{{ state.statusText }}</strong>
          <span v-if="state.refreshing">refreshing</span>
        </section>
        <section class="tiles-stats">
          <div><span>Tiles</span><strong>{{ state.tileCount }}</strong></div>
          <div><span>Meshes</span><strong>{{ state.meshCount }}</strong></div>
          <div><span>Min Size</span><strong>{{ formatSize(state.minTileSize) }}</strong></div>
          <div><span>Max Size</span><strong>{{ formatSize(state.maxTileSize) }}</strong></div>
          <div><span>Draw Calls</span><strong>{{ formatNumber(state.frameDrawCalls) }}</strong></div>
          <div><span>Primitives</span><strong>{{ formatNumber(state.framePrimitives) }}</strong></div>
          <div v-if="state.frameRtcTiles !== null"><span>Frame RTC Tiles</span><strong>{{ formatNumber(state.frameRtcTiles) }}</strong></div>
          <div v-if="state.frameMeshesWithRtcTile !== null"><span>RTC Meshes</span><strong>{{ formatNumber(state.frameMeshesWithRtcTile) }}</strong></div>
        </section>
        <section class="tiles-minimap-grid" v-if="state.tiles.length > 0">
          <article
            v-for="projection in projections"
            :key="projection.id"
            class="tiles-minimap-card"
            :data-axis="projection.id">
            <header>
              <h2>{{ projection.label }}</h2>
              <span>{{ projection.axesLabel }}</span>
            </header>
            <div class="tiles-svg-wrap"><div class="minimap-layers">
              <div v-html="projection.svg"></div>
              <div class="minimap-camera-layer" v-html="renderCamera(projection.frame)"></div>
            </div></div>
          </article>
        </section>
        <p v-else class="tiles-empty">No detailed tile map is available for this renderer/frame.</p>
      </section>
    `
  };
}
