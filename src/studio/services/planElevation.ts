import {projectedRange, validBounds, type Bounds} from "./sectionGeometry";

export interface PlanElement {type: string; bounds: Bounds | null | undefined;}

/** Infer the walking surface from floor slabs, then wall bases. Bounds from
 * stairs, beams and railings must not shift the cut into another level. All
 * input bounds are in the same world space as the camera and section plane. */
export function estimateFloorElevation(elements: PlanElement[], up: Bounds): number | null {
  const slabs: number[] = [], walls: number[] = [], bases: number[] = [];
  for (const element of elements) {
    if (!validBounds(element.bounds)) continue;
    const [bottom, top] = projectedRange(element.bounds, up);
    bases.push(bottom);
    if (element.type === "IfcSlab") slabs.push(top);
    else if (element.type === "IfcWall" || element.type === "IfcWallStandardCase") walls.push(bottom);
  }
  const candidates = slabs.length ? slabs : walls.length ? walls : bases;
  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  const middle = Math.floor(candidates.length / 2);
  return candidates.length % 2 ? candidates[middle] : (candidates[middle - 1] + candidates[middle]) / 2;
}

export function sceneMetersPerUnit(coordinateSystem: {scaleToMeters?: number; units: string}): number {
  const scale = coordinateSystem.scaleToMeters;
  if (scale != null && Number.isFinite(scale) && scale > 0) return scale;
  return ({meters: 1, millimeters: .001, feet: .3048, inches: .0254} as Record<string, number>)[coordinateSystem.units] || 1;
}
