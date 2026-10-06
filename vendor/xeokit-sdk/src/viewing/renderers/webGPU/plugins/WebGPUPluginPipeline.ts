/** Opaque, validated draw pipeline belonging to one plugin host. */
export interface WebGPUPluginPipeline {
  /** Descriptive label for diagnostics; not a resource identity. */
  readonly label: string;
}
