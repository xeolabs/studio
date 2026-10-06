export interface RevealTreeNode {
  id: string;
  expanded: boolean;
  loading: boolean;
  children: RevealTreeNode[];
}

/** Only ancestors of the destination are opened; no recursive expand-all operation. */
export async function revealTreePath<T extends RevealTreeNode>(store: {
  state: {roots: T[]}; toggleExpanded(node: T): Promise<void>;
  revealChild?(node: T, childId: string): void | Promise<void>;
}, path: readonly string[], isCurrent: () => boolean = () => true): Promise<T | null> {
  if (!path.length || path.length > 49 || new Set(path).size !== path.length) return null;
  let nodes: RevealTreeNode[] = store.state.roots;
  let node: T | undefined;
  for (let index = 0; index < path.length; index++) {
    if (!isCurrent()) return null;
    node = nodes.find((candidate) => candidate.id === path[index]) as T | undefined;
    if (!node) return null;
    while (node.loading) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!isCurrent()) return null;
    }
    if (index < path.length - 1) {
      if (!node.expanded) await store.toggleExpanded(node);
      if (!isCurrent()) return null;
      await store.revealChild?.(node, path[index + 1]);
      nodes = node.children;
    }
  }
  return isCurrent() ? node || null : null;
}
