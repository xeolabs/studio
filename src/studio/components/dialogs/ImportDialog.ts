import type {ImportActions} from "../../app/types";
import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {ImportDialogState} from "../../services/importDialogState";
import {importValidation} from "../../services/importValidation";
import {createImportSources} from "./ImportSources";
import {createImportSceneConfigs} from "./ImportSceneConfigs";
import {createImportResult} from "./ImportResult";

export function createImportDialogComponent(Vue: any) {
  return {
    name: "StudioImportDialog",
    components: {ImportSources: createImportSources(Vue), ImportSceneConfigs: createImportSceneConfigs(Vue), ImportResult: createImportResult(Vue)},
    setup() {
      const state = Vue.inject("importDialogState") as ImportDialogState;
      const actions = Vue.inject("importActions") as ImportActions;
      const commands = Vue.inject("commands") as CommandRegistry;
      const dataSet = Vue.computed(() => state.dataSets.find(d => d.id === state.dataSetId));
      const validation = Vue.computed(() => importValidation(state));
      const destination = Vue.computed(() => [dataSet.value?.loadsSceneGeometry !== false && 'SceneModel',
        dataSet.value?.loadsDataSemantics !== false && 'DataModel'].filter(Boolean).join(' and '));
      return {state, actions, dataSet, validation, destination,
        run: (id: string) => commands.execute(id), enabled: (id: string) => commands.isEnabled(id)};
    },
    template: `
      <el-dialog v-model="state.open" title="Import Model" class="import-dialog" width="680px" :append-to-body="true"
        :close-on-click-modal="!state.loading" :close-on-press-escape="!state.loading" :show-close="!state.loading">
        <div class="import-workflow">
          <ImportResult v-if="state.result"/>
          <template v-else>
            <ImportSources/>
            <template v-if="dataSet">
              <p class="import-destination">Creates a new {{ destination }}. Existing models remain loaded.</p>
              <details v-if="state.plannedModelId" class="import-destination-details"><summary>Destination IDs</summary>
                <div v-if="dataSet.loadsSceneGeometry !== false">SceneModel <code>{{ state.plannedModelId }}</code></div>
                <div v-if="dataSet.loadsDataSemantics !== false">DataModel <code>{{ state.plannedModelId }}</code></div>
              </details>
              <ImportSceneConfigs v-if="dataSet.loadsSceneGeometry !== false"/>
              <el-checkbox v-if="dataSet.loadsSceneGeometry !== false" v-model="state.frameAfterImport" :disabled="state.loading">Frame after import</el-checkbox>
            </template>
            <section v-if="state.loading" class="import-progress" role="status" aria-live="polite">
              <progress aria-label="Import in progress"></progress><strong>{{ state.statusText }}</strong>
            </section>
            <section v-else-if="state.errorText" class="import-failure" role="alert">
              <strong>{{ state.errorText }}</strong><p>{{ state.statusText }}</p>
              <details><summary>Technical details</summary><pre>{{ state.errorDetails }}</pre></details>
            </section>
          </template>
        </div>
        <template #footer>
          <footer class="import-dialog-footer">
            <span v-if="!state.loading && !state.result" class="import-footer-status" role="status">{{ validation.message }}</span>
            <template v-if="state.result">
              <el-button @click="actions.reset()">Import another</el-button>
              <el-button type="primary" @click="run('file.import.close')">Done</el-button>
            </template>
            <template v-else>
              <el-button @click="run('file.import.close')">{{ state.loading ? 'Run in Background' : 'Cancel' }}</el-button>
              <el-button type="primary" :loading="state.loading" :disabled="!enabled('file.import.run')" @click="run('file.import.run')">
                {{ state.errorText ? 'Retry import' : 'Import' }}
              </el-button>
            </template>
          </footer>
        </template>
      </el-dialog>
    `,
  };
}
