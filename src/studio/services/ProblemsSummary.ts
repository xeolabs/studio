import type {DataHealthPanelState} from "./DataHealthService";
import type {SceneHealthPanelState} from "./SceneHealthService";
import type {DiagnosticsPanelState} from "./DiagnosticsService";

export interface ProblemRow {
  id: string;
  level: "error" | "warning";
  source: string;
  message: string;
  count: number;
  timestamp?: string;
  commandId: string;
}

/** Health rows represent groups, not just the limited issue samples shown by the report panels. */
export function summarizeProblems(diagnostics: DiagnosticsPanelState, scene: SceneHealthPanelState, data: DataHealthPanelState) {
  const rows: ProblemRow[] = diagnostics.entries.map((entry) => ({
    id: `runtime:${entry.id}`, level: entry.level, source: `${entry.source}.${entry.eventName}`,
    message: entry.message, timestamp: entry.timestamp, count: 1, commandId: "view.toolWindows.diagnostics"
  }));
  for (const [source, report, panel] of [["Scene Health", scene, "scene-health"], ["Data Health", data, "data-health"]] as const) {
    for (const group of report.issueGroups) {
      if (group.severity === "info") continue;
      rows.push({
        id: `${panel}:${report.selectedModelId}:${group.code}`, level: group.severity,
        source, count: group.count, commandId: `view.toolWindows.${panel}`,
        message: `${report.selectedModelId}: ${group.label} (${group.count})${report.stale || report.inspecting ? " [refreshing]" : ""}`
      });
    }
  }
  return {rows, errors: diagnostics.errors + scene.errors + data.errors, warnings: diagnostics.warnings + scene.warnings + data.warnings};
}
