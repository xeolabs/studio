/** Borrowed inputs valid only for the current host-scheduled render callback. */
export interface WebGLPluginFrame {

  /** Insertion point selected by the host. */
  readonly stage: import("../../../rendering/plugins/RendererPluginStage").RendererPluginStage;

  /** Storage mapping for sceneDepth and fragment-depth output; independent of depth ownership. */
  readonly depthEncoding: import("../../../rendering/plugins/RendererPluginDepthEncoding").RendererPluginDepthEncoding;

  /** Render-target width in physical pixels, which may differ from CSS dimensions. */
  readonly width: number;

  /** Render-target height in physical pixels. */
  readonly height: number;

  /**
   * RGBA16F input for compose-opaque only; absent for transparent draws. Contains preceding opaque scene colour, including successful
   * earlier plugins. Linear HDR, before transparency, bloom and tone mapping.
   * Do not mutate/delete this texture or keep it after the callback.
   */
  readonly sceneColor?: WebGLTexture;

  /**
   * Immutable DEPTH24_STENCIL8 copy, sampled as normalized depth in [0, 1].
   * Decode with depthEncoding before unprojecting; 1 denotes background.
   * Separate from the writable output attachment, preventing feedback aliasing.
   */
  readonly sceneDepth: WebGLTexture;
}
