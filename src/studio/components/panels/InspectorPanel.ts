import type {ObjectSelectionDetails} from "../../services/ObjectSelectionDetails";
import {
  createRuntimeOverviewSnapshot,
  type RuntimeOverviewTargetId
} from "../../services/RuntimeOverviewSummary";

export function createInspectorPanel(Vue: any) {
  return {
    name: "StudioInspectorPanel",
    setup() {
      const commands = Vue.inject("commands") as any;
      const workspace = Vue.inject("workspace") as any;
      const aabbState = Vue.inject("aabbPanelState") as any;
      const dataHealth = Vue.inject("dataHealthPanelState") as any;
      const diagnostics = Vue.inject("diagnosticsPanelState") as any;
      const sceneHealth = Vue.inject("sceneHealthPanelState") as any;
      const tiles = Vue.inject("tilesPanelState") as any;
      const activeTab = Vue.ref("details");
      const selectedDetails = Vue.computed(() => workspace.selectedObjectDetails as ObjectSelectionDetails | null);
      const context = Vue.computed(() => workspace.inspectorContext);
      const isRuntimeContext = Vue.computed(() => context.value.kind === "Runtime");
      const inspectedDetails = Vue.computed(() => context.value.sceneObjectId === selectedDetails.value?.sceneObjectId ? selectedDetails.value : null);
      const runtimeTarget = Vue.computed(() => runtimeTargetFromContext(context.value));
      const runtimeSnapshot = Vue.computed(() => createRuntimeOverviewSnapshot({
        aabbPanelState: aabbState,
        dataHealthPanelState: dataHealth,
        diagnosticsPanelState: diagnostics,
        sceneHealthPanelState: sceneHealth,
        tilesPanelState: tiles,
        workspace
      }));
      const runtimeCard = Vue.computed(() => runtimeSnapshot.value.cards.find((card) => card.id === runtimeTarget.value) || null);
      const title = Vue.computed(() => inspectedDetails.value?.title || context.value.title || "Inspector");
      const subtitle = Vue.computed(() => {
        const details = inspectedDetails.value;
        if (details) {
          return details.dataObjectId
            ? `${details.type || "DataObject"} · ${details.sceneObjectId}`
            : `SceneObject · ${details.sceneObjectId}`;
        }
        return `${context.value.kind || "Context"} · ${context.value.source || "Studio"}`;
      });
      const linkRows = Vue.computed(() => {
        const details = inspectedDetails.value;
        if (!details) {
          return [];
        }
        const links = [
          {label: "SceneObject", value: details.sceneObjectId, commandId: "explorer.revealScene"},
          {label: "DataObject", value: details.dataObjectId, commandId: "explorer.revealData"},
          {label: "ViewObject", value: details.sceneObjectId, commandId: "explorer.revealViewer"},
          ...(commands.isEnabled("explorer.revealIfc", {objectId: details.dataObjectId}) ? [{label: "IFC Structure", value: details.dataObjectId, commandId: "explorer.revealIfc"}] : [])
        ];
        return links.map((link) => {
          const available = !!link.value && commands.isEnabled(link.commandId, {objectId: link.value});
          return {...link, label: available ? link.label : `No ${link.label}`, value: available ? link.value : "Not linked", state: available ? "linked" : "missing"};
        });
      });
      const overviewRows = Vue.computed(() => {
        const details = inspectedDetails.value;
        if (!details) {
          return [
            {label: "Source", value: context.value.source},
            {label: "Kind", value: context.value.kind},
            {label: "Detail", value: context.value.detail}
          ];
        }
        return [
          {label: "SceneObject ID", value: details.sceneObjectId},
          {label: "Scene name", value: details.sceneObjectName},
          {label: "DataObject ID", value: details.dataObjectId || "Not linked"},
          {label: "Type", value: details.type || "SceneObject"},
          {label: "Schema", value: details.schema || "Not specified"},
          {label: "Meshes", value: String(details.meshCount)},
          {label: "Description", value: details.description || "No description"}
        ];
      });
      const boundsRows = Vue.computed(() => {
        const aabb = inspectedDetails.value?.aabb;
        if (!aabb) {
          return [];
        }
        const min = [aabb[0], aabb[1], aabb[2]];
        const max = [aabb[3], aabb[4], aabb[5]];
        const size = [aabb[3] - aabb[0], aabb[4] - aabb[1], aabb[5] - aabb[2]];
        return [
          {label: "Min", value: formatVec(min)},
          {label: "Max", value: formatVec(max)},
          {label: "Size", value: formatVec(size)}
        ];
      });
      const propertyRows = Vue.computed(() => inspectedDetails.value?.propertyRows || []);
      const runtimeOverviewRows = Vue.computed(() => runtimeRowsForTarget(runtimeTarget.value, runtimeSnapshot.value, workspace, sceneHealth, dataHealth, diagnostics, tiles, aabbState));
      const runtimeActionRows = Vue.computed(() => runtimeActionsForTarget(runtimeTarget.value));
      const runtimeTableRows = Vue.computed(() => runtimeTableRowsForTarget(runtimeTarget.value, runtimeSnapshot.value));
      const rawJson = Vue.computed(() => JSON.stringify({
        mode: isRuntimeContext.value ? "runtime" : inspectedDetails.value ? "selection" : "context",
        context: context.value,
        selectedObject: inspectedDetails.value,
        runtimeTarget: isRuntimeContext.value ? runtimeTarget.value : null,
        runtime: isRuntimeContext.value ? runtimeSnapshot.value : null
      }, null, 2));
      const commandEnabled = (commandId: string) => commands.isEnabled(commandId);
      const runCommand = (commandId: string) => commands.execute(commandId);
      const revealLink = (row: {commandId: string; value: string}) => commands.execute(row.commandId, {objectId: row.value});
      return {
        activeTab,
        boundsRows,
        commandEnabled,
        context,
        inspectedDetails,
        isRuntimeContext,
        linkRows,
        revealLink,
        overviewRows,
        propertyRows,
        rawJson,
        runCommand,
        runtimeActionRows,
        runtimeCard,
        runtimeOverviewRows,
        runtimeTableRows,
        runtimeTarget,
        selectedDetails,
        subtitle,
        title
      };
    },
    template: `
      <section class="studio-panel inspector-panel" aria-label="Inspector">
        <header class="inspector-panel-header">
          <div class="inspector-kicker">Inspector</div>
          <h1 :title="title">{{ title }}</h1>
          <p>{{ subtitle }}</p>
          <div v-if="inspectedDetails" class="inspector-header-actions">
            <el-button size="small" :disabled="!commandEnabled('viewport.frameSelection')" @click="runCommand('viewport.frameSelection')">Frame</el-button>
            <el-button size="small" :disabled="!commandEnabled('selection.copyId')" @click="runCommand('selection.copyId')">Copy ID</el-button>
            <el-button size="small" :disabled="!commandEnabled('selection.copyDetailsJson')" @click="runCommand('selection.copyDetailsJson')">Copy JSON</el-button>
          </div>
          <div v-else-if="isRuntimeContext" class="inspector-header-actions">
            <el-button
              v-for="action in runtimeActionRows.slice(0, 3)"
              :key="action.commandId"
              size="small"
              :disabled="!commandEnabled(action.commandId)"
              @click="runCommand(action.commandId)">
              {{ action.label }}
            </el-button>
          </div>
        </header>

        <nav class="inspector-tabs" aria-label="Inspector views">
          <button :data-active="activeTab === 'details' ? 'true' : 'false'" @click="activeTab = 'details'">Details</button>
          <button :data-active="activeTab === 'json' ? 'true' : 'false'" @click="activeTab = 'json'">JSON</button>
        </nav>

        <template v-if="activeTab === 'details'">
          <section v-if="linkRows.length > 0" class="inspector-link-strip" aria-label="Resolved runtime links">
            <article v-for="row in linkRows" :key="row.label" :data-state="row.state">
              <button v-if="row.state === 'linked'" type="button" class="inspector-link-button" :title="'Reveal in ' + row.label" @click="revealLink(row)">{{ row.label }}</button>
              <strong v-else>{{ row.label }}</strong>
              <span :title="row.value">{{ row.value }}</span>
            </article>
          </section>

          <section class="inspector-section">
            <h2>Overview</h2>
            <dl class="inspector-property-list">
              <template v-for="row in overviewRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd :title="row.value">{{ row.value }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="isRuntimeContext" class="inspector-section">
            <h2>{{ runtimeCard?.title || 'Runtime' }} State</h2>
            <dl class="inspector-property-list">
              <template v-for="row in runtimeOverviewRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd :title="row.value">{{ row.value }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="isRuntimeContext && runtimeActionRows.length > 0" class="inspector-section">
            <h2>Actions</h2>
            <div class="inspector-action-grid">
              <el-button
                v-for="action in runtimeActionRows"
                :key="action.commandId"
                size="small"
                :disabled="!commandEnabled(action.commandId)"
                @click="runCommand(action.commandId)">
                {{ action.label }}
              </el-button>
            </div>
          </section>

          <section v-if="isRuntimeContext && runtimeTableRows.length > 0" class="inspector-section">
            <h2>{{ runtimeTarget === 'scene' ? 'SceneModels' : runtimeTarget === 'data' ? 'DataModels' : runtimeTarget === 'diagnostics' ? 'Sources' : 'Details' }}</h2>
            <div class="inspector-runtime-table">
              <article v-for="(row, index) in runtimeTableRows" :key="row.id || index">
                <strong :title="row.title">{{ row.title }}</strong>
                <span v-for="cell in row.cells" :key="cell.label" :title="cell.value">{{ cell.label }} {{ cell.value }}</span>
              </article>
            </div>
          </section>

          <section v-if="boundsRows.length > 0" class="inspector-section">
            <h2>Bounds</h2>
            <dl class="inspector-property-list inspector-property-list--mono">
              <template v-for="row in boundsRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="propertyRows.length > 0" class="inspector-section">
            <h2>Properties</h2>
            <div class="inspector-property-table">
              <article v-for="(row, index) in propertyRows" :key="row.setName + ':' + row.name + ':' + index">
                <span class="inspector-property-set" :title="row.setName">{{ row.setName }}</span>
                <span class="inspector-property-name" :title="row.name">{{ row.name }}</span>
                <span class="inspector-property-value" :title="row.value">{{ row.value }}</span>
              </article>
            </div>
          </section>

          <p v-else-if="inspectedDetails" class="inspector-empty">No DataObject properties are linked to this selection.</p>
        </template>

        <section v-else class="inspector-section inspector-json-section">
          <h2>Raw JSON</h2>
          <pre>{{ rawJson }}</pre>
        </section>
      </section>
    `
  };
}

function formatVec(values: readonly number[]): string {
  return values.map((value) => Number.isFinite(value) ? value.toFixed(3) : "0.000").join(", ");
}

function runtimeTargetFromContext(context: any): RuntimeOverviewTargetId {
  const title = String(context?.title || "").toLowerCase();
  if (title.includes("scene")) {
    return "scene";
  }
  if (title.includes("data")) {
    return "data";
  }
  if (title.includes("diagnostic")) {
    return "diagnostics";
  }
  if (title.includes("tile")) {
    return "tiles";
  }
  return "viewer";
}

function runtimeRowsForTarget(target: RuntimeOverviewTargetId, snapshot: any, workspace: any, sceneHealth: any, dataHealth: any, diagnostics: any, tiles: any, aabbState: any): Array<{label: string; value: string}> {
  const card = snapshot.cards.find((candidate: any) => candidate.id === target);
  const commonRows = [
    {label: "Status", value: card?.value || "n/a"},
    {label: "Detail", value: card?.detail || "n/a"}
  ];
  if (target === "scene") {
    return [
      ...commonRows,
      {label: "SceneModels", value: String(snapshot.sceneModels.length)},
      {label: "Objects", value: String(aabbState.objectCount || 0)},
      {label: "Indexed AABBs", value: String(aabbState.indexedObjectCount || 0)},
      {label: "Health", value: `${sceneHealth.errors || 0} errors · ${sceneHealth.warnings || 0} warnings`}
    ];
  }
  if (target === "data") {
    return [
      ...commonRows,
      {label: "DataModels", value: String(snapshot.dataModels.length)},
      {label: "Health", value: `${dataHealth.errors || 0} errors · ${dataHealth.warnings || 0} warnings`},
      {label: "Inspections", value: String(dataHealth.inspectionsRun || 0)}
    ];
  }
  if (target === "diagnostics") {
    return [
      ...commonRows,
      {label: "Entries", value: String(diagnostics.entries?.length || 0)},
      {label: "Errors", value: String(diagnostics.errors || 0)},
      {label: "Warnings", value: String(diagnostics.warnings || 0)}
    ];
  }
  if (target === "tiles") {
    return [
      ...commonRows,
      {label: "Tiles", value: String(tiles.tileCount || 0)},
      {label: "Meshes", value: String(tiles.meshCount || 0)},
      {label: "Draw Calls", value: String(tiles.frameDrawCalls ?? "n/a")},
      {label: "Primitives", value: String(tiles.framePrimitives ?? "n/a")}
    ];
  }
  return [
    ...commonRows,
    {label: "Loaded", value: workspace.loaded ? "yes" : "no"},
    {label: "Selected Object", value: workspace.selectedObjectDetails?.sceneObjectId || "none"}
  ];
}

function runtimeActionsForTarget(target: RuntimeOverviewTargetId): Array<{label: string; commandId: string}> {
  const shared = [{label: "Copy Runtime JSON", commandId: "runtime.copyOverviewJson"}];
  if (target === "scene") {
    return [
      {label: "Open Scene", commandId: "runtime.openScene"},
      {label: "Open Scene Health", commandId: "view.toolWindows.scene-health"},
      {label: "Inspect Scene Health", commandId: "sceneHealth.inspect"},
      ...shared
    ];
  }
  if (target === "data") {
    return [
      {label: "Open Data", commandId: "runtime.openData"},
      {label: "Open Data Health", commandId: "view.toolWindows.data-health"},
      {label: "Inspect Data Health", commandId: "dataHealth.inspect"},
      ...shared
    ];
  }
  if (target === "diagnostics") {
    return [
      {label: "Open Diagnostics", commandId: "runtime.openDiagnostics"},
      {label: "Copy Summary JSON", commandId: "diagnostics.copySummaryJson"},
      {label: "Clear Warnings", commandId: "diagnostics.clear"},
      ...shared
    ];
  }
  if (target === "tiles") {
    return [
      {label: "Open Tiles", commandId: "runtime.openTiles"},
      {label: "Refresh Tiles", commandId: "tiles.refresh"},
      {label: "Copy Tile Summary", commandId: "tiles.copySummaryJson"},
      ...shared
    ];
  }
  return [
    {label: "Open Viewer", commandId: "runtime.openViewer"},
    {label: "Open Runtime", commandId: "runtime.openOverview"},
    ...shared
  ];
}

function runtimeTableRowsForTarget(target: RuntimeOverviewTargetId, snapshot: any): Array<{id: string; title: string; cells: Array<{label: string; value: string}>}> {
  if (target === "scene") {
    return snapshot.sceneModels.map((model: any) => ({
      id: model.id,
      title: model.id,
      cells: [
        {label: "objects", value: String(model.objectCount || 0)},
        {label: "meshes", value: String(model.meshCount || 0)},
        {label: "geometries", value: String(model.geometryCount || 0)},
        {label: "issues", value: `${model.errors || 0} E · ${model.warnings || 0} W`}
      ]
    }));
  }
  if (target === "data") {
    return snapshot.dataModels.map((model: any) => ({
      id: model.id,
      title: model.id,
      cells: [
        {label: "schema", value: model.schema || "n/a"},
        {label: "objects", value: String(model.objectCount || 0)},
        {label: "types", value: String(model.typeCount || 0)},
        {label: "issues", value: `${model.errors || 0} E · ${model.warnings || 0} W`}
      ]
    }));
  }
  if (target === "diagnostics") {
    return snapshot.diagnosticSources.map((source: any) => ({
      id: source.source,
      title: source.source,
      cells: [
        {label: "errors", value: String(source.errors || 0)},
        {label: "warnings", value: String(source.warnings || 0)},
        {label: "total", value: String(source.total || 0)}
      ]
    }));
  }
  return [];
}
