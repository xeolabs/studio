import type {NavigableExplorerNode, NavigableExplorerStore} from "./types";

/** Applies remembered state once per node, deferring children of collapsed branches. */
export class ExplorerExpansionState {
  private readonly pending: Map<string, boolean>;
  private running = false;

  constructor(private readonly branches: Map<string, boolean>) {
    this.pending = new Map(branches);
  }

  async restore(store: NavigableExplorerStore, current: () => boolean): Promise<void> {
    if (this.running || !this.pending.size) return;
    this.running = true;
    const seen = new Set<string>();
    let expanded = 0;
    const visit = async (nodes: NavigableExplorerNode[], depth: number) => {
      if (depth > 48) return;
      for (const node of nodes) {
        if (!current() || expanded >= 1200) return;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        if (this.pending.has(node.id) && !node.loading) {
          const open = this.pending.get(node.id)!;
          this.pending.delete(node.id);
          if (node.hasChildren && node.expanded !== open) {
            expanded++;
            await store.toggleExpanded(node);
          }
        }
        if (node.expanded) await visit(node.children, depth + 1);
      }
    };
    try { await visit(store.state.roots, 0); } finally { this.running = false; }
  }

  capture(store: NavigableExplorerStore): void {
    const stack = [...store.state.roots];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      // Preserve deferred states if a panel closes before restoration finishes.
      if (!this.pending.has(node.id) && node.hasChildren) this.branches.set(node.id, node.expanded);
      stack.push(...node.children);
    }
  }
}
