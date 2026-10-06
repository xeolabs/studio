import {createQuatFloat64, normalizeQuat, type Quat} from "../../../../base/math/quat";

export function readQuaternionSample(values: ArrayLike<number>, sample: number, dest: Quat = createQuatFloat64()): Quat {
  const offset = sample * 4;
  dest[0] = values[offset];
  dest[1] = values[offset + 1];
  dest[2] = values[offset + 2];
  dest[3] = values[offset + 3];
  return normalizeQuat(dest, dest);
}

/**
 * Spherical-linear interpolation for quaternions.
 */
export function interpolateQuaternion(values: ArrayLike<number>, sampleA: number, sampleB: number, t: number, dest: Quat = createQuatFloat64()): Quat {
  const a = sampleA * 4;
  const b = sampleB * 4;
  let ax = values[a];
  let ay = values[a + 1];
  let az = values[a + 2];
  let aw = values[a + 3];
  let bx = values[b];
  let by = values[b + 1];
  let bz = values[b + 2];
  let bw = values[b + 3];

  let cosTheta = ax * bx + ay * by + az * bz + aw * bw;
  if (cosTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosTheta = -cosTheta;
  }

  if (cosTheta > 0.9995) {
    dest[0] = ax + (bx - ax) * t;
    dest[1] = ay + (by - ay) * t;
    dest[2] = az + (bz - az) * t;
    dest[3] = aw + (bw - aw) * t;
    return normalizeQuat(dest, dest);
  }

  const theta = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
  const sinTheta = Math.sin(theta);
  const scaleA = Math.sin((1 - t) * theta) / sinTheta;
  const scaleB = Math.sin(t * theta) / sinTheta;
  dest[0] = ax * scaleA + bx * scaleB;
  dest[1] = ay * scaleA + by * scaleB;
  dest[2] = az * scaleA + bz * scaleB;
  dest[3] = aw * scaleA + bw * scaleB;
  return normalizeQuat(dest, dest);
}
