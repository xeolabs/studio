/** Finds one hierarchy path without materializing UI nodes; relationships may contain cycles. */
export function findObjectPath(roots: readonly string[], children: (id: string) => readonly string[], target: string): string[] | null {
  const parents = new Map<string, string | null>(roots.map((id) => [id, null]));
  const queue = roots.map((id) => ({id, depth: 0}));
  for (let index = 0; index < queue.length; index++) {
    const {id, depth} = queue[index];
    if (id === target) {
      const path: string[] = [];
      for (let cursor: string | null = id; cursor !== null; cursor = parents.get(cursor) ?? null) path.push(cursor);
      return path.reverse();
    }
    if (depth >= 48) continue;
    for (const child of children(id)) {
      if (parents.has(child)) continue;
      parents.set(child, id);
      queue.push({id: child, depth: depth + 1});
    }
  }
  return null;
}
