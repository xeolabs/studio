import type {View} from "@xeokit/sdk/viewing/viewer";
import {AnnualSunPlayer, SunStudy, computeSunPosition} from "../sunStudy";

export interface SunStudyPreset {
  label: string;
  latitude: number;
  longitude: number;
}

export interface SunStudyPanelState {
  presets: SunStudyPreset[];
  presetLabel: string;
  latitude: number;
  longitude: number;
  northAngleDegrees: number;
  date: string;
  minutesUtc: number;
  timeLabel: string;
  altitude: number;
  azimuth: number;
  aboveHorizon: boolean;
  nightExposureFactor: number;
  mode: "day" | "year";
  playing: boolean;
  durationSeconds: number;
}

export interface SunStudyServiceParams {
  view: View;
  state: SunStudyPanelState;
}

const MATCH_TOLERANCE_DEGREES = 0.05;

const SITE_PRESETS: SunStudyPreset[] = [
  {label: "Custom", latitude: 0, longitude: 0},
  {label: "Berlin", latitude: 52.52, longitude: 13.40},
  {label: "London", latitude: 51.51, longitude: -0.13},
  {label: "New York", latitude: 40.71, longitude: -74.01},
  {label: "San Francisco", latitude: 37.77, longitude: -122.42},
  {label: "Vancouver", latitude: 49.28, longitude: -123.12},
  {label: "Sydney", latitude: -33.87, longitude: 151.21},
  {label: "Singapore", latitude: 1.35, longitude: 103.82},
  {label: "Tokyo", latitude: 35.68, longitude: 139.65},
  {label: "Equator", latitude: 0, longitude: 0},
  {label: "Tropic of Cancer", latitude: 23.44, longitude: 0},
  {label: "Tropic of Capricorn", latitude: -23.44, longitude: 0},
  {label: "Arctic Circle", latitude: 66.56, longitude: 0},
  {label: "Antarctic Circle", latitude: -66.56, longitude: 0},
  {label: "Greenwich", latitude: 51.48, longitude: 0}
];

export function createSunStudyPanelState(): SunStudyPanelState {
  const initialDate = new Date(Date.UTC(new Date().getUTCFullYear(), 5, 21, 12, 0, 0));
  return {
    presets: SITE_PRESETS,
    presetLabel: "Greenwich",
    latitude: 51.48,
    longitude: 0,
    northAngleDegrees: 0,
    date: formatDateInput(initialDate),
    minutesUtc: 12 * 60,
    timeLabel: "12:00",
    altitude: 0,
    azimuth: 0,
    aboveHorizon: false,
    nightExposureFactor: 0.15,
    mode: "day",
    playing: false,
    durationSeconds: 8
  };
}

export class SunStudyService {
  private _sunStudy: SunStudy | null = null;
  private _player: AnnualSunPlayer | null = null;

  /** Null until a Sun Study action explicitly activates the tool. */
  get sunStudy(): SunStudy | null { return this._sunStudy; }
  get player(): AnnualSunPlayer | null { return this._player; }

  private readonly _view: View;
  private readonly _state: SunStudyPanelState;
  private readonly _unsubscribers: Array<() => void> = [];
  private _destroyed = false;

  constructor(params: SunStudyServiceParams) {
    this._view = params.view;
    this._state = params.state;
    const position = computeSunPosition(new Date(`${this._state.date}T${this._state.timeLabel}:00Z`),
      this._state.latitude, this._state.longitude);
    this._state.altitude = round(position.altitude, 1);
    this._state.azimuth = round(position.azimuth, 1);
    this._state.aboveHorizon = position.aboveHorizon;
  }

  private _initialize(): void {
    if (this._destroyed) throw new Error("Sun Study has been destroyed");
    if (this._sunStudy) return;
    // Merely constructing the service or restoring its panel must not enable render passes.
    this._applyViewDefaults();
    this._sunStudy = new SunStudy({
      view: this._view,
      latitude: this._state.latitude,
      longitude: this._state.longitude,
      currentDate: `${this._state.date}T${this._state.timeLabel}:00Z`,
      northAngleDegrees: this._state.northAngleDegrees,
      nightExposureFactor: this._state.nightExposureFactor
    });
    this._player = new AnnualSunPlayer({
      sunStudy: this._sunStudy,
      mode: this._state.mode,
      durationSeconds: this._state.durationSeconds
    });
    this._unsubscribers.push(
      this._sunStudy.onChanged.subscribe(() => this._syncFromStudy()),
      this._player.onPlay.subscribe(() => this._syncFromPlayer()),
      this._player.onPause.subscribe(() => this._syncFromPlayer()),
      this._player.onModeChanged.subscribe(() => this._syncFromPlayer())
    );
    this._syncFromStudy();
  }

  private _getStudy(): SunStudy {
    this._initialize();
    return this._sunStudy!;
  }

  private _getPlayer(): AnnualSunPlayer {
    this._initialize();
    return this._player!;
  }

  setPreset(label: string): void {
    const preset = this._state.presets.find((candidate) => candidate.label === label);
    if (!preset) {
      this._state.presetLabel = "";
      return;
    }
    this._getStudy().setLocation(preset.latitude, preset.longitude);
  }

  setLatitude(value: unknown): void {
    const study = this._getStudy();
    study.latitude = clampNumber(value, -90, 90, study.latitude);
  }

  setLongitude(value: unknown): void {
    const study = this._getStudy();
    study.longitude = clampNumber(value, -180, 180, study.longitude);
  }

  setNorthAngle(value: unknown): void {
    const study = this._getStudy();
    study.northAngleDegrees = clampNumber(value, -360, 360, study.northAngleDegrees);
  }

  setDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return;
    }
    const study = this._getStudy();
    const current = study.currentDate;
    const [year, month, day] = value.split("-").map(Number);
    study.setDateMs(Date.UTC(year, month - 1, day, current.getUTCHours(), current.getUTCMinutes(), 0, 0));
  }

  setMinutesUtc(value: unknown): void {
    const minutes = Math.round(clampNumber(value, 0, 1439, this._state.minutesUtc));
    const study = this._getStudy();
    const current = study.currentDate;
    study.setDateMs(Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0
    ));
  }

  setNightExposureFactor(value: unknown): void {
    const study = this._getStudy();
    study.nightExposureFactor = clampNumber(value, 0, 1, study.nightExposureFactor);
  }

  setMode(mode: "day" | "year"): void {
    const player = this._getPlayer();
    player.mode = mode;
    this._state.durationSeconds = mode === "day" ? 8 : 30;
    player.durationSeconds = this._state.durationSeconds;
    this._syncFromPlayer();
  }

  setDurationSeconds(value: unknown): void {
    const player = this._getPlayer();
    const next = clampNumber(value, 1, 120, player.durationSeconds);
    player.durationSeconds = next;
    this._state.durationSeconds = next;
  }

  togglePlayback(): void {
    const player = this._getPlayer();
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
    this._syncFromPlayer();
  }

  destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()?.();
    }
    this._player?.destroy();
    this._sunStudy?.destroy();
  }

  private _syncFromStudy(): void {
    const sunStudy = this._sunStudy;
    if (!sunStudy) return;
    const date = sunStudy.currentDate;
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    const position = sunStudy.sunPosition;
    this._state.latitude = round(sunStudy.latitude, 4);
    this._state.longitude = round(sunStudy.longitude, 4);
    this._state.northAngleDegrees = round(sunStudy.northAngleDegrees, 1);
    this._state.date = formatDateInput(date);
    this._state.minutesUtc = minutes;
    this._state.timeLabel = formatMinutes(minutes);
    this._state.altitude = round(position.altitude, 1);
    this._state.azimuth = round(position.azimuth, 1);
    this._state.aboveHorizon = position.aboveHorizon;
    this._state.nightExposureFactor = round(sunStudy.nightExposureFactor, 2);
    this._state.presetLabel = findMatchingPreset(this._state.presets, sunStudy.latitude, sunStudy.longitude) || "";
    this._view.needsRender();
  }

  private _syncFromPlayer(): void {
    if (!this._player) return;
    this._state.mode = this._player.mode;
    this._state.playing = this._player.playing;
    this._state.durationSeconds = this._player.durationSeconds;
  }

  private _applyViewDefaults(): void {
    const effects = (this._view as any).effects;
    if (effects?.shadows) {
      effects.shadows.enabled = true;
      effects.shadows.contactHardening = true;
      effects.shadows.pcfKernelSize = Math.max(5, effects.shadows.pcfKernelSize || 0);
      effects.shadows.intensity = Math.max(0.35, effects.shadows.intensity || 0);
    }
    if (effects?.sky) {
      effects.sky.enabled = true;
    }
    if (effects?.tonemap) {
      effects.tonemap.enabled = true;
    }
    this._view.needsRender();
  }
}

function findMatchingPreset(presets: SunStudyPreset[], latitude: number, longitude: number): string {
  const match = presets.find((preset) =>
    preset.label !== "Custom" &&
    Math.abs(preset.latitude - latitude) < MATCH_TOLERANCE_DEGREES &&
    Math.abs(preset.longitude - longitude) < MATCH_TOLERANCE_DEGREES
  );
  return match?.label || "";
}

function formatDateInput(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numberValue));
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
