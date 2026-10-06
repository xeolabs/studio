import {type Vec3} from "../../../../../../base/math/vector";
import {ItemDataTexture} from "./ItemDataTexture";

/**
 * Stores per-geometry quantization range data (offset and scale).
 *
 * @internal
 */
export class GeometryQuantRangeTexture extends ItemDataTexture {
  static readonly itemSizeInBytes = 32; // 8 x float per item

  /**
   * @private
   * @param options
   */
  constructor(options: {
    gl: WebGL2RenderingContext;
    maxItems: number;
    description: string;
    getNumItems: () => number;
  }) {
    super({
      gl: options.gl,
      description: options.description,
      format: options.gl.RGBA,
      type: options.gl.FLOAT,
      internalFormat: options.gl.RGBA32F,
      maxItems: options.maxItems,
      getNumItems: options.getNumItems,
      width: 2048,
      itemSizeInBytes: GeometryQuantRangeTexture.itemSizeInBytes,
      texelsPerItem: 2,
      elementsPerTexel: 4,
      // Keep a CPU mirror: these per-geometry quant ranges decode every vertex
      // position, and a GPU-only texture cannot be rebuilt after a WebGL context
      // loss (there is no source to re-derive it from), leaving all geometry
      // collapsed at the origin. The mirror lets _allocateTexture re-upload it.
      useBuffer: true,
      growable: true
    });
  }

  setItem(itemIndex: number, item: { offset: Vec3; scale: Vec3 }): void {
    this.ensureItemCapacity(itemIndex + 1);
    const base = itemIndex * this.elementsPerItem;
    const data = this.buffer as Float32Array;
    data[base] = item.offset[0];
    data[base + 1] = item.offset[1];
    data[base + 2] = item.offset[2];
    data[base + 3] = 0;
    data[base + 4] = item.scale[0];
    data[base + 5] = item.scale[1];
    data[base + 6] = item.scale[2];
    data[base + 7] = 0;
    // Flush alongside positions and the other metadata, coalescing geometry
    // creation and any capacity growth before the next draw.
    this.setItemDirty(itemIndex);
  }

  getItem(itemIndex: number): { offset: Vec3; scale: Vec3 } {
    if (!this.buffer) {
      throw new Error("[GeometryQuantRangeTexture.getItem] Not supported without a backing buffer");
    }
    const base = itemIndex * this.elementsPerItem;
    return {
      offset: [this.buffer[base], this.buffer[base + 1], this.buffer[base + 2]],
      scale: [this.buffer[base + 4], this.buffer[base + 5], this.buffer[base + 6]],
    };
  }

}
