export interface StatusBarComponentParams {
  workspace: any;
}

export function createStatusBarComponent(Vue: any, params: StatusBarComponentParams) {
  return {
    name: "StudioStatusBar",
    setup() {
      const rendererLabel = Vue.computed(() => params.workspace.rendererMode === "webgl" ? "WebGL2" : "WebGPU");
      return {
        rendererLabel,
        workspace: params.workspace
      };
    },
    template: `
      <footer class="status-bar" aria-label="Status bar">
        <span>{{ workspace.status }}</span>
        <span v-for="item in workspace.statusItems" :key="item.id">{{ item.label }}</span>
        <span>{{ rendererLabel }}</span>
      </footer>
    `
  };
}
