import type {Vec9} from "@xeokit/sdk/base/math/vector";

/**
 * One named coordinate-system basis users can pick when orienting imported or
 * live scene content. Basis values are column-major:
 * `[x0,x1,x2, y0,y1,y2, z0,z1,z2]`.
 */
export interface CoordinateSystemPreset {
  id: string;
  label: string;
  basis: Vec9 | null;
}
