const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export {Scene} from "@xeokit/sdk/model/scene";
    export {TrianglesPrimitive} from "@xeokit/sdk/base/constants";
    export * from "./studio/services/AabbService";
    export * from "./studio/services/TilesService";
    export * from "./studio/services/ObjectSelectionDetails";
    export * from "./studio/ui/minimapProjection";
    export * from "./studio/ui/minimapSvg";
    export * from "./studio/ui/observePanelActivity";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Scene, TrianglesPrimitive, AabbService, createAabbPanelState, TilesService, createTilesPanelState,
  ObjectSelectionDetailsResolver, observePanelActivity, createAabbMinimapProjection, createTileMinimapProjection,
  renderAabbProjectionSvg, renderTileProjectionSvg, renderMinimapCameraSvg} = output.exports;

function event() {
  const listeners = new Set();
  return {subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispatch(...args) { for (const fn of listeners) fn(...args); }, get count() { return listeners.size; }};
}

function frames(t) {
  const callbacks = new Map();
  let next = 0;
  t.mock.method(globalThis, "requestAnimationFrame", fn => { callbacks.set(++next, fn); return next; });
  t.mock.method(globalThis, "cancelAnimationFrame", id => callbacks.delete(id));
  return {get count() { return callbacks.size; }, flush() {
    const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn(0));
  }};
}
globalThis.requestAnimationFrame ??= () => { throw new Error("Unexpected animation frame"); };
globalThis.cancelAnimationFrame ??= () => {};

function fixture(t) {
  const clock = frames(t), scene = new Scene();
  const model = scene.createModel({id: "model"}).value;
  model.createGeometry({id: "geometry", primitive: TrianglesPrimitive, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]});
  const addObject = id => {
    model.createMesh({id: `mesh-${id}`, geometryId: "geometry"});
    model.createObject({id, meshIds: [`mesh-${id}`]});
  };
  addObject("a");
  const camera = event();
  const view = {camera: {eye: [2, 3, 4], look: [0, 0, 0]}, viewer: {events: {onCameraViewMatrixUpdated: camera}}};
  t.after(() => scene.destroy());
  return {clock, scene, model, view, camera, addObject};
}

test("camera movement never rebuilds boundaries; hidden panels schedule no work", t => {
  const {clock, scene, view, camera} = fixture(t), state = createAabbPanelState();
  let titles = 0;
  const service = new AabbService({scene, view, state, resolveTitle: object => { titles++; return object.id; }});
  t.after(() => service.destroy());
  const objects = state.objects, projections = state.projectionViews, initialTitles = titles;
  view.camera.eye = [4, 5, 6];
  camera.dispatch(view); assert.equal(clock.count, 0);
  service.setActive(true); clock.flush();
  for (let i = 0; i < 100; i++) { view.camera.eye = [i, 5, 6]; camera.dispatch(view); clock.flush(); }
  assert.equal(titles, initialTitles);
  assert.equal(state.objects, objects); assert.equal(state.projectionViews, projections);
  assert.deepEqual(state.cameraEye, [99, 5, 6]);
  camera.dispatch({}); assert.equal(clock.count, 0, "other Views are ignored");
  camera.dispatch(view); assert.equal(clock.count, 1);
  service.setActive(false); assert.equal(clock.count, 0, "hiding cancels queued frames");
  service.destroy(); camera.dispatch(view); assert.equal(clock.count, 0);
});

test("hidden model changes coalesce until reopening, and visible changes still update geometry", t => {
  const {clock, scene, view, addObject} = fixture(t), state = createAabbPanelState();
  const service = new AabbService({scene, view, state}); t.after(() => service.destroy());
  addObject("b"); addObject("c");
  assert.equal(clock.count, 0); assert.equal(state.objects.length, 1);
  service.setActive(true); assert.equal(clock.count, 1); clock.flush();
  assert.deepEqual(state.objects.map(object => object.id), ["a", "b", "c"]);
  addObject("d"); clock.flush(); assert.equal(state.objects.length, 4);
  service.scheduleRefresh(); service.destroy(); assert.equal(clock.count, 0);
});

function rendererFixture() {
  const rendered = event(), stats = {tiles: {t: {id: "t", rtcCenter: [0, 0, 0], size: 10, tileIndex: 0, numMeshes: 1}}, views: [{numDrawCalls: 4}]};
  let reads = 0;
  return {events: {onViewRendered: rendered}, stats, get reads() { return reads; },
    getRenderInspector() { reads++; return {ok: true, value: {renderStats: stats}}; }};
}

test("Tiles retains geometry during camera/frame updates and detaches replaced renderers", t => {
  const {clock, scene, view, camera} = fixture(t), state = createTilesPanelState(), renderer = rendererFixture();
  const service = new TilesService({scene, view, renderer, rendererLabel: "first", state}); t.after(() => service.destroy());
  const tiles = state.tiles, initialReads = renderer.reads;
  camera.dispatch(view); renderer.events.onViewRendered.dispatch(renderer, view);
  assert.equal(clock.count, 0); assert.equal(renderer.reads, initialReads);
  service.setActive(true); clock.flush();
  renderer.stats.views[0].numDrawCalls = 8;
  view.camera.eye = [3, 4, 5];
  camera.dispatch(view); renderer.events.onViewRendered.dispatch(renderer, view);
  assert.equal(clock.count, 1); clock.flush();
  assert.equal(state.tiles, tiles); assert.deepEqual(state.cameraEye, [3, 4, 5]); assert.equal(state.frameDrawCalls, 8);
  const replacement = rendererFixture(); replacement.stats.tiles.t.numMeshes = 9;
  service.setRenderer(replacement, "second"); clock.flush();
  assert.equal(renderer.events.onViewRendered.count, 0); assert.equal(state.meshCount, 9);
  renderer.events.onViewRendered.dispatch(renderer, view); assert.equal(clock.count, 0);
  replacement.events.onViewRendered.dispatch(replacement, view); assert.equal(clock.count, 1);
  service.destroy(); assert.equal(clock.count, 0); assert.equal(replacement.events.onViewRendered.count, 0);
});

test("panel visibility handles tab changes, background pages and disposal", () => {
  const changed = event(), page = new EventTarget(); page.hidden = false;
  const states = [], api = {isVisible: true, onDidVisibilityChange(fn) { const stop = changed.subscribe(fn); return {dispose: stop}; }};
  const dispose = observePanelActivity(api, value => states.push(value), page);
  changed.dispatch({isVisible: false}); changed.dispatch({isVisible: true});
  page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
  page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
  dispose(); page.dispatchEvent(new Event("visibilitychange")); changed.dispatch({isVisible: true});
  assert.deepEqual(states, [true, false, true, false, true, false]); assert.equal(changed.count, 0);
});

test("minimap camera overlay shares the background projection without rebuilding rectangles", () => {
  const object = {id: "a", title: "A & B", aabb: [0, 0, 0, 10, 20, 30]};
  const tile = {id: "t", rtcCenter: [10, 20, 30], size: 10, numMeshes: 4};
  for (const axes of [{ax0: 0, ax1: 1, flipV1: false}, {ax0: 0, ax1: 2, flipV1: true}, {ax0: 1, ax1: 2, flipV1: true}]) {
    for (const [render, input, frame] of [
      [renderAabbProjectionSvg, {objects: [object], sceneAabb: object.aabb}, createAabbMinimapProjection(object.aabb, axes)],
      [renderTileProjectionSvg, {tiles: [tile]}, createTileMinimapProjection([tile], axes)]
    ]) {
      const eye = [2, 3, 4], look = [8, 9, 10];
      const background = render({...input, projection: axes});
      const combined = render({...input, projection: axes, cameraEye: eye, cameraLook: look});
      const overlay = renderMinimapCameraSvg(frame, eye, look);
      assert.doesNotMatch(background, /boundaries-camera/);
      assert.equal(combined.match(/transform="([^"]+)"/)[1], overlay.match(/transform="([^"]+)"/)[1]);
      assert.notEqual(overlay, renderMinimapCameraSvg(frame, [8, 4, 5], look));
    }
  }
});

test("minimap title lookup does not touch inspector properties or geometry", () => {
  const object = {id: "a", name: "Wall", get propertySets() { throw new Error("Expensive detail lookup"); }};
  const resolver = new ObjectSelectionDetailsResolver({data: {objects: {a: object}, events: {onDataObjectCreated: event(), onDataObjectDestroyed: event()}}, scene: {objects: {}}});
  assert.equal(resolver.resolveSceneObjectTitle("a"), "Wall");
  assert.equal(resolver.resolveSceneObjectTitle("missing"), "missing");
  resolver.destroy();
});
