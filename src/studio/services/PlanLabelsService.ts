import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import {getSceneCollisionIndex} from "@xeokit/sdk/spatial/collision";
import {unionBounds, projectedRange, validBounds, type Bounds} from "./sectionGeometry";
import {layoutPlanLabels, planObjectLabel, type ProjectedPlanLabel} from "./planLabels";
import type {SectionViewService} from "./SectionViewService";
import type {SectionState} from "../state/sectionState";
import type {SelectionService} from "./SelectionService";

export class PlanLabelsService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private previous = new Set<string>();
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly params: {data: Data; scene: Scene; view: View; state: SectionState;
    section: SectionViewService; selection: SelectionService}) {
    if (typeof window !== "undefined") {
      const changed = () => this.schedule();
      window.addEventListener("studio-overlay-change", changed);
      this.unsubscribers.push(() => window.removeEventListener("studio-overlay-change", changed));
    }
    const events = params.view.viewer.events;
    for (const event of [events.onCameraViewMatrixUpdated, events.onCameraProjMatrixUpdated,
      events.onViewObjectVisibleChanged, events.onSectionPlanePosChanged, events.onSectionPlaneDirChanged,
      events.onSectionPlaneActive]) this.unsubscribers.push(event.subscribe(() => this.schedule()));
    this.unsubscribers.push(params.view.onBoundary.subscribe(() => this.schedule()));
    this.unsubscribers.push(params.selection.onChanged(() => this.schedule()));
  }

  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.params.state.planLabels = [];
    this.timer = null;
    if (!this.params.state.labelsEnabled || !this.params.state.planFloorId) return;
    // Hide while navigating, then place once settled. No label churn each frame.
    this.timer = setTimeout(() => {this.timer = null; this.update();}, 120);
  }

  private update(): void {
    const {data, scene, view, state, section, selection} = this.params;
    if (!state.labelsEnabled || !state.planFloorId) return;
    const canvas = view.htmlElement, rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    state.planLabelViewport = {left: rect.left, top: rect.top, width, height};
    const index = getSceneCollisionIndex(scene), camera = view.camera;
    const project = (point: number[]) => {
      const multiply = (matrix: Bounds, vector: number[]) => [0,1,2,3].map(row =>
        matrix[row] * vector[0] + matrix[row+4] * vector[1] + matrix[row+8] * vector[2] + matrix[row+12] * vector[3]);
      const clip = multiply(camera.projMatrix, multiply(camera.viewMatrix, [...point, 1]));
      if (clip[3] <= 0 || clip[2] < -clip[3] || clip[2] > clip[3]) return null;
      return [(clip[0] / clip[3] + 1) * width / 2, (1 - clip[1] / clip[3]) * height / 2];
    };
    const ids = new Set(section.getPlanObjectIds());
    const candidates: ProjectedPlanLabel[] = [];
    const add = (id: string, bounds: Bounds, priority: number, selected: boolean) => {
      if (!validBounds(bounds)) return;
      const center = [0,1,2].map(i => (bounds[i] + bounds[i+3]) / 2);
      for (const plane of Object.values(view.sectionPlanes)) if (plane.active) {
        const range = projectedRange(bounds, plane.dir);
        if (range[0] + plane.dist > 0) return;
      }
      const pos = project(center);
      if (!pos) return;
      const object = data.objects[id], title = object?.name || object?.type || id;
      const text = planObjectLabel(object?.type || "", title);
      const x = projectedRange(bounds, scene.coordinateSystem.worldRight), y = projectedRange(bounds, scene.coordinateSystem.worldForward);
      const size = Math.max(x[1] - x[0], y[1] - y[0]) * Math.max(width, height) / camera.orthoProjection.scale;
      candidates.push({id, title, text, x: pos[0], y: pos[1], width: Math.min(146, Math.max(52, text.length * 7.5 + 20)), priority, size, selected});
    };
    for (const id of ids) {
      if (!view.objects[id]?.visible) continue;
      const selected = selection.selectedSceneObjectId === id, type = data.objects[id]?.type || "";
      const priority = type === "IfcSpace" ? 90 : /^Ifc(Furniture|FurnishingElement)$/.test(type) ? 50 :
        /^IfcStair/.test(type) ? 60 : type === "IfcDoor" ? 25 : type === "IfcWindow" ? 10 : 0;
      if (!priority && !selected) continue;
      const bounds = index.getObjectAABB(id);
      if (bounds) add(id, bounds, priority, selected);
    }
    // Room nodes without their own geometry can be located from their contained
    // elements. Rooms without any located contents are deliberately left unlabeled.
    for (const id of section.getPlanSpaceIds()) {
      if (ids.has(id)) continue;
      const pending = [id], visited = new Set<string>(), contents: string[] = [];
      while (pending.length) {
        const child = pending.pop()!;
        if (visited.has(child)) continue;
        visited.add(child);
        if (ids.has(child) && view.objects[child]?.visible) contents.push(child);
        for (const [type, relations] of Object.entries(data.objects[child]?.related || {})) {
          if (!["IfcRelAggregates", "IfcRelContainedInSpatialStructure", "IfcRelNests"].includes(type)) continue;
          for (const relation of relations) if (relation.relatedObject.type !== "IfcBuildingStorey") pending.push(relation.relatedObject.id);
        }
      }
      const bounds = unionBounds(contents.map(child => index.getObjectAABB(child)));
      if (bounds) add(id, bounds, 90, false);
    }
    const obstacles = Array.from(document.querySelectorAll<HTMLElement>("[data-plan-label-obstacle]")).flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.width && box.height ? [[box.left - rect.left, box.top - rect.top, box.right - rect.left, box.bottom - rect.top] as [number, number, number, number]] : [];
    });
    state.planLabels = layoutPlanLabels(candidates, width, height, this.previous, obstacles, state.labelDensity);
    this.previous = new Set(state.planLabels.map(label => label.id));
  }

  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.params.state.planLabels = [];
  }
}
