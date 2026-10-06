import type {Scene} from "@xeokit/sdk/model/scene";
import type {Viewer, View} from "@xeokit/sdk/viewing/viewer";
import {loadVue} from "../../ui/loadVue";
import {createSceneTreeNodeComponent} from "./SceneTreeNode";
import {SceneTreeStore} from "./SceneTreeStore";
import {loadExplorerIcons} from "../tree/loadExplorerIcons";
import {createPagedTree, type PagedTreeHandle} from "../tree/PagedTree";

export interface SceneTreeViewParams {
  container: HTMLElement;
  scene: Scene;
  viewer: Viewer;
  view?: View;
  vue?: any;
  confirmDeleteModel?: (modelId: string) => boolean | Promise<boolean>;
  confirmDeleteObject?: (objectId: string, modelId: string) => boolean | Promise<boolean>;
}

export class SceneTreeView {
  readonly store: SceneTreeStore;
  private _app: any = null;
  private _tree: PagedTreeHandle | null = null;

  private constructor(params: SceneTreeViewParams, Vue: any) {
    this.store = new SceneTreeStore({
      ...params,
      makeReactive: Vue.reactive,
      revealNode: id => this.revealNode(id)
    });
  }

  static async create(params: SceneTreeViewParams): Promise<SceneTreeView> {
    const Vue = params.vue || await loadVue();
    const treeView = new SceneTreeView(params, Vue);
    await treeView._mount(params.container, Vue);
    return treeView;
  }

  destroy(): void {
    this._app?.unmount();
    this._app = null;
    this._tree = null;
    this.store.destroy();
  }

  async revealNode(id: string): Promise<void> {
    await this._tree?.reveal(id);
  }

  private async _mount(container: HTMLElement, Vue: any): Promise<void> {
    const icons = await loadExplorerIcons();
    const SceneTreeNode = createSceneTreeNodeComponent(icons);
    const store = this.store;
    const view = this;
    this._app = Vue.createApp({
      name: "SceneTreeView",
      components: {PagedTree: createPagedTree(Vue, SceneTreeNode, icons)},
      setup() {
        return {
          state: store.state,
          store,
          bindTree: (tree: PagedTreeHandle | null) => { view._tree = tree; }
        };
      },
      template: `
        <section class="xeokit-scene-tree" :class="{ 'is-busy': state.busy }">
          <header class="xeokit-scene-tree-header">
            <div>
              <h1>Scene</h1>
              <p>{{ state.roots.length ? state.roots[0].detail : '0 models' }}</p>
            </div>
          </header>
          <PagedTree class="xeokit-scene-tree-roots" :store="store" :ref="bindTree"/>
        </section>
      `
    });
    this._app.mount(container);
  }
}
