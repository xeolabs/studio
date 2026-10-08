import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {Viewer, View} from "@xeokit/sdk/viewing/viewer";
import {DataObjectTreeStore} from "./DataObjectTreeStore";
import {createDataObjectTreeNodeComponent} from "./DataObjectTreeNode";
import {loadVue} from "../../ui/loadVue";
import {loadExplorerIcons} from "../tree/loadExplorerIcons";
import {createPagedTree, type PagedTreeHandle} from "../tree/PagedTree";

export interface IFCTreeViewParams {
  container: HTMLElement;
  data: Data;
  scene: Scene;
  viewer: Viewer;
  view?: View;
  initialExpandDepth?: number;
  vue?: any;
  commands?: {execute(id: string, payload?: unknown): void};
}

export class IFCTreeView {
  readonly store: DataObjectTreeStore;
  private _app: any = null;
  private _tree: PagedTreeHandle | null = null;

  private constructor(params: IFCTreeViewParams, Vue: any) {
    this.store = new DataObjectTreeStore({
      ...params,
      makeReactive: Vue.reactive
    });
  }

  static async create(params: IFCTreeViewParams): Promise<IFCTreeView> {
    const Vue = params.vue || await loadVue();
    const treeView = new IFCTreeView(params, Vue);
    await treeView._mount(params.container, Vue, params.commands);
    await treeView.store.expandToDepth(params.initialExpandDepth ?? 3);
    return treeView;
  }

  destroy(): void {
    this._app?.unmount();
    this._app = null;
    this._tree = null;
    this.store.destroy();
  }

  async revealNode(id: string): Promise<void> { await this._tree?.reveal(id); }

  private async _mount(container: HTMLElement, Vue: any, commands?: {execute(id: string, payload?: unknown): void}): Promise<void> {
    const icons = await loadExplorerIcons();
    const DataObjectTreeNode = createDataObjectTreeNodeComponent(icons.SlidersHorizontal);
    const PagedTree = createPagedTree(Vue, DataObjectTreeNode, icons);
    const view = this;
    const store = this.store;
    this._app = Vue.createApp({
      name: "IFCTreeView",
      components: {PagedTree},
      setup() {
        return {
          state: store.state,
          store,
          bindTree: (tree: PagedTreeHandle | null) => { view._tree = tree; }
        };
      },
      template: `
        <section class="xeokit-data-tree" :class="{ 'is-busy': state.busy }">
          <header class="xeokit-data-tree-header">
            <div>
              <h1>Building</h1>
              <p>{{ state.roots.length }} root object{{ state.roots.length === 1 ? '' : 's' }}</p>
            </div>
          </header>
          <PagedTree class="xeokit-data-tree-roots" :store="store" :ref="bindTree"/>
        </section>
      `
    });
    this._app.provide("commands", commands || null);
    this._app.mount(container);
  }
}
