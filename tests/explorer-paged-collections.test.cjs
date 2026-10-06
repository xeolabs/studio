const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const stores = [
  ["data", "DataExplorerStore"], ["viewer", "ViewerExplorerStore"],
  ["ifc", "DataObjectTreeStore"], ["ifc", "DataObjectTypesStore"], ["ifc", "DataObjectStoreysStore"]
];
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: [
    'export {View} from "@xeokit/sdk/viewing/viewer";',
    'export {Scene} from "@xeokit/sdk/model/scene";',
    'export {revealTreePath} from "./studio/explorers/tree/revealTreePath";',
    ...stores.map(([folder, name]) => `export {${name}} from "./studio/explorers/${folder}/${name}";`)
  ].join("\n")},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Scene, View, revealTreePath} = output.exports;
global.requestAnimationFrame ??= callback => setTimeout(callback, 0);
global.cancelAnimationFrame ??= clearTimeout;
const tick = () => new Promise(resolve => queueMicrotask(resolve));

function events() {
  return new Proxy({}, {get(target, name) {
    return target[name] ||= {listeners: new Set(),
      subscribe(fn) {this.listeners.add(fn); return () => this.listeners.delete(fn);},
      fire(...args) {for (const fn of this.listeners) fn(...args);}};
  }});
}

function fixture(t, name, count = 100001) {
  const storey = {id: "storey:0", name: "Ground", type: "IfcBuildingStorey", related: {}, relating: {}, propertySets: []};
  const objects = {[storey.id]: storey}, walls = {}, relationships = [];
  const model = {id: "m:1", objects, rootObjects: {[storey.id]: storey},
    objectsByType: {IfcWall: walls, IfcBuildingStorey: {[storey.id]: storey}}, propertySets: {}, relationships};
  const data = {objects, models: {[model.id]: model}, rootObjects: model.rootObjects, events: events()};
  const scene = new Scene(); t.after(() => scene.destroy());
  const view = Object.create(View.prototype);
  const viewer = {id: "viewer", events: events(), viewList: [view], views: {view}, numViews: 1, scene};
  const viewObjects = {}, visible = {}, layer = {id: "default", view, objects: viewObjects};
  const disabled = new Proxy({}, {get: () => ({enabled: false})});
  const values = {id: "view", camera: {}, viewer, objects: viewObjects, visibleObjects: visible,
    colorizedObjects: {}, opacityObjects: {}, layers: {default: layer}, sectionPlanes: {}, transforms: {},
    lightsList: [], lights: disabled, effects: disabled, texturing: {enabled: false}, resolutionScale: {enabled: false},
    styleBins: {get: () => ({}), create() {}},
    setObjectsVisible(ids, active) {for (const id of ids) {
      viewObjects[id].visible = active;
      if (active) visible[id] = viewObjects[id]; else delete visible[id];
      viewer.events.onViewObjectVisibleChanged.fire(view, viewObjects[id]);
    }}};
  for (const [key, value] of Object.entries(values)) Object.defineProperty(view, key, {value});
  for (const [key, map] of Object.entries({numObjects: viewObjects, numVisibleObjects: visible,
    numColorizedObjects: view.colorizedObjects, numOpacityObjects: view.opacityObjects})) {
    Object.defineProperty(view, key, {get: () => Object.keys(map).length});
  }
  for (let i = 0; i < count; i++) {
    const id = `wall:${i}`;
    const object = {id, name: `Wall ${i}`, type: "IfcWall", related: {}, relating: {}, propertySets: []};
    walls[id] = objects[id] = object;
    relationships.push({type: "IfcRelContainedInSpatialStructure", relatingObject: storey, relatedObject: object});
    viewObjects[id] = visible[id] = {id, view, layer, visible: true, hasStyleBin: () => false};
  }
  storey.related.IfcRelContainedInSpatialStructure = relationships;
  const create = () => new output.exports[name]({data, scene, view, viewer});
  const store = create(); t.after(() => store.destroy());
  return {store, create, data, view, viewer, model, storey};
}

for (const [, name] of stores) test(`${name}: 100k collection is paged, searchable and restorable`, async t => {
  const f = fixture(t, name);
  const path = f.store.getObjectPath("wall:100000");
  assert.ok(path, "direct canonical lookup");
  const beforeSearch = f.store._nodes.size;
  let found;
  for (const entry of f.store.getSearchEntries()) if (entry.objectId === "wall:100000" || entry.id === "wall:100000") {found = entry; break;}
  assert.ok(found, "search includes objects never materialized");
  assert.equal(f.store._nodes.size, beforeSearch);
  const target = await revealTreePath(f.store, path);
  assert.ok(target);
  const folder = f.store.getNode(path.at(-2));
  assert.equal(folder.childCount, 100001);
  assert.equal(folder.pageIndex, 500);
  assert.equal(folder.children.length, 1);
  f.store.setPage(folder, 0);
  const bounded = f.store._nodes.size;
  assert.equal(folder.children.length, 200);
  assert.ok(bounded < 240, "only the displayed page and ancestor nodes exist");
  for (let i = 1; i < 5; i++) f.store.setPage(folder, i);
  assert.equal(f.store._nodes.size, bounded, "old page nodes are released");
  assert.equal(f.store.getNode(target.id), null);
  const states = f.store.captureBranchStates();
  const replacement = f.create(); t.after(() => replacement.destroy());
  replacement.restoreBranchStates(states);
  assert.equal(replacement.getNode(folder.id).pageIndex, 4);
  assert.equal(replacement.getNode(folder.id).children.length, 200);
});

for (const [, name] of stores.filter(([folder]) => folder === "ifc")) {
  test(`${name}: actions affect off-page objects and structure changes refresh pages`, async t => {
    const f = fixture(t, name, 401);
    const path = f.store.getObjectPath("wall:400");
    await revealTreePath(f.store, path);
    const folder = f.store.getNode(path.at(-2));
    f.store.setEffect(folder, "visible", false);
    assert.ok(Object.values(f.view.objects).every(object => !object.visible));
    f.store.setPage(folder, 0);
    assert.ok(folder.children.every(node => !node.effects.visible));
    f.store.setEffect(folder, "visible", true);
    assert.ok(Object.values(f.view.objects).every(object => object.visible));
    f.store.setPage(folder, 2);
    delete f.data.objects["wall:400"]; delete f.model.objectsByType.IfcWall["wall:400"];
    delete f.view.objects["wall:400"];
    f.storey.related.IfcRelContainedInSpatialStructure.pop();
    f.data.events.onDataObjectDestroyed.fire(f.data, {id: "wall:400"});
    await tick();
    assert.equal(folder.childCount, 400);
    assert.equal(folder.pageIndex, 1);
    assert.equal(f.store.getNode(path.at(-1)), null);
  });
}

test("Viewer filtered collections update membership after bulk visibility changes", async t => {
  const f = fixture(t, "ViewerExplorerStore", 401);
  const folder = [...f.store._nodes.values()].find(node => node.folderKind === "visibleObjects");
  await f.store.toggleExpanded(folder);
  f.store.setPage(folder, 2);
  f.view.setObjectsVisible(Object.keys(f.view.objects).slice(0, 201), false);
  await tick();
  assert.equal(folder.childCount, 200);
  assert.equal(folder.pageIndex, 0);
  assert.ok(folder.children.every(node => f.view.objects[node.componentId].visible));
});

test("IFC hierarchy refresh guards cyclic relationships and retains one-level default expansion", async t => {
  const f = fixture(t, "DataObjectTreeStore", 401);
  f.data.objects["wall:0"].related.IfcRelAggregates = [{relatedObject: f.storey}];
  f.data.events.onRelationshipCreated.fire();
  await tick();
  await f.store.expandToDepth(1);
  const root = f.store.state.roots[0];
  assert.equal(root.expanded, true);
  assert.equal(root.children.length, 200);
  assert.ok(root.children.every(node => !node.expanded));
  await f.store.toggleExpanded(f.store.getNode("wall:0"));
  f.data.events.onRelationshipCreated.fire();
  await tick();
  assert.ok(f.store._nodes.size < 210);
});
