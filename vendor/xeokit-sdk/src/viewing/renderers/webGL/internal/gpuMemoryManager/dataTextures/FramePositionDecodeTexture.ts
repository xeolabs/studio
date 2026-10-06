import {PortionDataTexture} from "./PortionDataTexture";
import type {Vec3} from "../../../../../../base/math/vector";

/**
 * Stores per-frame position dequantization ranges for geometry frame animation.
 *
 * Each frame occupies two RGBA32F texels:
 *
 * - texel 0: offset.xyz
 * - texel 1: scale.xyz
 *
 * The frame position stream itself remains RGB16UI in a VertexPositionTexture;
 * shaders fetch two frames, decode with these ranges, then interpolate.
 *
 * @internal
 */
export class FramePositionDecodeTexture extends PortionDataTexture {

  public static readonly itemSizeInBytes = 32; // 2 × RGBA32F texels

  constructor(options: {
    gl: WebGL2RenderingContext;
    maxItems: number;
    description: string;
  }) {
    super({
      gl: options.gl,
      description: options.description,
      format: options.gl.RGBA,
      type: options.gl.FLOAT,
      internalFormat: options.gl.RGBA32F,
      maxItems: options.maxItems,
      getNumItems: () => this.numItems,
      width: 2048,
      itemSizeInBytes: FramePositionDecodeTexture.itemSizeInBytes,
      texelsPerItem: 2,
      elementsPerTexel: 4,
    });
  }

  getItem(itemIndex: number): { offset: Vec3; scale: Vec3 } {
    const offset = itemIndex * this.elementsPerItem;
    return {
      offset: [
        this.buffer[offset],
        this.buffer[offset + 1],
        this.buffer[offset + 2],
      ],
      scale: [
        this.buffer[offset + 4],
        this.buffer[offset + 5],
        this.buffer[offset + 6],
      ]
    };
  }
}
