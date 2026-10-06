import type {ViewerHostActions} from "./types";

export interface ViewerHostController {
  dispose(): void;
  requestRender(): void;
}

export interface ConnectViewerHostActionsParams {
  actions: ViewerHostActions;
  getActiveView: () => any;
  notifyLayoutChanged: () => void;
}

export function connectViewerHostActions(params: ConnectViewerHostActionsParams): ViewerHostController {
  const {actions, getActiveView, notifyLayoutChanged} = params;
  const canvasParkingLot = document.createElement("div");
  canvasParkingLot.hidden = true;
  document.body.appendChild(canvasParkingLot);
  let viewerPanelResizeObserver: ResizeObserver | null = null;
  const requestRender = () => {
    notifyLayoutChanged();
    requestAnimationFrame(() => {
      getActiveView()?.needsRender?.();
      window.dispatchEvent(new Event("resize"));
    });
  };
  actions.mounted = (container, panel) => {
    const activeView = getActiveView();
    let canvas = activeView?.htmlElement as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = document.getElementById("demoCanvas") as HTMLCanvasElement | null;
    }
    if (!canvas) {
      canvas = document.createElement("canvas");
    }
    canvas.id = "demoCanvas";
    if (canvas.parentElement !== container) {
      container.appendChild(canvas);
    }
    if (activeView) {
      activeView.htmlElement = canvas;
    }
    viewerPanelResizeObserver?.disconnect();
    viewerPanelResizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(requestRender)
      : null;
    viewerPanelResizeObserver?.observe(panel);
    requestRender();
  };
  actions.unmounted = () => {
    viewerPanelResizeObserver?.disconnect();
    viewerPanelResizeObserver = null;
    const canvas = getActiveView()?.htmlElement || document.getElementById("demoCanvas");
    if (canvas && canvas.parentElement !== canvasParkingLot) {
      canvasParkingLot.appendChild(canvas);
    }
    requestRender();
  };
  return {
    dispose: () => {
      viewerPanelResizeObserver?.disconnect();
      viewerPanelResizeObserver = null;
      canvasParkingLot.remove();
    },
    requestRender
  };
}
