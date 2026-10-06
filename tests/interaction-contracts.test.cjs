const assert = require("node:assert/strict");
const test = require("node:test");
require("tsx/cjs");

const {CommandRegistry} = require("../src/studio/commands/CommandRegistry.ts");
const {commandObjectId} = require("../src/studio/commands/objectCommandTarget.ts");
const {inspectExplorerNode} = require("../src/studio/explorers/inspectExplorerNode.ts");
const {ContextMenuService, separator} = require("../src/studio/services/ContextMenuService.ts");
const {objectContextMenuItems} = require("../src/studio/context-menu/installStudioContextMenus.ts");
const {registerDiagnosticCommands} = require("../src/studio/commands/registerDiagnosticCommands.ts");
const {summarizeProblems} = require("../src/studio/services/ProblemsSummary.ts");
const {exportSelectionIssue} = require("../src/studio/services/exportAvailability.ts");
const {expandMaterialized} = require("../src/studio/context-menu/treeTraversal.ts");
const {diagnosticObjectIds} = require("../src/studio/services/diagnosticObjectIds.ts");
const {registerStudioCommands} = require("../src/studio/commands/registerStudioCommands.ts");
const {registerSelectionCommands} = require("../src/studio/commands/registerSelectionCommands.ts");
const {registerTilesCommands} = require("../src/studio/commands/registerTilesCommands.ts");
const {registerRendererCommands} = require("../src/studio/commands/registerRendererCommands.ts");
const {registerSunStudyCommands} = require("../src/studio/commands/registerSunStudyCommands.ts");
const {toolWindowPanels} = require("../src/studio/layout/toolWindowDefinitions.ts");

test("Studio command families register without conflicting shortcuts", () => {
  const commands = new CommandRegistry();
  const params = {commands, actions: {}, workspace: {}, toolWindowPanels, importDialogState: {}, exportDialogState: {}, sunStudyPanelState: {}};
  registerStudioCommands(params);
  registerSelectionCommands(params);
  registerTilesCommands(params);
  registerRendererCommands(params);
  registerSunStudyCommands(params);
  registerDiagnosticCommands(params);
  assert.ok(commands.get("file.import"));
  assert.ok(commands.get("tiles.refresh"));
  assert.ok(commands.get("sceneHealth.cleanupAll"));
  const shortcuts = commands.list().filter((command) => command.shortcut).map((command) => command.shortcut);
  assert.equal(new Set(shortcuts).size, shortcuts.length);
});

test("diagnostic geometry references resolve all owning objects without guessing asset types", () => {
  const scene = {objects: {a: {}, b: {}}, models: {model: {objects: {a: {}, b: {}}, meshes: {
    first: {id: "m1", geometry: {id: "g"}, object: {id: "a"}}, second: {id: "m2", geometry: {id: "g"}, object: {id: "b"}}
  }}}};
  assert.deepEqual(diagnosticObjectIds(scene, {}, {domain: "scene", modelId: "model", resourceId: "g", resourceKind: "GEOMETRY"}), ["a", "b"]);
  assert.deepEqual(diagnosticObjectIds(scene, {}, {domain: "scene", modelId: "model", resourceId: "g", resourceKind: "TEXTURE"}), []);
  assert.deepEqual(diagnosticObjectIds(scene, {models: {data: {objects: {a: {}}}}}, {domain: "data", modelId: "data", resourceId: "a"}), ["a"]);
});

test("explicit object targets override selection; malformed targets never fall back to it", () => {
  assert.equal(commandObjectId({sceneObjectId: "clicked"}, "selected"), "clicked");
  assert.equal(commandObjectId(undefined, "selected"), "selected");
  assert.equal(commandObjectId({}, "selected"), null);
  assert.equal(commandObjectId({sceneObjectId: ""}, "selected"), null);
});

test("context-menu enablement and execution use the clicked object with no prior selection", async () => {
  let selected = null;
  const calls = [];
  const commands = new CommandRegistry(() => ({selectedObjectId: selected}));
  for (const id of ["viewport.frameSelection", "viewport.hideSelection", "viewport.showOnlySelection", "selection.copyId"]) {
    commands.register({id, title: id, enabled: (context, payload) => commandObjectId(payload, context.selectedObjectId) === "clicked",
      run: (payload) => calls.push([id, payload.sceneObjectId])});
  }
  const items = objectContextMenuItems({commands, selectionService: {selectedSceneObjectId: selected}, selectSceneObject: (id) => {selected = id;}}, "clicked");
  const hide = items.find((item) => item.id === "hide");
  assert.equal(hide.enabled, true);
  assert.equal(commands.isEnabled("viewport.hideSelection"), false);
  await hide.action();
  assert.deepEqual(calls, [["viewport.hideSelection", "clicked"]]);
  assert.equal(selected, null, "view operations must not replace the working selection");
  assert.equal(items.some((item) => item.id === "show-only"), false);
});

test("command execution rechecks target availability and rejects shortcut aliases", () => {
  const commands = new CommandRegistry();
  let available = true;
  let calls = 0;
  commands.register({id: "one", title: "One", shortcut: "Ctrl+Alt+I", enabled: () => available, run: () => {calls++;}});
  assert.throws(() => commands.register({id: "two", title: "Two", shortcut: "Alt+Cmd+I", run() {}}), /already assigned/);
  available = false;
  commands.execute("one");
  assert.equal(calls, 0);
});

test("Data, Scene and IFC object nodes share selection, but model inspection has no stale object ID", () => {
  const selected = [];
  const contexts = [];
  const actions = {hasSceneObject: (id) => id === "wall", selectSceneObject: (id) => selected.push(id), setInspectorContext: (context) => contexts.push(context)};
  inspectExplorerNode("data", {id: "data-wall", kind: "object", componentId: "wall"}, actions);
  inspectExplorerNode("scene", {id: "scene-wall", kind: "object", objectId: "wall"}, actions);
  inspectExplorerNode("ifc", {id: "wall", type: "IfcWall"}, actions);
  inspectExplorerNode("data", {id: "model", kind: "model", modelId: "duplex", title: "DataModel"}, actions);
  assert.deepEqual(selected, ["wall", "wall", "wall"]);
  assert.equal(contexts[0].sceneObjectId, undefined);
  assert.equal(contexts[0].title, "DataModel");
});

test("context menu replacement and dismissal have a single owner", () => {
  const menus = new ContextMenuService();
  const action = {id: "one", label: "One", action() {}};
  menus.openAt(12, 30, [separator("first"), action, separator("last")]);
  assert.deepEqual(menus.state.items, [action]);
  menus.openAt(2, 4, [{...action, id: "two"}]);
  assert.equal(menus.state.items.length, 1);
  assert.equal(menus.state.items[0].id, "two");
  menus.close();
  assert.equal(menus.state.open, false);
  assert.equal(menus.state.items.length, 0);
});

test("Problems includes full health counts, not the displayed issue sample", () => {
  const scene = {selectedModelId: "duplex", errors: 0, warnings: 1045, issueGroups: [{code: "DUP", severity: "warning", label: "Duplicate vertices", count: 1045, issues: Array(12).fill({})}]};
  const data = {selectedModelId: "data", errors: 2, warnings: 0, issueGroups: [{code: "REL", severity: "error", label: "Relationships", count: 2}]};
  const result = summarizeProblems({entries: [], errors: 0, warnings: 0}, scene, data);
  assert.equal(result.warnings, 1045);
  assert.equal(result.errors, 2);
  assert.equal(result.rows[0].count, 1045);
  assert.equal(result.rows[0].commandId, "view.toolWindows.scene-health");
});

test("cleanup is confirmed, cancelled safely and invalidated by a refreshed report", async () => {
  const state = {selectedModelId: "model", reportRevision: 1, inspecting: false, applying: false, stale: false, fixableIssueCount: 10, fixableCodes: ["DUP"], issueGroups: [{code: "DUP", count: 10, label: "Duplicates"}]};
  const commands = new CommandRegistry();
  const calls = [];
  let answer = false;
  let changeReport = false;
  registerDiagnosticCommands({commands, sceneHealthPanelState: state, diagnosticsPanelState: {entries: []}, dataHealthPanelState: {},
    actions: {sceneHealthActions: {cleanupCodes: (codes) => calls.push(codes)}},
    confirmCleanup: async (preview) => { assert.equal(preview.modelId, "model"); if (changeReport) state.reportRevision++; return answer; }});
  await commands.get("sceneHealth.cleanupAll").run();
  assert.equal(calls.length, 0);
  answer = true;
  changeReport = true;
  await commands.get("sceneHealth.cleanupAll").run();
  assert.equal(calls.length, 0);
  changeReport = false;
  await commands.get("sceneHealth.cleanupAll").run();
  assert.deepEqual(calls, [["DUP"]]);
});

test("export explains missing selections and unsupported formats", () => {
  assert.match(exportSelectionIssue({dataExtension: "datamodel.json"}, 1, 0), /DataModel/);
  assert.match(exportSelectionIssue({}, 0, 1), /SceneModel/);
  assert.equal(exportSelectionIssue({dataExtension: "datamodel.json"}, 2, 3), "");
  assert.equal(exportSelectionIssue({sceneExtension: "xgf"}, 2, 0), "");
  assert.match(exportSelectionIssue({sceneExtension: "xgf"}, 2, 3), /does not include/);
  assert.equal(exportSelectionIssue({disabled: true, disabledReason: "Unsupported"}, 2, 3), "Unsupported");
});

test("recursive opening remains bounded for cycles and deep trees", async () => {
  let count = 0;
  const store = {toggleExpanded: async (node) => {node.expanded = true; count++;}};
  const root = {id: "root", hasChildren: true, children: []};
  root.children.push(root);
  await expandMaterialized(store, root);
  assert.equal(count, 1);
  const chain = {id: "0", hasChildren: true, children: []};
  let node = chain;
  for (let i = 1; i < 100; i++) {const child = {id: String(i), hasChildren: true, children: []}; node.children.push(child); node = child;}
  count = 0;
  await expandMaterialized(store, chain);
  assert.equal(count, 48);
});
