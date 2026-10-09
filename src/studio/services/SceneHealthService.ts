import type {Scene, SceneModel} from "@xeokit/sdk/model/scene";
import type {Issue} from "@xeokit/sdk/quality/sceneModel/Issue";
import {type InspectionReport} from "@xeokit/sdk/quality/sceneModel/InspectionReport";
import {type InspectSceneModelParams} from "@xeokit/sdk/quality/sceneModel/params/InspectSceneModelParams";
import {inspectSceneModelAsync} from "@xeokit/sdk/quality/sceneModel/tasks/inspectSceneModelAsync";
import {type ApplyFixesResult} from "@xeokit/sdk/quality/sceneModel/ApplyFixesResult";
import {DEFAULT_FIX_REGISTRY} from "@xeokit/sdk/quality/sceneModel/DEFAULT_FIX_REGISTRY";
import {applyFixesAsync} from "@xeokit/sdk/quality/sceneModel/tasks/applyFixesAsync";
import {descriptionForCode} from "@xeokit/sdk/quality/sceneModel/labels/descriptionForCode";
import {findResourceLabel} from "@xeokit/sdk/quality/sceneModel/labels/findResourceLabel";
import {labelForCode} from "@xeokit/sdk/quality/sceneModel/labels/labelForCode";
import {HealthFindings, type HealthFindingsQuery, type HealthFinding} from "./HealthFindings";
import type {HealthCleanupState, HealthCleanupRun} from "./HealthCleanupState";

export type SceneHealthStateName = "critical" | "warning" | "healthy" | "loading" | "unknown";
export type SceneHealthImpact = "critical" | "optimization" | "cleanup" | "misc";

export interface SceneHealthModelSummary {
  id: string;
  selected: boolean;
  status: SceneHealthStateName;
  errors: number;
  warnings: number;
  issueCount: number;
  objectCount: number;
  meshCount: number;
  geometryCount: number;
  materialCount: number;
  textureCount: number;
  transformCount: number;
}

export interface SceneHealthIssueRow {
  code: string;
  label: string;
  description: string;
  impact: SceneHealthImpact;
  severity: "error" | "warning" | "info";
  count: number;
  issues: Array<{
    message: string;
    summary: string;
    resourceId: string;
    resourceKind: string;
    resourceName: string;
  }>;
}

export interface SceneHealthPanelState extends HealthCleanupState {
  models: SceneHealthModelSummary[];
  selectedModelId: string;
  status: SceneHealthStateName;
  statusText: string;
  recommendation: string;
  errors: number;
  warnings: number;
  info: number;
  issueCount: number;
  progressLabel: string;
  progressCurrent: number;
  progressTotal: number;
  inspecting: boolean;
  stale: boolean;
  checkedAt: string | null;
  inspectionError: string | null;
  reportRevision: number;
  issueGroups: SceneHealthIssueRow[];
  stats: Array<{label: string; value: string}>;
}

export type SceneHealthCleanupRun = HealthCleanupRun;

interface LastFixOutcome {
  fixed: number;
  skipped: number;
  errors: number;
}

export interface SceneHealthServiceParams {
  scene: Scene;
  state: SceneHealthPanelState;
  inspectParams?: Partial<InspectSceneModelParams>;
}

const DEFAULT_INSPECT_PARAMS: Partial<InspectSceneModelParams> = {
  checkDuplicateGeometries: true,
  checkSimilarGeometries: true,
  checkDenseGeometries: true,
  checkLargeGeometries: true,
  checkGeometryQuality: true,
  checkObjectStructure: true,
  checkTextureSanity: true,
  checkGeometryFarFromOrigin: true
};

const IMPACT_BUCKETS: Readonly<Record<Exclude<SceneHealthImpact, "misc">, readonly string[]>> = {
  critical: [
    "GEOMETRY_NO_POSITIONS", "GEOMETRY_POSITIONS_LENGTH", "GEOMETRY_NORMALS_LENGTH",
    "GEOMETRY_UVS_LENGTH", "GEOMETRY_AABB_NONFINITE", "GEOMETRY_AABB_INVERTED",
    "GEOMETRY_INDICES_LENGTH", "GEOMETRY_INDEX_OUT_OF_RANGE",
    "MESH_DANGLING_GEOMETRY", "MESH_DANGLING_MATERIAL", "MESH_DANGLING_TRANSFORM",
    "MESH_NONFINITE_MATRIX", "OBJECT_DANGLING_MESH", "TRANSFORM_CYCLE",
    "MATERIAL_TEXTURED_GEOMETRY_NO_UVS", "MATERIAL_PBR_GEOMETRY_NO_NORMALS"
  ],
  optimization: [
    "GEOMETRY_DUPLICATE", "GEOMETRY_SIMILAR", "GEOMETRY_OVER_BUDGET",
    "GEOMETRY_OVER_EXTENT", "OBJECT_FAR_FROM_ORIGIN", "OBJECT_DUPLICATE_AABB",
    "GEOMETRY_FAR_FROM_ORIGIN", "TEXTURE_OVERSIZED"
  ],
  cleanup: [
    "MATERIAL_UNUSED", "TEXTURE_UNUSED", "TRANSFORM_UNUSED", "TRANSFORM_IDENTITY",
    "GEOMETRY_ZERO_VOLUME_AABB", "GEOMETRY_DEGENERATE_TRIANGLES",
    "GEOMETRY_UNUSED_VERTICES", "GEOMETRY_DUPLICATE_VERTICES",
    "GEOMETRY_NON_WATERTIGHT", "GEOMETRY_INCONSISTENT_WINDING",
    "GEOMETRY_AABB_NOT_TIGHT", "GEOMETRY_DUPLICATE_INDICES", "TEXTURE_NPOT"
  ]
};

const IMPACT_BY_CODE = new Map<string, SceneHealthImpact>();
for (const [impact, codes] of Object.entries(IMPACT_BUCKETS) as Array<[SceneHealthImpact, readonly string[]]>) {
  for (const code of codes) {
    IMPACT_BY_CODE.set(code, impact);
  }
}

export function createSceneHealthPanelState(): SceneHealthPanelState {
  return {
    models: [],
    selectedModelId: "",
    status: "unknown",
    statusText: "No SceneModel selected",
    recommendation: "Load a model to inspect scene health.",
    errors: 0,
    warnings: 0,
    info: 0,
    issueCount: 0,
    progressLabel: "",
    progressCurrent: 0,
    progressTotal: 0,
    inspecting: false,
    applying: false,
    stale: false,
    checkedAt: null,
    inspectionError: null,
    reportRevision: 0,
    fixableCodes: [],
    fixableIssueCount: 0,
    lastCleanupSummary: "",
    cleanupHistory: [],
    issueGroups: [],
    stats: []
  };
}

export class SceneHealthService {
  private readonly _scene: Scene;
  private readonly _state: SceneHealthPanelState;
  private readonly _inspectParams: Partial<InspectSceneModelParams>;
  private readonly _unsubscribers: Array<() => void> = [];
  private _abortController: AbortController | null = null;
  private _runId = 0;
  private _destroyed = false;
  private _refreshScheduled = false;
  private _lastReport: InspectionReport | null = null;
  private readonly _findings = new HealthFindings();
  private readonly _lastFixResultByCode = new Map<string, LastFixOutcome>();

  constructor(params: SceneHealthServiceParams) {
    this._scene = params.scene;
    this._state = params.state;
    this._inspectParams = {...DEFAULT_INSPECT_PARAMS, ...params.inspectParams};
    this._subscribe();
    this.refreshModels();
  }

  queryFindings(query: HealthFindingsQuery) {
    return this._findings.query(query);
  }

  refreshModels(): void {
    const models = Object.values(this._scene.models) as SceneModel[];
    if (!this._state.selectedModelId || !this._scene.models[this._state.selectedModelId]) {
      this._state.cleanupHistory.splice(0);
      this._state.lastCleanupSummary = "";
      this._lastFixResultByCode.clear();
      this._abortController?.abort();
      this._runId++;
      this._clearReport("Not checked", "Select Inspect to check this model.");
      this._state.selectedModelId = models[0]?.id || "";
    }
    this._state.models.splice(0, this._state.models.length, ...models.map((model) => this._summarizeModel(model)));
    this._state.stats.splice(0, this._state.stats.length, ...this._buildStats(this._selectedModel()));
    if (models.length === 0) {
      this._clearReport("No SceneModel selected", "Load a model to inspect scene health.");
    }
  }

  selectModel(modelId: string): void {
    if (this._state.applying || !this._scene.models[modelId]) {
      return;
    }
    if (this._state.selectedModelId === modelId && !this._state.stale) {
      return;
    }
    if (this._state.selectedModelId !== modelId) {
      this._abortController?.abort();
      this._runId++;
      this._state.cleanupHistory.splice(0);
      this._state.lastCleanupSummary = "";
      this._lastFixResultByCode.clear();
      this._clearReport("Not checked", "Select Inspect to check this model.");
    }
    this._state.selectedModelId = modelId;
    this.refreshModels();
  }

  /** Invalidate a report on edits; expensive geometry checks run only on Inspect. */
  private scheduleRefresh(): void {
    if (this._destroyed) return;
    this._state.stale = true;
    // Cleanup owns its mutations and the final verification report.
    if (this._state.applying) return;
    if (this._state.inspecting) {
      this._abortController?.abort();
      this._runId++;
      this._state.inspecting = false;
      this._state.progressLabel = "";
      this._state.status = "unknown";
      this._state.statusText = "Model changed";
      this._state.recommendation = "Select Inspect to check the updated model.";
    }
    if (this._refreshScheduled) return;
    this._refreshScheduled = true;
    requestAnimationFrame(() => {
      this._refreshScheduled = false;
      if (!this._destroyed && !this._state.applying) this.refreshModels();
    });
  }

  async inspectSelected(): Promise<void> {
    if (this._destroyed || this._state.applying) return;
    const model = this._selectedModel();
    if (!model) {
      this.refreshModels();
      return;
    }
    this._abortController?.abort();
    const abortController = new AbortController();
    this._abortController = abortController;
    const runId = ++this._runId;
    this._state.inspecting = true;
    this._state.inspectionError = null;
    this._state.applying = false;
    this._state.stale = false;
    this._state.status = "loading";
    this._state.statusText = "Inspecting...";
    this._state.recommendation = "Running scene-model inspections.";
    this._state.progressCurrent = 0;
    this._state.progressTotal = 0;
    this._state.progressLabel = "";
    this.refreshModels();

    try {
      const report = await inspectSceneModelAsync({
        ...this._inspectParams,
        sceneModel: model,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (runId !== this._runId) {
            return;
          }
          this._state.progressCurrent = progress.current;
          this._state.progressTotal = progress.total;
          this._state.progressLabel = progress.label || "";
        }
      });
      if (runId !== this._runId || this._destroyed) {
        return;
      }
      this._applyReport(model, report);
    } catch (error) {
      if (abortController.signal.aborted || runId !== this._runId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._clearReport("Inspection failed", message);
      this._state.inspectionError = message;
    } finally {
      if (runId === this._runId) {
        this._state.inspecting = false;
        this._state.progressLabel = "";
        this.refreshModels();
      }
    }
  }

  async cleanupAll(): Promise<void> {
    const codes = this._state.fixableCodes.slice();
    if (codes.length === 0) {
      return;
    }
    await this.cleanupCodes(codes, "Clean up all fixable issues");
  }

  async cleanupCodes(codes: string[], label = "Clean up issues"): Promise<void> {
    const model = this._selectedModel();
    if (!model || model.sealed || this._state.stale || this._state.inspecting || this._state.applying) {
      return;
    }
    this._abortController?.abort();
    const abortController = new AbortController();
    this._abortController = abortController;
    const runId = ++this._runId;
    this._state.applying = true;
    this._state.inspecting = false;
    this._state.progressCurrent = 0;
    this._state.progressTotal = 0;
    this._state.progressLabel = "Preparing cleanup...";

    try {
      const report = this._lastReport || await this._inspectModel(model, runId, abortController, "Inspecting before cleanup");
      if (runId !== this._runId || this._destroyed || !report) {
        return;
      }
      const activeCodes = codes.filter((code) => this._fixableCodes(report, model).includes(code));
      if (activeCodes.length === 0) {
        this._state.lastCleanupSummary = "No remaining fixable warning codes.";
        return;
      }
      this._state.progressLabel = "Applying cleanup fixes...";
      const result = await applyFixesAsync({
        sceneModel: model,
        report,
        codes: activeCodes,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (runId !== this._runId) {
            return;
          }
          this._state.progressCurrent = progress.current;
          this._state.progressTotal = progress.total;
          this._state.progressLabel = progress.label ? `Fixing: ${progress.label}` : "Applying cleanup fixes...";
        }
      });
      if (runId !== this._runId || this._destroyed || model.destroyed) return;
      if (result.ok === false) {
        this._recordCleanupError(label, activeCodes, result.error);
        return;
      }
      this._recordCleanupRun(label, activeCodes, result.value);
      this._state.progressLabel = "Re-inspecting after cleanup...";
      this._state.stale = false;
      const after = await this._inspectModel(model, runId, abortController, "Re-inspecting after cleanup");
      if (runId === this._runId && !this._destroyed && after) {
        this._applyReport(model, after);
      }
    } catch (error) {
      if (abortController.signal.aborted || runId !== this._runId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._recordCleanupError(label, codes, message);
    } finally {
      if (runId === this._runId) {
        this._state.applying = false;
        this._state.progressLabel = "";
        this._state.progressCurrent = 0;
        this._state.progressTotal = 0;
        this.refreshModels();
        if (this._state.stale) this.scheduleRefresh();
      }
    }
  }

  destroy(): void {
    this._destroyed = true;
    this._abortController?.abort();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
  }

  private _applyReport(model: SceneModel, report: InspectionReport): void {
    this._state.checkedAt = new Date().toISOString();
    this._state.inspectionError = null;
    this._state.reportRevision++;
    this._lastReport = report;
    const errors = report.errors.length;
    const warnings = report.warnings.length;
    const fixableCodes = this._fixableCodes(report, model);
    const fixableSet = new Set(fixableCodes);
    const fixableIssueCount = report.warnings.filter((issue) => fixableSet.has(issue.code)).length;
    this._state.errors = errors;
    this._state.warnings = warnings;
    this._state.info = report.info.length;
    this._state.issueCount = report.issues.length;
    this._state.fixableCodes.splice(0, this._state.fixableCodes.length, ...fixableCodes);
    this._state.fixableIssueCount = fixableIssueCount;
    if (errors > 0) {
      this._state.status = "critical";
      this._state.statusText = "Critical Issues Found";
      this._state.recommendation = `${errors} rendering-blocking error${errors === 1 ? "" : "s"} need manual triage.`;
    } else if (warnings > 0 && fixableCodes.length === 0) {
      this._state.status = "warning";
      this._state.statusText = "Needs Review";
      this._state.recommendation = model.sealed
        ? "This SceneModel is sealed. Re-import an editable model before applying cleanups."
        : `${warnings} warning${warnings === 1 ? "" : "s"} remain after available cleanup passes.`;
    } else if (warnings > 0) {
      this._state.status = "warning";
      this._state.statusText = "Needs Cleanup";
      this._state.recommendation = `Cleanup is available for ${fixableIssueCount} findings. Review its impact before applying.`;
    } else if (report.info.length > 0) {
      this._state.status = "healthy";
      this._state.statusText = "Informational findings";
      this._state.recommendation = "No errors or warnings. Review the informational findings below.";
    } else {
      this._state.status = "healthy";
      this._state.statusText = "No issues found";
      this._state.recommendation = "The enabled checks found no issues.";
    }
    const groups = Array.from(report.byCode.entries())
      .map(([code, issues]) => this._buildIssueGroup(model, code, issues))
      .sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || severityRank(a.severity) - severityRank(b.severity) || b.count - a.count);
    this._findings.replace(groups);
    this._state.issueGroups.splice(0, this._state.issueGroups.length, ...groups.map((group) => ({
      ...group, issues: group.issues.slice(0, 12)
    })));
  }

  private _buildIssueGroup(model: SceneModel, code: string, issues: Issue[]): SceneHealthIssueRow & {issues: HealthFinding[]} {
    const severity = issues.some((issue) => issue.severity === "error")
      ? "error"
      : issues.some((issue) => issue.severity === "warning")
        ? "warning"
        : "info";
    return {
      code,
      label: labelForCode(code),
      description: descriptionForCode(code),
      impact: IMPACT_BY_CODE.get(code) || "misc",
      severity,
      count: issues.length,
      issues: issues.map((issue) => {
        const resource = issue.resourceId ? findResourceLabel(model, issue.resourceId) : null;
        return {
          severity: issue.severity,
          message: issue.message,
          summary: issue.summary || "",
          resourceId: issue.resourceId || "",
          resourceKind: resource?.kind || "",
          resourceName: resource?.name || ""
        };
      })
    };
  }

  private _summarizeModel(model: SceneModel): SceneHealthModelSummary {
    const selected = model.id === this._state.selectedModelId;
    return {
      id: model.id,
      selected,
      status: selected ? this._state.status : "unknown",
      errors: selected ? this._state.errors : 0,
      warnings: selected ? this._state.warnings : 0,
      issueCount: selected ? this._state.issueCount : 0,
      objectCount: model.stats.numObjects,
      meshCount: model.stats.numMeshes,
      geometryCount: model.stats.numGeometries,
      materialCount: model.stats.numMaterials,
      textureCount: model.stats.numTextures,
      transformCount: model.stats.numTransforms
    };
  }

  private _buildStats(model: SceneModel | null): Array<{label: string; value: string}> {
    if (!model) {
      return [];
    }
    return [
      {label: "Objects", value: String(model.stats.numObjects)},
      {label: "Meshes", value: String(model.stats.numMeshes)},
      {label: "Geometries", value: String(model.stats.numGeometries)},
      {label: "Materials", value: String(model.stats.numMaterials)},
      {label: "Textures", value: String(model.stats.numTextures)},
      {label: "Transforms", value: String(model.stats.numTransforms)}
    ];
  }

  private _clearReport(statusText: string, recommendation: string): void {
    this._state.applying = false;
    this._state.checkedAt = null;
    this._state.inspectionError = null;
    this._state.reportRevision++;
    this._lastReport = null;
    this._findings.replace([]);
    this._state.status = "unknown";
    this._state.statusText = statusText;
    this._state.recommendation = recommendation;
    this._state.errors = 0;
    this._state.warnings = 0;
    this._state.info = 0;
    this._state.issueCount = 0;
    this._state.fixableCodes.splice(0, this._state.fixableCodes.length);
    this._state.fixableIssueCount = 0;
    this._state.issueGroups.splice(0, this._state.issueGroups.length);
    this._state.stats.splice(0, this._state.stats.length);
    this._state.inspecting = false;
    this._state.progressLabel = "";
    this._state.progressCurrent = 0;
    this._state.progressTotal = 0;
  }

  private async _inspectModel(
    model: SceneModel,
    runId: number,
    abortController: AbortController,
    fallbackLabel: string
  ): Promise<InspectionReport | null> {
    return inspectSceneModelAsync({
      ...this._inspectParams,
      sceneModel: model,
      signal: abortController.signal,
      onProgress: (progress) => {
        if (runId !== this._runId) {
          return;
        }
        this._state.progressCurrent = progress.current;
        this._state.progressTotal = progress.total;
        this._state.progressLabel = progress.label ? `${fallbackLabel}: ${progress.label}` : fallbackLabel;
      }
    });
  }

  private _fixableCodes(report: InspectionReport, model: SceneModel): string[] {
    // Several strategies rebuild meshes. Never let them partially delete a
    // sealed model, whose creation APIs would reject those replacements.
    if (model.sealed) return [];
    const attempted = new Set<string>();
    for (const [code, outcome] of this._lastFixResultByCode) {
      if (outcome.skipped > 0 || outcome.errors > 0) {
        attempted.add(code);
      }
    }
    const codes: string[] = [];
    const seen = new Set<string>();
    for (const issue of report.warnings) {
      if (seen.has(issue.code) || attempted.has(issue.code) || !DEFAULT_FIX_REGISTRY.get(issue.code)) {
        continue;
      }
      seen.add(issue.code);
      codes.push(issue.code);
    }
    return codes;
  }

  private _recordCleanupRun(label: string, codes: string[], result: ApplyFixesResult): void {
    const displaySkipped = result.skipped.filter((outcome) => outcome.reason !== "filter-excluded");
    const run = {
      timestamp: new Date().toISOString(),
      label,
      codes: codes.slice(),
      fixed: result.fixed.length,
      skipped: displaySkipped.length,
      errors: result.errors.length,
      errorMessage: ""
    };
    this._state.cleanupHistory.unshift(run);
    this._state.cleanupHistory.splice(6);
    this._state.lastCleanupSummary = cleanupSummary(run.fixed, run.skipped, run.errors);

    const touched = new Set<string>();
    for (const outcome of result.fixed) {
      touched.add(outcome.issue.code);
    }
    for (const outcome of displaySkipped) {
      touched.add(outcome.issue.code);
    }
    for (const outcome of result.errors) {
      touched.add(outcome.issue.code);
    }
    for (const code of touched) {
      this._lastFixResultByCode.delete(code);
    }
    this._recordOutcomesByCode(result.fixed, "fixed");
    this._recordOutcomesByCode(displaySkipped, "skipped");
    this._recordOutcomesByCode(result.errors, "errors");
  }

  private _recordCleanupError(label: string, codes: string[], errorMessage: string): void {
    this._state.lastCleanupSummary = `Cleanup failed: ${errorMessage}`;
    this._state.cleanupHistory.unshift({
      timestamp: new Date().toISOString(),
      label,
      codes: codes.slice(),
      fixed: 0,
      skipped: 0,
      errors: 1,
      errorMessage
    });
    this._state.cleanupHistory.splice(6);
  }

  private _recordOutcomesByCode(outcomes: ReadonlyArray<{issue: Issue}>, kind: keyof LastFixOutcome): void {
    for (const outcome of outcomes) {
      const code = outcome.issue.code;
      let row = this._lastFixResultByCode.get(code);
      if (!row) {
        row = {fixed: 0, skipped: 0, errors: 0};
        this._lastFixResultByCode.set(code, row);
      }
      row[kind]++;
    }
  }

  private _selectedModel(): SceneModel | null {
    return this._state.selectedModelId ? this._scene.models[this._state.selectedModelId] || null : null;
  }

  private _subscribe(): void {
    const events = this._scene.events;
    const topologyChanged = () => this.scheduleRefresh();
    const modelsChanged = () => {
      this.refreshModels();
      this.scheduleRefresh();
    };
    this._unsubscribers.push(
      events.onSceneModelCreated.subscribe(modelsChanged),
      events.onSceneModelDestroyed.subscribe(modelsChanged),
      events.onSceneModelBuildFinished.subscribe(topologyChanged),
      events.onSceneModelBatchCommitted.subscribe(topologyChanged),
      events.onSceneGeometryUpdated.subscribe(topologyChanged),
      events.onSceneMeshCreated.subscribe(topologyChanged),
      events.onSceneMeshDestroyed.subscribe(topologyChanged),
      events.onSceneObjectCreated.subscribe(topologyChanged),
      events.onSceneObjectDestroyed.subscribe(topologyChanged),
      events.onSceneDestroyed.subscribe(() => this.destroy())
    );
  }
}

function impactRank(impact: SceneHealthImpact): number {
  return impact === "critical" ? 0 : impact === "optimization" ? 1 : impact === "cleanup" ? 2 : 3;
}

function severityRank(severity: "error" | "warning" | "info"): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function cleanupSummary(fixed: number, skipped: number, errors: number): string {
  const parts = [`${fixed} fixed`];
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  if (errors > 0) {
    parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}
