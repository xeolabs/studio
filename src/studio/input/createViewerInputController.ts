import {RoutingPickStrategy} from "@xeokit/sdk/spatial/picking";
import {ModelNavigationController} from "@xeokit/sdk/viewing/navigation/model";
import {toNavigationPick} from "../runtime";

export interface CreateViewerInputControllerParams {
  picker: RoutingPickStrategy;
  selectSceneObject: (sceneObjectId: string | null) => void;
  selectionService: {clear(): void};
  view: any;
}

export function createViewerInputController(params: CreateViewerInputControllerParams): ModelNavigationController {
  const {picker, selectSceneObject, selectionService, view} = params;
  const controller = new ModelNavigationController(view, {
    pick: (_view, pickParams) => {
      const pickResult = picker.pick({view, canvasPos: pickParams.canvasPos});
      return {ok: true, value: pickResult.hit ? toNavigationPick(view, pickResult, pickParams.canvasPos) : null};
    }
  });
  controller.events.onPicked.subscribe((_controller, pickResult) => {
    selectSceneObject(pickResult.viewObject?.id || pickResult.sceneObject?.id || null);
  });
  controller.events.onPickedNothing.subscribe(() => selectionService.clear());
  return controller;
}
