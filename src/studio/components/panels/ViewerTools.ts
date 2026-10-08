import {Focus, Undo2, Redo2, Plus, Minus, Maximize, House, Navigation, ArrowLeft, ArrowRight, ArrowUp, ArrowDown} from "lucide-vue-next";
import {createMeasurementControls} from "./MeasurementControls";
import {createToolPopover} from "../shell/ToolPopover";

export function createViewerTools(Vue: any) {
  return {
    name: "ViewerTools",
    components: {MeasurementControls: createMeasurementControls(Vue), ToolPopover: createToolPopover(Vue), Focus, Undo2, Redo2, Plus, Minus, Maximize, House, Navigation, ArrowLeft, ArrowRight, ArrowUp, ArrowDown},
    setup() {
      const workspace = Vue.inject('workspace'), commands = Vue.inject('commands');
      const bounds = Vue.ref({left: 0, top: 0, width: 0, height: 0});
      let observer: ResizeObserver | null = null;
      const measure = () => {
        const canvas = document.getElementById('viewerCanvasHost');
        if (!canvas) return;
        const {left, top, width, height} = canvas.getBoundingClientRect();
        bounds.value = {left, top, width, height};
        Vue.nextTick(() => window.dispatchEvent(new Event('studio-overlay-change')));
      };
      const stop = Vue.watch(() => [workspace.toolMode, workspace.section.planFloorId, workspace.section.enabled,
        workspace.isolationLabel, workspace.history.canUndo, workspace.history.canRedo], () => Vue.nextTick(measure));
      Vue.onMounted(() => {
        observer = new ResizeObserver(measure);
        const host = document.getElementById('viewerCanvasHost'); if (host) observer.observe(host);
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        measure();
      });
      Vue.onUnmounted(() => {stop(); observer?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true);});
      return {workspace, bounds,
        hasModels: Vue.computed(() => workspace.loadedModels.some((model: any) => model.objectCount)),
        run: (id: string, payload?: unknown) => commands.execute(id, payload),
        enabled: (id: string) => commands.isEnabled(id),
        layerStyle: Vue.computed(() => Object.fromEntries(Object.entries(bounds.value).map(([key, value]) => [key, value + 'px'])))};
    },
    template: `<Teleport to="body"><div v-if="bounds.width > 0 && bounds.height > 0" class="viewer-tools-layer"
      :data-narrow="bounds.width < 520" :data-short="bounds.height < 260" :style="layerStyle">
      <div class="viewer-context-stack">
        <MeasurementControls/>
        <div v-if="workspace.section.enabled && !workspace.section.planFloorId" class="viewer-context-message tool-surface" data-plan-label-obstacle>
          <span>{{ workspace.section.orientation === 'horizontal' ? 'Horizontal' : 'Vertical' }} cut</span>
          <button type="button" @click="run('section.clear')">Clear cut</button>
        </div>
        <div v-if="workspace.toolMode === 'hide' || workspace.toolMode === 'xray'" class="viewer-context-message tool-surface mode-message" data-plan-label-obstacle role="status">
          <span>{{ workspace.toolMode === 'hide' ? 'Tap elements to hide' : 'Tap elements to toggle X-ray' }}</span>
          <button type="button" @click="run('tools.select')">Done</button>
        </div>
        <div v-if="workspace.isolationLabel" class="viewer-context-message tool-surface" data-plan-label-obstacle>
          <span :title="workspace.isolationLabel">Isolated: {{ workspace.isolationLabel }}</span>
          <button type="button" @click="run('viewport.restoreIsolation')">Restore</button>
        </div>
      </div>
      <nav v-if="workspace.history.canUndo || workspace.history.canRedo" class="viewer-recovery tool-surface" data-plan-label-obstacle aria-label="View history">
        <button type="button" :title="'Undo ' + workspace.history.undoLabel" :aria-label="'Undo ' + workspace.history.undoLabel"
          :disabled="!workspace.history.canUndo" @click="run('view.undo')"><Undo2/><span>Undo</span></button>
        <button type="button" :title="'Redo ' + workspace.history.redoLabel" :aria-label="'Redo ' + workspace.history.redoLabel"
          :disabled="!workspace.history.canRedo" @click="run('view.redo')"><Redo2/></button>
      </nav>
      <nav class="viewer-camera-tools tool-surface" data-plan-label-obstacle aria-label="Camera controls">
        <button type="button" :disabled="!hasModels" :title="workspace.section.planFloorId ? 'Fit plan' : 'Fit model'" @click="run('viewport.fitAll')"><Focus/><span>Fit</span></button>
        <ToolPopover label="Camera navigation" :disabled="!hasModels" stay-open><template #trigger><Navigation/></template>
          <div class="camera-zoom-row" role="group" aria-label="Zoom">
            <button type="button" title="Zoom out" aria-label="Zoom out" @click="run('camera.zoomOut')"><Minus/></button>
            <span>Zoom</span><button type="button" title="Zoom in" aria-label="Zoom in" @click="run('camera.zoomIn')"><Plus/></button>
          </div>
          <div class="camera-pan-pad" role="group" aria-label="Pan">
            <button type="button" class="pan-up" title="Pan up" aria-label="Pan up" @click="run('camera.panUp')"><ArrowUp/></button>
            <button type="button" class="pan-left" title="Pan left" aria-label="Pan left" @click="run('camera.panLeft')"><ArrowLeft/></button>
            <span>Pan</span><button type="button" class="pan-right" title="Pan right" aria-label="Pan right" @click="run('camera.panRight')"><ArrowRight/></button>
            <button type="button" class="pan-down" title="Pan down" aria-label="Pan down" @click="run('camera.panDown')"><ArrowDown/></button>
          </div>
          <hr/>
          <button type="button" role="menuitem" @click="run('viewport.homeView')"><House/>{{ workspace.section.planFloorId ? 'Return to 3D' : 'Home view' }}</button>
          <button type="button" role="menuitem" :disabled="!enabled('camera.fullscreen')" @click="run('camera.fullscreen')"><Maximize/>Full screen</button>
          <p class="tool-help">Drag to {{ workspace.section.planFloorId ? 'pan' : 'orbit' }}. Use two fingers to pan and pinch to zoom.</p>
        </ToolPopover>
      </nav>
    </div></Teleport>`
  };
}
