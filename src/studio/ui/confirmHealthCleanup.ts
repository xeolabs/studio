export interface HealthCleanupPreview {
  domain: "scene" | "data";
  modelId: string;
  groups: Array<{label: string; count: number; description: string}>;
}

export function createHealthCleanupConfirmation(ElementPlus: any): (preview: HealthCleanupPreview) => Promise<boolean> {
  return async (preview) => {
    const label = preview.domain === "data" ? "DataModel" : "SceneModel";
    const message = [
      `Modify ${label} "${preview.modelId}"?`,
      ...preview.groups.map((group) => `${group.label}: ${group.count} finding${group.count === 1 ? "" : "s"}. ${group.description}`),
      ...(preview.domain === "data" ? ["Shared DataObjects are skipped. Types, properties and relationships are not changed."] : []),
      "This changes the loaded model and cannot be undone. Export a copy first if you need to preserve it."
    ].join("\n\n");
    try {
      await ElementPlus.ElMessageBox.confirm(message, `Apply ${preview.domain === "data" ? "Data" : "Scene"} Cleanup`, {
        appendTo: document.body,
        customClass: "studio-cleanup-confirmation",
        cancelButtonText: "Cancel",
        confirmButtonText: "Apply Cleanup",
        type: "warning"
      });
      return true;
    } catch {
      return false;
    }
  };
}
