import type {Scene} from "@xeokit/sdk/model/scene";
import {getSceneCollisionIndex} from "@xeokit/sdk/spatial/collision";
import {StudioCameraFlight as CameraFlightAnimation} from "./StudioCameraFlight";
import type {View} from "@xeokit/sdk/viewing/viewer";

/** Camera operations are independent of which explorer panels happen to be mounted. */
export class ViewportCameraService {
  private readonly flight: CameraFlightAnimation;
  private readonly home: {eye: Float64Array; look: Float64Array; up: Float64Array};

  constructor(private readonly scene: Scene, view: View) {
    this.flight = new CameraFlightAnimation(view, {duration: 0.45});
    this.home = {eye: new Float64Array(view.camera.eye), look: new Float64Array(view.camera.look), up: new Float64Array(view.camera.up)};
  }

  fit(objectId?: string): void {
    const index = getSceneCollisionIndex(this.scene);
    const aabb = objectId ? index.getObjectAABB(objectId) : index.getSceneAABB();
    if (aabb && Array.from(aabb).every(Number.isFinite)) {
      this.flight.flyTo({aabb, fitFOV: 45, duration: 0.45, arc: true});
    }
  }

  homeView(): void {
    this.flight.flyTo({...this.home, duration: 0.45});
  }

  fitObjects(objectIds: string[]): void {
    const index = getSceneCollisionIndex(this.scene);
    const bounds = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (const id of objectIds) {
      const aabb = index.getObjectAABB(id);
      if (!aabb) continue;
      for (let axis = 0; axis < 3; axis++) {
        bounds[axis] = Math.min(bounds[axis], aabb[axis]);
        bounds[axis + 3] = Math.max(bounds[axis + 3], aabb[axis + 3]);
      }
    }
    if (bounds.every(Number.isFinite)) this.flight.flyTo({aabb: bounds, fitFOV: 45, duration: 0.45, arc: true});
  }

  destroy(): void {
    this.flight.destroy();
  }
}
