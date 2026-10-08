import {Eye, EyeOff, Focus} from "lucide-vue-next";
import type {CommandRegistry} from "../../commands/CommandRegistry";

export function createLoadedModels(Vue: any) {
  return {
    name: "LoadedModels",
    components: {Eye, EyeOff, Focus},
    setup() {
      const workspace = Vue.inject("workspace") as any;
      const commands = Vue.inject("commands") as CommandRegistry;
      // Read reactive busy flags here so a running import/export disables every
      // visible instance, including instances in other explorer tabs.
      const importing = Vue.inject("importDialogState") as any;
      const exporting = Vue.inject("exportDialogState") as any;
      const busy = Vue.computed(() => importing.loading || exporting.loading || workspace.rendererSwitching);
      return {workspace, busy,
        run: (command: string, id: string) => commands.execute(command, id),
        canUnload: (id: string) => commands.isEnabled("model.unload", id),
        unload: (id: string) => commands.execute("model.unload", id),
        importModel: () => commands.execute("file.import")};
    },
    template: `<details class="loaded-models" :open="workspace.modelsExpanded" @toggle="workspace.modelsExpanded = $event.target.open">
      <summary>Models <span>{{ workspace.loadedModels.length }}</span></summary>
      <ul v-if="workspace.loadedModels.length" aria-label="Loaded models">
        <li v-for="model in workspace.loadedModels" :key="model.id">
          <span class="loaded-model-name" :title="model.title">{{ model.title }}</span>
          <button type="button" class="loaded-model-icon" :disabled="!model.objectCount"
            :aria-label="(model.visibleCount ? 'Hide ' : 'Show ') + model.title" :title="model.visibleCount ? 'Hide model' : 'Show model'"
            :aria-pressed="model.visibleCount && model.visibleCount < model.objectCount ? 'mixed' : !!model.visibleCount"
            @click="run('model.visibility', model.id)"><Eye v-if="model.visibleCount"/><EyeOff v-else/></button>
          <button type="button" class="loaded-model-icon" :disabled="!model.objectCount" :aria-label="'Fit ' + model.title" title="Fit model"
            @click="run('model.fit', model.id)"><Focus/></button>
          <button type="button" :aria-label="'Unload ' + model.title" :title="'Unload ' + model.title + ' from this session'"
            :disabled="busy || !canUnload(model.id)" @click="unload(model.id)">Unload</button>
        </li>
      </ul>
      <div v-else class="loaded-models-empty"><span>No models loaded</span><button type="button" @click="importModel">Import model</button></div>
    </details>`
  };
}
