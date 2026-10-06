import type {ExportDialogState} from "../../services/exportDialogState";
import {exportSelectionIssue} from "../../services/exportAvailability";
import {createExportModelList} from "./ExportModelList";

export function createExportModels(Vue: any) {
  return {
    name: "StudioExportModels",
    components: {ExportModelList: createExportModelList(Vue)},
    setup() {
      const state = Vue.inject("exportDialogState") as ExportDialogState;
      const issue = Vue.computed(() => exportSelectionIssue(
        state.dataSets.find(format => format.id === state.dataSetId) || state.dataSets[0],
        state.scope.sceneModels, state.scope.dataModels, state.sceneModels.filter(model => model.selected), state.content));
      return {state, issue};
    },
    template: `
      <section class="export-models" aria-label="Models to export">
        <ExportModelList :models="state.sceneModels" kind="scene" :loading="state.loading"/>
        <ExportModelList :models="state.dataModels" kind="data" :loading="state.loading"/>
        <div class="export-scope-summary">
          <p><strong>{{ state.scope.sceneObjects.toLocaleString() }}</strong> SceneObjects · <strong>{{ state.scope.dataObjects.toLocaleString() }}</strong> unique DataObjects</p>
          <p>Includes hidden objects. Output depends on the format's supported content. Originals remain unchanged.</p>
          <p v-if="state.scope.sceneModels > 1 || state.scope.dataModels > 1">
            <template v-if="state.scope.sceneModels > 1">{{ state.scope.sceneModels }} SceneModels merge for export. </template>
            <template v-if="state.scope.dataModels > 1">{{ state.scope.dataModels }} DataModels merge for export. Shared DataObjects are included once.</template>
          </p>
        </div>
        <p v-if="issue" class="export-validation" role="status">{{ issue }}</p>
      </section>
    `
  };
}
