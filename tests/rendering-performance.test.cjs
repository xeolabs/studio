const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export * from "./studio/services/studioPerformanceSettings";
    export {SunStudyService, createSunStudyPanelState} from "./studio/services/SunStudyService";
  `},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {createStudioPerformanceViewSettings, createStudioPerformanceWebGPUSettings, SunStudyService, createSunStudyPanelState} = output.exports;

test("performance View disables optional passes and texture sampling while retaining hemisphere ambient", () => {
  const settings = createStudioPerformanceViewSettings();
  for (const [name, effect] of Object.entries(settings.effects)) assert.equal(effect.enabled, false, name);
  assert.equal(settings.lights.hemispheric.enabled, true);
  assert.equal(settings.lights.ibl.enabled, false);
  assert.equal(settings.texturing.enabled, false);
  assert.deepEqual(settings.resolutionScale, {enabled: true, resolutionScale: 0.65});
  settings.effects.shadows.enabled = true;
  assert.equal(createStudioPerformanceViewSettings().effects.shadows.enabled, false, "fresh editable settings per View");
});

test("WebGPU uses the lean large-model path with bundles and no depth/edge/timing passes", () => {
  const settings = createStudioPerformanceWebGPUSettings();
  assert.deepEqual(settings.renderConfigs, {depthPrepass: false, edges: true, triangleColorMode: "flat",
    renderBundleCaching: true, transparentSortStrategy: "segment", logDepth: true, gpuTimestamps: false});
  assert.equal(settings.requestAdapterOptions.powerPreference, "high-performance");
  assert.equal(settings.memoryConfigs.frustumCulling, true);
  assert.equal(settings.memoryConfigs.compactStreamPages, true);
  assert.equal(settings.memoryConfigs.compactSealedStreamPages, true);
  const service = fs.readFileSync(path.resolve(__dirname, "../src/studio/services/RendererService.ts"), "utf8");
  assert.match(service, /WebGPURenderer\.create\(createStudioPerformanceWebGPUSettings\(\)\)/);
  assert.match(service, /maybeSetInfiniteGrid\(renderer, false\)/);
});

function fixture() {
  const state = createSunStudyPanelState(), lights = [];
  const view = {effects: {
    shadows: {enabled: false, intensity: 0.35}, tonemap: {enabled: false, exposure: 1},
    sky: {enabled: false, skyColor: [0.6, 0.7, 0.8], horizonColor: [0.8, 0.8, 0.8], groundColor: [0.3, 0.3, 0.3]}
  }, registerLight: light => lights.push(light), needsRender() {}};
  return {state, view, lights, service: new SunStudyService({view, state})};
}

test("inactive Sun Study creates no light/player and cannot re-enable expensive startup effects", () => {
  const {service, state, view, lights} = fixture();
  assert.equal(service.sunStudy, null); assert.equal(service.player, null);
  assert.equal(lights.length, 0);
  assert.ok(Number.isFinite(state.altitude) && Number.isFinite(state.azimuth));
  for (const effect of Object.values(view.effects)) assert.equal(effect.enabled, false);
  service.destroy(); service.destroy();
  assert.equal(lights.length, 0);
});

test("explicit Sun Study actions initialize once and preserve controls and playback", t => {
  const {service, state, view, lights} = fixture();
  t.after(() => service.destroy());
  service.setMinutesUtc(9 * 60);
  assert.equal(lights.length, 1); assert.equal(state.minutesUtc, 540);
  assert.equal(view.effects.shadows.enabled, true); assert.equal(view.effects.sky.enabled, true);
  service.setPreset("Berlin"); assert.equal(state.latitude, 52.52);
  service.togglePlayback(); assert.equal(state.playing, true);
  service.togglePlayback(); assert.equal(state.playing, false);
  assert.equal(lights.length, 1);
});
