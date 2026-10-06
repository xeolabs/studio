import type {ExportActions} from "../../app/types";
import type {ExportDialogState} from "../../services/exportDialogState";
import {exportFilenameIssue, exportOutputPlan, exportFileRole} from "../../services/exportOutputPlan";
import {exportFormatsForSelection} from "../../services/exportDialogDataSets";
import {exportFormatIssue, exportFormatNotices} from "../../services/exportFormatCompatibility";
import type {ExportDataSet} from "../../services/exportDialogDataSets";

export function createExportOutput(Vue: any) {
  return {
    name: "StudioExportOutput",
    setup() {
      const state = Vue.inject("exportDialogState") as ExportDialogState;
      const actions = Vue.inject("exportActions") as ExportActions;
      const formats = Vue.computed(() => exportFormatsForSelection(state.dataSets, state.scope.dataModels));
      const format = Vue.computed(() => state.dataSets.find(format => format.id === state.dataSetId) || state.dataSets[0]);
      const filenameIssue = Vue.computed(() => exportFilenameIssue(state.baseName));
      const files = Vue.computed(() => exportOutputPlan(format.value, state.baseName));
      const groups = Vue.computed(() => [...new Set(formats.value.map((item: ExportDataSet) => item.group))]
        .map(group => ({label: group, formats: formats.value.filter((item: ExportDataSet) => item.group === group)})));
      const notices = Vue.computed(() => exportFormatNotices(format.value, state.content, state.scope.dataModels));
      return {state, actions, groups, format, filenameIssue, files, notices, exportFileRole,
        issue: (format: ExportDataSet) => exportFormatIssue(format, state.content, state.scope.dataModels)};
    },
    template: `
      <section class="export-output" aria-label="Output">
        <label class="export-form-field"><span>Output format</span>
          <el-select :model-value="state.dataSetId" :disabled="state.loading" filterable aria-label="Output format" @change="actions.setDataSet($event)">
            <el-option-group v-for="group in groups" :key="group.label" :label="group.label">
              <el-option v-for="format in group.formats" :key="format.id" :label="format.label" :value="format.id" :disabled="!!issue(format)" :title="issue(format)"/>
            </el-option-group>
          </el-select>
        </label>
        <p class="export-secondary">{{ format.description }}</p>
        <p v-for="notice in notices" :key="notice" class="export-notice">{{ notice }}</p>
        <label class="export-form-field"><span>File name</span>
          <el-input :model-value="state.baseName" :disabled="state.loading" aria-label="File name" :aria-invalid="!!filenameIssue"
            @update:model-value="actions.setBaseName($event)"/>
        </label>
        <p v-if="filenameIssue" class="export-validation" role="status">{{ filenameIssue }}</p>
        <ul v-else class="export-file-preview" aria-label="Output files">
          <li v-for="file in files" :key="file.filename"><code>{{ file.filename }}</code><span class="export-secondary">{{ exportFileRole(file.kind) }}</span></li>
        </ul>
      </section>
    `
  };
}
