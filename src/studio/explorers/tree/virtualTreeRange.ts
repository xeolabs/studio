export interface VirtualTreeRow {
  id: string;
  parentId?: string;
  /** Pager/tool rows occupy space but do not participate in tree-key navigation. */
  navigable?: boolean;
}

/** Prefix offsets support measured, variable-height rows without walking the SDK hierarchy on scroll. */
export function treeRowOffsets(rows: readonly VirtualTreeRow[], heights: ReadonlyMap<string, number>, estimate: number): number[] {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1] + (heights.get(row.id) || estimate));
  return offsets;
}

export function virtualTreeRange(offsets: readonly number[], top: number, height: number, overscan = 6) {
  const count = offsets.length - 1;
  const at = (offset: number) => {
    let low = 0, high = count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle + 1] <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = Math.max(0, at(Math.max(0, top)) - overscan);
  const end = Math.min(count, at(Math.max(0, top) + height) + overscan + 1);
  return {start, end, before: offsets[start], after: offsets[count] - offsets[end]};
}
