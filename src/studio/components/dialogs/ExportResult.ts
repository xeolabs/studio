import type {ExportDialogState} from "../../services/exportDialogState";
import type {CommandRegistry} from "../../commands/CommandRegistry";
import {formatFileSize} from "../../ui/formatFileSize";
import {loadDownloadIcon} from "../../ui/loadStudioIcons";
import {exportFileRole} from "../../services/exportOutputPlan";

export function createExportResult(Vue: any) {
  return {
    name: "StudioExportResult",
    components: {DownloadIcon: Vue.defineAsyncComponent(loadDownloadIcon)},
    setup() {
      const state = Vue.inject("exportDialogState") as ExportDialogState;
      const commands = Vue.inject("commands") as CommandRegistry;
      return {state, formatFileSize, exportFileRole, download: (filename: string) => commands.execute("file.export.download", filename)};
    },
    template: `
      <section v-if="state.result" class="export-result" aria-label="Export result">
        <h3>Export complete</h3>
        <p role="status">{{ state.statusText }}</p>
        <p class="export-secondary">{{ state.result.scope.sceneModels }} {{ state.result.scope.sceneModels === 1 ? 'SceneModel' : 'SceneModels' }}<template v-if="state.result.scope.dataModels"> · {{ state.result.scope.dataModels }} {{ state.result.scope.dataModels === 1 ? 'DataModel' : 'DataModels' }}</template> · {{ state.result.format }}</p>
        <ul class="export-result-files">
          <li v-for="file in state.result.files" :key="file.filename">
            <div class="export-result-file">
              <div><code>{{ file.filename }}</code><span class="export-secondary">{{ exportFileRole(file.kind) }} · {{ formatFileSize(file.bytes) }}</span></div>
              <el-button :aria-label="'Download ' + file.filename" :title="'Download ' + file.filename" @click="download(file.filename)">
                <DownloadIcon :size="16" aria-hidden="true"/><span>Download</span>
              </el-button>
            </div>
            <p v-if="file.downloadError" class="export-validation" role="alert">{{ file.downloadError }}</p>
          </li>
        </ul>
        <p v-if="state.result.files.length > 1" class="export-secondary">If a file is missing, download it individually. Your browser may block multiple automatic downloads.</p>
        <details v-if="state.result.notices.length" class="export-notice" open>
          <summary>Export notices ({{ state.result.notices.length }})</summary>
          <ul><li v-for="(notice, index) in state.result.notices" :key="index">{{ notice }}</li></ul>
        </details>
      </section>
    `
  };
}
