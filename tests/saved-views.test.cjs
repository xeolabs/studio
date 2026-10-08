const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const output = {exports: {}};
const code = require('esbuild').buildSync({
  stdin: {resolveDir: path.resolve(__dirname, '../src'), contents: `
    export {Scene} from '@xeokit/sdk/model/scene';
    export {Data} from '@xeokit/sdk/model/data';
    export {TrianglesPrimitive, PerspectiveProjectionType, OrthoProjectionType, OrbitNavigationMode, PlanViewNavigationMode} from '@xeokit/sdk/base/constants';
    export {SavedViewsService} from './studio/services/SavedViewsService';
    export {SectionViewService} from './studio/services/SectionViewService';
    export {viewIsolation} from './studio/services/ViewIsolation';
    export {createSectionState} from './studio/state/sectionState';
    export {createSavedViewsState} from './studio/state/savedViewsState';
    export {savedViewsModelKey, readSavedViews, savedViewsStoragePrefix, validSavedSnapshot} from './studio/services/savedViewsStorage';
    export {captureViewThumbnail} from './studio/services/captureViewThumbnail';
  `}, alias: {'@xeokit/sdk': path.resolve(__dirname, '../vendor/xeokit-sdk/src')},
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
}).outputFiles[0].text;
new Function('module', 'exports', 'require', code)(output, output.exports, require);
const {Scene, Data, TrianglesPrimitive, PerspectiveProjectionType, OrthoProjectionType, OrbitNavigationMode, PlanViewNavigationMode,
  SavedViewsService, SectionViewService, viewIsolation, createSectionState, createSavedViewsState, savedViewsModelKey,
  readSavedViews, savedViewsStoragePrefix, validSavedSnapshot, captureViewThumbnail} = output.exports;
const ok = r => {assert.equal(r.ok, true, r.error); return r.value;};
function memoryStorage() {
  const entries = new Map();
  return {entries, getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value)};
}
function fixture(t, {storage = memoryStorage(), modelId = 'model', height = 3, captureThumbnail = async () => 'data:image/jpeg;base64,AAAA'} = {}) {
  const scene = new Scene(), data = new Data();
  const model = ok(scene.createModel({id: modelId})), dm = ok(data.createModel({id: 'data'}));
  for (const [id, z] of [['wall', 0], ['roof', 4]]) {
    ok(model.createGeometry({id, primitive: TrianglesPrimitive, positions: [0,0,z, 10,0,z+height, 0,20,z], indices: [0,1,2]}));
    ok(model.createMesh({id, geometryId: id})); ok(model.createObject({id, meshIds: [id]}));
    ok(dm.createObject({id, type: 'IfcWall'}));
  }
  ok(dm.createObject({id:'floor', type:'IfcBuildingStorey', name:'Ground floor'}));
  ok(dm.createRelationship({relatingObjectId:'floor', relatedObjectId:'wall', type:'IfcRelContainedInSpatialStructure'}));
  const camera = {eye:[25,30,40], look:[3,4,2], up:[0,0,1], projectionType:PerspectiveProjectionType,
    orthoProjection:{scale:33,near:.1,far:20000}, perspectiveProjection:{fov:45,near:.1,far:20000}};
  let sequence = 0, restores = 0;
  const controller = {navMode:OrbitNavigationMode, pointerEnabled:true};
  const view = {camera, boundary:[0,0,900,600], sectionPlanes:{}, effects:{edges:{enabled:false,useMeshColor:true,edgeColor:[.6,.4,.2],edgeAlpha:.7,edgeWidth:2},antiAliasing:{enabled:false}},resolutionScale:{enabled:true},
    objects:Object.fromEntries(['wall','roof'].map(id=>[id,{visible:true, bins:new Set(),hasStyleBin(bin){return this.bins.has(bin);}}])),
    setObjectsVisible(ids, visible){for(const id of ids) this.objects[id].visible=visible;},
    setObjectsInStyleBin(bin,ids,value){for(const id of ids) value?this.objects[id].bins.add(bin):this.objects[id].bins.delete(bin);},
    needsRender(){},
    createSectionPlane(params){const plane={...params,id:params.id||`cut-${++sequence}`,destroy(){delete view.sectionPlanes[this.id];}};this.sectionPlanes[plane.id]=plane;return{ok:true,value:plane};}};
  const sectionState=createSectionState(), state=createSavedViewsState();
  const section=new SectionViewService({scene,data,view,state:sectionState,getInputController:()=>controller});
  const services=[];
  const create=(nextState=state)=>{
    const service=new SavedViewsService({scene,view,section,state:nextState,getStorage:()=>storage,getController:()=>controller,
      captureThumbnail,beforeRestore:()=>{restores++;},isBusy:()=>false});services.push(service);return service;
  };
  const service=create();
  t.after(()=>{for(const service of services)service.destroy();section.destroy();scene.destroy();data.destroy();});
  return {scene,data,model,dm,view,camera,controller,section,sectionState,state,service,storage,create,restores:()=>restores};
}

test('named view persists across reload and restores camera, effects and an isolation return point', async t=>{
  const f=fixture(t), {view,camera,service,state,storage}=f;
  view.objects.roof.visible=false;
  viewIsolation(view).isolate(['roof'],'Roof');
  view.setObjectsInStyleBin('xrayed',['roof'],true);
  view.setObjectsInStyleBin('highlighted',['wall'],true);
  camera.perspectiveProjection.fov=62;
  await service.save('  Roof detail  ');
  assert.equal(state.error,''); assert.equal(state.items.length,1); assert.equal(state.items[0].name,'Roof detail');
  assert.equal(readSavedViews(storage,state.modelKey)[0].snapshot.camera.fov,62);
  const saved=structuredClone(state.items[0]);
  camera.eye=[999,888,777];camera.perspectiveProjection.fov=40;
  view.setObjectsVisible(['wall','roof'],true);viewIsolation(view).clear();
  view.setObjectsInStyleBin('xrayed',['roof'],false);
  const fresh=createSavedViewsState(), reloaded=f.create(fresh);reloaded.open();reloaded.restore(saved.id);
  assert.deepEqual(Array.from(camera.eye),saved.snapshot.camera.eye);
  assert.equal(camera.perspectiveProjection.fov,62);
  assert.equal(view.objects.wall.visible,false);assert.equal(view.objects.roof.hasStyleBin('xrayed'),true);
  assert.equal(view.objects.wall.hasStyleBin('highlighted'),true);assert.equal(viewIsolation(view).label,'Roof');
  viewIsolation(view).restore();assert.equal(view.objects.wall.visible,true);assert.equal(view.objects.roof.visible,false);
  assert.equal(fresh.open,false);assert.equal(f.restores(),1);
});

test('plan bookmark restores cut height, labels and camera; Return to 3D preserves the opening context',async t=>{
  const f=fixture(t), {section,sectionState,state,service,camera,view,controller}=f;
  section.showFloorPlan('floor');section.setPlanCutHeight(2.3);
  sectionState.labelsEnabled=true;sectionState.labelDensity='dense';section.togglePlanStyle();
  camera.look=[5,6,1];camera.orthoProjection.scale=12;
  await service.save('Ground floor doors');const id=state.items[0].id;
  section.returnTo3D();camera.eye=[70,80,90];const before=Array.from(camera.eye);
  sectionState.labelsEnabled=false;sectionState.labelDensity='sparse';sectionState.planStyle=true;
  service.restore(id);
  assert.equal(sectionState.planFloorId,'floor');assert.equal(sectionState.planCutHeight,2.3);
  assert.equal(sectionState.labelsEnabled,true);assert.equal(sectionState.labelDensity,'dense');assert.equal(sectionState.planStyle,false);
  assert.equal(controller.navMode,PlanViewNavigationMode);assert.equal(camera.projectionType,OrthoProjectionType);
  assert.equal(camera.orthoProjection.scale,12);assert.deepEqual(Array.from(camera.look),[5,6,1]);
  assert.equal(Object.values(view.sectionPlanes).filter(p=>p.active).length,1);
  section.returnTo3D();assert.deepEqual(Array.from(camera.eye),before);assert.equal(controller.navMode,OrbitNavigationMode);
});

test('3D cut views restore managed and external planes and keep the cut controls working',async t=>{
  const f=fixture(t), {section,sectionState,view,service,state}=f;
  section.setOrientation('vertical');section.setVerticalAxis('side');section.setPosition(27);section.flip();
  ok(view.createSectionPlane({id:'external-cut',pos:[1,2,3],dir:[0,0,-1],active:true}));
  await service.save('Section A');const id=state.items[0].id;
  section.showFloorPlan('floor');view.sectionPlanes['external-cut'].destroy();
  service.restore(id);
  assert.equal(sectionState.planFloorId,'');assert.equal(sectionState.orientation,'vertical');assert.equal(sectionState.verticalAxis,'side');
  assert.equal(sectionState.position,27);assert.equal(sectionState.flipped,true);assert.equal(view.sectionPlanes['external-cut'].active,true);
  assert.deepEqual(Array.from(view.sectionPlanes['external-cut'].pos),[1,2,3]);
  section.clear();assert.equal(Object.values(view.sectionPlanes).filter(p=>p.active).length,1);
  for(let n=0;n<3;n++)service.restore(id);
  assert.equal(Object.keys(view.sectionPlanes).length,2);
});

test('model key is independent of generated model IDs but changes with geometry, coordinates or the loaded set', t=>{
  const a=fixture(t),b=fixture(t,{modelId:'reimport-2026'}),c=fixture(t,{height:5});
  assert.equal(savedViewsModelKey(a.scene),savedViewsModelKey(b.scene));
  assert.notEqual(savedViewsModelKey(a.scene),savedViewsModelKey(c.scene));
  b.model.coordinateSystem.origin=[20,0,0];assert.notEqual(savedViewsModelKey(a.scene),savedViewsModelKey(b.scene));
  a.model.destroy();assert.equal(savedViewsModelKey(a.scene),'');
});

test('rename, delete and undo persist without affecting other model sets',async t=>{
  const storage=memoryStorage(),a=fixture(t,{storage}),b=fixture(t,{storage,height:9});
  await a.service.save('First');await a.service.save('Second');await b.service.save('Other building');
  const first=a.state.items.find(v=>v.name==='First');a.service.rename(first.id,'Entrance');
  a.service.remove(first.id);assert.equal(a.state.undoName,'Entrance');assert.equal(a.state.items.length,1);
  a.service.undoDelete();assert.equal(a.state.items[1].name,'Entrance');assert.equal(a.state.undoName,'');
  assert.equal(readSavedViews(storage,b.state.modelKey)[0].name,'Other building');
  assert.equal(readSavedViews(storage,a.state.modelKey).length,2);
});

test('quota, blocked storage and corrupt snapshots leave previously saved data intact',async t=>{
  const f=fixture(t);await f.service.save('Existing');const raw=f.storage.entries.get(savedViewsStoragePrefix+f.state.modelKey);
  const set=f.storage.setItem;f.storage.setItem=()=>{throw new Error('QuotaExceededError');};
  await f.service.save('Lost');assert.match(f.state.error,/not saved/);assert.equal(f.state.items.length,1);
  f.service.rename(f.state.items[0].id,'Renamed');assert.equal(f.state.items[0].name,'Existing');
  f.service.remove(f.state.items[0].id);assert.equal(f.state.items.length,1);
  assert.equal(f.storage.entries.get(savedViewsStoragePrefix+f.state.modelKey),raw);
  f.storage.setItem=set;const invalid=JSON.parse(raw);invalid.items[0].snapshot.camera.eye=[null,0,0];
  const broken=JSON.stringify(invalid);f.storage.entries.set(savedViewsStoragePrefix+f.state.modelKey,broken);
  f.service.open();assert.match(f.state.error,/could not be read/);await f.service.save('Overwrite');
  assert.equal(f.storage.entries.get(savedViewsStoragePrefix+f.state.modelKey),broken);
  f.storage.getItem=()=>{throw new Error('SecurityError');};f.service.open();assert.match(f.state.error,/could not be read/);
});

test('unload during thumbnail capture cancels the pending save and never writes into a new model set',async t=>{
  let finish;const f=fixture(t,{captureThumbnail:()=>new Promise(resolve=>{finish=resolve;})});
  const key=f.state.modelKey, pending=f.service.save('Stale');assert.equal(f.state.busy,true);
  f.model.destroy();finish('');await pending;
  assert.equal(f.state.modelKey,'');assert.equal(f.state.items.length,0);assert.equal(f.storage.getItem(savedViewsStoragePrefix+key),null);
  assert.match(f.state.error,/models changed/);assert.equal(f.state.busy,false);
});

test('missing floor metadata and changed model sets cannot partially restore a saved view',async t=>{
  const f=fixture(t);f.section.showFloorPlan('floor');await f.service.save('Floor');const id=f.state.items[0].id;
  f.section.returnTo3D();f.dm.destroy();const before=Array.from(f.camera.eye);
  f.service.restore(id);assert.equal(f.restores(),0);assert.deepEqual(Array.from(f.camera.eye),before);assert.match(f.state.error,/floor.*not loaded/);
  f.model.coordinateSystem.origin=[100,0,0];f.service.restore(id);assert.equal(f.restores(),0);assert.equal(f.state.items.length,0);
});

test('thumbnail copies only the matching rendered frame and releases its listener',async t=>{
  let listener,stops=0,draws=0;
  global.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){draws++;}}),toDataURL:()=> 'data:image/jpeg;base64,AAAA'})};
  t.after(()=>delete global.document);
  const view={needsRender(){}},renderer={events:{onViewRendered:{subscribe(fn){listener=fn;return()=>{stops++;};}}},getRenderedCanvas:()=>({width:1600,height:900})};
  const pending=captureViewThumbnail(renderer,view);listener(renderer,{});assert.equal(draws,0);
  listener(renderer,view);assert.equal(await pending,'data:image/jpeg;base64,AAAA');assert.equal(stops,1);assert.equal(draws,1);
});


test('Return to 3D deactivates section planes introduced by a recalled plan',async t=>{
  const f=fixture(t);f.section.showFloorPlan('floor');
  ok(f.view.createSectionPlane({id:'extra-plan-cut',pos:[1,0,0],dir:[1,0,0],active:true}));
  await f.service.save('Cut plan');const id=f.state.items[0].id;
  f.section.returnTo3D();assert.equal(f.view.sectionPlanes['extra-plan-cut'].active,false);
  f.service.restore(id);assert.equal(f.view.sectionPlanes['extra-plan-cut'].active,true);
  f.section.returnTo3D();assert.equal(f.view.sectionPlanes['extra-plan-cut'].active,false);
});
