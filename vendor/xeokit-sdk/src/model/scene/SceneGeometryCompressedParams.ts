
import type {FloatArrayParam, IntArrayParam} from "../../base/math";
import type {AABB3} from "../../base/math/boundaries";
import type {Vec3} from "../../base/math/vector";
import type {Mat4} from "../../base/math/matrix";
import type {SceneGeometryMorphTargetParams} from "./SceneGeometryParams";

/**
 * One pre-compressed fixed-topology geometry frame.
 *
 * Frames carry complete replacement positions and optional normals/UVs, not deltas
 * from the base geometry. Topology, colors and other attributes remain
 * shared by the parent geometry. The first frame is used as the geometry's
 * current/base positions when
 * {@link SceneGeometryCompressedParams.positionsCompressed | positionsCompressed}
 * is omitted.
 */
export interface SceneGeometryVertexStateCompressedParams {

  /**
   * Stable optional ID for this complete vertex state.
   */
  id?: string;

  /**
   * Human-readable optional name.
   */
  name?: string;

  /**
   * Axis-aligned, non-quantized 3D boundary of this frame's vertex positions.
   */
  aabb: AABB3;

  /**
   * 3D vertex positions, quantized as 16-bit integers.
   */
  positionsCompressed: IntArrayParam;

  /**
   * Vertex normals, octahedral-encoded as pairs of 16-bit unsigned integers.
   */
  normalsCompressed?: IntArrayParam;

  /**
   * UV coordinates for this frame, packed as 32-bit floats.
   *
   * Optional. When supplied, length must equal `vertexCount * 2`.
   */
  uvsCompressed?: FloatArrayParam;
}

/**
 * @deprecated Use {@link SceneGeometryVertexStateCompressedParams}. Timing now
 * belongs to SceneAnimation vertex-state channels.
 */
export interface SceneGeometryFrameCompressedParams extends SceneGeometryVertexStateCompressedParams {
  /** @deprecated Timing belongs to SceneAnimation. */
  time?: number;
}

/**
 * Weighted morph target deltas relative to base compressed geometry.
 *
 * Deltas are currently stored as floating-point authoring data so format
 * loaders/exporters can preserve source morph semantics. Renderers may choose
 * an optimized GPU representation independently.
 */
export interface SceneGeometryMorphTargetCompressedParams {
  id?: string;
  name?: string;
  positions?: FloatArrayParam;
  normals?: FloatArrayParam;
  /** Unquantized channel-0 UV deltas. See {@link SceneGeometryMorphTargetParams.uvs}. */
  uvs?: FloatArrayParam;
}

/**
 * Pre-compressed geometry creation parameters for {@link SceneModel.createGeometryCompressed | SceneModel.createGeometryCompressed}.
 *
 * * Created from {@link SceneGeometryParams | SceneGeometryParams} using {@link compressGeometryParams | compressGeometryParams}
 * * Used with {@link SceneModel.createGeometryCompressed | SceneModel.createGeometryCompressed}
 * * Generates edge indices for triangle meshes
 * * Quantizes positions as 16-bit unsigned integers; UVs and morph deltas remain floating point
 * * Quantizes normals (when supplied) as octahedral pairs in 16-bit unsigned integers; geometry without
 *   normals continues to render with shader-derived flat normals
 *
 * See {@link model!scene | @xeokit/sdk/model/scene} for usage.
 */
export interface SceneGeometryCompressedParams {

  /**
   * ID for the geometry.
   */
  id: string;

  /**
   * Primitive type.
   *
   * Possible values are {@link base!constants.SolidPrimitive | SolidPrimitive}, {@link base!constants.SurfacePrimitive | SurfacePrimitive},
   * {@link base!constants.LinesPrimitive | LinesPrimitive}, {@link base!constants.PointsPrimitive | PointsPrimitive}
   * and {@link base!constants.TrianglesPrimitive | TrianglesPrimitive}.
   */
  primitive: number;

  /**
   * Axis-aligned, non-quantized 3D boundary of the geometry's current/base
   * vertex positions.
   *
   * Optional only when {@link SceneGeometryCompressedParams.framesCompressed | framesCompressed}
   * is supplied; in that case `framesCompressed[0].aabb` becomes the base AABB.
   */
  aabb?: AABB3;

  /**
   * 4x4 matrix to de-quantize the geometry's UV coordinates, when UVs are provided.
   */
  uvsDecompressMatrix?: Mat4;

  /**
   * 3D vertex positions, quantized as 16-bit integers.
   *
   * Internally, the Viewer decompresses these
   * with {@link SceneGeometryCompressedParams.aabb | SceneGeometryCompressedParams.aabb}.
   *
   * Optional only when {@link SceneGeometryCompressedParams.framesCompressed | framesCompressed}
   * is supplied; in that case `framesCompressed[0].positionsCompressed` becomes
   * the current/base geometry.
   */
  positionsCompressed?: IntArrayParam,

  /**
   * Complete fixed-topology geometry frames.
   *
   * When provided without {@link SceneGeometryCompressedParams.positionsCompressed | positionsCompressed},
   * the first frame supplies the geometry's current/base positions and normals.
   * Every frame must have the same vertex count as the base geometry. Frames
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
  framesCompressed?: SceneGeometryFrameCompressedParams[];

  /**
   * Complete untimed replacement vertex states.
   */
  vertexStatesCompressed?: SceneGeometryVertexStateCompressedParams[];

  /**
   * Weighted morph target deltas relative to the base geometry.
   */
  morphTargets?: SceneGeometryMorphTargetCompressedParams[];

  /**
   * UV coordinates, packed as 32-bit floats (one `Float32Array` of
   * length `2 × vertexCount`). UVs ship to the GPU uncompressed so
   * tiling values (UVs outside `[0, 1]`) survive intact — the shader
   * applies a per-fragment `fract()` before transforming into the
   * mesh's atlas sub-rect.
   */
  uvsCompressed?: FloatArrayParam,

  /**
   * Indexed texture-coordinate channels, packed as 32-bit floats.
   *
   * Keys are non-negative integer channel indices. Channel `0` is equivalent
   * to {@link SceneGeometryCompressedParams.uvsCompressed}; when both are
   * supplied, `uvsCompressed` takes precedence for channel `0`.
   */
  texCoordsCompressed?: Record<number, FloatArrayParam>;

  /**
   * vertex RGBA colors, quantized as 8-bit integers.
   */
  colorsCompressed?: IntArrayParam;

  /**
   * Vertex normals, octahedral-encoded as pairs of 16-bit unsigned integers.
   *
   * Optional. Two values per vertex: each pair represents the octahedral
   * (x, y) projection of the unit normal, mapped from `[-1, 1]` to
   * `[0, 65535]`. Length must equal the base vertex count times two.
   *
   * Geometry without `normalsCompressed` is rendered with shader-derived
   * flat face normals.
   */
  normalsCompressed?: IntArrayParam;

  /**
   * primitive indices.
   *
   * This is either an array of 8-bit, 16-bit or 32-bit values.
   */
  indices?: IntArrayParam,

  /**
   * edge indices.
   *
   * This is either an array of 8-bit, 16-bit or 32-bit values.
   */
  edgeIndices?: IntArrayParam;

  /**
   * Per-splat scales — 3 floats per splat. Only used for
   * {@link base!constants.GaussianSplatsPrimitive | GaussianSplatsPrimitive}. Carried uncompressed in P1.
   */
  scales?: FloatArrayParam;

  /**
   * Per-splat rotation quaternions — 4 floats per splat, `xyzw`. Only used for
   * {@link base!constants.GaussianSplatsPrimitive | GaussianSplatsPrimitive}. Carried uncompressed in P1.
   */
  rotations?: FloatArrayParam;

  /**
   * Optional RTC origin for the compressed vertex positions. When present,
   * renderers add this world-space offset after decompressing positions from
   * {@link SceneGeometryCompressedParams.aabb | SceneGeometryCompressedParams.aabb}.
   */
  origin?: Vec3;
}
