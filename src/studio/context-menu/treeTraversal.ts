interface TreeTraversalGuard {
  readonly visitedNodes: WeakSet<object>;
  readonly visitedKeys: Set<string>;
  depth: number;
  count: number;
}

const MAX_CONTEXT_MENU_TREE_RECURSION_DEPTH = 48;
const MAX_CONTEXT_MENU_TREE_RECURSION_NODES = 1200;

export async function expandNode(store: any, node: any): Promise<void> {
  if (!node.expanded) {
    await store.toggleExpanded(node);
  }
}

export function collapseNode(node: any, store: any): void {
  if (node.expanded) {
    void store.toggleExpanded(node);
  }
}

export async function expandMaterialized(store: any, node: any): Promise<void> {
  await expandMaterializedSafe(store, node, createTreeTraversalGuard());
}

async function expandMaterializedSafe(store: any, node: any, guard: TreeTraversalGuard): Promise<void> {
  if (!enterTreeNode(node, guard)) {
    return;
  }
  await expandNode(store, node);
  for (const child of node.children || []) {
    if (child.hasChildren) {
      await expandMaterializedSafe(store, child, guard);
    }
  }
  guard.depth--;
}

export function collapseMaterialized(node: any, store: any): void {
  collapseMaterializedSafe(node, store, createTreeTraversalGuard());
}

function collapseMaterializedSafe(node: any, store: any, guard: TreeTraversalGuard): void {
  if (!enterTreeNode(node, guard)) {
    return;
  }
  for (const child of node.children || []) {
    collapseMaterializedSafe(child, store, guard);
  }
  collapseNode(node, store);
  guard.depth--;
}

function createTreeTraversalGuard(): TreeTraversalGuard {
  return {
    visitedNodes: new WeakSet<object>(),
    visitedKeys: new Set<string>(),
    depth: 0,
    count: 0
  };
}

function enterTreeNode(node: any, guard: TreeTraversalGuard): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (guard.depth >= MAX_CONTEXT_MENU_TREE_RECURSION_DEPTH || guard.count >= MAX_CONTEXT_MENU_TREE_RECURSION_NODES) {
    return false;
  }
  if (guard.visitedNodes.has(node)) {
    return false;
  }
  const key = treeNodeTraversalKey(node);
  if (key && guard.visitedKeys.has(key)) {
    return false;
  }
  guard.visitedNodes.add(node);
  if (key) {
    guard.visitedKeys.add(key);
  }
  guard.depth++;
  guard.count++;
  return true;
}

function treeNodeTraversalKey(node: any): string {
  const parts = [
    node.kind,
    node.modelId,
    node.viewId,
    node.folderKind,
    node.resourceKind,
    node.attributeRole,
    node.typeName,
    node.relationshipIndex,
    node.relationshipSide,
    node.canonicalNodeId,
    node.objectId,
    node.componentId,
    node.id
  ].filter((part) => part !== undefined && part !== null && part !== "");
  return parts.length > 0 ? parts.join("|") : "";
}
