import {ExplorerObjectEffects} from "../tree/ExplorerObjectEffects";
import type {ObjectEffectId} from "../tree/objectEffects";
import {scrollExplorerRowIntoView} from "../scrollExplorerRowIntoView";
import type {ViewerExplorerControlState, ViewerExplorerNodeState, ViewerExplorerStore} from "./ViewerExplorerStore";
import {createExplorerNumberInput} from "../tree/ExplorerNumberInput";
import {createExplorerVectorInput} from "../tree/ExplorerVectorInput";
import {createExplorerTextInput} from "../tree/ExplorerTextInput";
import {parseMatrixValue} from "./matrixInput";

export function createViewerExplorerNodeComponent(copyIcon?: unknown, effectsIcon?: unknown) {
  const component: any = {
    name: "ViewerExplorerNode",
    props: {
      node: {type: Object, required: true},
      store: {type: Object, required: true},
      flat: {type: Boolean, default: false}
    },
    data() { return {showEffects: false}; },
    methods: {
      revealEffects(this: any) {
        this.$nextTick(() => {
          const effects = this.$el.querySelector(".explorer-subtree-effects");
          const host = this.$el.closest(".explorer-panel-host, .xeokit-viewer-explorer");
          if (effects && host) scrollExplorerRowIntoView(effects, host);
        });
      },
      activateRow(this: any, event: Event) {
        if (this.node.kind !== "object" || !this.node.hasViewObject ||
          (event.target as HTMLElement).closest("button, input, select, textarea, a")) return;
        this.store.state.activeNodeId = this.node.id;
        this.revealEffects();
      },
      toggleEffects(this: any) {
        const open = this.showEffects || this.store.state.activeNodeId === this.node.id;
        this.showEffects = !open;
        if (!open) this.revealEffects();
        if (this.store.state.activeNodeId === this.node.id) this.store.state.activeNodeId = "";
      },
      toggleEffect(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}, effect: ObjectEffectId) {
        this.store.toggleObjectEffect(this.node, effect);
      },
      isolateObject(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}) {
        this.store.isolateObject(this.node);
      },
      validMatrix(value: string) { return !!parseMatrixValue(value); },
      validColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value); },
      toggleExpanded(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}) {
        this.store.toggleExpanded(this.node);
      },
      toggleVisible(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}) {
        this.store.toggleObjectVisibility(this.node);
      },
      fitObject(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}) {
        this.store.fitObject(this.node);
      },
      effectControls(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}): ViewerExplorerControlState[] {
        return this.store.getEffectControls(this.node);
      },
      controls(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}): ViewerExplorerControlState[] {
        // SDK objects stay non-reactive; the store revision invalidates displayed values.
        void this.store.state.revision;
        void this.node.controlsRevision;
        return this.store.getNodeControls(this.node);
      },
      setControlValue(this: {node: ViewerExplorerNodeState; store: ViewerExplorerStore}, control: ViewerExplorerControlState, event: Event) {
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        const value = control.kind === "boolean" ? (target as HTMLInputElement).checked : target.value;
        this.store.setNodeControlValue(this.node, control.id, value);
      },
      matrixText(this: {node: ViewerExplorerNodeState}, control: ViewerExplorerControlState): string {
        return Array.isArray(control.value) ? control.value.map((component) => Number(component).toFixed(6)).join(", ") : "";
      },
      async copyMatrix(control: ViewerExplorerControlState) {
        const text = this.matrixText(control);
        if (!text) {
          return;
        }
        try {
          await navigator.clipboard?.writeText(text);
        } catch {
          // The textarea remains directly selectable when clipboard access is unavailable.
        }
      }
    },
    template: `
      <component :is="flat ? 'div' : 'li'" class="xeokit-viewer-explorer-node">
        <div
          class="xeokit-viewer-explorer-row"
          @click="activateRow" :class="{'is-active-node': store.state.activeNodeId === node.id}"
          :data-node-id="node.id"
          :data-tree-depth="node.depth" role="treeitem" tabindex="-1" :aria-level="node.depth + 1"
          :aria-expanded="node.hasChildren ? node.expanded : undefined"
          :style="{ paddingLeft: (node.depth * 14 + 6) + 'px' }">
          <button
            class="xeokit-viewer-explorer-expander"
            :class="{ 'is-empty': !node.hasChildren }"
            :disabled="!node.hasChildren"
            :aria-label="node.expanded ? 'Collapse' : 'Expand'"
            @click="toggleExpanded">
            <span v-if="node.loading">...</span>
            <span v-else>{{ node.hasChildren ? (node.expanded ? '-' : '+') : '' }}</span>
          </button>

          <span
            class="xeokit-viewer-explorer-kind-icon"
            :class="'kind-' + node.kind"
            :title="node.kind">
            <svg v-if="node.kind === 'viewer'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H4z"></path><path d="M9 20h6M12 16v4"></path></svg>
            <svg v-else-if="node.kind === 'renderer'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H4z"></path><path d="M8 19h8"></path><path d="M10 15v4M14 15v4"></path><path d="M8 9h8M8 12h5"></path></svg>
            <svg v-else-if="node.kind === 'view'" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3z"></path><path d="M7 10h10M7 14h6"></path></svg>
            <svg v-else-if="node.kind === 'folder'" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v10H3z"></path></svg>
            <svg v-else-if="node.kind === 'layer'" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 8 4-8 4-8-4z"></path><path d="m4 12 8 4 8-4M4 16l8 4 8-4"></path></svg>
            <svg v-else-if="node.kind === 'object'" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8 12 4l7 4v8l-7 4-7-4z"></path><path d="M5 8l7 4 7-4M12 12v8"></path></svg>
            <svg v-else-if="node.kind === 'camera' || node.kind === 'cameraComponent'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11v10H4z"></path><path d="m15 10 5-3v10l-5-3z"></path></svg>
            <svg v-else-if="node.kind === 'effects' || node.kind === 'effect'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7l14 10M19 7 5 17"></path></svg>
            <svg v-else-if="node.kind === 'lights' || node.kind === 'light'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path><circle cx="12" cy="12" r="4"></circle></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h6"></path></svg>
          </span>

          <span class="xeokit-viewer-explorer-title" :title="node.title + ': ' + node.detail">
            <span>{{ node.title }}</span>
            <span v-if="node.detail" class="xeokit-viewer-explorer-detail">{{ node.detail }}</span>
          </span>

          <span class="xeokit-viewer-explorer-actions">
            <button
              v-if="node.kind === 'object'"
              class="xeokit-viewer-explorer-action"
              :class="{ active: node.visible }"
              :aria-pressed="node.visible"
              :title="node.visible ? 'Hide in View' : 'Show in View'"
              :aria-label="node.visible ? 'Hide in View' : 'Show in View'"
              :disabled="!node.hasViewObject" @click.stop="toggleVisible">
              <svg class="xeokit-viewer-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="3"></circle><path v-if="!node.visible" d="M4 20 20 4"></path></svg>
            </button>
            <button
              v-if="node.canFit"
              class="xeokit-viewer-explorer-action"
              title="Fit object"
              aria-label="Fit object"
              @click.stop="fitObject">
              <svg class="xeokit-viewer-explorer-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg>
            </button>
            <button v-if="node.kind === 'object'" class="xeokit-viewer-explorer-action"
              title="Object effects" aria-label="Object effects" :disabled="!node.hasViewObject"
              :aria-expanded="showEffects || store.state.activeNodeId === node.id"
              :class="{ active: node.effects.highlighted || node.effects.xrayed }" @click.stop="toggleEffects">
              <EffectsIcon :size="16" aria-hidden="true"/>
            </button>
          </span>
        </div>
        <ExplorerObjectEffects v-if="node.kind === 'object' && (showEffects || store.state.activeNodeId === node.id)"
          :style="{ marginLeft: (node.depth * 14 + 34) + 'px' }"
          :effects="node.effects" :disabled="!node.hasViewObject" @isolate="isolateObject" @toggle="toggleEffect"/>
        <div
          v-if="(node.kind === 'effect' || node.kind === 'cameraComponent' || node.kind === 'light') && node.expanded"
          class="xeokit-viewer-explorer-controls"
          :style="{ marginLeft: (node.depth * 14 + 48) + 'px' }">
          <div
            v-for="control in controls()"
            :key="control.id"
            class="xeokit-viewer-explorer-control"
            :class="'control-' + control.kind">
            <span class="xeokit-viewer-explorer-control-label">{{ control.label }}</span>

            <input
              v-if="control.kind === 'boolean'"
              type="checkbox"
              :aria-label="control.label"
              :checked="control.value === true"
              @change="setControlValue(control, $event)"/>

            <span v-else-if="control.kind === 'number'" class="xeokit-viewer-explorer-number-control">
              <input
                type="range"
                :aria-label="control.label"
                :min="control.min"
                :max="control.max"
                :step="control.step"
                :value="control.value"
                @input="setControlValue(control, $event)"/>
              <ExplorerNumberInput :label="control.label" :min="control.min" :max="control.max"
                :value="control.value" @commit="store.setNodeControlValue(node, control.id, $event)"/>
            </span>

            <select
              v-else-if="control.kind === 'select'"
              :aria-label="control.label"
              :value="String(control.value)"
              @change="setControlValue(control, $event)">
              <option
                v-for="option in control.options"
                :key="String(option.value)"
                :value="String(option.value)">
                {{ option.label }}
              </option>
            </select>

            <span v-else-if="control.kind === 'color'" class="xeokit-viewer-explorer-color-control">
              <input
                type="color"
                :aria-label="control.label"
                :value="control.value"
                @input="setControlValue(control, $event)"/>
              <ExplorerTextInput :label="control.label + ' hex'" :value="control.value" :validate="validColor"
                @commit="store.setNodeControlValue(node, control.id, $event)"/>
            </span>

            <ExplorerVectorInput v-else-if="control.kind === 'vec3'" :label="control.label" :min="control.min" :max="control.max"
              :value="control.value" :nonzero="control.id === 'up'" @commit="store.setNodeVector(node, control.id, $event)"/>

            <span v-else-if="control.kind === 'mat4'" class="xeokit-viewer-explorer-matrix-control">
              <ExplorerTextInput :label="control.label" :value="matrixText(control)" multiline :validate="validMatrix"
                @commit="store.setNodeMatrixValue(node, control.id, $event)"/>
              <button
                type="button"
                class="xeokit-viewer-explorer-copy-control"
                title="Copy matrix"
                aria-label="Copy matrix"
                @click.prevent="copyMatrix(control)">
                Copy
              </button>
            </span>
          </div>
        </div>
        <ul v-if="node.expanded && !flat" class="xeokit-viewer-explorer-children">
          <ViewerExplorerNode
            v-for="child in node.children"
            :key="child.id"
            :node="child"
            :store="store"/>
        </ul>
      </component>
    `
  };
  component.components = {ExplorerObjectEffects, EffectsIcon: effectsIcon || {template: '<span>...</span>'}, ViewerExplorerNode: component, ExplorerNumberInput: createExplorerNumberInput(), ExplorerVectorInput: createExplorerVectorInput(copyIcon), ExplorerTextInput: createExplorerTextInput()};
  return component;
}
