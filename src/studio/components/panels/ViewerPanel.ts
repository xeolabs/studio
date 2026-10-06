export function createViewerPanel(Vue: any) {
  return {
    name: "StudioViewerPanel",
    setup() {
      const workspace = Vue.inject("workspace");
      const commands = Vue.inject("commands") as any;
      const viewerHostActions = Vue.inject("viewerHostActions") as any;
      const panel = Vue.ref(null as HTMLElement | null);
      const canvasHost = Vue.ref(null as HTMLElement | null);
      const switcherStyle = Vue.ref({display: "none"} as Record<string, string>);
      let resizeObserver: ResizeObserver | null = null;
      const updateSwitcherPosition = () => {
        const element = panel.value;
        if (!element?.isConnected) {
          switcherStyle.value = {display: "none"};
          return;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          switcherStyle.value = {display: "none"};
          return;
        }
        switcherStyle.value = {
          position: "fixed",
          right: `${Math.max(12, window.innerWidth - rect.right + 12)}px`,
          top: `${Math.max(42, rect.top + 12)}px`,
          zIndex: "199999990"
        };
      };
      Vue.onMounted(() => {
        if (canvasHost.value && panel.value) {
          viewerHostActions.mounted(canvasHost.value, panel.value);
        }
        resizeObserver = typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(updateSwitcherPosition)
          : null;
        if (panel.value) {
          resizeObserver?.observe(panel.value);
        }
        window.addEventListener("resize", updateSwitcherPosition);
        requestAnimationFrame(updateSwitcherPosition);
      });
      Vue.onUnmounted(() => {
        resizeObserver?.disconnect();
        resizeObserver = null;
        window.removeEventListener("resize", updateSwitcherPosition);
        viewerHostActions.unmounted();
      });
      const switchRenderer = (mode: string) => {
        commands.execute(`renderer.${mode}`);
      };
      return {canvasHost, panel, switcherStyle, switchRenderer, workspace};
    },
    template: `
      <section ref="panel" class="studio-panel viewer-panel">
        <div id="viewerCanvasHost" ref="canvasHost" class="viewer-canvas-host"></div>
        <Teleport to="body">
        <div class="renderer-switcher renderer-switcher-floating" :style="switcherStyle" aria-label="Renderer selector">
          <el-radio-group
            :model-value="workspace.rendererMode"
            size="small"
            :disabled="!workspace.loaded || workspace.rendererSwitching"
            @change="switchRenderer($event)">
            <el-radio-button value="webgl">WebGL</el-radio-button>
            <el-radio-button value="webgpu">WebGPU</el-radio-button>
          </el-radio-group>
          <span v-if="workspace.rendererSwitching">Switching...</span>
          <span v-else-if="workspace.rendererError" class="renderer-error">{{ workspace.rendererError }}</span>
        </div>
        </Teleport>
        <div id="status" class="status" :data-hidden="workspace.loaded ? 'true' : 'false'">{{ workspace.status }}</div>
      </section>
    `
  };
}
