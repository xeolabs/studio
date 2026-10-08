import {Bookmark, Ruler, MousePointer2, EyeOff, Contrast, Search, Layers3, Scissors, Ellipsis, Upload, Download, Eye, Sparkles, Sun} from "lucide-vue-next";
import {createToolPopover} from "./ToolPopover";
import {toolWindowPanels} from "../../layout/toolWindowDefinitions";

export interface WorkspaceHostComponentParams {
  dockviewComponents: Record<string, unknown>;
  onDockviewReady: (event: any) => void;
  workspace: any;
  commands: any;
}

export function createWorkspaceHostComponent(Vue: any, params: WorkspaceHostComponentParams) {
  return {
    name: "StudioWorkspaceHost",
    components: {Bookmark, ToolPopover: createToolPopover(Vue), Ruler, MousePointer2, EyeOff, Contrast, Search, Layers3, Scissors, Ellipsis, Upload, Download, Eye, Sparkles, Sun},
    setup() {
      const workspace = params.workspace;
      const activePanel = Vue.computed(() => toolWindowPanels[workspace.responsivePanelId]);
      const panelTitle = (id: string) => id === "ifcStoreys" ? "Floors" : id === "inspector" ? "Properties" : toolWindowPanels[id]?.title;
      const runCommand = (id: string) => params.commands.execute(id);
      const closePanel = () => {
        const id = workspace.responsivePanelId;
        workspace.setResponsivePanel("");
        Vue.nextTick(() => {
          const button = document.querySelector<HTMLButtonElement>(`[data-tool-panel="${id}"]`)
            || document.querySelector<HTMLButtonElement>('[data-tool-panel="explore"]');
          button?.focus({preventScroll: true});
        });
      };
      return {
        activePanel,
        isBuildingView: Vue.computed(() => ['ifcStructure', 'ifcStoreys', 'ifcTypes'].includes(workspace.responsivePanelId)),
        activeTitle: Vue.computed(() => panelTitle(workspace.responsivePanelId)),
        workspace,
        panels: Vue.computed(() => ["ifcStructure", "ifcStoreys", "ifcTypes", "inspector", "section", "sun-study", workspace.responsivePanelId]
          .filter((id, index, ids) => id && ids.indexOf(id) === index).map(id => ({id, title: panelTitle(id)}))),
        runCommand,
        hasModels: Vue.computed(() => workspace.loadedModels.some((model: any) => model.objectCount)),
        openPanel: (id: string) => runCommand(`view.toolWindows.${id}`),
        closePanel,
        dockviewComponents: params.dockviewComponents,
        onDockviewReady: params.onDockviewReady
      };
    },
    template: `
      <section class="studio-workbench">
        <nav class="workspace-toolbar" aria-label="Model tools">
          <ToolPopover label="Interaction mode" :active="workspace.toolMode === 'hide' || workspace.toolMode === 'xray'" :disabled="!hasModels">
            <template #trigger><MousePointer2 v-if="workspace.toolMode === 'select' || workspace.toolMode === 'measure'"/><EyeOff v-else-if="workspace.toolMode === 'hide'"/><Contrast v-else/>
              <span>{{ workspace.toolMode === 'xray' ? 'X-ray' : workspace.toolMode === 'hide' ? 'Hide' : 'Select' }}<small> ▾</small></span></template>
            <button type="button" role="menuitemradio" :aria-checked="workspace.toolMode === 'select'" @click="runCommand('tools.select')"><MousePointer2/><span>Select<small>Tap an element to inspect it</small></span></button>
            <button type="button" role="menuitemradio" :aria-checked="workspace.toolMode === 'hide'" @click="runCommand('tools.hide')"><EyeOff/><span>Hide<small>Tap elements to hide them</small></span></button>
            <button type="button" role="menuitemradio" :aria-checked="workspace.toolMode === 'xray'" @click="runCommand('tools.xray')"><Contrast/><span>X-ray<small>Tap elements to toggle X-ray</small></span></button>
          </ToolPopover>
          <button type="button" title="Explore models and elements" data-tool-panel="explore" @click="openPanel(workspace.explorePanelId === 'ifcStoreys' ? 'ifcStructure' : workspace.explorePanelId)" :aria-expanded="workspace.explorePanelId !== 'ifcStoreys' && !!workspace.toolWindowOpen[workspace.explorePanelId]"><Search/><span>Explore</span></button>
          <button type="button" title="Browse floors" data-tool-panel="ifcStoreys" @click="openPanel('ifcStoreys')" :aria-expanded="!!workspace.toolWindowOpen.ifcStoreys"><Layers3/><span>Floors</span></button>
          <button type="button" title="Section cuts" data-tool-panel="section" @click="openPanel('section')" :aria-expanded="!!workspace.toolWindowOpen.section"><Scissors/><span>Section</span></button>
          <button type="button" title="Measure distance" :disabled="!hasModels" :aria-pressed="workspace.toolMode === 'measure'" @click="runCommand('tools.measure')"><Ruler/><span>Measure</span></button>
          <ToolPopover label="More model tools"><template #trigger><Ellipsis/><span>More</span></template>
            <button type="button" role="menuitem" @click="runCommand('views.open')"><Bookmark/>Saved views</button>
            <button type="button" role="menuitem" @click="runCommand('file.import')"><Upload/>Import model</button>
            <button type="button" role="menuitem" :disabled="!hasModels" @click="runCommand('file.export')"><Download/>Export</button>
            <hr/>
            <button type="button" role="menuitem" :disabled="!hasModels" @click="runCommand('viewport.showAll')"><Eye/>Show all elements</button>
            <button type="button" role="menuitem" :disabled="!hasModels" @click="runCommand('viewport.clearViewEffects')"><Sparkles/>Clear effects</button>
            <button type="button" role="menuitem" @click="openPanel('sun-study')"><Sun/>Sun study</button>
          </ToolPopover>
        </nav>
        <div class="workspace-content" :data-tool-open="workspace.layoutMode !== 'wide' && !!activePanel" :data-panel-size="workspace.responsivePanelSize">
          <DockviewVue
            class="workspace dockview-theme-light"
            :components="dockviewComponents"
            :disable-dnd="workspace.layoutMode !== 'wide'"
            @ready="onDockviewReady"/>
          <aside v-if="workspace.layoutMode !== 'wide' && activePanel" class="responsive-tool-drawer"
            :aria-label="activeTitle" @keydown.esc.stop="closePanel">
            <header class="responsive-tool-header">
              <strong v-if="isBuildingView" class="responsive-tool-title">Explore</strong>
              <select v-else class="responsive-tool-picker" aria-label="Tool panel" :value="workspace.responsivePanelId" @change="openPanel($event.target.value)">
                <option v-for="item in panels" :key="item.id" :value="item.id">{{ item.title }}</option>
              </select>
              <button class="responsive-sheet-size" type="button" :aria-expanded="workspace.responsivePanelSize !== 'peek'"
                @click="workspace.setResponsivePanelSize(workspace.responsivePanelSize === 'peek' ? 'half' : 'peek')">
                {{ workspace.responsivePanelSize === 'peek' ? 'Open' : 'Collapse' }}
              </button>
              <button class="responsive-sheet-size" v-if="workspace.responsivePanelSize !== 'peek'" type="button"
                @click="workspace.setResponsivePanelSize(workspace.responsivePanelSize === 'expanded' ? 'half' : 'expanded')">
                {{ workspace.responsivePanelSize === 'expanded' ? 'Reduce' : 'Expand' }}
              </button>
              <button type="button" aria-label="Close tool panel" @click="closePanel">Close</button>
            </header>
            <section id="responsive-tool-panel" class="responsive-tool-panel">
              <component :is="dockviewComponents[activePanel.component]" :key="workspace.responsivePanelId"/>
            </section>
          </aside>
        </div>
      </section>
    `
  };
}
