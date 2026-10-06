import type {ImportActions} from "../../app/types";
import type {ImportDialogState} from "../../services/importDialogState";
import {acceptsSource} from "../../services/importSourceDetection";
import {importValidation} from "../../services/importValidation";

export function createImportSources(Vue: any) {
  return {
    name: "StudioImportSources",
    setup() {
      const state = Vue.inject("importDialogState") as ImportDialogState;
      const actions = Vue.inject("importActions") as ImportActions;
      const picker = Vue.ref(null);
      const url = Vue.ref("");
      const dragging = Vue.ref(false);
      const dataSet = Vue.computed(() => state.dataSets.find(d => d.id === state.dataSetId));
      const sources = Vue.computed(() => state.sources.filter(s => s.mode === state.sourceMode));
      const validation = Vue.computed(() => importValidation(state));
      const accept = [...new Set(state.dataSets.flatMap(d => d.files.flatMap(f => f.accept.split(","))))].join(",");
      const filesChanged = (event: Event, replaceId?: string, slotKey?: string) => {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        if (replaceId && files[0]) actions.replaceSource(replaceId, files[0]);
        else if (slotKey && files[0]) actions.setSlotFile(slotKey, files[0]);
        else actions.addFiles(files);
        input.value = "";
      };
      const drop = (event: DragEvent) => {
        dragging.value = false;
        if (!state.loading) actions.addFiles(Array.from(event.dataTransfer?.files || []));
      };
      const addUrl = () => { if (url.value.trim()) { actions.addUrl(url.value); url.value = ""; } };
      const fileSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
      return {state, actions, picker, url, dragging, dataSet, sources, validation, accept, filesChanged, drop, addUrl, fileSize, acceptsSource};
    },
    template: `
      <section class="import-sources" aria-label="Import sources">
        <el-radio-group :model-value="state.sourceMode" aria-label="Source type" :disabled="state.loading" @change="actions.setSourceMode($event)">
          <el-radio-button value="file">Files</el-radio-button><el-radio-button value="url">URL</el-radio-button>
        </el-radio-group>
        <div v-if="state.sourceMode === 'file'" class="import-drop-zone" :class="{'is-dragging': dragging}"
          @dragover.prevent.stop="dragging = !state.loading" @dragleave.prevent="dragging = false" @drop.prevent.stop="drop">
          <strong>{{ sources.length ? 'Add companion files' : 'Drop model files' }}</strong>
          <el-button :disabled="state.loading" @click="picker.click()">Browse...</el-button>
          <input ref="picker" type="file" multiple hidden :accept="accept" @change="filesChanged($event)" aria-label="Choose model files"/>
        </div>
        <form v-else class="import-url-entry" @submit.prevent="addUrl">
          <el-input v-model="url" aria-label="Model URL" placeholder="https://example.com/model.glb" :disabled="state.loading"/>
          <el-button native-type="submit" :disabled="state.loading || !url.trim()">Add URL</el-button>
        </form>
        <ul v-if="sources.length" class="import-source-list">
          <li v-for="source in sources" :key="source.id" class="import-source-row">
            <div class="import-source-heading">
              <strong v-if="source.mode === 'file'" :title="source.name">{{ source.name }}</strong>
              <el-input v-else :model-value="source.url" aria-label="Source URL" :disabled="state.loading" @change="actions.updateUrl(source.id, $event)"/>
              <span v-if="source.file" class="import-secondary">{{ fileSize(source.file.size) }}</span>
              <label v-if="source.mode === 'file'" class="import-replace" :aria-disabled="state.loading">
                Replace<input type="file" :accept="accept" :disabled="state.loading" @change="filesChanged($event, source.id)" :aria-label="'Replace ' + source.name"/>
              </label>
              <el-button text :disabled="state.loading" :aria-label="'Remove ' + (source.name || source.url)" @click="actions.removeSource(source.id)">Remove</el-button>
            </div>
            <el-select v-if="dataSet && (dataSet.files.length > 1 || !source.slotKey)" :model-value="source.slotKey" placeholder="Choose file role"
              :aria-label="'Role for ' + (source.name || source.url)" :disabled="state.loading" @change="actions.assignSource(source.id, $event)">
              <el-option v-for="spec in dataSet.files" :key="spec.key" :label="spec.label + (spec.required ? ' (required)' : ' (optional)')" :value="spec.key" :disabled="!acceptsSource(spec, source)"/>
            </el-select>
            <p v-if="state.sourceErrors[source.id] || validation.sources[source.id]" class="import-error" role="alert">{{ state.sourceErrors[source.id] || validation.sources[source.id] }}</p>
          </li>
        </ul>
        <label class="import-form-field">
          <span>Format</span>
          <el-select :model-value="state.formatOverride ? state.dataSetId : 'auto'" filterable :disabled="state.loading" @change="actions.setDataSet($event === 'auto' ? '' : $event)" aria-label="Import format">
            <el-option :label="dataSet && !state.formatOverride ? 'Automatic (' + dataSet.label + ')' : 'Automatic detection'" value="auto"/>
            <el-option v-for="item in state.dataSets" :key="item.id" :label="item.label" :value="item.id"/>
          </el-select>
        </label>
        <p v-if="sources.length && !dataSet" class="import-error" role="status">Format is ambiguous or unsupported. Choose a format above.</p>
        <div v-if="dataSet" class="import-companions">
          <div v-for="spec in dataSet.files.filter(f => !sources.some(s => s.slotKey === f.key))" :key="spec.key" class="import-companion-row">
            <span>{{ spec.label }} <small>{{ spec.required ? 'Required' : 'Optional' }}</small></span>
            <label v-if="state.sourceMode === 'file'" class="import-replace" :aria-disabled="state.loading">Add file
              <input type="file" :accept="spec.accept" :disabled="state.loading" @change="filesChanged($event, undefined, spec.key)" :aria-label="'Add ' + spec.label"/>
            </label>
            <span v-else class="import-secondary">{{ spec.required ? 'URL needed' : 'Not included' }}</span>
          </div>
        </div>
      </section>
    `,
  };
}
