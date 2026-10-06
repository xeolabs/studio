import type {StudioActions} from "../app/types";
import type {RendererMode} from "../services/RendererService";
import type {CommandRegistry} from "./CommandRegistry";
import {copyText} from "../ui/clipboard";

export interface RegisterRendererCommandsParams {
  commands: CommandRegistry;
  actions: Pick<StudioActions, "rendererActions">;
  workspace: any;
}

export function registerRendererCommands(params: RegisterRendererCommandsParams): void {
  registerRendererCommand(params, "webgl", "Use WebGL Renderer");
  registerRendererCommand(params, "webgpu", "Use WebGPU Renderer");
  params.commands.register({
    id: "renderer.toggle",
    title: "Toggle Renderer Backend",
    category: "View: Renderer",
    shortcut: "Ctrl+Alt+`",
    enabled: () => !params.workspace.rendererSwitching,
    run: () => params.actions.rendererActions.switchTo(params.workspace.rendererMode === "webgl" ? "webgpu" : "webgl")
  });
  params.commands.register({
    id: "renderer.copyStatusJson",
    title: "Copy Renderer Status as JSON",
    category: "View: Renderer",
    run: () => {
      void copyText(JSON.stringify({
        mode: params.workspace.rendererMode,
        switching: params.workspace.rendererSwitching,
        error: params.workspace.rendererError || null
      }, null, 2));
    }
  });
}

function registerRendererCommand(params: RegisterRendererCommandsParams, mode: RendererMode, title: string): void {
  params.commands.register({
    id: `renderer.${mode}`,
    title,
    category: "View: Renderer",
    enabled: () => !params.workspace.rendererSwitching && params.workspace.rendererMode !== mode,
    checked: () => params.workspace.rendererMode === mode,
    run: () => params.actions.rendererActions.switchTo(mode)
  });
}
