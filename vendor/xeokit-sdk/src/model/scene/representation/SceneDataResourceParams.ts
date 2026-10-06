import type {SceneResourceArray} from "./SceneResourceArray";

/**
 * Authored binary payload for {@link SceneModel.createDataResource}.
 *
 * A buffer is an unshaped numerical sequence. A texture2d is a row-major table
 * with interleaved channels; its name describes its shape, not a GPU allocation.
 * No colour conversion, image decoding or implicit mipmaps are applied.
 * The model copies the typed array. Consumers decide how to represent it on a device.
 */
export type SceneDataResourceParams =
  | {

      /** Nonempty model-local resource ID. */
      id: string;

      /** Unshaped numerical data. */
      kind: "buffer";

      /** Must match the concrete typed array supplied in data. */
      componentType: "float32" | "uint32" | "uint8";

      /** Authored values; copied on successful creation or replacement. */
      data: SceneResourceArray;
    }
  | {

      /** Nonempty model-local resource ID. */
      id: string;

      /** Two-dimensional, row-major numerical data. */
      kind: "texture2d";

      /** Channel count and storage type; rgba8unorm contains four unsigned bytes per texel. */
      format: "r32float" | "rg32float" | "rgba32float" | "rgba8unorm";

      /** Positive integer number of columns. */
      width: number;

      /** Positive integer number of rows. */
      height: number;

      /** Exactly width × height × channelCount elements, with type matching format. */
      data: Float32Array | Uint8Array;
    };
