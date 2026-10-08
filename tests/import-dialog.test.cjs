const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const bundle = require("esbuild").buildSync({
  stdin: {contents: `
    export {commitImport} from "./studio/services/importTransaction";
    export {Scene} from "@xeokit/sdk/model/scene";
    export {Data} from "@xeokit/sdk/model/data";
    export {ImportDialogService, createImportDialogState} from "./studio/services/ImportDialogService";
    export {importValidation} from "./studio/services/importValidation";
    export {LoaderRegistry} from "./studio/importing/LoaderRegistry";
    export {CommandRegistry} from "./studio/commands/CommandRegistry";
    export {registerImportResultCommands} from "./studio/commands/registerImportResultCommands";
    export {createLazyLoaderRegistry} from "./studio/services/importLoaderRegistry";
  `, resolveDir: path.resolve(__dirname, "../src"), loader: "ts"},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
const output = {exports: {}};
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {commitImport, Scene, Data, ImportDialogService, createImportDialogState, importValidation, LoaderRegistry,
  CommandRegistry, registerImportResultCommands, createLazyLoaderRegistry} = output.exports;
const file = name => new File(["model contents"], name);
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};
function fixture(t, onLoaded) {
  const scene = new Scene(), data = new Data(), state = createImportDialogState(), loaders = new LoaderRegistry();
  const service = new ImportDialogService({scene, data, state, loaders, onLoaded});
  t.after(() => {scene.destroy(); data.destroy();});
  return {scene, data, state, loaders, service};
}

test("source-first starts without a format and detects a single file", t => {
  const {state, service} = fixture(t);
  assert.equal(state.dataSetId, ""); assert.equal(service.canLoad(), false);
  service.addFiles([file("sample.IFC")]);
  assert.equal(state.dataSetId, "ifc"); assert.equal(service.canLoad(), true);
  assert.equal(state.slots.ifc.fileName, "sample.IFC");
  assert.match(state.plannedModelId, /^sample-/);
});

test("compound files are assigned and format changes preserve all sources", t => {
  const {state, service} = fixture(t);
  service.addFiles([file("geometry.xgf"), file("data.json")]);
  assert.equal(state.dataSetId, "xgf+datamodel"); assert.equal(service.canLoad(), true);
  service.setDataSet("xgf");
  assert.equal(state.sources.length, 2); assert.equal(service.canLoad(), false);
  assert.match(importValidation(state).message, /does not accept/);
  service.setDataSet("xgf+datamodel");
  assert.equal(state.slots.datamodel.fileName, "data.json"); assert.equal(service.canLoad(), true);
});

test("ambiguous JSON requires a format and multiple JSON files require roles", t => {
  const {state, service} = fixture(t);
  service.addFiles([file("a.json"), file("b.json")]);
  assert.equal(state.dataSetId, "");
  service.setDataSet("scenemodel+datamodel");
  assert.equal(service.canLoad(), false);
  service.assignSource(state.sources[0].id, "scenemodel");
  assert.equal(state.sources[1].slotKey, "datamodel");
  assert.equal(service.canLoad(), true);
});

test("same-role files are never silently discarded", t => {
  const {state, service} = fixture(t);
  service.addFiles([file("first.ifc"), file("second.ifc")]);
  assert.equal(service.canLoad(), false);
  service.assignSource(state.sources[1].id, "ifc");
  assert.equal(service.canLoad(), false);
  service.removeSource(state.sources[0].id);
  assert.equal(service.canLoad(), true);
  assert.equal(state.slots.ifc.fileName, "second.ifc");
});

test("file and URL drafts survive mode changes; URL validation is inline", t => {
  const {state, service} = fixture(t);
  service.addFiles([file("a.glb")]);
  service.addUrl("not a URL"); service.setDataSet("gltf");
  assert.equal(service.canLoad(), false);
  assert.match(Object.values(importValidation(state).sources)[0], /HTTP/);
  service.updateUrl(state.sources[1].id, "https://example.com/b.glb?download=1");
  assert.equal(service.canLoad(), true);
  service.setSourceMode("file"); assert.equal(state.slots.glb.fileName, "a.glb");
  service.setSourceMode("url"); assert.match(state.slots.glb.url, /download=1/);
});

test("explicit formats support extensionless URLs without guessing one", t => {
  const {state, service} = fixture(t);
  service.addUrl("https://example.com/download?id=42");
  assert.equal(state.dataSetId, "");
  service.setDataSet("gltf"); assert.equal(service.canLoad(), true);
  service.updateUrl(state.sources[0].id, "file:///private/model.glb");
  assert.equal(service.canLoad(), false);
});

test("missing companions and empty files are blocked", t => {
  const {state, service} = fixture(t);
  service.setDataSet("xgf+datamodel"); service.addFiles([file("a.xgf")]);
  assert.match(importValidation(state).message, /DataModel JSON/);
  service.addFiles([new File([], "b.json")]);
  assert.equal(service.canLoad(), false);
  assert.match(Object.values(importValidation(state).sources)[0], /empty/);
});

test("success retains an actionable result with stable IDs and reports actual progress", async t => {
  let loaded;
  const {scene, data, state, service, loaders} = fixture(t, value => {loaded = value;});
  service.open(); service.addFiles([file("a.ifc")]);
  const id = state.plannedModelId;
  loaders.register("ifc", {fetch: "text", needsScene: true, needsData: true, load: async (_input, options) => {
    options.onProgress({phase: "Parsing entities", current: 2, total: 3});
    assert.match(state.statusText, /Parsing entities \(2 \/ 3\)/);
  }});
  await service.load();
  assert.equal(state.open, true); assert.equal(state.loading, false);
  assert.equal(state.result.modelId, id); assert.ok(scene.models[id]); assert.ok(data.models[id]);
  assert.equal(loaded.frameAfterImport, true); assert.equal(service.canLoad(), false);
});

test("failure rolls back only newly created models and allows retry without reselection", async t => {
  const {scene, data, state, service, loaders} = fixture(t);
  ok(scene.createModel({id: "existing"})); ok(data.createModel({id: "existing"}));
  service.addFiles([file("broken.ifc")]);
  loaders.register("ifc", {fetch: "text", needsScene: true, needsData: true, load: async () => {throw new Error("Invalid entity 42");}});
  await service.load();
  assert.deepEqual(Object.keys(scene.models), ["existing"]); assert.deepEqual(Object.keys(data.models), ["existing"]);
  assert.match(state.errorDetails, /entity 42/); assert.match(state.sourceErrors[state.sources[0].id], /format/);
  assert.equal(state.sources.length, 1); assert.equal(service.canLoad(), true);
});

test("source mode preserves serialized coordinates while override mode applies all fields", async t => {
  const {scene, state, service, loaders} = fixture(t);
  loaders.register("scenemodel", {fetch: "text", needsScene: true, needsData: false, load: async ({sceneModel}) => {
    sceneModel.coordinateSystem.fromParams({units: "feet", origin: [1, 2, 3]});
  }});
  service.setDataSet("scenemodel"); service.addFiles([file("a.json")]);
  state.units = "millimeters"; state.origin = [9, 8, 7];
  await service.load();
  assert.equal(scene.models[state.loadedModelId].coordinateSystem.units, "feet");
  assert.deepEqual(Array.from(scene.models[state.loadedModelId].coordinateSystem.origin), [1, 2, 3]);
  service.reset(); service.setDataSet("scenemodel"); service.addFiles([file("a.json")]);
  state.coordinateMode = "override";
  await service.load();
  assert.equal(scene.models[state.loadedModelId].coordinateSystem.units, "millimeters");
  assert.deepEqual(Array.from(scene.models[state.loadedModelId].coordinateSystem.origin), [9, 8, 7]);
});

test("background import keeps its immutable inputs and does not reopen the dialog", async t => {
  const {state, service, loaders} = fixture(t);
  let release;
  loaders.register("ifc", {fetch: "text", needsScene: true, needsData: true, load: () => new Promise(resolve => {release = resolve;})});
  service.open(); service.addFiles([file("a.ifc")]);
  const running = service.load();
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  service.close(); service.setDataSet("gltf"); service.removeSource(state.sources[0].id);
  assert.equal(state.dataSetId, "ifc"); assert.equal(state.sources.length, 1);
  release(); await running;
  assert.equal(state.open, false); assert.ok(state.result);
});

test("data-only imports create no SceneModel and optional MTL loads before OBJ", async t => {
  const {scene, state, service, loaders} = fixture(t);
  const order = [];
  for (const format of ["datamodel", "obj", "mtl"]) loaders.register(format, {
    fetch: "text", needsScene: format !== "datamodel", needsData: format === "datamodel", load: async () => {order.push(format);},
  });
  service.setDataSet("datamodel"); service.addFiles([file("data.json")]); await service.load();
  assert.equal(Object.keys(scene.models).length, 0); assert.equal(state.result.scene, false);
  service.reset(); service.addFiles([file("model.obj"), file("material.mtl")]); await service.load();
  assert.deepEqual(order, ["datamodel", "mtl", "obj"]);
});

test("UI navigation failure never destroys a successful import", async t => {
  const {scene, state, service, loaders} = fixture(t, () => {throw new Error("panel unavailable");});
  loaders.register("gltf", {fetch: "text", needsScene: true, needsData: false, load: async () => {}});
  service.addFiles([file("a.glb")]); await service.load();
  assert.ok(scene.models[state.loadedModelId]); assert.ok(state.result.warnings.some(warning => /navigation failed/.test(warning)));
});

test("result commands target the imported model, not other models or the current selection", async t => {
  const {scene, data, state} = fixture(t);
  const commands = new CommandRegistry(); const frames = [], reveals = [];
  commands.register({id: "viewport.frameObjects", title: "Frame", run: ids => {frames.push(ids);}});
  scene.models.target = {objects: {a: {}, b: {}}};
  state.result = {modelId: "target", scene: true};
  registerImportResultCommands({scene, data, state, commands, view: {objects: {a: {}, other: {}}},
    navigation: {revealModel: async (source, id) => {reveals.push([source, id]);}}, openPanel: () => {}});
  assert.equal(commands.isEnabled("file.import.frameResult"), true);
  commands.execute("file.import.frameResult");
  await commands.get("file.import.revealResult").run();
  assert.deepEqual(frames, [["a"]]); assert.deepEqual(reveals, [["scene", "target"]]);
  delete scene.models.target;
  assert.equal(commands.isEnabled("file.import.frameResult"), false);
});

test("real lazy dotbim loader receives JSON and creates scene and data objects", async t => {
  const scene = new Scene(), data = new Data(), state = createImportDialogState();
  t.after(() => {scene.destroy(); data.destroy();});
  const service = new ImportDialogService({scene, data, state, loaders: createLazyLoaderRegistry()});
  const doc = {schema_version: "1.0.0", meshes: [{mesh_id: 1, coordinates: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2]}],
    elements: [{guid: "import-regression", mesh_id: 1, type: "IfcWall", vector: {x:0,y:0,z:0}, color: {r:120,g:150,b:180,a:255}}]};
  service.addFiles([new File([JSON.stringify(doc)], "wall.bim")]);
  await service.load();
  assert.equal(state.errorText, "");
  assert.equal(state.result.sceneObjects, 1); assert.equal(state.result.dataObjects, 1);
  assert.equal(state.result.warnings.length, 0);
});

test("invalid explicit coordinates block import, source mode ignores inactive overrides", t => {
  const {state, service} = fixture(t);
  service.addFiles([file("a.ifc")]); state.coordinateMode = "override";
  service.setOrigin(0, "invalid"); assert.equal(service.canLoad(), false);
  assert.match(importValidation(state).message, /finite/);
  state.coordinateMode = "source"; assert.equal(service.canLoad(), true);
});

const triangleDocument = guid => ({schema_version: "1.0.0", meshes: [{mesh_id: 1, coordinates: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2]}],
  elements: [{guid, mesh_id: 1, type: "IfcWall", vector: {x:0,y:0,z:0}, color: {r:120,g:150,b:180,a:255}}]});
const importFile = (guid, name = "wall.bim") => new File([JSON.stringify(triangleDocument(guid))], name);
test("duplicate imports are staged; Cancel keeps the original instance and Replace keeps unrelated models", async t => {
  const scene = new Scene(), data = new Data(), state = createImportDialogState();
  t.after(() => {scene.destroy(); data.destroy();});
  const service = new ImportDialogService({scene, data, state, loaders: createLazyLoaderRegistry()});
  service.addFiles([importFile("wall")]); await service.load();
  const oldId = state.loadedModelId, old = scene.models[oldId];
  assert.equal(state.result.label, "wall.bim");
  service.reset(); service.addFiles([importFile("other", "other.bim")]); await service.load();
  const unrelated = scene.models[state.loadedModelId];
  service.reset(); service.addFiles([importFile("wall", "updated.bim")]); await service.load();
  assert.equal(state.result, null); assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].title, "wall.bim"); assert.equal(scene.models[oldId], old);
  assert.equal(Object.keys(scene.models).length, 2); assert.equal(service.canLoad(), false);
  service.cancelReplacement(); assert.equal(scene.models[oldId], old); assert.equal(service.canLoad(), true);
  await service.load(); service.replaceExisting();
  assert.equal(state.conflicts.length, 0); assert.equal(state.errorText, "");
  assert.equal(state.result.label, "updated.bim"); assert.equal(scene.models[oldId], undefined);
  assert.equal(data.models[oldId], undefined); assert.equal(scene.models[unrelated.id], unrelated);
  assert.equal(Object.keys(scene.models).length, 2); assert.equal(Object.keys(data.models).length, 2);
  assert.equal(Object.keys(scene.models[state.loadedModelId].objects).length, 1);
});
test("invalid staged geometry preserves the original and failed commit restores geometry and metadata", async t => {
  const scene = new Scene(), data = new Data(), state = createImportDialogState();
  t.after(() => {scene.destroy(); data.destroy();});
  const service = new ImportDialogService({scene, data, state, loaders: createLazyLoaderRegistry()});
  service.addFiles([importFile("wall")]); await service.load();
  const id = state.loadedModelId, old = scene.models[id], sceneParams = ok(old.toParams()), dataParams = ok(data.models[id].toParams());
  service.reset(); service.addFiles([new File(['{broken'], 'broken.bim')]); await service.load();
  assert.ok(state.errorText); assert.equal(scene.models[id], old); assert.equal(state.conflicts.length, 0);
  const create = data.createModel.bind(data); let failed = false;
  data.createModel = params => {if (!failed) {failed = true; return {ok:false,error:'simulated commit failure'};} return create(params);};
  assert.throws(() => commitImport(scene, data, {modelId:'replacement', title:'Replacement', scene:sceneParams, data:dataParams},
    [{sceneModelId:id, dataModelId:id, title:'Wall'}]), /simulated commit failure/);
  assert.ok(scene.models[id]); assert.ok(data.models[id]); assert.equal(scene.models.replacement, undefined);
  assert.equal(Object.keys(scene.models[id].objects).length, 1); assert.equal(Object.keys(data.models[id].objects).length, 1);
});
