import type {FloatArrayParam, IntArrayParam} from "../../../base/math";
import type {SceneGeometry, SceneGeometryCompressedParams} from "../../../model/scene";

export type VertexArray = IntArrayParam | FloatArrayParam;

/** Visits all vertex-slot attributes, including secondary UVs and deformation data. */
export function mapGeometryVertexAttributes(
  geometry: SceneGeometry,
  map: <T extends VertexArray>(values: T, stride: number) => T,
): Omit<SceneGeometryCompressedParams, "id" | "primitive"> {
  const optional = <T extends VertexArray>(values: T | undefined, stride: number): T | undefined =>
    values ? map(values, stride) : undefined;
  const states = <T extends NonNullable<SceneGeometryCompressedParams["vertexStatesCompressed"]>[number]>(items?: T[]): T[] | undefined =>
    items?.map(state => ({
      ...state,
      positionsCompressed: map(state.positionsCompressed, 3),
      normalsCompressed: optional(state.normalsCompressed, 2),
      uvsCompressed: optional(state.uvsCompressed, 2),
    }));
  const framesCompressed = states(geometry.framesCompressed);
  return {
    positionsCompressed: map(geometry.positionsCompressed, 3),
    normalsCompressed: optional(geometry.normalsCompressed, 2),
    uvsCompressed: optional(geometry.uvsCompressed, 2),
    texCoordsCompressed: geometry.texCoordsCompressed && Object.fromEntries(
      Object.entries(geometry.texCoordsCompressed).map(([channel, values]) => [channel, map(values, 2)]),
    ),
    colorsCompressed: optional(geometry.colorsCompressed, 4),
    scales: optional(geometry.scales, 3),
    rotations: optional(geometry.rotations, 4),
    framesCompressed,
    vertexStatesCompressed: geometry.vertexStatesCompressed === geometry.framesCompressed
      ? framesCompressed : states(geometry.vertexStatesCompressed),
    morphTargets: geometry.morphTargets?.map(target => ({
      ...target,
      positions: optional(target.positions, 3),
      normals: optional(target.normals, 3),
      uvs: optional(target.uvs, 2),
    })),
  };
}
