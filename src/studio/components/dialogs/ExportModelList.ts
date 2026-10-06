import type {ExportActions} from "../../app/types";
import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {ExportModelOption} from "../../services/exportModelOptions";

export function createExportModelList(Vue: any) {
  return {
    name: "StudioExportModelList",
    props: {models: {type: Array, required: true}, kind: {type: String, required: true}, loading: Boolean},
    setup(props: {models: ExportModelOption[]; kind: "scene" | "data"; loading: boolean}) {
      const actions = Vue.inject("exportActions") as ExportActions;
      const commands = Vue.inject("commands") as CommandRegistry;
      const query = Vue.ref("");
      const title = Vue.computed(() => props.kind === "scene" ? "SceneModels" : "DataModels");
      const selected = Vue.computed(() => props.models.filter(model => model.selected).length);
      const filtered = Vue.computed(() => {
        const term = query.value.trim().toLowerCase();
        return props.models.filter(model => `${model.label} ${model.id}`.toLowerCase().includes(term));
      });
      const command = (action: "selectAll" | "clear") => `file.export.${action}${title.value}`;
      return {query, title, selected, filtered,
        enabled: (action: "selectAll" | "clear") => commands.isEnabled(command(action)),
        run: (action: "selectAll" | "clear") => commands.execute(command(action)),
        toggle: (id: string) => props.kind === "scene" ? actions.toggleSceneModel(id) : actions.toggleDataModel(id)};
    },
    template: `
      <section class="export-source-list" :aria-label="title">
        <header class="export-source-heading">
          <h3>{{ title }}</h3><span v-if="kind === 'data'" class="export-secondary">Optional</span><span class="export-secondary">{{ selected }} of {{ models.length }} selected</span>
          <div class="export-list-actions">
            <el-button link type="primary" :disabled="!enabled('selectAll')" :title="'Select all ' + models.length + ' ' + title" @click="run('selectAll')">Select all</el-button>
            <el-button link type="primary" :disabled="!enabled('clear')" @click="run('clear')">Clear</el-button>
          </div>
        </header>
        <el-input v-if="models.length > 6 || query" v-model="query" clearable :disabled="loading"
          :placeholder="'Filter ' + title" :aria-label="'Filter ' + title"/>
        <div class="export-source-rows">
          <el-checkbox v-for="model in filtered" :key="model.id" :model-value="model.selected" :disabled="loading"
            class="export-source-row" @change="toggle(model.id)">
            <span class="export-source-name">{{ model.label }}</span>
            <code v-if="model.label !== model.id" class="export-secondary">{{ model.id }}</code>
            <span class="export-secondary">{{ model.objectCount.toLocaleString() }} {{ model.objectCount === 1 ? 'object' : 'objects' }}<template v-if="kind === 'scene'"> · {{ (model.meshCount || 0).toLocaleString() }} {{ model.meshCount === 1 ? 'mesh' : 'meshes' }}</template></span>
          </el-checkbox>
          <p v-if="!models.length" class="export-secondary">No {{ title }} are loaded.</p>
          <p v-else-if="!filtered.length" class="export-secondary">No matching models.</p>
        </div>
      </section>
    `
  };
}
