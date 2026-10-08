import type {View, ViewObject} from "@xeokit/sdk/viewing/viewer";
import type {CommandRegistry} from "../commands/CommandRegistry";
import {viewIsolation, type ViewIsolation} from "./ViewIsolation";

type Flags = {visible: boolean; xrayed: boolean; highlighted: boolean};
type Session = ReturnType<ViewIsolation["captureSession"]>;
type Change = {id: string; before: Flags; after: Flags};
type Step = {label: string; changes: Change[]; before: Session; after: Session};
export interface ViewHistoryState {canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string; revision: number;}
const histories = new WeakMap<View, ViewHistoryService>();
const flags = (o: ViewObject): Flags => ({visible: o.visible, xrayed: o.hasStyleBin("xrayed"), highlighted: o.hasStyleBin("highlighted")});
const same = (a: Flags, b: Flags) => a.visible === b.visible && a.xrayed === b.xrayed && a.highlighted === b.highlighted;

/** Bounded deltas for viewing changes, including actions made directly by tree controls. */
export class ViewHistoryService {
  private baseline = new Map<string, Flags>();
  private pending = new Map<string, Change>();
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];
  private session: Session;
  private paused = false;
  private queued = false;
  private disposed = false;
  private label = "";
  private cleanup: Array<() => void> = [];

  constructor(private view: View, private state: ViewHistoryState, commands?: CommandRegistry) {
    histories.set(view, this);
    this.session = viewIsolation(view).captureSession();
    this.reset();
    const events = view.viewer.events;
    this.cleanup.push(events.onViewObjectVisibleChanged.subscribe((v, o) => {if (v === view) this.changed(o);}));
    this.cleanup.push(events.onViewObjectStyleBinChanged.subscribe((v, e) => {
      if (v === view && ["xrayed", "highlighted"].includes(e.styleBinId)) this.changed(e.viewObject);
    }));
    // A model lifecycle change invalidates old object IDs and clears the return history.
    for (const event of [events.onViewObjectCreated, events.onViewObjectDestroyed]) {
      this.cleanup.push(event.subscribe((v, object) => {
        if (v !== view) return;
        this.undoSteps = []; this.redoSteps = []; this.pending.clear();
        if (event === events.onViewObjectCreated) this.baseline.set(object.id, flags(object));
        else this.baseline.delete(object.id);
        this.session = viewIsolation(view).captureSession(); this.publish();
      }));
    }
    this.cleanup.push(viewIsolation(view).onChanged(() => {if (!this.paused) this.schedule();}));
    if (commands) this.cleanup.push(commands.onDidExecute(event => {
      if (event.status === "started") {this.flush(); this.label = event.command.title;}
      else if (event.status === "finished" || event.status === "failed") {this.flush(); this.label = "";}
    }));
  }

  undo(): void { this.flush(); this.replay(this.undoSteps, this.redoSteps, false); }
  redo(): void { this.flush(); this.replay(this.redoSteps, this.undoSteps, true); }
  withoutRecording(action: () => void): void {
    const wasPaused = this.paused;
    this.paused = true;
    try {action();} finally {this.paused = wasPaused; this.reset();}
  }
  destroy(): void {this.disposed = true; for (const stop of this.cleanup) stop(); histories.delete(this.view);}

  private changed(object: ViewObject): void {
    const after = flags(object), before = this.baseline.get(object.id) || after;
    this.baseline.set(object.id, after);
    if (this.paused || same(before, after)) return;
    const existing = this.pending.get(object.id);
    this.pending.set(object.id, {id: object.id, before: existing?.before || before, after});
    this.schedule();
  }
  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {this.queued = false; if (!this.disposed) this.flush();});
  }
  private flush(): void {
    if (this.paused) return;
    const after = viewIsolation(this.view).captureSession();
    const changes = [...this.pending.values()].filter(c => !same(c.before, c.after));
    this.pending.clear();
    if (changes.length || this.session.label !== after.label || !!this.session.previous !== !!after.previous) {
      const kind = changes.some(c => c.before.visible !== c.after.visible) ? "visibility" :
        changes.some(c => c.before.xrayed !== c.after.xrayed) ? "X-ray" : "highlight";
      this.undoSteps.push({label: this.label || (after.label ? "isolate" : kind), changes, before: this.session, after});
      this.undoSteps.splice(0, Math.max(0, this.undoSteps.length - 30));
      this.redoSteps = [];
      this.publish();
    }
    this.session = after;
  }
  private replay(from: Step[], to: Step[], forward: boolean): void {
    const step = from.pop(); if (!step) return;
    this.paused = true;
    try {
      for (const change of step.changes) {
        const object = this.view.objects[change.id]; if (!object) continue;
        const target = forward ? change.after : change.before;
        object.visible = target.visible;
        for (const bin of ["xrayed", "highlighted"] as const) this.view.setObjectsInStyleBin(bin, [change.id], target[bin]);
        this.baseline.set(change.id, flags(object));
      }
      viewIsolation(this.view).restoreSession(forward ? step.after : step.before);
      this.session = viewIsolation(this.view).captureSession();
      to.push(step);
    } finally {this.paused = false; this.publish();}
  }
  private reset(): void {
    this.baseline = new Map(Object.entries(this.view.objects).map(([id, o]) => [id, flags(o)]));
    this.pending.clear(); this.undoSteps = []; this.redoSteps = [];
    this.session = viewIsolation(this.view).captureSession(); this.publish();
  }
  private publish(): void {
    Object.assign(this.state, {canUndo: !!this.undoSteps.length, canRedo: !!this.redoSteps.length,
      undoLabel: this.undoSteps.at(-1)?.label || "", redoLabel: this.redoSteps.at(-1)?.label || "", revision: this.state.revision + 1});
  }
}

export function withoutViewHistory(view: View, action: () => void): void {
  const history = histories.get(view);
  if (history) history.withoutRecording(action); else action();
}
