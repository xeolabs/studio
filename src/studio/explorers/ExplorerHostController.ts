import {DataExplorerView} from "./data";
import {IFCStoreysView, IFCTreeView, IFCTypesView} from "./ifc";
import {SceneTreeView} from "./scene";
import {ViewerExplorerView} from "./viewer";
import {
  installExplorerContextMenu,
  type StudioContextMenuInstallParams
} from "../context-menu/installStudioContextMenus";
import {bindExplorerSelection} from "./explorerSelection";
import {bindExplorerSelectionState} from "./bindExplorerSelectionState";
import {installExplorerKeyboard} from "./installExplorerKeyboard";
import {registerIfcExplorerCommands} from "../commands/registerIfcExplorerCommands";
import type {IfcExplorerSource, IfcExplorerStore} from "./ifcExplorerTypes";
import type {ExplorerHostActions} from "../app/types";
import type {ExplorerSource, NavigableExplorerNode, NavigableExplorerStore} from "./types";
import {inspectExplorerNode} from "./inspectExplorerNode";
import {EXPLORER_ROW_SELECTOR} from "./explorerSelection";
import {scrollExplorerRowIntoView} from "./scrollExplorerRowIntoView";
import {ExplorerSessions} from "./ExplorerSessions";
import {bindExplorerSession} from "./bindExplorerSession";

export type {ExplorerSource} from "./types";

export interface ExplorerHostControllerParams {
  actions: ExplorerHostActions;
  workspace: any;
}

export interface ExplorerHostRuntimeParams extends Omit<StudioContextMenuInstallParams, "dataExplorer" | "sceneTree" | "viewerExplorer"> {
  confirmDeleteModel: (label: string, modelId: string) => Promise<boolean>;
  data: any;
  renderer: any;
  rendererLabel: string;
  viewer: any;
  vue: any;
}

export class ExplorerHostController {
  readonly sessions = new ExplorerSessions();
  dataExplorer: DataExplorerView | null = null;
  ifcTree: IFCTreeView | null = null;
  ifcStoreys: IFCStoreysView | null = null;
  ifcTypes: IFCTypesView | null = null;
  sceneTree: SceneTreeView | null = null;
  viewerExplorer: ViewerExplorerView | null = null;

  private readonly actions: ExplorerHostActions;
  private readonly pendingHosts: Partial<Record<ExplorerSource, HTMLElement>> = {};
  private readonly mountTasks: Partial<Record<ExplorerSource, Promise<void>>> = {};
  private readonly generations: Partial<Record<ExplorerSource, number>> = {};
  private readonly workspace: any;
  private cleanups: Record<ExplorerSource, (() => void) | null> = {
    data: null,
    ifc: null,
    ifcStoreys: null,
    ifcTypes: null,
    scene: null,
    viewer: null
  };
  private contextMenuParams: StudioContextMenuInstallParams | null = null;
  private runtime: ExplorerHostRuntimeParams | null = null;
  private disposed = false;
  private resolveConnected!: () => void;
  private readonly connected = new Promise<void>((resolve) => { this.resolveConnected = resolve; });

  constructor(params: ExplorerHostControllerParams) {
    this.actions = params.actions;
    this.workspace = params.workspace;
    this.actions.mounted = (source, container) => {
      this.pendingHosts[source] = container;
      this.workspace.setToolWindowOpen(this.toToolWindowId(source), true);
      if (this.runtime) {
        this.startMount(source, container);
      }
    };
    this.actions.unmounted = (source, container) => {
      if (this.pendingHosts[source] !== container) return;
      this.cleanup(source);
      delete this.pendingHosts[source];
      this.workspace.setToolWindowOpen(this.toToolWindowId(source), false);
    };
  }

  connect(runtime: ExplorerHostRuntimeParams): StudioContextMenuInstallParams {
    this.runtime = runtime;
    this.resolveConnected();
    registerIfcExplorerCommands(runtime.commands, (source) => this.getIfcStore(source), runtime.selectSceneObject);
    this.contextMenuParams = {
      commands: runtime.commands,
      contextMenuService: runtime.contextMenuService,
      dataExplorer: null,
      scene: runtime.scene,
      sceneTree: null,
      selectSceneObject: runtime.selectSceneObject,
      selectionService: runtime.selectionService,
      setInspectorContext: runtime.setInspectorContext,
      view: runtime.view,
      viewerExplorer: null,
      getPicker: runtime.getPicker,
      getIfcStore: (source) => this.getIfcStore(source)
    };
    for (const source of ["data", "ifc", "ifcStoreys", "ifcTypes", "scene", "viewer"] as const) {
      const container = this.pendingHosts[source];
      if (container?.isConnected) {
        this.startMount(source, container);
      }
    }
    return this.contextMenuParams;
  }

  dispose(): void {
    this.disposed = true;
    this.resolveConnected();
    for (const source of ["data", "ifc", "ifcStoreys", "ifcTypes", "scene", "viewer"] as const) {
      this.cleanup(source);
      delete this.pendingHosts[source];
    }
  }

  getIfcStore(source: IfcExplorerSource): IfcExplorerStore | null {
    return (source === "ifc" ? this.ifcTree : source === "ifcTypes" ? this.ifcTypes : this.ifcStoreys)?.store || null;
  }

  getStore(source: ExplorerSource): NavigableExplorerStore | null {
    return (source === "data" ? this.dataExplorer : source === "scene" ? this.sceneTree : source === "viewer" ? this.viewerExplorer :
      source === "ifc" ? this.ifcTree : source === "ifcTypes" ? this.ifcTypes : this.ifcStoreys)?.store || null;
  }

  setRenderer(renderer: ExplorerHostRuntimeParams["renderer"], label: string): void {
    if (!this.runtime) return;
    this.runtime.renderer = renderer;
    this.runtime.rendererLabel = label;
    this.viewerExplorer?.store.setRenderer(renderer, label);
  }

  async whenMounted(source: ExplorerSource): Promise<NavigableExplorerStore | null> {
    await this.connected;
    // Dockview creates a reopened host on Vue's next render, not inside open().
    for (let i = 0; i < 120; i++) {
      if (this.disposed) return null;
      if (this.pendingHosts[source]?.isConnected && this.mountTasks[source]) {
        await this.mountTasks[source];
        return this.getStore(source);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
  }

  focusNode(source: ExplorerSource, node: NavigableExplorerNode): void {
    if (!this.runtime) return;
    const store = this.getStore(source);
    const objectId = store?.getObjectId?.(node);
    inspectExplorerNode(source, objectId ? {...node, kind: "object", objectId} : node, {
      hasSceneObject: (id) => !!this.runtime!.scene.objects[id], selectSceneObject: this.runtime.selectSceneObject,
      setInspectorContext: this.runtime.setInspectorContext
    });
    const container = this.pendingHosts[source];
    const explorer = source === "scene" ? this.sceneTree : source === "data" ? this.dataExplorer :
      source === "viewer" ? this.viewerExplorer : source === "ifc" ? this.ifcTree :
      source === "ifcTypes" ? this.ifcTypes : this.ifcStoreys;
    const reveal = explorer?.revealNode(node.id);
    void reveal?.then(() => requestAnimationFrame(() => {
      const rows = container?.querySelectorAll<HTMLElement>(EXPLORER_ROW_SELECTOR) || [];
      for (const row of Array.from(rows)) {
        row.classList.toggle("is-revealed", row.dataset.nodeId === node.id);
        if (row.dataset.nodeId === node.id && container) {
          row.focus({preventScroll: true});
          scrollExplorerRowIntoView(row, container, "center");
        }
      }
    }));
  }

  private startMount(source: ExplorerSource, container: HTMLElement): void {
    const task = this.mount(source, container);
    this.mountTasks[source] = task;
    void task.catch((error) => this.workspace.appendOutput(String(error), "Explorers"));
  }

  private cleanup(source: ExplorerSource): void {
    this.generations[source] = (this.generations[source] || 0) + 1;
    this.cleanups[source]?.();
    this.cleanups[source] = null;
    if (source === "data") {
      this.dataExplorer?.destroy();
      this.dataExplorer = null;
      if (this.contextMenuParams) {
        this.contextMenuParams.dataExplorer = null;
      }
    } else if (source === "ifc") {
      this.ifcTree?.destroy();
      this.ifcTree = null;
    } else if (source === "ifcStoreys") {
      this.ifcStoreys?.destroy();
      this.ifcStoreys = null;
    } else if (source === "ifcTypes") {
      this.ifcTypes?.destroy();
      this.ifcTypes = null;
    } else if (source === "scene") {
      this.sceneTree?.destroy();
      this.sceneTree = null;
      if (this.contextMenuParams) {
        this.contextMenuParams.sceneTree = null;
      }
    } else {
      this.viewerExplorer?.destroy();
      this.viewerExplorer = null;
      if (this.contextMenuParams) {
        this.contextMenuParams.viewerExplorer = null;
      }
    }
  }

  private async mount(source: ExplorerSource, container: HTMLElement): Promise<void> {
    if (!this.runtime || !this.contextMenuParams) {
      return;
    }
    this.cleanup(source);
    const generation = this.generations[source];
    const isCurrent = () => container.isConnected && this.pendingHosts[source] === container && this.generations[source] === generation;
    const getSelectionNode = (id: string) => {
      const explorer = source === "data" ? this.dataExplorer : source === "scene" ? this.sceneTree
        : source === "ifc" ? this.ifcTree : source === "ifcStoreys" ? this.ifcStoreys
        : source === "ifcTypes" ? this.ifcTypes : this.viewerExplorer;
      const store = explorer?.store;
      if (!store) return null;
      const node = store.getNode(id);
      const objectId = node && "getObjectId" in store ? store.getObjectId(node as any) : null;
      return node && objectId ? {...node, kind: "object", objectId} : node;
    };
    const selectionCleanup = bindExplorerSelection(container, source, getSelectionNode, {
      hasSceneObject: (id) => !!this.runtime?.scene.objects[id],
      selectSceneObject: this.runtime.selectSceneObject,
      setInspectorContext: this.runtime.setInspectorContext
    });
    if (source === "data") {
      const explorer = await DataExplorerView.create({
        container,
        data: this.runtime.data,
        scene: this.runtime.scene,
        view: this.runtime.view,
        vue: this.runtime.vue,
        confirmDeleteModel: (modelId) => this.runtime!.confirmDeleteModel("DataModel", modelId)
      });
      if (!isCurrent()) {
        explorer.destroy();
        selectionCleanup();
        return;
      }
      this.dataExplorer = explorer;
      this.contextMenuParams.dataExplorer = explorer;
    } else if (source === "ifc") {
      const explorer = await IFCTreeView.create({
        initialExpandDepth: 1,
        container,
        data: this.runtime.data,
        scene: this.runtime.scene,
        viewer: this.runtime.viewer,
        view: this.runtime.view,
        vue: this.runtime.vue
      });
      if (!isCurrent()) {
        explorer.destroy();
        selectionCleanup();
        return;
      }
      this.ifcTree = explorer;
    } else if (source === "ifcStoreys") {
      const explorer = await IFCStoreysView.create({
        container,
        data: this.runtime.data,
        scene: this.runtime.scene,
        viewer: this.runtime.viewer,
        view: this.runtime.view,
        vue: this.runtime.vue
      });
      if (!isCurrent()) {
        explorer.destroy();
        selectionCleanup();
        return;
      }
      this.ifcStoreys = explorer;
    } else if (source === "ifcTypes") {
      const explorer = await IFCTypesView.create({
        container,
        data: this.runtime.data,
        scene: this.runtime.scene,
        viewer: this.runtime.viewer,
        view: this.runtime.view,
        vue: this.runtime.vue
      });
      if (!isCurrent()) {
        explorer.destroy();
        selectionCleanup();
        return;
      }
      this.ifcTypes = explorer;
    } else if (source === "scene") {
      const explorer = await SceneTreeView.create({
        container,
        scene: this.runtime.scene,
        viewer: this.runtime.viewer,
        view: this.runtime.view,
        vue: this.runtime.vue,
        confirmDeleteModel: (modelId) => this.runtime!.confirmDeleteModel("SceneModel", modelId),
        confirmDeleteObject: (objectId, modelId) => this.runtime!.confirmDeleteModel(`SceneObject in ${modelId}`, objectId)
      });
      if (!isCurrent()) {
        explorer.destroy();
        selectionCleanup();
        return;
      }
      this.sceneTree = explorer;
      this.contextMenuParams.sceneTree = explorer;
    } else {
      const explorer = await ViewerExplorerView.create({
        container,
        viewer: this.runtime.viewer,
        renderer: this.runtime.renderer,
        rendererLabel: this.runtime.rendererLabel,
        vue: this.runtime.vue
      });
      if (!isCurrent()) {
        explorer.destroy();
        selectionCleanup();
        return;
      }
      this.viewerExplorer = explorer;
      this.contextMenuParams.viewerExplorer = explorer;
    }
    const contextMenuCleanup = installExplorerContextMenu(this.contextMenuParams, container, source);
    const session = this.sessions.get(source);
    const keyboardCleanup = installExplorerKeyboard(container, session.focusedNodeId);
    const selectionStateCleanup = bindExplorerSelectionState(container, this.runtime.selectionService, getSelectionNode);
    const store = this.getStore(source)!;
    const sessionBinding = bindExplorerSession(container, store, session,
      callback => this.runtime!.vue.watch(() => store.state.revision, callback, {flush: "post"}),
      () => this.runtime!.vue.nextTick());
    this.cleanups[source] = () => {
      sessionBinding.dispose();
      selectionStateCleanup();
      keyboardCleanup();
      contextMenuCleanup();
      selectionCleanup();
    };
    await sessionBinding.ready;
  }

  private toToolWindowId(source: ExplorerSource): string {
    if (source === "ifc") {
      return "ifcStructure";
    }
    if (source === "ifcStoreys") {
      return "ifcStoreys";
    }
    if (source === "ifcTypes") {
      return "ifcTypes";
    }
    return source === "viewer" ? "viewerExplorer" : source;
  }
}
