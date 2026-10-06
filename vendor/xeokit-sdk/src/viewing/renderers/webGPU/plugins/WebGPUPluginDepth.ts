/**
 * Depth behavior declared by a WebGPU compose-opaque runtime.
 *
 * - `none`: colour only; depth testing and writes are disabled.
 * - `test-only`: LEQUAL testing against the scene, without modifying depth.
 * - `actual-surface`: LEQUAL testing and depth writes for the surface actually shaded.
 * - `proxy`: writes explicitly approximate depth for a declared surrogate.
 *
 * The host sets the initial state from this claim. Shader correctness remains the
 * plugin's responsibility; never describe influence-volume depth as actual surface depth.
 */
export type WebGPUPluginDepth = "none" | "test-only" | "actual-surface" | "proxy";
