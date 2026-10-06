import {createVirtualTreeViewport} from "./VirtualTreeViewport";
import {createExplorerPagination} from "./ExplorerPagination";
import {pagedTreeRows} from "./pagedTreeRows";
import type {PagedTreeNode} from "./PagedTreeState";
import type {ExplorerIcons} from "./loadExplorerIcons";

export interface PagedTreeHandle {reveal(id: string): Promise<void>;}

/** Shared presentation for bounded lazy trees. Domain-specific rows retain their controls and icons. */
export function createPagedTree(Vue: any, TreeNode: unknown, icons: ExplorerIcons) {
  return {
    name: "PagedTree",
    components: {TreeNode, VirtualTreeViewport: createVirtualTreeViewport(Vue), ExplorerPagination: createExplorerPagination(icons)},
    props: {store: {type: Object, required: true}},
    setup(props: {store: {state: {roots: PagedTreeNode<any>[]}; pageSize: number; setPage(node: PagedTreeNode<any>, page: number): void}},
      {expose}: {expose(api: PagedTreeHandle): void}) {
      const viewport = Vue.shallowRef(null);
      const reveal = async (id: string) => { await Vue.nextTick(); await viewport.value?.reveal(id); };
      expose({reveal});
      return {viewport, rows: Vue.computed(() => pagedTreeRows(props.store.state.roots, props.store.pageSize)),
        setPage: async (node: PagedTreeNode<any>, page: number) => {
          props.store.setPage(node, page);
          await reveal(`page:before:${node.id}`);
        }};
    },
    template: `
      <VirtualTreeViewport :rows="rows" ref="viewport" v-slot="{row}">
        <TreeNode v-if="row.kind === 'node'" :node="row.node" :store="store" :flat="true"/>
        <ExplorerPagination v-else :page="row.node.pageIndex" :count="row.node.childCount" :size="store.pageSize" @change="setPage(row.node, $event)"/>
      </VirtualTreeViewport>`
  };
}
