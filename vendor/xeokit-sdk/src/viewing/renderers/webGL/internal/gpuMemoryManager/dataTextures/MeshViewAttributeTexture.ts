import type { Vec3 } from "../../../../../../base/math/vector";
import { ItemDataTexture } from "./ItemDataTexture";

export const MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE = 1 << 0;
export const MESH_VIEW_FLAG_CASTS_SHADOW = 1 << 1;

/**
 * Stores per-view-mesh attributes: color, opacity, pickability, clippability,
 * style-bin edge visibility and miscellaneous render-policy flags.
 */
export class MeshViewAttributeTexture extends ItemDataTexture {
  static readonly itemSizeInBytes = 8; // 2 RGBA8UI texels

  constructor(options: {
    gl: WebGL2RenderingContext;
    description: string;
    maxItems: number;
    getNumItems: () => number;
  }) {
    super({
      gl: options.gl,
      description: options.description,
      format: options.gl.RGBA_INTEGER,
      type: options.gl.UNSIGNED_BYTE,
      internalFormat: options.gl.RGBA8UI,
      maxItems: options.maxItems,
      getNumItems: options.getNumItems,
      width: 4096,
      itemSizeInBytes: MeshViewAttributeTexture.itemSizeInBytes,
      texelsPerItem: 2,
      elementsPerTexel: 4,
      growable: true,
    });
  }

  setItem(itemIndex: number, item: {
    color?: Vec3;
    /** Opacity in range [0..255] */
    opacity?: number;
    pickable?: boolean;
    clippable?: boolean;
    styleBinEdges?: boolean;
    styleBinClearDepthBefore?: boolean;
    castsShadow?: boolean;
  }): void {
    this.ensureItemCapacity(itemIndex + 1);
    const base = itemIndex * this.elementsPerItem;
    const buf = this.buffer;
    if (item.color) {
      buf[base] = item.color[0];
      buf[base + 1] = item.color[1];
      buf[base + 2] = item.color[2];
    }
    if (item.opacity !== undefined) buf[base + 3] = item.opacity;
    if (item.pickable !== undefined) buf[base + 4] = item.pickable ? 1 : 0;
    if (item.clippable !== undefined) buf[base + 5] = item.clippable ? 1 : 0;
    if (item.styleBinEdges !== undefined) buf[base + 6] = item.styleBinEdges ? 1 : 0;
    if (item.styleBinClearDepthBefore !== undefined || item.castsShadow !== undefined) {
      let flags = buf[base + 7];
      if (item.styleBinClearDepthBefore !== undefined) {
        flags = item.styleBinClearDepthBefore
          ? flags | MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE
          : flags & ~MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE;
      }
      if (item.castsShadow !== undefined) {
        flags = item.castsShadow
          ? flags | MESH_VIEW_FLAG_CASTS_SHADOW
          : flags & ~MESH_VIEW_FLAG_CASTS_SHADOW;
      }
      buf[base + 7] = flags;
    }
    this.setItemDirty(itemIndex);
  }

  getItem(itemIndex: number): {
    color: Vec3;
    opacity: number;
    pickable: boolean;
    clippable: boolean;
    styleBinEdges: boolean;
    styleBinClearDepthBefore: boolean;
    castsShadow: boolean;
  } {
    const base = itemIndex * this.elementsPerItem;
    const buf = this.buffer;
    return {
      color: [buf[base], buf[base + 1], buf[base + 2]],
      opacity: buf[base + 3],
      pickable: buf[base + 4] !== 0,
      clippable: buf[base + 5] !== 0,
      styleBinEdges: buf[base + 6] !== 0,
      styleBinClearDepthBefore: (buf[base + 7] & MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE) !== 0,
      castsShadow: (buf[base + 7] & MESH_VIEW_FLAG_CASTS_SHADOW) !== 0,
    };
  }
}
