import type {VirtualTreeRow} from "./virtualTreeRange";
import type {PagedTreeNode} from "./PagedTreeState";

export interface PagedTreeRow<N> extends VirtualTreeRow {
  node: N;
  kind: "node" | "page";
}

/** Flatten only materialized pages; never enumerate SDK collections here. */
export function pagedTreeRows<N extends PagedTreeNode<N>>(roots: readonly N[], pageSize: number): PagedTreeRow<N>[] {
  const rows: PagedTreeRow<N>[] = [];
  const seen = new Set<string>();
  const visit = (node: N, parentId?: string) => {
    if (seen.has(node.id) || node.depth > 48) return;
    seen.add(node.id);
    rows.push({id: node.id, kind: "node", node, parentId});
    if (!node.expanded) return;
    const paged = node.childCount > pageSize;
    if (paged) rows.push({id: `page:before:${node.id}`, kind: "page", node, navigable: false});
    for (const child of node.children) visit(child, node.id);
    if (paged) rows.push({id: `page:after:${node.id}`, kind: "page", node, navigable: false});
  };
  for (const root of roots) visit(root);
  return rows;
}
