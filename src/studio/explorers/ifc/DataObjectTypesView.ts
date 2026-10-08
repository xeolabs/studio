import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {Viewer, View} from "@xeokit/sdk/viewing/viewer";
import {createDataObjectTreeNodeComponent} from "./DataObjectTreeNode";
import {DataObjectTypesStore} from "./DataObjectTypesStore";
import {loadVue} from "../../ui/loadVue";
import {loadExplorerIcons} from "../tree/loadExplorerIcons";
import {createPagedTree, type PagedTreeHandle} from "../tree/PagedTree";

export interface IFCTypesViewParams {
  container: HTMLElement;
  data: Data;
  scene: Scene;
  viewer: Viewer;
  view?: View;
  vue?: any;
  commands?: {execute(id: string, payload?: unknown): void};
}

export class IFCTypesView {
  readonly store: DataObjectTypesStore;
  private _app: any = null;
  private _tree: PagedTreeHandle | null = null;

  private constructor(params: IFCTypesViewParams, Vue: any) {
    this.store = new DataObjectTypesStore({
      ...params,
      makeReactive: Vue.reactive
    });
  }

  static async create(params: IFCTypesViewParams): Promise<IFCTypesView> {
    const Vue = params.vue || await loadVue();
    const typesView = new IFCTypesView(params, Vue);
    await typesView._mount(params.container, Vue, params.commands);
    return typesView;
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
      name: "IFCTypesView",
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
              <h1>Categories</h1>
              <p>{{ state.roots.length }} categor{{ state.roots.length === 1 ? 'y' : 'ies' }}</p>
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
