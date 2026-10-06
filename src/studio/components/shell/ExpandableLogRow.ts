/** Native disclosure keeps full log text accessible without widening the compact list. */
export function createExpandableLogRow() {
  return {
    name: "StudioExpandableLogRow",
    props: {
      entry: {type: Object, required: true},
      rowClass: {type: String, required: true},
      title: {type: String, default: "Log entry"},
      level: String,
      status: String
    },
    computed: {
      json(this: {entry: unknown}) { return JSON.stringify(this.entry, null, 2); }
    },
    template: `
      <details class="bottom-log-entry">
        <summary class="bottom-log-summary" :aria-label="'Details: ' + title" :title="title">
          <span class="bottom-log-disclosure" aria-hidden="true"></span>
          <div :class="rowClass" :data-level="level" :data-status="status"><slot/></div>
        </summary>
        <pre class="bottom-log-details">{{ json }}</pre>
      </details>`
  };
}
