export interface WorkspaceHostComponentParams {
  dockviewComponents: Record<string, unknown>;
  onDockviewReady: (event: any) => void;
}

export function createWorkspaceHostComponent(_Vue: any, params: WorkspaceHostComponentParams) {
  return {
    name: "StudioWorkspaceHost",
    setup() {
      return {
        dockviewComponents: params.dockviewComponents,
        onDockviewReady: params.onDockviewReady
      };
    },
    template: `
      <section class="studio-workbench">
        <DockviewVue
          class="workspace dockview-theme-light"
          :components="dockviewComponents"
          @ready="onDockviewReady"/>
      </section>
    `
  };
}
