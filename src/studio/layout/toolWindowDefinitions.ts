export const DOCKVIEW_LAYOUT_STORAGE_KEY = "xeokit.studio.vueExplorerTabs.dockviewLayout.v3";

export const LEFT_TOOL_WINDOW_IDS = ["data", "ifcStructure", "ifcStoreys", "ifcTypes", "scene", "viewerExplorer"] as const;
export const RIGHT_TOOL_WINDOW_IDS = ["inspector", "section", "runtime-overview", "diagnostic-center", "boundaries", "scene-health", "data-health", "diagnostics", "sun-study", "tiles"] as const;

export const toolWindowPanels: Record<string, {
  component: string;
  title: string;
  preferredReferencePanel: string;
  preferredDirection: string;
  fallbackDirection: string;
  renderer?: "always" | "onlyWhenVisible";
}> = {
  viewer: {component: "ViewerPanel", title: "3D Canvas", preferredReferencePanel: "boundaries", preferredDirection: "left", fallbackDirection: "right", renderer: "always"},
  data: {component: "DataExplorerPanel", title: "Data", preferredReferencePanel: "viewer", preferredDirection: "left", fallbackDirection: "left", renderer: "always"},
  ifcStructure: {component: "IfcStructurePanel", title: "Building", preferredReferencePanel: "data", preferredDirection: "within", fallbackDirection: "left", renderer: "always"},
  ifcStoreys: {component: "IfcStoreysPanel", title: "Floors", preferredReferencePanel: "ifcStructure", preferredDirection: "within", fallbackDirection: "left", renderer: "always"},
  ifcTypes: {component: "IfcTypesPanel", title: "Categories", preferredReferencePanel: "ifcStoreys", preferredDirection: "within", fallbackDirection: "left", renderer: "always"},
  scene: {component: "SceneExplorerPanel", title: "Scene", preferredReferencePanel: "data", preferredDirection: "within", fallbackDirection: "left", renderer: "always"},
  viewerExplorer: {component: "ViewerExplorerPanel", title: "Viewer", preferredReferencePanel: "scene", preferredDirection: "within", fallbackDirection: "left", renderer: "always"},
  section: {component: "SectionPanel", title: "Section", preferredReferencePanel: "inspector", preferredDirection: "within", fallbackDirection: "right"},
  inspector: {component: "InspectorPanel", title: "Properties", preferredReferencePanel: "viewer", preferredDirection: "right", fallbackDirection: "right"},
  "runtime-overview": {component: "RuntimeOverviewPanel", title: "Runtime", preferredReferencePanel: "inspector", preferredDirection: "within", fallbackDirection: "right"},
  "diagnostic-center": {component: "DiagnosticCenterPanel", title: "Diagnostics", preferredReferencePanel: "runtime-overview", preferredDirection: "within", fallbackDirection: "right"},
  boundaries: {component: "BoundariesPanel", title: "Boundaries", preferredReferencePanel: "viewer", preferredDirection: "right", fallbackDirection: "right"},
  "scene-health": {component: "SceneHealthPanel", title: "Scene Health", preferredReferencePanel: "boundaries", preferredDirection: "within", fallbackDirection: "right"},
  "data-health": {component: "DataHealthPanel", title: "Data Health", preferredReferencePanel: "boundaries", preferredDirection: "within", fallbackDirection: "right"},
  diagnostics: {component: "DiagnosticsPanel", title: "Warnings / Errors", preferredReferencePanel: "boundaries", preferredDirection: "within", fallbackDirection: "right"},
  "sun-study": {component: "SunStudyPanel", title: "Sun Study", preferredReferencePanel: "boundaries", preferredDirection: "within", fallbackDirection: "right"},
  tiles: {component: "TilesPanel", title: "Tiles", preferredReferencePanel: "boundaries", preferredDirection: "within", fallbackDirection: "right"}
};
