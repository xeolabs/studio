import type {Vec3} from "@xeokit/sdk/base/math/vector";
import type {MeasurementUnit} from "../state/measurementState";

/** Give short/zero-length distances enough surrounding context to frame safely. */
export function measurementBounds(origin: ArrayLike<number>, target: ArrayLike<number>, metersPerUnit: number): number[] {
  const length = Math.hypot(...[0, 1, 2].map(i => target[i] - origin[i]));
  const padding = Math.max(length * .2, .25 / metersPerUnit);
  return [...[0, 1, 2].map(i => Math.min(origin[i], target[i]) - padding),
    ...[0, 1, 2].map(i => Math.max(origin[i], target[i]) + padding)];
}

export function planMeasurementTarget(origin: Vec3, target: Vec3, up: ArrayLike<number>): Vec3 {
  const norm = up[0] ** 2 + up[1] ** 2 + up[2] ** 2;
  const height = ((target[0] - origin[0]) * up[0] + (target[1] - origin[1]) * up[1] + (target[2] - origin[2]) * up[2]) / norm;
  return [target[0] - height * up[0], target[1] - height * up[1], target[2] - height * up[2]];
}

const toMeters = {meters: 1, millimeters: .001, feet: .3048, inches: .0254};
const displayScale = {m: 1, mm: .001, ft: .3048, in: .0254};
export function formatMeasurementLength(length: number, coordinates: {units: keyof typeof toMeters; scaleToMeters?: number}, unit: MeasurementUnit): string {
  const value = length * (coordinates.scaleToMeters ?? toMeters[coordinates.units]) / displayScale[unit];
  return `${value.toLocaleString(undefined, {minimumFractionDigits: unit === "mm" ? 0 : 2, maximumFractionDigits: unit === "mm" ? 1 : 3})} ${unit}`;
}
