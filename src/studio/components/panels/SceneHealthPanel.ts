import type {SceneHealthPanelState} from "../../services/SceneHealthService";
import type {SceneHealthActions} from "../../app/types";
import {createHealthReportPanel} from "../health/HealthReportPanel";

export function createSceneHealthPanel(Vue: any) {
  return {
    name: "StudioSceneHealthPanel",
    components: {HealthReportPanel: createHealthReportPanel(Vue)},
    setup() {
      return {
        state: Vue.inject("sceneHealthPanelState") as SceneHealthPanelState,
        reader: Vue.inject("sceneHealthActions") as SceneHealthActions
      };
    },
    template: '<health-report-panel domain="scene" :state="state" :reader="reader" />'
  };
}
