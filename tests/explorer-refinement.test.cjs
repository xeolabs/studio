const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const bundle = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), loader: "ts", contents: `
    export {Data} from "@xeokit/sdk/model/data";
    export {DataExplorerStore} from "./studio/explorers/data/DataExplorerStore";
    export {parseNumericInput, parseVectorInput} from "./studio/explorers/tree/numericInput";
    export {createExplorerNumberInput} from "./studio/explorers/tree/ExplorerNumberInput";
    export {summarizeVisibility, visibilityLabel} from "./studio/explorers/tree/visibilitySummary";
    export {naturalCompare} from "./studio/explorers/tree/naturalCompare";
    export {SelectionService} from "./studio/services/SelectionService";
    export {bindExplorerSelectionState} from "./studio/explorers/bindExplorerSelectionState";
    export {searchTreeEntries} from "./studio/explorers/searchTreeEntries";
    export {treeSearchEntries} from "./studio/explorers/tree/treeSearchEntries";
    export {explorerClipboardEntries} from "./studio/context-menu/explorerClipboardEntries";
    export {explorerContextMenuItems} from "./studio/context-menu/explorerMenuItems";
    export {DataObjectTreeStore} from "./studio/explorers/ifc/DataObjectTreeStore";
    export {DataObjectTypesStore} from "./studio/explorers/ifc/DataObjectTypesStore";
    export {DataObjectStoreysStore} from "./studio/explorers/ifc/DataObjectStoreysStore";
    export {createViewerExplorerNodeComponent} from "./studio/explorers/viewer/ViewerExplorerNode";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {Data, DataExplorerStore, parseNumericInput, parseVectorInput, createExplorerNumberInput,
  summarizeVisibility, visibilityLabel, naturalCompare, SelectionService, bindExplorerSelectionState,
  searchTreeEntries, treeSearchEntries, explorerClipboardEntries, explorerContextMenuItems,
  DataObjectTreeStore, DataObjectTypesStore, DataObjectStoreysStore, createViewerExplorerNodeComponent} = output.exports;
const ok = result => {assert.ok(result.ok, result.error); return result.value;};

test("Data relationship folders follow the runtime endpoints, not misleading collection names", async t => {
  const data = new Data();
  t.after(() => data.destroy());
  const previousRAF = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => callback();
  t.after(() => { global.requestAnimationFrame = previousRAF; });
  const model = ok(data.createModel({id: "model"}));
  ok(model.createObject({id: "project", type: "IfcProject"}));
  ok(model.createObject({id: "site", type: "IfcSite"}));
  ok(model.createRelationship({type: "IfcRelAggregates", relatingObjectId: "project", relatedObjectId: "site"}));
  const store = new DataExplorerStore({data}); t.after(() => store.destroy());
  const root = store.state.roots[0].children[0].children.find(node => node.folderKind === "rootObjects");
  await store.toggleExpanded(root);
  const project = root.children[0];
  await store.toggleExpanded(project);
  const outgoing = project.children.find(node => node.title === "Outgoing Relationships");
  const incoming = project.children.find(node => node.title === "Incoming Relationships");
  assert.equal(outgoing.detail, "1"); assert.equal(incoming.detail, "0");
  await store.toggleExpanded(outgoing);
  assert.match(outgoing.children[0].detail, /project -> site/);
});

test("incomplete and out-of-range numeric drafts never become runtime zero", () => {
  for (const value of ["", " ", "-", "1e", "NaN", "Infinity"]) assert.equal(parseNumericInput(value), null);
  assert.equal(parseNumericInput("0"), 0);
  assert.equal(parseNumericInput("1.25e3"), 1250);
  assert.equal(parseNumericInput("-2", -1, 1), null);
  assert.equal(parseNumericInput("1000000"), 1000000);
  assert.deepEqual(parseVectorInput("[1, 2, -3]", 3), [1,2,-3]);
  assert.deepEqual(parseVectorInput("1 2 3", 3), [1,2,3]);
  assert.equal(parseVectorInput("1, ,3", 3), null);
  assert.equal(parseVectorInput("1,2", 3), null);
});

test("numeric fields commit explicitly, preserve focused drafts and reset with Escape", () => {
  const component = createExplorerNumberInput(), commits = [];
  const field = {value: 27.04, draft: "", editing: true, dirty: true, invalid: false, $emit: (_event, value) => commits.push(value)};
  component.methods.commit.call(field);
  assert.equal(field.invalid, true); assert.deepEqual(commits, []);
  component.watch.value.call(field, 40);
  assert.equal(field.draft, "");
  component.methods.reset.call(field);
  assert.equal(field.draft, "27.04");
  field.draft = "27.05"; field.dirty = true; component.methods.commit.call(field);
  assert.deepEqual(commits, [27.05]);
  assert.match(component.template, /step="any"/);
});

test("visibility summarizes all target instances including collapsed descendants", () => {
  const objects = {a: {visible: true}, b: {visible: false}};
  const mixed = summarizeVisibility(["a", "b", "no-view"], objects);
  assert.deepEqual(mixed, {visibleCount: 1, viewObjectCount: 2});
  assert.equal(visibilityLabel(mixed), "1 of 2 visible. Hide in View");
  objects.a.visible = false;
  assert.equal(visibilityLabel(summarizeVisibility(["a", "b"], objects)), "0 of 2 visible. Show in View");
});

test("selection highlights every existing instance and unsubscribe removes lifecycle hooks", () => {
  const previous = global.MutationObserver;
  const previousElement = global.Element;
  let observer, disconnected = false;
  global.MutationObserver = class {constructor(callback) {observer = callback;} observe() {} disconnect() {disconnected = true;}};
  global.Element = class {matches() {return true;}};
  try {
    const service = new SelectionService({view: {setObjectsInStyleBin() {}}, detailsResolver: {resolveSceneObject: id => ({sceneObjectId: id})}, onSelectionDetails() {}});
    const row = id => ({dataset: {nodeId: id}, attrs: {}, classList: {toggle() {}}, setAttribute(key, value) {this.attrs[key] = value;}});
    const rows = [row("a"), row("b"), row("c")];
    let listener;
    const container = {querySelectorAll: () => rows, addEventListener: (_event, callback) => {listener = callback;}, removeEventListener: () => {listener = null;}};
    const cleanup = bindExplorerSelectionState(container, service, id => ({id, kind: "object", componentId: id === "c" ? "other" : "wall"}));
    service.selectSceneObject("wall");
    assert.deepEqual(rows.map(row => row.attrs["aria-selected"]), ["true", "true", "false"]);
    rows.push(row("a")); observer([{type: "childList", addedNodes: [new Element()], removedNodes: []}]);
    assert.equal(rows[3].attrs["aria-selected"], "true");
    service.clear(); assert.ok(rows.every(row => row.attrs["aria-selected"] === "false"));
    cleanup(); assert.ok(disconnected); assert.equal(listener, null);
    service.selectSceneObject("wall"); assert.equal(rows[0].attrs["aria-selected"], "false");
  } finally { global.MutationObserver = previous; global.Element = previousElement; }
});

test("search keeps model context and can retrieve later matches without materializing nodes", async () => {
  const root = {id: "root", title: "SceneModel", kind: "model", modelId: "north-wing"};
  const meshes = Array.from({length: 240}, (_, i) => ({id: String(i), title: "SceneMesh", kind: "mesh", componentId: String(i)}));
  const entries = () => treeSearchEntries([root], () => meshes, node => node.kind === "model");
  const first = await searchTreeEntries(entries(), "SceneMesh north-wing");
  assert.equal(first.total, 240); assert.equal(first.entries.length, 100);
  const more = await searchTreeEntries(entries(), "SceneMesh north-wing", undefined, 200);
  assert.equal(more.entries.length, 200); assert.equal(more.entries[199].id, "199");
  assert.equal(more.entries[0].context, "north-wing");
});

test("clipboard actions distinguish names, labels, identifiers and property values", () => {
  const object = {id: "node-id", kind: "object", componentId: "wall-id", title: "SceneObject", detail: "wall-id"};
  assert.deepEqual(explorerClipboardEntries(object, "North wall")[0], {id: "copy-name", label: "Copy Name", text: "North wall"});
  assert.equal(explorerClipboardEntries(object)[0].label, "Copy Label");
  const property = explorerClipboardEntries({id: "prop", kind: "property", title: "Roughness", detail: "0.4"});
  assert.equal(property[0].text, "0.4"); assert.equal(property[0].label, "Copy Value");
  assert.ok(!property.some(entry => entry.label === "Copy ID"));
});

test("natural order keeps numbered runtime assets human-scannable", () => {
  assert.deepEqual(["Mesh 100", "Mesh 2", "Mesh 10", "Mesh 1"].sort(naturalCompare), ["Mesh 1", "Mesh 2", "Mesh 10", "Mesh 100"]);
});

test("partially visible model menus allow both Show and Hide", () => {
  const params = {sceneTree: {store: {}}, dataExplorer: {store: {}}, commands: {get: () => undefined}};
  for (const source of ["scene", "data"]) {
    const node = {id: "model", kind: "model", title: "Model", hasViewObject: true, visible: true, visibleCount: 1, viewObjectCount: 2};
    const items = explorerContextMenuItems(params, source, node);
    assert.equal(items.find(item => item.id === "show").enabled, true);
    assert.equal(items.find(item => item.id === "hide").enabled, true);
  }
});

test("IFC visibility follows the View after other tools change it", () => {
  for (const Store of [DataObjectTreeStore, DataObjectTypesStore, DataObjectStoreysStore]) {
    const viewObject = {visible: true};
    const store = {view: {objects: {wall: viewObject}}};
    assert.equal(Store.prototype._objectHasEffect.call(store, "wall", "visible"), true);
    viewObject.visible = false;
    assert.equal(Store.prototype._objectHasEffect.call(store, "wall", "visible"), false);
    viewObject.visible = true;
    assert.equal(Store.prototype._objectHasEffect.call(store, "wall", "visible"), true);
  }
});

test("Viewer control rendering tracks the store revision without proxying SDK objects", () => {
  let reads = 0;
  const controls = [{id: "eye", value: [1, 2, 3]}];
  const store = {state: {get revision() {reads++; return 1;}}, getNodeControls: () => controls};
  const node = createViewerExplorerNodeComponent();
  assert.equal(node.methods.controls.call({store, node: {}}), controls);
  assert.equal(reads, 1);
});
