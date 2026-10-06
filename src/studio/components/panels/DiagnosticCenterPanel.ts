import {healthReportSummary} from "../../services/healthReportSummary";

export function createDiagnosticCenterPanel(Vue: any) {
  return {
    name: "StudioDiagnosticCenterPanel",
    setup() {
      const commands = Vue.inject("commands") as any;
      const aabbState = Vue.inject("aabbPanelState") as any;
      const dataHealth = Vue.inject("dataHealthPanelState") as any;
      const diagnostics = Vue.inject("diagnosticsPanelState") as any;
      const sceneHealth = Vue.inject("sceneHealthPanelState") as any;
      const tiles = Vue.inject("tilesPanelState") as any;

      const cards = Vue.computed(() => [
        {
          id: "scene-health",
          title: "Scene Health",
          status: sceneHealth.statusText,
          ...healthReportSummary(sceneHealth),
          commandId: "sceneHealth.inspect",
          action: sceneHealth.inspecting ? "Inspecting" : "Inspect"
        },
        {
          id: "data-health",
          title: "Data Health",
          status: dataHealth.statusText,
          ...healthReportSummary(dataHealth),
          commandId: "dataHealth.inspect",
          action: dataHealth.inspecting ? "Inspecting" : "Inspect"
        },
        {
          id: "diagnostics",
          title: "Warnings / Errors",
          status: diagnostics.entries.length > 0 ? "Runtime warnings and errors recorded." : "No warnings or errors recorded.",
          metric: `${diagnostics.errors} errors · ${diagnostics.warnings} warnings`,
          tone: diagnostics.errors > 0 ? "critical" : diagnostics.warnings > 0 ? "warning" : "healthy",
          commandId: "view.toolWindows.diagnostics",
          action: "Open"
        },
        {
          id: "boundaries",
          title: "Boundaries",
          status: aabbState.refreshing ? "Refreshing scene object boundaries." : "Scene AABB index summary.",
          metric: `${aabbState.indexedObjectCount} indexed / ${aabbState.objectCount} objects`,
          tone: aabbState.indexedObjectCount > 0 ? "healthy" : "unknown",
          commandId: "view.toolWindows.boundaries",
          action: "Open"
        },
        {
          id: "tiles",
          title: "Tiles",
          status: tiles.statusText,
          metric: `${tiles.tileCount} tiles · ${tiles.meshCount} meshes`,
          tone: tiles.supportsTileMap ? "healthy" : "unknown",
          commandId: "view.toolWindows.tiles",
          action: "Open"
        }
      ]);
      const sourceSummaries = Vue.computed(() => diagnostics.sourceSummaries);
      const open = (commandId: string) => commands.execute(commandId);
      const commandEnabled = (id: string) => commands.isEnabled(id);
      return {cards, open, sourceSummaries, commandEnabled};
    },
    template: `
      <section class="studio-panel diagnostic-center-panel" aria-label="Diagnostics">
        <header class="diagnostic-center-header">
          <div>
            <h1>Diagnostics</h1>
            <p>Unified launch point for model health, runtime warnings, boundaries, and render allocation diagnostics.</p>
          </div>
        </header>

        <section class="diagnostic-center-grid">
          <article
            v-for="card in cards"
            :key="card.id"
            class="diagnostic-center-card"
            :data-tone="card.tone">
            <header>
              <span></span>
              <h2>{{ card.title }}</h2>
            </header>
            <strong>{{ card.metric }}</strong>
            <p>{{ card.status }}</p>
            <span v-if="card.current" class="health-report-phase">{{ card.phase }}</span>
            <el-button size="small" :disabled="!commandEnabled(card.commandId)" @click="open(card.commandId)">{{ card.action }}</el-button>
          </article>
        </section>

        <section class="diagnostic-center-section">
          <h2>Event Sources</h2>
          <div class="diagnostic-source-list">
            <article v-for="source in sourceSummaries" :key="source.source" :data-empty="source.total === 0 ? 'true' : 'false'">
              <strong>{{ source.source }}</strong>
              <span>{{ source.errors }} E</span>
              <span>{{ source.warnings }} W</span>
            </article>
          </div>
        </section>
      </section>
    `
  };
}
