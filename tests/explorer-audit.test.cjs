const assert = require("node:assert/strict");
const test = require("node:test");
require("tsx/cjs");
const {healthReportSummary} = require("../src/studio/services/healthReportSummary.ts");
const {CommandRegistry} = require("../src/studio/commands/CommandRegistry.ts");
const {registerIfcExplorerCommands} = require("../src/studio/commands/registerIfcExplorerCommands.ts");
const {registerDiagnosticCommands} = require("../src/studio/commands/registerDiagnosticCommands.ts");
const {installExplorerContextMenu} = require("../src/studio/context-menu/installStudioContextMenus.ts");
const {searchTreeEntries} = require("../src/studio/explorers/searchTreeEntries.ts");
const {treeSearchEntries} = require("../src/studio/explorers/tree/treeSearchEntries.ts");
const {revealTreePath} = require("../src/studio/explorers/tree/revealTreePath.ts");
const {findObjectPath} = require("../src/studio/explorers/ifc/findObjectPath.ts");
const {createBottomPanelComponent} = require("../src/studio/components/shell/BottomPanel.ts");
const {scrollExplorerRowIntoView} = require("../src/studio/explorers/scrollExplorerRowIntoView.ts");
// Bundle the application service without a browser or SDK runtime.
const path = require("node:path");
const navigationModule = {exports: {}};
const navigationBundle = require("esbuild").buildSync({
  entryPoints: [path.resolve(__dirname, "../src/studio/services/ExplorerNavigationService.ts")],
  bundle: true, write: false, platform: "node", format: "cjs"
}).outputFiles[0].text;
new Function("module", "exports", navigationBundle)(navigationModule, navigationModule.exports);
const {ExplorerNavigationService} = navigationModule.exports;

test("health freshness cannot mistake zero counts for a completed healthy report", () => {
  const state = {selectedModelId: "model", inspecting: false, stale: false, checkedAt: null, inspectionError: null, errors: 0, warnings: 0, info: 0};
  assert.equal(healthReportSummary(state).metric, "Not checked");
  state.inspecting = true;
  assert.equal(healthReportSummary(state).metric, "Checking");
  state.inspecting = false;
  state.checkedAt = "2026-09-24T10:00:00Z";
  assert.equal(healthReportSummary(state).metric, "No issues");
  assert.equal(healthReportSummary(state).phase, "Current");
  state.stale = true;
  assert.equal(healthReportSummary(state).metric, "Outdated");
  assert.equal(healthReportSummary(state).tone, "unknown");
  state.inspectionError = "Failed";
  assert.equal(healthReportSummary(state).metric, "Check failed");
  state.selectedModelId = "";
  assert.equal(healthReportSummary(state).metric, "No model");
});

test("inspection commands are disabled without a model and during inspection or cleanup", () => {
  const commands = new CommandRegistry();
  const scene = {selectedModelId: "", inspecting: false, applying: false};
  const data = {selectedModelId: "d", inspecting: false};
  registerDiagnosticCommands({commands, sceneHealthPanelState: scene, dataHealthPanelState: data, diagnosticsPanelState: {}, actions: {}});
  assert.equal(commands.isEnabled("sceneHealth.inspect"), false);
  scene.selectedModelId = "s";
  assert.equal(commands.isEnabled("sceneHealth.inspect"), true);
  scene.applying = true;
  assert.equal(commands.isEnabled("sceneHealth.inspect"), false);
  data.inspecting = true;
  assert.equal(commands.isEnabled("dataHealth.inspect"), false);
});

function ifcFixture() {
  const calls = [];
  const node = {id: "group", title: "IfcWall", hasChildren: true, expanded: false, children: [], effects: {visible: true}};
  const view = {objects: {a: {visible: true}, b: {visible: false}, other: {visible: true}},
    setObjectsVisible(ids, visible) { calls.push([ids, visible]); for (const id of ids) this.objects[id].visible = visible; }};
  const store = {view, state: {roots: [node]}, getNode: (id) => id === node.id ? node : null,
    getObjectId: () => null, getNodeObjectIds: () => ["a", "b"],
    setEffect: (_node, _effect, active) => view.setObjectsVisible(["a", "b"], active),
    fitObject: (target) => calls.push(["fit", target.id]), toggleExpanded: async () => {node.expanded = !node.expanded;}};
  const commands = new CommandRegistry(() => ({selectedObjectId: "other"}));
  registerIfcExplorerCommands(commands, () => store, (id) => calls.push(["select", id]));
  return {commands, store, node, view, calls};
}

test("IFC actions cover collapsed descendants and partial visibility, never unrelated selection", async () => {
  const {commands, store, view, calls} = ifcFixture();
  const payload = {source: "ifcTypes", nodeId: "group"};
  assert.equal(commands.isEnabled("ifc.show", payload), true);
  assert.equal(commands.isEnabled("ifc.hide", payload), true);
  await commands.get("ifc.fit").run(payload);
  assert.deepEqual(calls[0], ["fit", "group"]);
  await commands.get("ifc.isolate").run(payload);
  assert.equal(view.objects.a.visible, true);
  assert.equal(view.objects.b.visible, true);
  assert.equal(view.objects.other.visible, false);
  assert.equal(commands.isEnabled("ifc.select", payload), false);
  store.getNode = () => null;
  assert.equal(commands.isEnabled("ifc.hide", payload), false);
  const before = calls.length;
  await commands.get("ifc.hide").run(payload);
  assert.equal(calls.length, before);
});

test("IFC right-click opens one targeted menu, prevents propagation and removes its listener", () => {
  const {commands, store} = ifcFixture();
  let handler;
  let menu;
  const row = {dataset: {nodeId: "group"}, focus() {}};
  const container = {contains: (value) => value === row, addEventListener: (_name, value) => {handler = value;},
    removeEventListener: (_name, value) => {assert.equal(value, handler); handler = null;}};
  const cleanup = installExplorerContextMenu({commands, getIfcStore: () => store, scene: {objects: {}},
    setInspectorContext() {}, contextMenuService: {openAt(x, y, items) {assert.equal(menu, undefined); menu = {x, y, items};}}}, container, "ifcTypes");
  let prevented = false, stopped = false;
  handler({target: {closest: () => row}, clientX: 20, clientY: 30,
    preventDefault() {prevented = true;}, stopPropagation() {stopped = true;}});
  assert.ok(prevented && stopped);
  assert.equal(menu.x, 20);
  assert.ok(menu.items.some((item) => item.id === "fit" && item.enabled));
  assert.equal(menu.items.some((item) => item.id === "select"), false);
  cleanup();
  assert.equal(handler, null);
});

test("raw search traverses closed branches without materializing nodes or following object references", async () => {
  const root = {id: "root", kind: "model", title: "Model", expanded: false, children: []};
  const object = {id: "node-wall", componentId: "wall-42", kind: "object", title: "IfcWall", detail: "North Wall"};
  let reads = 0;
  const records = treeSearchEntries([root], (node) => {reads++; return node === root ? [object] : [root];}, (node) => node.kind === "model");
  const result = await searchTreeEntries(records, "north IFCWALL");
  assert.equal(result.total, 1);
  assert.deepEqual(result.entries[0].path, ["root", "node-wall"]);
  assert.equal(result.entries[0].objectId, "wall-42");
  assert.equal(reads, 1);
  assert.deepEqual(root.children, []);
  assert.equal(root.expanded, false);
});

test("search is case insensitive, limits retained matches and supports cancellation", async () => {
  const entries = Array.from({length: 700}, (_, i) => ({id: `ID-${i}`, title: "Wall", type: "IfcWall", kind: "object", path: [String(i)]}));
  assert.equal((await searchTreeEntries(entries, "id-699")).entries[0].id, "ID-699");
  const all = await searchTreeEntries(entries, "wall");
  assert.equal(all.total, 700);
  assert.equal(all.entries.length, 100);
  const abort = new AbortController();
  const pending = searchTreeEntries(entries, "wall", abort.signal);
  abort.abort();
  await assert.rejects(pending, {name: "AbortError"});
});

test("IFC path discovery stops cycles and excessive depth without creating UI nodes", () => {
  const children = {a: ["b"], b: ["a", "c"], c: []};
  assert.deepEqual(findObjectPath(["a"], (id) => children[id], "c"), ["a", "b", "c"]);
  assert.equal(findObjectPath(["a"], (id) => children[id], "missing"), null);
  assert.equal(findObjectPath(["0"], (id) => [String(Number(id) + 1)], "100"), null);
});

test("reveal expands only destination ancestors and ignores stale operations", async () => {
  const node = (id) => ({id, expanded: false, loading: false, children: []});
  const root = node("root"), branch = node("branch"), sibling = node("sibling"), leaf = node("leaf");
  const expanded = [];
  const store = {state: {roots: [root]}, async toggleExpanded(target) {
    expanded.push(target.id); target.expanded = true; target.children = target === root ? [branch, sibling] : [leaf];
  }};
  assert.equal(await revealTreePath(store, ["root", "branch", "leaf"]), leaf);
  assert.deepEqual(expanded, ["root", "branch"]);
  assert.equal(sibling.expanded, false);
  assert.equal(await revealTreePath(store, ["root", "sibling"], () => false), null);
  assert.equal(await revealTreePath(store, ["root", "root"]), null);
});

test("bottom log filters are independent per tab", () => {
  const Vue = {reactive: (value) => value, computed: (spec) => ({get value() {return typeof spec === "function" ? spec() : spec.get();}, set value(value) {spec.set(value);}})};
  const workspace = {bottomPanelTab: "output", outputEntries: [{message: "Loaded"}], eventEntries: [{message: "Selected"}], taskEntries: []};
  const setup = createBottomPanelComponent(Vue, {workspace, commands: {}, diagnosticsPanelState: {entries: [], errors: 0, warnings: 0},
    sceneHealthPanelState: {issueGroups: [], errors: 0, warnings: 0}, dataHealthPanelState: {issueGroups: [], errors: 0, warnings: 0}}).setup();
  setup.filter.value = "missing";
  assert.equal(setup.outputRows.value.length, 0);
  workspace.bottomPanelTab = "events";
  assert.equal(setup.filter.value, "");
  assert.equal(setup.eventRows.value.length, 1);
  setup.filter.value = "Selected";
  workspace.bottomPanelTab = "output";
  assert.equal(setup.filter.value, "missing");
});

test("reveal commands open the correct panel and focus the explicit target after a remount", async () => {
  const node = (id) => ({id, expanded: false, loading: false, children: []});
  const root = node("root"), wall = node("wall");
  const store = {state: {roots: [root]}, getSearchEntries: () => [{id: "wall", objectId: "wall", path: ["root", "wall"]}],
    async toggleExpanded(target) {target.expanded = true; target.children = [wall];}};
  const opened = [], focused = [];
  let mounted = null;
  const hosts = {getStore: () => mounted, whenMounted: async () => {mounted = store; return store;}, focusNode: (source, target) => focused.push([source, target.id])};
  const commands = new CommandRegistry(() => ({selectedObjectId: "unrelated"}));
  const navigation = new ExplorerNavigationService({hosts, commands, openPanel: (id) => opened.push(id)});
  assert.equal(commands.isEnabled("explorer.revealScene", {objectId: "wall"}), false);
  navigation.connect({scene: {objects: {wall: {}}}, data: {objects: {}, rootObjects: {}}, view: {objects: {wall: {}}}});
  assert.equal(commands.isEnabled("explorer.revealScene", {}), false);
  assert.equal(commands.isEnabled("explorer.revealData", {objectId: "wall"}), false);
  assert.equal(commands.isEnabled("explorer.revealScene", {objectId: "wall"}), true);
  await commands.get("explorer.revealScene").run({objectId: "wall"});
  assert.deepEqual(opened, ["scene"]);
  assert.deepEqual(focused, [["scene", "wall"]]);
  mounted = null;
  await commands.get("explorer.revealScene").run({objectId: "wall"});
  assert.equal(focused.length, 2);
  navigation.dispose();
  assert.equal(commands.isEnabled("explorer.revealScene", {objectId: "wall"}), false);
});

test("a pending reveal cannot focus an explorer after disposal", async () => {
  let resume;
  let focused = false;
  const commands = new CommandRegistry();
  const hosts = {whenMounted: () => new Promise((resolve) => {resume = resolve;}), focusNode: () => {focused = true;}};
  const navigation = new ExplorerNavigationService({hosts, commands, openPanel() {}});
  navigation.connect({scene: {objects: {wall: {}}}, data: {objects: {}, rootObjects: {}}, view: {objects: {}}});
  const pending = commands.get("explorer.revealScene").run({objectId: "wall"});
  navigation.dispose();
  resume({});
  await pending;
  assert.equal(focused, false);
});

test("revealing a row scrolls the tree but never Dockview's outer workspace", () => {
  const previous = global.getComputedStyle;
  global.getComputedStyle = (el) => ({overflowY: el.overflowY});
  try {
    const workspace = {scrollTop: 0, overflowY: "hidden"};
    const host = {parentElement: workspace};
    const list = {parentElement: host, overflowY: "auto", scrollTop: 0, getBoundingClientRect: () => ({top: 100, bottom: 300, height: 200})};
    const row = {parentElement: list, getBoundingClientRect: () => ({top: 500, bottom: 528, height: 28})};
    scrollExplorerRowIntoView(row, host, "center");
    assert.equal(list.scrollTop, 314);
    assert.equal(workspace.scrollTop, 0);
  } finally { global.getComputedStyle = previous; }
});

test("building names and floor context rank ahead of incidental ID matches, across result pages", async () => {
  const incidental = Array.from({length: 150}, (_, i) => ({id: `guid-2-${i}`, title: "Level 1", type: "IfcBuildingStorey", path: []}));
  const floor = {id: "floor-second", title: "Level 2", type: "IfcBuildingStorey", path: []};
  const wall = {id: "wall-second", title: "External wall", type: "IfcWall", context: "Level 2", path: []};
  const result = await searchTreeEntries([...incidental, wall, floor], "Level 2");
  assert.equal(result.total, 152);
  assert.equal(result.entries.length, 100);
  assert.deepEqual(result.entries.slice(0, 2), [floor, wall]);
  assert.equal((await searchTreeEntries([floor, wall], "wall-second")).entries[0], wall);
});
