import {PagedTreeCollection, clampTreePage} from "./PagedTreeCollection";

export interface PagedTreeNode<T> {
  id: string;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  childrenLoaded: boolean;
  children: T[];
  childCount: number;
  pageIndex: number;
}

export interface TreeBranchState {expanded: boolean; pageIndex: number;}

/** Owns bounded row materialization and UI-only branch memory, independent of Vue and SDK domains. */
export class PagedTreeState<N extends PagedTreeNode<N>, S extends {id: string}> {
  readonly pageSize = 200;
  private readonly branches = new Map<string, TreeBranchState>();

  constructor(private readonly params: {
    roots(): N[];
    nodes: Map<string, N>;
    children(node: N): PagedTreeCollection<S> | readonly S[];
    create(spec: S, depth: number): N;
    touch(): void;
    hasControls?(node: N): boolean;
    sync?(node: N): void;
  }) {}

  load(node: N): void {
    const source = this.params.children(node);
    node.childCount = source.length;
    node.pageIndex = clampTreePage(node.pageIndex, source.length, this.pageSize);
    const specs = source instanceof PagedTreeCollection ? source.page(node.pageIndex, this.pageSize)
      : source.slice(node.pageIndex * this.pageSize, (node.pageIndex + 1) * this.pageSize);
    node.children = specs.map(spec => {
      const exists = this.params.nodes.has(spec.id);
      const child = this.params.create(spec, node.depth + 1);
      if (!exists) Object.assign(child, this.branches.get(spec.id));
      return child;
    });
    node.childrenLoaded = true;
    node.hasChildren = node.childCount > 0 || !!this.params.hasControls?.(node);
    if (node.depth < 48) for (const child of node.children) {
      if (child.expanded && !child.childrenLoaded) this.load(child);
    }
    this.params.touch();
  }

  setPage(node: N, index: number): void {
    if (!node.expanded) return;
    this.capture();
    node.pageIndex = clampTreePage(index, node.childCount, this.pageSize);
    this.load(node);
    this.prune();
  }

  revealChild(node: N, id: string): void {
    if (node.children.some(child => child.id === id)) return;
    const source = this.params.children(node);
    const page = source instanceof PagedTreeCollection ? source.pageOf(id, this.pageSize)
      : Math.floor(source.findIndex(spec => spec.id === id) / this.pageSize);
    if (page >= 0) this.setPage(node, page);
  }

  capture(): Map<string, TreeBranchState> {
    for (const node of this.params.nodes.values()) {
      if (node.expanded || node.pageIndex) this.branches.set(node.id, {expanded: node.expanded, pageIndex: node.pageIndex});
      else this.branches.delete(node.id);
    }
    return new Map(this.branches);
  }

  restore(states: ReadonlyMap<string, TreeBranchState>): void {
    this.branches.clear();
    for (const [id, state] of states) this.branches.set(id, {...state});
    for (const node of this.params.nodes.values()) Object.assign(node, states.get(node.id));
    this.refresh();
  }

  refresh(): void {
    const visited = new Set<string>();
    const visit = (node: N) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      if (node.childrenLoaded || node.expanded) this.load(node);
      this.params.sync?.(node);
      if (node.depth < 48) for (const child of node.children) visit(child);
    };
    for (const root of this.params.roots()) visit(root);
    this.prune();
    this.params.touch();
  }

  prune(): void {
    const reachable = new Set<string>();
    const visit = (node: N) => {
      if (reachable.has(node.id)) return;
      reachable.add(node.id);
      for (const child of node.children) visit(child);
    };
    for (const root of this.params.roots()) visit(root);
    for (const id of this.params.nodes.keys()) if (!reachable.has(id)) this.params.nodes.delete(id);
  }

  dispose(): void { this.branches.clear(); }
}
