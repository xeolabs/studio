import type {CommandRegistry} from "./CommandRegistry";
import type {SelectionService} from "../services/SelectionService";
import {copyText} from "../ui/clipboard";
import {commandObjectId} from "./objectCommandTarget";

export interface RegisterSelectionCommandsParams {
  commands: CommandRegistry;
  selectionService: SelectionService;
  workspace: any;
  openInspector?: () => void;
}

export function registerSelectionCommands(params: RegisterSelectionCommandsParams): void {
  const targetDetails = (payload?: unknown) => {
    const id = commandObjectId(payload, params.selectionService.selectedSceneObjectId);
    return id ? params.selectionService.resolveSceneObject(id) : null;
  };
  params.commands.register({
    id: "selection.clear",
    title: "Clear Selection",
    category: "Edit: Selection",
    shortcut: "Escape",
    enabled: (context) => !!context.selectedObjectId,
    run: () => params.selectionService.clear()
  });
  params.commands.register({
    id: "selection.copyId",
    title: "Copy Selected Object ID",
    category: "Edit: Selection",
    shortcut: "Ctrl+Alt+I",
    enabled: (_context, payload) => !!targetDetails(payload),
    run: (payload) => {
      const details = targetDetails(payload);
      if (details?.sceneObjectId) {
        void copyText(details.sceneObjectId);
      }
    }
  });
  params.commands.register({
    id: "selection.copyDataObjectId",
    title: "Copy Selected Data Object ID",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId && !!params.workspace.selectedObjectDetails?.dataObjectId,
    run: () => {
      const details = params.workspace.selectedObjectDetails;
      if (details?.dataObjectId) {
        void copyText(details.dataObjectId);
      }
    }
  });
  params.commands.register({
    id: "selection.copyTitle",
    title: "Copy Selected Object Title",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId,
    run: () => {
      const details = params.workspace.selectedObjectDetails;
      if (details?.title) {
        void copyText(details.title);
      }
    }
  });
  params.commands.register({
    id: "selection.copyType",
    title: "Copy Selected Object Type",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId,
    run: () => {
      const details = params.workspace.selectedObjectDetails;
      if (details?.type) {
        void copyText(details.type);
      }
    }
  });
  params.commands.register({
    id: "selection.copyLinkedIdsJson",
    title: "Copy Selected Linked IDs as JSON",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId,
    run: () => {
      const details = params.workspace.selectedObjectDetails;
      if (details) {
        void copyText(JSON.stringify({
          sceneObjectId: details.sceneObjectId,
          sceneObjectName: details.sceneObjectName,
          dataObjectId: details.dataObjectId || null,
          title: details.title,
          type: details.type,
          schema: details.schema || null
        }, null, 2));
      }
    }
  });
  params.commands.register({
    id: "selection.copyDetailsJson",
    title: "Copy Selection Details as JSON",
    category: "Edit: Selection",
    shortcut: "Ctrl+Alt+J",
    enabled: (_context, payload) => !!targetDetails(payload),
    run: (payload) => {
      const details = targetDetails(payload);
      if (details) {
        void copyText(JSON.stringify(details, null, 2));
      }
    }
  });
  params.commands.register({
    id: "selection.copyAabbJson",
    title: "Copy Selected Bounds as JSON",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId && !!params.workspace.selectedObjectDetails?.aabb,
    run: () => {
      const aabb = params.workspace.selectedObjectDetails?.aabb;
      if (aabb) {
        void copyText(JSON.stringify({
          min: [aabb[0], aabb[1], aabb[2]],
          max: [aabb[3], aabb[4], aabb[5]]
        }, null, 2));
      }
    }
  });
  params.commands.register({
    id: "selection.copyPropertiesJson",
    title: "Copy Selected Properties as JSON",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId && (params.workspace.selectedObjectDetails?.propertyRows.length || 0) > 0,
    run: () => {
      const details = params.workspace.selectedObjectDetails;
      if (details) {
        void copyText(JSON.stringify(details.propertyRows, null, 2));
      }
    }
  });
  params.commands.register({
    id: "selection.inspect",
    title: "Inspect Selection",
    category: "Edit: Selection",
    enabled: (context) => !!context.selectedObjectId,
    run: () => {
      const details = params.workspace.selectedObjectDetails;
      if (details) {
        params.workspace.setInspectorContext({
          source: "scene",
          sceneObjectId: details.sceneObjectId,
          title: details.title || details.sceneObjectId,
          kind: details.type || "SceneObject",
          detail: `${details.meshCount} meshes${details.dataObjectId ? ` · DataObject ${details.dataObjectId}` : ""}`
        });
        params.openInspector?.();
      }
    }
  });
}
