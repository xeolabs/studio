import {createPlanLabelsControl} from "./PlanLabelsControl";

export function createSectionPanel(Vue: any) {
  return {
    name: "StudioSectionPanel",
    components: {PlanLabelsControl: createPlanLabelsControl(Vue)},
    setup() {
      const workspace = Vue.inject("workspace") as any, commands = Vue.inject("commands") as any;
      const floorId = Vue.ref("");
      const run = (id: string, value?: unknown) => commands.execute(`section.${id}`, value);
      Vue.onMounted(() => run("refresh"));
      Vue.watch(() => [workspace.section.planFloorId, workspace.section.floors], () => {
        if (workspace.section.planFloorId) floorId.value = workspace.section.planFloorId;
        else if (!workspace.section.floors.some((floor: any) => floor.id === floorId.value)) floorId.value = workspace.section.floors[0]?.id || "";
      }, {immediate: true});
      return {state: workspace.section, floorId, run};
    },
    template: `
      <section class="studio-panel section-panel" aria-label="Section and floor plan">
        <div class="section-controls">
          <h2>Section</h2>
          <p v-if="state.planFloorId">Adjust the cut height to see this floor's interior.</p>
          <p v-else>Cut through the model to see inside.</p>
          <div v-if="!state.planFloorId" class="section-buttons" role="group" aria-label="Cut direction">
            <button type="button" :aria-pressed="state.enabled && state.orientation === 'horizontal'" @click="run('orientation', 'horizontal')">Horizontal</button>
            <button type="button" :aria-pressed="state.enabled && state.orientation === 'vertical'" @click="run('orientation', 'vertical')">Vertical</button>
          </div>
          <label v-if="!state.planFloorId && state.orientation === 'vertical'" class="section-select">Direction
            <select :value="state.verticalAxis" @change="run('axis', $event.target.value)">
              <option value="front">Front to back</option><option value="side">Side to side</option>
            </select>
          </label>
          <div v-if="state.planFloorId" class="section-buttons" role="group" aria-label="Plan appearance">
            <PlanLabelsControl/>
            <button type="button" :aria-pressed="state.planStyle" @click="run('style')">Outlines</button>
          </div>
          <p v-if="state.planFloorId && state.labelsEnabled">Zoom in to make room for more labels.</p>
          <label v-if="state.planFloorId" class="section-slider">
            <span>Above floor <output>{{ state.planCutHeight.toFixed(2) }} m</output></span>
            <input type="range" aria-label="Cut height above floor" :aria-valuetext="state.planCutHeight.toFixed(2) + ' metres above floor'"
              min="0.1" max="5" step="0.05" :value="state.planCutHeight" @input="run('planHeight', $event.target.value)"/>
          </label>
          <label v-else class="section-slider">
            <span>{{ state.orientation === 'horizontal' ? 'Cut height' : 'Cut position' }} <output>{{ state.position }}%</output></span>
            <input type="range" :aria-label="state.orientation === 'horizontal' ? 'Cut height' : 'Cut position'" :aria-valuetext="state.position + '%'" min="0" max="100" step="1" :value="state.position" @input="run('position', $event.target.value)"/>
          </label>
          <div class="section-buttons">
            <button type="button" :disabled="!state.enabled" :aria-pressed="state.flipped" @click="run('flip')">Flip</button>
            <button type="button" :disabled="!state.enabled" @click="run('clear')">Clear</button>
            <span v-if="!state.enabled" class="section-hint">No cut</span>
          </div>
        </div>
        <div class="section-controls">
          <h2>Floor plan</h2>
          <p v-if="!state.floors.length">No floors with geometry found in this model.</p>
          <template v-else>
            <label class="section-select">Floor
              <select v-model="floorId"><option v-for="floor in state.floors" :key="floor.id" :value="floor.id">{{ floor.title }}</option></select>
            </label>
            <div class="section-buttons">
              <button type="button" :disabled="!floorId" @click="run('floorPlan', floorId)">View plan</button>
              <button v-if="state.planFloorId" type="button" @click="run('return3D')">Return to 3D</button>
            </div>
            <p v-if="state.planFloorId">Drag to pan. Pinch or scroll to zoom.</p>
          </template>
        </div>
        <p v-if="state.error" role="alert">{{ state.error }}</p>
      </section>
    `
  };
}
