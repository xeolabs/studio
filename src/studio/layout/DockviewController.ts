import {
  DOCKVIEW_LAYOUT_STORAGE_KEY,
  LEFT_TOOL_WINDOW_IDS,
  RIGHT_TOOL_WINDOW_IDS,
  toolWindowPanels
} from "./toolWindowDefinitions";

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

  constructor(private readonly params: DockviewControllerParams) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  attach(event: any): void {
    const api = event?.api || event;
    this.api = api;
    api?.onDidAddPanel?.(() => this.onLayoutChanged());
    api?.onDidRemovePanel?.(() => this.onLayoutChanged());
    api?.onDidLayoutChange?.(() => this.onLayoutChanged());
    if (api?.addPanel && !this.restore()) {
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
    if (!this.api) {
      return;
    }
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
    if (this.getPanel(panelId)) {
      this.close(panelId);
    } else {
      this.open(panelId);
    }
  }

  isOpen(panelId: string): boolean {
    return !!this.getPanel(panelId);
  }

  sync(): void {
    for (const panelId of Object.keys(toolWindowPanels)) {
      this.params.workspace.setToolWindowOpen(panelId, !!this.getPanel(panelId));
    }
  }

  save(): void {
    if (this.restoring || !this.api || typeof this.api.toJSON !== "function") {
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
    if (this.saveHandle !== null) {
      window.clearTimeout(this.saveHandle);
      this.saveHandle = null;
    }
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
    const serialized = localStorage.getItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
    if (!serialized) {
      return false;
    }
    try {
      this.restoring = true;
      this.api.fromJSON(normalizeStoredPanelTitles(JSON.parse(serialized)));
      this.syncPanelTitles();
      return true;
    } catch (error) {
      console.warn("[xeokit Studio] Unable to restore Dockview layout.", error);
      localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
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
      ...(initialWidth ? {initialWidth} : {}),
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
