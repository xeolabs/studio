import type {CommandRegistry, StudioCommand} from "../../commands/CommandRegistry";

export interface CommandPaletteComponentParams {
  commands: CommandRegistry;
  workspace: any;
}

export function createCommandPaletteComponent(Vue: any, params: CommandPaletteComponentParams) {
  return {
    name: "StudioCommandPalette",
    setup() {
      const query = Vue.ref("");
      const activeIndex = Vue.ref(0);
      const inputRef = Vue.ref(null as HTMLInputElement | null);
      const commands = Vue.computed(() => params.commands.list({visibleOnly: true}));
      const filteredCommands = Vue.computed(() => {
        const search = normalize(query.value);
        const baseCommands = commands.value.filter((command) => command.id !== "studio.commandPalette");
        if (!search) {
          const recentCommands = params.commands.recent(8).filter((command) => command.id !== "studio.commandPalette");
          const recentIds = new Set(recentCommands.map((command) => command.id));
          return [...recentCommands, ...baseCommands.filter((command) => !recentIds.has(command.id))].slice(0, 80);
        }
        const values = baseCommands
          .map((command) => ({command, score: scoreCommand(command, search)}))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || (a.command.category || "").localeCompare(b.command.category || "") || a.command.title.localeCompare(b.command.title))
          .map((entry) => entry.command);
        return values.slice(0, 80);
      });
      const groupedCommands = Vue.computed(() => {
        const groups: Array<{category: string; label: string; detail: string; commands: StudioCommand[]}> = [];
        const search = normalize(query.value);
        const recentCommands = search ? [] : params.commands.recent(8).filter((command) => command.id !== "studio.commandPalette");
        if (recentCommands.length > 0) {
          groups.push({
            category: "Recent",
            label: "Recent",
            detail: "Last used",
            commands: recentCommands
          });
        }
        const recentIds = new Set(recentCommands.map((command) => command.id));
        let current: {category: string; label: string; detail: string; commands: StudioCommand[]} | null = null;
        for (const command of filteredCommands.value) {
          if (recentIds.has(command.id)) {
            continue;
          }
          const category = command.category || "Commands";
          if (!current || current.category !== category) {
            current = {category, ...formatCategory(category), commands: []};
            groups.push(current);
          }
          current.commands.push(command);
        }
        return groups;
      });
      const open = Vue.computed({
        get: () => params.workspace.commandPaletteOpen,
        set: (value: boolean) => params.workspace.setCommandPaletteOpen(value)
      });
      const enabled = (command: StudioCommand) => params.commands.isEnabled(command.id);
      const badge = (command: StudioCommand) => commandBadge(command, params.commands.isEnabled(command.id));
      const close = () => {
        params.workspace.setCommandPaletteOpen(false);
      };
      const run = (command: StudioCommand) => {
        if (!enabled(command)) {
          return;
        }
        close();
        params.commands.execute(command.id);
      };
      const runActive = () => {
        const command = filteredCommands.value[activeIndex.value];
        if (command) {
          run(command);
        }
      };
      const moveActive = (delta: number) => {
        const count = filteredCommands.value.length;
        if (count === 0) {
          activeIndex.value = 0;
          return;
        }
        activeIndex.value = (activeIndex.value + delta + count) % count;
      };
      const indexOf = (command: StudioCommand) => filteredCommands.value.indexOf(command);
      Vue.watch(open, (isOpen: boolean) => {
        if (isOpen) {
          query.value = "";
          activeIndex.value = 0;
          requestAnimationFrame(() => inputRef.value?.focus());
        }
      });
      Vue.watch(filteredCommands, () => {
        activeIndex.value = Math.min(activeIndex.value, Math.max(0, filteredCommands.value.length - 1));
      });
      return {activeIndex, badge, enabled, groupedCommands, indexOf, inputRef, moveActive, open, query, run, runActive};
    },
    template: `
      <el-dialog
        v-model="open"
        class="studio-command-palette-dialog"
        append-to-body
        :show-close="false"
        width="min(720px, calc(100vw - 48px))">
        <section class="command-palette" aria-label="Command palette">
          <label class="command-palette-search">
            <span>Command</span>
            <input
              ref="inputRef"
              v-model="query"
              type="search"
              autocomplete="off"
              placeholder="Search commands"
              @keydown.enter.prevent="runActive"
              @keydown.down.prevent="moveActive(1)"
              @keydown.up.prevent="moveActive(-1)"/>
          </label>
          <section v-if="groupedCommands.length > 0" class="command-palette-list">
            <template v-for="group in groupedCommands" :key="group.category">
              <h2>
                <span>{{ group.label }}</span>
                <small>{{ ' - ' + group.detail + ' · ' + group.commands.length }}</small>
              </h2>
              <button
                v-for="command in group.commands"
                :key="command.id"
                type="button"
                class="command-palette-item"
                :data-active="indexOf(command) === activeIndex ? 'true' : 'false'"
                :disabled="!enabled(command)"
                @mouseenter="activeIndex = indexOf(command)"
                @click="run(command)">
                <span class="command-palette-title">
                  <span>{{ command.title }}</span>
                  <em>{{ badge(command) }}</em>
                </span>
                <code>{{ command.id }}</code>
                <kbd v-if="command.shortcut">{{ command.shortcut }}</kbd>
              </button>
            </template>
          </section>
          <p v-else class="command-palette-empty">No commands match the current filter.</p>
        </section>
      </el-dialog>
    `
  };
}

function formatCategory(category: string): {label: string; detail: string} {
  const parts = category.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {label: "Commands", detail: "Studio"};
  }
  if (parts.length === 1) {
    return {label: parts[0], detail: "Commands"};
  }
  return {label: parts[parts.length - 1], detail: parts.slice(0, -1).join(" / ")};
}

function searchableText(command: StudioCommand): string {
  return normalize(`${command.title} ${command.category || ""} ${command.id} ${command.shortcut || ""}`);
}

function scoreCommand(command: StudioCommand, search: string): number {
  if (!search) {
    return 1;
  }
  const title = normalize(command.title);
  const category = normalize(command.category || "");
  const id = normalize(command.id);
  const full = searchableText(command);
  if (title === search || id === search) {
    return 1000;
  }
  if (title.startsWith(search)) {
    return 800;
  }
  if (id.startsWith(search)) {
    return 700;
  }
  if (category.includes(search)) {
    return 520;
  }
  if (title.includes(search)) {
    return 500;
  }
  if (id.includes(search)) {
    return 420;
  }
  const fuzzy = fuzzyScore(full, search);
  return fuzzy > 0 ? 120 + fuzzy : 0;
}

function fuzzyScore(text: string, search: string): number {
  let textIndex = 0;
  let score = 0;
  for (const character of search) {
    const foundIndex = text.indexOf(character, textIndex);
    if (foundIndex === -1) {
      return 0;
    }
    score += foundIndex === textIndex ? 8 : 2;
    textIndex = foundIndex + 1;
  }
  return score;
}

function commandBadge(command: StudioCommand, enabled: boolean): string {
  if (!enabled) {
    return "Unavailable";
  }
  const category = command.category || "";
  if (category.includes(":")) {
    return category.split(":").pop()!.trim();
  }
  return category || "Command";
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
