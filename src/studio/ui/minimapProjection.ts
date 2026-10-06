export interface MinimapAxes {
  ax0: number;
  ax1: number;
  flipV1: boolean;
}

/** Shared world-to-SVG mapping for a static minimap and its independent camera overlay. */
export function createMinimapProjection(axes: MinimapAxes, min0: number, max0: number, min1: number, max1: number, minSpan = 0) {
  const width = 480, height = 480, pad = 36;
  let span0 = max0 - min0 || 1, span1 = max1 - min1 || 1;
  const maxSpan = Math.max(span0, span1, minSpan);
  if (span0 < maxSpan) {
    const mid = (min0 + max0) * 0.5;
    min0 = mid - maxSpan * 0.5; max0 = mid + maxSpan * 0.5; span0 = maxSpan;
  }
  if (span1 < maxSpan) {
    const mid = (min1 + max1) * 0.5;
    min1 = mid - maxSpan * 0.5; max1 = mid + maxSpan * 0.5; span1 = maxSpan;
  }
  return {
    ...axes, width, height, pad, min0, max0, min1, max1, span0, span1,
    toSvg(v0: number, v1: number): [number, number] {
      const y = (v1 - min1) / span1;
      return [pad + (v0 - min0) / span0 * (width - 2 * pad),
        pad + (axes.flipV1 ? 1 - y : y) * (height - 2 * pad)];
    }
  };
}

export type MinimapProjection = ReturnType<typeof createMinimapProjection>;

export function createAabbMinimapProjection(aabb: number[] | null, axes: MinimapAxes): MinimapProjection | null {
  if (!aabb) return null;
  const span = Math.max(aabb[3] - aabb[0] || 1, aabb[4] - aabb[1] || 1, aabb[5] - aabb[2] || 1);
  return createMinimapProjection(axes, aabb[axes.ax0], aabb[axes.ax0 + 3], aabb[axes.ax1], aabb[axes.ax1 + 3], span);
}

export function createTileMinimapProjection(tiles: Array<{rtcCenter: number[]; size: number}>, axes: MinimapAxes): MinimapProjection | null {
  if (!tiles.length) return null;
  let min0 = Infinity, min1 = Infinity, max0 = -Infinity, max1 = -Infinity, minSize = Infinity;
  for (const tile of tiles) {
    const half = tile.size * 0.5, c0 = tile.rtcCenter[axes.ax0], c1 = tile.rtcCenter[axes.ax1];
    min0 = Math.min(min0, c0 - half); min1 = Math.min(min1, c1 - half);
    max0 = Math.max(max0, c0 + half); max1 = Math.max(max1, c1 + half);
    minSize = Math.min(minSize, tile.size);
  }
  const pad = Number.isFinite(minSize) ? minSize : 1;
  return createMinimapProjection(axes, min0 - pad, max0 + pad, min1 - pad, max1 + pad);
}
