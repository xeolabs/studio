const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const Vue = require("vue");
const {renderToString} = require("@vue/server-renderer");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export {Data} from "@xeokit/sdk/model/data";
    export {ObjectSelectionDetailsResolver} from "./studio/services/ObjectSelectionDetails";
    export {createInspectorPanel} from "./studio/components/panels/InspectorPanel";
    export {createWorkspaceStore} from "./studio/state/createWorkspaceStore";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Data, ObjectSelectionDetailsResolver, createInspectorPanel, createWorkspaceStore} = output.exports;
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};

function fixture(t) {
  const data = new Data();
  const model = ok(data.createModel({id: "building", schema: "IFC4"}));
  const object = (id, type, extra = {}) => ok(model.createObject({id, name: id, type, ...extra}));
  object("level1", "IfcBuildingStorey", {name: "Level 1"});
  object("level2", "IfcBuildingStorey", {name: "Level 2"});
  object("space", "IfcSpace");
  ok(model.createPropertySet({id: "common", name: "Pset_WallCommon", properties: [
    {name: "FireRating", value: "60 min"}, {name: "IsExternal", value: false}, {name: "Reference", value: 0},
    {name: "Description", value: "Long multiline specification\nwith <markup> & punctuation"}
  ]}));
  ok(model.createPropertySet({id: "second", name: "Pset_WallCommon", properties: [{name: "Finish", value: "Brick"}]}));
  object("wall", "IfcWall", {name: "External wall", propertySetIds: ["common", "second"]});
  const relation = (from, to, type) => ok(model.createRelationship({relatingObjectId: from, relatedObjectId: to, type}));
  relation("level1", "space", "IfcRelAggregates");
  relation("space", "wall", "IfcRelContainedInSpatialStructure");
  const scene = {objects: {wall: {id: "wall", meshes: []}, bare: {id: "bare", meshes: []}}};
  const resolver = new ObjectSelectionDetailsResolver({data, scene});
  t.after(() => {resolver.destroy(); data.destroy();});
  return {model, object, relation, resolver, scene};
}

function workspace(details) {
  const state = createWorkspaceStore({defineStore(_name, definition) {
    const state = definition.state();
    for (const [name, action] of Object.entries(definition.actions)) state[name] = action.bind(state);
    return state;
  }});
  if (details) {
    state.setSelectedObjectDetails(details);
    state.setInspectorContext({source: "scene", title: details.title, kind: details.type, sceneObjectId: details.sceneObjectId});
    state.inspectorSession.objectId = details.sceneObjectId;
  }
  return state;
}

async function render(state) {
  const app = Vue.createSSRApp(createInspectorPanel(Vue));
  app.provide("workspace", state);
  app.provide("commands", {isEnabled: () => true, execute() {}});
  for (const key of ["aabbPanelState", "dataHealthPanelState", "diagnosticsPanelState", "sceneHealthPanelState", "tilesPanelState"]) app.provide(key, {});
  app.component("el-button", {template: '<button><slot/></button>'});
  return renderToString(app);
}

test("floor lookup follows spatial ancestors, deduplicates floors and ignores classification links", t => {
  const {resolver, relation} = fixture(t);
  relation("level2", "wall", "IfcRelAssociatesClassification");
  assert.deepEqual(resolver.resolveSceneObject("wall").floors, [{id: "level1", name: "Level 1"}]);
  relation("level1", "wall", "IfcRelContainedInSpatialStructure");
  relation("level2", "wall", "IfcRelContainedInSpatialStructure");
  assert.deepEqual(new Set(resolver.resolveSceneObject("wall").floors.map(f => f.name)), new Set(["Level 1", "Level 2"]));
});

test("nested parts resolve a floor without looping through malformed cyclic relationships", t => {
  const {resolver, relation, object, scene} = fixture(t);
  object("part", "IfcBuildingElementPart");
  scene.objects.part = {id: "part", meshes: []};
  relation("wall", "part", "IfcRelNests");
  relation("part", "wall", "IfcRelAggregates");
  assert.deepEqual(resolver.resolveSceneObject("part").floors, [{id: "level1", name: "Level 1"}]);
});

test("original system IDs still resolve BIM data; property sets with duplicate names keep separate identities", t => {
  const {resolver, object, scene} = fixture(t);
  object("semantic", "IfcWall", {originalSystemId: "geometry", propertySetIds: ["common", "second"]});
  scene.objects.geometry = {id: "geometry", meshes: []};
  const details = resolver.resolveSceneObject("geometry");
  assert.equal(details.dataObjectId, "semantic");
  assert.deepEqual([...new Set(details.propertyRows.map(r => r.setId))], ["common", "second"]);
  assert.deepEqual(details.propertyRows.slice(1, 3).map(r => r.value), ["false", "0"]);
  assert.deepEqual(resolver.resolveSceneObject("bare").floors, []);
  assert.equal(resolver.resolveSceneObject("missing"), null);
});

test("default Properties shows BIM information and grouped values, with SDK details hidden", async t => {
  const {resolver} = fixture(t);
  const html = await render(workspace(resolver.resolveSceneObject("wall")));
  for (const value of ["External wall", "IfcWall", "Level 1", "FireRating", "60 min", "false", "&lt;markup&gt; &amp; punctuation"]) assert.ok(html.includes(value), value);
  assert.equal((html.match(/class="inspector-property-group"/g) || []).length, 2);
  assert.match(html, /class="inspector-advanced"><summary>Advanced/);
  for (const technical of ["SceneObject ID", "Meshes", "Resolved runtime links", "<pre>", "Copy JSON"]) assert.ok(!html.includes(technical), technical);
});

test("property search finds names, values and sets without losing false or zero", async t => {
  const {resolver} = fixture(t), state = workspace(resolver.resolveSceneObject("wall"));
  state.inspectorSession.propertyQuery = "fire";
  let html = await render(state);
  assert.ok(html.includes("FireRating") && !html.includes("IsExternal"));
  state.inspectorSession.propertyQuery = "false";
  html = await render(state); assert.ok(html.includes("IsExternal") && !html.includes("FireRating"));
  state.inspectorSession.propertyQuery = "0";
  html = await render(state); assert.ok(html.includes("Reference"));
  state.inspectorSession.propertyQuery = "pset_wallcommon";
  html = await render(state); assert.equal((html.match(/class="inspector-property-group"/g) || []).length, 2);
  state.inspectorSession.propertyQuery = "unmatched";
  html = await render(state); assert.ok(html.includes("No properties match"));
});

test("Advanced retains technical links, bounds and raw JSON on demand", async t => {
  const {resolver} = fixture(t), details = resolver.resolveSceneObject("wall");
  details.aabb = [0, 0, 0, 1, 2, 3];
  const state = workspace(details); state.inspectorSession.advancedOpen = true;
  let html = await render(state);
  for (const text of ["SceneObject ID", "Geometry bounds", "Resolved runtime links", "Copy JSON"]) assert.ok(html.includes(text), text);
  state.inspectorSession.activeTab = "json";
  html = await render(state); assert.ok(html.includes("<pre>") && html.includes("&quot;sceneObjectId&quot;"));
});

test("missing BIM data has a clear empty state and no invented floor or dimensions", async t => {
  const {resolver, object, scene} = fixture(t);
  let html = await render(workspace(resolver.resolveSceneObject("bare")));
  assert.ok(html.includes("No BIM properties are linked") && html.includes("Not provided"));
  assert.ok(!html.includes("Geometry bounds"));
  object("empty", "IfcWall"); scene.objects.empty = {id: "empty", meshes: []};
  html = await render(workspace(resolver.resolveSceneObject("empty")));
  assert.ok(html.includes("No property sets were provided"));
});

test("runtime inspection still exposes state and actions independently of element properties", async () => {
  const state = workspace(null);
  state.setInspectorContext({source: "scene", title: "Scene", kind: "Runtime", detail: "Scene runtime"});
  let html = await render(state);
  assert.ok(html.includes("Scene State") && html.includes("SceneModels"));
  state.inspectorSession.activeTab = "json";
  html = await render(state); assert.ok(html.includes("<pre>") && html.includes("&quot;runtimeTarget&quot;: &quot;scene&quot;"));
});
