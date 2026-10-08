import {CameraFlightAnimation} from "@xeokit/sdk/viewing/cameraFlight";
import type {View} from "@xeokit/sdk/viewing/viewer";

const flights = new WeakMap<View, Set<StudioCameraFlight>>();

/** Section/plan transitions must cancel flights started by any explorer. */
export class StudioCameraFlight extends CameraFlightAnimation {
  constructor(view: View, params: ConstructorParameters<typeof CameraFlightAnimation>[1]) {
    super(view, params);
    let set = flights.get(view);
    if (!set) { set = new Set(); flights.set(view, set); }
    set.add(this);
  }
  override destroy(): void {
    flights.get(this.view)?.delete(this);
    super.destroy();
  }
}

export function cancelStudioCameraFlights(view: View): void {
  for (const flight of flights.get(view) || []) flight.cancel();
}
