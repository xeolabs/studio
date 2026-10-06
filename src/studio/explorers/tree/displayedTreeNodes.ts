/** Visits materialized rows only where their ancestors are expanded. Does not load children. */
export function* displayedTreeNodes<T extends {expanded: boolean; children: T[]}>(roots: T[]): Generator<T> {
  const pending = [...roots].reverse();
  const seen = new Set<T>();
  while (pending.length) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    yield node;
    if (node.expanded) {
      for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
    }
  }
}
