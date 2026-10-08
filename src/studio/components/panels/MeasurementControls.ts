import {Ruler, Trash2, List, Undo2} from "lucide-vue-next";
import {createToolPopover} from "../shell/ToolPopover";

export function createMeasurementControls(Vue: any) {
  return {
    name: "MeasurementControls",
    components: {ToolPopover: createToolPopover(Vue), Ruler, Trash2, List, Undo2},
    setup() {
      const workspace = Vue.inject("workspace"), commands = Vue.inject("commands");
      const undo = Vue.ref(null), controls = Vue.ref(null);
      const run = (id: string, value?: unknown) => commands.execute(id, value);
      const context = (item: any) => item.floorId
        ? workspace.section.floors.find((floor: any) => floor.id === item.floorId)?.title || item.floorTitle || "Floor plan"
        : "3D distance";
      const locate = (id: string) => {
        run('measurement.locate', id);
        window.dispatchEvent(new CustomEvent('studio-close-tools'));
      };
      const remove = (id?: string) => {
        run(id ? 'measurement.remove' : 'measurement.clear', id);
        window.dispatchEvent(new CustomEvent('studio-close-tools'));
        Vue.nextTick(() => undo.value?.focus({preventScroll: true}));
      };
      const restore = () => {
        run('measurement.undo');
        Vue.nextTick(() => {
          if (!workspace.measurements.undoLabel) controls.value?.querySelector('.tool-popover-trigger')?.focus({preventScroll: true});
        });
      };
      return {workspace, undo, controls, restore, state: workspace.measurements, run, context, locate, remove};
    },
    template: `<div ref="controls" v-if="workspace.toolMode === 'measure' || state.items.length || state.undoLabel" class="measurement-controls tool-surface" data-plan-label-obstacle>
      <template v-if="workspace.toolMode === 'measure'">
        <div class="measurement-heading"><Ruler/><span role="status">{{ state.pending ? 'Choose end point' : 'Choose start point' }}</span>
          <button v-if="state.pending" type="button" title="Cancel point" aria-label="Cancel point" @click="run('measurement.cancel')"><Undo2/></button>
          <button type="button" @click="run('tools.select')">Done</button>
        </div>
        <p class="measurement-help">{{ workspace.section.planFloorId ? 'Horizontal distance' : '3D distance' }} · <span class="measurement-touch-help">Tap or slide to place. Pinch to navigate.</span><span class="measurement-mouse-help">Click two points. Drag to navigate.</span></p>
      </template>
      <div v-if="workspace.toolMode === 'measure' || state.items.length" class="measurement-settings">
        <button v-if="workspace.toolMode === 'measure'" type="button" :aria-pressed="state.snapping" @click="state.snapping = !state.snapping">Snap</button>
        <button v-if="workspace.toolMode === 'measure'" type="button" :aria-pressed="state.lensEnabled" @click="state.lensEnabled = !state.lensEnabled">Lens</button>
        <select aria-label="Measurement units" :value="state.unit" @change="run('measurement.units', $event.target.value)">
          <option value="m">m</option><option value="mm">mm</option><option value="ft">ft</option><option value="in">in</option>
        </select>
        <ToolPopover :label="'Measurements (' + state.items.length + ')'" :disabled="!state.items.length" stay-open>
          <template #trigger><List/><span>{{ state.items.length }}</span></template>
          <button type="button" role="menuitemcheckbox" :aria-checked="state.visible" @click="state.visible = !state.visible">Show measurements</button>
          <div class="measurement-list">
            <div v-for="item in state.items" :key="item.id" class="measurement-row" role="presentation" :data-selected="state.selectedId === item.id">
              <button type="button" role="menuitem" class="measurement-locate" :disabled="workspace.rendererSwitching"
                :aria-label="'Locate measurement ' + item.number + ': ' + item.text + ', ' + context(item)"
                :title="'Locate measurement ' + item.number + ' · ' + context(item)" @click="locate(item.id)">
                <span class="measurement-number">{{ item.number }}</span><span class="measurement-detail">{{ item.text }}<small>{{ context(item) }}</small></span>
              </button>
              <button type="button" role="menuitem" class="measurement-delete" :title="'Delete measurement ' + item.number"
                :aria-label="'Delete measurement ' + item.number" @click.stop="remove(item.id)"><Trash2/></button>
            </div>
          </div>
          <hr/><button type="button" role="menuitem" :disabled="!state.items.length" @click="remove()">Clear all</button>
        </ToolPopover>
        <span v-if="workspace.toolMode === 'measure'" class="measurement-snap">{{ state.snapHint }}</span>
      </div>
      <div v-if="state.undoLabel" class="measurement-undo">
        <span role="status">{{ state.undoLabel === 'Clear measurements' ? 'Measurements cleared' : 'Measurement deleted' }}</span>
        <button ref="undo" type="button" :title="'Undo ' + state.undoLabel.toLowerCase()" :aria-label="'Undo ' + state.undoLabel.toLowerCase()"
          @click="restore"><Undo2/><span>Undo</span></button>
      </div>
    </div>`
  };
}
