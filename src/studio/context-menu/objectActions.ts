import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {SelectionService} from "../services/SelectionService";
import {copyText} from "../ui/clipboard";

export interface StudioObjectActionParams {
  scene: Scene;
  view: View;
  dataExplorer: any;
  sceneTree: any;
  selectionService: SelectionService;
  selectSceneObject: (sceneObjectId: string | null) => void;
}

export function selectNodeSceneObject(params: StudioObjectActionParams, node: any): void {
  const objectId = node.objectId || (node.kind === "object" ? node.componentId : null);
  if (objectId && params.view.objects[objectId]) {
    params.selectSceneObject(objectId);
  }
}

export function setSceneNodeVisible(store: any, node: any, visible: boolean): void {
  if (node.kind === "model") {
    store.setModelVisibility(node, visible);
  } else if (node.kind === "object") {
    store.setObjectVisibility(node, visible);
  }
}

export function setDataNodeVisible(store: any, node: any, visible: boolean): void {
  if (node.kind === "model") {
    store.setModelVisibility(node, visible);
  } else if (node.kind === "typeGroup") {
    store.setTypeVisibility(node, visible);
  } else if (node.kind === "object") {
    store.setObjectVisibility(node, visible);
  }
}

export function showOnlySceneNode(params: StudioObjectActionParams, node: any): void {
  const objectIds = node.kind === "model" && node.modelId
    ? Object.keys(params.scene.models[node.modelId]?.objects || {}).filter((objectId) => !!params.view.objects[objectId])
    : node.kind === "object" && node.objectId
      ? [node.objectId]
      : [];
  showOnlyObjects(params, objectIds);
}

export function showOnlyDataNode(params: StudioObjectActionParams, node: any): void {
  const objectIds = node.kind === "model" && node.modelId
    ? Object.keys(params.dataExplorer.store.data.models[node.modelId]?.objects || {}).filter((objectId) => !!params.view.objects[objectId])
    : node.kind === "typeGroup"
      ? params.dataExplorer.store.getTypeViewObjectIds(node)
      : node.kind === "object" && node.componentId
        ? [node.componentId]
        : [];
  showOnlyObjects(params, objectIds);
}

export function showOnlyObject(params: StudioObjectActionParams, objectId: string | null | undefined): void {
  showOnlyObjects(params, objectId ? [objectId] : []);
}

export function showOnlyObjects(params: StudioObjectActionParams, objectIds: string[]): void {
  params.view.setObjectsVisible(Object.keys(params.view.objects), false);
  params.view.setObjectsVisible(objectIds, true);
}

export function showAll(params: StudioObjectActionParams): void {
  params.view.setObjectsVisible(Object.keys(params.view.objects), true);
}

export function resolveObjectName(params: StudioObjectActionParams, objectId: string): string {
  const details = params.scene.objects[objectId] ? params.scene.objects[objectId].originalSystemId : null;
  return details || objectId;
}

export function copyCamera(view: View): void {
  const camera = view.camera;
  void copyText(JSON.stringify({
    eye: Array.from(camera.eye),
    look: Array.from(camera.look),
    up: Array.from(camera.up),
    projection: camera.projectionType
  }, null, 2));
}
