import type {CommandRegistry} from "./CommandRegistry";
import type {HealthCleanupState} from "../services/HealthCleanupState";
import type {HealthCleanupPreview} from "../ui/confirmHealthCleanup";
import {DATA_REFERENCE_CLEANUPS} from "../services/dataPropertySetCleanups";

interface CleanupCommandState extends HealthCleanupState {
  selectedModelId: string;
  reportRevision: number;
  stale: boolean;
  inspecting: boolean;
  issueGroups: Array<{code: string; label: string; count: number; description: string}>;
}

export function registerHealthCleanupCommands(params: {
  commands: CommandRegistry;
  domain: "scene" | "data";
  state: CleanupCommandState;
  apply: (codes: string[]) => void | Promise<void>;
  confirm: (preview: HealthCleanupPreview) => Promise<boolean>;
  open?: (panelId: string) => void;
}) {
  const {commands, domain, state} = params;
  const prefix = `${domain}Health`;
  let confirming = false;
  const canCleanup = () => !!state?.selectedModelId && !confirming && !state.stale && !state.inspecting && !state.applying;
  const cleanup = async (codes: string[]) => {
    if (!canCleanup()) return;
    const allowedCodes = [...new Set(codes)].filter((code) => state.fixableCodes.includes(code));
    if (!allowedCodes.length) return;
    const modelId = state.selectedModelId;
    const revision = state.reportRevision;
    const groups = state.issueGroups.filter((group) => allowedCodes.includes(group.code)).map((group) => ({
      ...group, description: domain === "data" ? DATA_REFERENCE_CLEANUPS[group.code] : group.description
    }));
    params.open?.(`${domain}-health`);
    confirming = true;
    try {
      const confirmed = await params.confirm({domain, modelId, groups});
      if (confirmed && state.selectedModelId === modelId && state.reportRevision === revision &&
        !state.stale && !state.inspecting && !state.applying) {
        await params.apply(allowedCodes);
      }
    } finally {
      confirming = false;
    }
  };
  commands.register({
    id: `${prefix}.cleanupAll`, title: `Apply ${domain === "scene" ? "Scene" : "Data"} Health Cleanups`,
    category: "Tools: Diagnostics", ...(domain === "scene" ? {shortcut: "Ctrl+Alt+Shift+X"} : {}),
    enabled: () => canCleanup() && state.fixableIssueCount > 0,
    run: () => cleanup(state.fixableCodes)
  });
  commands.register({
    id: `${prefix}.cleanupCodes`, title: "Apply Health Category Cleanup", category: "Tools: Diagnostics",
    visible: () => false,
    enabled: (_context, payload) => canCleanup() && Array.isArray(payload) && payload.some((code) => state.fixableCodes.includes(code)),
    run: (payload) => cleanup(Array.isArray(payload) ? payload.filter((code) => typeof code === "string") : [])
  });
}
