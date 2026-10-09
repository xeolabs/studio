/** One compact action menu for IFC subtrees and individual Viewer elements. */
export const ExplorerObjectEffects = {
  name: "ExplorerObjectEffects",
  props: {
    effects: {type: Object, required: true},
    disabled: {type: Boolean, default: false},
    subtree: {type: Boolean, default: false},
    mixedVisibility: {type: Boolean, default: false},
    canPlan: {type: Boolean, default: false}
  },
  emits: ["toggle", "isolate", "plan"],
  template: `
    <fieldset class="explorer-subtree-effects">
      <legend>{{ subtree ? 'Subtree effects' : 'Object effects' }}</legend>
      <button v-if="canPlan" type="button" class="explorer-subtree-button" :disabled="disabled"
        title="View this floor from above" @click.stop="$emit('plan')">Plan</button>
      <button type="button" class="explorer-subtree-button" :disabled="disabled"
        :title="subtree ? 'Show only this subtree' : 'Show only this object'" @click.stop="$emit('isolate')">Isolate</button>
      <button type="button" class="explorer-subtree-button" :disabled="disabled"
        :aria-pressed="mixedVisibility ? 'mixed' : effects.visible"
        :title="effects.visible ? 'Hide in view' : 'Show in view'" @click.stop="$emit('toggle', 'visible')">Visible</button>
      <button type="button" class="explorer-subtree-button" :disabled="disabled"
        :aria-pressed="effects.highlighted" @click.stop="$emit('toggle', 'highlighted')">Highlight</button>
      <button type="button" class="explorer-subtree-button" :disabled="disabled"
        :aria-pressed="effects.xrayed" @click.stop="$emit('toggle', 'xrayed')">X-ray</button>
      <button type="button" class="explorer-subtree-button" :disabled="disabled" title="Toggle selection styling"
        :aria-pressed="effects.selected" @click.stop="$emit('toggle', 'selected')">Selection style</button>
    </fieldset>`
};
