/** One group-zero binding. Binding numbers are the array indices in the pipeline descriptor. */
export type WebGPUPluginBindingLayout =
  | "uniform"
  | "read-only-storage"
  | "texture-float"
  | "texture-unfilterable-float"
  | "texture-depth"
  | "sampler-linear"
  | "sampler-nearest";
