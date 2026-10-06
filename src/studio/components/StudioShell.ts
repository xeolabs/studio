import type {CommandRegistry} from "../commands/CommandRegistry";
import type {ContextMenuService} from "../services/ContextMenuService";
import {createBottomPanelComponent} from "./shell/BottomPanel";
import {createCommandPaletteComponent} from "./shell/CommandPalette";
import {createContextMenuLayerComponent} from "./shell/ContextMenuLayer";
import {createMenuBarComponent} from "./shell/MenuBar";
import {createStatusBarComponent} from "./shell/StatusBar";
import {createWorkspaceHostComponent} from "./shell/WorkspaceHost";
import {installCommandShortcuts} from "../input/installCommandShortcuts";

export interface StudioShellParams {
  commands: CommandRegistry;
  contextMenuService: ContextMenuService;
  contextMenuState: any;
  diagnosticsPanelState: any;
  sceneHealthPanelState: any;
  dataHealthPanelState: any;
  dockviewComponents: Record<string, unknown>;
  menuSections: any[];
  notifyLayoutChanged: () => void;
  onDockviewReady: (event: any) => void;
  toolWindowMenuItems: any[];
  workspace: any;
}

export function createStudioShellComponent(Vue: any, params: StudioShellParams) {
  return {
    name: "StudioViewerExample",
    components: {
      StudioBottomPanel: createBottomPanelComponent(Vue, params),
      StudioCommandPalette: createCommandPaletteComponent(Vue, params),
      StudioContextMenuLayer: createContextMenuLayerComponent(Vue, params),
      StudioMenuBar: createMenuBarComponent(Vue, params),
      StudioStatusBar: createStatusBarComponent(Vue, params),
      StudioWorkspaceHost: createWorkspaceHostComponent(Vue, params)
    },
    setup() {
      const appShellStyle = Vue.computed(() => ({
        "--studio-bottom-panel-height": params.workspace.bottomPanelOpen ? `${params.workspace.bottomPanelHeight}px` : "28px"
      }));
      let cleanupShortcuts: (() => void) | null = null;
      Vue.onMounted(() => {
        cleanupShortcuts = installCommandShortcuts({commands: params.commands});
      });
      Vue.onUnmounted(() => {
        cleanupShortcuts?.();
        cleanupShortcuts = null;
      });
      return {appShellStyle};
    },
    template: `
      <main class="app-shell" :style="appShellStyle">
        <StudioMenuBar/>
        <StudioWorkspaceHost/>
        <StudioBottomPanel/>
        <StudioStatusBar/>
        <StudioContextMenuLayer/>
        <StudioCommandPalette/>
        <ExportDialogPanel/>
        <ImportDialogPanel/>
      </main>
    `
  };
}
