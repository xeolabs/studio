import {createPlanLabelsControl} from "./PlanLabelsControl";
import {createViewerTools} from "./ViewerTools";
import {createSelectionEffects} from "./SelectionEffects";
export function createViewerPanel(Vue: any) {
  return {
    name: "StudioViewerPanel",
    components: {PlanLabelsControl: createPlanLabelsControl(Vue), ViewerTools: createViewerTools(Vue), SelectionEffects: createSelectionEffects(Vue)},
    setup() {
      const workspace = Vue.inject("workspace");
      const commands = Vue.inject("commands") as any;
      const viewerHostActions = Vue.inject("viewerHostActions") as any;
      const panel = Vue.ref(null as HTMLElement | null);
      const canvasHost = Vue.ref(null as HTMLElement | null);
      Vue.onMounted(() => {
        if (canvasHost.value && panel.value) viewerHostActions.mounted(canvasHost.value, panel.value);
      });
      Vue.onUnmounted(() => viewerHostActions.unmounted());
      // A collapsed Properties sheet must return the element actions to the canvas.
      const propertiesVisible = Vue.computed(() => workspace.inspectorVisible &&
        (workspace.layoutMode === "wide" || workspace.responsivePanelSize !== "peek") &&
        workspace.inspectorContext.sceneObjectId === workspace.selectedObjectDetails?.sceneObjectId);
      return {canvasHost, panel, propertiesVisible, workspace,
        runCommand: (id: string, payload?: unknown) => commands.execute(id, payload),
        commandEnabled: (id: string) => commands.isEnabled(id)};
    },
    template: `
      <section ref="panel" class="studio-panel viewer-panel" :data-plan="!!workspace.section.planFloorId">
        <div v-if="workspace.section.planFloorId" class="viewer-plan-controls" aria-label="Plan controls">
          <select aria-label="Plan floor" :value="workspace.section.planFloorId" @change="runCommand('section.floorPlan', $event.target.value)">
            <option v-for="floor in workspace.section.floors" :key="floor.id" :value="floor.id">{{ floor.title }}</option>
          </select>
          <PlanLabelsControl/>
          <button type="button" :aria-pressed="workspace.section.planStyle" @click="runCommand('section.style')">Outlines</button>
          <button type="button" title="Return to 3D" aria-label="Return to 3D" @click="runCommand('section.return3D')">3D view</button>
        </div>
        <ViewerTools/>
        <div id="viewerCanvasHost" ref="canvasHost" class="viewer-canvas-host">
          <Teleport to="body">
          <div v-if="workspace.section.planFloorId && workspace.section.labelsEnabled && workspace.toolMode !== 'measure'" class="plan-label-layer" aria-label="Plan labels"
            :style="{left: workspace.section.planLabelViewport.left + 'px', top: workspace.section.planLabelViewport.top + 'px', width: workspace.section.planLabelViewport.width + 'px', height: workspace.section.planLabelViewport.height + 'px'}">
            <span v-for="label in workspace.section.planLabels" :key="label.id" class="plan-label" :class="{'is-selected': label.selected}"
              :title="label.title" :style="{left: label.x + 'px', top: label.y + 'px', width: label.width + 'px'}"><span>{{ label.text }}</span></span>
          </div>
          </Teleport>
        </div>
        <section v-if="workspace.selectedObjectDetails && !propertiesVisible" class="selection-card" aria-label="Selected element">
          <div class="selection-card-heading">
            <div class="selection-card-identity" role="status" aria-live="polite">
              <strong :title="workspace.selectedObjectDetails.title">{{ workspace.selectedObjectDetails.title }}</strong>
              <span>{{ workspace.selectedObjectDetails.type === 'SceneObject' ? 'Model element' : workspace.selectedObjectDetails.type }}</span>
            </div>
            <button type="button" aria-label="Clear selection" @click="runCommand('selection.clear')">Clear</button>
          </div>
          <nav class="selection-card-actions" aria-label="Selected element actions">
            <button type="button" data-tool-panel="inspector" :aria-expanded="!!workspace.toolWindowOpen.inspector" @click="runCommand('selection.inspect')">Properties</button>
            <button type="button" :disabled="!commandEnabled('viewport.frameSelection')" @click="runCommand('viewport.frameSelection')">Focus</button>
            <SelectionEffects/>
          </nav>
        </section>
        <div id="status" class="status" :data-hidden="workspace.loaded ? 'true' : 'false'">{{ workspace.status }}</div>
      </section>
    `
  };
}
