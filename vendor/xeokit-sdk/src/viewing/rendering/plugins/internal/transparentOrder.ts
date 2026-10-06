/** Renderer-owned approximate ordering; equal depths have stable content keys. @internal */
export function sortTransparent<T extends {depth: number; key: string}>(items: T[]): T[] {
  return items.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
}

/** Bounds-centre depth in eye space, evaluated in double precision. @internal */
export function boundsViewDepth(bounds: ArrayLike<number>, view: ArrayLike<number>, world?: ArrayLike<number>): number {
  const local = [0, 1, 2].map(i => (bounds[i] + bounds[i + 3]) * 0.5);
  const p = world ? [0, 1, 2].map(i => world[i] * local[0] + world[i + 4] * local[1] + world[i + 8] * local[2] + world[i + 12]) : local;
  return view[2] * p[0] + view[6] * p[1] + view[10] * p[2] + view[14];
}
