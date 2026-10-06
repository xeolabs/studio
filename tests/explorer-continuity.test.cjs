const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const bundle = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), loader: "ts", contents: `
    export {ExplorerSessions} from "./studio/explorers/ExplorerSessions";
    export {ExplorerExpansionState} from "./studio/explorers/ExplorerExpansionState";
    export {bindExplorerSession} from "./studio/explorers/bindExplorerSession";
    export {ExplorerHostController} from "./studio/explorers/ExplorerHostController";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {ExplorerSessions, ExplorerExpansionState, bindExplorerSession, ExplorerHostController} = output.exports;
const node = (id, children = []) => ({id, hasChildren: true, expanded: false, loading: false, children});
function fixture() {
  const a = node("a"), b = node("b"), c = node("c");
  const calls = [];
  const children = {a: [b], b: [c], c: []};
  const store = {state: {roots: [a]}, async toggleExpanded(n) {
    calls.push(n.id); n.expanded = !n.expanded;
    if (n.expanded) n.children = children[n.id];
  }};
  return {a, b, c, calls, store};
}

test("explorers retain separate UI-only sessions including search and pagination", () => {
  const sessions = new ExplorerSessions();
  const scene = sessions.get("scene");
  Object.assign(scene.search, {query: "wall", limit: 200, browsing: true, scrollTop: 80});
  scene.focusedNodeId = "wall:1"; scene.scrollTop = 240;
  assert.equal(sessions.get("scene"), scene);
  assert.equal(sessions.get("data").search.query, "");
  assert.equal(sessions.get("scene").search.limit, 200);
});

test("restoration reopens saved branches and defers descendants of a collapsed branch", async () => {
  const {store, a, b, c, calls} = fixture();
  const branches = new Map([["a", true], ["b", false], ["c", true]]);
  const memory = new ExplorerExpansionState(branches);
  await memory.restore(store, () => true);
  assert.equal(a.expanded, true); assert.equal(b.expanded, false);
  assert.deepEqual(b.children, []); assert.deepEqual(calls, ["a"]);
  await store.toggleExpanded(b);
  await memory.restore(store, () => true);
  assert.equal(c.expanded, true);
  await store.toggleExpanded(c);
  await memory.restore(store, () => true);
  assert.equal(c.expanded, false, "restoration must not undo subsequent user actions");
  memory.capture(store);
  assert.equal(branches.get("c"), false);
});

test("saved collapsed roots override defaults without destroying deferred state", async () => {
  const {store, a} = fixture(); a.expanded = true;
  const branches = new Map([["a", false], ["b", true], ["removed", true]]);
  const memory = new ExplorerExpansionState(branches);
  await memory.restore(store, () => true);
  assert.equal(a.expanded, false);
  memory.capture(store);
  assert.equal(branches.get("b"), true);
});

test("interrupted restoration stops before another branch is created", async () => {
  const {store, calls} = fixture(); let current = true;
  const toggle = store.toggleExpanded;
  store.toggleExpanded = async n => {await toggle(n); current = false;};
  await new ExplorerExpansionState(new Map([["a", true], ["b", true]])).restore(store, () => current);
  assert.deepEqual(calls, ["a"]);
});

test("cyclic instances cannot cause unbounded restore or capture", async () => {
  const a = node("a"); a.children = [a];
  const branches = new Map([["a", true]]);
  const memory = new ExplorerExpansionState(branches);
  let calls = 0;
  const store = {state: {roots: [a]}, async toggleExpanded(n) {calls++; n.expanded = !n.expanded;}};
  await memory.restore(store, () => true); memory.capture(store);
  assert.equal(calls, 1); assert.equal(branches.size, 1);
});

test("scroll and focus restore after layout; observers and subscriptions are removed", async t => {
  const old = global.ResizeObserver; let resize, disconnected = false, unwatched = false;
  global.ResizeObserver = class {constructor(cb) {resize = cb;} observe() {} disconnect() {disconnected = true;}};
  t.after(() => {global.ResizeObserver = old;});
  const session = new ExplorerSessions().get("data"); session.scrollTop = 200; session.focusedNodeId = "b";
  const root = {clientHeight: 0, scrollTop: 0, scrollLeft: 0};
  const listeners = new Map();
  const container = {querySelector: () => root, addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name)};
  const binding = bindExplorerSession(container, {state: {roots: []}}, session, () => () => {unwatched = true;}, async () => {});
  await binding.ready; assert.equal(root.scrollTop, 0);
  root.clientHeight = 400; resize(); assert.equal(root.scrollTop, 200);
  root.scrollTop = 220; listeners.get("scroll")({target: root}); assert.equal(session.scrollTop, 220);
  listeners.get("focusin")({target: {closest: () => ({dataset: {nodeId: "c"}})}});
  assert.equal(session.focusedNodeId, "c");
  binding.dispose(); assert.ok(disconnected && unwatched); assert.equal(listeners.size, 0);
});

test("renderer changes update the future mount even while Viewer Explorer is closed", () => {
  const host = new ExplorerHostController({actions: {}, workspace: {}});
  host.runtime = {renderer: {old: true}, rendererLabel: "old"};
  const renderer = {current: true};
  host.setRenderer(renderer, "WebGLRenderer");
  assert.equal(host.runtime.renderer, renderer);
  assert.equal(host.runtime.rendererLabel, "WebGLRenderer");
  let received;
  host.viewerExplorer = {store: {setRenderer: (...args) => {received = args;}}};
  host.setRenderer(renderer, "WebGLRenderer");
  assert.deepEqual(received, [renderer, "WebGLRenderer"]);
});
