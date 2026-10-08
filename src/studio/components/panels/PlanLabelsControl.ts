import {createToolPopover} from "../shell/ToolPopover";

export function createPlanLabelsControl(Vue: any) {
  return {
    name: "PlanLabelsControl",
    components: {ToolPopover: createToolPopover(Vue)},
    setup() {
      const workspace = Vue.inject("workspace"), commands = Vue.inject("commands");
      return {state: workspace.section, choices: [
        {value: "sparse", title: "Sparse"}, {value: "balanced", title: "Balanced"}, {value: "dense", title: "Dense"}
      ], choose: (value: string) => commands.execute("section.labelDensity", value)};
    },
    template: `<ToolPopover label="Plan labels" :active="state.labelsEnabled">
      <template #trigger>Labels <span aria-hidden="true">▾</span></template>
      <button type="button" role="menuitemradio" :aria-checked="!state.labelsEnabled" @click="choose('off')">Off</button>
      <hr/>
      <p class="tool-help">Label density</p>
      <button v-for="choice in choices" :key="choice.value" type="button" role="menuitemradio"
        :aria-checked="state.labelsEnabled && state.labelDensity === choice.value" @click="choose(choice.value)">{{ choice.title }}</button>
      <p class="tool-help">Zoom in to make room for more labels. Overlapping labels stay hidden.</p>
    </ToolPopover>`
  };
}
