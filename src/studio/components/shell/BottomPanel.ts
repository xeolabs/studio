import type {CommandRegistry} from "../../commands/CommandRegistry";
import {summarizeProblems} from "../../services/ProblemsSummary";
import {copyText} from "../../ui/clipboard";
import {createExpandableLogRow} from "./ExpandableLogRow";

export interface BottomPanelComponentParams {
  commands: CommandRegistry;
  diagnosticsPanelState: any;
  sceneHealthPanelState: any;
  dataHealthPanelState: any;
  notifyLayoutChanged: () => void;
  workspace: any;
}

export function createBottomPanelComponent(Vue: any, params: BottomPanelComponentParams) {
  return {
    name: "StudioBottomPanel",
    components: {ExpandableLogRow: createExpandableLogRow()},
    setup() {
      const filters = Vue.reactive({problems: "", output: "", events: "", tasks: ""});
      const filter = Vue.computed({
        get: () => filters[params.workspace.bottomPanelTab] || "",
        set: (value: string) => { filters[params.workspace.bottomPanelTab] = value; }
      });
      const matches = (entry: unknown) => !filter.value || JSON.stringify(entry).toLowerCase().includes(filter.value.trim().toLowerCase());
      const problems = Vue.computed(() => summarizeProblems(params.diagnosticsPanelState, params.sceneHealthPanelState, params.dataHealthPanelState));
      const problemRows = Vue.computed(() => problems.value.rows.filter(matches));
      const outputRows = Vue.computed(() => params.workspace.outputEntries.filter(matches));
      const eventRows = Vue.computed(() => params.workspace.eventEntries.filter(matches));
      const taskRows = Vue.computed(() => params.workspace.taskEntries.filter(matches));
      const copyProblems = () => copyText(JSON.stringify(problems.value, null, 2));
      const bottomTabs = [
        {id: "problems", label: "Problems"},
        {id: "output", label: "Output"},
        {id: "events", label: "Events"},
        {id: "tasks", label: "Tasks"}
      ];
      const formatTime = (iso: string) => {
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
      };
      const resizeBottomPanel = (event: PointerEvent) => {
        if (!params.workspace.bottomPanelOpen) {
          params.workspace.setBottomPanelOpen(true);
        }
        const startY = event.clientY;
        const startHeight = params.workspace.bottomPanelHeight;
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture?.(event.pointerId);
        document.body.classList.add("is-resizing-bottom-panel");
        const onPointerMove = (moveEvent: PointerEvent) => {
          params.workspace.setBottomPanelHeight(startHeight + startY - moveEvent.clientY);
          params.notifyLayoutChanged();
        };
        const onPointerUp = (upEvent: PointerEvent) => {
          target.releasePointerCapture?.(upEvent.pointerId);
          document.body.classList.remove("is-resizing-bottom-panel");
          window.removeEventListener("pointermove", onPointerMove, true);
          window.removeEventListener("pointerup", onPointerUp, true);
          params.notifyLayoutChanged();
        };
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        event.preventDefault();
      };
      const runCommand = (commandId: string) => {
        params.commands.execute(commandId);
      };
      const commandEnabled = (commandId: string) => params.commands.isEnabled(commandId);
      return {
        bottomTabs,
        filter, problems, problemRows, outputRows, eventRows, taskRows, copyProblems,
        commandEnabled,
        diagnosticsState: params.diagnosticsPanelState,
        formatTime,
        resizeBottomPanel,
        notifyResize: params.notifyLayoutChanged,
        runCommand,
        workspace: params.workspace
      };
    },
    template: `
      <section class="bottom-panel" :data-open="workspace.bottomPanelOpen ? 'true' : 'false'">
        <div
          class="bottom-panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          title="Resize bottom panel"
          tabindex="0"
          :aria-valuenow="workspace.bottomPanelHeight"
          aria-valuemin="112"
          aria-valuemax="420"
          @keydown.up.prevent="workspace.setBottomPanelHeight(workspace.bottomPanelHeight + 20); notifyResize()"
          @keydown.down.prevent="workspace.setBottomPanelHeight(workspace.bottomPanelHeight - 20); notifyResize()"
          @pointerdown="resizeBottomPanel"></div>
        <header class="bottom-panel-tabs">
          <button
            v-for="tab in bottomTabs"
            :key="tab.id"
            type="button"
            :class="{ active: workspace.bottomPanelTab === tab.id && workspace.bottomPanelOpen }"
            @click="runCommand('bottom.' + tab.id)">
            {{ tab.label }}
          </button>
          <input v-if="workspace.bottomPanelOpen" v-model="filter" class="bottom-panel-filter" :aria-label="'Filter ' + workspace.bottomPanelTab" placeholder="Filter..." @keydown.esc.stop="filter = ''">
          <button type="button" class="bottom-panel-toggle" @click="runCommand('bottom.toggle')">
            {{ workspace.bottomPanelOpen ? 'Hide' : 'Show' }}
          </button>
        </header>
        <div v-if="workspace.bottomPanelOpen" class="bottom-panel-body">
          <template v-if="workspace.bottomPanelTab === 'problems'">
            <div class="bottom-panel-summary">
              <strong>Problems</strong>
              <span>{{ problems.errors }} errors · {{ problems.warnings }} warnings</span>
              <span>Current health reports + runtime</span>
              <button type="button" @click="runCommand('view.toolWindows.diagnostics')">Open Warnings / Errors</button>
              <button type="button" :disabled="!problems.rows.length" @click="copyProblems">Copy JSON</button>
            </div>
            <div v-if="problemRows.length > 0" class="bottom-panel-list">
              <button
                v-for="entry in problemRows"
                :key="entry.id"
                type="button"
                class="bottom-problem-row"
                :data-level="entry.level"
                :title="entry.message"
                @click="runCommand(entry.commandId)">
                <span>{{ entry.timestamp ? formatTime(entry.timestamp) : entry.count + ' findings' }}</span>
                <strong>{{ entry.level }}</strong>
                <span>{{ entry.source }}</span>
                <span>{{ entry.message }}</span>
              </button>
            </div>
            <p v-else class="bottom-panel-empty">{{ filter ? 'No matching problems.' : 'No warnings or errors in current reports or runtime log.' }}</p>
          </template>
          <template v-else-if="workspace.bottomPanelTab === 'output'">
            <div class="bottom-panel-summary">
              <strong>Output</strong>
              <span>{{ outputRows.length }} / {{ workspace.outputEntries.length }} retained messages (limit 100)</span>
              <button type="button" :disabled="!commandEnabled('bottom.copyOutputJson')" @click="runCommand('bottom.copyOutputJson')">Copy JSON</button>
              <button type="button" :disabled="!commandEnabled('bottom.clearOutput')" @click="runCommand('bottom.clearOutput')">Clear</button>
            </div>
            <div v-if="outputRows.length > 0" class="bottom-panel-list">
              <ExpandableLogRow v-for="entry in outputRows" :key="entry.id" :entry="entry" row-class="bottom-output-row" :title="entry.message">
                <span>{{ formatTime(entry.timestamp) }}</span>
                <strong>{{ entry.channel }}</strong>
                <span>{{ entry.message }}</span>
              </ExpandableLogRow>
            </div>
            <p v-else class="bottom-panel-empty" role="status">{{ filter.trim() ? 'No matching output messages.' : 'No output has been recorded yet.' }}</p>
          </template>
          <template v-else-if="workspace.bottomPanelTab === 'events'">
            <div class="bottom-panel-summary">
              <strong>Studio Events</strong>
              <span>{{ eventRows.length }} / {{ workspace.eventEntries.length }} retained events (limit 200)</span>
              <button type="button" @click="runCommand('view.toolWindows.diagnostics')">Open Warnings / Errors</button>
              <button type="button" :disabled="!commandEnabled('bottom.copyEventsJson')" @click="runCommand('bottom.copyEventsJson')">Copy JSON</button>
              <button type="button" :disabled="!commandEnabled('bottom.clearEvents')" @click="runCommand('bottom.clearEvents')">Clear</button>
            </div>
            <div v-if="eventRows.length > 0" class="bottom-panel-list">
              <ExpandableLogRow
                v-for="entry in eventRows"
                :key="entry.id"
                :entry="entry" row-class="bottom-event-row"
                :level="entry.level" :title="entry.message">
                <span>{{ formatTime(entry.timestamp) }}</span>
                <strong>{{ entry.level }}</strong>
                <span>{{ entry.source }}.{{ entry.eventName }}</span>
                <span>{{ entry.message }}</span>
              </ExpandableLogRow>
            </div>
            <p v-else class="bottom-panel-empty" role="status">{{ filter.trim() ? 'No matching events.' : 'No events have been recorded yet.' }}</p>
          </template>
          <template v-else>
            <div class="bottom-panel-summary">
              <strong>Tasks</strong>
              <span>{{ taskRows.length }} / {{ workspace.taskEntries.length }} retained tasks (limit 100)</span>
              <button type="button" @click="runCommand('file.import')">Import</button>
              <button type="button" @click="runCommand('file.export')">Export</button>
              <button type="button" :disabled="!commandEnabled('bottom.copyTasksJson')" @click="runCommand('bottom.copyTasksJson')">Copy JSON</button>
              <button type="button" :disabled="!commandEnabled('bottom.clearTasks')" @click="runCommand('bottom.clearTasks')">Clear</button>
            </div>
            <div v-if="taskRows.length > 0" class="bottom-panel-list">
              <ExpandableLogRow
                v-for="task in taskRows"
                :key="task.id"
                :entry="task" row-class="bottom-task-row"
                :status="task.status" :title="task.detail">
                <span>{{ formatTime(task.startedAt) }}</span>
                <strong>{{ task.status }}</strong>
                <span>{{ task.title }}</span>
                <span>{{ task.detail }}</span>
              </ExpandableLogRow>
            </div>
            <p v-else class="bottom-panel-empty" role="status">{{ filter.trim() ? 'No matching tasks.' : 'No tasks have run yet.' }}</p>
          </template>
        </div>
      </section>
    `
  };
}
