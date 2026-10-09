const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const bundle = require("esbuild").buildSync({
  stdin: {contents: `
    export {BUNDLED_MODELS} from "./studio/app/bundledModels";
    export {parseStartupOptions} from "./studio/app/startupOptions";
    export {StreamLifecycle} from "./studio/services/StreamLifecycle";
    export {BundledModelsService, resolveStreamIndex} from "./studio/services/BundledModelsService";
    export {Scene} from "@xeokit/sdk/model/scene";
    export {Data} from "@xeokit/sdk/model/data";
    export {readXGFStreamingRuntimeIndex, writeXGFStreamingRuntimeIndex} from "@xeokit/sdk/formats/xgfstream";
  `, resolveDir: path.resolve(__dirname, "../src"), loader: "ts"},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
const output = {exports: {}};
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {BundledModelsService, Scene, Data, writeXGFStreamingRuntimeIndex, BUNDLED_MODELS, parseStartupOptions, StreamLifecycle, resolveStreamIndex, readXGFStreamingRuntimeIndex} = output.exports;

test("startup defaults to Duplex, supports deduplicated multiple bundled models and never accepts arbitrary URLs", () => {
  assert.deepEqual(parseStartupOptions("").models.map(model => model.id), ["duplex"]);
  const selected = parseStartupOptions("?models=baku,duplex,baku&model=duplex");
  assert.deepEqual(selected.models.map(model => model.id), ["baku", "duplex"]);
  assert.deepEqual(selected.camera, BUNDLED_MODELS.find(model => model.id === "baku").camera);
  for (const query of ["?models=", "?models=missing", "?model=../secret", "?models=https://example.com/model.xgf"]) {
    assert.throws(() => parseStartupOptions(query), /Unknown bundled model/);
  }
});

test("camera query overrides survive parsing without mutating the catalogue", () => {
  const original = JSON.stringify(BUNDLED_MODELS);
  const {camera} = parseStartupOptions("?model=baku&eye=10,20,30&look=0,0,0&up=0,0,1&fov=42");
  assert.deepEqual(camera, {eye:[10,20,30],look:[0,0,0],up:[0,0,1],fov:42});
  camera.eye[0] = 123;
  assert.equal(JSON.stringify(BUNDLED_MODELS), original);
});

test("invalid camera parameters fail before model loading", () => {
  for (const query of ["?eye=1,2", "?eye=1,,3", "?eye=NaN,0,0", "?eye=Infinity,0,0", "?eye=1e20,0,0",
    "?eye=0,0,0&look=0,0,0", "?up=0,0,0", "?eye=0,0,1&look=0,0,0&up=0,0,1", "?fov=", "?fov=180", "?fov=NaN"]) {
    assert.throws(() => parseStartupOptions(query), /Camera/);
  }
});

test("every Baku geometry chunk and shared dependency is bundled and resolves under a hosting subdirectory", () => {
  const entry = BUNDLED_MODELS.find(model => model.id === "baku");
  const root = path.resolve(__dirname, "../public");
  const raw = JSON.parse(fs.readFileSync(path.join(root, entry.source.index)));
  const result = readXGFStreamingRuntimeIndex(raw);
  assert.equal(result.ok, true, result.error);
  const indexURL = new URL(entry.source.index, "https://example.com/studio/").href;
  const index = resolveStreamIndex(result.value, indexURL);
  const ids = new Set(index.chunks.map(chunk => chunk.id));
  assert.equal(ids.size, 4020);
  assert.ok(index.chunks.filter(chunk => chunk.role === "referencesOnly").length > 3700);
  for (const chunk of index.chunks) {
    const url = new URL(chunk.uri);
    assert.equal(url.origin, "https://example.com");
    assert.ok(url.pathname.startsWith("/studio/models/BakuStadium_xgfstream_4000/"));
    assert.ok(fs.statSync(path.join(root, url.pathname.slice("/studio/".length))).size > 0);
    for (const dependency of chunk.dependencies?.chunks || []) {
      assert.ok(ids.has(dependency.id), `Missing ${dependency.id}`);
      if (dependency.uri) assert.ok(dependency.uri.startsWith("https://example.com/studio/models/"));
    }
  }
});

function lifecycle(t) {
  t.mock.timers.enable({apis:["setTimeout", "setInterval"]});
  let cameraChanged, unsubscribed = 0, sealed = 0, pending = 0, updates = 0;
  const controller = {paused:false, chunkManifests:[{},{}],loadedChunkIds:new Set(),loadingChunkIds:new Set(),
    queueProgress:{queued:2,loaded:0}, schedules:0, resumes:0, backpressureChecks:0,
    pause(){this.paused=true;}, resume(){this.paused=false;this.resumes++;}, schedule(){this.schedules++;},
    updateBackpressure(){this.backpressureChecks++;return false;}};
  const service = new StreamLifecycle({controller,
    subscribeCamera: cb => {cameraChanged=cb; return () => {unsubscribed++;};},
    pendingSegments:()=>pending, seal:()=>{sealed++;}, onChanged:()=>{updates++;}});
  t.after(()=>service.destroy());
  return {service,controller,move:()=>cameraChanged(),setPending:value=>{pending=value;},
    stats:()=>({unsubscribed,sealed,updates})};
}

test("camera motion pauses immediately, resets the 500ms idle delay and blocks backpressure resumes", t => {
  const f = lifecycle(t); f.service.start(); f.service.start();
  assert.equal(f.controller.schedules,1);
  f.move(); assert.equal(f.controller.paused,true);
  t.mock.timers.tick(400); f.move(); t.mock.timers.tick(499);
  assert.equal(f.controller.resumes,0);
  assert.equal(f.controller.backpressureChecks,0);
  t.mock.timers.tick(1);
  assert.equal(f.controller.resumes,1); assert.equal(f.service.moving,false);
});

test("a fully loaded current view stays available for camera changes until every chunk is resident", t => {
  const f=lifecycle(t); f.service.start();
  f.controller.loadedChunkIds.add("a"); f.controller.queueProgress={queued:1,loaded:1};
  f.service.check(); assert.equal(f.stats().sealed,0);
  f.move(); t.mock.timers.tick(500); assert.equal(f.controller.resumes,1);
});

test("completion waits for chunk commits and renderer backlog, then seals and removes all scheduling", t => {
  const f=lifecycle(t); f.service.start();
  f.controller.loadedChunkIds=new Set(["a","b"]); f.controller.loadingChunkIds.add("b");
  f.service.check(); assert.equal(f.stats().sealed,0);
  f.controller.loadingChunkIds.clear(); f.setPending(1);
  f.service.check(); assert.equal(f.stats().sealed,0);
  f.setPending(0); f.service.check();
  assert.equal(f.stats().sealed,1); assert.equal(f.stats().unsubscribed,1); assert.equal(f.service.complete,true);
  const before=f.stats().updates; f.move(); t.mock.timers.tick(2000);
  assert.equal(f.stats().updates,before); assert.equal(f.controller.resumes,0);
});

test("unloading during motion cancels delayed resumes and polling", t => {
  const f=lifecycle(t); f.service.start(); f.move(); f.service.destroy(); f.service.destroy();
  const before=f.stats().updates; t.mock.timers.tick(2000);
  assert.equal(f.controller.resumes,0); assert.equal(f.stats().updates,before); assert.equal(f.stats().unsubscribed,1);
});

function event() {
  const listeners = new Set();
  return {subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    emit(...args) {for (const fn of listeners) fn(...args);}};
}

async function streamFixture(t, broken = false) {
  const root = path.resolve(__dirname, "../public");
  const entry = BUNDLED_MODELS.find(model => model.id === "baku");
  const full = readXGFStreamingRuntimeIndex(JSON.parse(fs.readFileSync(path.join(root, entry.source.index)))).value;
  const reference = full.chunks.find(chunk => chunk.role === "referencesOnly");
  const byId = new Map(full.chunks.map(chunk => [chunk.id, chunk])), ids = new Set();
  function include(id) {if (ids.has(id)) return; ids.add(id); for (const dependency of byId.get(id).dependencies.chunks) include(dependency.id);}
  include(reference.id);
  const index = writeXGFStreamingRuntimeIndex({...full, chunks:full.chunks.filter(chunk => ids.has(chunk.id)), rootChunkIds:[reference.id]});
  const requests=[];
  t.mock.method(globalThis,"fetch",async (url, options) => {
    requests.push(String(url));
    if (String(url).endsWith("index.runtime.json")) return {ok:true,json:async()=>index};
    if (options.signal.aborted) throw new DOMException("Aborted","AbortError");
    if (broken) return {ok:false,status:503};
    const bytes=fs.readFileSync(path.join(root,new URL(url).pathname.slice("/studio/".length)));
    return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  });
  const scene=new Scene({logging:false}), data=new Data({logging:false});
  const view={viewIndex:0,camera:{eye:[0,0,0],look:[0,0,1],frustum:{planes:[]}},
    viewer:{events:{onCameraViewMatrixUpdated:event(),onCameraProjMatrixUpdated:event()}}};
  const workspace={bundledStreams:[],setStatus(){},appendOutput(){},appendEvent(){}};
  const service=new BundledModelsService({scene,data,view,workspace,baseURL:"https://example.com/studio/",getRenderer:()=>null});
  t.after(()=>{service.destroy();scene.destroy();data.destroy();});
  await service.prepare([entry]);
  return {scene,view,service,workspace,requests};
}

async function until(predicate) {
  for(let n=0;n<200;n++) {if(predicate()) return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail("Streaming condition did not settle");
}

test("real Baku chunks load shared assets, seal on completion and leave no camera scheduling", async t => {
  const f=await streamFixture(t); f.service.start();
  const session=[...f.service.streams.values()][0];
  await until(()=>session.lifecycle.complete);
  assert.ok(session.model.stats.numObjects>0);
  assert.equal(new Set(f.requests).size, f.requests.length, "completed prefetches must not be fetched again");
  assert.equal(session.model.sealed,true);
  assert.equal(f.workspace.bundledStreams[0].phase,"complete");
  const generation=session.controller.generation, requests=f.requests.length;
  f.view.viewer.events.onCameraViewMatrixUpdated.emit(f.view);
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.equal(session.controller.generation,generation);assert.equal(f.requests.length,requests);
});

test("failed stream requests report an error and stop instead of retrying indefinitely", async t => {
  const f=await streamFixture(t,true); f.service.start();
  await until(()=>f.workspace.bundledStreams[0].phase==="error");
  const session=[...f.service.streams.values()][0];
  assert.match(f.workspace.bundledStreams[0].error,/503/);assert.equal(session.controller.paused,true);
  assert.equal(session.abort.signal.aborted,true);
});
