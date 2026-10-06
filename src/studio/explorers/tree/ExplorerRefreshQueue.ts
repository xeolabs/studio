/** Coalesces SDK event bursts without delaying the underlying scene mutation. */
export class ExplorerRefreshQueue {
  private _pending: "state" | "structure" | null = null;
  private _disposed = false;

  constructor(private readonly _refresh: {
    structure: () => void;
    state: () => void;
  }) {}

  request(kind: "state" | "structure"): void {
    if (this._disposed) return;
    const scheduled = this._pending !== null;
    if (kind === "structure" || !scheduled) this._pending = kind;
    if (!scheduled) queueMicrotask(() => this._flush());
  }

  dispose(): void {
    this._disposed = true;
    this._pending = null;
  }

  private _flush(): void {
    const kind = this._pending;
    this._pending = null;
    // A structural refresh also reads current visibility/effects, so it subsumes state work.
    if (!this._disposed && kind) this._refresh[kind]();
  }
}
