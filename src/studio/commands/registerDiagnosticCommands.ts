import type {StudioActions} from "../app/types";
import type {CommandRegistry} from "./CommandRegistry";
import {copyText} from "../ui/clipboard";
import type {HealthCleanupPreview} from "../ui/confirmHealthCleanup";
import {registerHealthCleanupCommands} from "./registerHealthCleanupCommands";
import type {DiagnosticResourceTarget} from "../services/diagnosticObjectIds";

export interface RegisterDiagnosticCommandsParams {
  commands: CommandRegistry;
  dataHealthPanelState: any;
  diagnosticsPanelState: any;
  sceneHealthPanelState: any;
  openToolWindow?: (panelId: string) => void;
  actions: Pick<StudioActions, "dataHealthActions" | "diagnosticsActions" | "sceneHealthActions">;
  confirmCleanup: (preview: HealthCleanupPreview) => Promise<boolean>;
  resourceObjectIds?: (target: DiagnosticResourceTarget) => string[];
}

export function registerDiagnosticCommands(params: RegisterDiagnosticCommandsParams): void {
  if (params.resourceObjectIds) {
    params.commands.register({
      id: "diagnostics.frameResource",
      title: "Fit Affected Objects in View",
      visible: () => false,
      enabled: (_context, payload) => !!params.resourceObjectIds?.(payload as DiagnosticResourceTarget).length,
      run: (payload) => {
        const ids = params.resourceObjectIds!(payload as DiagnosticResourceTarget);
        params.openToolWindow?.("viewer");
        params.commands.execute("viewport.frameObjects", ids);
      }
    });
  }
  for (const domain of ["scene", "data"] as const) {
    registerHealthCleanupCommands({
      commands: params.commands, domain,
      state: domain === "scene" ? params.sceneHealthPanelState : params.dataHealthPanelState,
      apply: (codes) => params.actions[domain === "scene" ? "sceneHealthActions" : "dataHealthActions"].cleanupCodes(codes),
      confirm: params.confirmCleanup, open: params.openToolWindow
    });
  }
  params.commands.register({
    id: "diagnostics.copyJson",
    title: "Copy Warnings / Errors as JSON",
    category: "Tools: Diagnostics",
    shortcut: "Ctrl+Alt+W",
    enabled: () => params.diagnosticsPanelState.entries.length > 0,
    run: () => {
      params.openToolWindow?.("diagnostics");
      params.actions.diagnosticsActions.copyJson();
    }
  });
  params.commands.register({
    id: "diagnostics.copySummaryJson",
    title: "Copy Warnings / Errors Summary as JSON",
    category: "Tools: Diagnostics",
    run: () => {
      void copyText(JSON.stringify({
        errors: params.diagnosticsPanelState.errors,
        warnings: params.diagnosticsPanelState.warnings,
        total: params.diagnosticsPanelState.entries.length,
        sources: summarizeDiagnosticsBySource(params.diagnosticsPanelState.entries)
      }, null, 2));
    }
  });
  params.commands.register({
    id: "diagnostics.copyEntry",
    title: "Copy Diagnostic Entry as JSON",
    category: "Tools: Diagnostics",
    visible: () => false,
    run: (payload) => {
      params.openToolWindow?.("diagnostics");
      params.actions.diagnosticsActions.copyEntry(payload);
    }
  });
  params.commands.register({
    id: "diagnostics.clear",
    title: "Clear Warnings / Errors",
    category: "Tools: Diagnostics",
    shortcut: "Ctrl+Alt+Shift+W",
    enabled: () => params.diagnosticsPanelState.entries.length > 0,
    run: () => {
      params.openToolWindow?.("diagnostics");
      params.actions.diagnosticsActions.clear();
    }
  });
  params.commands.register({
    id: "sceneHealth.inspect",
    title: "Inspect Scene Health",
    category: "Tools: Diagnostics",
    shortcut: "Ctrl+Alt+Shift+S",
    enabled: () => !!params.sceneHealthPanelState.selectedModelId && !params.sceneHealthPanelState.inspecting && !params.sceneHealthPanelState.applying,
    run: () => {
      params.openToolWindow?.("scene-health");
      params.actions.sceneHealthActions.inspectSelected();
    }
  });
  params.commands.register({
    id: "sceneHealth.selectModel",
    title: "Select Scene Health Model",
    category: "Tools: Diagnostics",
    visible: () => false,
    run: (payload) => {
      if (typeof payload === "string") {
        params.actions.sceneHealthActions.selectModel(payload);
      }
    }
  });
  params.commands.register({
    id: "dataHealth.inspect",
    title: "Inspect Data Health",
    category: "Tools: Diagnostics",
    shortcut: "Ctrl+Alt+Shift+D",
    enabled: () => !!params.dataHealthPanelState.selectedModelId && !params.dataHealthPanelState.inspecting && !params.dataHealthPanelState.applying,
    run: () => {
      params.openToolWindow?.("data-health");
      params.actions.dataHealthActions.inspectSelected();
    }
  });
  params.commands.register({
    id: "dataHealth.selectModel",
    title: "Select Data Health Model",
    category: "Tools: Diagnostics",
    visible: () => false,
    run: (payload) => {
      if (typeof payload === "string") {
        params.actions.dataHealthActions.selectModel(payload);
      }
    }
  });
}

function summarizeDiagnosticsBySource(entries: any[]): Record<string, {errors: number; warnings: number}> {
  const summary: Record<string, {errors: number; warnings: number}> = {};
  for (const entry of entries || []) {
    const source = entry.source || "unknown";
    const row = summary[source] || (summary[source] = {errors: 0, warnings: 0});
    if (entry.level === "error") {
      row.errors++;
    } else if (entry.level === "warning") {
      row.warnings++;
    }
  }
  return summary;
}
