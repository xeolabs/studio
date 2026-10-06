/**
 * Encoding shared by the sampled scene-depth input and writable depth attachment.
 * Depth samples and fragment-depth outputs are always in [0, 1]; clear/background
 * depth is 1 and smaller values are nearer. This describes storage, independently
 * of the runtime's `none`, `test-only`, `actual-surface` or `proxy` depth claim.
 *
 * For `projective`, divide clip Z by clip W. Map [-1, 1] to [0, 1] when
 * `clipRange` is `negative-one-to-one`; otherwise use the quotient directly.
 * Apply the inverse mapping before unprojecting a sampled depth.
 *
 * For `logarithmic`, encode positive eye-space distance d (=-eye Z) as
 * `log2(1 + d) / log2(1 + far)`. Decode with `d = 2 ** (sample * log2(1 + far)) - 1`,
 * then project eye Z=-d using the supplied projection matrix before unprojecting
 * the pixel. Clip-space reconstruction still uses `clipRange`. This encoding is
 * used only with a perspective matrix whose clip W is -eye Z.
 *
 * Plugins must use this descriptor for both sampled-depth interpretation and
 * fragment-depth output. Projection matrices alone do not describe logarithmic
 * storage. Orthographic attachments use projective encoding.
 */
export type RendererPluginDepthEncoding =
  | {
      readonly kind: "projective";

      readonly clipRange: "negative-one-to-one" | "zero-to-one";
    }
  | {
      readonly kind: "logarithmic";

      readonly clipRange: "negative-one-to-one" | "zero-to-one";

      /** Positive finite distance used to normalize the logarithmic mapping. */
      readonly far: number;
    };
