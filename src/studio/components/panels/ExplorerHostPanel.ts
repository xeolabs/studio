import {createLoadedModels} from "./LoadedModels";
import {createExplorerSearch} from "./ExplorerSearch";
import type {ExplorerSource as ExplorerPanelSource} from "../../explorers/types";

export function createExplorerHostPanel(
  Vue: any,
  name: string,
  source: ExplorerPanelSource,
  hostId: string
) {
  return {
    name,
    components: {ExplorerSearch: createExplorerSearch(Vue, source), LoadedModels: createLoadedModels(Vue)},
    setup() {
      const host = Vue.ref(null as HTMLElement | null);
      const searching = Vue.ref(false);
      const commands = Vue.inject("commands") as any;
      const buildingViews = [
        {source: "ifc", id: "ifcStructure", label: "Building"},
        {source: "ifcStoreys", id: "ifcStoreys", label: "Floors"},
        {source: "ifcTypes", id: "ifcTypes", label: "Categories"}
      ];
      const isBuildingView = buildingViews.some(item => item.source === source);
      const actions = Vue.inject("explorerHostActions") as any;
      Vue.onMounted(() => {
        if (host.value) {
          actions.mounted(source, host.value);
        }
      });
      Vue.onBeforeUnmount(() => {
        if (host.value) {
          actions.unmounted(source, host.value);
        }
      });
      return {host, hostId, searching, source, buildingViews, isBuildingView,
        openView: (id: string) => commands.execute(`view.toolWindows.${id}`)};
    },
    template: `<section class="studio-panel explorer-panel" :class="{'building-explorer-panel': isBuildingView}">
      <LoadedModels v-if="isBuildingView"/>
      <nav v-if="isBuildingView" class="building-navigation" aria-label="Explore building">
        <button v-for="item in buildingViews" :key="item.id" type="button" :aria-current="source === item.source ? 'page' : undefined"
          @click="openView(item.id)">{{ item.label }}</button>
      </nav><ExplorerSearch @active="searching = $event"/><div v-show="!searching" :id="hostId" ref="host" class="explorer-panel-host"></div></section>`
  };
}
