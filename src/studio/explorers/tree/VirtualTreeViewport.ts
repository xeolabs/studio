import {treeRowOffsets, virtualTreeRange, type VirtualTreeRow} from "./virtualTreeRange";

/** Vue adapter only; collection paging and persistent node state belong to the caller. */
export function createVirtualTreeViewport(Vue: any) {
  return {
    name: "VirtualTreeViewport",
    props: {rows: {type: Array, required: true}},
    setup(props: {rows: VirtualTreeRow[]}, {expose}: {expose(api: unknown): void}) {
      const element = Vue.shallowRef(null);
      const top = Vue.ref(0), height = Vue.ref(600), measurement = Vue.ref(0);
      const heights = new Map<string, number>();
      const offsets = Vue.computed(() => { measurement.value; return treeRowOffsets(props.rows, heights, 32); });
      const range = Vue.computed(() => virtualTreeRange(offsets.value, top.value, height.value));
      const editing = Vue.ref(null as string | null);
      // Keep one focused form alive when scrolled offscreen, without mounting the intervening rows.
      const visible = Vue.computed(() => {
        const indexes = Array.from({length: range.value.end - range.value.start}, (_, i) => range.value.start + i);
        const pinned = props.rows.findIndex(row => row.id === editing.value);
        if (pinned >= 0 && !indexes.includes(pinned)) indexes.push(pinned);
        indexes.sort((a, b) => a - b);
        let previous = 0;
        return indexes.map(index => {
          const before = offsets.value[index] - previous;
          previous = offsets.value[index + 1];
          return {row: props.rows[index], before, after: offsets.value[props.rows.length] - previous};
        });
      });
      const trackEditor = () => {
        const active = document.activeElement;
        editing.value = active instanceof HTMLElement && element.value?.contains(active) &&
          active.matches('input, select, textarea, [contenteditable="true"]')
          ? active.closest<HTMLElement>('[data-virtual-row]')?.dataset.virtualRow || null : null;
      };
      let observer: ResizeObserver | undefined;
      let frame = 0, disposed = false;
      const measured = new Set<HTMLElement>();
      const readViewport = () => {
        frame = 0;
        if (!element.value) return;
        top.value = element.value.scrollTop;
        height.value = element.value.clientHeight;
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(readViewport); };
      const measureRows = () => {
        if (!observer || !element.value) return;
        const current = new Set<HTMLElement>(element.value.querySelectorAll('[data-virtual-row]'));
        for (const item of measured) if (!current.has(item)) { observer.unobserve(item); measured.delete(item); }
        for (const item of current) if (!measured.has(item)) { observer.observe(item); measured.add(item); }
      };
      const reveal = async (id: string, center = true) => {
        const index = props.rows.findIndex(row => row.id === id);
        if (index < 0 || !element.value || disposed) return;
        const start = offsets.value[index], end = offsets.value[index + 1];
        const viewport = element.value as HTMLElement;
        if (center) viewport.scrollTop = Math.max(0, start - viewport.clientHeight / 2 + (end - start) / 2);
        else if (start < viewport.scrollTop) viewport.scrollTop = start;
        else if (end > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = end - viewport.clientHeight;
        readViewport();
        await Vue.nextTick();
      };
      const focus = async (id: string) => {
        await reveal(id, false);
        if (disposed) return;
        const rows = element.value?.querySelectorAll('[data-node-id]') || [];
        for (const row of rows) if ((row as HTMLElement).dataset.nodeId === id) (row as HTMLElement).focus({preventScroll: true});
      };
      const onKey = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (!target.matches('[data-node-id]')) return;
        const rows = props.rows.filter(row => row.navigable !== false);
        const index = rows.findIndex(row => row.id === target.dataset.nodeId);
        if (index < 0) return;
        const expander = target.querySelector<HTMLButtonElement>('button[aria-label="Expand"], button[aria-label="Collapse"]');
        let destination: string | undefined;
        switch (event.key) {
          case "ArrowDown": destination = rows[Math.min(index + 1, rows.length - 1)]?.id; break;
          case "ArrowUp": destination = rows[Math.max(0, index - 1)]?.id; break;
          case "Home": destination = rows[0]?.id; break;
          case "End": destination = rows[rows.length - 1]?.id; break;
          case "ArrowLeft":
            if (expander?.getAttribute('aria-label') === 'Collapse') return;
            destination = rows[index].parentId; break;
          case "ArrowRight":
            if (expander?.getAttribute('aria-label') !== 'Collapse') return;
            if (rows[index + 1]?.parentId === rows[index].id) destination = rows[index + 1].id;
            break;
          default: return;
        }
        event.preventDefault(); event.stopPropagation();
        if (destination) void focus(destination);
      };
      Vue.onMounted(() => {
        observer = new ResizeObserver(entries => {
          let changed = false;
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const id = target.dataset.virtualRow;
            const size = target.getBoundingClientRect().height;
            if (id && size > 0 && heights.get(id) !== size) { heights.set(id, size); changed = true; }
          }
          if (changed) measurement.value++;
          schedule();
        });
        observer.observe(element.value);
        readViewport(); measureRows();
      });
      Vue.watch(visible, () => Vue.nextTick(measureRows));
      Vue.watch(() => props.rows, () => {
        const ids = new Set(props.rows.map(row => row.id));
        for (const id of heights.keys()) if (!ids.has(id)) heights.delete(id);
        Vue.nextTick(readViewport);
      });
      Vue.onBeforeUnmount(() => { disposed = true; observer?.disconnect(); if (frame) cancelAnimationFrame(frame); });
      expose({reveal});
      return {element, visible, schedule, onKey, trackEditor};
    },
    template: `
      <ul ref="element" role="tree" data-virtual-tree @scroll.passive="schedule" @keydown.capture="onKey"
        @focusin="trackEditor" @focusout="trackEditor" style="overflow-anchor: none;">
        <template v-for="item in visible" :key="item.row.id">
          <li v-if="item.before" role="none" aria-hidden="true" :style="{height: item.before + 'px', padding: 0, margin: 0}"></li>
          <li :data-virtual-row="item.row.id" role="none"><slot :row="item.row"/></li>
        </template>
        <li role="none" aria-hidden="true" :style="{height: (visible[visible.length - 1]?.after || 0) + 'px', padding: 0, margin: 0}"></li>
      </ul>`
  };
}
