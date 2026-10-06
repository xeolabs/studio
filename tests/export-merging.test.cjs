const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const bundle = require("esbuild").buildSync({
  stdin: {contents: `
    export {Scene} from "@xeokit/sdk/model/scene";
    export {Data} from "@xeokit/sdk/model/data";
    export {TrianglesPrimitive} from "@xeokit/sdk/base/constants";
    export {SceneModelImporter} from "@xeokit/sdk/formats/scenemodel";
    export {DataModelImporter} from "@xeokit/sdk/formats/datamodel";
    export {XGFLoader} from "@xeokit/sdk/formats/xgf";
    export {WebIO} from "@gltf-transform/core";
    export {mergeSceneModelParams, mergeDataModelParams} from "./studio/services/exportModelMerging";
    export {ExportDialogService, createExportDialogState} from "./studio/services/ExportDialogService";
    export {exportCoordinateSystemIssue} from "./studio/services/exportCoordinateSystems";
    export {exportSelectionIssue} from "./studio/services/exportAvailability";
    export {sceneModelOption} from "./studio/services/exportModelOptions";
  `, resolveDir: path.resolve(__dirname, "../src"), loader: "ts"},
  alias: {
    "@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src"),
    "@gltf-transform/core": require.resolve("@gltf-transform/core", {paths: [path.resolve(__dirname, "../vendor/xeokit-sdk")]})
  },
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
const output = {exports: {}};
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {Scene, Data, TrianglesPrimitive, SceneModelImporter, DataModelImporter,
  mergeSceneModelParams, mergeDataModelParams, ExportDialogService, createExportDialogState,
  exportCoordinateSystemIssue, exportSelectionIssue, sceneModelOption, XGFLoader, WebIO} = output.exports;
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};
const sceneParams = models => models.map(model => ok(model.toParams()));
const dataParams = models => models.map(model => ok(model.toParams()));

function fixture(t, textured = true) {
  const scene = new Scene(), data = new Data(), state = createExportDialogState();
  const service = new ExportDialogService({scene, data, state});
  const sceneModels = [], dataModels = [];
  for (const suffix of ["a", "b"]) {
    const sm = ok(scene.createModel({id: `scene-${suffix}`}));
    ok(sm.createGeometry({id: "geometry", primitive: TrianglesPrimitive,
      positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2],
      morphTargets: [{positions: [0,0,0, 0,0,1, 0,0,0]}]}));
    if (textured) ok(sm.createTexture({id: "texture", imageData: {width: 1, height: 1, data: [255,255,255,255]}}));
    ok(sm.createMaterial({id: "material", colorTextureId: textured ? "texture" : undefined}));
    ok(sm.createTransform({id: "root", position: [suffix === "a" ? -2 : 2,0,0]}));
    ok(sm.createTransform({id: "child", parentTransformId: "root"}));
    ok(sm.createMesh({id: "mesh", geometryId: "geometry", materialId: "material", parentTransformId: "child"}));
    ok(sm.createObject({id: `wall-${suffix}`, meshIds: ["mesh"], originalSystemId: `original-${suffix}`}));
    ok(sm.createVariantSet({id: "variants", defaultVariantId: "detailed", variants: [{id: "detailed", objectIds: [`wall-${suffix}`]}]}));
    ok(sm.createAnimation({id: "animation", channels: [
      {target: {type: "transform", transformId: "child", property: "translation"},
        sampler: {times: [0,1], values: [0,0,0, 1,0,0], interpolation: "LINEAR"}},
      {target: {type: "morphWeights", meshId: "mesh"}, sampler: {times: [0,1], values: [0,1], valueSize: 1}}
    ]}));
    sceneModels.push(sm);
    const dm = ok(data.createModel({id: `data-${suffix}`, schema: "IFC4"}));
    ok(dm.createPropertySet({id: "shared-properties", name: "Common", type: "Pset", properties: [{name: "FireRating", value: "60"}]}));
    ok(dm.createObject({id: "storey", name: "Level 1", type: "IfcBuildingStorey", propertySetIds: ["shared-properties"]}));
    ok(dm.createObject({id: `wall-${suffix}`, name: `Wall ${suffix}`, type: "IfcWall", propertySetIds: ["shared-properties"]}));
    ok(dm.createRelationship({type: "contains", relatingObjectId: "storey", relatedObjectId: `wall-${suffix}`}));
    dataModels.push(dm);
  }
  state.selectedSceneModelIds = sceneModels.map(model => model.id);
  state.selectedDataModelIds = dataModels.map(model => model.id).reverse();
  state.dataSetId = "scene-json-data-json";
  service.refreshModels();
  t.after(() => {scene.destroy(); data.destroy();});
  return {scene, data, sceneModels, dataModels, state, service};
}

function captureDownloads(t) {
  const files = [];
  t.mock.method(URL, "createObjectURL", blob => {files.push({blob}); return "blob:test";});
  t.mock.method(URL, "revokeObjectURL", () => {});
  const previousDocument = global.document, previousWindow = global.window;
  global.document = {createElement: () => ({style: {}, click() {files.at(-1).filename = this.download;}, remove() {}}), body: {appendChild() {}}};
  global.window = {setTimeout: callback => callback()};
  t.after(() => {global.document = previousDocument; global.window = previousWindow;});
  return files;
}

test("reversed Scene/Data selection preserves object IDs and links", t => {
  const {sceneModels, dataModels} = fixture(t);
  const reversedData = [...dataModels].reverse();
  const s = mergeSceneModelParams(sceneParams(sceneModels), sceneModels);
  const d = mergeDataModelParams(dataParams(reversedData), reversedData);
  assert.deepEqual(s.objects.map(object => object.id), ["wall-a", "wall-b"]);
  for (const object of s.objects) assert.ok(d.objects.some(dataObject => dataObject.id === object.id));
  assert.deepEqual(s.objects.map(object => object.originalSystemId), ["original-a", "original-b"]);
  assert.deepEqual(s.variantSets.flatMap(set => set.variants.flatMap(variant => variant.objectIds)), ["wall-a", "wall-b"]);
});

test("asset definitions and references remain collision-free, including animation targets", async t => {
  const {sceneModels} = fixture(t);
  const before = sceneParams(sceneModels), snapshot = JSON.stringify(before);
  const merged = mergeSceneModelParams(before, sceneModels);
  assert.equal(JSON.stringify(before), snapshot);
  for (const key of ["geometriesCompressed", "materials", "textures", "meshes", "transforms", "animations", "variantSets"]) {
    assert.equal(new Set(merged[key].map(component => component.id)).size, merged[key].length);
  }
  const scratch = new Scene(); t.after(() => scratch.destroy());
  const model = ok(scratch.createModel({id: "merged", headless: true}));
  await new SceneModelImporter().load({fileData: merged, sceneModel: model});
  assert.equal(model.headless, true);
  for (let i = 0; i < 2; i++) {
    const mesh = model.meshes[`export${i}:mesh`];
    assert.equal(mesh.geometry.id, `export${i}:geometry`);
    assert.equal(mesh.material.id, `export${i}:material`);
    assert.equal(mesh.parentTransform.id, `export${i}:child`);
    const params = ok(model.toParams());
    const child = params.transforms.find(transform => transform.id === `export${i}:child`);
    assert.equal(child.parentTransformId, `export${i}:root`);
    assert.equal(params.materials[i].colorTextureId, `export${i}:texture`);
    assert.deepEqual(params.animations[i].channels.map(channel => channel.target), [
      {type: "transform", transformId: `export${i}:child`, property: "translation"},
      {type: "morphWeights", meshId: `export${i}:mesh`}
    ]);
  }
});

test("shared DataObjects and property sets export once and relationships retain their endpoints", async t => {
  const {dataModels} = fixture(t);
  assert.equal(dataModels[0].objects.storey, dataModels[1].objects.storey);
  const merged = mergeDataModelParams(dataParams(dataModels), dataModels);
  assert.equal(merged.objects.length, 3);
  assert.equal(merged.propertySets.length, 1);
  assert.equal(merged.schema, "IFC4");
  const scratch = new Data(); t.after(() => scratch.destroy());
  const model = ok(scratch.createModel({id: "merged", schema: merged.schema}));
  await new DataModelImporter().load({fileData: merged, dataModel: model});
  assert.equal(model.objects.storey.propertySets[0].id, "shared-properties");
  assert.deepEqual(ok(model.toParams()).relationships.map(relation => relation.relatedObjectId), ["wall-a", "wall-b"]);
});

test("shared object property-set references are unioned and repeated edges are deduplicated", t => {
  const {data, dataModels} = fixture(t);
  const [a, b] = dataModels;
  ok(a.createPropertySet({id: "extra", name: "Extra", type: "Pset", properties: []}));
  // Reuse an object with two sets through a model that owns only one set.
  ok(a.createObject({id: "shared", name: "Shared", type: "IfcWall", propertySetIds: ["shared-properties", "extra"]}));
  ok(b.createObject({id: "shared", name: "Shared", type: "IfcWall", propertySetIds: ["shared-properties"]}));
  for (const model of [a, b]) ok(model.createRelationship({type: "contains", relatingObjectId: "storey", relatedObjectId: "shared"}));
  const sources = [b, a], params = dataParams(sources), before = JSON.stringify(params);
  const merged = mergeDataModelParams(params, sources);
  assert.equal(JSON.stringify(params), before);
  assert.deepEqual(merged.objects.find(object => object.id === "shared").propertySetIds, ["shared-properties", "extra"]);
  assert.equal(merged.relationships.filter(relation => relation.relatedObjectId === "shared").length, 1);
  assert.equal(data.objects.shared.models.length, 2);
});

test("same IDs from unrelated Data instances are not silently deduplicated", t => {
  const {dataModels} = fixture(t);
  const separate = new Data(); t.after(() => separate.destroy());
  const unrelated = ok(separate.createModel({id: "unrelated"}));
  assert.throws(() => mergeDataModelParams(dataParams([dataModels[0], unrelated]), [dataModels[0], unrelated]), /same Data/);
});

for (const component of ["basis", "origin", "units", "scaleToMeters"]) {
  test(`mixed coordinate ${component} is blocked in the UI contract, service, and merge`, async t => {
    const {sceneModels, dataModels, state, service} = fixture(t);
    const a = sceneParams(sceneModels);
    const change = {basis: [1,0,0, 0,1,0, 0,0,-1], origin: [1,0,0], units: "millimeters", scaleToMeters: 0.5};
    sceneModels[1].coordinateSystem[component] = change[component];
    service.refreshModels();
    const issue = exportSelectionIssue(service.activeDataSet, 2, 2, state.sceneModels);
    assert.match(issue, /different coordinate systems/);
    assert.match(issue, /scene-a/); assert.match(issue, /scene-b/);
    assert.equal(service.canExport(), false);
    assert.throws(() => mergeSceneModelParams(a, sceneModels), /coordinate systems/);
    await service.exportSelected();
    assert.equal(state.errorText, issue);
    assert.equal(state.loading, false);
    assert.equal(state.lastExportedFiles.length, 0);
    assert.equal(dataModels[0].destroyed, false);
  });
}

test("equal coordinate values are compatible and snapshots are detached", t => {
  const {sceneModels} = fixture(t);
  const options = sceneModels.map(model => sceneModelOption(model, true));
  assert.equal(exportCoordinateSystemIssue(sceneModels), "");
  options[0].coordinateSystem.origin[0] = 99;
  assert.equal(sceneModels[0].coordinateSystem.origin[0], 0);
});

test("JSON export writes all selected models without changing source IDs or sharing", async t => {
  const {scene, data, sceneModels, dataModels, state, service} = fixture(t);
  const files = captureDownloads(t);
  const before = JSON.stringify([sceneParams(sceneModels), dataParams(dataModels)]);
  await service.exportSelected();
  assert.equal(state.errorText, ""); assert.equal(files.length, 2);
  const s = JSON.parse(await files[0].blob.text()), d = JSON.parse(await files[1].blob.text());
  assert.deepEqual(s.objects.map(object => object.id).sort(), ["wall-a", "wall-b"]);
  assert.deepEqual(d.objects.map(object => object.id).sort(), ["storey", "wall-a", "wall-b"]);
  assert.equal(d.propertySets.length, 1);
  assert.equal(JSON.stringify([sceneParams(sceneModels), dataParams(dataModels)]), before);
  assert.equal(Object.keys(scene.models).length, 2); assert.equal(Object.keys(data.models).length, 2);
  assert.equal(data.objects.storey.models.length, 2);
});

for (const counts of [[1,2], [2,1], [1,1]]) {
  test(`links survive ${counts[0]} SceneModel(s) and ${counts[1]} DataModel(s)`, async t => {
    const {state, service} = fixture(t);
    const files = captureDownloads(t);
    state.selectedSceneModelIds = ["scene-a", "scene-b"].slice(0, counts[0]);
    state.selectedDataModelIds = ["data-a", "data-b"].slice(0, counts[1]);
    await service.exportSelected();
    assert.equal(state.errorText, "");
    const s = JSON.parse(await files[0].blob.text()), d = JSON.parse(await files[1].blob.text());
    assert.ok(s.objects.some(object => object.id === "wall-a"));
    assert.ok(d.objects.some(object => object.id === "wall-a"));
  });
}

test("temporary Scene and Data containers are disposed after exporter failure", async t => {
  const {service, sceneModels, dataModels, state} = fixture(t);
  let scratchScene, scratchData;
  service._buildDownloads = async (_format, sceneModel, dataModel) => {
    scratchScene = sceneModel.scene; scratchData = dataModel.data;
    assert.equal(sceneModel.headless, true);
    throw new Error("simulated encoder failure");
  };
  await service.exportSelected();
  assert.match(state.errorDetails, /simulated encoder failure/);
  assert.equal(scratchScene.destroyed, true); assert.equal(scratchData.destroyed, true);
  assert.ok(sceneModels.every(model => !model.destroyed));
  assert.ok(dataModels.every(model => !model.destroyed));
});

test("XGF round trip retains both objects and their Data links", async t => {
    const {state, service} = fixture(t, false);
    state.dataSetId = "xgf-json";
    const files = captureDownloads(t);
    await service.exportSelected();
    assert.equal(state.errorText, ""); assert.equal(files.length, 2);
    const scene = new Scene(), data = new Data();
    t.after(() => {scene.destroy(); data.destroy();});
    const sceneModel = ok(scene.createModel({id: "round-trip"}));
    const dataModel = ok(data.createModel({id: "round-trip"}));
    await new XGFLoader().load({fileData: await files[0].blob.arrayBuffer(), sceneModel});
    await new DataModelImporter().load({fileData: JSON.parse(await files[1].blob.text()), dataModel});
    assert.deepEqual(Object.keys(sceneModel.objects).sort(), ["wall-a", "wall-b"]);
    for (const id of Object.keys(sceneModel.objects)) assert.ok(dataModel.objects[id]);
    assert.equal(Object.keys(sceneModel.animations).length, 2);
    assert.equal(Object.keys(dataModel.objects).length, 3);
});

test("GLB output retains SceneObject node names matching its companion Data JSON", async t => {
  const {state, service} = fixture(t, false);
  state.dataSetId = "glb-json";
  const files = captureDownloads(t);
  await service.exportSelected();
  assert.equal(state.errorText, ""); assert.equal(files.length, 2);
  const document = await new WebIO().readBinary(new Uint8Array(await files[0].blob.arrayBuffer()));
  const nodes = document.getRoot().listNodes();
  const dataParams = JSON.parse(await files[1].blob.text());
  for (const id of ["wall-a", "wall-b"]) {
    assert.ok(nodes.some(node => node.getName() === id));
    assert.ok(dataParams.objects.some(object => object.id === id));
  }
});
