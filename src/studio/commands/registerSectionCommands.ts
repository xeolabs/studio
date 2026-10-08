import type {CommandRegistry} from "./CommandRegistry";
import type {SectionViewService} from "../services/SectionViewService";
import type {SectionState} from "../state/sectionState";

export function registerSectionCommands(commands: CommandRegistry, service: SectionViewService, state: SectionState): void {
  const register = (id: string, title: string, run: (value?: unknown) => void, enabled?: () => boolean) =>
    commands.register({id: `section.${id}`, title, category: "View: Section", run, enabled});
  register("orientation", "Set section direction", value => service.setOrientation(value));
  register("axis", "Set vertical cut direction", value => service.setVerticalAxis(value));
  register("position", "Move section cut", value => service.setPosition(value));
  register("planHeight", "Set cut height above floor", value => service.setPlanCutHeight(value));
  register("labels", "Toggle plan labels", () => {state.labelsEnabled = !state.labelsEnabled;});
  register("labelDensity", "Set plan label density", value => {
    if (value === "off") {state.labelsEnabled = false; return;}
    if (value !== "sparse" && value !== "balanced" && value !== "dense") return;
    state.labelDensity = value;
    state.labelsEnabled = true;
  });
  register("style", "Toggle plan outlines", () => service.togglePlanStyle());
  register("flip", "Flip section cut", () => service.flip(), () => state.enabled);
  register("clear", "Clear section cut", () => service.clear(), () => state.enabled);
  register("refresh", "Refresh floors", () => service.refresh());
  register("floorPlan", "View floor plan", value => {
    if (typeof value !== "string") return;
    service.showFloorPlan(value);
    if (state.planFloorId) {
      // Opening the drawer and enabling full-resolution rendering both resize
      // the canvas. Fit to its settled bounds, not the previous layout.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (state.planFloorId === value) service.fitPlan();
      }));
    }
  });
  register("return3D", "Return to 3D", () => service.returnTo3D(), () => !!state.planFloorId);
}
