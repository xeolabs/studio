import type {View} from "@xeokit/sdk/viewing/viewer";

/** One isolation session per view, shared by element, tree and context-menu actions. */
export class ViewIsolation {
  private previous: Map<string, boolean> | null = null;
  private listeners = new Set<(label: string) => void>();
  label = "";

  constructor(private readonly view: View) {}

  isolate(ids: string[], label: string): void {
    const targets = ids.filter(id => !!this.view.objects[id]);
    if (!targets.length) return;
    // Re-isolating changes the target, but keeps the original return point.
    if (!this.previous) this.previous = new Map(Object.entries(this.view.objects).map(([id, object]) => [id, object.visible]));
    else for (const [id, object] of Object.entries(this.view.objects)) {
      if (!this.previous.has(id)) this.previous.set(id, object.visible);
    }
    this.view.setObjectsVisible(Object.keys(this.view.objects), false);
    this.view.setObjectsVisible(targets, true);
    this.publish(label || "Elements");
  }

  restore(): void {
    if (!this.previous) return;
    const visible: string[] = [], hidden: string[] = [];
    for (const [id, wasVisible] of this.previous) {
      if (this.view.objects[id]) (wasVisible ? visible : hidden).push(id);
    }
    this.view.setObjectsVisible(visible, true);
    this.view.setObjectsVisible(hidden, false);
    this.clear();
  }

  captureSession() {
    return {previous: this.previous ? new Map(this.previous) : null, label: this.label};
  }

  restoreSession(snapshot: ReturnType<ViewIsolation["captureSession"]>): void {
    this.previous = snapshot.previous ? new Map(snapshot.previous) : null;
    this.publish(snapshot.label);
  }

  clear(): void { this.previous = null; this.publish(""); }

  onChanged(listener: (label: string) => void): () => void {
    this.listeners.add(listener);
    listener(this.label);
    return () => { this.listeners.delete(listener); };
  }

  private publish(label: string): void {
    this.label = label;
    for (const listener of this.listeners) listener(label);
  }
}

const sessions = new WeakMap<View, ViewIsolation>();
export function viewIsolation(view: View): ViewIsolation {
  let session = sessions.get(view);
  if (!session) { session = new ViewIsolation(view); sessions.set(view, session); }
  return session;
}
