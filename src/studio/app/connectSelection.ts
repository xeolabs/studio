import {SelectionService} from "../services/SelectionService";
import type {InspectorContext} from "../state/createWorkspaceStore";

export interface ConnectSelectionParams {
  detailsResolver: any;
  notifyLayoutChanged: () => void;
  refreshStatusItems: (selectedCount?: number) => void;
  view: any;
  workspace: any;
}

export interface SelectionConnection {
  selectionService: SelectionService;
  selectSceneObject(sceneObjectId: string | null): void;
}

export function connectSelection(params: ConnectSelectionParams): SelectionConnection {
  const {detailsResolver, notifyLayoutChanged, refreshStatusItems, view, workspace} = params;
  const setInspectorContext = (context: InspectorContext) => {
    workspace.setInspectorContext(context);
    notifyLayoutChanged();
  };
  const selectionService = new SelectionService({
    view,
    detailsResolver,
    onSelectionDetails: (details) => {
      workspace.setSelectedObjectDetails(details);
      refreshStatusItems(details ? 1 : 0);
      if (!details) {
        if (workspace.inspectorContext.sceneObjectId) {
          setInspectorContext({source: "scene", title: "Inspector", kind: "Selection", detail: "No object selected."});
        }
        return;
      }
      setInspectorContext({
        source: "scene",
        sceneObjectId: details.sceneObjectId,
        title: details.title,
        kind: details.dataObjectId ? "DataObject" : "SceneObject",
        detail: details.dataObjectId
          ? `${details.type} linked to SceneObject ${details.sceneObjectId}`
          : `No corresponding DataObject was found for ${details.sceneObjectId}.`
      });
    }
  });
  return {
    selectionService,
    selectSceneObject: (sceneObjectId) => selectionService.selectSceneObject(sceneObjectId)
  };
}
