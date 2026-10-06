/** Keeps unfinished text local while external runtime values continue to update. */
export function createExplorerTextInput() {
  return {
    name: "ExplorerTextInput",
    props: {value: String, label: String, multiline: Boolean, validate: Function},
    emits: ["commit"],
    data() { return {draft: this.value, dirty: false, invalid: false}; },
    watch: {value(value: string) { if (!this.dirty) this.draft = value; }},
    methods: {
      commit() {
        if (!this.dirty) return;
        this.invalid = this.validate ? !this.validate(this.draft) : false;
        if (!this.invalid) { this.dirty = false; this.$emit("commit", this.draft); }
      },
      reset() { this.draft = this.value; this.dirty = false; this.invalid = false; }
    },
    template: `<span class="explorer-text-field">
      <component :is="multiline ? 'textarea' : 'input'" :type="multiline ? undefined : 'text'" :rows="multiline ? 3 : undefined"
        :aria-label="label" :aria-invalid="invalid" :value="draft" spellcheck="false"
        @input="draft = $event.target.value; dirty = true; invalid = false" @blur="commit"
        @keydown.enter.prevent.stop="commit" @keydown.esc.prevent.stop="reset"/>
      <span v-if="invalid" role="alert" class="explorer-field-error">{{ label }}: enter a valid value.</span>
    </span>`
  };
}
