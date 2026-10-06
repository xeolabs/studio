import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {RendererPluginDefinition} from "./RendererPluginDefinition";
import type {RepresentationInstanceIdentity} from "./RepresentationInstanceIdentity";
import type {RendererPluginInstanceStatus} from "./RendererPluginInstanceStatus";
import type {RendererPluginRegistration} from "./RendererPluginRegistration";

/** Executable plugins belong to a renderer. This registry never installs code into a Scene. */
export class RendererPluginRegistry {

  private readonly definitions = new Map<string, RendererPluginDefinition>();

  private readonly pending = new Map<string, (result: SDKResult<void>) => void>();

  private readonly runtimeStatus = new Map<string, "pending" | "ready" | "failed" | "unsupported">();

  private readonly statuses = new Map<string, RendererPluginInstanceStatus>();

  private readonly listeners = new Set<
    (instance: RepresentationInstanceIdentity, viewId: string, status: RendererPluginInstanceStatus) => void
  >();

  private readonly changes = new Set<() => void>();

  private destroyed = false;

  /** @param backend Backend identity used to select compatible executable adapters. */
  constructor(readonly backend: string) {}

  /**
   * Registers an application-supplied definition on this renderer.
   *
   * Can run before or after Viewer attachment. Late registration re-evaluates
   * bound meshes on the next render, including meshes already using fallback.
   *
   * @param definition CPU schema plus backend factories; no singleton device state.
   * @returns Registration with initialization promise, or InvalidInput for a duplicate/invalid type.
   */
  register(definition: RendererPluginDefinition): SDKResult<RendererPluginRegistration> {
    const type = definition.schema.type;
    if (this.destroyed || !type || this.definitions.has(type))
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `Invalid or duplicate renderer plugin: ${type}`,
      };
    const ready = new Promise<SDKResult<void>>((resolve) => this.pending.set(type, resolve));
    this.definitions.set(type, definition);
    this.runtimeStatus.set(type, "pending");
    if (
      !definition.adapters.some((adapter) => adapter.backend === this.backend && adapter.hostApiVersion === 1)
    ) {
      this._ready(type, {
        ok: false,
        type: SDKErrorType.NotSupported,
        error: `${type} does not support ${this.backend}`,
      });
      this.runtimeStatus.set(type, "unsupported");
    }
    this.changes.forEach((listener) => listener());
    return {ok: true, value: {type, ready}};
  }

  /**
   * Removes a plugin and releases its device runtime. Bound meshes return to fallback.
   *
   * @param type Exact semantic type previously registered.
   * @returns Success, or InvalidInput when no matching registration exists.
   */
  unregister(type: string): SDKResult<void> {
    if (!this.definitions.delete(type))
      return {ok: false, type: SDKErrorType.InvalidInput, error: `Plugin not registered: ${type}`};
    this._ready(type, {
      ok: false,
      type: SDKErrorType.InvalidOperation,
      error: "Plugin registration cancelled",
    });
    this.runtimeStatus.delete(type);
    this.changes.forEach((listener) => listener());
    return {ok: true, value: undefined};
  }

  /** @returns Runtime initialization state, or undefined for an unregistered type. */
  getStatus(type: string) {
    return this.runtimeStatus.get(type);
  }

  /**
   * Queries the last resolved routing outcome for one mesh in one View.
   * @returns Undefined until that instance/View has been processed by the renderer.
   */
  getInstanceStatus(instance: RepresentationInstanceIdentity, viewId: string) {
    return this.statuses.get(this.key(instance, viewId));
  }

  /**
   * Subscribes to changes in per-instance routing, with stable reason codes.
   * @param listener Called only when the published outcome changes.
   * @returns An unsubscribe function. No initial replay is performed.
   */
  onInstanceStatusChanged(
    listener: (
      instance: RepresentationInstanceIdentity,
      viewId: string,
      status: RendererPluginInstanceStatus
    ) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private key(instance: RepresentationInstanceIdentity, viewId: string) {
    return JSON.stringify([instance.sceneId, instance.modelId, instance.meshId, viewId]);
  }

  /** @internal Backend lifecycle integration. */
  _definitions() {
    return this.definitions;
  }

  /** @internal */
  _subscribe(listener: () => void): () => void {
    this.changes.add(listener);
    return () => this.changes.delete(listener);
  }

  /** @internal */
  _ready(type: string, result: SDKResult<void>): void {
    this.runtimeStatus.set(type, result.ok ? "ready" : "failed");
    this.pending.get(type)?.(result);
    this.pending.delete(type);
  }

  /** @internal */
  _status(
    instance: RepresentationInstanceIdentity,
    viewId: string,
    status: RendererPluginInstanceStatus
  ): void {
    const key = this.key(instance, viewId);
    if (JSON.stringify(this.statuses.get(key)) === JSON.stringify(status)) return;
    this.statuses.set(key, status);
    this.listeners.forEach((listener) => listener(instance, viewId, status));
  }

  /** @internal */
  _forget(instance: RepresentationInstanceIdentity): void {
    const prefix = JSON.stringify([instance.sceneId, instance.modelId, instance.meshId]).slice(0, -1) + ",";
    for (const key of this.statuses.keys()) if (key.startsWith(prefix)) this.statuses.delete(key);
  }

  /** @internal Detaching releases device state; registrations survive reattachment. */
  _detached(): void {
    for (const type of [...this.pending.keys()]) {
      this._ready(type, {
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "Renderer detached before initialization",
      });
    }
    this.statuses.clear();
    this.runtimeStatus.forEach((_, type) => this.runtimeStatus.set(type, "pending"));
  }

  /** Removes registrations, cancels outstanding initialization and releases subscriptions. */
  destroy(): void {
    for (const type of [...this.definitions.keys()]) this.unregister(type);
    this.statuses.clear();
    this.listeners.clear();
    this.changes.clear();
    this.destroyed = true;
  }
}
