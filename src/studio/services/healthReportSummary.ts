/** Inspection freshness is separate from the severity of the last completed report. */
export interface HealthReportState {
  selectedModelId: string;
  inspecting: boolean;
  applying?: boolean;
  stale: boolean;
  checkedAt: string | null;
  inspectionError: string | null;
  errors: number;
  warnings: number;
  info: number;
}

export function healthReportSummary(state: HealthReportState) {
  const phase = !state.selectedModelId ? "No model"
    : state.applying ? "Cleaning up"
    : state.inspecting ? "Checking"
    : state.inspectionError ? "Check failed"
    : !state.checkedAt ? "Not checked"
    : state.stale ? "Outdated" : "Current";
  const current = phase === "Current";
  const counts = [
    state.errors && `${state.errors} errors`,
    state.warnings && `${state.warnings} warnings`,
    state.info && `${state.info} informational`
  ].filter(Boolean).join(" · ") || "No issues";
  return {
    phase, current,
    metric: current ? counts : phase,
    tone: !current ? "unknown" : state.errors ? "critical" : state.warnings ? "warning" : "healthy"
  };
}
