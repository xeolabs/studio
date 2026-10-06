import type {ExportActions} from "../../app/types";
import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {ExportDialogState} from "../../services/exportDialogState";
import {exportOutputPlan} from "../../services/exportOutputPlan";
import {createExportModels} from "./ExportModels";
import {createExportOutput} from "./ExportOutput";
import {createExportResult} from "./ExportResult";

export function createExportDialogComponent(Vue: any) {
  return {
    name: "StudioExportDialog",
    components: {ExportModels: createExportModels(Vue), ExportOutput: createExportOutput(Vue), ExportResult: createExportResult(Vue)},
    setup() {
      const state = Vue.inject("exportDialogState") as ExportDialogState;
      const actions = Vue.inject("exportActions") as ExportActions;
      const commands = Vue.inject("commands") as CommandRegistry;
      const fileCount = Vue.computed(() => exportOutputPlan(
        state.dataSets.find(format => format.id === state.dataSetId) || state.dataSets[0], state.baseName).length);
      return {state, actions, fileCount, run: (id: string) => commands.execute(id), enabled: (id: string) => commands.isEnabled(id)};
    },
    template: `
      <el-dialog v-model="state.open" title="Export Models" class="export-dialog" width="680px" :append-to-body="true"
        :close-on-click-modal="!state.loading" :close-on-press-escape="!state.loading" :show-close="!state.loading"
        @open="actions.refreshModels()">
        <div class="export-workflow" :aria-busy="state.loading">
          <ExportResult v-if="state.result"/>
          <template v-else>
            <ExportModels/>
            <ExportOutput/>
            <section v-if="state.loading" class="export-progress" role="status" aria-live="polite">
              <progress aria-label="Export in progress"></progress><strong>{{ state.statusText }}</strong>
            </section>
            <section v-else-if="state.errorText" class="export-failure" role="alert">
              <strong>{{ state.errorText }}</strong><p>{{ state.statusText }}</p>
              <details v-if="state.errorDetails"><summary>Technical details</summary><pre>{{ state.errorDetails }}</pre></details>
            </section>
          </template>
        </div>
        <template #footer>
          <footer class="export-dialog-footer">
            <span v-if="!state.loading && !state.result" class="export-footer-status">{{ fileCount }} output {{ fileCount === 1 ? 'file' : 'files' }}</span>
            <span v-if="state.loading" class="export-footer-status" role="status">{{ state.statusText }}</span>
            <template v-if="state.result">
              <el-button @click="run('file.export.reset')">Export another</el-button>
              <el-button type="primary" @click="run('file.export.close')">Done</el-button>
            </template>
            <template v-else>
              <el-button @click="run('file.export.close')">{{ state.loading ? 'Run in Background' : 'Cancel' }}</el-button>
              <el-button type="primary" :loading="state.loading" :disabled="!enabled('file.export.run')" @click="run('file.export.run')">
                {{ state.errorText ? 'Retry export' : 'Export ' + fileCount + (fileCount === 1 ? ' file' : ' files') }}
              </el-button>
            </template>
          </footer>
        </template>
      </el-dialog>
    `
  };
}
