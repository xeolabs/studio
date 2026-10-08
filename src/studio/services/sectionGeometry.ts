export type Bounds = ArrayLike<number>;
export function validBounds(bounds: Bounds | null | undefined): bounds is Bounds {
  return !!bounds && bounds.length === 6 && Array.from(bounds).every(Number.isFinite)
    && [0, 1, 2].every(i => bounds[i] <= bounds[i + 3]);
}
export function unionBounds(bounds: Array<Bounds | null | undefined>): number[] | null {
  const result = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const box of bounds) if (validBounds(box)) for (let i = 0; i < 3; i++) {
    result[i] = Math.min(result[i], box[i]); result[i + 3] = Math.max(result[i + 3], box[i + 3]);
  }
  return validBounds(result) ? result : null;
}
export function projectedRange(bounds: Bounds, direction: Bounds): [number, number] {
  let min = 0, max = 0;
  for (let i = 0; i < 3; i++) {
    min += Math.min(bounds[i] * direction[i], bounds[i + 3] * direction[i]);
    max += Math.max(bounds[i] * direction[i], bounds[i + 3] * direction[i]);
  }
  return [min, max];
}
export function planScale(bounds: Bounds, right: Bounds, up: Bounds, width: number, height: number): number {
  const x = projectedRange(bounds, right), y = projectedRange(bounds, up);
  const aspect = width > 0 && height > 0 ? width / height : 1;
  // SDK ortho scale describes the larger canvas dimension.
  return Math.max(.01, x[1] - x[0], (x[1] - x[0]) / aspect,
    y[1] - y[0], (y[1] - y[0]) * aspect) * 1.12;
}
