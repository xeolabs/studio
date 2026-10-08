const assert = require("node:assert/strict");
const test = require("node:test");
require("tsx/cjs");
const {DockviewController} = require("../src/studio/layout/DockviewController.ts");
const {createWorkspaceStore} = require("../src/studio/state/createWorkspaceStore.ts");
const {DOCKVIEW_LAYOUT_STORAGE_KEY: storageKey} = require("../src/studio/layout/toolWindowDefinitions.ts");

function workspace() {
  return createWorkspaceStore({defineStore(_name, definition) {
    const state = definition.state();
    for (const [name, action] of Object.entries(definition.actions)) state[name] = action.bind(state);
    return state;
  }});
}

function environment(t, width, height, savedLayout) {
  const storage = new Map(savedLayout ? [[storageKey, JSON.stringify(savedLayout)]] : []);
  const styles = new Map();
  const viewport = Object.assign(new EventTarget(), {width, height, scale: 1, offsetTop: 0});
  const win = Object.assign(new EventTarget(), {innerWidth: width, innerHeight: height, visualViewport: viewport,
    setTimeout: () => 1, clearTimeout() {}});
  const globals = {window: win, document: {querySelector: () => null, documentElement: {style: {
    setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key)
  }}}, localStorage: {
    getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
  }, matchMedia: query => Object.defineProperty(new EventTarget(), "matches", {get: () => query.includes("max-width")
    ? win.innerWidth <= 959 || win.innerHeight <= 600 : win.innerWidth >= 1200 && win.innerHeight >= 601}),
  requestAnimationFrame: callback => { callback(); return 1; }};
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const resize = (nextWidth, nextHeight) => {
    win.innerWidth = viewport.width = nextWidth;
    win.innerHeight = viewport.height = nextHeight;
    win.dispatchEvent(new Event("resize"));
  };
  return {storage, styles, resize, viewport};
}

function dockview() {
  const panels = new Map();
  const changes = new Set();
  const changed = () => changes.forEach(callback => callback());
  const api = {
    onDidLayoutChange: callback => changes.add(callback),
    getPanel: id => panels.get(id),
    addPanel(options) {
      const panel = {options, api: {close() {panels.delete(options.id); changed();}, setActive() {}, setTitle() {}}};
      panels.set(options.id, panel); changed(); return panel;
    },
    toJSON: () => ({panels: Object.fromEntries([...panels].map(([id, panel]) => [id, panel.options]))}),
    fromJSON(layout) {panels.clear(); for (const options of Object.values(layout.panels)) api.addPanel(options);}
  };
  return api;
}

test("phone panels leave the canvas mounted and preserve the desktop layout through rotation", t => {
  let controller;
  t.after(() => controller?.dispose());
  const env = environment(t, 1440, 900);
  const state = workspace(), api = dockview();
  controller = new DockviewController({workspace: state, notifyLayoutChanged() {}});
  controller.attach(api);
  assert.equal(state.bottomPanelOpen, false, "viewing starts without an activity panel");
  state.setBottomPanelOpen(true); // Explicitly opened diagnostics still restore on desktop.
  controller.open("data"); controller.open("inspector"); controller.save();
  const saved = env.storage.get(storageKey), viewer = api.getPanel("viewer");
  env.resize(390, 844);
  assert.equal(state.layoutMode, "compact");
  assert.equal(state.responsivePanelId, "inspector", "the active desktop tool follows into the phone panel");
  assert.equal(state.bottomPanelOpen, false);
  assert.equal(api.getPanel("viewer"), viewer);
  assert.equal(api.getPanel("data"), undefined);
  controller.open("data");
  assert.equal(state.responsivePanelId, "data");
  assert.equal(state.toolWindowOpen.data, true);
  controller.open("inspector");
  assert.equal(state.toolWindowOpen.data, false);
  assert.equal(state.toolWindowOpen.inspector, true);
  controller.toggle("inspector");
  assert.equal(state.responsivePanelId, "");
  controller.close("viewer");
  assert.equal(api.getPanel("viewer"), viewer);
  env.resize(844, 390);
  controller.save();
  assert.equal(env.storage.get(storageKey), saved, "mobile layout must never replace the saved desktop layout");
  env.resize(1440, 900);
  assert.equal(state.bottomPanelOpen, true);
  assert.equal(JSON.stringify(api.toJSON()), saved);
  assert.equal(state.toolWindowOpen.data, true);
  assert.equal(state.toolWindowOpen.inspector, true);
});

test("a tablet startup defers restoring desktop panels until there is enough room", t => {
  let controller;
  t.after(() => controller?.dispose());
  const saved = {panels: {viewer: {id: "viewer", component: "ViewerPanel"}, scene: {id: "scene", component: "SceneExplorerPanel", initialWidth: 400}}};
  const env = environment(t, 1024, 768, saved);
  const state = workspace(), api = dockview();
  controller = new DockviewController({workspace: state, notifyLayoutChanged() {}});
  controller.attach(api);
  assert.equal(state.layoutMode, "medium");
  assert.equal(api.getPanel("scene"), undefined);
  assert.deepEqual(JSON.parse(env.storage.get(storageKey)), saved);
  controller.open("tiles");
  assert.equal(state.responsivePanelId, "tiles");
  env.resize(1024, 400);
  assert.equal(state.layoutMode, "compact");
  assert.equal(state.responsivePanelId, "tiles", "opening a tablet keyboard must not dismiss the active tool");
  env.resize(1280, 800);
  assert.equal(state.responsivePanelId, "");
  assert.equal(state.toolWindowOpen.scene, true);
  assert.equal(state.toolWindowOpen.tiles, true, "the active tablet tool opens alongside the restored desktop layout");
  assert.equal(api.getPanel("scene").options.initialWidth, 400);
  env.resize(1280, 600);
  assert.equal(state.layoutMode, "compact", "short landscape windows need the compact layout too");
  assert.equal(state.responsivePanelId, "tiles");
});

test("keyboard viewport changes resize the shell while page zoom stays available; listeners are released", t => {
  const env = environment(t, 390, 844);
  const state = workspace();
  const controller = new DockviewController({workspace: state, notifyLayoutChanged() {}});
  env.viewport.height = 420; env.viewport.offsetTop = 20;
  env.viewport.dispatchEvent(new Event("resize"));
  assert.equal(env.styles.get("--studio-app-height"), "420px");
  assert.equal(env.styles.get("--studio-app-top"), "20px");
  env.viewport.scale = 2;
  env.viewport.dispatchEvent(new Event("resize"));
  assert.equal(env.styles.get("--studio-app-height"), "844px");
  assert.equal(env.styles.get("--studio-app-top"), "0px");
  controller.dispose();
  env.resize(1440, 900);
  assert.equal(env.styles.size, 0);
  assert.equal(state.layoutMode, "compact");
});


test("a selected element and inspection state survive phone, tablet and desktop transfers", t => {
  let controller;
  t.after(() => controller?.dispose());
  const env = environment(t, 390, 844);
  const state = workspace(), api = dockview();
  controller = new DockviewController({workspace: state, notifyLayoutChanged() {}});
  controller.attach(api);
  const selection = {sceneObjectId: "wall", title: "External wall"};
  state.setSelectedObjectDetails(selection);
  state.inspectorSession = {activeTab: "json", scrollTop: 240, objectId: "wall"};
  controller.open("inspector");
  state.setResponsivePanelSize("expanded");
  env.resize(1024, 768);
  assert.equal(state.responsivePanelId, "inspector");
  assert.equal(state.responsivePanelSize, "expanded");
  env.resize(1280, 800);
  assert.equal(state.responsivePanelId, "");
  assert.ok(api.getPanel("inspector"));
  env.resize(390, 844);
  assert.equal(state.responsivePanelId, "inspector");
  assert.equal(state.selectedObjectDetails, selection);
  assert.deepEqual(state.inspectorSession, {activeTab: "json", scrollTop: 240, objectId: "wall"});
  controller.close("inspector");
  env.resize(1280, 800);
  controller.close("inspector");
  env.resize(390, 844);
  assert.equal(state.responsivePanelId, "", "a closed desktop inspector must not reopen on rotation");
});

test("reopening a collapsed tool makes its content available and keeps selection", () => {
  const state = workspace();
  const selection = {sceneObjectId: "wall"};
  state.setSelectedObjectDetails(selection);
  state.setLayoutMode("compact");
  state.setResponsivePanel("ifcStoreys");
  state.setResponsivePanelSize("peek");
  state.setResponsivePanel("ifcStoreys");
  assert.equal(state.responsivePanelSize, "half");
  state.setResponsivePanelSize("expanded");
  state.setResponsivePanel("inspector");
  assert.equal(state.responsivePanelSize, "half");
  assert.equal(state.selectedObjectDetails, selection);
  assert.equal(state.toolWindowOpen.ifcStoreys, false);
  assert.equal(state.toolWindowOpen.inspector, true);
});


test("the active tool from a restored desktop layout follows into the phone panel", t => {
  let controller;
  t.after(() => controller?.dispose());
  const saved = {panels: {viewer: {id: "viewer", component: "ViewerPanel"}, inspector: {id: "inspector", component: "InspectorPanel"}}};
  const env = environment(t, 1280, 800, saved);
  const state = workspace(), api = dockview();
  controller = new DockviewController({workspace: state, notifyLayoutChanged() {}});
  controller.attach(api);
  api.activePanel = {id: "inspector"};
  env.resize(390, 844);
  assert.equal(state.responsivePanelId, "inspector");
});
