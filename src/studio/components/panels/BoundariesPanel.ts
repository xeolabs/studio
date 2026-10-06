import {renderAabbProjectionSvg, renderMinimapCameraSvg, unionObjectAabbs} from "../../ui/minimapSvg";
import {createAabbMinimapProjection, type MinimapProjection} from "../../ui/minimapProjection";
import {observePanelActivity, type PanelVisibilityApi} from "../../ui/observePanelActivity";
import type {AabbPanelState} from "../../services/AabbService";

export function createBoundariesPanel(Vue: any) {
  return {
    name: "StudioBoundariesPanel",
    props: ["params"],
    setup(props: {params?: {api?: PanelVisibilityApi}}) {
      const state = Vue.inject("aabbPanelState") as AabbPanelState;
      let stopActivity: (() => void) | undefined;
      Vue.onMounted(() => { stopActivity = observePanelActivity(props.params?.api, active => { state.active = active; }); });
      Vue.onBeforeUnmount(() => stopActivity?.());
      const filteredObjects = Vue.computed(() => {
        const query = String(state.query || "").trim().toLowerCase();
        if (!query) {
          return state.objects;
        }
        return state.objects.filter((object: any) =>
          object.title.toLowerCase().includes(query) ||
          object.id.toLowerCase().includes(query) ||
          object.modelId.toLowerCase().includes(query) ||
          object.layerId.toLowerCase().includes(query)
        );
      });
      const filteredSceneAabb = Vue.computed(() => unionObjectAabbs(filteredObjects.value) || state.sceneAabb);
      const formatNumber = (value: number) => Number.isFinite(value) ? value.toFixed(3) : "0.000";
      const formatVec = (values: number[]) => values.map(formatNumber).join(", ");
      const formatSceneAabb = () => filteredSceneAabb.value ? formatVec(filteredSceneAabb.value) : "No indexed objects";
      // Camera state is deliberately absent from this computed dependency set.
      const projections = Vue.computed(() => state.projectionViews.map(projection => ({
        ...projection,
        frame: createAabbMinimapProjection(filteredSceneAabb.value, projection),
        svg: renderAabbProjectionSvg({objects: filteredObjects.value, sceneAabb: filteredSceneAabb.value, projection})
      })));
      const renderCamera = (frame: MinimapProjection | null) => renderMinimapCameraSvg(frame, state.cameraEye, state.cameraLook);
      return {filteredObjects, formatSceneAabb, projections, renderCamera, state};
    },
    template: `
      <section class="studio-panel boundaries-panel" aria-label="Scene object boundaries">
        <header class="boundaries-toolbar">
          <div>
            <h1>Scene Boundaries</h1>
            <p>{{ filteredObjects.length }} shown / {{ state.indexedObjectCount }} indexed objects</p>
          </div>
          <label class="boundaries-search">
            <span>Filter</span>
            <input v-model="state.query" type="search" autocomplete="off" placeholder="Object, model, layer or ID"/>
          </label>
        </header>
        <section class="boundaries-summary">
          <span>Scene</span>
          <code>{{ formatSceneAabb() }}</code>
          <span v-if="state.refreshing" class="boundaries-refreshing">refreshing</span>
        </section>
        <section class="boundaries-minimap-grid">
          <article
            v-for="projection in projections"
            :key="projection.id"
            class="boundaries-minimap-card"
            :data-axis="projection.id">
            <header>
              <h2>{{ projection.label }}</h2>
              <span>{{ filteredObjects.length }} AABBs</span>
            </header>
            <div class="boundaries-svg-wrap"><div class="minimap-layers">
              <div v-html="projection.svg"></div>
              <div class="minimap-camera-layer" v-html="renderCamera(projection.frame)"></div>
            </div></div>
          </article>
          <p v-if="filteredObjects.length === 0" class="boundaries-empty">No object boundaries match the current filter.</p>
        </section>
      </section>
    `
  };
}
