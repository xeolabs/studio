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
    components: {ExplorerSearch: createExplorerSearch(Vue, source)},
    setup() {
      const host = Vue.ref(null as HTMLElement | null);
      const searching = Vue.ref(false);
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
      return {host, hostId, searching};
    },
    template: `<section class="studio-panel explorer-panel"><ExplorerSearch @active="searching = $event"/><div v-show="!searching" :id="hostId" ref="host" class="explorer-panel-host"></div></section>`
  };
}
