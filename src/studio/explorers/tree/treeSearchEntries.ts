export interface TreeSearchEntry {
  id: string;
  title: string;
  type: string;
  kind: string;
  objectId?: string;
  path: string[];
  /** Human-readable owning model/view and hierarchy, separate from stable node IDs. */
  context?: string;
}

export interface SearchableTreeSpec {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  componentId?: string;
  modelId?: string;
  viewId?: string;
  typeName?: string;
}

/** Traverses lightweight descriptors only, never reactive nodes or the DOM. */
export function* treeSearchEntries<T extends SearchableTreeSpec>(
  roots: readonly T[], children: (node: T) => Iterable<T>, descend: (node: T) => boolean,
  describe: (node: T) => string = (node) => node.title
): Generator<TreeSearchEntry> {
  const seen = new Set<string>();
  const stack: Array<{nodes: Iterator<T>; ancestors: string[]; labels: string[]}> =
    [{nodes: roots[Symbol.iterator](), ancestors: [], labels: []}];
  while (stack.length) {
    const {nodes, ancestors, labels} = stack[stack.length - 1];
    const nextNode = nodes.next();
    if (nextNode.done) { stack.pop(); continue; }
    const node = nextNode.value;
    const identity = JSON.stringify([node.modelId, node.viewId, node.kind, node.componentId || node.id]);
    if (seen.has(identity) || ancestors.length > 48) continue;
    seen.add(identity);
    const path = [...ancestors, node.id];
    if (node.kind !== "folder" && node.kind !== "property") {
      yield {id: node.componentId || node.typeName || node.id, title: node.kind === "typeGroup" ? node.title : node.detail || node.title, type: describe(node), kind: node.kind,
        objectId: node.kind === "object" ? node.componentId : undefined, path, context: labels.join(" / ")};
    }
    if (descend(node)) {
      const nextLabels = [...labels, node.kind === "model" ? node.modelId || node.detail || node.title : node.kind === "view" ? node.viewId || node.title : node.title];
      stack.push({nodes: children(node)[Symbol.iterator](), ancestors: path, labels: nextLabels});
    }
  }
}
