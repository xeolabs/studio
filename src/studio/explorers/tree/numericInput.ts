/** Incomplete edits are not runtime values. In particular, an empty field is not zero. */
export function parseNumericInput(value: string | number, min?: number, max?: number): number | null {
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && (min === undefined || number >= min) && (max === undefined || number <= max) ? number : null;
}

export function parseVectorInput(text: string, size: number, min?: number, max?: number): number[] | null {
  const parts = text.trim().replace(/^\[/, "").replace(/\]$/, "").trim().split(/[\s,;]+/);
  if (parts.length !== size) return null;
  const values = parts.map(part => parseNumericInput(part, min, max));
  return values.every(value => value !== null) ? values as number[] : null;
}
