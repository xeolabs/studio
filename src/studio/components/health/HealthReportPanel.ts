import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {SceneHealthPanelState} from "../../services/SceneHealthService";
import type {DataHealthPanelState} from "../../services/DataHealthService";
import type {HealthFindingsReader, HealthSeverity} from "../../services/HealthFindings";
import {healthReportSummary} from "../../services/healthReportSummary";
import {createHealthIssueGroup} from "./HealthIssueGroup";
import {createHealthCleanupHistory} from "./HealthCleanupHistory";

interface HealthReportProps {
  domain: "scene" | "data";
  state: SceneHealthPanelState | DataHealthPanelState;
  reader: HealthFindingsReader;
}

const impactLabels: Record<string, string> = {
  critical: "Rendering risks", optimization: "Performance", cleanup: "Cleanup", misc: "Other",
  structural: "Structure and schema", conformance: "Conformance"
};

export function createHealthReportPanel(Vue: any) {
  return {
    name: "StudioHealthReportPanel",
    props: ["domain", "state", "reader"],
    components: {HealthIssueGroup: createHealthIssueGroup(Vue), HealthCleanupHistory: createHealthCleanupHistory()},
    setup(props: HealthReportProps) {
      const commands = Vue.inject("commands") as CommandRegistry;
      const search = Vue.ref("");
      const appliedSearch = Vue.ref("");
      const severity = Vue.ref("all" as HealthSeverity | "all");
      let timer: ReturnType<typeof setTimeout> | undefined;
      Vue.watch(search, (value: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => {appliedSearch.value = value;}, 150);
      });
      const clearFilters = () => {
        clearTimeout(timer);
        search.value = appliedSearch.value = "";
        severity.value = "all";
      };
      Vue.watch(() => props.state.selectedModelId, clearFilters);
      Vue.onBeforeUnmount(() => clearTimeout(timer));
      const prefix = props.domain === "scene" ? "sceneHealth" : "dataHealth";
      const modelLabel = props.domain === "scene" ? "SceneModel" : "DataModel";
      const report = Vue.computed(() => healthReportSummary(props.state));
      const query = Vue.computed(() => ({search: appliedSearch.value, severity: severity.value}));
      const matches = Vue.computed(() => {
        void props.state.reportRevision;
        return props.reader.queryFindings(query.value);
      });
      const sections = Vue.computed(() => {
        const counts = new Map<string, {count: number; severity: string}>(matches.value.groups.map((group) => [group.code, group]));
        const result: Array<{impact: string; label: string; groups: Array<{
          code: string; label: string; description: string; severity: string; count: number;
        }>}> = [];
        for (const group of props.state.issueGroups) {
          const match = counts.get(group.code);
          if (!match) continue;
          let section = result.find((item) => item.impact === group.impact);
          if (!section) {
            section = {impact: group.impact, label: impactLabels[group.impact] || group.impact, groups: []};
            result.push(section);
          }
          section.groups.push({...group, count: match.count, severity: match.severity});
        }
        return result;
      });
      const severityOptions = Vue.computed(() => [
        {value: "all", label: "All", count: props.state.issueCount},
        {value: "error", label: "Errors", count: props.state.errors},
        {value: "warning", label: "Warnings", count: props.state.warnings},
        {value: "info", label: "Info", count: props.state.info}
      ]);
      return {commands, search, severity, clearFilters, prefix, modelLabel, report, query, matches, sections, severityOptions};
    },
    template: `
      <section class="studio-panel health-panel" :aria-label="domain === 'scene' ? 'Scene health' : 'Data health'">
        <header class="health-toolbar">
          <label class="health-model-label" :for="prefix + '-model'">{{ modelLabel }}</label>
          <el-select :id="prefix + '-model'" :aria-label="modelLabel" :model-value="state.selectedModelId"
            filterable :disabled="!state.models.length || !!state.applying" placeholder="No models loaded"
            @update:model-value="commands.execute(prefix + '.selectModel', $event)">
            <el-option v-for="model in state.models" :key="model.id" :value="model.id" :label="model.id" />
          </el-select>
          <el-button size="small" :loading="state.inspecting" :disabled="!commands.isEnabled(prefix + '.inspect')"
            @click="commands.execute(prefix + '.inspect')">Inspect</el-button>
        </header>
        <div class="health-scroll">
          <section class="health-summary" :data-tone="report.tone" role="status">
            <div class="health-summary-heading">
              <strong>{{ report.current ? state.statusText : report.phase }}</strong>
              <span v-if="state.checkedAt">{{ report.phase }}</span>
            </div>
            <p v-if="state.inspectionError">{{ state.inspectionError }}</p>
            <p v-else-if="state.inspecting || state.applying">{{ state.progressLabel || 'Preparing checks' }}</p>
            <p v-else-if="state.stale">Model changed. Re-inspection is queued.</p>
            <p v-else>{{ state.recommendation }}</p>
            <progress v-if="state.inspecting || state.applying" :value="state.progressCurrent"
              :max="state.progressTotal || 1" aria-label="Inspection progress"></progress>
            <time v-if="state.checkedAt" :datetime="state.checkedAt">Checked {{ new Date(state.checkedAt).toLocaleString() }}</time>
          </section>
          <p v-if="state.lastCleanupSummary" class="health-cleanup-result" role="status">{{ state.lastCleanupSummary }}</p>
          <section v-if="state.issueGroups.length" class="health-results">
            <div class="health-filters">
              <el-radio-group v-model="severity" size="small" aria-label="Finding severity">
                <el-radio-button v-for="option in severityOptions" :key="option.value" :value="option.value">
                  {{ option.label }} {{ option.count }}
                </el-radio-button>
              </el-radio-group>
              <el-input v-model="search" clearable aria-label="Filter findings" placeholder="Filter findings, resource IDs…" />
              <span class="health-match-count">{{ matches.total }} of {{ state.issueCount }} findings</span>
            </div>
            <div v-if="state.fixableIssueCount" class="health-cleanup-bar">
              <el-button size="small" :disabled="!commands.isEnabled(prefix + '.cleanupAll')"
                @click="commands.execute(prefix + '.cleanupAll')">Apply cleanups...</el-button>
              <span>{{ state.fixableIssueCount }} eligible finding{{ state.fixableIssueCount === 1 ? '' : 's' }} · whole report</span>
            </div>
            <p v-if="domain === 'data' && state.issueCount > state.fixableIssueCount" class="health-data-note">Other findings require manual source-data or schema changes. Shared objects are not modified.</p>
            <div v-if="!matches.total" class="health-empty">
              <template v-if="state.issueCount">No findings match these filters.
                <el-button size="small" @click="clearFilters">Clear filters</el-button>
              </template>
              <template v-else>{{ report.current ? 'No findings from the enabled checks.' : report.phase }}</template>
            </div>
            <section v-for="section in sections" :key="section.impact" class="health-impact-section">
              <h2>{{ section.label }}</h2>
              <health-issue-group v-for="group in section.groups" :key="state.selectedModelId + ':' + group.code"
                :domain="domain" :model-id="state.selectedModelId" :group="group" :reader="reader"
                :query="query" :revision="state.reportRevision" :cleanup="!!state.fixableCodes.includes(group.code)" />
            </section>
          </section>
          <details v-if="state.stats.length" class="health-model-details">
            <summary>Model statistics</summary>
            <dl><template v-for="stat in state.stats" :key="stat.label"><dt>{{ stat.label }}</dt><dd>{{ stat.value }}</dd></template></dl>
          </details>
          <health-cleanup-history :history="state.cleanupHistory" />
        </div>
      </section>
    `
  };
}
