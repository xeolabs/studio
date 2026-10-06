import type {DataHealthPanelState} from "../../services/DataHealthService";
import type {DataHealthActions} from "../../app/types";
import {createHealthReportPanel} from "../health/HealthReportPanel";

export function createDataHealthPanel(Vue: any) {
  return {
    name: "StudioDataHealthPanel",
    components: {HealthReportPanel: createHealthReportPanel(Vue)},
    setup() {
      return {
        state: Vue.inject("dataHealthPanelState") as DataHealthPanelState,
        reader: Vue.inject("dataHealthActions") as DataHealthActions
      };
    },
    template: '<health-report-panel domain="data" :state="state" :reader="reader" />'
  };
}
