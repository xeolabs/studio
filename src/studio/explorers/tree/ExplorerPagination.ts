import type {ExplorerIcons} from "./loadExplorerIcons";

/** Bounded collection navigation shared by tree views; page indices are zero-based. */
export function createExplorerPagination(icons: ExplorerIcons) {
  return {
    name: "ExplorerPagination",
    props: {page: {type: Number, required: true}, count: {type: Number, required: true}, size: {type: Number, required: true}},
    emits: ["change"],
    setup() { return {previousIcon: icons.ChevronLeft, nextIcon: icons.ChevronRight}; },
    template: `
      <div class="explorer-pagination" role="group" aria-label="Collection pages" @click.stop>
        <span class="explorer-page-range" aria-live="polite">{{ (page * size + 1).toLocaleString() }}-{{ Math.min((page + 1) * size, count).toLocaleString() }} of {{ count.toLocaleString() }}</span>
        <span class="explorer-page-controls">
          <button type="button" title="Previous page" aria-label="Previous page" :disabled="page === 0" @click="$emit('change', page - 1)">
            <component v-if="previousIcon" :is="previousIcon" :size="14" aria-hidden="true"/><span v-else aria-hidden="true">&lt;</span>
          </button>
          <label>Page <input type="number" min="1" :max="Math.ceil(count / size)" :value="page + 1" aria-label="Collection page"
            @change="$emit('change', Number($event.target.value) - 1)" @keydown.enter="$event.target.blur()"/></label>
          <button type="button" title="Next page" aria-label="Next page" :disabled="(page + 1) * size >= count" @click="$emit('change', page + 1)">
            <component v-if="nextIcon" :is="nextIcon" :size="14" aria-hidden="true"/><span v-else aria-hidden="true">&gt;</span>
          </button>
        </span>
      </div>`
  };
}
