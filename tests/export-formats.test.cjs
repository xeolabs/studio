const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const bundle = require("esbuild").buildSync({
  stdin: {contents: `
    export {Scene} from "@xeokit/sdk/model/scene";
    export {Data} from "@xeokit/sdk/model/data";
    export {TrianglesPrimitive, PointsPrimitive, GaussianSplatsPrimitive} from "@xeokit/sdk/base/constants";
    export {EXPORT_FORMATS, getExportFormat} from "./studio/services/exporters/exportFormatRegistry";
    export {EXPORT_DATA_SETS, exportFormatsForSelection} from "./studio/services/exportDialogDataSets";
    export {inspectExportContent} from "./studio/services/exportContent";
    export {exportFormatIssue, exportFormatNotices} from "./studio/services/exportFormatCompatibility";
    export {writeExportFiles} from "./studio/services/writeExportFiles";
    export {writeXGFStreamArchive} from "./studio/services/exporters/writeXGFStreamArchive";
    export {ExportDialogService, createExportDialogState} from "./studio/services/ExportDialogService";
    export {unzipSync} from "fflate";
  `, resolveDir: path.resolve(__dirname, "../src"), loader: "ts"},
  alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent"
}).outputFiles[0].text;
const output = {exports: {}};
new Function("module", "exports", "require", bundle)(output, output.exports, require);
const {Scene, Data, TrianglesPrimitive, PointsPrimitive, GaussianSplatsPrimitive,
  EXPORT_FORMATS, getExportFormat, EXPORT_DATA_SETS, exportFormatsForSelection, inspectExportContent,
  exportFormatIssue, exportFormatNotices, writeExportFiles, writeXGFStreamArchive,
  ExportDialogService, createExportDialogState, unzipSync} = output.exports;
const ok = result => {assert.equal(result.ok, true, result.error); return result.value;};
const dataset = id => EXPORT_DATA_SETS.find(format => format.id === id);

function fixture(t, primitive = TrianglesPrimitive) {
  const scene = new Scene(), data = new Data();
  t.after(() => {scene.destroy(); data.destroy();});
  const sm = ok(scene.createModel({id: "source", headless: true}));
  ok(sm.createGeometry({id: "geometry", primitive, positions: [0,0,0, 1,0,0, 0,1,0],
    indices: primitive === TrianglesPrimitive ? [0,1,2] : undefined,
    ...(primitive === GaussianSplatsPrimitive ? {
      scales: [1,1,1, 1,1,1, 1,1,1], rotations: [0,0,0,1, 0,0,0,1, 0,0,0,1], colors: [1,0,0,1, 0,1,0,1, 0,0,1,1]
    } : {})}));
  ok(sm.createMaterial({id: "paint", color: [0.2,0.4,0.6]}));
  ok(sm.createMesh({id: "mesh", geometryId: "geometry", materialId: "paint"}));
  ok(sm.createObject({id: "wall", meshIds: ["mesh"]}));
  const dm = ok(data.createModel({id: "semantics"}));
  ok(dm.createPropertySet({id: "p", name: "Common", type: "Pset", properties: [{name: "rating", value: "60"}]}));
  ok(dm.createObject({id: "wall", type: "Building", name: "Test wall", propertySetIds: ["p"]}));
  return {scene, data, sm, dm};
}

test("registry exposes every implemented scene encoder and both output variants", () => {
  assert.equal(EXPORT_FORMATS.length, 19);
  assert.equal(new Set(EXPORT_DATA_SETS.map(format => format.id)).size, EXPORT_DATA_SETS.length);
  for (const format of EXPORT_FORMATS) {
    assert.ok(dataset(format.id));
    assert.ok(EXPORT_DATA_SETS.some(option => option.sceneFormat === format.id && option.dataExtension));
  }
  assert.equal(exportFormatsForSelection(EXPORT_DATA_SETS, 0).length, 19);
  assert.equal(exportFormatsForSelection(EXPORT_DATA_SETS, 1).length, 24);
  assert.throws(() => getExportFormat("laz"), /Unsupported/);
});

for (const format of EXPORT_FORMATS.filter(format => format.id !== "ifc")) {
  for (const companion of [false, true]) {
    test(`${format.id} writes real ${companion ? "scene + data" : "scene-only"} output`, async t => {
      const primitive = format.id === "splat" ? GaussianSplatsPrimitive : format.id === "e57" ? PointsPrimitive : TrianglesPrimitive;
      const {sm, dm} = fixture(t, primitive);
      const selected = EXPORT_DATA_SETS.find(option => option.sceneFormat === format.id && !!option.dataExtension === companion);
      assert.equal(exportFormatIssue(selected, inspectExportContent([sm], companion ? [dm] : []), companion ? 1 : 0), "");
      const files = await writeExportFiles(selected, "test-model", sm, companion ? dm : undefined, {}, () => {});
      assert.equal(files.length, 1 + Number(companion) + Number(format.package === "obj-mtl"));
      assert.equal(files[0].blob.type, format.mime);
      for (const file of files) assert.ok(file.blob.size > 20, file.filename);
      if (companion) {
        const data = JSON.parse(await files.find(file => file.kind === "data").blob.text());
        assert.equal(data.objects[0].id, "wall");
        assert.equal(data.propertySets[0].properties[0].value, "60");
      }
      if (format.id === "obj") {
        assert.match(await files[0].blob.text(), /mtllib test-model\.mtl/);
        const material = await files.find(file => file.kind === "materials").blob.text();
        const reference = (await files[0].blob.text()).match(/usemtl (.+)/)[1];
        assert.ok(material.includes(`newmtl ${reference}`));
      }
      if (format.id === "dotbim") {
        const bim = JSON.parse(await files[0].blob.text());
        assert.deepEqual(bim.elements[0].rotation, {qx: 0, qy: 0, qz: 0, qw: 1});
        assert.equal(bim.elements[0].color.a, 255);
        if (companion) assert.equal(bim.elements[0].info.Name, "Test wall");
      }
      if (format.id === "xgfstream") {
        const entries = unzipSync(new Uint8Array(await files[0].blob.arrayBuffer()));
        assert.ok(entries["index.json"]);
        assert.ok(Object.keys(entries).some(name => name.endsWith(".xgf")));
        // Every generated relative file reference still resolves inside the archive.
        for (const [name, bytes] of Object.entries(entries).filter(([name]) => name.endsWith(".json"))) {
          const visit = value => {
            if (typeof value === "string" && /\.(xgf|json)$/.test(value)) assert.ok(entries[value] || entries[path.posix.join(path.posix.dirname(name), value)], `${name}: ${value}`);
            else if (value && typeof value === "object") Object.values(value).forEach(visit);
          };
          visit(JSON.parse(new TextDecoder().decode(bytes)));
        }
      }
    });
  }
}

test("native semantic exports consume DataModel without forcing a JSON companion", async t => {
  const {sm, dm} = fixture(t);
  // GeoJSON only exports property sets marked as GeoJSONProperties.
  ok(dm.createPropertySet({id: "geo", type: "GeoJSONProperties", properties: [{name: "Name", value: "Test wall"}]}));
  ok(dm.objects.wall.setPropertySetIds(["p", "geo"]));
  for (const id of ["dotbim", "cityjson", "geojson"]) {
    const files = await writeExportFiles(dataset(id), "native", sm, dm, {}, () => {});
    assert.equal(files.length, 1);
    const content = await files[0].blob.text();
    if (id === "cityjson") {
      // This SDK encoder preserves semantic types and hierarchy, not names.
      assert.equal(JSON.parse(content).CityObjects.wall.type, "Building");
    } else {
      assert.match(content, /Test wall/);
    }
  }
});

test("unsupported geometry is blocked or explicitly reported, never silently coerced", t => {
  const {sm} = fixture(t);
  const content = inspectExportContent([sm], []);
  assert.match(exportFormatIssue(dataset("e57"), content, 0), /cannot encode/);
  assert.match(exportFormatIssue(dataset("splat"), content, 0), /cannot encode/);
  const mixed = {...content, primitiveMeshes: {...content.primitiveMeshes, [GaussianSplatsPrimitive]: 2}};
  assert.match(exportFormatIssue(dataset("glb"), mixed, 0), /mixture/);
  assert.equal(exportFormatIssue(dataset("ply"), mixed, 0), "");
  assert.ok(exportFormatNotices(dataset("ply"), mixed, 0).some(notice => /2 mesh.*omitted/.test(notice)));
});

test("format limitations and IFC semantic fallback are explicit", t => {
  const {sm, dm} = fixture(t);
  const content = {...inspectExportContent([sm], [dm]), animations: 1, morphTargets: true, vertexStates: true, textures: true};
  assert.match(exportFormatIssue(dataset("ifc"), content, 1), /No IfcProject/);
  assert.equal(exportFormatIssue(dataset("ifc-json"), content, 1), "");
  assert.ok(exportFormatNotices(dataset("glb"), content, 0).some(notice => /animation/.test(notice)));
  assert.deepEqual(exportFormatNotices(dataset("xgf"), content, 0), []);
  assert.ok(exportFormatNotices(dataset("xgfstream"), content, 0).some(notice => /partitioning/.test(notice)));
});

test("native format and companion choices survive refresh and changing data selection", t => {
  const {scene, data, dm} = fixture(t), state = createExportDialogState();
  const service = new ExportDialogService({scene, data, state});
  t.after(() => service.dispose());
  service.open();
  service.setDataSet("geojson-json"); service.refreshModels();
  assert.equal(state.dataSetId, "geojson-json");
  service.clearSelection("data");
  assert.equal(state.dataSetId, "geojson");
  service.toggleDataModel(dm.id);
  assert.equal(state.dataSetId, "geojson");
  assert.equal(service.canExport(), true);
  service.setDataSet("e57-json");
  assert.equal(service.canExport(), false);
});

test("archive packaging rejects unsafe paths and keeps binary bytes intact", async () => {
  for (const name of ["../a.xgf", "/a.xgf", "a/../b.xgf", "a\\b.xgf", "https://host/a.xgf"]) {
    await assert.rejects(writeXGFStreamArchive({files: {[name]: new ArrayBuffer(4)}}), /Unsafe/);
  }
  const archive = await writeXGFStreamArchive({files: {"chunks/a.xgf": new Uint8Array([1,2,3,255]).buffer}});
  assert.deepEqual(unzipSync(archive)["chunks/a.xgf"], new Uint8Array([1,2,3,255]));
});
