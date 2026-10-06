/** Opaque buffer owned by one plugin runtime. Native GPU objects never escape the host. */
export interface WebGPUPluginBuffer {
  /** Allocated byte length, rounded up to a multiple of four. */
  readonly byteLength: number;

  /** Release this allocation. Idempotent; subsequent use is rejected. */
  release(): void;
}
