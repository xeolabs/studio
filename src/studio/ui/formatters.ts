export function countRecord(value: unknown): number {
  if (!value) {
    return 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
}
