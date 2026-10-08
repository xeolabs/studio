import type {View} from "@xeokit/sdk/viewing/viewer";
import {OrthoProjectionType} from "@xeokit/sdk/base/constants";
import type {CommandRegistry} from "./CommandRegistry";
import type {ViewHistoryService} from "../services/ViewHistoryService";
import {cancelStudioCameraFlights} from "../services/StudioCameraFlight";

export function registerViewerTools(commands: CommandRegistry, view: View, workspace: any, history: ViewHistoryService): void {
  const loaded = () => Object.keys(view.objects).length > 0;
  for (const mode of ["select", "hide", "xray"]) commands.register({
    id: `tools.${mode}`, title: `${mode === "xray" ? "X-ray" : mode[0].toUpperCase() + mode.slice(1)} mode`, category: "View: Tools",
    enabled: () => mode === "select" || loaded(), checked: () => workspace.toolMode === mode, run: () => {workspace.toolMode = mode;}
  });
  commands.register({id: "view.undo", title: "Undo view change", category: "Edit: View", shortcut: "Ctrl+Z",
    enabled: () => workspace.history.canUndo, run: () => history.undo()});
  commands.register({id: "view.redo", title: "Redo view change", category: "Edit: View", shortcut: "Ctrl+Shift+Z",
    enabled: () => workspace.history.canRedo, run: () => history.redo()});
  for (const [name, factor] of [["In", .8], ["Out", 1.25]] as const) commands.register({
    id: `camera.zoom${name}`, title: `Zoom ${name.toLowerCase()}`, category: "View: Camera", enabled: loaded,
    run: () => {
      cancelStudioCameraFlights(view);
      const camera = view.camera;
      if (camera.projectionType === OrthoProjectionType) camera.orthoProjection.scale *= factor;
      else camera.zoom(Math.hypot(...Array.from(camera.eye, (v, i) => v - camera.look[i])) * (factor - 1));
    }
  });
  for (const [name, x, y] of [["Left", -1, 0], ["Right", 1, 0], ["Up", 0, 1], ["Down", 0, -1]] as const) commands.register({
    id: `camera.pan${name}`, title: `Pan ${name.toLowerCase()}`, category: "View: Camera", enabled: loaded,
    run: () => {
      cancelStudioCameraFlights(view);
      const camera = view.camera;
      const scale = camera.projectionType === OrthoProjectionType ? camera.orthoProjection.scale : Math.hypot(...Array.from(camera.eye, (v, i) => v - camera.look[i]));
      camera.pan([x * scale * .1, y * scale * .1, 0]);
    }
  });
  commands.register({id: "camera.fullscreen", title: "Toggle full screen", category: "View: Camera",
    enabled: () => !!document.fullscreenEnabled,
    run: async () => {if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen();}
  });
}
