/** Interleaved vertex or instance attributes consumed by a plugin pipeline. */
export interface WebGPUPluginVertexBufferLayout {
  /** Byte stride between consecutive elements; must be a multiple of four. */
  readonly arrayStride: number;

  /** Advance the element for each vertex or for each instance. */
  readonly stepMode?: "vertex" | "instance";

  /** Attribute byte offsets and WGSL @location indices within an element. */
  readonly attributes: readonly {
    readonly shaderLocation: number;

    readonly offset: number;

    readonly format: "float32" | "float32x2" | "float32x3" | "float32x4" | "unorm8x4" | "uint32";
  }[];
}
