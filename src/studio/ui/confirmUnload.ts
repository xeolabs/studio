import type {LoadedModel} from "../services/LoadedModelsService";

export function createUnloadConfirmation(ElementPlus: any): (model: LoadedModel) => Promise<boolean> {
  return async model => {
    window.dispatchEvent(new Event("studio-close-tools"));
    const confirmed = ElementPlus.ElMessageBox.confirm(
      `Unload “${model.title}” from this session? You can import it again later. The source file will not be changed.`,
      "Unload model?",
      {
        appendTo: document.body,
        customClass: "studio-unload-confirmation",
        cancelButtonClass: "studio-unload-cancel",
        cancelButtonText: "Cancel",
        confirmButtonText: "Unload",
        autofocus: false,
        closeOnPressEscape: true,
        closeOnClickModal: false
      }
    ).then(() => true, () => false);
    // Let the dialog's focus trap mount before choosing the safe initial action.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    document.querySelector<HTMLButtonElement>(".studio-unload-confirmation .studio-unload-cancel")?.focus({preventScroll: true});
    return confirmed;
  };
}
