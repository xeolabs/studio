/** Accepts a flat 16-element matrix in the explorer's clipboard/input syntax. */
export function parseMatrixValue(value: string | ArrayLike<number>): number[] | null {
  const values = typeof value === "string"
    ? value.replace(/[\[\]]/g, " ").split(/[\s,;]+/).filter(Boolean).map(Number)
    : Array.from(value).map(Number);
  return values.length === 16 && values.every(Number.isFinite) ? values : null;
}
