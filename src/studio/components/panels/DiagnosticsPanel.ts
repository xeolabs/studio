export function createDiagnosticsPanel(Vue: any) {
  return {
    name: "StudioDiagnosticsPanel",
    setup() {
      const commands = Vue.inject("commands") as any;
      const state = Vue.inject("diagnosticsPanelState") as any;
      const filteredEntries = Vue.computed(() => state.entries);
      const formatTime = (iso: string) => {
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
      };
      const sourceLabel = (source: string) => source.charAt(0).toUpperCase() + source.slice(1);
      const runCommand = (commandId: string, payload?: unknown) => commands.execute(commandId, payload);
      const commandEnabled = (commandId: string) => commands.isEnabled(commandId);
      return {commandEnabled, filteredEntries, formatTime, runCommand, sourceLabel, state};
    },
    template: `
      <section class="studio-panel diagnostics-panel" aria-label="Warnings and errors">
	        <header class="diagnostics-toolbar">
	          <div>
	            <h1>Warnings / Errors</h1>
	            <p>{{ state.errors }} errors · {{ state.warnings }} warnings</p>
	          </div>
          <div class="diagnostics-toolbar-actions">
            <el-button size="small" @click="runCommand('diagnostics.copyJson')" :disabled="!commandEnabled('diagnostics.copyJson')">
              {{ state.copied ? 'Copied' : 'Copy JSON' }}
            </el-button>
            <el-button size="small" @click="runCommand('diagnostics.clear')" :disabled="!commandEnabled('diagnostics.clear')">Clear</el-button>
          </div>
        </header>
        <section class="diagnostics-summary">
	          <article v-for="source in state.sourceSummaries" :key="source.source" :data-empty="source.total === 0 ? 'true' : 'false'">
	            <strong>{{ sourceLabel(source.source) }}</strong>
	            <span>{{ source.errors }} E</span>
	            <span>{{ source.warnings }} W</span>
	          </article>
	        </section>
        <section class="diagnostics-list" v-if="filteredEntries.length > 0">
          <button
            v-for="entry in filteredEntries"
            :key="entry.id"
            type="button"
            class="diagnostics-row"
            :data-level="entry.level"
            :title="'Copy JSON for ' + entry.source + '.' + entry.eventName"
            @click="runCommand('diagnostics.copyEntry', entry)">
            <span class="diagnostics-time">{{ formatTime(entry.timestamp) }}</span>
            <span class="diagnostics-badge">{{ entry.level }}</span>
            <span class="diagnostics-source">{{ entry.source }}</span>
            <span class="diagnostics-event">{{ entry.eventName }}</span>
            <span class="diagnostics-message">{{ entry.message }}</span>
          </button>
        </section>
	        <p v-else class="diagnostics-empty">No warnings or errors have been recorded.</p>
	      </section>
    `
  };
}
