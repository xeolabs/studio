const test = require("node:test"), assert = require("node:assert/strict");
require("tsx/cjs");
const {layoutPlanLabels, planObjectLabel} = require("../src/studio/services/planLabels.ts");
const label = (id, x, y, extra = {}) => ({id, text: id, title: id, x, y, width: 90, selected: false, priority: 50, size: 30, ...extra});

test("thousands of candidates are constrained by space, not a fixed count", () => {
  for (const [width,height] of [[320,237],[390,700],[644,627],[1400,900]]) {
    const candidates = Array.from({length: 3000}, (_,i) => label(String(i), 70+(i%10)*125, 60+Math.floor(i/10)*70));
    const result = layoutPlanLabels(candidates,width,height);
    if (width === 1400) assert.ok(result.length > 6);
    for (const [index,a] of result.entries()) {
      assert.ok(a.x >= 8 && a.y >= 8 && a.x+a.width <= width-8 && a.y+35 <= height-8);
      for (const b of result.slice(index+1)) {
        assert.ok(a.x+a.width+64 <= b.x || b.x+b.width+64 <= a.x || a.y+35+64 <= b.y || b.y+35+64 <= a.y);
      }
    }
  }
});
test("density progressively fills available space while keeping labels apart", () => {
  const candidates = Array.from({length: 100}, (_,i) => label(String(i),60+(i%10)*80,60+Math.floor(i/10)*48,{width:52}));
  const results = ["sparse", "balanced", "dense"].map(density => layoutPlanLabels([...candidates],900,600,new Set(),[],density));
  assert.ok(results[0].length < results[1].length);
  assert.ok(results[1].length < results[2].length);
  assert.equal(results[2].length,100);
  assert.deepEqual(layoutPlanLabels([...candidates],900,600),results[0]);
});
test("zooming apart eligible objects reveals labels that previously collided", () => {
  const candidates = [label("a",150,200),label("b",230,200)];
  assert.equal(layoutPlanLabels(candidates,644,627).length,1);
  assert.equal(layoutPlanLabels(candidates.map(l=>({...l,x:l.x*2})),644,627).length,2);
});
test("overlapping, tiny and offscreen labels are omitted; the selected item wins collisions", () => {
  const result = layoutPlanLabels([label("regular",100,100),label("selected",105,101,{selected:true}),
    label("offscreen",-10,80),label("tiny",300,200,{size:5}),label("separate",300,300)],644,627);
  assert.deepEqual(result.map(l=>l.id),["selected","separate"]);
});
test("previous labels remain stable among otherwise equal candidates", () => {
  const result = layoutPlanLabels([label("a",100,100),label("b",101,100)],390,700,new Set(["b"]));
  assert.equal(result[0].id,"b");
  assert.equal(planObjectLabel("IfcFurnishingElement","M_Bed-Standard:1525 x 2007mm:168449"),"Bed Standard");
  assert.equal(planObjectLabel("IfcSpace","A203"),"A203");
});

test("plan controls and open flyouts reserve space at every density", () => {
  for (const density of ["sparse", "balanced", "dense"]) {
    const result = layoutPlanLabels([label('under-toolbar',100,100,{selected:true}), label('clear',300,300)],
      390,700,new Set(),[[0,0,220,120]],density);
    assert.deepEqual(result.map(label=>label.id),['clear']);
  }
});

test("density commands enable labels, retain the chosen density when off, and reject invalid values", () => {
  const {createSectionState} = require("../src/studio/state/sectionState.ts");
  const {registerSectionCommands} = require("../src/studio/commands/registerSectionCommands.ts");
  const state = createSectionState(), commands = new Map();
  registerSectionCommands({register: command => commands.set(command.id, command)}, {}, state);
  const choose = value => commands.get("section.labelDensity").run(value);
  assert.equal(state.labelDensity, "sparse");
  choose("dense");
  assert.equal(state.labelsEnabled, true);
  assert.equal(state.labelDensity, "dense");
  choose("off");
  assert.equal(state.labelsEnabled, false);
  assert.equal(state.labelDensity, "dense");
  choose("invalid");
  assert.equal(state.labelsEnabled, false);
  assert.equal(state.labelDensity, "dense");
  commands.get("section.labels").run();
  assert.equal(state.labelsEnabled, true);
  assert.equal(state.labelDensity, "dense");
});
