import {createBoundariesPanel} from "./BoundariesPanel";
import {createDataHealthPanel} from "./DataHealthPanel";
import {createDiagnosticCenterPanel} from "./DiagnosticCenterPanel";
import {createDiagnosticsPanel} from "./DiagnosticsPanel";
import {createExplorerHostPanel} from "./ExplorerHostPanel";
import {createInspectorPanel} from "./InspectorPanel";
import {createRuntimeOverviewPanel} from "./RuntimeOverviewPanel";
import {createSceneHealthPanel} from "./SceneHealthPanel";
import {createSunStudyPanel} from "./SunStudyPanel";
import {createTilesPanel} from "./TilesPanel";
import {createViewerPanel} from "./ViewerPanel";

export function createDockviewComponents(Vue: any) {
  return {
    DataExplorerPanel: createExplorerHostPanel(Vue, "StudioDataExplorerPanel", "data", "dataExplorerPanel"),
    IfcStructurePanel: createExplorerHostPanel(Vue, "StudioIfcStructurePanel", "ifc", "ifcStructurePanel"),
    IfcStoreysPanel: createExplorerHostPanel(Vue, "StudioIfcStoreysPanel", "ifcStoreys", "ifcStoreysPanel"),
    IfcTypesPanel: createExplorerHostPanel(Vue, "StudioIfcTypesPanel", "ifcTypes", "ifcTypesPanel"),
    SceneExplorerPanel: createExplorerHostPanel(Vue, "StudioSceneExplorerPanel", "scene", "sceneExplorerPanel"),
    ViewerExplorerPanel: createExplorerHostPanel(Vue, "StudioViewerExplorerPanel", "viewer", "viewerExplorerPanel"),
    ViewerPanel: createViewerPanel(Vue),
    InspectorPanel: createInspectorPanel(Vue),
    RuntimeOverviewPanel: createRuntimeOverviewPanel(Vue),
    DiagnosticCenterPanel: createDiagnosticCenterPanel(Vue),
    BoundariesPanel: createBoundariesPanel(Vue),
    TilesPanel: createTilesPanel(Vue),
    SunStudyPanel: createSunStudyPanel(Vue),
    DiagnosticsPanel: createDiagnosticsPanel(Vue),
    SceneHealthPanel: createSceneHealthPanel(Vue),
    DataHealthPanel: createDataHealthPanel(Vue)
  };
}
