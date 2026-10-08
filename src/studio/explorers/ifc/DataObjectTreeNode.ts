import type {DataObjectTreeNodeState, DataObjectTreeStore} from "./DataObjectTreeStore";
import {isolateSubtree} from "./isolateSubtree";
import {scrollExplorerRowIntoView} from "../scrollExplorerRowIntoView";
import {visibilityLabel} from "../tree/visibilitySummary";
import {createIfcTypeIcon} from "./IfcTypeIcon";

export function createDataObjectTreeNodeComponent(effectsIcon?: unknown) {
  const component: any = {
    name: "DataObjectTreeNode",
    inject: {commands: {from: "commands", default: null}},
    props: {
      node: {type: Object, required: true},
      flat: {type: Boolean, default: false},
      store: {type: Object, required: true}
    },
    data() { return {showEffects: false}; },
    methods: {
      visibilityLabel,
      viewPlan(this: any) {
        const id = this.node.id.startsWith("ifc-storey:") ? decodeURIComponent(this.node.id.slice("ifc-storey:".length)) : this.node.id;
        this.commands?.execute("section.floorPlan", id);
      },
      revealEffects(this: any) {
        this.$nextTick(() => {
          const effects = this.$el.querySelector(".explorer-subtree-effects");
          const host = this.$el.closest(".explorer-panel-host, .xeokit-data-tree");
          if (effects && host) scrollExplorerRowIntoView(effects, host);
        });
      },
      activateRow(this: any, event: Event) {
        if ((event.target as HTMLElement).closest("button, input, select, a")) return;
        this.store.state.activeNodeId = this.node.id;
        this.revealEffects();
      },
      toggleEffects(this: any) {
        const open = this.showEffects || this.store.state.activeNodeId === this.node.id;
        this.showEffects = !open;
        if (!open) this.revealEffects();
        if (this.store.state.activeNodeId === this.node.id) this.store.state.activeNodeId = "";
      },
      toggleExpanded(this: {node: DataObjectTreeNodeState; store: DataObjectTreeStore}) {
        this.store.toggleExpanded(this.node);
      },
      toggleEffect(this: {node: DataObjectTreeNodeState; store: DataObjectTreeStore}, effectId: string) {
        this.store.toggleEffect(this.node, effectId as any);
      },
      isolateObject(this: {node: DataObjectTreeNodeState; store: DataObjectTreeStore}) {
        isolateSubtree(this.store, this.node);
      },
      fitObject(this: {node: DataObjectTreeNodeState; store: DataObjectTreeStore}) {
        this.store.fitObject(this.node);
      }
    },
    template: `
      <component :is="flat ? 'div' : 'li'" class="xeokit-data-tree-node">
        <div class="xeokit-data-tree-row" :data-node-id="node.id" :data-tree-depth="node.depth"
          @click="activateRow" :class="{'is-active-node': store.state.activeNodeId === node.id}" role="treeitem" :aria-level="node.depth + 1" :aria-expanded="node.hasChildren ? node.expanded : undefined"
          :style="{ paddingLeft: (node.depth * 14 + 6) + 'px' }">
          <button
            class="xeokit-data-tree-expander"
            :class="{ 'is-empty': !node.hasChildren }"
            :disabled="!node.hasChildren"
            :aria-label="node.expanded ? 'Collapse' : 'Expand'"
            @click="toggleExpanded">
            <span v-if="node.loading">...</span>
            <span v-else>{{ node.hasChildren ? (node.expanded ? '-' : '+') : '' }}</span>
          </button>
          <span class="xeokit-data-tree-type-icon" :title="node.type"><IfcTypeIcon :type="node.type === 'Type' ? node.title : node.type"/></span>
          <span class="xeokit-data-tree-title" :title="node.title + ' · ' + (node.detail || node.type) + ' (' + node.id + ')'">
            <span>{{ node.title }}</span>
            <span v-if="(node.detail || node.type) !== node.title" class="xeokit-data-tree-detail">{{ node.detail || node.type }}</span>
          </span>
          <span class="xeokit-data-tree-actions">
            <button
              class="xeokit-data-tree-action is-visibility"
              :class="{ active: node.effects.visible, 'is-mixed': node.visibleCount > 0 && node.visibleCount < node.viewObjectCount }"
              :aria-pressed="node.visibleCount > 0 && node.visibleCount < node.viewObjectCount ? 'mixed' : node.effects.visible"
              :disabled="!node.hasSubtreeViewObjects"
              :title="visibilityLabel(node)"
              @click.stop="toggleEffect('visible')">
              <svg v-if="node.effects.visible" class="xeokit-data-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <svg v-else class="xeokit-data-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M4 20 20 4"></path>
              </svg>
            </button>
            <button
              class="xeokit-data-tree-action"
              :disabled="!node.hasSubtreeViewObjects"
              :title="node.hasSubtreeViewObjects ? 'Fit this object subtree in view' : 'No renderable ViewObjects in this subtree'"
              @click.stop="fitObject">
              <svg class="xeokit-data-tree-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5"></path>
                <path d="M20 9V4h-5"></path>
                <path d="M4 15v5h5"></path>
                <path d="M20 15v5h-5"></path>
              </svg>
            </button>
            <button class="xeokit-data-tree-action" title="Subtree effects" aria-label="Subtree effects" :aria-expanded="showEffects || store.state.activeNodeId === node.id"
              :class="{ active: node.effects.highlighted || node.effects.xrayed }" :disabled="!node.hasSubtreeViewObjects" @click.stop="toggleEffects">
              <EffectsIcon :size="16" aria-hidden="true"/>
            </button>
          </span>
        </div>
        <fieldset v-if="showEffects || store.state.activeNodeId === node.id" class="explorer-subtree-effects" :style="{ marginLeft: (node.depth * 14 + 34) + 'px' }">
          <legend>Subtree effects</legend>
          <button v-if="node.type === 'IfcBuildingStorey' && commands" type="button" class="explorer-subtree-button"
            :disabled="!node.hasSubtreeViewObjects" title="View this floor from above" @click.stop="viewPlan">Plan</button>
          <button type="button" class="explorer-subtree-button" :disabled="!node.hasSubtreeViewObjects"
            title="Show only this subtree" @click.stop="isolateObject">Isolate</button>
          <button type="button" class="explorer-subtree-button" :aria-pressed="node.effects.highlighted"
            :disabled="!node.hasSubtreeViewObjects" @click.stop="toggleEffect('highlighted')">Highlight</button>
          <button type="button" class="explorer-subtree-button" :aria-pressed="node.effects.xrayed"
            :disabled="!node.hasSubtreeViewObjects" @click.stop="toggleEffect('xrayed')">X-ray</button>
          <button type="button" class="explorer-subtree-button" :aria-pressed="node.effects.selected"
            :disabled="!node.hasSubtreeViewObjects" title="Toggle selection styling" @click.stop="toggleEffect('selected')">Selection style</button>
        </fieldset>
        <ul v-if="node.expanded && !flat" class="xeokit-data-tree-children">
          <DataObjectTreeNode
            v-for="child in node.children"
            :key="child.id"
            :node="child"
            :store="store"/>
        </ul>
      </component>
    `
  };
  component.components = {DataObjectTreeNode: component, IfcTypeIcon: createIfcTypeIcon(), EffectsIcon: effectsIcon || {template: '<span>...</span>'}};
  return component;
}
