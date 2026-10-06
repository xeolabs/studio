import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {ImportDialogState} from "../../services/importDialogState";

export function createImportResult(Vue: any) {
  return {
    name: "StudioImportResult",
    setup() {
      const state = Vue.inject("importDialogState") as ImportDialogState;
      const commands = Vue.inject("commands") as CommandRegistry;
      return {state, run: (id: string) => commands.execute(id), enabled: (id: string) => commands.isEnabled(id)};
    },
    template: `
      <section v-if="state.result" class="import-result" :class="{'has-notices': state.result.warnings.length}" aria-label="Import result">
        <h3 role="status">Imported {{ state.result.label }}{{ state.result.warnings.length ? ' with notices' : '' }}</h3>
        <p class="import-model-id">{{ state.result.modelId }}</p>
        <dl>
          <div v-if="state.result.scene"><dt>SceneModel</dt><dd>{{ state.result.sceneObjects.toLocaleString() }} objects</dd></div>
          <div v-if="state.result.data"><dt>DataModel</dt><dd>{{ state.result.dataObjects.toLocaleString() }} objects</dd></div>
        </dl>
        <div class="import-result-actions">
          <el-button v-if="state.result.scene" :disabled="!enabled('file.import.frameResult')" @click="run('file.import.frameResult')">Frame imported model</el-button>
          <el-button :disabled="!enabled('file.import.revealResult')" @click="run('file.import.revealResult')">Reveal in explorer</el-button>
        </div>
        <details v-if="state.result.warnings.length" open class="import-notices">
          <summary>{{ state.result.warnings.length }} runtime notices during import</summary>
          <ul><li v-for="(warning, index) in state.result.warnings" :key="index">{{ warning }}</li></ul>
          <el-button text @click="run('file.import.close'); run('view.toolWindows.diagnostics')">Open warnings / errors</el-button>
        </details>
      </section>
    `,
  };
}
