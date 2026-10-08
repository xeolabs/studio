export interface PlanLabel {
  id: string; text: string; title: string; x: number; y: number; width: number; selected: boolean;
}
export interface ProjectedPlanLabel extends PlanLabel {priority: number; size: number;}

export type PlanLabelDensity = "sparse" | "balanced" | "dense";
const labelSpacing: Record<PlanLabelDensity, number> = {sparse: 64, balanced: 32, dense: 12};
type LabelBox = [number, number, number, number];
const overlaps = (box: LabelBox, other: LabelBox, gap: number) =>
  box[0] < other[2] + gap && box[2] > other[0] - gap && box[1] < other[3] + gap && box[3] > other[1] - gap;

/** Density controls breathing room, without a fixed count limit. Controls retain their own clearance. */
export function layoutPlanLabels(candidates: ProjectedPlanLabel[], width: number, height: number, previous: Set<string> = new Set(), obstacles: LabelBox[] = [], density: PlanLabelDensity = "sparse"): PlanLabel[] {
  const result: PlanLabel[] = [], boxes: LabelBox[] = [];
  const gap = labelSpacing[density];
  const score = (label: ProjectedPlanLabel) => (label.selected ? 1000 : label.priority) + (previous.has(label.id) ? 5 : 0);
  candidates.sort((a, b) => score(b) - score(a) || b.size - a.size || a.id.localeCompare(b.id));
  for (const candidate of candidates) {
    if (![candidate.x, candidate.y, candidate.width].every(Number.isFinite)) continue;
    if (!candidate.selected && candidate.size < 12) continue;
    const left = candidate.x - candidate.width / 2, top = candidate.y - 32;
    const box: [number, number, number, number] = [left, top, left + candidate.width, candidate.y + 3];
    if (left < 8 || top < 8 || box[2] > width - 8 || box[3] > height - 8) continue;
    if (obstacles.some(b => overlaps(box, b, 14)) || boxes.some(b => overlaps(box, b, gap))) continue;
    boxes.push(box);
    result.push({id: candidate.id, text: candidate.text, title: candidate.title,
      x: left, y: top, width: candidate.width, selected: candidate.selected});
  }
  return result;
}

export function planObjectLabel(type: string, name: string): string {
  if (type === "IfcSpace") return name || "Room";
  if (/^Ifc(FurnishingElement|Furniture)$/.test(type)) {
    // Exporter instance suffixes add noise to small plan labels.
    return (name.split(":")[0].replace(/^[A-Z]_/, "").replace(/[-_]/g, " ").trim() || "Furniture");
  }
  return type.replace(/^Ifc/, "").replace(/StandardCase$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || name || "Element";
}
