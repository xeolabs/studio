import type {Renderer} from "@xeokit/sdk/viewing/rendering/core";
import type {Viewer} from "@xeokit/sdk/viewing/viewer";
import {loadVue} from "../../ui/loadVue";
import {loadExplorerIcons} from "../tree/loadExplorerIcons";
import {createViewerExplorerNodeComponent} from "./ViewerExplorerNode";
import {ViewerExplorerStore} from "./ViewerExplorerStore";
import {observeVisibleControls} from "./observeVisibleControls";
import {createPagedTree, type PagedTreeHandle} from "../tree/PagedTree";

export interface ViewerExplorerViewParams {
  container: HTMLElement;
  viewer: Viewer;
  renderer?: Renderer | null;
  rendererLabel?: string;
  vue?: any;
}

export class ViewerExplorerView {
  readonly store: ViewerExplorerStore;
  private _app: any = null;
  private _tree: PagedTreeHandle | null = null;
  private _stopObserving: (() => void) | null = null;

  private constructor(params: ViewerExplorerViewParams, Vue: any) {
    this.store = new ViewerExplorerStore({
      viewer: params.viewer,
      renderer: params.renderer,
      rendererLabel: params.rendererLabel,
      makeReactive: Vue.reactive
    });
  }

  static async create(params: ViewerExplorerViewParams): Promise<ViewerExplorerView> {
    const Vue = params.vue || await loadVue();
    const explorer = new ViewerExplorerView(params, Vue);
    await explorer._mount(params.container, Vue);
    return explorer;
  }

  destroy(): void {
    this._stopObserving?.();
    this._stopObserving = null;
    this._app?.unmount();
    this._app = null;
    this._tree = null;
    this.store.destroy();
  }

  async revealNode(id: string): Promise<void> { await this._tree?.reveal(id); }

  private async _mount(container: HTMLElement, Vue: any): Promise<void> {
    const icons = await loadExplorerIcons();
    const PagedTree = createPagedTree(Vue, createViewerExplorerNodeComponent(icons.Copy, icons.SlidersHorizontal), icons);
    const view = this;
    const store = this.store;
    this._app = Vue.createApp({
      name: "ViewerExplorerView",
      components: {PagedTree},
      setup() {
        return {
          state: store.state,
          store,
          bindTree: (tree: PagedTreeHandle | null) => { view._tree = tree; }
        };
      },
      template: `
        <section class="xeokit-viewer-explorer" :class="{ 'is-busy': state.busy }">
          <header class="xeokit-viewer-explorer-header">
            <div>
              <h1>Viewer</h1>
              <p>{{ state.roots.length ? state.roots[0].detail : '0 views' }}</p>
            </div>
          </header>
          <PagedTree class="xeokit-viewer-explorer-roots" :store="store" :ref="bindTree"/>
        </section>
      `
    });
    this._app.mount(container);
    this._stopObserving = observeVisibleControls(container, () => store.refreshDisplayedControls(
      new Set(Array.from(container.querySelectorAll<HTMLElement>('[data-node-id]'), row => row.dataset.nodeId!))
    ));
  }
}
