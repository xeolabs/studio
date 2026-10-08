export interface StreamController {
  paused: boolean;
  chunkManifests: readonly unknown[];
  loadedChunkIds: Set<string>;
  loadingChunkIds: Set<string>;
  queueProgress: {queued: number; loaded: number};
  pause(): void;
  resume(label?: string): void;
  schedule(label?: string): void;
  updateBackpressure(label?: string): boolean;
}

/** Owns camera idling, completion and teardown around the SDK chunk scheduler. */
export class StreamLifecycle {
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private stops: Array<() => void> = [];
  private disposed = false;
  private started = false;
  moving = false;
  complete = false;

  constructor(private readonly params: {
    controller: StreamController;
    subscribeCamera: (changed: () => void) => () => void;
    pendingSegments: () => number;
    seal: () => void;
    onChanged: () => void;
    idleMs?: number;
  }) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.stops.push(this.params.subscribeCamera(() => this.cameraChanged()));
    this.pollTimer = setInterval(() => this.check(), 250);
    this.params.controller.schedule("Current view");
    this.params.onChanged();
  }

  private cameraChanged(): void {
    if (this.disposed || this.complete) return;
    this.moving = true;
    this.params.controller.pause();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.disposed || this.complete) return;
      this.moving = false;
      this.params.controller.resume("Camera settled");
      this.params.onChanged();
    }, this.params.idleMs ?? 500);
    this.params.onChanged();
  }

  check(): void {
    if (this.disposed || this.complete || !this.started) return;
    const controller = this.params.controller;
    // A manual camera pause must not be resumed by renderer backpressure.
    if (!this.moving) controller.updateBackpressure("Renderer ready");
    if (controller.loadedChunkIds.size === controller.chunkManifests.length && !controller.loadingChunkIds.size
      && this.params.pendingSegments() === 0) {
      this.params.seal();
      this.complete = true;
      controller.pause();
      this.stopWatching();
    }
    this.params.onChanged();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.params.controller.pause();
    this.stopWatching();
  }

  private stopWatching(): void {
    clearTimeout(this.idleTimer);
    clearInterval(this.pollTimer);
    this.idleTimer = this.pollTimer = undefined;
    for (const stop of this.stops.splice(0)) stop();
  }
}
