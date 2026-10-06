export function createSunStudyPanel(Vue: any) {
  return {
    name: "StudioSunStudyPanel",
    setup() {
      const state = Vue.inject("sunStudyPanelState") as any;
      const actions = Vue.inject("sunStudyActions") as any;
      const commands = Vue.inject("commands") as any;
      const daylightLabel = Vue.computed(() => state.aboveHorizon ? "Above horizon" : "Below horizon");
      const runCommand = (commandId: string) => commands.execute(commandId);
      return {actions, daylightLabel, runCommand, state};
    },
    template: `
      <section class="studio-panel sun-study-panel" aria-label="Sun study">
        <header class="sun-study-toolbar">
          <div>
            <h1>Sun Study</h1>
            <p>{{ daylightLabel }} · alt {{ state.altitude.toFixed(1) }}° · az {{ state.azimuth.toFixed(1) }}°</p>
          </div>
          <el-button size="small" type="primary" class="sun-study-play" @click="runCommand('sunStudy.togglePlayback')">
            {{ state.playing ? 'Pause' : 'Play' }}
          </el-button>
        </header>
        <section class="sun-study-card">
          <h2>Site</h2>
          <label>
            <span>Preset</span>
            <el-select :model-value="state.presetLabel" size="small" @change="actions.setPreset($event)">
              <el-option label="Custom" value=""/>
              <el-option
                v-for="preset in state.presets.filter(p => p.label !== 'Custom')"
                :key="preset.label"
                :label="preset.label"
                :value="preset.label"/>
            </el-select>
          </label>
          <div class="sun-study-grid three">
            <label>
              <span>Latitude</span>
              <el-input-number size="small" controls-position="right" :min="-90" :max="90" :step="0.01" :model-value="state.latitude" @change="actions.setLatitude($event)"/>
            </label>
            <label>
              <span>Longitude</span>
              <el-input-number size="small" controls-position="right" :min="-180" :max="180" :step="0.01" :model-value="state.longitude" @change="actions.setLongitude($event)"/>
            </label>
            <label>
              <span>North</span>
              <el-input-number size="small" controls-position="right" :min="-360" :max="360" :step="1" :model-value="state.northAngleDegrees" @change="actions.setNorthAngle($event)"/>
            </label>
          </div>
        </section>
        <section class="sun-study-card">
          <h2>Cursor</h2>
          <label>
            <span>Date</span>
            <el-date-picker
              :model-value="state.date"
              type="date"
              size="small"
              value-format="YYYY-MM-DD"
              @change="actions.setDate($event)"/>
          </label>
          <label>
            <span>Time UTC</span>
            <el-slider :model-value="state.minutesUtc" :min="0" :max="1439" :step="1" @input="actions.setMinutesUtc($event)"/>
            <strong>{{ state.timeLabel }}</strong>
          </label>
        </section>
        <section class="sun-study-card">
          <h2>Playback</h2>
          <el-radio-group
            class="sun-study-segmented"
            :model-value="state.mode"
            size="small"
            @change="actions.setMode($event)">
            <el-radio-button value="day">Day</el-radio-button>
            <el-radio-button value="year">Year</el-radio-button>
          </el-radio-group>
          <label>
            <span>Duration</span>
            <el-slider :model-value="state.durationSeconds" :min="1" :max="120" :step="1" @input="actions.setDurationSeconds($event)"/>
            <strong>{{ state.durationSeconds.toFixed(0) }} s</strong>
          </label>
        </section>
        <section class="sun-study-readouts">
          <article>
            <span>Altitude</span>
            <strong>{{ state.altitude.toFixed(1) }}°</strong>
          </article>
          <article>
            <span>Azimuth</span>
            <strong>{{ state.azimuth.toFixed(1) }}°</strong>
          </article>
          <article>
            <span>Night Exposure</span>
            <strong>{{ state.nightExposureFactor.toFixed(2) }}</strong>
          </article>
        </section>
        <section class="sun-study-card">
          <h2>Night</h2>
          <label>
            <span>Exposure</span>
            <el-slider :model-value="state.nightExposureFactor" :min="0" :max="1" :step="0.01" @input="actions.setNightExposureFactor($event)"/>
            <strong>{{ state.nightExposureFactor.toFixed(2) }}</strong>
          </label>
        </section>
      </section>
    `
  };
}
