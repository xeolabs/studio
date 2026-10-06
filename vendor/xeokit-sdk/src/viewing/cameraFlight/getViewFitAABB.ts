import type {AABB3Float} from "../../base/math/boundaries";
import {getSceneCollisionIndex} from "../../spatial/collision";
import type {View} from "../viewer";

/**
 * Combined scene-space bounds of the View's collidable objects, or null if empty.
 *
 * Used by automatic camera fitting. Visibility and pickability do not affect
 * inclusion; set ViewObject.collidable to false to exclude background scenery.
 * This does not change the Scene's spatial index or other Views. An explicitly
 * supplied camera-flight AABB remains authoritative, including excluded objects.
 * Returns a fresh buffer; reads current flags and indexed geometry on each call.
 */
export function getViewFitAABB(view: View): AABB3Float | null {
  const ids: string[] = [];
  for (const id in view.objects) {
    const object = view.objects[id];
    if (object.collidable && !object.destroyed) ids.push(id);
  }
  return getSceneCollisionIndex(view.viewer.scene).getCombinedObjectAABB(ids);
}
