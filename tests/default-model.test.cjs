const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const modelDirectory = path.resolve(__dirname, "../public/models/Duplex");

test("Studio's Duplex dataset includes a valid IFC hierarchy and property references", () => {
  const model = JSON.parse(fs.readFileSync(path.join(modelDirectory, "datamodel/model.json")));
  const objects = new Map(model.objects.map(object => [object.id, object]));
  const sets = new Set(model.propertySets.map(set => set.id));
  assert.ok(objects.size > 0);
  assert.equal(objects.size, model.objects.length);
  assert.equal(sets.size, model.propertySets.length);
  assert.ok(model.objects.some(object => object.type === "IfcBuildingStorey"));
  assert.ok(model.objects.some(object => object.type === "IfcWall"));
  for (const object of model.objects) {
    assert.equal(typeof object.type, "string");
    for (const id of object.propertySetIds) assert.ok(sets.has(id), `Missing property set ${id}`);
  }
  const edges = new Set();
  for (const relationship of model.relationships) {
    assert.ok(objects.has(relationship.relatingObjectId));
    assert.ok(objects.has(relationship.relatedObjectId));
    const key = JSON.stringify(relationship);
    assert.ok(!edges.has(key)); edges.add(key);
  }
  assert.ok(fs.statSync(path.join(modelDirectory, "xgf/model.xgf")).size > 0);
  const coordinateSystem = JSON.parse(fs.readFileSync(path.join(modelDirectory, "coordSys.json")));
  assert.equal(coordinateSystem.units, "meters");
});

test("Studio startup loads Duplex geometry and data", () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, "../src/studio/app/createRuntime.ts"), "utf8");
  assert.match(runtime, /models\/Duplex/);
  assert.match(runtime, /\/coordSys\.json/);
  assert.match(runtime, /new XGFLoader\(\)/);
  assert.match(runtime, /new DataModelImporter\(\)/);
  assert.doesNotMatch(runtime, /WestRiverSideHospital|IFCLoader/);
});
