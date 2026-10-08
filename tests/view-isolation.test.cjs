const test = require("node:test");
const assert = require("node:assert/strict");
require("tsx/cjs");
const {viewIsolation} = require("../src/studio/services/ViewIsolation.ts");
const {isolateSubtree} = require("../src/studio/explorers/ifc/isolateSubtree.ts");
const {showOnlyObject, showAll} = require("../src/studio/context-menu/objectActions.ts");

function fixture() {
  const view = {objects: {wall: {visible: true}, roof: {visible: false}, slab: {visible: true}},
    setObjectsVisible(ids, visible) { for (const id of ids) this.objects[id].visible = visible; }};
  const params = {view, selectionService: {resolveSceneObject: id => ({title: id})}};
  const visible = () => Object.keys(view.objects).filter(id => view.objects[id].visible);
  return {view, params, visible, isolation: viewIsolation(view)};
}

test("tree and element isolation share the original visibility state and restore hidden objects correctly", () => {
  const {view, params, visible, isolation} = fixture();
  const labels = [];
  const unsubscribe = isolation.onChanged(label => labels.push(label));
  isolateSubtree({view, getNodeObjectIds: () => ["wall", "roof"]}, {title: "Level 1"});
  assert.deepEqual(visible(), ["wall", "roof"]);
  showOnlyObject(params, "roof");
  assert.deepEqual(visible(), ["roof"]);
  isolation.restore();
  assert.deepEqual(visible(), ["wall", "slab"]);
  assert.deepEqual(labels, ["", "Level 1", "roof", ""]);
  unsubscribe();
});

test("empty targets do nothing and Show all exits isolation without leaving an old restore point", () => {
  const {view, params, visible, isolation} = fixture();
  isolation.isolate(["missing"], "Missing");
  assert.equal(isolation.label, "");
  assert.deepEqual(visible(), ["wall", "slab"]);
  isolation.isolate(["wall"], "Wall");
  showAll(params);
  assert.equal(isolation.label, "");
  isolation.restore();
  assert.deepEqual(visible(), ["wall", "roof", "slab"]);
  isolation.isolate(["slab"], "Slab");
  isolation.restore();
  assert.deepEqual(visible(), ["wall", "roof", "slab"]);
});

test("restore tolerates deleted objects, leaves newly imported objects alone, and does not affect another view", () => {
  const {view, isolation, visible} = fixture();
  const other = fixture();
  isolation.isolate(["wall"], "Wall");
  delete view.objects.slab;
  view.objects.newWall = {visible: true};
  isolation.restore();
  assert.deepEqual(visible(), ["wall", "newWall"]);
  assert.deepEqual(other.visible(), ["wall", "slab"]);
  assert.equal(other.isolation.label, "");
});

test("objects added between successive isolates keep their pre-isolation visibility", () => {
  const {view, isolation, visible} = fixture();
  isolation.isolate(["wall"], "Wall");
  view.objects.imported = {visible: true};
  isolation.isolate(["roof"], "Roof");
  isolation.restore();
  assert.deepEqual(visible(), ["wall", "slab", "imported"]);
});
