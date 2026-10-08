import {createSelectionEffects} from "./SelectionEffects";
import type {PanelVisibilityApi} from "../../ui/observePanelActivity";
import type {ObjectSelectionDetails} from "../../services/ObjectSelectionDetails";
import {
  createRuntimeOverviewSnapshot,
  type RuntimeOverviewTargetId
} from "../../services/RuntimeOverviewSummary";

export function createInspectorPanel(Vue: any) {
  return {
    name: "StudioInspectorPanel",
    components: {SelectionEffects: createSelectionEffects(Vue)},
    props: ["params"],
    setup(props: {params?: {api?: PanelVisibilityApi}} = {}) {
      const commands = Vue.inject("commands") as any;
      const workspace = Vue.inject("workspace") as any;
      let visibilitySubscription: {dispose(): void} | undefined;
      Vue.onMounted(() => {
        workspace.inspectorVisible = props.params?.api?.isVisible ?? true;
        visibilitySubscription = props.params?.api?.onDidVisibilityChange(event => { workspace.inspectorVisible = event.isVisible; });
      });
      Vue.onBeforeUnmount(() => { visibilitySubscription?.dispose(); workspace.inspectorVisible = false; });
      const aabbState = Vue.inject("aabbPanelState") as any;
      const dataHealth = Vue.inject("dataHealthPanelState") as any;
      const diagnostics = Vue.inject("diagnosticsPanelState") as any;
      const sceneHealth = Vue.inject("sceneHealthPanelState") as any;
      const tiles = Vue.inject("tilesPanelState") as any;
      const panel = Vue.ref(null as HTMLElement | null);
      const session = workspace.inspectorSession;
      const activeTab = Vue.computed({get: () => session.activeTab, set: (value: string) => { session.activeTab = value; }});
      const restoreScroll = () => { if (panel.value) panel.value.scrollTop = session.scrollTop; };
      const rememberScroll = () => {
        // Dockview may detach or hide the old host before Vue unmounts it.
        if (panel.value?.clientHeight) session.scrollTop = panel.value.scrollTop;
      };
      Vue.onMounted(() => Vue.nextTick(restoreScroll));
      Vue.watch(() => workspace.inspectorContext.sceneObjectId || "", (id: string) => {
        if (session.objectId === id) return;
        session.objectId = id;
        session.scrollTop = 0;
        session.propertyQuery = "";
        session.collapsedPropertySets = {};
        session.advancedOpen = false;
        session.activeTab = "details";
        Vue.nextTick(restoreScroll);
      }, {immediate: true});
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
          return details.type && details.type !== "SceneObject" ? details.type : "Model element";
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
          ...(commands.isEnabled("explorer.revealIfc", {objectId: details.dataObjectId}) ? [{label: "Building", value: details.dataObjectId, commandId: "explorer.revealIfc"}] : [])
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
      const elementRows = Vue.computed(() => {
        const details = inspectedDetails.value;
        if (!details) return [];
        const floors = details.floors || [];
        return [
          {label: floors.length > 1 ? "Floors" : "Floor", value: floors.map(floor => floor.name).join(", ") || "Not provided"},
          ...(details.description ? [{label: "Description", value: details.description}] : [])
        ];
      });
      const propertyRows = Vue.computed(() => inspectedDetails.value?.propertyRows || []);
      const propertyGroups = Vue.computed(() => {
        const groups = new Map<string, {id: string; name: string; rows: ObjectSelectionDetails["propertyRows"]}>();
        const query = session.propertyQuery.trim().toLocaleLowerCase();
        for (const row of propertyRows.value) {
          if (query && ![row.setName, row.name, row.value].some(value => value.toLocaleLowerCase().includes(query))) continue;
          const id = row.setId || row.setName;
          if (!groups.has(id)) groups.set(id, {id, name: row.setName, rows: []});
          groups.get(id)!.rows.push(row);
        }
        return [...groups.values()];
      });
      const rememberPropertyGroup = (id: string, event: Event) => {
        if (!session.propertyQuery.trim()) session.collapsedPropertySets[id] = !(event.target as HTMLDetailsElement).open;
      };
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
        session,
        elementRows,
        propertyGroups,
        rememberPropertyGroup,
        panel,
        rememberScroll,
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
      <section ref="panel" class="studio-panel inspector-panel" :aria-label="inspectedDetails ? 'Element properties' : 'Inspector'" @scroll.passive="rememberScroll">
        <header class="inspector-panel-header">
          <div class="inspector-kicker">{{ inspectedDetails ? 'Properties' : 'Inspector' }}</div>
          <h1 :title="title">{{ title }}</h1>
          <p>{{ subtitle }}</p>
          <div v-if="inspectedDetails" class="inspector-header-actions">
            <el-button size="small" :disabled="!commandEnabled('viewport.frameSelection')" @click="runCommand('viewport.frameSelection')">Focus</el-button>
            <SelectionEffects/>
            <el-button size="small" aria-label="Clear selection" @click="runCommand('selection.clear')">Clear</el-button>
          </div>
          <div v-else-if="isRuntimeContext" class="inspector-header-actions">
            <el-button v-for="action in runtimeActionRows.slice(0, 3)" :key="action.commandId" size="small"
              :disabled="!commandEnabled(action.commandId)" @click="runCommand(action.commandId)">{{ action.label }}</el-button>
          </div>
        </header>

        <template v-if="inspectedDetails">
          <section class="inspector-section inspector-element-summary" aria-label="Element information">
            <dl class="inspector-property-list inspector-readable-properties">
              <template v-for="row in elementRows" :key="row.label">
                <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
              </template>
            </dl>
          </section>

          <section class="inspector-section inspector-bim-properties" aria-label="Property sets">
            <h2>Property sets</h2>
            <template v-if="propertyRows.length">
              <div class="inspector-property-search">
                <input type="search" v-model="session.propertyQuery" aria-label="Search properties" placeholder="Search properties…"
                  @keydown.esc.stop="session.propertyQuery = ''">
                <button v-if="session.propertyQuery" type="button" @click="session.propertyQuery = ''" aria-label="Clear property search">Clear</button>
              </div>
              <details v-for="group in propertyGroups" :key="group.id" class="inspector-property-group"
                :open="!!session.propertyQuery.trim() || !session.collapsedPropertySets[group.id]" @toggle="rememberPropertyGroup(group.id, $event)">
                <summary>{{ group.name }} <span class="inspector-property-count">{{ group.rows.length }}</span></summary>
                <dl class="inspector-property-list inspector-readable-properties">
                  <template v-for="(row, index) in group.rows" :key="index">
                    <dt>{{ row.name }}</dt><dd>{{ row.value === '' ? 'Not provided' : row.value }}</dd>
                  </template>
                </dl>
              </details>
              <p v-if="!propertyGroups.length" class="inspector-empty">No properties match “{{ session.propertyQuery }}”.</p>
            </template>
            <p v-else class="inspector-empty">{{ inspectedDetails.dataObjectId ? 'No property sets were provided for this element.' : 'No BIM properties are linked to this element.' }}</p>
          </section>

          <details class="inspector-advanced" :open="session.advancedOpen" @toggle="session.advancedOpen = $event.target.open">
            <summary>Advanced <span>IDs, geometry and JSON</span></summary>
            <template v-if="session.advancedOpen">
              <div class="inspector-section inspector-action-grid">
                <el-button size="small" :disabled="!commandEnabled('selection.copyId')" @click="runCommand('selection.copyId')">Copy ID</el-button>
                <el-button size="small" :disabled="!commandEnabled('selection.copyDetailsJson')" @click="runCommand('selection.copyDetailsJson')">Copy JSON</el-button>
              </div>
              <nav class="inspector-tabs" aria-label="Advanced views">
                <button type="button" :aria-pressed="activeTab === 'details'" :data-active="activeTab === 'details' ? 'true' : 'false'" @click="activeTab = 'details'">SDK details</button>
                <button type="button" :aria-pressed="activeTab === 'json'" :data-active="activeTab === 'json' ? 'true' : 'false'" @click="activeTab = 'json'">Raw JSON</button>
              </nav>
              <template v-if="activeTab === 'details'">
                <section v-if="linkRows.length" class="inspector-link-strip" aria-label="Resolved runtime links">
                  <article v-for="row in linkRows" :key="row.label" :data-state="row.state">
                    <button v-if="row.state === 'linked'" type="button" class="inspector-link-button" :title="'Reveal in ' + row.label" @click="revealLink(row)">{{ row.label }}</button>
                    <strong v-else>{{ row.label }}</strong>
                    <span :title="row.value">{{ row.value }}</span>
                  </article>
                </section>
                <section class="inspector-section">
                  <h2>SDK details</h2>
                  <dl class="inspector-property-list inspector-readable-properties">
                    <template v-for="row in overviewRows" :key="row.label">
                      <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
                    </template>
                  </dl>
                </section>
                <section v-if="boundsRows.length" class="inspector-section">
                  <h2>Geometry bounds · model coordinates</h2>
                  <dl class="inspector-property-list inspector-property-list--mono inspector-readable-properties">
                    <template v-for="row in boundsRows" :key="row.label">
                      <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
                    </template>
                  </dl>
                </section>
              </template>
              <section v-else class="inspector-section inspector-json-section">
                <h2>Raw JSON</h2><pre>{{ rawJson }}</pre>
              </section>
            </template>
          </details>
        </template>

        <template v-else>
          <nav class="inspector-tabs" aria-label="Inspector views">
            <button type="button" :aria-pressed="activeTab === 'details'" :data-active="activeTab === 'details' ? 'true' : 'false'" @click="activeTab = 'details'">Details</button>
            <button type="button" :aria-pressed="activeTab === 'json'" :data-active="activeTab === 'json' ? 'true' : 'false'" @click="activeTab = 'json'">JSON</button>
          </nav>
          <template v-if="activeTab === 'details'">
            <section class="inspector-section">
              <h2>Overview</h2>
              <dl class="inspector-property-list inspector-readable-properties">
                <template v-for="row in overviewRows" :key="row.label">
                  <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
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

          </template>
          <section v-else class="inspector-section inspector-json-section">
            <h2>Raw JSON</h2><pre>{{ rawJson }}</pre>
          </section>
        </template>
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
