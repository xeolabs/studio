import {collapseAABB3, expandAABB3Points3, createAABB3Float32} from "../../base/math/boundaries";
import {compressRGBColors, octEncodeNormalsToU16, packUVsToFloat32, quantizePositions3} from "../../base/math/compression";
import {createVec3Float64} from "../../base/math/vector";
import type {FloatArrayParam, IntArrayParam} from "../../base/math";
import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, SolidPrimitive, SurfacePrimitive, TrianglesPrimitive} from "../../base/constants";
import {buildEdgeIndices} from "./buildEdgeIndices";
import type {SceneGeometryCompressedParams} from "./SceneGeometryCompressedParams";
import type {SceneGeometryParams} from "./SceneGeometryParams";

const rtcCenter = createVec3Float64();

/**
 * Compresses a {@link SceneGeometryParams | SceneGeometryParams} into a {@link SceneGeometryCompressedParams | SceneGeometryCompressedParams}.
 *
 * See {@link model!scene | @xeokit/sdk/model/scene}  for usage examples.
 *
 * @param geometryParams Uncompressed geometry params.
 * @returns Compressed geometry params.
 */
export function compressGeometryParams(geometryParams: SceneGeometryParams): SceneGeometryCompressedParams {


  // RTC disabled because there's no way to add a translation
  // to compensate for this offset in the mdeh modlng matrix.
  // const rtcNeeded = worldToRTCPositions(geometryParams.positions, geometryParams.positions, rtcCenter);
  const rtcNeeded = false;

  const sourceVertexStates = geometryParams.vertexStates ?? geometryParams.frames;
  const basePositions = (geometryParams.positions ?? sourceVertexStates?.[0]?.positions)!;
  const baseNormals = geometryParams.normals ?? sourceVertexStates?.[0]?.normals;

  const aabb = collapseAABB3(createAABB3Float32());
  expandAABB3Points3(aabb, basePositions);
  const positionsCompressed = quantizePositions3(basePositions, aabb);
  const vertexStatesCompressed = sourceVertexStates?.map((frame) => {
    const frameAABB = collapseAABB3(createAABB3Float32());
    expandAABB3Points3(frameAABB, frame.positions);
    const expectedFrameUvLen = (frame.positions.length / 3) * 2;
    return {
      ...(frame.id !== undefined ? {id: frame.id} : {}),
      ...(frame.name !== undefined ? {name: frame.name} : {}),
      ...((frame as any).time !== undefined ? {time: (frame as any).time} : {}),
      aabb: frameAABB,
      positionsCompressed: quantizePositions3(frame.positions, frameAABB),
      normalsCompressed:
        frame.normals && frame.normals.length === frame.positions.length
          ? octEncodeNormalsToU16(frame.normals)
          : undefined,
      uvsCompressed:
        frame.uvs && frame.uvs.length === expectedFrameUvLen
          ? packUVsToFloat32(frame.uvs)
          : undefined
    };
  });
  const framesCompressed = geometryParams.frames ? vertexStatesCompressed : undefined;
  const texCoordsCompressed = compressTexCoordChannels(geometryParams.texCoords, geometryParams.uvs, basePositions.length / 3 * 2);
  const morphTargets = geometryParams.morphTargets?.map((target) => ({
    ...(target.id !== undefined ? {id: target.id} : {}),
    ...(target.name !== undefined ? {name: target.name} : {}),
    ...(target.positions !== undefined ? {positions: target.positions} : {}),
    ...(target.normals !== undefined ? {normals: target.normals} : {}),
    ...(target.uvs !== undefined ? {uvs: target.uvs} : {})
  }));
  if (geometryParams.primitive === PointsPrimitive) {
    return {
      id: geometryParams.id,
      primitive: PointsPrimitive,
      uvsCompressed: texCoordsCompressed?.[0],
      texCoordsCompressed,
      aabb,
      uvsDecompressMatrix: undefined,
      positionsCompressed,
      framesCompressed,
      vertexStatesCompressed,
      morphTargets,
      colorsCompressed: geometryParams.colorsCompressed ? geometryParams.colorsCompressed : (geometryParams.colors ? compressRGBColors(geometryParams.colors) : null),
      origin: rtcNeeded ? rtcCenter : null
    };
  }
  if (geometryParams.primitive === GaussianSplatsPrimitive) {
    // Splats: quantize centres + carry baked RGBA like points, plus the per-splat
    // scales/rotations (uncompressed in P1). Covariance is derived GPU-side.
    return {
      id: geometryParams.id,
      primitive: GaussianSplatsPrimitive,
      uvsCompressed: texCoordsCompressed?.[0],
      texCoordsCompressed,
      aabb,
      positionsCompressed,
      framesCompressed,
      vertexStatesCompressed,
      morphTargets,
      colorsCompressed: geometryParams.colorsCompressed ? geometryParams.colorsCompressed : (geometryParams.colors ? compressRGBColors(geometryParams.colors) : null),
      scales: geometryParams.scales,
      rotations: geometryParams.rotations,
      origin: rtcNeeded ? rtcCenter : null
    };
  }
  if (geometryParams.primitive === LinesPrimitive) {
    return {
      id: geometryParams.id,
      primitive: LinesPrimitive,
      uvsCompressed: texCoordsCompressed?.[0],
      texCoordsCompressed,
      aabb,
      positionsCompressed,
      framesCompressed,
      vertexStatesCompressed,
      morphTargets,
      colorsCompressed: geometryParams.colorsCompressed ? geometryParams.colorsCompressed : (geometryParams.colors ? compressRGBColors(geometryParams.colors) : undefined),
      indices: geometryParams.indices,
      origin: rtcNeeded ? rtcCenter : null
    };
  } else {
    // For triangle-family geometries, auto-build feature edges. The
    // builder returns an EMPTY typed array when every interior edge
    // is too smooth to count (typical of a single fully-coplanar
    // tessellation — e.g. an earcut'd 2D polygon at z=0, which is
    // common in drawing/SVG/PDF imports) AND every triangle's edge
    // is shared with a neighbour. Collapse that to `null` so
    // downstream consumers (specifically the WebGLRenderer's edge
    // portion allocator, which rejects size=0) see "no edges" as a
    // first-class state rather than an empty buffer to upload.
    let edgeIndices: IntArrayParam | ReturnType<typeof buildEdgeIndices> | null = geometryParams.edgeIndices ?? null;
    if ((geometryParams.primitive === SolidPrimitive
      || geometryParams.primitive === SurfacePrimitive
      || geometryParams.primitive === TrianglesPrimitive) && geometryParams.indices && !edgeIndices) {
      const built = buildEdgeIndices(positionsCompressed, geometryParams.indices, aabb, 10);
      if (built && built.length > 0) edgeIndices = built;
    }
    // Encode normals only when supplied and length-matched against positions.
    const normalsCompressed =
      baseNormals && baseNormals.length === basePositions.length
        ? octEncodeNormalsToU16(baseNormals)
        : undefined;
    // UVs ship to the GPU as RG32F so tiling values (UVs outside [0, 1])
    // survive intact — the shader applies fract() per-fragment before
    // sampling the atlas, which is what makes tiled materials work.
    // Mismatched lengths degrade to no-UVs rather than abort.
    const uvsCompressed = texCoordsCompressed?.[0];
    return { // Assume that closed triangle mesh is decomposed into open surfaces
      id: geometryParams.id,
      primitive: geometryParams.primitive,
      aabb,
      positionsCompressed,
      framesCompressed,
      vertexStatesCompressed,
      morphTargets,
      normalsCompressed,
      uvsCompressed,
      texCoordsCompressed,
      colorsCompressed: geometryParams.colorsCompressed ? geometryParams.colorsCompressed : (geometryParams.colors ? compressRGBColors(geometryParams.colors) : undefined),
      indices: geometryParams.indices,
      edgeIndices,
      origin: rtcNeeded ? rtcCenter : null
    };
  }
}

function compressTexCoordChannels(
  texCoords: Record<number, FloatArrayParam> | undefined,
  uvs: FloatArrayParam | undefined,
  expectedLength: number
): Record<number, Float32Array> | undefined {
  const result: Record<number, Float32Array> = {};
  if (texCoords) {
    for (const key of Object.keys(texCoords)) {
      const channel = Number(key);
      const values = texCoords[channel];
      if (Number.isInteger(channel) && channel >= 0 && values && values.length === expectedLength) {
        result[channel] = packUVsToFloat32(values);
      }
    }
  }
  if (uvs && uvs.length === expectedLength) {
    result[0] = packUVsToFloat32(uvs);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
