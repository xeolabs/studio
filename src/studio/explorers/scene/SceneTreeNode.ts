import type {SceneTreeNodeState, SceneTreeStore} from "./SceneTreeStore";
import {visibilityLabel} from "../tree/visibilitySummary";
import {createExplorerPagination} from "../tree/ExplorerPagination";
import type {ExplorerIcons} from "../tree/loadExplorerIcons";

export function createSceneTreeNodeComponent(icons: ExplorerIcons = {}) {
  const component: any = {
    name: "SceneTreeNode",
    props: {
      node: {type: Object, required: true},
      store: {type: Object, required: true},
      flat: {type: Boolean, default: false}
    },
    methods: {
      visibilityLabel,
      setPage(this: {node: SceneTreeNodeState; store: SceneTreeStore; $el: HTMLElement}, page: number) {
        this.store.setPage(this.node, page);
        this.$el.querySelector('.explorer-pagination')?.scrollIntoView({block: 'nearest'});
      },
      toggleExpanded(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.toggleExpanded(this.node);
      },
      toggleVisibility(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.toggleObjectVisibility(this.node);
      },
      fitObject(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.fitObject(this.node);
      },
      fitMesh(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.fitMesh(this.node);
      },
      fitScene(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.fitScene(this.node);
      },
      toggleModelVisibility(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.toggleModelVisibility(this.node);
      },
      fitModel(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.fitModel(this.node);
      },
      setModelCoordinateSystemPreset(this: {node: SceneTreeNodeState; store: SceneTreeStore}, event: Event) {
        const select = event.target as HTMLSelectElement | null;
        if (select) {
          this.store.setModelCoordinateSystemPreset(this.node, select.value);
        }
      },
      deleteModel(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        void this.store.confirmAndDeleteModel(this.node);
      },
      deleteObject(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        void this.store.confirmAndDeleteObject(this.node);
      },
      revealReferencedResource(this: {node: SceneTreeNodeState; store: SceneTreeStore}) {
        this.store.revealReferencedResource(this.node);
      }
    },
    template: `
      <component :is="flat ? 'div' : 'li'" class="xeokit-scene-tree-node">
        <div
          class="xeokit-scene-tree-row"
          :class="{ 'is-resource-ref': node.kind === 'resourceRef' }"
          :data-node-id="node.id"
          :data-tree-depth="node.depth"
          role="treeitem" tabindex="-1" :aria-level="node.depth + 1"
          :aria-expanded="node.hasChildren ? node.expanded : undefined"
          :style="{ paddingLeft: (node.depth * 14 + 6) + 'px' }">
          <button
            class="xeokit-scene-tree-expander"
            :class="{ 'is-empty': !node.hasChildren }"
            :disabled="!node.hasChildren"
            :aria-label="node.expanded ? 'Collapse' : 'Expand'"
            @click="toggleExpanded">
            <span v-if="node.loading">...</span>
            <span v-else>{{ node.hasChildren ? (node.expanded ? '-' : '+') : '' }}</span>
          </button>

          <span
            class="xeokit-scene-tree-kind-icon"
            :class="['kind-' + node.kind, node.attributeRole ? 'role-' + node.attributeRole : '']"
            :title="node.attributeRole || node.kind">
            <svg v-if="node.kind === 'scene'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"></path><path d="M4 7.5 12 12l8-4.5M12 12v9"></path></svg>
            <svg v-else-if="node.kind === 'model'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="M8 8h8v8H8z"></path></svg>
            <svg v-else-if="node.kind === 'folder'" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v10H3z"></path></svg>
            <svg v-else-if="node.kind === 'object'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8 12 4l7 4v8l-7 4-7-4z"></path><path d="M5 8l7 4 7-4M12 12v8"></path></svg>
            <svg v-else-if="node.kind === 'mesh'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 12 5l8 13z"></path><path d="M8 18l4-6 4 6"></path></svg>
            <svg v-else-if="node.kind === 'geometry'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 8v8l8 5 8-5V8z"></path><path d="M4 8l8 5 8-5M12 13v8"></path></svg>
            <svg v-else-if="node.kind === 'transform'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12V4M12 4l-3 3M12 4l3 3M12 12h8M20 12l-3-3M20 12l-3 3M12 12 6 18M6 18h4M6 18v-4"></path></svg>
            <svg v-else-if="node.kind === 'material'" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v7a5 5 0 1 1-10 0z"></path><path d="M9 8h6"></path></svg>
            <svg v-else-if="node.kind === 'texture' || node.kind === 'textureBinding'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="M8 8h8v8H8z"></path><path d="M5 16l4-4 3 3 2-2 5 5"></path></svg>
            <svg v-else-if="node.kind === 'animation'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16l14-8z"></path></svg>
            <svg v-else-if="node.kind === 'animationChannel'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c4 0 4-8 8-8s4 8 8 8"></path><path d="M4 20h16"></path></svg>
            <svg v-else-if="node.kind === 'resourceRef'" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"></path></svg>
            <svg v-else-if="node.attributeRole === 'positions'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 12 5l8 13z"></path><circle cx="12" cy="5" r="1.5"></circle><circle cx="4" cy="18" r="1.5"></circle><circle cx="20" cy="18" r="1.5"></circle></svg>
            <svg v-else-if="node.attributeRole === 'normals'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M7 10l5-5 5 5"></path><path d="M5 19h14"></path></svg>
            <svg v-else-if="node.attributeRole === 'uvs'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5h14"></path><path d="M5 19c5-1 9-5 14-14"></path><path d="M9 19c3-3 6-6 10-8"></path></svg>
            <svg v-else-if="node.attributeRole === 'colors'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 0 16h1.5a2 2 0 0 0 0-4H12a4 4 0 0 1 0-8h1.5a2 2 0 0 0 0-4z"></path><circle cx="8" cy="12" r="1"></circle><circle cx="11" cy="9" r="1"></circle><circle cx="11" cy="15" r="1"></circle></svg>
            <svg v-else-if="node.attributeRole === 'indices' || node.attributeRole === 'edges'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"></path><path d="M8 5v14M16 5v14"></path></svg>
            <svg v-else-if="node.attributeRole === 'frames'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h11v10H5z"></path><path d="M8 4h11v10"></path></svg>
            <svg v-else-if="node.attributeRole === 'morphs'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17c4-10 10 10 14 0"></path><path d="M5 7c4 10 10-10 14 0"></path></svg>
            <svg v-else-if="node.attributeRole === 'splats'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="15" cy="13" r="4"></circle><circle cx="9" cy="17" r="2"></circle></svg>
            <svg v-else-if="node.kind === 'property' || node.kind === 'attribute'" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h6"></path></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="M8 8h8v8H8z"></path></svg>
          </span>

          <span class="xeokit-scene-tree-title" :title="node.title + ': ' + node.detail + (node.componentId ? ' (' + node.componentId + ')' : '')">
            <span>{{ node.title }}</span>
            <span v-if="node.detail" class="xeokit-scene-tree-detail">{{ node.detail }}</span>
          </span>

          <span class="xeokit-scene-tree-actions">
            <button
              v-if="node.kind === 'scene'"
              class="xeokit-scene-tree-action"
              title="Fit View to Scene"
              @click.stop="fitScene">
              <svg class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M9 12h6M12 9v6"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'model'"
              class="xeokit-scene-tree-action is-visibility"
              :class="{ active: node.visible, 'is-mixed': node.visibleCount > 0 && node.visibleCount < node.viewObjectCount }"
              :aria-pressed="node.visibleCount > 0 && node.visibleCount < node.viewObjectCount ? 'mixed' : node.visible"
              :disabled="!node.hasViewObject"
              :title="visibilityLabel(node)"
              @click.stop="toggleModelVisibility">
              <svg v-if="node.visible" class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <svg v-else class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M4 20 20 4"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'model'"
              class="xeokit-scene-tree-action"
              :disabled="!node.hasViewObject"
              :title="node.hasViewObject ? 'Fit View to SceneModel' : 'No ViewObjects in this View'"
              @click.stop="fitModel">
              <svg class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M9 12h6M12 9v6"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'model'"
              class="xeokit-scene-tree-action is-danger"
              title="Delete SceneModel"
              @click.stop="deleteModel">
              <svg class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14"></path>
                <path d="M10 7V5h4v2"></path>
                <path d="M8 7l1 12h6l1-12"></path>
                <path d="M10 11v5M14 11v5"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'object'"
              class="xeokit-scene-tree-action is-visibility"
              :class="{ active: node.visible }"
              :aria-pressed="node.visible"
              :disabled="!node.hasViewObject"
              :title="node.hasViewObject ? (node.visible ? 'Hide SceneObject' : 'Show SceneObject') : 'No ViewObject in this View'"
              @click.stop="toggleVisibility">
              <svg v-if="node.visible" class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <svg v-else class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M4 20 20 4"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'object'"
              class="xeokit-scene-tree-action"
              :disabled="!node.hasViewObject"
              :title="node.hasViewObject ? 'Fit View to SceneObject' : 'No ViewObject in this View'"
              @click.stop="fitObject">
              <svg class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M9 12h6M12 9v6"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'mesh'"
              class="xeokit-scene-tree-action"
              title="Fit View to SceneMesh"
              @click.stop="fitMesh">
              <svg class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M8 17 12 7l4 10z"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'resourceRef'"
              class="xeokit-scene-tree-action"
              title="Reveal canonical Scene resource"
              @click.stop="revealReferencedResource">
              <svg class="xeokit-scene-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 17 17 7"></path>
                <path d="M9 7h8v8"></path>
              </svg>
            </button>
          </span>
        </div>
        <details v-if="node.kind === 'model'" class="explorer-model-settings" :open="node.settingsExpanded" @toggle="node.settingsExpanded = $event.target.open" :style="{ marginLeft: (node.depth * 14 + 34) + 'px' }">
          <summary>Coordinate system</summary>
          <label class="xeokit-scene-tree-model-coord">
            <select aria-label="SceneModel coordinate system" :title="store.state.coordinateSystem.presets.find(preset => preset.id === node.modelCoordinateSystemPresetId)?.label || 'Custom'"
              :value="node.modelCoordinateSystemPresetId || 'custom'" @change.stop="setModelCoordinateSystemPreset">
              <option value="custom" disabled>Custom</option>
              <option v-for="preset in store.state.coordinateSystem.presets" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
            </select>
          </label>
        </details>
        <ul v-if="node.expanded && !flat" class="xeokit-scene-tree-children">
          <li v-if="node.childCount > store.pageSize" role="none">
            <ExplorerPagination :page="node.pageIndex" :count="node.childCount" :size="store.pageSize" @change="setPage"/>
          </li>
          <SceneTreeNode
            v-for="child in node.children"
            :key="child.id"
            :node="child"
            :store="store"/>
          <li v-if="node.childCount > store.pageSize" role="none">
            <ExplorerPagination :page="node.pageIndex" :count="node.childCount" :size="store.pageSize" @change="setPage"/>
          </li>
        </ul>
      </component>
    `
  };
  component.components = {SceneTreeNode: component, ExplorerPagination: createExplorerPagination(icons)};
  return component;
}
