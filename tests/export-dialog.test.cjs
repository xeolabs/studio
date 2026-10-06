const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const bundle = require("esbuild").buildSync({
  stdin: {contents: `
    export {Scene} from "@xeokit/sdk/model/scene";
    export {Data} from "@xeokit/sdk/model/data";
    export {TrianglesPrimitive} from "@xeokit/sdk/base/constants";
    export {ExportDialogService, createExportDialogState} from "./studio/services/ExportDialogService";
    export {exportFilenameIssue, exportOutputPlan, defaultExportBaseName} from "./studio/services/exportOutputPlan";
    export {formatFileSize} from "./studio/ui/formatFileSize";
    export {exportFormatsForSelection} from "./studio/services/exportDialogDataSets";
    export {createStudioActions} from "./studio/app/createStudioActions";
    export {connectStudioActions} from "./studio/app/connectStudioActions";
    export {CommandRegistry} from "./studio/commands/CommandRegistry";
    export {registerStudioCommands} from "./studio/commands/registerStudioCommands";
  `, resolveDir: path.resolve(__dirname, "../src"), loader: "ts"},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
const output = {exports: {}};
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {Scene, Data, TrianglesPrimitive, ExportDialogService, createExportDialogState,
  exportFilenameIssue, exportOutputPlan, defaultExportBaseName, formatFileSize, exportFormatsForSelection,
  createStudioActions, connectStudioActions, CommandRegistry, registerStudioCommands} = output.exports;
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};

function fixture(t) {
  const scene = new Scene(), data = new Data(), state = createExportDialogState();
  const service = new ExportDialogService({scene, data, state});
  for (const id of ["a", "b"]) {
    const sm = ok(scene.createModel({id}));
    ok(sm.createGeometry({id: "g", primitive: TrianglesPrimitive, positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2]}));
    ok(sm.createMesh({id: "m", geometryId: "g"}));
    ok(sm.createObject({id: `wall-${id}`, meshIds: ["m"]}));
    const dm = ok(data.createModel({id}));
    ok(dm.createObject({id: "shared", type: "IfcBuildingStorey"}));
    ok(dm.createObject({id: `wall-${id}`, type: "IfcWall"}));
  }
  service.open();
  service.setDataSet("scene-json-data-json");
  t.after(() => {service.dispose(); scene.destroy(); data.destroy();});
  return {scene, data, state, service};
}

function downloads(t, fail = false) {
  const files = [], revoked = [];
  t.mock.method(URL, "createObjectURL", blob => {files.push({blob}); return `blob:test-${files.length}`;});
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  const previousDocument = global.document, previousWindow = global.window;
  global.document = {createElement: () => ({style: {}, click() {
    if (fail) throw new Error("download blocked");
    files.at(-1).filename = this.download;
  }, remove() {}}), body: {appendChild() {}}};
  global.window = {setTimeout: callback => callback()};
  t.after(() => {global.document = previousDocument; global.window = previousWindow;});
  return {files, revoked};
}

function connect(service, state, workspace = {}) {
  const actions = createStudioActions();
  connectStudioActions({actions, exportDialogService: service, workspace});
  const commands = new CommandRegistry();
  registerStudioCommands({commands, workspace: {loaded: true}, exportActions: actions.exportActions,
    exportDialogState: state, importDialogState: {}, toolWindowPanels: {}, setInspectorContext() {}});
  return {actions, commands};
}

test("initial selection is convenient; deliberate emptiness survives reopen, format and refresh", t => {
  const {state, service} = fixture(t);
  assert.deepEqual(state.selectedSceneModelIds, ["a"]);
  service.clearSelection("scene"); service.clearSelection("data");
  service.close(); service.open(); service.setDataSet("glb-json"); service.refreshModels();
  assert.deepEqual(state.selectedSceneModelIds, []);
  assert.deepEqual(state.selectedDataModelIds, []);
  assert.equal(service.canExport(), false);
});

test("bulk commands update flags, filename and deduplicated scope through the service", t => {
  const {service, state} = fixture(t), {commands} = connect(service, state);
  commands.execute("file.export.selectAllSceneModels"); commands.execute("file.export.selectAllDataModels");
  assert.equal(state.sceneModels.filter(m => m.selected).length, 2);
  assert.equal(state.dataModels.filter(m => m.selected).length, 2);
  assert.deepEqual(state.scope, {sceneModels: 2, dataModels: 2, sceneObjects: 2, dataObjects: 3});
  assert.equal(state.baseName, "combined-model");
  commands.execute("file.export.clearSceneModels"); commands.execute("file.export.clearDataModels");
  service.open();
  assert.equal(state.scope.sceneModels, 0); assert.equal(state.scope.dataModels, 0);
});

test("model removals prune selection without silently selecting a replacement", t => {
  const {scene, data, service, state} = fixture(t);
  scene.models.a.destroy(); data.models.a.destroy(); service.refreshModels();
  assert.deepEqual(state.selectedSceneModelIds, []); assert.deepEqual(state.selectedDataModelIds, []);
  assert.equal(state.sceneModels.length, 1); assert.equal(state.scope.sceneObjects, 0);
});

test("custom filename survives selection, format and results reset; unsupported formats are ignored", t => {
  const {service, state} = fixture(t);
  assert.equal(state.baseName, "a");
  service.setBaseName("Design review 2026"); service.selectAll("scene"); service.setDataSet("glb-json");
  service.setDataSet("laz"); service.setDataSet("missing"); service.reset();
  assert.equal(state.baseName, "Design review 2026"); assert.equal(state.dataSetId, "glb-json");
});

test("filename validation and defaults are portable; previews preserve custom names", () => {
  for (const name of ["", " ", "a/b", "a\\b", "../file", "CON", "NUL.log", "name.", "name ", " name", "bad?name", "x".repeat(121)]) {
    assert.notEqual(exportFilenameIssue(name), "", name);
  }
  assert.equal(exportFilenameIssue("Design review 2026"), "");
  assert.equal(defaultExportBaseName([{id: "CON"}]), "xeokit-export");
  const format = createExportDialogState().dataSets[0];
  assert.deepEqual(exportOutputPlan(format, "Design review 2026"), [
    {filename: "Design review 2026.xgf", kind: "scene"}, {filename: "Design review 2026.datamodel.json", kind: "data"}
  ]);
  assert.equal(formatFileSize(1024), "1.0 KiB"); assert.equal(formatFileSize(0), "0 B");
});

test("invalid filenames cannot export or download", async t => {
  const {service, state} = fixture(t), {files} = downloads(t);
  service.setBaseName("bad/name"); assert.equal(service.canExport(), false);
  await service.exportSelected();
  assert.match(state.errorText, /reserved characters/); assert.equal(files.length, 0);
});

test("success remains open with exact filenames, sizes and metadata-only results; redownload needs no encoder", async t => {
  const {service, state} = fixture(t), {files} = downloads(t), {commands} = connect(service, state);
  service.setBaseName("Review");
  const expected = exportOutputPlan(service.activeDataSet, state.baseName);
  await commands.get("file.export.run").run();
  assert.equal(state.open, true); assert.equal(state.loading, false); assert.equal(state.errorText, "");
  assert.deepEqual(state.result.files.map(f => f.filename), expected.map(f => f.filename));
  state.result.files.forEach((file, i) => {
    assert.equal(file.bytes, files[i].blob.size); assert.equal(file.downloadStarted, true);
    assert.equal(file.blob, undefined); assert.equal(file.bytes > 0, true);
  });
  service._buildDownloads = () => {throw new Error("redownload must not encode");};
  commands.execute("file.export.download", expected[0].filename);
  assert.equal(files.length, 3); assert.equal(files[0].blob, files[2].blob);
  assert.equal(commands.isEnabled("file.export.download", "unknown"), false);
  assert.equal(commands.isEnabled("file.export.run"), false);
  commands.execute("file.export.reset");
  assert.equal(state.result, null); assert.equal(state.baseName, "Review");
  assert.equal(service._files.length, 0); assert.equal(service.canExport(), true);
});

test("background export never reopens the dialog and configuration commands are locked while running", async t => {
  const {service, state} = fixture(t), {commands} = connect(service, state);
  downloads(t);
  service.setBaseName("Background");
  const promise = service.exportSelected();
  assert.equal(state.loading, true);
  for (const id of ["file.export.selectAllSceneModels", "file.export.clearDataModels", "file.export.refreshModels", "file.export.dataSet.glb-json"]) {
    assert.equal(commands.isEnabled(id), false, id); commands.execute(id);
  }
  service.setBaseName("Ignored"); service.toggleSceneModel("b");
  commands.execute("file.export.close");
  await promise;
  assert.equal(state.open, false); assert.equal(state.baseName, "Background");
  assert.equal(state.result.scope.sceneModels, 1); assert.equal(state.result.files.length, 2);
  service.open(); assert.equal(state.result.files.length, 2);
});

test("failed exports keep choices and expose technical details; retry uses those choices", async t => {
  const {service, state} = fixture(t), {files} = downloads(t);
  service.setBaseName("Retry me");
  const original = service._buildDownloads;
  service._buildDownloads = async () => {throw new Error("encoder detail");};
  await service.exportSelected();
  assert.match(state.errorText, /Export failed/); assert.equal(state.errorDetails, "encoder detail");
  assert.equal(state.result, null); assert.equal(state.baseName, "Retry me"); assert.equal(service.canExport(), true);
  assert.equal(files.length, 0);
  service._buildDownloads = original;
  await service.exportSelected();
  assert.equal(state.errorDetails, ""); assert.equal(state.result.files[0].filename, "Retry me.scenemodel.json");
});

test("download failures retain generated buffers and revoke object URLs", async t => {
  const {service, state} = fixture(t), {files, revoked} = downloads(t, true);
  await service.exportSelected();
  assert.equal(state.errorText, ""); assert.equal(state.result.files.length, 2);
  assert.ok(state.result.files.every(file => !file.downloadStarted && /blocked/.test(file.downloadError)));
  assert.equal(revoked.length, 2); assert.equal(service._files.length, 2);
  service.downloadFile(state.result.files[0].filename);
  assert.equal(files[0].blob, files[2].blob); assert.equal(revoked.length, 3);
});

test("format caveats and exporter warnings are retained without duplicates", async t => {
  const {service, state} = fixture(t);
  downloads(t); service.setDataSet("glb-json");
  service._buildDownloads = async (format, _scene, _data, baseName, options) => {
    options.onWarning("Example exporter warning"); options.onWarning("Example exporter warning");
    return exportOutputPlan(format, baseName).map(file => ({...file, blob: new Blob(["test"])}));
  };
  await service.exportSelected();
  assert.equal(state.result.notices.length, 2);
  assert.match(state.result.notices[0], /GLB re-import/);
  assert.equal(state.result.notices[1], "Example exporter warning");
});

test("task completion awaits export and uses explicit failure state rather than filenames", async t => {
  const {service, state} = fixture(t), tasks = [];
  downloads(t);
  const {actions} = connect(service, state, {startTask: () => "task", finishTask: (...args) => tasks.push(args)});
  service.setBaseName("failed-error-model");
  const promise = actions.exportActions.exportSelected();
  assert.equal(typeof promise.then, "function"); assert.equal(tasks.length, 0);
  await promise; assert.equal(tasks[0][1], "success");
  service.reset(); service._buildDownloads = async () => {throw new Error("failed encoder");};
  await actions.exportActions.exportSelected(); assert.equal(tasks[1][1], "error");
});

test("teardown suppresses in-flight downloads and releases retained artifacts", async t => {
  const {service, state} = fixture(t), {files} = downloads(t);
  const promise = service.exportSelected(); service.dispose();
  await promise;
  assert.equal(state.result, null); assert.equal(files.length, 0); assert.equal(service._files.length, 0);
});

test("empty Data selection suggests scene-only formats, keeping the chosen encoding and filename", t => {
  const {service, state} = fixture(t), {commands} = connect(service, state);
  service.setDataSet("glb-json"); service.setBaseName("Geometry only");
  commands.execute("file.export.clearDataModels");
  assert.equal(state.dataSetId, "glb"); assert.equal(service.canExport(), true);
  const sceneFormats = exportFormatsForSelection(state.dataSets, state.scope.dataModels);
  for (const id of ["xgf", "glb", "scene-json", "fbx", "obj", "ifc", "e57", "splat", "xgfstream"]) assert.ok(sceneFormats.some(format => format.id === id));
  assert.ok(sceneFormats.every(format => !format.dataExtension));
  assert.deepEqual(exportOutputPlan(service.activeDataSet, state.baseName), [{filename: "Geometry only.glb", kind: "scene"}]);
  assert.equal(commands.isEnabled("file.export.dataSet.glb-json"), false);
  service.close(); service.open();
  assert.equal(state.dataSetId, "glb"); assert.deepEqual(state.selectedDataModelIds, []);
  service.toggleDataModel("b");
  assert.equal(state.dataSetId, "glb-json"); assert.equal(state.baseName, "Geometry only");
  const pairedFormats = exportFormatsForSelection(state.dataSets, state.scope.dataModels);
  for (const id of ["xgf-json", "glb-json", "scene-json-data-json", "fbx-json", "obj-json", "ifc", "ifc-json"]) assert.ok(pairedFormats.some(format => format.id === id));
  assert.ok(pairedFormats.every(format => format.dataExtension || format.nativeData));
});

test("Scene-only workflows work when no DataModels exist at all", async t => {
  const scene = new Scene(), data = new Data(), state = createExportDialogState();
  const model = ok(scene.createModel({id: "only-scene"}));
  ok(model.createGeometry({id: "g", primitive: TrianglesPrimitive, positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2]}));
  ok(model.createMesh({id: "m", geometryId: "g"})); ok(model.createObject({id: "wall", meshIds: ["m"]}));
  const service = new ExportDialogService({scene, data, state}), {files} = downloads(t);
  t.after(() => {service.dispose(); scene.destroy(); data.destroy();});
  service.open();
  assert.equal(state.dataSetId, "xgf"); assert.equal(service.canExport(), true);
  await service.exportSelected();
  assert.equal(state.errorText, ""); assert.equal(files.length, 1);
  assert.equal(files[0].filename, "only-scene.xgf"); assert.equal(state.result.scope.dataModels, 0);
});

for (const [id, extension] of [["xgf", "xgf"], ["glb", "glb"], ["scene-json", "scenemodel.json"]]) {
  test(`${id} exports multiple SceneModels without a DataModel or companion file`, async t => {
    const {service, state, data} = fixture(t), {files} = downloads(t);
    service.clearSelection("data"); service.selectAll("scene"); service.setDataSet(id); service.setBaseName("Scene only");
    for (const model of Object.values(data.models)) model.toParams = () => {throw Error("DataModels must not be read");};
    await service.exportSelected();
    assert.equal(state.errorText, ""); assert.equal(files.length, 1);
    assert.equal(files[0].filename, `Scene only.${extension}`);
    assert.equal(state.result.files.length, 1); assert.equal(state.result.scope.sceneModels, 2);
    assert.equal(state.result.scope.dataModels, 0); assert.match(state.statusText, /Generated 1 file\. Download started\./);
    assert.equal(files[0].blob.size > 0, true);
    if (id === "scene-json") assert.deepEqual(JSON.parse(await files[0].blob.text()).objects.map(o => o.id), ["wall-a", "wall-b"]);
    if (id === "glb") {
      const buffer = await files[0].blob.arrayBuffer();
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true))));
      for (const name of ["wall-a", "wall-b"]) assert.ok(json.nodes.some(node => node.name === name));
    }
  });
}
