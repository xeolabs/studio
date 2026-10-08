import {
  DOCKVIEW_LAYOUT_STORAGE_KEY,
  LEFT_TOOL_WINDOW_IDS,
  RIGHT_TOOL_WINDOW_IDS,
  toolWindowPanels
} from "./toolWindowDefinitions";
import {observeWorkspaceLayout, type WorkspaceLayout} from "./observeWorkspaceLayout";

interface DockviewControllerParams {
  notifyLayoutChanged: () => void;
  workspace: any;
}

export class DockviewController {
  readonly ready: Promise<void>;

  private api: any = null;
  private restoring = false;
  private saveHandle: number | null = null;
  private resolveReady!: () => void;
  private layoutMode: WorkspaceLayout = "wide";
  private desktopLayout: any = null;
  private lastToolPanelId = "";
  private desktopBottomPanelOpen = false;
  private stopObservingLayout: () => void;

  constructor(private readonly params: DockviewControllerParams) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.stopObservingLayout = observeWorkspaceLayout((mode) => this.setLayoutMode(mode));
  }

  attach(event: any): void {
    const api = event?.api || event;
    this.api = api;
    api?.onDidActivePanelChange?.((panel: any) => {
      if (!this.restoring && panel?.id !== "viewer" && toolWindowPanels[panel?.id]) this.lastToolPanelId = panel.id;
    });
    api?.onDidAddPanel?.(() => this.onLayoutChanged());
    api?.onDidRemovePanel?.(() => this.onLayoutChanged());
    api?.onDidLayoutChange?.(() => this.onLayoutChanged());
    if (api?.addPanel && (this.layoutMode !== "wide" || !this.restore())) {
      api.addPanel({id: "viewer", component: "ViewerPanel", title: "3D Canvas", renderer: "always"});
    }
    if (api?.addPanel && !this.getPanel("viewer")) {
      this.addPanel("viewer", this.getViewerRestorePosition());
    }
    requestAnimationFrame(() => {
      this.syncPanelTitles();
      this.sync();
      this.params.notifyLayoutChanged();
      this.save();
      this.resolveReady();
    });
  }

  open(panelId: string): void {
    if (["ifcStructure", "ifcStoreys", "ifcTypes"].includes(panelId)) this.params.workspace.explorePanelId = panelId;
    if (!this.api) {
      return;
    }
    if (this.layoutMode !== "wide") {
      if (toolWindowPanels[panelId]) {
        this.params.workspace.setResponsivePanel(panelId === "viewer" ? "" : panelId);
      }
      return;
    }
    if (panelId !== "viewer" && toolWindowPanels[panelId]) this.lastToolPanelId = panelId;
    const existingPanel = this.getPanel(panelId);
    if (existingPanel) {
      this.syncPanelTitle(panelId, existingPanel);
      this.activatePanel(existingPanel);
      this.params.workspace.setToolWindowOpen(panelId, true);
      this.params.notifyLayoutChanged();
      return;
    }
    const config = toolWindowPanels[panelId];
    if (!config) {
      return;
    }
    if (panelId === "viewer") {
      const viewerPanel = this.addPanel("viewer", this.getViewerRestorePosition());
      if (viewerPanel) {
        this.activatePanel(viewerPanel);
      }
      this.sync();
      this.params.notifyLayoutChanged();
      return;
    }
    const panel = this.addPanel(panelId, this.getToolWindowOpenPosition(panelId, config));
    this.activatePanel(panel);
    this.params.workspace.setToolWindowOpen(panelId, true);
    this.sync();
    this.params.notifyLayoutChanged();
  }

  close(panelId: string): void {
    if (this.layoutMode !== "wide") {
      if (this.params.workspace.responsivePanelId === panelId) {
        this.params.workspace.setResponsivePanel("");
      }
      return;
    }
    const panel = this.getPanel(panelId);
    if (!panel) {
      this.params.workspace.setToolWindowOpen(panelId, false);
      return;
    }
    this.closePanel(panel);
    this.params.workspace.setToolWindowOpen(panelId, false);
    this.sync();
    this.params.notifyLayoutChanged();
  }

  resetSavedLayout(): void {
    this.desktopLayout = null;
    this.params.workspace.setResponsivePanel("");
    try {
      localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
    } catch (error) {
      console.warn("[xeokit Studio] Unable to clear saved Dockview layout.", error);
    }
    if (!this.api?.addPanel) {
      return;
    }
    for (const panelId of Object.keys(toolWindowPanels)) {
      const panel = this.getPanel(panelId);
      if (panel) {
        this.closePanel(panel);
      }
      this.params.workspace.setToolWindowOpen(panelId, false);
    }
    const viewerPanel = this.addPanel("viewer");
    if (viewerPanel) {
      this.activatePanel(viewerPanel);
    }
    this.sync();
    this.params.notifyLayoutChanged();
    this.save();
  }

  toggle(panelId: string): void {
    if (this.isOpen(panelId)) {
      this.close(panelId);
    } else {
      this.open(panelId);
    }
  }

  isOpen(panelId: string): boolean {
    if (this.layoutMode !== "wide") {
      return panelId === "viewer" || this.params.workspace.responsivePanelId === panelId;
    }
    return !!this.getPanel(panelId);
  }

  sync(): void {
    for (const panelId of Object.keys(toolWindowPanels)) {
      this.params.workspace.setToolWindowOpen(panelId, this.isOpen(panelId));
    }
  }

  save(): void {
    if (this.layoutMode !== "wide" || this.restoring || !this.api || typeof this.api.toJSON !== "function") {
      return;
    }
    try {
      localStorage.setItem(DOCKVIEW_LAYOUT_STORAGE_KEY, JSON.stringify(this.api.toJSON()));
    } catch (error) {
      console.warn("[xeokit Studio] Unable to save Dockview layout.", error);
    }
  }

  scheduleSave(): void {
    if (this.saveHandle !== null) {
      window.clearTimeout(this.saveHandle);
    }
    this.saveHandle = window.setTimeout(() => {
      this.saveHandle = null;
      this.save();
    }, 120);
  }

  dispose(): void {
    this.stopObservingLayout();
    if (this.saveHandle !== null) {
      window.clearTimeout(this.saveHandle);
      this.saveHandle = null;
    }
  }

  private setLayoutMode(mode: WorkspaceLayout): void {
    if (mode === this.layoutMode) return;
    const wasWide = this.layoutMode === "wide";
    const activePanelId = this.api?.activePanel?.id;
    const desktopTool = activePanelId !== "viewer" && toolWindowPanels[activePanelId]
      ? activePanelId : this.lastToolPanelId;
    const activeTool = wasWide
      ? (this.getPanel(desktopTool) ? desktopTool : "")
      : this.params.workspace.responsivePanelId;
    if (wasWide) {
      this.save();
      this.desktopLayout = this.api?.toJSON?.() || null;
      this.desktopBottomPanelOpen = this.params.workspace.bottomPanelOpen;
    }
    this.layoutMode = mode;
    this.params.workspace.setLayoutMode(mode);
    if (wasWide || mode === "wide") {
      this.params.workspace.setResponsivePanel(mode === "wide" ? "" : activeTool);
      this.params.workspace.setBottomPanelOpen(mode === "wide" ? this.desktopBottomPanelOpen : false);
    }
    if (!this.api) return;
    this.restoring = true;
    try {
      if (mode === "wide") {
        if (this.desktopLayout) this.api.fromJSON(this.desktopLayout);
        else this.restore();
      } else if (wasWide) {
        // Leave the live canvas mounted while tools move beside it.
        for (const id of Object.keys(toolWindowPanels)) {
          if (id !== "viewer") {
            const panel = this.getPanel(id);
            if (panel) this.closePanel(panel);
          }
        }
      }
      if (!this.getPanel("viewer")) this.addPanel("viewer", this.getViewerRestorePosition());
      this.activatePanel(this.getPanel("viewer"));
      if (mode === "wide" && activeTool) {
        const alreadyRestored = !!this.getPanel(activeTool);
        this.open(activeTool);
        if (!alreadyRestored) {
          // Vue updates the grid before this frame. Resize Dockview before sizing the
          // new tool: its automatic resize is delayed and otherwise scales the tool up.
          requestAnimationFrame(() => {
            if (this.layoutMode !== "wide") return;
            const host = document.querySelector<HTMLElement>(".studio-workbench .workspace");
            if (host) this.api.layout(host.clientWidth, host.clientHeight);
            this.getPanel(activeTool)?.api?.setSize?.({width: this.getInitialToolWindowWidth(activeTool)});
          });
        }
      }
    } finally {
      this.restoring = false;
    }
    this.sync();
    this.params.notifyLayoutChanged();
  }

  private onLayoutChanged(): void {
    this.sync();
    this.params.notifyLayoutChanged();
    this.scheduleSave();
  }

  private getPanel(panelId: string): any {
    return this.api?.getPanel?.(panelId) || this.api?.getPanelById?.(panelId) || null;
  }

  private restore(): boolean {
    if (!this.api || typeof this.api.fromJSON !== "function") {
      return false;
    }
    try {
      const serialized = localStorage.getItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
      if (!serialized) return false;
      this.restoring = true;
      this.api.fromJSON(normalizeStoredPanelTitles(JSON.parse(serialized)));
      this.syncPanelTitles();
      return true;
    } catch (error) {
      console.warn("[xeokit Studio] Unable to restore Dockview layout.", error);
      try { localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
      return false;
    } finally {
      this.restoring = false;
    }
  }

  private addPanel(panelId: string, position?: {referencePanel: string; direction: string}): any {
    const config = toolWindowPanels[panelId];
    if (!config) {
      return null;
    }
    const initialWidth = this.getInitialToolWindowWidth(panelId);
    const panel = this.api.addPanel({
      id: panelId,
      component: config.component,
      title: config.title,
      renderer: config.renderer,
      ...(initialWidth ? {initialWidth, minimumWidth: 280} : {}),
      ...(position ? {position} : {})
    });
    this.syncPanelTitle(panelId, panel);
    return panel;
  }

  private syncPanelTitles(): void {
    for (const panelId of Object.keys(toolWindowPanels)) {
      this.syncPanelTitle(panelId, this.getPanel(panelId));
    }
  }

  private syncPanelTitle(panelId: string, panel: any): void {
    const title = toolWindowPanels[panelId]?.title;
    if (!title || !panel) {
      return;
    }
    if (typeof panel.api?.setTitle === "function") {
      panel.api.setTitle(title);
      return;
    }
    if (typeof panel.setTitle === "function") {
      panel.setTitle(title);
      return;
    }
    if (typeof panel.api?.update === "function") {
      panel.api.update({title});
      return;
    }
    if (typeof panel.update === "function") {
      panel.update({title});
    }
  }

  private getViewerRestorePosition(): {referencePanel: string; direction: string} | undefined {
    for (const referencePanel of RIGHT_TOOL_WINDOW_IDS) {
      if (this.getPanel(referencePanel)) {
        return {referencePanel, direction: "left"};
      }
    }
    for (const referencePanel of ["viewerExplorer", "scene", "ifcTypes", "ifcStoreys", "ifcStructure", "data"]) {
      if (this.getPanel(referencePanel)) {
        return {referencePanel, direction: "right"};
      }
    }
    return undefined;
  }

  private getFallbackToolWindowPosition(direction: string): {referencePanel: string; direction: string} | undefined {
    for (const referencePanel of ["viewer", "data", "ifcStructure", "ifcStoreys", "ifcTypes", "scene", "viewerExplorer", "inspector", "runtime-overview", "diagnostic-center", "boundaries", "scene-health", "data-health", "diagnostics", "sun-study", "tiles"]) {
      if (this.getPanel(referencePanel)) {
        return {referencePanel, direction};
      }
    }
    return undefined;
  }

  private getToolWindowOpenPosition(panelId: string, config: typeof toolWindowPanels[string]): {referencePanel: string; direction: string} | undefined {
    if ((LEFT_TOOL_WINDOW_IDS as readonly string[]).includes(panelId)) {
      const groupPanelId = LEFT_TOOL_WINDOW_IDS.find((id) => id !== panelId && this.getPanel(id));
      if (groupPanelId) {
        return {referencePanel: groupPanelId, direction: "within"};
      }
      if (this.getPanel("viewer")) {
        return {referencePanel: "viewer", direction: "left"};
      }
    }
    if ((RIGHT_TOOL_WINDOW_IDS as readonly string[]).includes(panelId)) {
      const groupPanelId = RIGHT_TOOL_WINDOW_IDS.find((id) => id !== panelId && this.getPanel(id));
      if (groupPanelId) {
        return {referencePanel: groupPanelId, direction: "within"};
      }
      if (this.getPanel("viewer")) {
        return {referencePanel: "viewer", direction: "right"};
      }
    }
    const hasPreferredReferencePanel = !!this.getPanel(config.preferredReferencePanel);
    return hasPreferredReferencePanel
      ? {referencePanel: config.preferredReferencePanel, direction: config.preferredDirection}
      : this.getFallbackToolWindowPosition(config.fallbackDirection);
  }

  private getInitialToolWindowWidth(panelId: string): number | undefined {
    const viewportWidth = Math.max(900, window.innerWidth || 0);
    if ((LEFT_TOOL_WINDOW_IDS as readonly string[]).includes(panelId)) {
      return clampPanelWidth(viewportWidth * 0.33, 320, 640);
    }
    if ((RIGHT_TOOL_WINDOW_IDS as readonly string[]).includes(panelId)) {
      return clampPanelWidth(viewportWidth * 0.33, 320, 640);
    }
    return undefined;
  }

  private activatePanel(panel: any): void {
    panel?.api?.setActive?.();
    panel?.api?.focus?.();
    panel?.setActive?.();
    panel?.focus?.();
  }

  private closePanel(panel: any): void {
    if (panel?.api?.close) {
      panel.api.close();
      return;
    }
    if (panel?.close) {
      panel.close();
      return;
    }
    if (panel?.api?.dispose) {
      panel.api.dispose();
      return;
    }
    panel?.dispose?.();
  }
}

function clampPanelWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeStoredPanelTitles(layout: any): any {
  const visit = (node: any) => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (typeof node.id === "string" && toolWindowPanels[node.id]?.title && typeof node.title === "string") {
      node.title = toolWindowPanels[node.id].title;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }
    for (const child of Object.values(node)) {
      visit(child);
    }
  };
  visit(layout);
  return layout;
}
