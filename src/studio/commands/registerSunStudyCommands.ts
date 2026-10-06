import type {StudioActions} from "../app/types";
import type {CommandRegistry} from "./CommandRegistry";
import {copyText} from "../ui/clipboard";

export interface RegisterSunStudyCommandsParams {
  commands: CommandRegistry;
  openToolWindow?: (panelId: string) => void;
  sunStudyPanelState: any;
  actions: Pick<StudioActions, "sunStudyActions">;
}

export function registerSunStudyCommands(params: RegisterSunStudyCommandsParams): void {
  const state = params.sunStudyPanelState;
  params.commands.register({
    id: "sunStudy.togglePlayback",
    title: "Toggle Sun Study Playback",
    category: "Tools: Sun Study",
    shortcut: "Space",
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.togglePlayback();
    }
  });
  params.commands.register({
    id: "sunStudy.play",
    title: "Play Sun Study",
    category: "Tools: Sun Study",
    enabled: () => !state.playing,
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.togglePlayback();
    }
  });
  params.commands.register({
    id: "sunStudy.pause",
    title: "Pause Sun Study",
    category: "Tools: Sun Study",
    enabled: () => !!state.playing,
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.togglePlayback();
    }
  });
  params.commands.register({
    id: "sunStudy.dayMode",
    title: "Use Sun Study Day Mode",
    category: "Tools: Sun Study",
    enabled: () => state.mode !== "day",
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.setMode("day");
    }
  });
  params.commands.register({
    id: "sunStudy.yearMode",
    title: "Use Sun Study Year Mode",
    category: "Tools: Sun Study",
    enabled: () => state.mode !== "year",
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.setMode("year");
    }
  });
  for (const preset of state.presets || []) {
    if (preset.label === "Custom") {
      continue;
    }
    params.commands.register({
      id: `sunStudy.preset.${commandIdPart(preset.label)}`,
      title: `Set Sun Study Location to ${preset.label}`,
      category: "Tools: Sun Study",
      enabled: () => state.presetLabel !== preset.label,
      run: () => {
        params.openToolWindow?.("sun-study");
        params.actions.sunStudyActions.setPreset(preset.label);
      }
    });
  }
  for (const timePreset of [
    {id: "sunriseish", title: "Set Sun Study Time to 06:00 UTC", minutes: 6 * 60},
    {id: "morning", title: "Set Sun Study Time to 09:00 UTC", minutes: 9 * 60},
    {id: "noon", title: "Set Sun Study Time to 12:00 UTC", minutes: 12 * 60},
    {id: "afternoon", title: "Set Sun Study Time to 15:00 UTC", minutes: 15 * 60},
    {id: "evening", title: "Set Sun Study Time to 18:00 UTC", minutes: 18 * 60},
    {id: "midnight", title: "Set Sun Study Time to 00:00 UTC", minutes: 0}
  ]) {
    params.commands.register({
      id: `sunStudy.time.${timePreset.id}`,
      title: timePreset.title,
      category: "Tools: Sun Study",
      enabled: () => state.minutesUtc !== timePreset.minutes,
      run: () => {
        params.openToolWindow?.("sun-study");
        params.actions.sunStudyActions.setMinutesUtc(timePreset.minutes);
      }
    });
  }
  for (const datePreset of [
    {id: "marchEquinox", title: "Set Sun Study Date to March Equinox", month: "03", day: "20"},
    {id: "juneSolstice", title: "Set Sun Study Date to June Solstice", month: "06", day: "21"},
    {id: "septemberEquinox", title: "Set Sun Study Date to September Equinox", month: "09", day: "22"},
    {id: "decemberSolstice", title: "Set Sun Study Date to December Solstice", month: "12", day: "21"}
  ]) {
    params.commands.register({
      id: `sunStudy.date.${datePreset.id}`,
      title: datePreset.title,
      category: "Tools: Sun Study",
      run: () => {
        params.openToolWindow?.("sun-study");
        const year = String(new Date().getUTCFullYear());
        params.actions.sunStudyActions.setDate(`${year}-${datePreset.month}-${datePreset.day}`);
      }
    });
  }
  params.commands.register({
    id: "sunStudy.resetNorth",
    title: "Reset Sun Study North Angle",
    category: "Tools: Sun Study",
    enabled: () => state.northAngleDegrees !== 0,
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.setNorthAngle(0);
    }
  });
  params.commands.register({
    id: "sunStudy.slower",
    title: "Slow Down Sun Study Playback",
    category: "Tools: Sun Study",
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.setDurationSeconds(Math.min(120, state.durationSeconds + 4));
    }
  });
  params.commands.register({
    id: "sunStudy.faster",
    title: "Speed Up Sun Study Playback",
    category: "Tools: Sun Study",
    run: () => {
      params.openToolWindow?.("sun-study");
      params.actions.sunStudyActions.setDurationSeconds(Math.max(1, state.durationSeconds - 4));
    }
  });
  params.commands.register({
    id: "sunStudy.copyStateJson",
    title: "Copy Sun Study State as JSON",
    category: "Tools: Sun Study",
    run: () => {
      void copyText(JSON.stringify({
        presetLabel: state.presetLabel,
        latitude: state.latitude,
        longitude: state.longitude,
        northAngleDegrees: state.northAngleDegrees,
        date: state.date,
        minutesUtc: state.minutesUtc,
        timeLabel: state.timeLabel,
        altitude: state.altitude,
        azimuth: state.azimuth,
        aboveHorizon: state.aboveHorizon,
        nightExposureFactor: state.nightExposureFactor,
        mode: state.mode,
        playing: state.playing,
        durationSeconds: state.durationSeconds
      }, null, 2));
    }
  });
}

function commandIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
