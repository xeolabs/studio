const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export {Data} from "@xeokit/sdk/model/data";
    export {Scene} from "@xeokit/sdk/model/scene";
    export {TrianglesPrimitive} from "@xeokit/sdk/base/constants";
    export {LoadedModelsService} from "./studio/services/LoadedModelsService";
    export {viewIsolation} from "./studio/services/ViewIsolation";
    export {CommandRegistry} from "./studio/commands/CommandRegistry";
    export {registerModelCommands} from "./studio/commands/registerModelCommands";
    export {explorerContextMenuItems} from "./studio/context-menu/explorerMenuItems";
  `}, alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Scene, Data, TrianglesPrimitive, LoadedModelsService, viewIsolation, CommandRegistry,
  registerModelCommands, explorerContextMenuItems} = output.exports;
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};

function fixture(t, initialModels = []) {
  const scene = new Scene(), data = new Data(), state = {loadedModels: []}, unloaded = [];
  const view = {objects: {}, needsRender() {}, setObjectsVisible(ids, visible) {
    for (const id of ids) if (this.objects[id]) this.objects[id].visible = visible;
  }};
  const stop = scene.events.onSceneObjectDestroyed.subscribe((_scene, object) => {delete view.objects[object.id];});
  const selection = {selectedSceneObjectId: null, clear() {this.selectedSceneObjectId = null;},
    selectSceneObject(id) {this.selectedSceneObjectId = scene.objects[id] ? id : null;}};
  const section = {refreshes: 0, clears: 0, refresh() {this.refreshes++;}, clear() {this.clears++;}};
  let busy = false;
  const service = new LoadedModelsService({scene, data, view, state, selection, section, initialModels,
    isBusy: () => busy, onUnloaded: model => unloaded.push(model.id)});
  const geometry = (id, objectId = id + '-object') => {
    const model = ok(scene.createModel({id}));
    ok(model.createGeometry({id: 'g', primitive: TrianglesPrimitive, positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2]}));
    ok(model.createMesh({id: 'm', geometryId: 'g'}));
    ok(model.createObject({id: objectId, meshIds: ['m']}));
    view.objects[objectId] = {visible: true};
    return model;
  };
  const metadata = (id, objectId = id + '-object') => {
    const model = ok(data.createModel({id}));
    ok(model.createObject({id: objectId, type: 'IfcWall', name: objectId}));
    return model;
  };
  t.after(() => {service.destroy(); stop(); scene.destroy(); data.destroy();});
  return {scene, data, view, state, selection, section, service, geometry, metadata, unloaded,
    setBusy: value => {busy = value;}};
}

test('unload removes both parts of the bundled model and clears its selection and cut', async t => {
  const f = fixture(t, [{id: 'duplex', title: 'Duplex', sceneModelId: 'geometry', dataModelId: 'semantics'}]);
  const sm = f.geometry('geometry', 'wall'), dm = f.metadata('semantics', 'wall');
  await Promise.resolve();
  assert.equal(f.state.loadedModels.length, 1);
  f.selection.selectedSceneObjectId = 'wall';
  f.service.unload({source: 'data', modelId: 'semantics'});
  assert.ok(sm.destroyed && dm.destroyed);
  assert.equal(f.selection.selectedSceneObjectId, null);
  assert.equal(f.section.clears, 1);
  assert.deepEqual(Object.keys(f.scene.objects), []);
  assert.deepEqual(Object.keys(f.view.objects), []);
  assert.deepEqual(Object.keys(f.data.objects), []);
  assert.deepEqual(f.state.loadedModels, []);
  assert.deepEqual(f.unloaded, ['duplex']);
});

test('unload pairs imported geometry and data while preserving other models and their selection', async t => {
  const f = fixture(t);
  const sm = f.geometry('first'), dm = f.metadata('first');
  const other = f.geometry('second'); f.metadata('second');
  await Promise.resolve();
  f.selection.selectedSceneObjectId = 'second-object';
  f.service.unload('model:first');
  assert.ok(sm.destroyed && dm.destroyed);
  assert.equal(other.destroyed, false);
  assert.deepEqual(f.state.loadedModels.map(m => m.id), ['model:second']);
  assert.equal(f.selection.selectedSceneObjectId, 'second-object');
  assert.equal(f.view.objects['second-object'].visible, true);
  assert.equal(f.section.clears, 0);
});

test('geometry-only and data-only models can be unloaded independently', async t => {
  const f = fixture(t);
  f.geometry('geometry'); f.metadata('metadata');
  await Promise.resolve();
  f.service.unload({source: 'scene', modelId: 'geometry'});
  assert.ok(f.data.models.metadata);
  f.service.unload({source: 'data', modelId: 'metadata'});
  assert.equal(f.state.loadedModels.length, 0);
  // Repeated and stale actions are harmless.
  f.service.unload('model:geometry');
  assert.equal(f.unloaded.length, 2);
});

test('shared semantic objects retain their other model ownership', async t => {
  const f = fixture(t);
  f.metadata('first', 'shared');
  const other = f.metadata('second', 'shared');
  await Promise.resolve();
  f.service.unload('model:first');
  assert.ok(f.data.objects.shared);
  assert.deepEqual(f.data.objects.shared.models, [other]);
  assert.equal(f.data.objects.shared, other.objects.shared);
});

test('unloading an isolated model restores surviving objects', async t => {
  const f = fixture(t);
  f.geometry('first'); f.geometry('second');
  await Promise.resolve();
  viewIsolation(f.view).isolate(['first-object'], 'First');
  assert.equal(f.view.objects['second-object'].visible, false);
  f.service.unload('model:first');
  assert.equal(f.view.objects['second-object'].visible, true);
  assert.equal(viewIsolation(f.view).label, '');
});

test('command and both context menus route the correct model and disable unloading while busy', async t => {
  const f = fixture(t);
  f.geometry('first'); f.metadata('first');
  await Promise.resolve();
  const commands = new CommandRegistry(); registerModelCommands(commands, f.service, async () => true);
  const params = {commands, sceneTree: {store: {}}, dataExplorer: {store: {}}, selectionService: {}};
  const node = {kind: 'model', modelId: 'first'};
  f.setBusy(true);
  for (const source of ['scene', 'data']) {
    const item = explorerContextMenuItems(params, source, node).find(item => item.id === 'unload-model');
    assert.equal(item.enabled, false);
    await item.action();
    assert.ok(f.scene.models.first);
  }
  f.setBusy(false);
  assert.equal(commands.isEnabled('model.unload'), false);
  assert.equal(commands.isEnabled('model.unload', {source: 'scene', modelId: 'first'}), true);
  const item = explorerContextMenuItems(params, 'data', node).find(item => item.id === 'unload-model');
  await item.action();
  assert.equal(f.state.loadedModels.length, 0);
  assert.equal(commands.isEnabled('model.unload', 'model:first'), false);
  f.service.destroy(); f.geometry('later');
  await Promise.resolve();
  assert.equal(f.state.loadedModels.length, 0);
});

test('unload waits for confirmation, suppresses duplicate prompts, and preserves models on cancel', async t => {
  const f = fixture(t, [{id: 'first', title: 'First building', sceneModelId: 'first'}]);
  const first = f.geometry('first'), second = f.geometry('second');
  await Promise.resolve();
  const commands = new CommandRegistry(), prompts = [];
  let respond;
  registerModelCommands(commands, f.service, model => {
    prompts.push(model.title);
    return new Promise(resolve => {respond = resolve;});
  });
  const run = commands.get('model.unload').run;
  const cancelled = run({source: 'scene', modelId: 'first'});
  assert.equal(first.destroyed, false);
  assert.equal(commands.isEnabled('model.unload', 'first'), false);
  await run('first');
  assert.deepEqual(prompts, ['First building']);
  respond(false);
  await cancelled;
  assert.equal(first.destroyed, false);
  assert.equal(second.destroyed, false);
  assert.equal(commands.isEnabled('model.unload', 'first'), true);
  const confirmed = run('first');
  respond(true);
  await confirmed;
  assert.equal(first.destroyed, true);
  assert.equal(second.destroyed, false);
});

test('unload rechecks whether the app is busy after confirmation', async t => {
  const f = fixture(t);
  const model = f.geometry('first');
  await Promise.resolve();
  const commands = new CommandRegistry();
  let respond;
  registerModelCommands(commands, f.service, () => new Promise(resolve => {respond = resolve;}));
  const pending = commands.get('model.unload').run('model:first');
  f.setBusy(true);
  respond(true);
  await pending;
  assert.equal(model.destroyed, false);
  f.setBusy(false);
  assert.equal(commands.isEnabled('model.unload', 'model:first'), true);
});
