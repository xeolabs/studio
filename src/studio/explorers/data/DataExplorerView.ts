import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import {DataExplorerStore} from "./DataExplorerStore";
import {createDataExplorerNodeComponent} from "./DataExplorerNode";
import {loadVue} from "../../ui/loadVue";
import {loadExplorerIcons} from "../tree/loadExplorerIcons";
import {createPagedTree, type PagedTreeHandle} from "../tree/PagedTree";

export interface DataExplorerViewParams {
  container: HTMLElement;
  data: Data;
  scene?: Scene;
  view?: View;
  vue?: any;
  confirmDeleteModel?: (modelId: string) => boolean | Promise<boolean>;
}

export class DataExplorerView {
  readonly store: DataExplorerStore;
  private _app: any = null;
  private _tree: PagedTreeHandle | null = null;

  private constructor(params: DataExplorerViewParams, Vue: any) {
    this.store = new DataExplorerStore({
      data: params.data,
      scene: params.scene,
      view: params.view,
      makeReactive: Vue.reactive,
      confirmDeleteModel: params.confirmDeleteModel
    });
  }

  static async create(params: DataExplorerViewParams): Promise<DataExplorerView> {
    const Vue = params.vue || await loadVue();
    const explorer = new DataExplorerView(params, Vue);
    await explorer._mount(params.container, Vue);
    return explorer;
  }

  destroy(): void {
    this._app?.unmount();
    this._app = null;
    this._tree = null;
    this.store.destroy();
  }

  async revealNode(id: string): Promise<void> { await this._tree?.reveal(id); }

  private async _mount(container: HTMLElement, Vue: any): Promise<void> {
    const DataExplorerNode = createDataExplorerNodeComponent();
    const PagedTree = createPagedTree(Vue, DataExplorerNode, await loadExplorerIcons());
    const view = this;
    const store = this.store;
    this._app = Vue.createApp({
      name: "DataExplorerView",
      components: {PagedTree},
      setup() {
        return {
          state: store.state,
          store,
          bindTree: (tree: PagedTreeHandle | null) => { view._tree = tree; }
        };
      },
      template: `
        <section class="xeokit-data-explorer" :class="{ 'is-busy': state.busy }">
          <header class="xeokit-data-explorer-header">
            <div>
              <h1>Data</h1>
              <p>{{ state.roots[0]?.detail || '0 models' }}</p>
            </div>
          </header>
          <PagedTree class="xeokit-data-explorer-roots" :store="store" :ref="bindTree"/>
        </section>
      `
    });
    this._app.mount(container);
  }
}
