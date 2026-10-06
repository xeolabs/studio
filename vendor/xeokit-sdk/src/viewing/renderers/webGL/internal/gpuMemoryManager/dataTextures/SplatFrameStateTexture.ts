import {ItemDataTexture} from "./ItemDataTexture";
import type {FloatArrayParam} from "../../../../../../base/math";

/**
 * Per-splat-mesh frame sampling state for WebGL gaussian splats.
 *
 * The splat record stores the mesh pick id in `t1.w`; splat shaders use that id
 * to fetch this state. Each item is six RGBA32F texels:
 *
 * - texel 0: frame A position offset, frame B position offset, frame A decode texel base, frame B decode texel base
 * - texel 1: interpolation factor, frame flags, unused, unused
 * - texels 2..5: mesh world matrix columns
 *
 * @internal
 */
export class SplatFrameStateTexture extends ItemDataTexture {

  public static readonly itemSizeInBytes = 96; // 6 × RGBA32F texels

  constructor(options: {
    gl: WebGL2RenderingContext;
    maxItems: number;
    description?: string;
    getNumItems: () => number;
  }) {
    super({
      gl: options.gl,
      description: options.description ?? "splat frame states",
      format: options.gl.RGBA,
      type: options.gl.FLOAT,
      internalFormat: options.gl.RGBA32F,
      maxItems: options.maxItems,
      getNumItems: options.getNumItems,
      width: 2048,
      itemSizeInBytes: SplatFrameStateTexture.itemSizeInBytes,
      texelsPerItem: 6,
      elementsPerTexel: 4,
      useBuffer: true
    });
  }

  setItem(itemIndex: number, item: {
    frameAOffset?: number;
    frameBOffset?: number;
    frameADecodeBase?: number;
    frameBDecodeBase?: number;
    frameFactor?: number;
    frameFlags?: number;
    worldMatrix?: FloatArrayParam;
  }): void {
    const base = itemIndex * this.elementsPerItem;
    if (item.frameAOffset !== undefined) this.buffer[base] = item.frameAOffset;
    if (item.frameBOffset !== undefined) this.buffer[base + 1] = item.frameBOffset;
    if (item.frameADecodeBase !== undefined) this.buffer[base + 2] = item.frameADecodeBase;
    if (item.frameBDecodeBase !== undefined) this.buffer[base + 3] = item.frameBDecodeBase;
    if (item.frameFactor !== undefined) this.buffer[base + 4] = item.frameFactor;
    if (item.frameFlags !== undefined) this.buffer[base + 5] = item.frameFlags;
    if (item.worldMatrix) {
      for (let i = 0; i < 16; i++) {
        this.buffer[base + 8 + i] = item.worldMatrix[i];
      }
    } else {
      this.buffer[base + 8] = 1;
      this.buffer[base + 13] = 1;
      this.buffer[base + 18] = 1;
      this.buffer[base + 23] = 1;
    }
    this.setItemDirty(itemIndex);
  }

  getItem(itemIndex: number): Float32Array {
    const base = itemIndex * this.elementsPerItem;
    return this.buffer.subarray(base, base + this.elementsPerItem);
  }
}
