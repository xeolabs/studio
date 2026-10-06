import {createMat4Float64, inverseMat4, type Mat4, transformVec4} from "../../../../../base/math/matrix";
import {createVec3Float64, createVec4Float64, type Vec3} from "../../../../../base/math/vector";
import {createRTCViewMat} from "../../../../../base/math/rtc";

/** Reconstructs a pick from the shader's float32 view-space Z. @internal */
export class PickPosition {
  private readonly _depth = new DataView(new ArrayBuffer(4));
  private readonly _rtcView = createMat4Float64();
  private readonly _inverseView = createMat4Float64();
  private readonly _position = createVec4Float64();
  private readonly _world = createVec4Float64();
  private readonly _result = createVec3Float64();

  /** The returned vector is reused by subsequent calls. */
  read(bytes: Uint8Array, projection: Mat4, view: Mat4, clip: ArrayLike<number>, tileOrigin?: Vec3): Vec3 | null {
    // Matches packUintToRGBA8(floatBitsToUint(viewZ)); byte order is explicit.
    this._depth.setUint32(0, (bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24) >>> 0, true);
    const z = this._depth.getFloat32(0, true);
    if (!Number.isFinite(z)) return null;

    // Solve projected X/W and Y/W for view X,Y at the measured view Z.
    // This works for perspective, orthographic and asymmetric/custom matrices,
    // without assuming near/far settings or unprojecting an infinite far plane.
    const x = clip[0], y = clip[1], p = projection;
    const a = p[0] - x * p[3], b = p[4] - x * p[7];
    const c = p[1] - y * p[3], d = p[5] - y * p[7];
    const u = -(p[8] - x * p[11]) * z - (p[12] - x * p[15]);
    const v = -(p[9] - y * p[11]) * z - (p[13] - y * p[15]);
    const determinant = a * d - b * c;
    if (determinant === 0 || !Number.isFinite(determinant)) return null;
    this._position[0] = (u * d - b * v) / determinant;
    this._position[1] = (a * v - u * c) / determinant;
    this._position[2] = z;
    this._position[3] = 1;

    // Mesh positions already include the model coordinate-system transform.
    // Undo only the tile's view matrix, then restore its world-space origin.
    const viewMatrix = tileOrigin ? createRTCViewMat(view, tileOrigin, this._rtcView) : view;
    inverseMat4(viewMatrix, this._inverseView);
    transformVec4(this._inverseView, this._position, this._world);
    for (let axis = 0; axis < 3; axis++) {
      const value = this._world[axis] / this._world[3] + (tileOrigin?.[axis] ?? 0);
      if (!Number.isFinite(value)) return null;
      this._result[axis] = value;
    }
    return this._result;
  }
}
