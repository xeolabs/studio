export interface RegisterStudioTeardownParams {
  app: any;
  aabbService: {destroy?: () => void};
  dataHealthService: {destroy?: () => void};
  diagnosticsService: {destroy?: () => void};
  explorerHostController: {dispose?: () => void};
  explorerNavigation: {dispose(): void};
  exportDialogService: {dispose(): void};
  getInputController: () => {destroy?: () => void} | null;
  getPicker: () => {dispose?: () => void} | null;
  layoutController: {dispose?: () => void};
  rendererService: {destroy?: () => void};
  sceneHealthService: {destroy?: () => void};
  sunStudyService: {destroy?: () => void};
  tilesService: {destroy?: () => void};
  viewerHostController: {dispose?: () => void};
  commandEventCleanup?: () => void;
  diagnosticPanelActivityCleanup?: () => void;
  viewportCommandsCleanup?: () => void;
  sectionCommandsCleanup?: () => void;
  modelCommandsCleanup?: () => void;
  viewportContextMenuCleanup?: () => void;
}

export function registerStudioTeardown(params: RegisterStudioTeardownParams): () => void {
  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    window.removeEventListener("beforeunload", dispose);
    params.commandEventCleanup?.();
    params.diagnosticPanelActivityCleanup?.();
    params.modelCommandsCleanup?.();
    params.sectionCommandsCleanup?.();
    params.viewportCommandsCleanup?.();
    params.viewportContextMenuCleanup?.();
    params.getInputController()?.destroy?.();
    params.getPicker()?.dispose?.();
    params.explorerHostController.dispose?.();
    params.explorerNavigation.dispose();
    params.exportDialogService.dispose();
    params.viewerHostController.dispose?.();
    params.layoutController.dispose?.();
    params.aabbService.destroy?.();
    params.dataHealthService.destroy?.();
    params.diagnosticsService.destroy?.();
    params.sceneHealthService.destroy?.();
    params.sunStudyService.destroy?.();
    params.tilesService.destroy?.();
    params.rendererService.destroy?.();
    params.app?.unmount?.();
  };
  window.addEventListener("beforeunload", dispose);
  return dispose;
}
