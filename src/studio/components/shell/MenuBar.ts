import type {CommandRegistry} from "../../commands/CommandRegistry";

export interface MenuBarComponentParams {
  commands: CommandRegistry;
  menuSections: any[];
  workspace: any;
}

export function createMenuBarComponent(Vue: any, params: MenuBarComponentParams) {
  return {
    name: "StudioMenuBar",
    setup() {
      const menuDropdowns = Vue.ref([]);
      const mobileMenu = Vue.ref(null as HTMLDivElement | null);
      const mobileMenuTrigger = Vue.ref(null as HTMLButtonElement | null);
      const mobileMenuOpen = Vue.ref(false);
      const announce = () => Vue.nextTick(() => window.dispatchEvent(new Event("studio-overlay-change")));
      const closeMobileMenu = (restoreFocus = true) => {
        if (!mobileMenuOpen.value) return;
        mobileMenuOpen.value = false;
        if (restoreFocus) mobileMenuTrigger.value?.focus({preventScroll: true});
        announce();
      };
      const toggleMobileMenu = () => {
        if (mobileMenuOpen.value) {closeMobileMenu(); return;}
        window.dispatchEvent(new CustomEvent("studio-close-tools"));
        mobileMenuOpen.value = true;
        Vue.nextTick(() => mobileMenu.value?.querySelector("summary")?.focus({preventScroll: true}));
        announce();
      };
      const outside = (event: Event) => {
        const target = event.target as Node;
        if (!mobileMenu.value?.contains(target) && !mobileMenuTrigger.value?.contains(target)) closeMobileMenu(false);
      };
      const otherTool = () => closeMobileMenu(false);
      Vue.watch(() => params.workspace.layoutMode, (mode: string) => {if (mode !== "compact") closeMobileMenu(false);});
      Vue.onMounted(() => {
        document.addEventListener("pointerdown", outside);
        window.addEventListener("studio-close-tools", otherTool);
      });
      Vue.onUnmounted(() => {
        document.removeEventListener("pointerdown", outside);
        window.removeEventListener("studio-close-tools", otherTool);
      });
      const mobileSections = params.menuSections.map(section => ({...section,
        entries: [...(section.items || []), ...(section.groups || []).flatMap((group: any) => group.items)]
          .flatMap((item: any) => item.children || [item])
      }));
      const commandShortcut = (commandId: string) => params.commands.get(commandId)?.shortcut || "";
      const commandEnabled = (commandId: string) => params.commands.isEnabled(commandId);
      const commandVisible = (commandId: string) => params.commands.isVisible(commandId);
      const commandChecked = (commandId: string) => params.commands.isChecked(commandId);
      const commandLabel = (item: {label: string; commandId: string}) => item.label +
        (commandChecked(item.commandId) ? (item.commandId.startsWith("renderer.") ? " (active)" : " (open)") : "");
      const itemEnabled = (item: any) => item.children ? item.children.some((child: any) => itemEnabled(child)) : commandEnabled(item.commandId);
      const itemVisible = (item: any) => item.children ? item.children.some((child: any) => itemVisible(child)) : commandVisible(item.commandId);
      const runCommand = (commandId: string) => {
        for (const dropdown of menuDropdowns.value) dropdown.handleClose?.();
        closeMobileMenu();
        params.commands.execute(commandId);
      };
      return {
        mobileMenu, mobileMenuTrigger, mobileMenuOpen, mobileSections, closeMobileMenu, toggleMobileMenu,
        commandEnabled,
        commandShortcut,
        commandVisible,
        commandChecked,
        commandLabel,
        itemEnabled,
        itemVisible,
        menuSections: params.menuSections,
        menuDropdowns,
        runCommand,
        workspace: params.workspace
      };
    },
    template: `
      <nav class="menu-bar" aria-label="Application menu">
        <div class="menu-bar-left">
          <strong class="studio-product-name">xeokit Studio</strong>
          <template v-if="workspace.layoutMode === 'compact'">
            <button ref="mobileMenuTrigger" type="button" class="mobile-app-menu" :aria-expanded="mobileMenuOpen"
              :aria-controls="mobileMenuOpen ? 'studio-mobile-menu' : undefined" @click="toggleMobileMenu"
              @keydown.esc.stop.prevent="closeMobileMenu()">Menu<span aria-hidden="true">▾</span></button>
            <Teleport to="body">
            <div v-if="mobileMenuOpen" ref="mobileMenu" id="studio-mobile-menu" class="mobile-app-menu-content"
              aria-label="Application menu" role="region" data-plan-label-obstacle @keydown.esc.stop.prevent="closeMobileMenu()">
              <details v-for="section in mobileSections" :key="section.id" class="mobile-menu-section">
                <summary>{{ section.label }}</summary>
                <button v-for="item in section.entries.filter(itemVisible)" :key="item.commandId" type="button"
                  :disabled="!commandEnabled(item.commandId)" @click="runCommand(item.commandId)">
                  <span aria-hidden="true">{{ commandChecked(item.commandId) ? '✓ ' : '' }}</span>{{ item.label }}
                </button>
              </details>
            </div>
            </Teleport>
          </template>
          <template v-else>
          <el-dropdown
            v-for="section in menuSections"
            ref="menuDropdowns"
            :key="section.id"
            trigger="click"
            popper-class="studio-menu-popper"
            @command="runCommand">
            <button type="button" class="menu-bar-button">
              {{ section.label }}
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <template v-if="section.items">
                  <template v-for="item in section.items.filter(itemVisible)" :key="item.commandId || item.label">
                    <el-dropdown
                      v-if="item.children"
                      trigger="click"
                      placement="right-start"
                      popper-class="studio-menu-popper studio-submenu-popper"
                      @command="runCommand">
                      <button type="button" class="studio-submenu-trigger" :disabled="!itemEnabled(item)">
                        <span>{{ item.label }}</span>
                        <span aria-hidden="true">›</span>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item
                            v-for="child in item.children.filter(itemVisible)"
                            :key="child.commandId"
                            :disabled="!itemEnabled(child)"
                            :aria-label="commandLabel(child)"
                            :command="child.commandId">
                            <span class="studio-menu-item-content">
                              <span><span class="studio-menu-check" aria-hidden="true">{{ commandChecked(child.commandId) ? '✓' : '' }}</span>{{ child.label }}</span>
                              <kbd v-if="commandShortcut(child.commandId)">{{ commandShortcut(child.commandId) }}</kbd>
                            </span>
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                    <el-dropdown-item
                      v-else
                      :disabled="!itemEnabled(item)"
                      :aria-label="commandLabel(item)"
                      :command="item.commandId">
                      <span class="studio-menu-item-content">
                        <span><span class="studio-menu-check" aria-hidden="true">{{ commandChecked(item.commandId) ? '✓' : '' }}</span>{{ item.label }}</span>
                        <kbd v-if="commandShortcut(item.commandId)">{{ commandShortcut(item.commandId) }}</kbd>
                      </span>
                    </el-dropdown-item>
                  </template>
                </template>
                <template v-for="(group, groupIndex) in section.groups || []" :key="group.label">
                  <div v-if="section.items || groupIndex > 0" class="menu-bar-section-divider"></div>
                  <template v-for="item in group.items.filter(itemVisible)" :key="item.commandId || item.label">
                    <el-dropdown
                      v-if="item.children"
                      trigger="click"
                      placement="right-start"
                      popper-class="studio-menu-popper studio-submenu-popper"
                      @command="runCommand">
                      <button type="button" class="studio-submenu-trigger" :disabled="!itemEnabled(item)">
                        <span>{{ item.label }}</span>
                        <span aria-hidden="true">›</span>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item
                            v-for="child in item.children.filter(itemVisible)"
                            :key="child.commandId"
                            :disabled="!itemEnabled(child)"
                            :aria-label="commandLabel(child)"
                            :command="child.commandId">
                            <span class="studio-menu-item-content">
                              <span><span class="studio-menu-check" aria-hidden="true">{{ commandChecked(child.commandId) ? '✓' : '' }}</span>{{ child.label }}</span>
                              <kbd v-if="commandShortcut(child.commandId)">{{ commandShortcut(child.commandId) }}</kbd>
                            </span>
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                    <el-dropdown-item
                      v-else
                      :disabled="!itemEnabled(item)"
                      :aria-label="commandLabel(item)"
                      :command="item.commandId">
                      <span class="studio-menu-item-content">
                        <span><span class="studio-menu-check" aria-hidden="true">{{ commandChecked(item.commandId) ? '✓' : '' }}</span>{{ item.label }}</span>
                        <kbd v-if="commandShortcut(item.commandId)">{{ commandShortcut(item.commandId) }}</kbd>
                      </span>
                    </el-dropdown-item>
                  </template>
                </template>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          </template>
        </div>
        <div class="menu-bar-center"></div>
        <div class="menu-bar-right">
          <span class="renderer-live-dot" :data-ready="workspace.loaded && !workspace.rendererSwitching && !workspace.rendererError"></span>
          <span role="status">{{ workspace.rendererError ? 'Renderer error' : workspace.rendererSwitching ? 'Switching…' : workspace.loaded ? workspace.projectName : 'Loading…' }}</span>
        </div>
      </nav>
    `
  };
}
