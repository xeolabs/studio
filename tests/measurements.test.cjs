const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const output = {exports: {}};
const code = require("esbuild").buildSync({
  stdin: {resolveDir: path.resolve(__dirname, "../src"), contents: `
    export {Scene} from "@xeokit/sdk/model/scene";
    export {ViewerEvents} from "@xeokit/sdk/viewing/viewer/ViewerEvents";
    export {MeasurementService} from "./studio/services/MeasurementService";
    export {planMeasurementTarget, formatMeasurementLength, measurementBounds} from "./studio/services/measurementGeometry";
    export {createMeasurementState} from "./studio/state/measurementState";
    export {createSectionState} from "./studio/state/sectionState";
    export {registerMeasurementCommands} from "./studio/commands/registerMeasurementCommands";
    export {CommandRegistry} from "./studio/commands/CommandRegistry";
  `}, alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(output, output.exports, require);
const {Scene, ViewerEvents, MeasurementService, planMeasurementTarget, formatMeasurementLength,
  createMeasurementState, createSectionState, registerMeasurementCommands, CommandRegistry, measurementBounds} = output.exports;

test("plan distances ignore height for Z-up, Y-up and oblique coordinate systems", () => {
  assert.deepEqual(planMeasurementTarget([0,0,2],[3,4,12],[0,0,1]),[3,4,2]);
  assert.deepEqual(planMeasurementTarget([0,2,0],[3,12,4],[0,1,0]),[3,2,4]);
  const point = planMeasurementTarget([0,0,0],[5,6,7],[1,1,0]);
  assert.equal(point[0]+point[1],0); assert.equal(point[2],7);
});
test("display units honor scene units and explicit scale overrides", () => {
  const format = (length, unit, units = "meters", scaleToMeters) => formatMeasurementLength(length,{units,scaleToMeters},unit);
  assert.equal(format(1,"mm"),`${(1000).toLocaleString()} mm`);
  assert.equal(format(1000,"m","millimeters"),`${(1).toLocaleString(undefined,{minimumFractionDigits:2})} m`);
  assert.equal(format(.3048,"ft"),`${(1).toLocaleString(undefined,{minimumFractionDigits:2})} ft`);
  assert.equal(format(1,"in","feet"),`${(12).toLocaleString(undefined,{minimumFractionDigits:2})} in`);
  assert.equal(format(2,"m","millimeters",.5),`${(1).toLocaleString(undefined,{minimumFractionDigits:2})} m`);
});
test("measure commands require geometry, toggle placement and reject invalid units", async () => {
  const commands = new CommandRegistry(), state = createMeasurementState();
  const workspace = {measurements:state,toolMode:"select",loadedModels:[]};
  registerMeasurementCommands(commands,{},workspace);
  await commands.execute("tools.measure"); assert.equal(workspace.toolMode,"select");
  workspace.loadedModels.push({objectCount:1}); await commands.execute("tools.measure"); assert.equal(workspace.toolMode,"measure");
  await commands.execute("measurement.units","ft"); assert.equal(state.unit,"ft");
  await commands.execute("measurement.units","yards"); assert.equal(state.unit,"ft");
  await commands.execute("tools.measure"); assert.equal(workspace.toolMode,"select");
});
test("service subscribes to real SDK events, hides other floors and removes unloaded anchors", async t => {
  global.window = {dispatchEvent() {}};
  t.after(() => {delete global.window;});
  const scene = new Scene(), events = new ViewerEvents(), state = createMeasurementState(), section = createSectionState();
  const view = {viewer:{events},objects:{anchor:{visible:true}},sectionPlanes:{}};
  const service = new MeasurementService({scene,view,state,section,getPicker:()=>null,getRenderer:()=>null,getController:()=>null,isActive:()=>false,isSwitching:()=>false,showFloorPlan(){},returnTo3D(){}});
  const measurement = {length:1,visible:true};
  service.tool = {measurements:{distance:measurement},update(){},destroy(){},destroyMeasurement(id){delete this.measurements[id];}};
  state.items = [{id:"distance",number:1,origin:[0,0,0],target:[1,0,0],objectIds:["anchor"],floorId:"",text:""}];
  service.update(); assert.equal(measurement.visible,true);
  section.planFloorId = "floor"; service.update(); assert.equal(measurement.visible,false);
  section.planFloorId = ""; view.objects.anchor.visible = false;
  events.onViewObjectVisibleChanged.dispatch(view,view.objects.anchor); await Promise.resolve(); assert.equal(measurement.visible,false);
  scene.events.onSceneObjectDestroyed.dispatch(scene,{id:"anchor"}); assert.equal(state.items.length,0);
  service.destroy(); scene.destroy();
});

function reviewFixture(t) {
  global.window = {dispatchEvent() {}};
  const frames = [];
  global.requestAnimationFrame = callback => {frames.push(callback); return frames.length;};
  t.after(() => {delete global.window; delete global.requestAnimationFrame;});
  const scene = new Scene(), events = new ViewerEvents(), state = createMeasurementState(), section = createSectionState();
  section.floors = [{id:'floor',title:'Level 2',elevation:3}];
  const view = {viewer:{events}, objects:{a:{visible:true},b:{visible:true}}, sectionPlanes:{},
    camera:{eye:[10,10,10],look:[0,0,0]}, htmlElement:{getBoundingClientRect:()=>({width:390,height:650})},
    setObjectsVisible(ids,visible){for(const id of ids) this.objects[id].visible=visible;}};
  const visits = [], flights = [];
  const service = new MeasurementService({scene,view,state,section,getPicker:()=>null,getRenderer:()=>null,getController:()=>null,
    isActive:()=>false,isSwitching:()=>false,
    showFloorPlan(id,height){visits.push([id,height]);section.planFloorId=id;},
    returnTo3D(){visits.push('3D');section.planFloorId='';}});
  service.tool = {measurements:{},update(){},destroy(){},destroyMeasurement(id){delete this.measurements[id];},
    createMeasurement(params){return this.measurements[params.id]={...params,length:1};}};
  service.sync = () => service.update();
  service.reserveLabels = () => {};
  service.flight = {flyTo:params=>flights.push(params),cancel(){},destroy(){}};
  const add = (number, objectId='a',floorId='') => {
    const item={id:`distance-${number}`,number,origin:[0,0,0],target:[1,0,0],objectIds:[objectId],floorId,
      floorTitle:floorId?'Level 2':'',planCutHeight:floorId?2.1:undefined,text:'1.00 m'};
    state.items.push(item);service.restoreMeasurement(item);return item;
  };
  const settle = () => {while(frames.length) frames.shift()();};
  t.after(()=>{service.destroy();scene.destroy();});
  return {scene,view,state,section,service,visits,flights,add,settle};
}

test('delete and Clear all undo restore stable numbers, order, labels and selection without losing newer measurements', t=>{
  const {state,service,add}=reviewFixture(t);
  const one=add(1),two=add(2);state.selectedId=two.id;
  service.remove(two.id);assert.deepEqual(state.items.map(x=>x.number),[1]);assert.equal(state.selectedId,'');
  add(3);service.undoRemoval();assert.deepEqual(state.items.map(x=>x.number),[1,2,3]);assert.equal(state.selectedId,two.id);
  assert.equal(service.tool.measurements[two.id].formatLength(1),'2 · 1.00 m');
  state.unit='mm';assert.equal(service.tool.measurements[two.id].formatLength(1),`2 · ${(1000).toLocaleString()} mm`);
  service.clear();assert.equal(state.items.length,0);assert.equal(state.undoLabel,'Clear measurements');
  service.undoRemoval();assert.deepEqual(state.items.map(x=>x.number),[1,2,3]);assert.equal(state.undoLabel,'');
  service.remove(one.id);service.remove('missing');assert.equal(state.undoLabel,'Delete measurement 1');
  service.undoRemoval();assert.deepEqual(state.items.map(x=>x.number),[1,2,3]);
});

test('unloading anchors prunes deletion history without making unloaded measurements undoable', t=>{
  const {scene,view,state,service,add}=reviewFixture(t);
  add(1,'a');add(2,'b');service.clear();
  scene.events.onSceneObjectDestroyed.dispatch(scene,{id:'a'});delete view.objects.a;
  service.undoRemoval();assert.deepEqual(state.items.map(x=>x.number),[2]);assert.equal(state.undoLabel,'');
  state.selectedId=state.items[0].id;
  scene.events.onSceneObjectDestroyed.dispatch(scene,{id:'b'});delete view.objects.b;
  assert.equal(state.items.length,0);assert.equal(state.selectedId,'');assert.equal(state.undoLabel,'');
});

test('locating a plan measurement opens its floor and cut height, reveals anchors and frames after layout', t=>{
  const {view,state,service,visits,flights,add,settle}=reviewFixture(t);
  const item=add(1,'a','floor');add(2,'b');state.visible=false;view.objects.a.visible=false;
  service.locate(item.id);
  assert.deepEqual(visits,[['floor',2.1]]);assert.equal(view.objects.a.visible,true);
  assert.equal(state.selectedId,item.id);assert.equal(state.visible,true);assert.equal(state.items.length,2);
  assert.equal(service.tool.measurements[item.id].color,'#9a4b09');
  assert.equal(flights.length,0);settle();assert.equal(flights.length,1);
  assert.deepEqual(Array.from(flights[0].look),[.5,0,0]);assert(flights[0].orthoScale>1);
});

test('locating 3D returns from plan mode and stale or deleted requests cannot move the camera', t=>{
  const {state,section,service,visits,flights,add,settle}=reviewFixture(t);
  const first=add(1),second=add(2);section.planFloorId='floor';
  service.locate(first.id);service.locate(second.id);settle();
  assert.deepEqual(visits,['3D']);assert.equal(flights.length,1);assert.equal(state.selectedId,second.id);
  service.locate(first.id);service.remove(first.id);settle();assert.equal(flights.length,1);
  service.locate(second.id);section.planFloorId='floor';settle();assert.equal(flights.length,1);
});

test('measurement framing stays finite with zero lengths and respects millimeter model units', ()=>{
  const meters=measurementBounds([2,3,4],[2,3,4],1),mm=measurementBounds([2000,3000,4000],[2000,3000,4000],.001);
  assert(meters.every(Number.isFinite));assert(meters[3]>meters[0]);
  assert.deepEqual(mm,meters.map(x=>x*1000));
});
