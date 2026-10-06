import type {AabbPanelState, AabbService} from "../services/AabbService";
import type {TilesPanelState, TilesService} from "../services/TilesService";

/** UI visibility is sampled at the composition boundary; services remain Vue-independent. */
export function connectDiagnosticPanelActivity(
  Vue: any,
  boundaries: {state: AabbPanelState; service: AabbService},
  tiles: {state: TilesPanelState; service: TilesService}
): () => void {
  const stops = [boundaries, tiles].map(({state, service}) => Vue.watch(
    () => state.active, (active: boolean) => service.setActive(active), {immediate: true, flush: "sync"}
  ));
  return () => stops.forEach(stop => stop());
}
