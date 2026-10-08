const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export {Data} from "@xeokit/sdk/model/data";
    export {Scene} from "@xeokit/sdk/model/scene";
    export {TrianglesPrimitive, OrthoProjectionType, PlanViewNavigationMode} from "@xeokit/sdk/base/constants";
    export {LoadedModelsService} from "./studio/services/LoadedModelsService";
    export {SectionViewService} from "./studio/services/SectionViewService";
    export {viewIsolation} from "./studio/services/ViewIsolation";
    export {createSectionState} from "./studio/state/sectionState";
    export {estimateFloorElevation, sceneMetersPerUnit} from "./studio/services/planElevation";
    export {projectedRange, planScale, unionBounds} from "./studio/services/sectionGeometry";
  `}, alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Scene, Data, TrianglesPrimitive, OrthoProjectionType, PlanViewNavigationMode,
  LoadedModelsService, SectionViewService, viewIsolation, createSectionState, estimateFloorElevation, sceneMetersPerUnit, projectedRange, planScale, unionBounds} = output.exports;
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};

async function fixture(t, basis = [1,0,0, 0,0,1, 0,1,0]) {
  const scene = new Scene({coordinateSystem: {basis}}), data = new Data();
  const sm = ok(scene.createModel({id: "geometry"}));
  const dm = ok(data.createModel({id: "semantics"}));
  const object = (id, type) => ok(dm.createObject({id, type, name: id}));
  const relation = (a, b, type = "IfcRelAggregates") => ok(dm.createRelationship({relatingObjectId: a, relatedObjectId: b, type}));
  const addGeometry = (id, elevation) => {
    ok(sm.createGeometry({id, primitive: TrianglesPrimitive,
      positions: [0,0,elevation, 10,0,elevation + 3, 0,20,elevation], indices: [0,1,2]}));
    ok(sm.createMesh({id, geometryId: id})); ok(sm.createObject({id, meshIds: [id]}));
  };
  object("level1", "IfcBuildingStorey"); object("level2", "IfcBuildingStorey"); object("empty", "IfcBuildingStorey");
  object("space", "IfcSpace"); object("wall", "IfcWall"); object("roof", "IfcSlab"); object("outside", "IfcWall");
  relation("level1", "space"); relation("space", "wall", "IfcRelContainedInSpatialStructure");
  relation("space", "level1", "IfcRelNests"); // Bad metadata cycle must terminate.
  relation("level2", "roof"); relation("level1", "level2"); // Do not cross into another floor.
  relation("level1", "outside", "IfcRelDefinesByType"); // Non-spatial links do not imply membership.
  addGeometry("wall", 0); addGeometry("roof", 4); addGeometry("outside", 10);
  const camera = {eye: [25,30,40], look: [3,4,2], up: [0,0,1], projectionType: 123,
    orthoProjection: {scale: 33}};
  let nextPlane = 0;
  const view = {camera, effects: {edges: {enabled: false, useMeshColor: true, edgeColor: [.6,.4,.2], edgeAlpha: .7, edgeWidth: 2},
    antiAliasing: {enabled: false}}, resolutionScale: {enabled: true}, boundary: [0,0,390,600], sectionPlanes: {},
    objects: {wall: {visible: true}, roof: {visible: false}, outside: {visible: true}},
    setObjectsVisible(ids, visible) {for (const id of ids) this.objects[id].visible = visible;},
    createSectionPlane(params) {
      const plane = {...params, id: params.id || `cut-${++nextPlane}`};
      plane.destroy = () => {delete this.sectionPlanes[plane.id];};
      this.sectionPlanes[plane.id] = plane; return {ok: true, value: plane};
    }
  };
  let controller = {navMode: 45, pointerEnabled: true};
  const state = createSectionState(), service = new SectionViewService({scene, data, view, state, getInputController: () => controller});
  const visible = () => Object.keys(view.objects).filter(id => view.objects[id].visible);
  const cameraState = () => ({eye: Array.from(camera.eye), look: Array.from(camera.look), up: Array.from(camera.up),
    scale: camera.orthoProjection.scale, projection: camera.projectionType, nav: controller.navMode});
  t.after(() => {service.destroy(); scene.destroy(); data.destroy();});
  return {scene, data, sm, dm, view, camera, state, service, visible, cameraState,
    controller: () => controller, replaceController: value => {controller = value;}};
}

test("floor discovery follows spatial descendants, ignores cycles and other floors, and omits empty floors", async t => {
  const {state, service, visible} = await fixture(t);
  assert.deepEqual(state.floors.map(f => f.id), ["level1", "level2"]);
  service.showFloorPlan("level1"); assert.deepEqual(visible(), ["wall"]);
  service.showFloorPlan("level2"); assert.deepEqual(visible(), ["roof"]);
});

test("floor changes, cut edits and Clear retain one camera, cut and visibility return point", async t => {
  const {state, service, view, cameraState, controller, visible} = await fixture(t);
  const external = ok(view.createSectionPlane({pos: [2,0,0], dir: [1,0,0], active: true}));
  service.setOrientation("vertical"); service.setPosition(27); service.flip();
  const cuts = () => Object.values(view.sectionPlanes).map(p => ({id: p.id, pos: Array.from(p.pos), dir: Array.from(p.dir), active: p.active}));
  const before = {camera: cameraState(), cuts: cuts(), visible: visible()};
  service.showFloorPlan("level1");
  assert.equal(view.camera.projectionType, OrthoProjectionType);
  assert.equal(controller().navMode, PlanViewNavigationMode);
  assert.equal(external.active, false);
  service.showFloorPlan("level2"); service.setPosition(82); service.flip(); service.clear(); service.fitPlan();
  service.returnTo3D();
  assert.deepEqual({camera: cameraState(), cuts: cuts(), visible: visible()}, before);
  assert.equal(state.planFloorId, ""); assert.equal(state.orientation, "vertical"); assert.equal(state.position, 27); assert.equal(state.flipped, true);
  service.returnTo3D(); assert.deepEqual(cameraState(), before.camera);
});

test("a pre-existing isolation session can still Restore after returning from a floor plan", async t => {
  const {service, view, visible} = await fixture(t), isolation = viewIsolation(view);
  isolation.isolate(["outside"], "Outside");
  service.showFloorPlan("level1");
  assert.equal(isolation.label, "");
  isolation.isolate(["roof"], "Roof"); isolation.clear(); view.setObjectsVisible(Object.keys(view.objects), true);
  service.returnTo3D(); assert.deepEqual(visible(), ["outside"]); assert.equal(isolation.label, "Outside");
  isolation.restore(); assert.deepEqual(visible(), ["wall", "outside"]);
});

test("restoration tolerates deleted objects and a replaced input controller without altering new objects", async t => {
  const {service, view, replaceController, controller, visible} = await fixture(t);
  service.showFloorPlan("level1");
  delete view.objects.outside; view.objects.imported = {visible: true};
  replaceController({navMode: PlanViewNavigationMode, pointerEnabled: false});
  service.returnTo3D();
  assert.deepEqual(visible(), ["wall", "imported"]);
  assert.equal(controller().navMode, 45); assert.equal(controller().pointerEnabled, false);
});

test("removing the active floor's model leaves plan mode and restores the camera", async t => {
  const {service, state, dm, cameraState} = await fixture(t), before = cameraState();
  service.showFloorPlan("level1"); dm.destroy(); await Promise.resolve();
  assert.equal(state.planFloorId, ""); assert.deepEqual(state.floors, []); assert.deepEqual(cameraState(), before);
});

test("invalid floor or slider input cannot change the active camera or introduce NaN", async t => {
  const {service, state, cameraState} = await fixture(t), before = cameraState();
  service.showFloorPlan("missing"); assert.deepEqual(cameraState(), before); assert.equal(state.planFloorId, "");
  assert.match(state.error, /no model geometry/);
  service.setPosition(NaN); assert.equal(state.position, 50);
  service.setPosition(200); assert.equal(state.position, 100);
  service.setPosition(-30); assert.equal(state.position, 0);
});

test("section direction follows the scene's up axis and Flip reverses the kept half", async t => {
  const {service, view} = await fixture(t, [1,0,0, 0,1,0, 0,0,-1]);
  service.setOrientation("horizontal");
  const plane = Object.values(view.sectionPlanes)[0];
  assert.deepEqual(Array.from(plane.dir), [0,1,0]);
  service.flip(); assert.equal(plane.dir[1], -1);
  service.clear(); assert.equal(plane.active, false);
  service.setOrientation("vertical"); service.setVerticalAxis("side");
  assert.deepEqual(Array.from(plane.dir), [1,0,0]);
});

test("orthographic fitting contains all projected corners in portrait and landscape", () => {
  const box = [10,-20,3, 40,50,8];
  const right = [1,0,0], up = [0,1,0];
  for (const [w,h] of [[320,568], [844,290], [640,680], [1440,900]]) {
    const scale = planScale(box,right,up,w,h), aspect = w/h;
    const width = w > h ? scale : scale*aspect, height = w > h ? scale/aspect : scale;
    assert.ok(width >= 30 && height >= 70);
  }
  assert.deepEqual(projectedRange(box,[0,-1,0]), [-50,20]);
  const q = Math.SQRT1_2;
  assert.deepEqual(projectedRange([0,0,0,2,4,1],[q,q,0]), [0,6*q]);
  assert.equal(unionBounds([[Infinity,0,0,1,2,3], [2,0,0,1,1,1]]), null);
});

test("floor elevation ignores stair/railing extremes and uses floor surfaces instead of underside bounds", () => {
  const bounds = (bottom, top) => [0,0,bottom,10,20,top];
  const elements = [
    {type: "IfcSlab", bounds: bounds(2.795, 3.1)},
    {type: "IfcSlab", bounds: bounds(3.1, 3.119)},
    {type: "IfcSlab", bounds: bounds(3.1, 3.119)},
    {type: "IfcWallStandardCase", bounds: bounds(2.612, 6)},
    {type: "IfcRailing", bounds: bounds(-1, 30)},
    {type: "IfcBeam", bounds: bounds(-5, 3.1)}
  ];
  assert.equal(estimateFloorElevation(elements, [0,0,1]), 3.119);
  assert.equal(estimateFloorElevation(elements.filter(e => e.type !== "IfcSlab"), [0,0,1]), 2.612);
  assert.equal(estimateFloorElevation([{type: "IfcSlab", bounds: [0,-127,0,20,0,30]}], [0,1,0]), 0);
  assert.equal(sceneMetersPerUnit({units: "millimeters"}), .001);
});

test("plan height is measured above the floor and appearance restores after several floors and toggles", async t => {
  const {service, state, view} = await fixture(t);
  const appearance = () => JSON.stringify({...view.effects, edges: {...view.effects.edges, edgeColor: [...view.effects.edges.edgeColor]}, resolution: view.resolutionScale.enabled});
  const before = appearance();
  service.showFloorPlan("level1");
  let plane = Object.values(view.sectionPlanes).find(p => p.active);
  assert.equal(plane.pos[2], 1.2);
  assert.equal(view.effects.edges.enabled, true); assert.equal(view.resolutionScale.enabled, false);
  service.setPlanCutHeight(1.5); assert.equal(plane.pos[2], 1.5);
  service.showFloorPlan("level2");
  plane = Object.values(view.sectionPlanes).find(p => p.active);
  assert.equal(plane.pos[2], state.floors.find(f => f.id === "level2").elevation + 1.2);
  service.togglePlanStyle(); assert.equal(appearance(), before);
  service.togglePlanStyle(); service.returnTo3D(); assert.equal(appearance(), before);
});

test("unloading a model during a labeled floor plan restores 3D and removes floors, labels and cuts", async t => {
  const f = await fixture(t);
  const original = f.cameraState();
  const stop = f.scene.events.onSceneObjectDestroyed.subscribe((_scene, object) => {delete f.view.objects[object.id];});
  f.view.needsRender = () => {};
  const models = new LoadedModelsService({scene: f.scene, data: f.data, view: f.view, state: {loadedModels: []},
    selection: {selectedSceneObjectId: null}, section: f.service, isBusy: () => false,
    initialModels: [{id: "building", title: "Building", sceneModelId: f.sm.id, dataModelId: f.dm.id}]});
  t.after(() => {models.destroy(); stop();});
  f.service.showFloorPlan("level1");
  f.state.labelsEnabled = true;
  f.state.planLabels = [{id: "wall", text: "Wall", x: 100, y: 100}];
  models.unload("building");
  assert.deepEqual(f.cameraState(), original);
  assert.equal(f.state.planFloorId, "");
  assert.deepEqual(f.state.floors, []);
  assert.deepEqual(f.state.planLabels, []);
  assert.equal(f.state.enabled, false);
  assert.equal(Object.values(f.view.sectionPlanes).some(plane => plane.active), false);
});

test("plan fitting uses the resized canvas before the renderer boundary catches up", async t => {
  const {service, view, scene} = await fixture(t);
  view.boundary = [0,0,844,346];
  view.htmlElement = {getBoundingClientRect: () => ({width: 844, height: 297})};
  service.showFloorPlan('level1');
  const {worldRight, worldForward} = scene.coordinateSystem;
  assert.equal(view.camera.orthoProjection.scale, planScale([0,0,0,10,20,3], worldRight, worldForward, 844, 297));
});
