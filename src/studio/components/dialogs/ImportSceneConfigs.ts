import type {ImportActions} from "../../app/types";
import type {ImportDialogState} from "../../services/importDialogState";

export function createImportSceneConfigs(Vue: any) {
  return {
    name: "StudioImportSceneConfigs",
    setup() {
      const state = Vue.inject("importDialogState") as ImportDialogState;
      const actions = Vue.inject("importActions") as ImportActions;
      const fallback = Vue.computed(() => state.bases.find(b => b.id === state.dataSets.find(d => d.id === state.dataSetId)?.defaultBasisId)?.label.split(' (')[0] || 'Scene defaults');
      const summary = Vue.computed(() => state.coordinateMode === "source" ? `Source / ${fallback.value} default · ${state.updateMode}`
        : `${state.bases.find(b => b.id === state.basisId)?.label.split(' (')[0]} · ${state.units} · origin ${state.origin.join(', ')} · ${state.updateMode}`);
      return {state, actions, summary, fallback};
    },
    template: `
      <details class="import-configs">
        <summary><strong>SceneModel Configs</strong><span>{{ summary }}</span></summary>
        <div class="import-config-fields">
          <h3>Coordinate system</h3>
          <el-radio-group v-model="state.coordinateMode" :disabled="state.loading" aria-label="Coordinate system mode">
            <el-radio value="source">Use source settings</el-radio><el-radio value="override">Override source settings</el-radio>
          </el-radio-group>
          <p v-if="state.coordinateMode === 'source'" class="import-secondary">Use embedded coordinates when supplied by the loader. Otherwise assume {{ fallback }}, meters, and origin 0, 0, 0.</p>
          <template v-else>
            <label class="import-form-field"><span>Basis</span><el-select v-model="state.basisId" :disabled="state.loading" aria-label="Coordinate basis">
              <el-option v-for="basis in state.bases" :key="basis.id" :label="basis.label" :value="basis.id"/>
            </el-select></label>
            <label class="import-form-field import-units"><span>Units</span><el-select v-model="state.units" :disabled="state.loading" aria-label="Coordinate units">
              <el-option v-for="unit in state.unitsOptions" :key="unit" :label="unit" :value="unit"/>
            </el-select></label>
            <div class="import-origin-fields"><label v-for="(axis, index) in ['X', 'Y', 'Z']" :key="axis" class="import-form-field"><span>Origin {{ axis }}</span>
              <el-input-number :model-value="state.origin[index]" :disabled="state.loading" controls-position="right" :aria-label="'Origin ' + axis" @change="actions.setOrigin(index, $event)"/>
            </label></div>
          </template>
          <h3 class="import-update-heading">Update mode</h3>
          <el-radio-group v-model="state.updateMode" :disabled="state.loading" aria-label="SceneModel update mode">
            <el-radio-button v-for="mode in state.updateModes" :key="mode.id" :label="mode.id">{{ mode.label }}</el-radio-button>
          </el-radio-group>
          <p class="import-secondary">Static = big models, less runtime updates. Dynamic = smaller models, many runtime updates.</p>
        </div>
      </details>
    `,
  };
}
