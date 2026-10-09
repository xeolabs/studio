const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const sources = [
  ["data", "DataExplorerStore"], ["scene", "SceneTreeStore"],
  ["viewer", "ViewerExplorerStore"], ["ifc", "DataObjectTreeStore"],
  ["ifc", "DataObjectTypesStore"], ["ifc", "DataObjectStoreysStore"]
];
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: [
    'export {explorerRowsChanged} from "./studio/explorers/explorerRowMutations";',
    'export {ExplorerRefreshQueue} from "./studio/explorers/tree/ExplorerRefreshQueue";',
    'export {displayedTreeNodes} from "./studio/explorers/tree/displayedTreeNodes";',
    ...sources.map(([folder, name]) => `export {${name}} from "./studio/explorers/${folder}/${name}";`)
  ].join("\n")},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {ExplorerRefreshQueue, displayedTreeNodes, DataExplorerStore, ViewerExplorerStore} = output.exports;
const tick = () => new Promise(resolve => queueMicrotask(resolve));

test("refresh bursts collapse into one final-state update; structure takes precedence", async () => {
  const calls = [];
  const queue = new ExplorerRefreshQueue({state: () => calls.push("state"), structure: () => calls.push("structure")});
  for (let i = 0; i < 1000; i++) queue.request("state");
  assert.deepEqual(calls, []);
  await tick(); assert.deepEqual(calls, ["state"]);
  queue.request("state"); queue.request("structure"); queue.request("state");
  await tick(); assert.deepEqual(calls, ["state", "structure"]);
  queue.request("state"); queue.dispose(); queue.request("structure");
  await tick(); assert.deepEqual(calls, ["state", "structure"]);
});

function events() {
  return new Proxy({}, {get(target, name) {
    return target[name] ||= {listeners: new Set(),
      subscribe(fn) {this.listeners.add(fn); return () => this.listeners.delete(fn);},
      fire(...args) {for (const fn of this.listeners) fn(...args);}};
  }});
}

for (const [, name] of sources) test(`${name} batches real subscription callbacks across bulk visibility events`, async () => {
  const store = Object.create(output.exports[name].prototype);
  const view = {objects: {}, viewer: {events: events()}};
  let state = 0, structure = 0;
  Object.assign(store, {view, viewer: view.viewer, data: {events: events()}, scene: {events: events()},
    _unsubscribers: [], _nodes: new Map(), _collections: new Map(), _filteredDirty: new Set(), _applyingVisibility: 0, _applyingTreeEffect: 0,
    _invalidateHierarchyCaches() {}, _invalidateViewObjectCaches() {},
    _refreshQueue: new ExplorerRefreshQueue({state: () => state++, structure: () => structure++})});
  store._subscribe();
  for (let i = 0; i < 2000; i++) view.viewer.events.onViewObjectVisibleChanged.fire(view);
  assert.equal(state, 0); await tick(); assert.equal(state, 1);
  const source = name === "SceneTreeStore" ? store.scene : name === "ViewerExplorerStore" ? store.viewer : store.data;
  const event = name === "SceneTreeStore" ? "onSceneObjectCreated" : name === "ViewerExplorerStore" ? "onViewObjectCreated" : "onDataObjectCreated";
  for (let i = 0; i < 1000; i++) source.events[event].fire(view);
  view.viewer.events.onViewObjectVisibleChanged.fire(view);
  await tick(); assert.equal(structure, 1); assert.equal(state, 1);
  store._refreshQueue.dispose(); store._unsubscribers.forEach(unsubscribe => unsubscribe());
  view.viewer.events.onViewObjectVisibleChanged.fire(view);
  await tick(); assert.equal(state, 1);
});

test("display traversal ignores cached collapsed descendants and guards repeated nodes", () => {
  const child = {expanded: true, children: []};
  const root = {expanded: false, children: [child]}; child.children.push(root);
  assert.deepEqual([...displayedTreeNodes([root])], [root]);
  root.expanded = true;
  assert.deepEqual([...displayedTreeNodes([root])], [root, child]);
});

test("one-level IFC expansion opens roots but leaves their children collapsed and lazy", async t => {
  const previous = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 0;};
  t.after(() => {global.requestAnimationFrame = previous;});
  const child = {id: "child", hasChildren: true, expanded: false, childrenLoaded: false, children: []};
  const root = {id: "root", hasChildren: true, expanded: false, childrenLoaded: false, children: []};
  const store = Object.create(output.exports.DataObjectTreeStore.prototype);
  const loaded = [];
  Object.assign(store, {state: {roots: [root], busy: false}, _nodes: new Map([[root.id, root], [child.id, child]]),
    _touch() {}, _syncDisplayedMaterializedEffectStates() {},
    _loadChildren(node) {loaded.push(node.id); node.children = [child]; node.childrenLoaded = true;}});
  await store.expandToDepth(1);
  assert.equal(root.expanded, true);
  assert.equal(child.expanded, false);
  assert.equal(child.childrenLoaded, false);
  assert.deepEqual(loaded, ["root"]);
  assert.equal(store.state.busy, false);
});

test("collapsed Data branches keep aggregate counts current and refresh rows on reopen", async () => {
  const child = {id: "object", kind: "object", componentId: "wall", children: [], expanded: false, visible: true};
  const model = {id: "model", kind: "model", modelId: "m", children: [child], hasChildren: true, childrenLoaded: true, expanded: false};
  const store = Object.create(DataExplorerStore.prototype);
  Object.assign(store, {state: {roots: [model], revision: 5},
    view: {objects: {wall: {visible: false}}}, data: {models: {m: {objects: {wall: {}}}}}});
  store._syncAllObjectNodes();
  assert.equal(model.visibleCount, 0); assert.equal(child.visible, true);
  assert.equal(store.state.revision, 5, "visibility must not invalidate structure/search");
  await store.toggleExpanded(model);
  assert.equal(child.visible, false);
});

test("Viewer state changes update object fields without rebuilding branches", () => {
  const object = {id: "wall", kind: "object", viewId: "view", componentId: "wall", children: [], expanded: false};
  const store = Object.create(ViewerExplorerStore.prototype);
  Object.assign(store, {_filteredDirty: new Set(), state: {roots: [object], revision: 8}, viewer: {views: {view: {objects: {
    wall: {id: "wall", visible: false, hasStyleBin: style => style === "xrayed", layer: {id: "default"}, view: {id: "view"}}
  }}}}});
  store._syncDisplayedObjectNodes();
  assert.equal(object.visible, false); assert.equal(store.state.revision, 8);
  assert.deepEqual(object.effects, {visible: false, selected: false, highlighted: false, xrayed: true});
  assert.deepEqual(object.children, []);
});

test("tree DOM observers ignore icon/field/text updates but detect added or removed rows", t => {
  const previous = global.Element;
  global.Element = class {
    constructor(row = false, children = false) {this.row = row; this.children = children;}
    matches() {return this.row;}
    querySelector() {return this.children ? {} : null;}
  };
  t.after(() => {global.Element = previous;});
  const changed = output.exports.explorerRowsChanged;
  const mutation = (addedNodes, removedNodes = []) => [{type: "childList", addedNodes, removedNodes}];
  assert.equal(changed(mutation([new Element(), {nodeType: 3}])), false);
  assert.equal(changed(mutation([new Element(true)])), true);
  assert.equal(changed(mutation([new Element(false, true)])), true);
  assert.equal(changed(mutation([], [new Element(true)])), true);
  assert.equal(changed([{type: "characterData"}]), false);
});
