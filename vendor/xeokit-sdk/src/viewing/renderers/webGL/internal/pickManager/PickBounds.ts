import {TrianglesPrimitive} from "../../../../../base/constants";
import {createMat4Float64, type Mat4, mulMat4} from "../../../../../base/math/matrix";
import type {SceneMesh} from "../../../../../model/scene";

/**
 * Conservative world bounds for one triangle batch. Bounds only expand: moves,
 * edits and deletions can leave extra space, but can never hide visible geometry.
 * Shared by picking, camera-view and shadow culling, with no per-mesh cache or index rebuild.
 * @internal
 */
export class BatchPickBounds {
  private readonly _bounds = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  private _usable = true;
  private _populated = false;

  get aabb(): Float64Array | null {
    return this._usable && this._populated ? this._bounds : null;
  }

  expand(mesh: SceneMesh, matrix: Mat4 = mesh.worldMatrix): void {
    if (!this._usable) return;
    const geometry = mesh.geometry;
    // Screen-facing and deformed geometry can extend beyond the base
    // geometry's transformed bounds. Keep their whole batch on the original path.
    if (geometry.primitive !== TrianglesPrimitive ||
      (mesh.billboard && mesh.billboard !== "none") || geometry.framesCompressed?.length ||
      geometry.vertexStatesCompressed?.length || geometry.morphTargets?.length) {
      this._usable = false;
      return;
    }
    const bounds = geometry.aabb;
    if (!bounds || !matrix || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) {
      this._usable = false;
      return;
    }
    for (let i = 0; i < 16; i++) {
      if (!Number.isFinite(matrix[i])) {
        this._usable = false;
        return;
      }
    }
    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(bounds[i]) || !Number.isFinite(bounds[i + 3]) || bounds[i] > bounds[i + 3]) {
        this._usable = false;
        return;
      }
    }
    const cx = (bounds[0] + bounds[3]) * 0.5;
    const cy = (bounds[1] + bounds[4]) * 0.5;
    const cz = (bounds[2] + bounds[5]) * 0.5;
    const ex = (bounds[3] - bounds[0]) * 0.5;
    const ey = (bounds[4] - bounds[1]) * 0.5;
    const ez = (bounds[5] - bounds[2]) * 0.5;
    for (let axis = 0; axis < 3; axis++) {
      const center = matrix[axis] * cx + matrix[axis + 4] * cy + matrix[axis + 8] * cz + matrix[axis + 12];
      const extent = Math.abs(matrix[axis]) * ex + Math.abs(matrix[axis + 4]) * ey + Math.abs(matrix[axis + 8]) * ez;
      // The shader decodes positions and applies RTC transforms in float32.
      // Include rounding room even when large transform terms cancel out.
      const error = 1e-5 * (1 + Math.abs(matrix[axis] * cx) + Math.abs(matrix[axis + 4] * cy) +
        Math.abs(matrix[axis + 8] * cz) + Math.abs(matrix[axis + 12]) + extent);
      const min = center - extent - error;
      const max = center + extent + error;
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        this._usable = false;
        return;
      }
      this._bounds[axis] = Math.min(this._bounds[axis], min);
      this._bounds[axis + 3] = Math.max(this._bounds[axis + 3], max);
    }
    this._populated = true;
  }
}

/** Four conservative side planes for picking, camera-view or shadow batch culling. @internal */
export class PickFrustum {
  private readonly _matrix = createMat4Float64();
  private readonly _planes = new Float64Array(16);
  private _usable = false;

  set(projection: Mat4, view: Mat4, clipX: number, clipY: number, width: number, height: number): void {
    this._usable = false;
    if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height) ||
      !Number.isFinite(clipX) || !Number.isFinite(clipY)) return;
    // remapPickClipPos scales NDC by drawingBufferSize. Enclose twice its
    // half-width, so rasterization and float32 cursor rounding stay conservative.
    this._setPlanes(projection, view, clipX, clipY, 2 / width, 2 / height);
  }

  /** Encloses the full viewport plus two raster pixels; leaves depth clipping to the GPU. */
  setViewport(projection: Mat4, view: Mat4, width: number, height: number): void {
    this._usable = false;
    if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return;
    this._setPlanes(projection, view, 0, 0, 1 + 4 / width, 1 + 4 / height);
  }

  private _setPlanes(projection: Mat4, view: Mat4, clipX: number, clipY: number, radiusX: number, radiusY: number): void {
    const matrix = mulMat4(projection, view, this._matrix);
    for (let i = 0; i < 16; i++) if (!Number.isFinite(matrix[i])) return;
    for (let plane = 0; plane < 4; plane++) {
      const axis = plane < 2 ? 0 : 1;
      const sign = plane % 2 === 0 ? 1 : -1;
      const center = axis === 0 ? clipX : clipY;
      const radius = axis === 0 ? radiusX : radiusY;
      for (let column = 0; column < 4; column++) {
        this._planes[plane * 4 + column] = sign * matrix[column * 4 + axis] +
          (radius - sign * center) * matrix[column * 4 + 3];
      }
    }
    this._usable = this._planes.every(Number.isFinite);
  }

  intersects(bounds?: BatchPickBounds | null): boolean {
    return this.intersectsAABB(bounds?.aabb);
  }

  /** Also accepts a box inside packed shadow metadata, without allocating a subarray. */
  intersectsAABB(aabb?: ArrayLike<number> | null, offset = 0): boolean {
    if (!this._usable || !aabb || !Number.isFinite(aabb[offset])) return true;
    for (let plane = 0; plane < 4; plane++) {
      const i = plane * 4;
      const x = this._planes[i], y = this._planes[i + 1], z = this._planes[i + 2], w = this._planes[i + 3];
      const px = aabb[offset + (x >= 0 ? 3 : 0)];
      const py = aabb[offset + (y >= 0 ? 4 : 1)];
      const pz = aabb[offset + (z >= 0 ? 5 : 2)];
      const distance = x * px + y * py + z * pz + w;
      const error = 1e-5 * (1 + Math.abs(x * px) + Math.abs(y * py) + Math.abs(z * pz) + Math.abs(w));
      if (distance < -error) return false;
    }
    // No near/far rejection: depth conventions and overlay priority stay with
    // the existing GPU pass. The filter only rejects definite screen-space misses.
    return true;
  }
}
