import type {CommandRegistry} from "./CommandRegistry";
import type {LoadedModel, LoadedModelsService} from "../services/LoadedModelsService";

export function registerModelCommands(commands: CommandRegistry, models: LoadedModelsService,
  confirmUnload: (model: LoadedModel) => Promise<boolean>): void {
  let confirmingUnload = false;
  commands.register({id: "model.visibility", title: "Show or hide model", category: "Models",
    enabled: (_context, target) => models.objectIds(target).length > 0,
    run: target => models.toggleVisibility(target)});
  commands.register({id: "model.fit", title: "Fit model", category: "Models",
    enabled: (_context, target) => models.objectIds(target).length > 0,
    run: target => commands.execute("viewport.frameObjects", models.objectIds(target))});
  commands.register({
    id: "model.unload", title: "Unload model", category: "Models",
    enabled: (_context, target) => !confirmingUnload && models.canUnload(target),
    run: async target => {
      const model = models.find(target);
      if (confirmingUnload || !model || !models.canUnload(model.id)) return;
      confirmingUnload = true;
      try {
        // unload rechecks availability and busy state after the dialog closes.
        if (await confirmUnload(model)) models.unload(model.id);
      } finally {
        confirmingUnload = false;
      }
    }
  });
}
