import type {Scene} from "@xeokit/sdk/model/scene";
import type {Data} from "@xeokit/sdk/model/data";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {CommandRegistry} from "./CommandRegistry";
import type {ExplorerNavigationService} from "../services/ExplorerNavigationService";
import type {ImportDialogState} from "../services/importDialogState";

export function registerImportResultCommands(params: {
  commands: CommandRegistry; scene: Scene; data: Data; view: View; state: ImportDialogState;
  navigation: ExplorerNavigationService; openPanel(id: string): void;
}): void {
  const objects = () => Object.keys(params.scene.models[params.state.result?.modelId ?? ""]?.objects ?? {})
    .filter(id => !!params.view.objects[id]);
  params.commands.register({
    id: "file.import.frameResult", title: "Frame Imported Model", category: "File: Import", visible: () => false,
    enabled: () => objects().length > 0,
    run: () => { params.state.open = false; params.openPanel("viewer"); params.commands.execute("viewport.frameObjects", objects()); },
  });
  params.commands.register({
    id: "file.import.revealResult", title: "Reveal Imported Model", category: "File: Import", visible: () => false,
    enabled: () => !!params.scene.models[params.state.result?.modelId ?? ""] || !!params.data.models[params.state.result?.modelId ?? ""],
    run: () => {
      const id = params.state.result!.modelId;
      params.state.open = false;
      return params.navigation.revealModel(params.scene.models[id] ? "scene" : "data", id);
    },
  });
}
