import type {CommandRegistry} from "./CommandRegistry";
import type {SavedViewsService} from "../services/SavedViewsService";
import type {SavedViewsState} from "../state/savedViewsState";

export function registerSavedViewsCommands(commands: CommandRegistry, service: SavedViewsService, state: SavedViewsState): void {
  commands.register({id: "views.open", title: "Saved views", category: "View", run: () => service.open()});
  commands.register({id: "views.save", title: "Save current view", category: "View", enabled: () => !state.busy && !!state.modelKey,
    run: name => typeof name === "string" ? service.save(name) : service.open()});
  commands.register({id: "views.restore", title: "Open saved view", category: "View", run: id => service.restore(id)});
  commands.register({id: "views.rename", title: "Rename saved view", category: "View", run: payload => {
    const {id, name} = (payload || {}) as {id?: string; name?: string}; service.rename(id, name);
  }});
  commands.register({id: "views.delete", title: "Delete saved view", category: "View", run: id => service.remove(id)});
  commands.register({id: "views.undoDelete", title: "Undo delete saved view", category: "View", enabled: () => !!state.undoName,
    run: () => service.undoDelete()});
}
