const assert = require("node:assert/strict");
const test = require("node:test");
require("tsx/cjs");
const {HealthFindings} = require("../src/studio/services/HealthFindings.ts");
const {CommandRegistry} = require("../src/studio/commands/CommandRegistry.ts");
const {registerDiagnosticCommands} = require("../src/studio/commands/registerDiagnosticCommands.ts");
const {createHealthIssueGroup} = require("../src/studio/components/health/HealthIssueGroup.ts");

function fixture() {
  const findings = new HealthFindings();
  findings.replace([{code: "DUP", label: "Duplicate vertices", issues: Array.from({length: 53}, (_, i) => ({
    severity: i % 2 ? "warning" : "error", message: `Full message ${i}`, summary: "Repeated vertex",
    resourceId: `geometry-${i}`, resourceKind: "geometry", resourceName: i === 52 ? "Roof" : ""
  }))}]);
  return findings;
}

test("health summary queries count every finding without returning reactive rows", () => {
  const result = fixture().query({});
  assert.equal(result.total, 53);
  assert.deepEqual(result.groups, [{code: "DUP", count: 53, severity: "error"}]);
  assert.deepEqual(result.rows, []);
});

test("all findings are reachable in bounded pages, including beyond the former 12-row cap", () => {
  const findings = fixture();
  const rows = [1, 2, 3].flatMap((page) => findings.query({code: "DUP", page}).rows);
  assert.equal(rows.length, 53);
  assert.equal(new Set(rows.map((row) => row.resourceId)).size, 53);
  assert.equal(findings.query({code: "DUP", page: 2}).rows[0].resourceId, "geometry-20");
  assert.equal(findings.query({code: "DUP", page: 999}).page, 3);
  assert.equal(findings.query({code: "DUP", page: -1}).page, 1);
  assert.equal(findings.query({code: "DUP", page: NaN}).page, 1);
});

test("search combines category, resource name, IDs and full messages across the entire report", () => {
  const findings = fixture();
  assert.equal(findings.query({search: "ROOF duplicate"}).total, 1);
  assert.equal(findings.query({search: "geometry-52", code: "DUP"}).rows[0].resourceName, "Roof");
  assert.equal(findings.query({search: "full message 51", code: "DUP"}).rows[0].resourceId, "geometry-51");
  assert.equal(findings.query({search: "absent"}).total, 0);
  assert.equal(findings.query({search: "geometry-52", severity: "warning"}).total, 0);
});

test("mixed-severity categories filter individual findings, not just the category severity", () => {
  const findings = fixture();
  assert.equal(findings.query({severity: "error"}).total, 27);
  assert.equal(findings.query({severity: "warning"}).total, 26);
  assert.equal(findings.query({severity: "warning"}).groups[0].severity, "warning");
  assert.equal(findings.query({severity: "info"}).total, 0);
  assert.ok(findings.query({code: "DUP", severity: "warning"}).rows.every((row) => row.severity === "warning"));
});

// Exercise both real service projections without constructing the rendering runtime.
for (const domain of ["Scene", "Data"]) {
  test(`${domain} Health keeps full findings outside panel state and clears them with the report`, () => {
    const path = require("node:path");
    const code = require("esbuild").buildSync({
      entryPoints: [path.resolve(__dirname, `../src/studio/services/${domain}HealthService.ts`)],
      alias: {"@xeokit/sdk": path.resolve(__dirname, "../vendor/xeokit-sdk/src")},
      bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent"
    }).outputFiles[0].text;
    const output = {exports: {}};
    new Function("module", "exports", "require", code)(output, output.exports, require);
    const state = output.exports[`create${domain}HealthPanelState`]();
    const service = Object.create(output.exports[`${domain}HealthService`].prototype);
    Object.assign(service, {_state: state, _findings: new HealthFindings(), _lastFixResultByCode: new Map()});
    const issues = Array.from({length: 55}, (_, i) => ({code: "CUSTOM_CHECK", severity: "warning", resourceId: `g${i}`, message: `Finding ${i}`}));
    const report = {issues, errors: [], warnings: issues, info: [], byCode: new Map([["CUSTOM_CHECK", issues]]), inspectionsRun: []};
    const model = {id: "model", objects: {}, meshes: {}, geometries: {}, materials: {}, textures: {}, transforms: {}, propertySets: {}, relationships: [], objectsByType: {}};
    service._applyReport(model, report);
    assert.equal(state.issueGroups[0].issues.length, 12);
    assert.equal(service.queryFindings({}).total, 55);
    assert.equal(service.queryFindings({code: "CUSTOM_CHECK", page: 3}).rows.length, 15);
    const revision = state.reportRevision;
    service._clearReport("Not checked", "Select a model");
    assert.equal(service.queryFindings({}).total, 0);
    assert.equal(state.checkedAt, null);
    assert.ok(state.reportRevision > revision);
    const info = [{code: "INFO", severity: "info", message: "Review"}];
    service._applyReport(model, {issues: info, errors: [], warnings: [], info, byCode: new Map([["INFO", info]]), inspectionsRun: []});
    assert.equal(state.statusText, "Informational findings");
    assert.equal(service.queryFindings({severity: "info"}).total, 1);
  });
}

test("report replacement and returned-row edits cannot retain or alter previous report rows", () => {
  const findings = fixture();
  findings.query({code: "DUP"}).rows[0].resourceId = "edited";
  assert.equal(findings.query({code: "DUP"}).rows[0].resourceId, "geometry-0");
  findings.replace([]);
  assert.deepEqual(findings.query({code: "DUP", page: 3}), {groups: [], total: 0, page: 1, pageSize: 20, rows: []});
});

test("collapsed issue categories do not request rows; fit targets the issue, not current selection", () => {
  const reads = [];
  const watchers = [];
  const Vue = {inject: () => ({}), ref: (value) => ({value}),
    computed: (fn) => ({get value() {return fn();}}), watch: (_fn, callback) => watchers.push(callback), nextTick: (fn) => fn()};
  const props = {domain: "scene", modelId: "health-model", group: {code: "DUP"}, query: {}, revision: 1,
    reader: {queryFindings: (query) => {reads.push(query); return fixture().query(query);}}};
  const panel = createHealthIssueGroup(Vue).setup(props);
  assert.equal(panel.findings.value, null);
  assert.equal(reads.length, 0);
  panel.expanded.value = true;
  assert.equal(panel.findings.value.rows.length, 20);
  panel.changePage(2);
  assert.equal(panel.findings.value.rows[0].resourceId, "geometry-20");
  watchers[0]();
  assert.equal(panel.findings.value.page, 1);
  assert.deepEqual(panel.target({resourceId: "specific-geometry", resourceKind: "geometry"}), {
    domain: "scene", modelId: "health-model", resourceId: "specific-geometry", resourceKind: "geometry"
  });
});

test("category cleanup respects the command's current report and payload enablement", () => {
  const commands = new CommandRegistry();
  const state = {selectedModelId: "model", stale: false, inspecting: false, applying: false, fixableCodes: ["DUP"]};
  registerDiagnosticCommands({commands, sceneHealthPanelState: state, actions: {}});
  assert.equal(commands.isEnabled("sceneHealth.cleanupCodes", ["DUP"]), true);
  assert.equal(commands.isEnabled("sceneHealth.cleanupCodes", ["UNKNOWN"]), false);
  assert.equal(commands.isEnabled("sceneHealth.cleanupCodes"), false);
  state.stale = true;
  assert.equal(commands.isEnabled("sceneHealth.cleanupCodes", ["DUP"]), false);
});
