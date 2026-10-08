import type {CommandRegistry} from "./CommandRegistry";
import type {MeasurementService} from "../services/MeasurementService";

export function registerMeasurementCommands(commands: CommandRegistry, service: MeasurementService, workspace: any): void {
  const state = workspace.measurements;
  commands.register({id: "tools.measure", title: "Measure distance", category: "View: Tools",
    enabled: () => workspace.loadedModels.some((model: any) => model.objectCount),
    run: () => {workspace.toolMode = workspace.toolMode === "measure" ? "select" : "measure"; state.visible = true;}});
  commands.register({id: "measurement.cancel", title: "Cancel measurement point", category: "Measurements", run: () => service.cancel()});
  commands.register({id: "measurement.locate", title: "Locate measurement", category: "Measurements",
    enabled: () => !workspace.rendererSwitching,
    run: id => {if (typeof id === "string") {workspace.toolMode = "select"; service.locate(id);}}});
  commands.register({id: "measurement.remove", title: "Remove measurement", category: "Measurements", run: id => {if (typeof id === "string") service.remove(id);}});
  commands.register({id: "measurement.clear", title: "Clear measurements", category: "Measurements", run: () => service.clear()});
  commands.register({id: "measurement.undo", title: "Undo measurement deletion", category: "Measurements",
    enabled: () => !!state.undoLabel, run: () => service.undoRemoval()});
  commands.register({id: "measurement.units", title: "Measurement units", category: "Measurements", run: value => {
    if (["m", "mm", "ft", "in"].includes(value as string)) state.unit = value;
  }});
}
