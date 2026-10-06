export interface VisibilitySummary {visibleCount: number; viewObjectCount: number;}

export function summarizeVisibility(ids: readonly string[], objects: Record<string, {visible: boolean}>): VisibilitySummary {
  let visibleCount = 0, viewObjectCount = 0;
  for (const id of ids) {
    const object = objects[id];
    if (object) { viewObjectCount++; if (object.visible) visibleCount++; }
  }
  return {visibleCount, viewObjectCount};
}

export function visibilityLabel(summary: Partial<VisibilitySummary>): string {
  const {visibleCount = 0, viewObjectCount = 0} = summary;
  if (!viewObjectCount) return "No ViewObjects in this View";
  return `${visibleCount} of ${viewObjectCount} visible. ${visibleCount ? 'Hide' : 'Show'} in View`;
}
