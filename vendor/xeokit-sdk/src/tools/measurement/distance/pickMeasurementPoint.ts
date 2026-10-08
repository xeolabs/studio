import type {Vec2, Vec3} from "../../../base/math/vector";
import type {PickStrategy} from "../../../spatial/picking";
import type {View} from "../../../viewing/viewer";

export interface MeasurementPoint {
  worldPos: Vec3;
  canvasPos: Vec2;
  objectId: string;
  snap: "vertex" | "edge" | null;
}

/** A visible surface or snap point. A partial GPU snap result is never used as a surface anchor. */
export function pickMeasurementPoint(picker: PickStrategy, view: View, canvasPos: Vec2, snap = true): MeasurementPoint | null {
  const rect = view.htmlElement.getBoundingClientRect();
  if (canvasPos[0] < 0 || canvasPos[1] < 0 || canvasPos[0] >= rect.width || canvasPos[1] >= rect.height) return null;
  const pos: Vec2 = [Math.round(canvasPos[0]), Math.round(canvasPos[1])];
  const valid = (id: string | null, point: Vec3 | null) => {
    if (!id || !point || !Array.from(point).every(Number.isFinite)) return false;
    const object = view.objects[id];
    if (!object?.visible || object.pickable === false) return false;
    return object.clippable === false || Object.values(view.sectionPlanes).every(plane => !plane.active ||
      plane.dir[0] * point[0] + plane.dir[1] * point[1] + plane.dir[2] * point[2] + plane.dist <= 1e-7);
  };
  if (snap) {
    const result = picker.pick({view, canvasPos: pos, snapToVertex: true, snapToEdge: true, snapRadius: 12});
    if (result.snap && valid(result.objectId, result.snap.worldPos)) return {
      objectId: result.objectId!, worldPos: [...result.snap.worldPos] as Vec3,
      canvasPos: [...result.snap.canvasPos] as Vec2, snap: result.snap.type
    };
  }
  const result = picker.pick({view, canvasPos: pos});
  if (!result.hit || !valid(result.objectId, result.worldPos)) return null;
  return {objectId: result.objectId!, worldPos: [...result.worldPos!] as Vec3, canvasPos: pos, snap: null};
}
