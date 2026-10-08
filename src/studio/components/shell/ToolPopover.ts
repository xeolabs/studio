let sequence = 0;

/** Click/tap flyout with keyboard navigation, focus return and canvas-safe placement. */
export function createToolPopover(Vue: any) {
  return {
    name: "ToolPopover",
    props: {label: String, active: Boolean, disabled: Boolean, stayOpen: Boolean},
    setup(props: any) {
      const open = Vue.ref(false), trigger = Vue.ref(null), menu = Vue.ref(null), position = Vue.ref({});
      const id = `studio-tool-menu-${++sequence}`;
      const announce = () => window.dispatchEvent(new Event("studio-overlay-change"));
      const place = () => {
        if (!trigger.value || !menu.value) return;
        const anchor = trigger.value.getBoundingClientRect(), rect = menu.value.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
        let x = anchor.left, y = anchor.bottom + 8;
        if (anchor.bottom + rect.height + 16 > top + height) y = anchor.top - rect.height - 8;
        // A vertical rail opens beside its trigger.
        if (trigger.value.closest('.workspace-toolbar')?.getBoundingClientRect().width < 100) {
          x = anchor.right + 8; y = anchor.top;
        }
        position.value = {left: Math.max(left + 8, Math.min(x, left + width - rect.width - 8)) + "px",
          top: Math.max(top + 8, Math.min(y, top + height - rect.height - 8)) + "px"};
        announce();
      };
      const close = (focus = false) => {
        if (!open.value) return;
        open.value = false;
        if (focus) trigger.value?.focus({preventScroll: true});
        Vue.nextTick(announce);
      };
      const items = () => Array.from(menu.value?.querySelectorAll('button:not(:disabled), select:not(:disabled)') || []) as HTMLElement[];
      const toggle = async () => {
        if (open.value) {close(true); return;}
        window.dispatchEvent(new CustomEvent('studio-close-tools', {detail: id}));
        open.value = true;
        await Vue.nextTick(); place(); items()[0]?.focus({preventScroll: true});
      };
      const outside = (event: Event) => {
        if (!trigger.value?.contains(event.target) && !menu.value?.contains(event.target)) close();
      };
      const other = (event: CustomEvent) => {if (event.detail !== id) close();};
      const key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(true);}
        else if (event.key === 'Tab') close();
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target as HTMLElement).tagName !== 'SELECT') {
          event.preventDefault();
          const all = items(), index = all.indexOf(document.activeElement as HTMLElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
          all[next]?.focus();
        }
      };
      Vue.onMounted(() => {
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('studio-close-tools', other as EventListener);
        window.addEventListener('resize', place);
      });
      Vue.onUnmounted(() => {
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('studio-close-tools', other as EventListener);
        window.removeEventListener('resize', place);
        announce();
      });
      return {open, trigger, menu, position, id, toggle, key,
        chosen: (event: MouseEvent) => {if (!props.stayOpen && (event.target as HTMLElement).closest('button')) close(true);}};
    },
    template: `<button ref="trigger" type="button" class="tool-popover-trigger" :title="label" :aria-label="label"
      aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? id : undefined" :aria-pressed="active"
      :disabled="disabled" @click="toggle" @keydown.down.prevent="!open && toggle()"><slot name="trigger"/></button>
      <Teleport to="body"><div v-if="open" ref="menu" :id="id" class="studio-tool-flyout" :style="position" role="menu"
        :aria-label="label" data-plan-label-obstacle @keydown="key" @click="chosen"><slot/></div></Teleport>`
  };
}
