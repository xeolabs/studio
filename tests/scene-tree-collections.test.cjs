const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export {View} from "@xeokit/sdk/viewing/viewer";
    export {Scene} from "@xeokit/sdk/model/scene";
    export {SceneTreeStore} from "./studio/explorers/scene/SceneTreeStore";
    export {pagedTreeRows as sceneTreeRows} from "./studio/explorers/tree/pagedTreeRows";
    export {revealTreePath} from "./studio/explorers/tree/revealTreePath";
    export {treeSearchEntries} from "./studio/explorers/tree/treeSearchEntries";
    export * from "./studio/explorers/tree/virtualTreeRange";
    export * from "./studio/explorers/tree/PagedTreeCollection";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Scene, View, SceneTreeStore, revealTreePath, sceneTreeRows, treeSearchEntries, treeRowOffsets, virtualTreeRange, clampTreePage} = output.exports;
global.requestAnimationFrame ??= callback => setTimeout(callback, 0);
global.cancelAnimationFrame ??= clearTimeout;

function events() {
  return new Proxy({}, {get(target, name) {
    return target[name] ||= {listeners: new Set(),
      subscribe(fn) {this.listeners.add(fn); return () => this.listeners.delete(fn);},
      fire(...args) {for (const fn of this.listeners) fn(...args);}};
  }});
}

function fixture(t, count = 100001) {
  const model = {id: "m:1", objects: {}, meshes: {}, geometries: {}, transforms: {}, materials: {}, textures: {}, animations: {},
    stats: {numObjects: count, numMeshes: 0, numGeometries: 0, numTransforms: 0, numMaterials: 0, numTextures: 0},
    coordinateSystem: {basis: [1, 0, 0, 0, 0, 1, 0, -1, 0]}};
  for (let i = 0; i < count; i++) model.objects[`object:${i}`] = {id: `object:${i}`, meshes: []};
  const scene = {models: {[model.id]: model}, events: events()};
  const view = Object.create(View.prototype);
  const cameraScene = new Scene(); t.after(() => cameraScene.destroy());
  const viewer = {events: events(), viewList: [view], scene: cameraScene};
  Object.defineProperties(view, {camera: {value: {}}, objects: {value: {}}, viewer: {value: viewer},
    setObjectsVisible: {value(ids, visible) { for (const id of ids) this.objects[id].visible = visible; }}});
  let reactive = 0;
  const store = new SceneTreeStore({scene, viewer, makeReactive(value) { reactive++; return value; }});
  t.after(() => store.destroy());
  let descriptions = 0;
  const describe = store._folderItemSpec.bind(store);
  store._folderItemSpec = (...args) => { descriptions++; return describe(...args); };
  return {store, scene, model, view, viewer, get reactive() { return reactive; }, get descriptions() { return descriptions; },
    folder(kind = "objects") { return store.getNode(`folder:${model.id}:${kind}`); }};
}

test("100k objects open as one bounded page, not 100k reactive descriptors", async t => {
  const f = fixture(t);
  assert.equal(f.store._collections.size, 0, "closed folders must not be enumerated");
  assert.equal(f.reactive, 10, "state, root, model and seven folders only");
  await f.store.toggleExpanded(f.folder());
  assert.equal(f.folder().childCount, 100001);
  assert.equal(f.folder().children.length, 200);
  assert.equal(f.descriptions, 200);
  assert.equal(f.store._nodes.size, 209);
  const index = f.store._collections.get(f.folder().id);
  for (let page = 1; page < 12; page++) f.store.setPage(f.folder(), page);
  assert.equal(f.store._nodes.size, 209, "visited pages do not accumulate row objects");
  assert.equal(f.store._collections.get(f.folder().id), index, "reuse sorted ID index across pages");
  f.store.setPage(f.folder(), 500);
  assert.equal(f.folder().children.length, 1);
  assert.equal(f.folder().children[0].objectId, "object:100000");
});

test("search streams all objects, and reveals an off-page ID directly", async t => {
  const f = fixture(t);
  let target;
  const before = f.reactive;
  const iterator = f.store.getSearchEntries();
  for (let i = 0; i < 12; i++) iterator.next();
  assert.ok(f.descriptions < 12, "search does not eagerly describe all collection entries");
  for (const entry of iterator) if (entry.objectId === "object:99999") { target = entry; break; }
  assert.equal(f.reactive, before);
  assert.equal(f.store._collections.size, 0, "search does not sort or open folders");
  assert.deepEqual(f.store.getObjectPath("object:99999"), target.path);
  assert.equal(f.store.getObjectPath("missing"), null);
  const node = await revealTreePath(f.store, target.path);
  assert.equal(node.objectId, "object:99999");
  assert.equal(f.folder().pageIndex, 499);
  assert.equal(f.store._nodes.size, 209);
  assert.equal(await revealTreePath(f.store, [...target.path.slice(0, -1), "removed"]), null);
});

test("expanded descendants and collection pages survive eviction and store recreation", async t => {
  const f = fixture(t, 450);
  f.model.meshes.mesh = {id: "mesh", geometry: {id: "geometry"}};
  f.model.objects["object:0"].meshes = [f.model.meshes.mesh];
  await f.store.toggleExpanded(f.folder());
  const object = f.folder().children[0];
  await f.store.toggleExpanded(object);
  const childId = object.children[0].id;
  f.store.setPage(f.folder(), 1);
  assert.equal(f.store.getNode(object.id), null);
  assert.equal(f.store.getNode(childId), null);
  f.store.setPage(f.folder(), 0);
  assert.equal(f.store.getNode(object.id).expanded, true);
  assert.equal(f.store.getNode(childId).componentId, "mesh");
  f.store.setPage(f.folder(), 1);
  const saved = f.store.captureBranchStates();
  const replacement = new SceneTreeStore({scene: f.scene, viewer: f.viewer}); t.after(() => replacement.destroy());
  replacement.restoreBranchStates(saved);
  const folder = replacement.getNode(f.folder().id);
  assert.equal(folder.expanded, true);
  assert.equal(folder.pageIndex, 1);
  replacement.setPage(folder, 0);
  assert.equal(replacement.getNode(object.id).expanded, true);
});

test("all Scene resource folders page consistently and canonical references reveal any page", async t => {
  const f = fixture(t, 0);
  const resources = {meshes: "mesh", geometries: "geometry", materials: "material", textures: "texture", transforms: "transform", animations: "animation"};
  for (const kind of Object.keys(resources)) for (let i = 0; i < 451; i++) {
    f.model[kind][`id:${i}`] = {id: `id:${i}`, childTransforms: [], childMeshes: [], channels: [], startTime: 0, endTime: 1};
  }
  Object.assign(f.model.stats, {numMeshes: 451, numGeometries: 451, numMaterials: 451, numTextures: 451, numTransforms: 451});
  f.scene.events.onSceneModelBuildFinished.fire(f.scene, f.model);
  await new Promise(resolve => queueMicrotask(resolve));
  f.store._revealNode = async () => {};
  for (const [kind, resourceKind] of Object.entries(resources)) {
    const canonicalNodeId = `${resourceKind}:m:1:id:450:in:folder:m:1:${kind}`;
    await f.store.revealReferencedResource({kind: "resourceRef", modelId: "m:1", resourceKind, componentId: "id:450", canonicalNodeId});
    assert.equal(f.folder(kind).pageIndex, 2, kind);
    assert.equal(f.folder(kind).children.length, 51, kind);
    assert.ok(f.store.getNode(canonicalNodeId), kind);
  }
});

test("structural changes clamp pages, invalidate relevant indices, and leave closed folders lazy", async t => {
  const f = fixture(t, 401);
  await f.store.toggleExpanded(f.folder());
  f.store.setPage(f.folder(), 2);
  const removedId = f.folder().children[0].id;
  delete f.model.objects["object:400"]; f.model.stats.numObjects--;
  f.scene.events.onSceneObjectDestroyed.fire(f.scene, {id: "object:400"});
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(f.folder().childCount, 400);
  assert.equal(f.folder().pageIndex, 1);
  assert.equal(f.store.getNode(removedId), null);
  const index = f.store._collections.get(f.folder().id);
  f.model.geometries.g = {id: "g"}; f.model.stats.numGeometries++;
  f.scene.events.onSceneGeometryCreated.fire(f.scene, f.model.geometries.g);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(f.store._collections.get(f.folder().id), index);
  assert.equal(f.folder("geometries").childrenLoaded, false);
  assert.equal(f.store._collections.size, 1);
});

test("model-wide visibility still affects off-page objects", async t => {
  const f = fixture(t, 401);
  for (const id in f.model.objects) f.view.objects[id] = {visible: true};
  await f.store.toggleExpanded(f.folder());
  f.store.toggleModelVisibility(f.store.getNode("model:m:1"));
  assert.ok(Object.values(f.view.objects).every(object => !object.visible));
  f.store.setPage(f.folder(), 2);
  assert.equal(f.folder().children[0].visible, false);
});

test("virtual range bounds mounting and supports variable-height controls", () => {
  const rows = Array.from({length: 100000}, (_, i) => ({id: String(i)}));
  const offsets = treeRowOffsets(rows, new Map([["0", 100]]), 32);
  assert.equal(offsets[1], 100);
  for (const top of [0, 100000, offsets.at(-1) - 600]) {
    const range = virtualTreeRange(offsets, top, 600);
    assert.ok(range.end - range.start < 35);
    assert.equal(range.before + offsets[range.end] - offsets[range.start] + range.after, offsets.at(-1));
  }
  assert.deepEqual(virtualTreeRange([0], 0, 600), {start: 0, end: 0, before: 0, after: 0});
  assert.equal(clampTreePage(Infinity, 401, 200), 0);
  assert.equal(clampTreePage(100, 401, 200), 2);
});

test("streaming traversal retains ordering, context and cyclic guards", () => {
  const root = {id: "root", title: "Scene", kind: "scene"};
  const object = {id: "node", componentId: "wall", title: "SceneObject", kind: "object"};
  function* children(node) { if (node === root) { yield object; yield root; } }
  const entries = [...treeSearchEntries([root], children, () => true)];
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1].path, ["root", "node"]);
  assert.equal(entries[1].context, "Scene");
  const node = {id: "n", depth: 0, expanded: true, children: [], childCount: 300}; node.children.push(node);
  assert.equal(sceneTreeRows([node], 200).length, 3);
});

test("destroy during deferred expansion prevents further node creation", async t => {
  const f = fixture(t, 401);
  const opening = f.store.toggleExpanded(f.folder());
  f.store.destroy();
  await opening;
  assert.equal(f.store._nodes.size, 0);
  assert.equal(f.store._collections.size, 0);
});
