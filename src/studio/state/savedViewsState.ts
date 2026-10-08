import type {SectionState} from "./sectionState";

export interface SavedCut {
  id: string; managed: boolean; pos: number[]; dir: number[]; active: boolean;
}
export type SavedSection = Pick<SectionState, "enabled" | "orientation" | "verticalAxis" | "position" | "flipped"
  | "planFloorId" | "planCutHeight" | "planStyle" | "labelsEnabled" | "labelDensity"> & {planes: SavedCut[]};
export interface SavedViewSnapshot {
  camera: {eye: number[]; look: number[]; up: number[]; projection: number; scale: number;
    fov: number; near: number; far: number; orthoNear: number; orthoFar: number; navMode: number};
  section: SavedSection;
  hidden: string[]; xrayed: string[]; highlighted: string[];
  isolation: {label: string; previous: Array<[string, boolean]> | null};
  appearance: {edges: {enabled: boolean; useMeshColor: boolean; edgeColor: number[]; edgeAlpha: number; edgeWidth: number};
    antiAliasing: boolean; resolutionScale: boolean};
}
export interface SavedView {
  id: string; name: string; thumbnail: string; createdAt: string; floorTitle: string; snapshot: SavedViewSnapshot;
}
export function createSavedViewsState() {
  return {open: false, busy: false, modelKey: "", items: [] as SavedView[], error: "", notice: "", undoName: ""};
}
export type SavedViewsState = ReturnType<typeof createSavedViewsState>;
