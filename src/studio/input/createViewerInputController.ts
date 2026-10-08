import {PlanViewNavigationMode} from "@xeokit/sdk/base/constants";
import {RoutingPickStrategy} from "@xeokit/sdk/spatial/picking";
import {ModelNavigationController} from "@xeokit/sdk/viewing/navigation/model";
import {toNavigationPick} from "../runtime";

export interface CreateViewerInputControllerParams {
  picker: RoutingPickStrategy;
  selectSceneObject: (sceneObjectId: string | null) => void;
  selectionService: {clear(): void};
  view: any;
  planView?: boolean;
  getToolMode?: () => string;
}

export function createViewerInputController(params: CreateViewerInputControllerParams): ModelNavigationController {
  const {picker, selectSceneObject, selectionService, view} = params;
  const controller = new ModelNavigationController(view, {
    navMode: params.planView ? PlanViewNavigationMode : undefined,
    pick: (_view, pickParams) => {
      const pickResult = picker.pick({view, canvasPos: pickParams.canvasPos});
      return {ok: true, value: pickResult.hit ? toNavigationPick(view, pickResult, pickParams.canvasPos) : null};
    }
  });
  controller.events.onPicked.subscribe((_controller, pickResult) => {
    const id = pickResult.viewObject?.id || pickResult.sceneObject?.id || null;
    const mode = params.getToolMode?.() || "select";
    if (mode === "measure") return;
    if (mode === "hide" && id) view.setObjectsVisible([id], false);
    else if (mode === "xray" && id) view.setObjectsInStyleBin("xrayed", [id], !view.objects[id]?.hasStyleBin("xrayed"));
    else selectSceneObject(id);
  });
  controller.events.onPickedNothing.subscribe(() => {if (!params.getToolMode || params.getToolMode() === "select") selectionService.clear();});
  return controller;
}
