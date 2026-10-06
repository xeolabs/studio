import {createExplorerNumberInput} from "./ExplorerNumberInput";
import {parseVectorInput} from "./numericInput";

export function createExplorerVectorInput(copyIcon?: unknown) {
  return {
    name: "ExplorerVectorInput",
    components: {ExplorerNumberInput: createExplorerNumberInput(), CopyIcon: copyIcon || {template: '<span aria-hidden="true">...</span>'}},
    props: {value: Array, min: Number, max: Number, label: String, nonzero: Boolean},
    emits: ["commit"],
    data() { return {error: "", copied: false}; },
    methods: {
      setComponent(index: number, value: number) {
        const vector = [...this.value]; vector[index] = value;
        this.commit(vector);
      },
      commit(vector: number[]) {
        if (this.nonzero && vector.every(value => value === 0)) { this.error = "The direction cannot be zero."; return; }
        this.error = ""; this.$emit("commit", vector);
      },
      paste(event: ClipboardEvent) {
        const text = event.clipboardData?.getData("text") || "";
        if (!/[\s,;\[\]]/.test(text.trim())) return;
        event.preventDefault();
        const vector = parseVectorInput(text, 3, this.min, this.max);
        this.error = vector ? "" : "Paste three valid coordinates: X, Y, Z.";
        if (vector) {
          this.commit(vector);
          this.$nextTick(() => { for (const field of this.$refs.coordinates || []) field.reset(); });
        }
      },
      async copy() {
        try {
          if (!navigator.clipboard) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(this.value.join(", "));
          this.copied = true; this.error = "";
        } catch { this.error = "Clipboard unavailable. Coordinates can be copied from each field."; }
      }
    },
    watch: {value() { this.copied = false; }},
    template: `<span class="explorer-vector-field" @paste="paste">
      <span class="explorer-vector-components">
        <span v-for="(axis, index) in ['X', 'Y', 'Z']" :key="axis" class="explorer-vector-axis">
          <span aria-hidden="true">{{ axis }}</span>
          <ExplorerNumberInput ref="coordinates" :label="label + ' ' + axis" :value="value[index]" :min="min" :max="max" @commit="setComponent(index, $event)"/>
        </span>
        <button type="button" class="xeokit-viewer-explorer-action" :title="copied ? 'Copied' : 'Copy ' + label + ' vector'" :aria-label="'Copy ' + label + ' vector'" @click.stop="copy">
          <CopyIcon :size="16" aria-hidden="true"/>
        </button>
      </span>
      <span v-if="error" class="explorer-field-error" role="alert">{{ error }}</span>
    </span>`
  };
}
