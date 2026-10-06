export function createDeleteConfirmation(ElementPlus: any): (label: string, modelId: string) => Promise<boolean> {
  return async (label, modelId) => {
    const messageBox = ElementPlus.ElMessageBox;
    if (!messageBox?.confirm) {
      return globalThis.confirm(`Delete ${label} "${modelId}"? This cannot be undone.`);
    }
    try {
      await messageBox.confirm(
        `Delete ${label} "${modelId}"? This cannot be undone.`,
        `Delete ${label}`,
        {
          appendTo: document.body,
          cancelButtonText: "Cancel",
          confirmButtonText: "Delete",
          type: "warning"
        }
      );
      return true;
    } catch {
      return false;
    }
  };
}
