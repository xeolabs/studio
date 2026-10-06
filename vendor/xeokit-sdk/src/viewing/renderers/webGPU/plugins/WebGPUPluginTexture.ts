/** Borrowed, read-only texture view. Frame attachments are valid only during their callback. */
export interface WebGPUPluginTexture {
  /** Base-level dimensions in texels. Texture coordinates have their origin at the top left. */
  readonly width: number;

  /** Base-level height in texels. */
  readonly height: number;

  /** WebGPU texture format, including scene numerical resource formats. */
  readonly format: string;
}
