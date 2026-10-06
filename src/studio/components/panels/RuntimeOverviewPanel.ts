import {createRuntimeOverviewSnapshot} from "../../services/RuntimeOverviewSummary";

export function createRuntimeOverviewPanel(Vue: any) {
  return {
    name: "StudioRuntimeOverviewPanel",
    setup() {
      const commands = Vue.inject("commands") as any;
      const workspace = Vue.inject("workspace") as any;
      const aabbState = Vue.inject("aabbPanelState") as any;
      const dataHealth = Vue.inject("dataHealthPanelState") as any;
      const diagnostics = Vue.inject("diagnosticsPanelState") as any;
      const sceneHealth = Vue.inject("sceneHealthPanelState") as any;
      const tiles = Vue.inject("tilesPanelState") as any;

      const snapshot = Vue.computed(() => createRuntimeOverviewSnapshot({
        aabbPanelState: aabbState,
        dataHealthPanelState: dataHealth,
        diagnosticsPanelState: diagnostics,
        sceneHealthPanelState: sceneHealth,
        tilesPanelState: tiles,
        workspace
      }));
      const open = (commandId: string) => commands.execute(commandId);
      const commandEnabled = (commandId: string) => commands.isEnabled(commandId);
      const inspect = (commandId: string) => commands.execute(commandId);
      const runCardAction = (event: Event, commandId: string) => {
        event.stopPropagation();
        commands.execute(commandId);
      };
      return {commandEnabled, inspect, open, runCardAction, snapshot, workspace};
    },
    template: `
      <section class="studio-panel runtime-overview-panel" aria-label="Runtime">
        <header class="runtime-overview-header">
          <div>
            <h1>Runtime</h1>
            <p>Live links into Viewer, Scene, Data, renderer, diagnostics, and current selection state.</p>
          </div>
          <el-button size="small" @click="open('runtime.copyOverviewJson')">Copy JSON</el-button>
        </header>

        <section class="runtime-overview-grid">
          <article
            v-for="card in snapshot.cards"
            :key="card.id"
            class="runtime-overview-card"
            :data-tone="card.tone"
            role="button"
            tabindex="0"
            @click="inspect(card.inspectCommandId)"
            @keydown.enter.prevent="inspect(card.inspectCommandId)"
            @keydown.space.prevent="inspect(card.inspectCommandId)">
            <header>
              <span></span>
              <h2>{{ card.title }}</h2>
            </header>
            <strong>{{ card.value }}</strong>
            <p>{{ card.detail }}</p>
            <el-button size="small" @click="runCardAction($event, card.actionCommandId)" :disabled="!commandEnabled(card.actionCommandId)">{{ card.action }}</el-button>
          </article>
        </section>

        <section class="runtime-overview-section">
          <header>
            <h2>Current Selection</h2>
            <el-button size="small" @click="open('selection.copyDetailsJson')" :disabled="!commandEnabled('selection.copyDetailsJson')">JSON</el-button>
          </header>
          <dl class="runtime-overview-kv">
            <template v-for="row in snapshot.selectionRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
        </section>

        <section class="runtime-overview-section" v-if="snapshot.sceneModels.length > 0">
          <header>
            <h2>SceneModels</h2>
            <el-button size="small" @click="open('view.toolWindows.scene')">Open</el-button>
          </header>
          <div class="runtime-overview-model-list">
            <article v-for="model in snapshot.sceneModels" :key="model.id">
              <strong :title="model.id">{{ model.id }}</strong>
              <span>{{ model.objectCount }} objects</span>
              <span>{{ model.meshCount }} meshes</span>
              <span>{{ model.geometryCount }} geometries</span>
              <span>{{ model.errors }} E · {{ model.warnings }} W</span>
            </article>
          </div>
        </section>

        <section class="runtime-overview-section" v-if="snapshot.dataModels.length > 0">
          <header>
            <h2>DataModels</h2>
            <el-button size="small" @click="open('view.toolWindows.data')">Open</el-button>
          </header>
          <div class="runtime-overview-model-list">
            <article v-for="model in snapshot.dataModels" :key="model.id">
              <strong :title="model.id">{{ model.id }}</strong>
              <span>{{ model.schema || 'schema n/a' }}</span>
              <span>{{ model.objectCount }} objects</span>
              <span>{{ model.typeCount }} types</span>
              <span>{{ model.errors }} E · {{ model.warnings }} W</span>
            </article>
          </div>
        </section>
      </section>
    `
  };
}
