import {parseNumericInput} from "./numericInput";

/** A local draft prevents renderer updates and incomplete typing from fighting each other. */
export function createExplorerNumberInput() {
  return {
    name: "ExplorerNumberInput",
    props: {value: Number, min: Number, max: Number, label: String},
    emits: ["commit"],
    data() { return {draft: String(this.value), editing: false, dirty: false, invalid: false}; },
    watch: {value(value: number) { if (!this.dirty) this.draft = String(value); }},
    methods: {
      commit() {
        if (!this.dirty) return;
        const value = parseNumericInput(this.draft, this.min, this.max);
        this.invalid = value === null;
        if (value !== null) { this.dirty = false; this.$emit("commit", value); }
      },
      reset() { this.draft = String(this.value); this.invalid = false; this.dirty = false; },
      blur() { this.commit(); this.editing = false; }
    },
    template: `<span class="explorer-number-field">
      <input type="number" step="any" :min="min" :max="max" :aria-label="label" :aria-invalid="invalid"
        :value="draft" @input="draft = $event.target.value; dirty = true; invalid = false" @focus="editing = true"
        @blur="blur" @keydown.enter.prevent.stop="commit" @keydown.esc.prevent.stop="reset"/>
      <span v-if="invalid" class="explorer-field-error" role="alert">{{ label }}: enter a valid number{{ min != null || max != null ? ' within the allowed range' : '' }}.</span>
    </span>`
  };
}
