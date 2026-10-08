const test = require("node:test"), assert = require("node:assert/strict");
require("tsx/cjs");
const {ViewHistoryService, withoutViewHistory} = require("../src/studio/services/ViewHistoryService.ts");
const {viewIsolation} = require("../src/studio/services/ViewIsolation.ts");
const {CommandRegistry} = require("../src/studio/commands/CommandRegistry.ts");
function fixture(t) {
  const emitter = () => {const listeners = new Set(); return {subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}, fire(...args) {for (const fn of listeners) fn(...args);}};};
  const events = Object.fromEntries(["Created", "Destroyed", "VisibleChanged", "StyleBinChanged"].map(name => ["onViewObject"+name, emitter()]));
  const view = {objects: {}, viewer: {events},
    setObjectsVisible(ids, value) {for (const id of ids) this.objects[id].visible = value;},
    setObjectsInStyleBin(bin, ids, value) {for (const id of ids) {
      const object = this.objects[id]; value ? object.bins.add(bin) : object.bins.delete(bin);
      events.onViewObjectStyleBinChanged.fire(view, {viewObject: object, styleBinId: bin, membership: value});
    }}
  };
  for (const id of ['wall', 'roof', 'slab']) {
    let visible = id !== 'roof';
    view.objects[id] = {id, bins: new Set(), hasStyleBin(bin) {return this.bins.has(bin);},
      get visible() {return visible;}, set visible(value) {visible = value; events.onViewObjectVisibleChanged.fire(view, this);}};
  }
  const state = {canUndo: false, canRedo: false, revision: 0}, commands = new CommandRegistry();
  const history = new ViewHistoryService(view, state, commands); t.after(() => history.destroy());
  return {view, state, history, events, commands, isolation: viewIsolation(view)};
}
const settle = () => new Promise(resolve => queueMicrotask(resolve));
test('bulk visibility is one undo step and restores originally hidden elements', async t => {
  const {view, state, history} = fixture(t);
  view.setObjectsVisible(['wall', 'roof', 'slab'], false); await settle();
  assert.equal(state.canUndo, true); history.undo();
  assert.deepEqual(Object.values(view.objects).map(o=>o.visible), [true, false, true]);
  assert.equal(state.canUndo, false); history.redo();
  assert.ok(Object.values(view.objects).every(o=>!o.visible));
});
test('isolate, re-isolate, undo and Restore retain the initial return point', async t => {
  const {view, history, isolation} = fixture(t);
  isolation.isolate(['wall'], 'Wall'); await settle();
  isolation.isolate(['roof'], 'Roof'); await settle();
  history.undo(); assert.equal(isolation.label, 'Wall'); assert.equal(view.objects.wall.visible, true);
  isolation.restore(); await settle();
  assert.deepEqual(Object.values(view.objects).map(o=>o.visible), [true, false, true]);
  history.undo(); assert.equal(isolation.label, 'Wall');
  history.undo(); assert.equal(isolation.label, '');
  assert.deepEqual(Object.values(view.objects).map(o=>o.visible), [true, false, true]);
});
test('selection is excluded; X-ray/highlight undo, branching clears redo, and disposed listeners stop', async t => {
  const {view, state, history} = fixture(t);
  view.setObjectsInStyleBin('selected', ['wall'], true); await settle(); assert.equal(state.canUndo, false);
  view.setObjectsInStyleBin('xrayed', ['wall'], true); await settle();
  history.undo(); assert.equal(view.objects.wall.hasStyleBin('xrayed'), false); assert.equal(view.objects.wall.hasStyleBin('selected'), true);
  view.setObjectsInStyleBin('highlighted', ['slab'], true); await settle(); assert.equal(state.canRedo, false);
  history.destroy(); const revision = state.revision; view.objects.wall.visible = false; await settle(); assert.equal(state.revision, revision);
});
test('command boundaries keep consecutive operations separate; plan transitions and model lifecycle invalidate history', async t => {
  const {view, state, history, commands, events} = fixture(t);
  commands.register({id:'hide',title:'Hide wall',run:()=>{view.objects.wall.visible=false;}});
  commands.register({id:'xray',title:'X-ray slab',run:()=>view.setObjectsInStyleBin('xrayed',['slab'],true)});
  commands.execute('hide'); commands.execute('xray'); history.undo();
  assert.equal(view.objects.wall.visible, false); assert.equal(state.undoLabel, 'Hide wall');
  withoutViewHistory(view, () => view.setObjectsVisible(['wall','slab'],true));
  assert.equal(state.canUndo, false); assert.equal(state.canRedo, false);
  commands.execute('hide'); events.onViewObjectDestroyed.fire(view, view.objects.wall); delete view.objects.wall;
  await settle(); assert.equal(state.canUndo, false);
});
