import type {InspectorContext, InspectorSource} from "../state/createWorkspaceStore";

export interface InspectableExplorerNode {
  id: string;
  kind?: string;
  title?: string;
  detail?: string;
  componentId?: string;
  objectId?: string;
  modelId?: string;
  type?: string;
}

export function inspectExplorerNode(
  source: InspectorSource,
  node: InspectableExplorerNode,
  actions: {
    hasSceneObject(id: string): boolean;
    selectSceneObject(id: string): void;
    setInspectorContext(context: InspectorContext): void;
  }
): void {
  const objectId = node.kind === "object" ? node.objectId || node.componentId
    : !node.kind && source.startsWith("ifc") ? node.id : null;
  if (objectId && actions.hasSceneObject(objectId)) {
    actions.selectSceneObject(objectId);
    return;
  }
  actions.setInspectorContext({
    source,
    title: node.title || node.id,
    kind: node.kind || node.type || source,
    detail: node.detail || node.componentId || node.modelId || node.id
  });
}
