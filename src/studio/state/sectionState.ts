import type {PlanLabel, PlanLabelDensity} from "../services/planLabels";

export interface FloorOption {id: string; title: string; elevation: number;}
export function createSectionState() {
  return {
    enabled: false, orientation: "horizontal" as "horizontal" | "vertical",
    verticalAxis: "front" as "front" | "side", position: 50, flipped: false,
    planCutHeight: 1.2, labelsEnabled: false, planStyle: true, planLabels: [] as PlanLabel[],
    labelDensity: "sparse" as PlanLabelDensity,
    planLabelViewport: {left: 0, top: 0, width: 0, height: 0},
    planFloorId: "", planFloorTitle: "", floors: [] as FloorOption[], error: ""
  };
}
export type SectionState = ReturnType<typeof createSectionState>;
