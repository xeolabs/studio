const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const root = path.resolve(__dirname, "../vendor/xeokit-sdk");
const bundle = require("esbuild").buildSync({
  stdin: {contents: `
    export {Data} from "@xeokit/sdk/model/data";
    export {Scene} from "@xeokit/sdk/model/scene";
    export {TrianglesPrimitive} from "@xeokit/sdk/base/constants";
    export {DataHealthService, createDataHealthPanelState} from "./studio/services/DataHealthService";
    export {SceneHealthService, createSceneHealthPanelState} from "./studio/services/SceneHealthService";
    export {applyDataReferenceCleanup} from "./studio/services/dataPropertySetCleanups";
    export {registerHealthCleanupCommands} from "./studio/commands/registerHealthCleanupCommands";
    export {CommandRegistry} from "./studio/commands/CommandRegistry";
    export {createStudioActions} from "./studio/app/createStudioActions";
    export {connectStudioActions} from "./studio/app/connectStudioActions";
  `, resolveDir: path.resolve(__dirname, "../src"), loader: "ts"},
  alias: {"@xeokit/sdk": path.join(root, "src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
const output = {exports: {}};
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {Data, Scene, TrianglesPrimitive, DataHealthService, createDataHealthPanelState, SceneHealthService,
  createSceneHealthPanelState, applyDataReferenceCleanup, registerHealthCleanupCommands, CommandRegistry,
  createStudioActions, connectStudioActions} = output.exports;
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
const ok = (result) => {assert.equal(result.ok, true, result.error); return result.value;};

test("Scene cleanup finishes all batches despite its own mutation events and refreshes the report", async () => {
  const scene = new Scene();
  const model = ok(scene.createModel({id: "cleanup", updateMode: "dynamic"}));
  for (let i = 0; i < 16; i++) {
    for (const suffix of ["a", "b"]) {
      const id = `${i}-${suffix}`;
      ok(model.createGeometry({id, primitive: TrianglesPrimitive,
        positions: [0, 0, 0, i + 1, 0, 0, 0, i + 1, 0], indices: [0, 1, 2]}));
      ok(model.createMesh({id, geometryId: id, position: [i * 2, 0, 0]}));
      ok(model.createObject({id, meshIds: [id]}));
    }
  }
  const state = createSceneHealthPanelState();
  const service = new SceneHealthService({scene, state, inspectParams: {checkSimilarGeometries: false}});
  try {
    await service.inspectSelected();
    assert.ok(state.fixableCodes.includes("GEOMETRY_DUPLICATE"));
    await service.cleanupCodes(["GEOMETRY_DUPLICATE"]);
    assert.equal(Object.keys(model.geometries).length, 16);
    assert.equal(Object.keys(model.meshes).length, 32);
    assert.equal(Object.keys(model.objects).length, 32);
    assert.equal(state.cleanupHistory[0].fixed, 16);
    assert.equal(state.cleanupHistory[0].errors, 0);
    assert.equal(state.issueGroups.some((group) => group.code === "GEOMETRY_DUPLICATE"), false);
    assert.equal(state.applying, false);
    assert.equal(state.stale, false);
  } finally { service.destroy(); scene.destroy(); }
});

test("Scene vertex cleanup preserves indexed surfaces on static imports across all batches", async () => {
  const scene = new Scene();
  const model = ok(scene.createModel({id: "vertices", updateMode: "static"}));
  const snapshots = new Map();
  const corners = (g) => Array.from(g.indices).flatMap(i => Array.from(g.positionsCompressed).slice(i * 3, i * 3 + 3));
  for (let i = 0; i < 16; i++) {
    const id = `g${i}`;
    const g = ok(model.createGeometry({id, primitive: TrianglesPrimitive,
      positions: [0, 0, 0, 0, 0, 0, i + 1, 0, 0, 0, 2, 0], indices: [1, 2, 3]}));
    ok(model.createMesh({id, geometryId: id}));
    ok(model.createObject({id, meshIds: [id]}));
    snapshots.set(id, corners(g));
  }
  const state = createSceneHealthPanelState();
  const service = new SceneHealthService({scene, state, inspectParams: {checkSimilarGeometries: false}});
  try {
    await service.inspectSelected();
    await service.cleanupCodes(["GEOMETRY_DUPLICATE_VERTICES"]);
    assert.equal(state.cleanupHistory[0].fixed, 16);
    assert.equal(state.cleanupHistory[0].errors, 0);
    assert.equal(state.stale, false);
    assert.equal(state.issueGroups.some(group => group.code === "GEOMETRY_DUPLICATE_VERTICES"), false);
    for (const g of Object.values(model.geometries)) {
      assert.equal(g.positionsCompressed.length, 9);
      assert.deepEqual(corners(g), snapshots.get(g.id));
    }
    assert.equal(model.stats.numVertices, 48);
    assert.equal(Object.keys(model.meshes).length, 16);
    assert.equal(Object.keys(model.objects).length, 16);
  } finally { service.destroy(); scene.destroy(); }
});

test("Data cleanup removes only approved duplicate/dangling references and re-inspects actual data", async () => {
  const data = new Data();
  const model = ok(data.createModel({id: "cleanup"}));
  const ps = ok(model.createPropertySet({id: "ps", name: "Properties", type: "Pset", properties: [{name: "Height", value: 7}]}));
  for (let i = 0; i < 25; i++) ok(model.createObject({id: `wall${i}`, type: "IfcWall", propertySetIds: ["ps", "ps"]}));
  model.objects.wall0.propertySets.unshift(null);
  const state = createDataHealthPanelState();
  const service = new DataHealthService({data, state});
  try {
    await service.inspectSelected();
    assert.equal(state.fixableIssueCount, 26);
    await service.cleanupCodes(state.fixableCodes.slice());
    for (const object of Object.values(model.objects)) assert.deepEqual(object.propertySets, [ps]);
    assert.equal(ps.properties[0].value, 7);
    assert.equal(state.fixableIssueCount, 0);
    assert.equal(state.issueCount, 0);
    assert.equal(state.cleanupHistory[0].fixed, 25);
    assert.equal(state.applying, false);
    assert.equal(state.stale, false);
    assert.deepEqual(ok(model.toParams()).objects[0].propertySetIds, ["ps"]);
  } finally { service.destroy(); data.destroy(); }
});

test("Data repair skips shared objects and cannot apply unapproved categories", () => {
  const data = new Data();
  const model = ok(data.createModel({id: "one"}));
  const other = ok(data.createModel({id: "two"}));
  ok(model.createPropertySet({id: "ps", name: "Props", type: "Pset"}));
  const object = ok(model.createObject({id: "wall", type: "IfcWall", propertySetIds: ["ps", "ps"]}));
  const duplicateCodes = new Set(["OBJECT_DUPLICATE_PROPERTY_SET_REF"]);
  assert.equal(applyDataReferenceCleanup(model, "wall", new Set(["OBJECT_UNKNOWN_TYPE"])), false);
  ok(other.createObject({id: "wall", type: "IfcWall"}));
  assert.equal(applyDataReferenceCleanup(model, "wall", duplicateCodes), false);
  assert.equal(object.propertySets.length, 2);
  data.destroy();
});

test("Scene cleanup refuses a sealed model before any mesh or geometry can be removed", async () => {
  const scene = new Scene();
  const model = ok(scene.createModel({id: "sealed"}));
  for (const id of ["a", "b"]) {
    ok(model.createGeometry({id, primitive: TrianglesPrimitive, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}));
    ok(model.createMesh({id, geometryId: id}));
    ok(model.createObject({id, meshIds: [id]}));
  }
  const state = createSceneHealthPanelState();
  const service = new SceneHealthService({scene, state});
  try {
    await service.inspectSelected();
    assert.ok(state.fixableCodes.includes("GEOMETRY_DUPLICATE"));
    ok(model.seal());
    await service.cleanupCodes(["GEOMETRY_DUPLICATE"]);
    assert.equal(Object.keys(model.geometries).length, 2);
    assert.equal(Object.keys(model.meshes).length, 2);
    await service.inspectSelected();
    assert.equal(state.fixableIssueCount, 0);
  } finally { service.destroy(); scene.destroy(); }
});

test("changing the health model cannot display another model's cleanup history", async () => {
  const data = new Data();
  ok(data.createModel({id: "one"}));
  ok(data.createModel({id: "two"}));
  const state = createDataHealthPanelState();
  const service = new DataHealthService({data, state});
  try {
    await service.inspectSelected();
    state.cleanupHistory.push({label: "Previous model"});
    state.lastCleanupSummary = "Previous model cleanup";
    service.selectModel("two");
    assert.equal(state.cleanupHistory.length, 0);
    assert.equal(state.lastCleanupSummary, "");
    await service.inspectSelected();
  } finally { service.destroy(); data.destroy(); }
});

test("Data confirmation can cancel or expire; a confirmed command awaits the actual cleanup", async () => {
  const commands = new CommandRegistry();
  const state = {...createDataHealthPanelState(), selectedModelId: "model", reportRevision: 1,
    fixableCodes: ["OBJECT_DUPLICATE_PROPERTY_SET_REF"], fixableIssueCount: 1,
    issueGroups: [{code: "OBJECT_DUPLICATE_PROPERTY_SET_REF", label: "Duplicates", count: 1}]};
  let answer = false, expire = false, applied = false, resolve;
  registerHealthCleanupCommands({commands, domain: "data", state,
    confirm: async (preview) => {assert.equal(preview.domain, "data"); if (expire) state.reportRevision++; return answer;},
    apply: () => new Promise((done) => {applied = true; resolve = done;})});
  const run = () => commands.get("dataHealth.cleanupAll").run();
  await run();
  assert.equal(applied, false);
  answer = true; expire = true;
  await run();
  assert.equal(applied, false);
  expire = false;
  let finished = false;
  const pending = run().then(() => {finished = true;});
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(applied, true);
  assert.equal(finished, false);
  assert.equal(commands.isEnabled("dataHealth.cleanupAll"), false);
  resolve(); await pending;
});

test("cleanup task success uses the outcome, not the words '0 errors'", async () => {
  const actions = createStudioActions();
  const outcomes = [];
  connectStudioActions({actions, dataHealthService: {_state: {lastCleanupSummary: "1 objects repaired, 0 skipped, 0 errors", cleanupHistory: [{errors: 0}]}, cleanupCodes: async () => {}},
    workspace: {startTask: () => "task", finishTask: (_id, status) => outcomes.push(status)}});
  await actions.dataHealthActions.cleanupCodes(["OBJECT_DUPLICATE_PROPERTY_SET_REF"]);
  assert.deepEqual(outcomes, ["success"]);
});


test("Scene health stays on demand while streaming and invalidates inspected reports on mutations", async () => {
  const scene = new Scene();
  const model = ok(scene.createModel({id: "stream", loadingMode: "streaming", updateMode: "static"}));
  const state = createSceneHealthPanelState();
  const service = new SceneHealthService({scene, state});
  try {
    assert.equal(state.inspecting, false);
    assert.equal(state.checkedAt, null);
    for (let i = 0; i < 3; i++) {
      ok(model.createGeometry({id: `g${i}`, primitive: TrianglesPrimitive,
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}));
      ok(model.createMesh({id: `m${i}`, geometryId: `g${i}`}));
      ok(model.createObject({id: `o${i}`, meshIds: [`m${i}`]}));
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(state.inspecting, false);
      assert.equal(state.checkedAt, null, "streaming must not launch geometry audits");
      assert.equal(state.models[0].objectCount, i + 1);
    }
    await service.inspectSelected();
    assert.ok(state.checkedAt, "the explicit Inspect action still runs all checks");
    assert.equal(state.stale, false);
    ok(model.createGeometry({id: "extra", primitive: TrianglesPrimitive,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}));
    ok(model.createMesh({id: "extra", geometryId: "extra"}));
    ok(model.createObject({id: "new", meshIds: ["extra"]}));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(state.stale, true);
    assert.equal(state.inspecting, false);
    assert.equal(state.models[0].objectCount, 4);
  } finally {service.destroy(); scene.destroy();}
});

test("a scene mutation cancels an in-flight inspection without publishing a current report", async () => {
  const scene = new Scene();
  const model = ok(scene.createModel({id: "changing"}));
  const state = createSceneHealthPanelState();
  const service = new SceneHealthService({scene, state});
  try {
    const pending = service.inspectSelected();
    assert.equal(state.inspecting, true);
    ok(model.createGeometry({id: "extra", primitive: TrianglesPrimitive,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}));
    ok(model.createMesh({id: "extra", geometryId: "extra"}));
    ok(model.createObject({id: "new", meshIds: ["extra"]}));
    await pending;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(state.inspecting, false);
    assert.equal(state.stale, true);
    assert.equal(state.checkedAt, null);
    assert.equal(state.statusText, "Model changed");
  } finally {service.destroy(); scene.destroy();}
});
