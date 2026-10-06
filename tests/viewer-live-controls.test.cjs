const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const bundle = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), loader: "ts", contents: `
    export {ViewerExplorerStore} from "./studio/explorers/viewer/ViewerExplorerStore";
    export {observeVisibleControls} from "./studio/explorers/viewer/observeVisibleControls";
    export {createExplorerNumberInput} from "./studio/explorers/tree/ExplorerNumberInput";
    export {createExplorerTextInput} from "./studio/explorers/tree/ExplorerTextInput";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {ViewerExplorerStore, observeVisibleControls, createExplorerNumberInput, createExplorerTextInput} = output.exports;

test("sampling only refreshes changed displayed controls, not structure or search", () => {
  const effect = {id: "effect", kind: "effect", expanded: true, children: [], controlsRevision: 0};
  const hidden = {id: "hidden", kind: "effect", expanded: true, children: [], controlsRevision: 0};
  let value = 1, reads = 0;
  const store = {state: {revision: 10, roots: [effect, {kind: "folder", expanded: false, children: [hidden]}]},
    _controlValues: new Map(), viewer: {views: {}}, getNodeControls(node) {reads++; assert.equal(node, effect); return [{value}];}};
  const sample = () => ViewerExplorerStore.prototype.refreshDisplayedControls.call(store);
  sample(); sample(); assert.equal(effect.controlsRevision, 1);
  value = 2; sample(); assert.equal(effect.controlsRevision, 2);
  assert.equal(store.state.revision, 10); assert.equal(hidden.controlsRevision, 0);
  effect.expanded = false; sample(); assert.equal(reads, 3); assert.equal(store._controlValues.size, 0);
});

test("sampling stops for hidden panels, hidden pages, and destroyed explorers", t => {
  const previous = {document: global.document, IntersectionObserver: global.IntersectionObserver, MutationObserver: global.MutationObserver,
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout};
  t.after(() => Object.assign(global, previous));
  const timers = new Map(), events = new Map(); let next = 0, intersection, styleChanged, disconnected = false, samples = 0;
  global.setTimeout = cb => {timers.set(++next, cb); return next;};
  global.clearTimeout = id => timers.delete(id);
  global.document = {hidden: false, addEventListener: (name, cb) => events.set(name, cb), removeEventListener: name => events.delete(name)};
  global.IntersectionObserver = class {constructor(cb) {intersection = cb;} observe() {} disconnect() {disconnected = true;}};
  global.MutationObserver = class {constructor(cb) {styleChanged = cb;} observe() {} disconnect() {}};
  let cssVisible = true;
  const stop = observeVisibleControls({checkVisibility: () => cssVisible}, () => samples++);
  assert.equal(samples, 0);
  intersection([{isIntersecting: true}]); assert.equal(samples, 1); assert.equal(timers.size, 1);
  intersection([{isIntersecting: false}]); assert.equal(timers.size, 0);
  document.hidden = true; intersection([{isIntersecting: true}]); assert.equal(samples, 1);
  document.hidden = false; events.get("visibilitychange")(); assert.equal(samples, 2);
  cssVisible = false; styleChanged(); assert.equal(timers.size, 0);
  cssVisible = true; styleChanged(); assert.equal(samples, 3);
  stop(); assert.equal(timers.size, 0); assert.ok(disconnected); assert.equal(events.size, 0);
});

test("numeric drafts survive runtime changes; untouched focus never writes back stale values", () => {
  const component = createExplorerNumberInput(), commits = [];
  const field = {value: 10, draft: "10", dirty: false, editing: true, invalid: false, $emit: (_name, value) => commits.push(value)};
  component.watch.value.call(field, 20); assert.equal(field.draft, "20");
  component.methods.commit.call(field); assert.deepEqual(commits, []);
  field.dirty = true; field.draft = "-";
  component.watch.value.call(field, 30); assert.equal(field.draft, "-");
  component.methods.commit.call(field); assert.ok(field.invalid); assert.equal(commits.length, 0);
  field.value = 30; component.methods.reset.call(field); assert.equal(field.draft, "30"); assert.equal(field.dirty, false);
  field.dirty = true; field.draft = "42"; component.methods.commit.call(field);
  assert.deepEqual(commits, [42]); assert.equal(field.dirty, false);
});

test("text drafts remain editable during external changes and validate before committing", () => {
  const component = createExplorerTextInput(), commits = [];
  const field = {value: "#ffffff", draft: "#", dirty: true, validate: text => /^#[0-9a-f]{6}$/.test(text), $emit: (_name, value) => commits.push(value)};
  component.watch.value.call(field, "#000000"); assert.equal(field.draft, "#");
  component.methods.commit.call(field); assert.ok(field.invalid); assert.equal(commits.length, 0);
  field.draft = "#123456"; component.methods.commit.call(field); assert.deepEqual(commits, ["#123456"]);
  component.watch.value.call(field, "#000000"); assert.equal(field.draft, "#000000");
});
