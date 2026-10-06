/** Host-tracked, plugin-owned RGBA16F intermediate with no depth attachment. */
export interface WebGLPluginTarget {

  /** Bind for drawing only during a permitted GPU callback. */
  readonly framebuffer: WebGLFramebuffer;

  /** Colour attachment; mip storage exists only when requested at creation. */
  readonly texture: WebGLTexture;

  /** Immutable target width in texels. */
  readonly width: number;

  /** Immutable target height in texels. */
  readonly height: number;

  /** Idempotently releases the target early. The host also cleans up remaining targets on teardown. */
  release(): void;
}
