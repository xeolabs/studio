import {ContextMenuService, type StudioContextMenuItem} from "../../services/ContextMenuService";

export interface ContextMenuLayerComponentParams {
  contextMenuService: ContextMenuService;
  contextMenuState: any;
}

export function createContextMenuLayerComponent(Vue: any, params: ContextMenuLayerComponentParams) {
  return {
    name: "StudioContextMenuLayer",
    setup() {
      const contextMenuLayer = Vue.ref(null) as {value: HTMLElement | null};
      const contextMenuTarget = Vue.shallowRef(document.body);
      let returnFocus: HTMLElement | null = null;
      const close = (restoreFocus = true) => {
        params.contextMenuService.close();
        if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
        returnFocus = null;
      };
      const runContextMenuItem = (item: StudioContextMenuItem) => {
        if (item.type === "separator" || item.enabled === false) {
          return;
        }
        close();
        void item.action();
      };
      const repositionContextMenu = () => {
        if (!params.contextMenuState.open) {
          return;
        }
        Vue.nextTick(() => {
          const element = contextMenuLayer.value;
          if (!element) {
            return;
          }
          const margin = 8;
          const rect = element.getBoundingClientRect();
          params.contextMenuState.x = Math.max(margin, Math.min(params.contextMenuState.x, window.innerWidth - rect.width - margin));
          params.contextMenuState.y = Math.max(margin, Math.min(params.contextMenuState.y, window.innerHeight - rect.height - margin));
        });
      };
      Vue.watch(() => params.contextMenuState.items, () => {
        if (!params.contextMenuState.open) return;
        // Tool panels are nonmodal; menus share the page overlay layer.
        contextMenuTarget.value = document.body;
        if (!contextMenuLayer.value?.contains(document.activeElement)) {
          returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        repositionContextMenu();
        Vue.nextTick(() => contextMenuLayer.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({preventScroll: true}));
      });
      Vue.onMounted(() => {
        const onPointerDown = (event: PointerEvent) => {
          if (!params.contextMenuState.open || contextMenuLayer.value?.contains(event.target as Node)) {
            return;
          }
          close(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (!params.contextMenuState.open) return;
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const buttons = Array.from(contextMenuLayer.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }
        };
        const onViewportChange = (event: Event) => {
          if (!event.isTrusted || (event.target instanceof Node && contextMenuLayer.value?.contains(event.target))) {
            return;
          }
          close();
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);
        Vue.onUnmounted(() => {
          window.removeEventListener("pointerdown", onPointerDown, true);
          window.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("resize", onViewportChange);
          window.removeEventListener("scroll", onViewportChange, true);
        });
      });
      return {
        contextMenuTarget,
        contextMenuLayer,
        contextMenuState: params.contextMenuState,
        runContextMenuItem
      };
    },
    template: `
      <Teleport :to="contextMenuTarget">
      <div
        v-if="contextMenuState.open"
        ref="contextMenuLayer"
        class="studio-context-menu"
        role="menu"
        :style="{ left: contextMenuState.x + 'px', top: contextMenuState.y + 'px' }"
        @contextmenu.prevent
        @pointerdown.stop>
        <template v-for="item in contextMenuState.items" :key="item.id">
          <div v-if="item.type === 'separator'" class="studio-context-menu-separator" role="separator"></div>
          <button
            v-else
            type="button"
            class="studio-context-menu-item"
            role="menuitem"
            :disabled="item.enabled === false"
            @click="runContextMenuItem(item)">
            <span class="studio-context-menu-icon">{{ item.icon || '' }}</span>
            <span class="studio-context-menu-label">{{ item.label }}</span>
            <span v-if="item.checked" class="studio-context-menu-check">✓</span>
            <span v-if="item.shortcut" class="studio-context-menu-shortcut">{{ item.shortcut }}</span>
          </button>
        </template>
      </div>
      </Teleport>
    `
  };
}
