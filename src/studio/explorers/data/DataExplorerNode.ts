import type {DataExplorerNodeState, DataExplorerStore} from "./DataExplorerStore";
import {visibilityLabel} from "../tree/visibilitySummary";

export function createDataExplorerNodeComponent() {
  const component: any = {
    name: "DataExplorerNode",
    props: {
      node: {type: Object, required: true},
      store: {type: Object, required: true},
      flat: {type: Boolean, default: false}
    },
    methods: {
      visibilityLabel,
      toggleExpanded(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.toggleExpanded(this.node);
      },
      toggleVisibility(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.toggleObjectVisibility(this.node);
      },
      fitObject(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.fitObject(this.node);
      },
      toggleModelVisibility(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.toggleModelVisibility(this.node);
      },
      fitModel(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.fitModel(this.node);
      },
      toggleTypeVisibility(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.toggleTypeVisibility(this.node);
      },
      fitType(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        this.store.fitType(this.node);
      },
      deleteModel(this: {node: DataExplorerNodeState; store: DataExplorerStore}) {
        void this.store.confirmAndDeleteModel(this.node);
      }
    },
    template: `
      <component :is="flat ? 'div' : 'li'" class="xeokit-data-explorer-node">
        <div
          class="xeokit-data-explorer-row"
          :data-node-id="node.id"
          :data-tree-depth="node.depth" role="treeitem" tabindex="-1" :aria-level="node.depth + 1"
          :aria-expanded="node.hasChildren ? node.expanded : undefined"
          :style="{ paddingLeft: (node.depth * 14 + 6) + 'px' }">
          <button
            class="xeokit-data-explorer-expander"
            :class="{ 'is-empty': !node.hasChildren }"
            :disabled="!node.hasChildren"
            :aria-label="node.expanded ? 'Collapse' : 'Expand'"
            @click="toggleExpanded">
            <span v-if="node.loading">...</span>
            <span v-else>{{ node.hasChildren ? (node.expanded ? '-' : '+') : '' }}</span>
          </button>

          <span
            class="xeokit-data-explorer-kind-icon"
            :class="'kind-' + node.kind"
            :title="node.kind">
            <svg v-if="node.kind === 'data'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"></path><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"></path><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path></svg>
            <svg v-else-if="node.kind === 'model'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="M8 8h8v8H8z"></path></svg>
            <svg v-else-if="node.kind === 'folder' || node.kind === 'typeGroup'" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v10H3z"></path></svg>
            <svg v-else-if="node.kind === 'object'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8 12 4l7 4v8l-7 4-7-4z"></path><path d="M5 8l7 4 7-4M12 12v8"></path></svg>
            <svg v-else-if="node.kind === 'propertySet'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="M8 9h8M8 13h8M8 17h5"></path></svg>
            <svg v-else-if="node.kind === 'relationship'" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h4v4H7zM13 13h4v4h-4z"></path><path d="M11 9h2a4 4 0 0 1 4 4"></path></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h6"></path></svg>
          </span>

          <span class="xeokit-data-explorer-title" :title="node.title + ': ' + node.detail + (node.componentId ? ' (' + node.componentId + ')' : '')">
            <span>{{ node.title }}</span>
            <span v-if="node.detail" class="xeokit-data-explorer-detail">{{ node.detail }}</span>
          </span>

          <span class="xeokit-data-explorer-actions">
            <button
              v-if="node.kind === 'model'"
              class="xeokit-data-explorer-action is-visibility"
              :class="{ active: node.visible, 'is-mixed': node.visibleCount > 0 && node.visibleCount < node.viewObjectCount }"
              :aria-pressed="node.visibleCount > 0 && node.visibleCount < node.viewObjectCount ? 'mixed' : node.visible"
              :disabled="!node.hasViewObject"
              :title="visibilityLabel(node)"
              @click.stop="toggleModelVisibility">
              <svg v-if="node.visible" class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <svg v-else class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M4 20 20 4"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'model'"
              class="xeokit-data-explorer-action"
              :disabled="!node.hasViewObject"
              :title="node.hasViewObject ? 'Fit View to DataModel SceneObjects' : 'No corresponding SceneObjects in the active View'"
              @click.stop="fitModel">
              <svg class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M9 12h6M12 9v6"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'model'"
              class="xeokit-data-explorer-action is-danger"
              title="Delete DataModel"
              @click.stop="deleteModel">
              <svg class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14"></path>
                <path d="M10 7V5h4v2"></path>
                <path d="M8 7l1 12h6l1-12"></path>
                <path d="M10 11v5M14 11v5"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'typeGroup'"
              class="xeokit-data-explorer-action is-visibility"
              :class="{ active: node.visible, 'is-mixed': node.visibleCount > 0 && node.visibleCount < node.viewObjectCount }"
              :aria-pressed="node.visibleCount > 0 && node.visibleCount < node.viewObjectCount ? 'mixed' : node.visible"
              :disabled="!node.hasViewObject"
              :title="visibilityLabel(node)"
              @click.stop="toggleTypeVisibility">
              <svg v-if="node.visible" class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <svg v-else class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M4 20 20 4"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'typeGroup'"
              class="xeokit-data-explorer-action"
              :disabled="!node.hasViewObject"
              :title="node.hasViewObject ? 'Fit View to SceneObjects of this type' : 'No corresponding SceneObjects in the active View'"
              @click.stop="fitType">
              <svg class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M9 12h6M12 9v6"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'object' && node.hasViewObject"
              class="xeokit-data-explorer-action is-visibility"
              :class="{ active: node.visible }"
              :aria-pressed="node.visible"
              :title="node.visible ? 'Hide corresponding SceneObject in active View' : 'Show corresponding SceneObject in active View'"
              @click.stop="toggleVisibility">
              <svg v-if="node.visible" class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <svg v-else class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M4 20 20 4"></path>
              </svg>
            </button>
            <button
              v-if="node.kind === 'object' && node.hasViewObject"
              class="xeokit-data-explorer-action"
              title="Fit View to corresponding SceneObject"
              @click.stop="fitObject">
              <svg class="xeokit-data-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                <path d="M9 12h6M12 9v6"></path>
              </svg>
            </button>
          </span>
        </div>
        <ul v-if="node.expanded && !flat" class="xeokit-data-explorer-children">
          <DataExplorerNode
            v-for="child in node.children"
            :key="child.id"
            :node="child"
            :store="store"/>
        </ul>
      </component>
    `
  };
  component.components = {DataExplorerNode: component};
  return component;
}
