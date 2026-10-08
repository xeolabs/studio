import {createToolPopover} from "../shell/ToolPopover";

/** The canvas selection card and Properties header expose the same effects. */
export function createSelectionEffects(Vue: any) {
  return {
    name: "SelectionEffects", components: {ToolPopover: createToolPopover(Vue)},
    setup() {
      const workspace = Vue.inject("workspace"), commands = Vue.inject("commands");
      return {run: (id: string) => commands.execute(id),
        checked: (id: string) => {void workspace.history.revision; void workspace.selectedObjectDetails; return commands.isChecked(id);}};
    },
    template: `<ToolPopover label="Element effects" stay-open><template #trigger>Effects ▾</template>
      <button type="button" role="menuitemcheckbox" :aria-checked="checked('viewport.toggleVisibility')" @click="run('viewport.toggleVisibility')">Visible</button>
      <button type="button" role="menuitemcheckbox" :aria-checked="checked('viewport.toggleXray')" @click="run('viewport.toggleXray')">X-ray</button>
      <button type="button" role="menuitemcheckbox" :aria-checked="checked('viewport.toggleHighlight')" @click="run('viewport.toggleHighlight')">Highlight</button>
      <hr/><button type="button" role="menuitem" @click="run('viewport.showOnlySelection')">Isolate</button>
    </ToolPopover>`
  };
}
