import type {Data, DataModel} from "@xeokit/sdk/model/data";
import type {DataFormatSchema} from "@xeokit/sdk/quality/dataModel/DataFormatSchema";
import type {Issue} from "@xeokit/sdk/quality/dataModel/Issue";
import type {InspectionReport} from "@xeokit/sdk/quality/dataModel/InspectionReport";
import type {InspectDataModelParams} from "@xeokit/sdk/quality/dataModel/params/InspectDataModelParams";
import {inspectDataModelAsync} from "@xeokit/sdk/quality/dataModel/tasks/inspectDataModelAsync";
import {descriptionForCode} from "@xeokit/sdk/quality/dataModel/labels/descriptionForCode";
import {labelForCode} from "@xeokit/sdk/quality/dataModel/labels/labelForCode";
import {HealthFindings, type HealthFindingsQuery, type HealthFinding} from "./HealthFindings";
import type {HealthCleanupState, HealthCleanupRun} from "./HealthCleanupState";
import {applyDataReferenceCleanup, canCleanDataIssue} from "./dataPropertySetCleanups";

export type DataHealthStateName = "critical" | "warning" | "healthy" | "loading" | "unknown";
export type DataHealthImpact = "structural" | "conformance" | "cleanup";

export interface DataHealthModelSummary {
  id: string;
  schema: string;
  selected: boolean;
  status: DataHealthStateName;
  errors: number;
  warnings: number;
  issueCount: number;
  objectCount: number;
  propertySetCount: number;
  relationshipCount: number;
  typeCount: number;
}

export interface DataHealthIssueRow {
  code: string;
  label: string;
  description: string;
  impact: DataHealthImpact;
  severity: "error" | "warning" | "info";
  count: number;
  issues: Array<{
    message: string;
    summary: string;
    resourceId: string;
  }>;
}

export interface DataHealthPanelState extends HealthCleanupState {
  models: DataHealthModelSummary[];
  selectedModelId: string;
  status: DataHealthStateName;
  statusText: string;
  recommendation: string;
  errors: number;
  warnings: number;
  info: number;
  issueCount: number;
  inspectionsRun: number;
  reportRevision: number;
  progressLabel: string;
  progressCurrent: number;
  progressTotal: number;
  inspecting: boolean;
  stale: boolean;
  checkedAt: string | null;
  inspectionError: string | null;
  issueGroups: DataHealthIssueRow[];
  stats: Array<{label: string; value: string}>;
}

export interface DataHealthServiceParams {
  data: Data;
  state: DataHealthPanelState;
  schemas?: Record<string, DataFormatSchema>;
  inspectParams?: Partial<InspectDataModelParams>;
}

const DEFAULT_INSPECT_PARAMS: Partial<InspectDataModelParams> = {
  checkSchemaTagging: true,
  checkRelationshipTypeBinding: true,
  checkRelationshipCycles: true,
  checkIfcSpatialHierarchy: true,
  checkIfcElementContainment: true
};

const IMPACT_BUCKETS: Readonly<Record<DataHealthImpact, readonly string[]>> = {
  structural: [
    "OBJECT_MISSING_TYPE",
    "OBJECT_UNKNOWN_TYPE",
    "RELATIONSHIP_UNKNOWN_TYPE",
    "RELATIONSHIP_FORBIDDEN_RELATING_TYPE",
    "RELATIONSHIP_FORBIDDEN_RELATED_TYPE",
    "RELATIONSHIP_SELF_REFERENCE_FORBIDDEN",
    "RELATIONSHIP_CYCLE",
    "IFC_NO_PROJECT",
    "IFC_MULTIPLE_PROJECTS",
    "IFC_PROJECT_HAS_PARENT",
    "IFC_SPATIAL_PARENT_TYPE_MISMATCH"
  ],
  conformance: [
    "OBJECT_REQUIRED_PROPERTY_SET_MISSING",
    "OBJECT_FORBIDDEN_PROPERTY_SET",
    "OBJECT_SCHEMA_MISMATCH",
    "RELATIONSHIP_SCHEMA_MISMATCH",
    "IFC_SPATIAL_ORPHAN",
    "IFC_ELEMENT_AGGREGATED_NOT_CONTAINED"
  ],
  cleanup: [
    "OBJECT_DUPLICATE_PROPERTY_SET_REF",
    "RELATIONSHIP_SELF_REFERENCE"
  ]
};

const IMPACT_BY_CODE = new Map<string, DataHealthImpact>();
for (const [impact, codes] of Object.entries(IMPACT_BUCKETS) as Array<[DataHealthImpact, readonly string[]]>) {
  for (const code of codes) {
    IMPACT_BY_CODE.set(code, impact);
  }
}

export function createDataHealthPanelState(): DataHealthPanelState {
  return {
    models: [],
    selectedModelId: "",
    status: "unknown",
    statusText: "No DataModel selected",
    recommendation: "Load a model with semantic data to inspect Data health.",
    errors: 0,
    warnings: 0,
    info: 0,
    issueCount: 0,
    inspectionsRun: 0,
    applying: false,
    fixableCodes: [],
    fixableIssueCount: 0,
    lastCleanupSummary: "",
    cleanupHistory: [],
    reportRevision: 0,
    progressLabel: "",
    progressCurrent: 0,
    progressTotal: 0,
    inspecting: false,
    stale: false,
    checkedAt: null,
    inspectionError: null,
    issueGroups: [],
    stats: []
  };
}

export class DataHealthService {
  private readonly _data: Data;
  private readonly _state: DataHealthPanelState;
  private readonly _schemas: Record<string, DataFormatSchema>;
  private readonly _inspectParams: Partial<InspectDataModelParams>;
  private readonly _unsubscribers: Array<() => void> = [];
  private _abortController: AbortController | null = null;
  private _runId = 0;
  private _destroyed = false;
  private _refreshScheduled = false;
  private readonly _findings = new HealthFindings();
  private _lastReport: InspectionReport | null = null;

  constructor(params: DataHealthServiceParams) {
    this._data = params.data;
    this._state = params.state;
    this._schemas = params.schemas || {};
    this._inspectParams = {...DEFAULT_INSPECT_PARAMS, ...params.inspectParams};
    this._subscribe();
    this.refreshModels();
    void this.inspectSelected();
  }

  queryFindings(query: HealthFindingsQuery) {
    return this._findings.query(query);
  }

  refreshModels(): void {
    const models = Object.values(this._data.models) as DataModel[];
    if (!this._state.selectedModelId || !this._data.models[this._state.selectedModelId]) {
      this._state.cleanupHistory.splice(0);
      this._abortController?.abort();
      this._runId++;
      this._clearReport("Not checked", "Select Inspect to check this model.");
      this._state.selectedModelId = models[0]?.id || "";
    }
    this._state.models.splice(0, this._state.models.length, ...models.map((model) => this._summarizeModel(model)));
    this._state.stats.splice(0, this._state.stats.length, ...this._buildStats(this._selectedModel()));
    if (models.length === 0) {
      this._clearReport("No DataModel selected", "Load a model with semantic data to inspect Data health.");
    }
  }

  selectModel(modelId: string): void {
    if (this._state.applying || !this._data.models[modelId]) {
      return;
    }
    if (this._state.selectedModelId === modelId && !this._state.stale) {
      return;
    }
    if (this._state.selectedModelId !== modelId) {
      this._state.cleanupHistory.splice(0);
      this._clearReport("Not checked", "Select Inspect to check this model.");
    }
    this._state.selectedModelId = modelId;
    this.refreshModels();
    void this.inspectSelected();
  }

  scheduleInspect(): void {
    if (this._destroyed || this._refreshScheduled) {
      return;
    }
    this._state.stale = true;
    if (this._state.applying) return;
    this._refreshScheduled = true;
    requestAnimationFrame(() => {
      this._refreshScheduled = false;
      if (!this._destroyed && !this._state.applying) {
        this.refreshModels();
        void this.inspectSelected();
      }
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
    this._state.stale = false;
    this._state.status = "loading";
    this._state.statusText = "Inspecting...";
    this._state.recommendation = "Running DataModel inspections.";
    this._state.progressCurrent = 0;
    this._state.progressTotal = 0;
    this._state.progressLabel = "";
    this.refreshModels();

    try {
      const schema = model.schema ? this._schemas[model.schema] : undefined;
      const report = await inspectDataModelAsync({
        ...this._inspectParams,
        dataModel: model,
        ...(schema ? {schema} : {}),
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

  destroy(): void {
    this._destroyed = true;
    this._abortController?.abort();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
  }

  async cleanupCodes(codes: string[]): Promise<void> {
    const model = this._selectedModel();
    const report = this._lastReport;
    if (!model || !report || this._destroyed || this._state.stale || this._state.inspecting || this._state.applying) return;
    const allowed = new Set(codes.filter((code) => this._state.fixableCodes.includes(code)));
    if (!allowed.size) return;
    const targets = new Map<string, Set<string>>();
    for (const issue of report.issues) {
      if (!allowed.has(issue.code) || !canCleanDataIssue(model, issue)) continue;
      const targetCodes = targets.get(issue.resourceId!) || new Set<string>();
      targetCodes.add(issue.code);
      targets.set(issue.resourceId!, targetCodes);
    }
    this._abortController?.abort();
    const runId = ++this._runId;
    this._state.applying = true;
    this._state.progressTotal = targets.size;
    this._state.progressCurrent = 0;
    const run: HealthCleanupRun = {timestamp: new Date().toISOString(), label: "Clean up property-set references",
      codes: [...allowed], fixed: 0, skipped: 0, errors: 0, errorMessage: ""};
    try {
      for (const [objectId, targetCodes] of targets) {
        if (this._destroyed || runId !== this._runId || model.destroyed) return;
        this._state.progressLabel = `Cleaning references: ${objectId}`;
        try {
          if (applyDataReferenceCleanup(model, objectId, targetCodes)) run.fixed++;
          else run.skipped++;
        } catch (error) {
          run.errors++;
          run.errorMessage = error instanceof Error ? error.message : String(error);
        }
        this._state.progressCurrent++;
        if (this._state.progressCurrent % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (this._destroyed || runId !== this._runId || model.destroyed) return;
      this._state.cleanupHistory.unshift(run);
      this._state.cleanupHistory.splice(6);
      this._state.lastCleanupSummary = `${run.fixed} object${run.fixed === 1 ? "" : "s"} repaired, ${run.skipped} skipped, ${run.errors} errors`;
    } finally {
      if (runId === this._runId && !this._destroyed) {
        this._state.applying = false;
        this._state.stale = false;
        // Read the changed live DataModel; never edit the diagnostic report to make it look fixed.
        await this.inspectSelected();
      }
    }
  }

  private _applyReport(model: DataModel, report: InspectionReport): void {
    this._lastReport = report;
    const fixable = report.issues.filter((issue) => canCleanDataIssue(model, issue));
    this._state.fixableCodes.splice(0, this._state.fixableCodes.length, ...new Set(fixable.map((issue) => issue.code)));
    this._state.fixableIssueCount = fixable.length;
    this._state.reportRevision++;
    this._state.checkedAt = new Date().toISOString();
    this._state.inspectionError = null;
    const errors = report.errors.length;
    const warnings = report.warnings.length;
    this._state.errors = errors;
    this._state.warnings = warnings;
    this._state.info = report.info.length;
    this._state.issueCount = report.issues.length;
    this._state.inspectionsRun = report.inspectionsRun.length;
    if (errors > 0) {
      this._state.status = "critical";
      this._state.statusText = "Schema Violations Found";
      this._state.recommendation = `${errors} structural error${errors === 1 ? "" : "s"} need review. Only supported reference cleanups can be applied automatically.`;
    } else if (warnings > 0) {
      this._state.status = "warning";
      this._state.statusText = "Needs Review";
      this._state.recommendation = fixable.length
        ? `Reference cleanup is available for ${fixable.length} finding${fixable.length === 1 ? "" : "s"}. Review its impact before applying.`
        : `${warnings} advisory issue${warnings === 1 ? "" : "s"} should be reviewed against source data and schema policy.`;
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
      .map(([code, issues]) => this._buildIssueGroup(code, issues))
      .sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || severityRank(a.severity) - severityRank(b.severity) || b.count - a.count);
    this._findings.replace(groups);
    this._state.issueGroups.splice(0, this._state.issueGroups.length, ...groups.map((group) => ({
      ...group, issues: group.issues.slice(0, 12)
    })));
    this._state.stats.splice(0, this._state.stats.length, ...this._buildStats(model));
  }

  private _buildIssueGroup(code: string, issues: Issue[]): DataHealthIssueRow & {issues: HealthFinding[]} {
    const severity = issues.some((issue) => issue.severity === "error")
      ? "error"
      : issues.some((issue) => issue.severity === "warning")
        ? "warning"
        : "info";
    return {
      code,
      label: labelForCode(code),
      description: descriptionForCode(code) || "",
      impact: IMPACT_BY_CODE.get(code) || "cleanup",
      severity,
      count: issues.length,
      issues: issues.map((issue) => ({
        severity: issue.severity,
        message: issue.message,
        summary: issue.summary || "",
        resourceId: issue.resourceId || ""
      }))
    };
  }

  private _summarizeModel(model: DataModel): DataHealthModelSummary {
    const selected = model.id === this._state.selectedModelId;
    return {
      id: model.id,
      schema: model.schema || "",
      selected,
      status: selected ? this._state.status : "unknown",
      errors: selected ? this._state.errors : 0,
      warnings: selected ? this._state.warnings : 0,
      issueCount: selected ? this._state.issueCount : 0,
      objectCount: Object.keys(model.objects).length,
      propertySetCount: Object.keys(model.propertySets).length,
      relationshipCount: model.relationships.length,
      typeCount: Object.keys(model.objectsByType).length
    };
  }

  private _buildStats(model: DataModel | null): Array<{label: string; value: string}> {
    if (!model) {
      return [];
    }
    return [
      {label: "Objects", value: String(Object.keys(model.objects).length)},
      {label: "Types", value: String(Object.keys(model.objectsByType).length)},
      {label: "Relationships", value: String(model.relationships.length)},
      {label: "Property Sets", value: String(Object.keys(model.propertySets).length)},
      {label: "Schema", value: model.schema || "none"},
      {label: "Inspections", value: String(this._state.inspectionsRun)}
    ];
  }

  private _clearReport(statusText: string, recommendation: string): void {
    this._lastReport = null;
    this._state.applying = false;
    this._state.fixableCodes.splice(0);
    this._state.fixableIssueCount = 0;
    this._state.lastCleanupSummary = "";
    this._state.reportRevision++;
    this._findings.replace([]);
    this._state.checkedAt = null;
    this._state.inspectionError = null;
    this._state.status = "unknown";
    this._state.statusText = statusText;
    this._state.recommendation = recommendation;
    this._state.errors = 0;
    this._state.warnings = 0;
    this._state.info = 0;
    this._state.issueCount = 0;
    this._state.inspectionsRun = 0;
    this._state.issueGroups.splice(0, this._state.issueGroups.length);
    this._state.stats.splice(0, this._state.stats.length);
    this._state.inspecting = false;
    this._state.progressLabel = "";
    this._state.progressCurrent = 0;
    this._state.progressTotal = 0;
  }

  private _selectedModel(): DataModel | null {
    return this._state.selectedModelId ? this._data.models[this._state.selectedModelId] || null : null;
  }

  private _subscribe(): void {
    const events = this._data.events;
    const modelsChanged = () => {
      this.refreshModels();
      this.scheduleInspect();
    };
    this._unsubscribers.push(
      events.onDataModelCreated.subscribe(modelsChanged),
      events.onDataModelDestroyed.subscribe(modelsChanged),
      events.onDataObjectCreated.subscribe(() => this.scheduleInspect()),
      events.onDataObjectDestroyed.subscribe(() => this.scheduleInspect()),
      events.onDataObjectUpdated.subscribe(() => this.scheduleInspect()),
      events.onRelationshipCreated.subscribe(() => this.scheduleInspect()),
      events.onRelationshipDestroyed.subscribe(() => this.scheduleInspect()),
      events.onPropertySetCreated.subscribe(() => this.scheduleInspect()),
      events.onPropertySetDestroyed.subscribe(() => this.scheduleInspect()),
      events.onDataDestroyed.subscribe(() => this.destroy())
    );
  }
}

function impactRank(impact: DataHealthImpact): number {
  return impact === "structural" ? 0 : impact === "conformance" ? 1 : 2;
}

function severityRank(severity: "error" | "warning" | "info"): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}
