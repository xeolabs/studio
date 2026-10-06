import {createVec3Float64, type Vec3} from "../../../../base/math/vector";

export function interpolateVec3(values: ArrayLike<number>, sampleA: number, sampleB: number, t: number, dest: Vec3 = createVec3Float64()): Vec3 {
  const a = sampleA * 3;
  const b = sampleB * 3;
  dest[0] = values[a] + (values[b] - values[a]) * t;
  dest[1] = values[a + 1] + (values[b + 1] - values[a + 1]) * t;
  dest[2] = values[a + 2] + (values[b + 2] - values[a + 2]) * t;
  return dest;
}

export function readVec3Sample(values: ArrayLike<number>, sample: number, dest: Vec3 = createVec3Float64()): Vec3 {
  const offset = sample * 3;
  dest[0] = values[offset];
  dest[1] = values[offset + 1];
  dest[2] = values[offset + 2];
  return dest;
}
