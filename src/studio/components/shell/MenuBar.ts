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
      const rendererLabel = Vue.computed(() => params.workspace.rendererMode === "webgl" ? "WebGL2" : "WebGPU");
      const commandShortcut = (commandId: string) => params.commands.get(commandId)?.shortcut || "";
      const commandEnabled = (commandId: string) => params.commands.isEnabled(commandId);
      const commandVisible = (commandId: string) => params.commands.isVisible(commandId);
      const commandChecked = (commandId: string) => params.commands.isChecked(commandId);
      const commandLabel = (item: {label: string; commandId: string}) => item.label +
        (commandChecked(item.commandId) ? (item.commandId.startsWith("renderer.") ? " (active)" : " (open)") : "");
      const itemEnabled = (item: any) => item.children ? item.children.some((child: any) => itemEnabled(child)) : commandEnabled(item.commandId);
      const itemVisible = (item: any) => item.children ? item.children.some((child: any) => itemVisible(child)) : commandVisible(item.commandId);
      const runCommand = (commandId: string) => {
        params.commands.execute(commandId);
      };
      return {
        commandEnabled,
        commandShortcut,
        commandVisible,
        commandChecked,
        commandLabel,
        itemEnabled,
        itemVisible,
        menuSections: params.menuSections,
        rendererLabel,
        runCommand,
        workspace: params.workspace
      };
    },
    template: `
      <nav class="menu-bar" aria-label="Application menu">
        <div class="menu-bar-left">
          <strong class="studio-product-name">xeokit Studio</strong>
          <el-dropdown
            v-for="section in menuSections"
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
                      trigger="hover"
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
                      trigger="hover"
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
        </div>
        <div class="menu-bar-center">{{ workspace.projectName }}</div>
        <div class="menu-bar-right">
          <span class="renderer-live-dot" :data-ready="workspace.loaded && !workspace.rendererSwitching && !workspace.rendererError"></span>
          <span>{{ workspace.loaded ? rendererLabel : 'Starting...' }}</span>
        </div>
      </nav>
    `
  };
}
