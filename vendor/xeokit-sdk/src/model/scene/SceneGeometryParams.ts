import type {FloatArrayParam, IntArrayParam} from "../../base/math";

/**
 * One fixed-topology geometry frame for {@link SceneGeometryParams.frames}.
 *
 * A frame is a complete replacement vertex state, not a delta from the base
 * geometry. Frames can replace the ordinary authoring-time `positions` /
 * `normals` / `uvs` arrays for geometry supplied as a fixed-topology sequence. The
 * first frame is used as the geometry's current/base positions when
 * {@link SceneGeometryParams.positions | positions} is omitted.
 */
export interface SceneGeometryVertexStateParams {

  /**
   * Stable optional ID for this complete vertex state.
   */
  id?: string;

  /**
   * Human-readable optional name.
   */
  name?: string;

  /**
   * Flat array of uncompressed floating point 3D vertex positions.
   */
  positions: FloatArrayParam;

  /**
   * Flat array of uncompressed floating-point 3D vertex normals.
   *
   * Optional. When supplied, length must equal `positions.length`.
   */
  normals?: FloatArrayParam;

  /**
   * Flat array of uncompressed floating-point UV coordinates.
   *
   * Optional. When supplied, length must equal `positions.length / 3 * 2`.
   * When every frame supplies UVs, renderers interpolate them; when omitted,
   * renderers use the base/static geometry UVs when available.
   */
  uvs?: FloatArrayParam;
}

/**
 * Backwards-compatible name for older complete timed geometry frames.
 *
 * @deprecated Use {@link SceneGeometryVertexStateParams}. Timing now belongs
 * to SceneAnimation vertex-state channels.
 */
export interface SceneGeometryFrameParams extends SceneGeometryVertexStateParams {
  /** @deprecated Timing belongs to SceneAnimation. */
  time?: number;
}

/**
 * Weighted morph target deltas relative to base geometry.
 */
export interface SceneGeometryMorphTargetParams {
  id?: string;
  name?: string;
  positions?: FloatArrayParam;
  normals?: FloatArrayParam;
  /**
   * Channel-0 UV deltas, two finite values per vertex, relative to the base
   * geometry's `uvs` (or `texCoords[0]`). Requires that base UV channel.
   * Uses the same mesh morph weights as positions/normals. Neither deltas nor
   * evaluated coordinates are clamped or wrapped; the texture sampler owns wrapping.
   * May be supplied without position or normal deltas.
   */
  uvs?: FloatArrayParam;
}

/**
 * Non-compressed geometry parameters for {@link SceneModel.createGeometry | SceneModel.createGeometry}.
 *
 * * Contains uncompressed, human-readable geometry parameters for {@link SceneModel.createGeometry | SceneModel.createGeometry}
 * * Use {@link compressGeometryParams | compressGeometryParams} to compress these params into
 * {@link SceneGeometryCompressedParams | SceneGeometryCompressedParams} for
 * {@link SceneModel.createGeometryCompressed | SceneModel.createGeometryCompressed}
 *
 * See {@link model!scene | @xeokit/sdk/model/scene} for usage.
 */
export interface SceneGeometryParams {

  /**
   * ID for the geometry.
   */
  id: string;

  /**
   * Primitive type.
   *
   * Accepted values are {@link base!constants.SolidPrimitive | SolidPrimitive}, {@link base!constants.SurfacePrimitive | SurfacePrimitive},
   * {@link base!constants.LinesPrimitive | LinesPrimitive}, {@link base!constants.PointsPrimitive | PointsPrimitive}
   * and {@link base!constants.TrianglesPrimitive | TrianglesPrimitive}.
   */
  primitive: number;

  /**
   * Flat array of uncompressed floating point 3D vertex positions.
   *
   * Optional only when {@link SceneGeometryParams.frames | frames} is supplied;
   * in that case `frames[0].positions` becomes the current/base geometry.
   */
  positions?: FloatArrayParam;

  /**
   * Flat array of uncompressed floating-point 3D vertex normals.
   *
   * Optional. When supplied, the renderer uses these for smooth shading;
   * when omitted, the fragment shader derives a flat face normal from
   * position derivatives.
   *
   * Length must equal the base position array length. Ignored for
   * `LinesPrimitive` and `PointsPrimitive`.
   */
  normals?: FloatArrayParam;

  /**
   * Complete fixed-topology geometry frames.
   *
   * When provided without {@link SceneGeometryParams.positions | positions}, the
   * first frame supplies the geometry's current/base positions and normals.
   * Every frame must have the same position count as the base geometry. Frames
   * share the geometry's topology, colors, material assignment and other
   * non-position attributes. UVs may either remain static on the parent
   * geometry or be supplied by every frame. Frame times must be finite and
   * strictly increasing.
   *
   * Frames are immutable geometry-owned data. A mesh chooses an interpolation
   * time with {@link SceneMeshParams.frameTime | SceneMeshParams.frameTime}, so
   * multiple meshes can share this geometry while sampling different frame
   * times. When every frame supplies normals, renderers interpolate and
   * normalize them. When every frame supplies UVs, renderers interpolate them.
   * When frames omit normals or UVs, renderers use the base/static attributes
   * when available.
   */
  frames?: SceneGeometryFrameParams[];

  /**
   * Complete fixed-topology replacement vertex states.
   *
   * Vertex states are untimed authored geometry states. They contain complete
   * replacement attributes, not deltas. Animation timing is represented by
   * SceneAnimation vertex-state channels, not on the geometry state itself.
   */
  vertexStates?: SceneGeometryVertexStateParams[];

  /**
   * Weighted morph target deltas relative to the base geometry.
   *
   * Unlike {@link SceneGeometryParams.vertexStates | vertexStates}, morph
   * targets store deltas and are combined by per-mesh weights:
   * `base + sum(delta * weight)`.
   */
  morphTargets?: SceneGeometryMorphTargetParams[];

  /*
    * Flat array of uncompressed floating-point vertex UV coordinates.
    *
    * This is channel `0`. For additional indexed texture-coordinate channels,
    * use {@link SceneGeometryParams.texCoords}.
    */
  uvs?: FloatArrayParam;

  /**
   * Indexed texture-coordinate channels.
   *
   * Keys are non-negative integer channel indices. Each value is a flat
   * `[u, v, u, v, ...]` array with length `2 * vertexCount`.
   *
   * Channel `0` is equivalent to {@link SceneGeometryParams.uvs}; when both
   * are supplied, `uvs` takes precedence for channel `0`.
   */
  texCoords?: Record<number, FloatArrayParam>;

  /**
   * Flat array of uncompressed RGBA floating-point vertex colors.
   * Each color is represented as four consecutive floats in the order RGBA,
   * where each component is in the range [0.0, 1.0].
   */
  colors?: FloatArrayParam;

  /**
   * Flat array of compressed integer RGBA vertex colors. This overrides the `colors` parameter.
   * Each color is represented as four consecutive 8-bit unsigned integers in the order RGBA,
   * where each component is in the range [0, 255].
   */
  colorsCompressed?: IntArrayParam;

  /**
   * Flat array of primitive connectivity indices.
   *
   * Ignored for primitive type {@link base!constants.PointsPrimitive | PointsPrimitive}, which does not need indices.
   */
  indices?: IntArrayParam;

  /**
   * Flat array of triangle-mesh edge connectivity indices.
   *
   * When supplied for triangle-family primitives, renderers use these for
   * edge rendering and edge snapping instead of deriving feature edges from
   * triangle connectivity.
   */
  edgeIndices?: IntArrayParam;

  /**
   * Flat array of per-splat scales — 3 floats per splat (the per-axis gaussian
   * std-devs). Only used for {@link base!constants.GaussianSplatsPrimitive | GaussianSplatsPrimitive}.
   */
  scales?: FloatArrayParam;

  /**
   * Flat array of per-splat rotation quaternions — 4 floats per splat, `xyzw`.
   * Only used for {@link base!constants.GaussianSplatsPrimitive | GaussianSplatsPrimitive}.
   */
  rotations?: FloatArrayParam;
}
