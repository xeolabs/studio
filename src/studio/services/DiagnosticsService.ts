import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {Viewer} from "@xeokit/sdk/viewing/viewer";
import type {Renderer} from "@xeokit/sdk/viewing/rendering";

export type DiagnosticSource = "scene" | "data" | "viewer" | "renderer" | "app";
export type DiagnosticLevel = "error" | "warning";

export interface DiagnosticEntry {
  id: number;
  timestamp: string;
  source: DiagnosticSource;
  eventName: string;
  level: DiagnosticLevel;
  message: string;
  details: unknown[];
}

export interface DiagnosticSourceSummary {
  source: DiagnosticSource;
  errors: number;
  warnings: number;
  total: number;
}

export interface DiagnosticsPanelState {
  entries: DiagnosticEntry[];
  sourceSummaries: DiagnosticSourceSummary[];
  errors: number;
  warnings: number;
  copied: boolean;
  maxEntries: number;
}

export interface DiagnosticsServiceParams {
  scene: Scene;
  data: Data;
  viewer: Viewer;
  renderer: Renderer;
  state: DiagnosticsPanelState;
}

const SOURCES: DiagnosticSource[] = ["scene", "data", "viewer", "renderer", "app"];
const CHATTER_EVENTS = new Set(["onTick", "onViewRendered", "onCameraViewMatrixUpdated"]);

export function createDiagnosticsPanelState(): DiagnosticsPanelState {
  return {
    entries: [],
    sourceSummaries: SOURCES.map((source) => ({source, errors: 0, warnings: 0, total: 0})),
    errors: 0,
    warnings: 0,
    copied: false,
    maxEntries: 500
  };
}

export class DiagnosticsService {
  private readonly _scene: Scene;
  private readonly _data: Data;
  private readonly _viewer: Viewer;
  private readonly _state: DiagnosticsPanelState;
  private readonly _unsubscribers: Array<() => void> = [];
  private _renderer: Renderer;
  private _nextId = 1;
  private _copyTimer: number | null = null;

  constructor(params: DiagnosticsServiceParams) {
    this._scene = params.scene;
    this._data = params.data;
    this._viewer = params.viewer;
    this._renderer = params.renderer;
    this._state = params.state;
    this._subscribeCore();
    this._subscribeRenderer(params.renderer);
  }

  setRenderer(renderer: Renderer): void {
    this._removeRendererSubscriptions();
    this._renderer = renderer;
    this._subscribeRenderer(renderer);
  }

  record(source: DiagnosticSource, eventName: string, level: DiagnosticLevel, message: string, details: unknown[] = []): void {
    const entry: DiagnosticEntry = {
      id: this._nextId++,
      timestamp: new Date().toISOString(),
      source,
      eventName,
      level,
      message,
      details: details.map((detail) => toJsonSafeValue(detail))
    };
    this._state.entries.unshift(entry);
    if (this._state.entries.length > this._state.maxEntries) {
      this._state.entries.splice(this._state.maxEntries);
    }
    this._refreshSummaries();
  }

  clear(): void {
    this._state.entries.splice(0, this._state.entries.length);
    this._refreshSummaries();
  }

  copyJson(entry?: DiagnosticEntry): Promise<void> {
    const json = JSON.stringify(entry ? entry : this.toJSON(), null, 2);
    const copied = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(json)
      : Promise.resolve();
    return copied.then(() => {
      this._state.copied = true;
      if (this._copyTimer !== null) {
        window.clearTimeout(this._copyTimer);
      }
      this._copyTimer = window.setTimeout(() => {
        this._state.copied = false;
        this._copyTimer = null;
      }, 1200);
    });
  }

  toJSON(): unknown {
    return {
      generatedAt: new Date().toISOString(),
      counts: {
        errors: this._state.errors,
        warnings: this._state.warnings,
        total: this._state.entries.length
      },
      sources: this._state.sourceSummaries,
      entries: this._state.entries
    };
  }

  destroy(): void {
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()?.();
    }
    if (this._copyTimer !== null) {
      window.clearTimeout(this._copyTimer);
      this._copyTimer = null;
    }
  }

  private _subscribeCore(): void {
    this._subscribeHub("scene", (this._scene as any).events);
    this._subscribeHub("data", (this._data as any).events);
    this._subscribeHub("viewer", (this._viewer as any).events);
  }

  private _subscribeRenderer(renderer: Renderer): void {
    const before = this._unsubscribers.length;
    this._subscribeHub("renderer", (renderer as any).events);
    this._rendererSubscriptionStart = before;
  }

  private _rendererSubscriptionStart = 0;

  private _removeRendererSubscriptions(): void {
    const rendererUnsubs = this._unsubscribers.splice(this._rendererSubscriptionStart);
    while (rendererUnsubs.length > 0) {
      rendererUnsubs.pop()?.();
    }
  }

  private _subscribeHub(source: DiagnosticSource, events: Record<string, unknown> | undefined): void {
    if (!events) {
      return;
    }
    for (const eventName of Object.keys(events)) {
      if (CHATTER_EVENTS.has(eventName)) {
        continue;
      }
      const event = events[eventName] as {subscribe?: (callback: (...args: unknown[]) => void) => (() => void) | {unsubscribe?: () => void}} | undefined;
      if (!event || typeof event.subscribe !== "function") {
        continue;
      }
      try {
        const unsubscribe = event.subscribe((...args: unknown[]) => {
          const level = inferLevel(eventName, args);
          if (!level) {
            return;
          }
          this.record(source, eventName, level, summarizeEvent(eventName, args), args);
        });
        if (typeof unsubscribe === "function") {
          this._unsubscribers.push(unsubscribe);
        } else if (unsubscribe && typeof unsubscribe.unsubscribe === "function") {
          this._unsubscribers.push(() => unsubscribe.unsubscribe?.());
        }
      } catch (error) {
        this.record(source, "diagnostics.subscribeFailed", "warning", `Unable to subscribe to ${source}.${eventName}`, [String(error)]);
      }
    }
  }

  private _refreshSummaries(): void {
    let errors = 0;
    let warnings = 0;
    const bySource = new Map<DiagnosticSource, DiagnosticSourceSummary>();
    for (const source of SOURCES) {
      bySource.set(source, {source, errors: 0, warnings: 0, total: 0});
    }
    for (const entry of this._state.entries) {
      if (entry.level === "error") {
        errors++;
      } else {
        warnings++;
      }
      const summary = bySource.get(entry.source);
      if (summary) {
        if (entry.level === "error") {
          summary.errors++;
        } else {
          summary.warnings++;
        }
        summary.total++;
      }
    }
    this._state.errors = errors;
    this._state.warnings = warnings;
    this._state.sourceSummaries.splice(0, this._state.sourceSummaries.length, ...SOURCES.map((source) => bySource.get(source)!));
  }
}

function inferLevel(eventName: string, args: unknown[]): DiagnosticLevel | null {
  const lower = eventName.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("failure")) {
    return "error";
  }
  if (lower.includes("warning") || lower.includes("warn")) {
    return "warning";
  }
  for (const arg of args) {
    const value = arg as {ok?: unknown; error?: unknown; warning?: unknown};
    if (value && typeof value === "object") {
      if (value.ok === false || value.error !== undefined) {
        return "error";
      }
      if (value.warning !== undefined) {
        return "warning";
      }
    }
  }
  return null;
}

function summarizeEvent(eventName: string, args: unknown[]): string {
  const diagnosticArg = args.find((arg) => {
    const value = arg as {error?: unknown; message?: unknown};
    return value && typeof value === "object" && (value.error !== undefined || value.message !== undefined);
  }) as {error?: unknown; message?: unknown} | undefined;
  if (diagnosticArg) {
    return String(diagnosticArg.error ?? diagnosticArg.message);
  }
  const firstUseful = args.find((arg) => arg !== undefined && arg !== null);
  const id = (firstUseful as {id?: unknown})?.id;
  return id ? `${eventName}: ${String(id)}` : eventName;
}

function toJsonSafeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function ${(value as Function).name || "anonymous"}]`;
  }
  if (ArrayBuffer.isView(value as any)) {
    if (value instanceof DataView) {
      return {
        type: "DataView",
        byteLength: value.byteLength,
        byteOffset: value.byteOffset
      };
    }
    const array = Array.from(value as ArrayLike<number>);
    return array.length > 24 ? [...array.slice(0, 24), `... ${array.length - 24} more`] : array;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => toJsonSafeValue(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).slice(0, 32)) {
      if (key.startsWith("_")) {
        continue;
      }
      out[key] = toJsonSafeValue(source[key], seen);
    }
    if (Object.keys(source).length > 32) {
      out.moreKeys = Object.keys(source).length - 32;
    }
    return out;
  }
  return String(value);
}
