const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
/** Human-facing order for labels and source IDs, never for geometric/topological ordering. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);
