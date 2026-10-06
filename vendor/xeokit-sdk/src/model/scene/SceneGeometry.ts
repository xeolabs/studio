import {type AABB3Float32, createAABB3Float32} from "../../base/math/boundaries";
import type {FloatArrayParam, IntArrayParam} from "../../base/math";
import type {SceneGeometryCompressedParams} from "./SceneGeometryCompressedParams";
import {SceneModel} from "./SceneModel";
import {SDKErrorType, type SDKResult} from "../../base/core";
import type {Mat4} from "../../base/math/matrix";
import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, SolidPrimitive, SurfacePrimitive, TrianglesPrimitive} from "../../base/constants";

export const SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED = 1 << 0;
export const SCENE_GEOMETRY_UPDATE_INDICES = 1 << 1;
export const SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED = 1 << 2;
export const SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED = 1 << 3;

/**
 * Stores an index array in the smallest integer type that can hold its values.
 *
 * Indices address a geometry's own vertices, so they fit `Uint8` when every
 * value is < 256 and `Uint16` when < 65536 — the common case, since most
 * geometries have few vertices. Loaders typically hand over `Uint32`, so this
 * halves (or quarters) the retained index/edge memory. The renderer copies
 * these into its 32-bit index texture on upload (widening as needed), and CPU
 * picking reads them as plain integers, so a narrower type is transparent to
 * both.
 *
 * The type is chosen from the actual maximum value (not the vertex count), so
 * it is correct regardless of how the caller sized the array. Returns the input
 * unchanged when absent, empty, or already no wider than required.
 */
function narrowIndexArray(indices?: IntArrayParam): IntArrayParam | undefined {
  if (!indices || indices.length === 0) {
    return indices;
  }
  let max = 0;
  for (let i = 0, len = indices.length; i < len; i++) {
    if (indices[i] > max) {
      max = indices[i];
    }
  }
  const targetBytes = max < 256 ? 1 : max < 65536 ? 2 : 4;
  if (ArrayBuffer.isView(indices) && (indices as {BYTES_PER_ELEMENT?: number}).BYTES_PER_ELEMENT! <= targetBytes) {
    return indices; // already as narrow as (or narrower than) needed — no copy
  }
  const src = indices as ArrayLike<number>;
  const narrowed: IntArrayParam =
    targetBytes === 1 ? new Uint8Array(src)
      : targetBytes === 2 ? new Uint16Array(src)
        : new Uint32Array(src);
  return narrowed;
}

/**
 * A geometry in a {@link SceneModel | SceneModel}.
 *
 * * Contains triangles, lines or points
 * * Stored in {@link SceneModel.geometries | SceneModel.geometries}
 * * Created with {@link SceneModel.createGeometry | SceneModel.createGeometry}
 * or {@link SceneModel.createGeometryCompressed | SceneModel.createGeometryCompressed}
 * * Referenced by {@link SceneMesh.geometry | SceneMesh.geometry}
 *
 * See {@link model!scene | @xeokit/sdk/model/scene}  for usage.
 */
export class SceneGeometry {

  /**
   * ID for the geometry.
   */
  readonly id: string;

  /**
   * The global ID of this SceneGeometry, unique among all SceneGeometrys within the Scene,
   * which is the concatenation of the SceneModel's ID and this SceneGeometry's ID, separated by "__".
   */
  readonly uniqueId: string;

  /**
   * The SceneModel that contains this SceneGeometry.
   */
  readonly model: SceneModel;

  /**
   * Primitive type.
   *
   * Possible values are {@link base!constants.SolidPrimitive | SolidPrimitive}, {@link base!constants.SurfacePrimitive | SurfacePrimitive},
   * {@link base!constants.LinesPrimitive | LinesPrimitive}, {@link base!constants.PointsPrimitive | PointsPrimitive}
   * and {@link base!constants.TrianglesPrimitive | TrianglesPrimitive}.
   */
  readonly primitive: number;

  /**
   * Axis-aligned, non-quantized 3D boundary of the geometry's vertex positions.
   */
  aabb?: AABB3Float32;

  /**
   * 4x4 matrix to de-quantize the geometry's UV coordinates, when UVs are provided.
   */
  readonly uvsDecompressMatrix?: Mat4;

  /**
   * Current/base 3D vertex positions, quantized as 16-bit integers.
   *
   * Internally, the Viewer dequantizes these using {@link SceneGeometry.aabb | SceneGeometry.aabb}, which provides their unquantized 3D boundary.
   *
   * When geometry was authored with {@link SceneGeometry.framesCompressed | framesCompressed}
   * and no top-level positions, this is initialized from frame zero.
   */
  private _positionsCompressed: IntArrayParam;
  private _indices?: IntArrayParam;
  private _normalsCompressed?: IntArrayParam;
  private _uvsCompressed?: FloatArrayParam;

  /**
   * Complete fixed-topology geometry frames, each carrying replacement
   * positions and optional normals. These are complete vertex states, not
   * deltas from the base geometry. The first frame can act as the geometry's
   * current/base positions when the geometry was authored without top-level
   * `positions`.
   *
   * Renderers treat frames as immutable geometry-owned data. Meshes select an
   * interpolation time through {@link SceneMesh.frameTime}; changing that time
   * updates per-mesh animation state, not the shared geometry payload.
   */
  readonly framesCompressed?: SceneGeometryCompressedParams["framesCompressed"];

  /**
   * Complete untimed fixed-topology replacement vertex states.
   */
  readonly vertexStatesCompressed?: SceneGeometryCompressedParams["vertexStatesCompressed"];

  /**
   * Weighted morph target deltas relative to this geometry's base attributes.
   */
  readonly morphTargets?: SceneGeometryCompressedParams["morphTargets"];

  /**
   * Monotonically increases each time fixed-count dynamic geometry data is
   * replaced through {@link SceneGeometry.positionsCompressed} or
   * {@link SceneGeometry.indices}, {@link SceneGeometry.normalsCompressed} or
   * {@link SceneGeometry.uvsCompressed}.
   */
  version: number = 0;

  /**
   * Bitmask describing the most recent fixed-count dynamic update. Renderers
   * use this during {@link SceneEvents.onSceneGeometryUpdated} to choose a
   * narrow in-place upload path when possible.
   */
  lastUpdateFlags: number = 0;

  /**
   * UV coordinates, packed as 32-bit floats (one `Float32Array` of
   * length `2 × vertexCount`). UVs ship to the GPU uncompressed so
   * tiling values (UVs outside `[0, 1]`) survive intact — the shader
   * applies a per-fragment `fract()` before transforming into the
   * mesh's atlas sub-rect.
   *
   * Assigning replaces channel zero on a dynamic model. UVs must already
   * exist, keep the same length, and contain only finite values. Values outside
   * `[0, 1]` are supported. A successful update synchronizes channel zero in
   * {@link SceneGeometry.texCoordsCompressed}, increments {@link SceneGeometry.version}
   * and dispatches {@link SceneEvents.onSceneGeometryUpdated} for in-place upload.
   * Mutating the returned array alone does not notify renderers.
   */
  get uvsCompressed(): FloatArrayParam | undefined {
    return this._uvsCompressed;
  }

  set uvsCompressed(uvsCompressed: FloatArrayParam | undefined) {
    let error: string | undefined;
    let type = SDKErrorType.InvalidInput;
    if (this.destroyed) {
      error = "SceneGeometry already destroyed";
      type = SDKErrorType.InvalidOperation;
    } else if (this.model.updateMode !== "dynamic") {
      error = 'The parent SceneModel must use updateMode: "dynamic".';
      type = SDKErrorType.InvalidOperation;
    } else if (!this._uvsCompressed) {
      error = "Cannot assign UVs to geometry that was created without UVs.";
      type = SDKErrorType.InvalidOperation;
    } else if (!uvsCompressed || uvsCompressed.length !== this._uvsCompressed.length) {
      error = `Expected ${this._uvsCompressed.length} UV components, got ${uvsCompressed?.length ?? 0}.`;
    } else {
      for (let i = 0; i < uvsCompressed.length; i++) {
        if (!Number.isFinite(uvsCompressed[i])) {
          error = "UV components must be finite.";
          break;
        }
      }
    }
    if (error) {
      this.model.scene.logError({ok: false, type, error: `[SceneGeometry.uvsCompressed] ${error}`});
      return;
    }
    this._uvsCompressed = uvsCompressed!;
    this.texCoordsCompressed![0] = uvsCompressed!;
    this.version++;
    this.lastUpdateFlags = SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED;
    this.model.scene.events.onSceneGeometryUpdated.dispatch(this.model.scene, this);
  }

  /**
   * Indexed texture-coordinate channels, packed as 32-bit floats.
   *
   * Channel `0` is equivalent to {@link SceneGeometry.uvsCompressed}.
   */
  readonly texCoordsCompressed?: Record<number, FloatArrayParam>;

  /**
   * Vertex RGBA colors, quantized as 8-bit integers.
   */
  readonly colorsCompressed?: IntArrayParam;

  /**
   * Vertex normals, octahedral-encoded as pairs of 16-bit unsigned integers.
   *
   * When defined, the renderer reads these per-vertex and uses them for
   * smooth shading; when undefined, fragments derive a flat face normal
   * from view-space position derivatives.
   */
  get normalsCompressed(): IntArrayParam | undefined {
    return this._normalsCompressed;
  }

  /**
   * Primitive indices.
   *
   * This is either an array of 8-bit, 16-bit or 32-bit values.
   */
  get indices(): IntArrayParam | undefined {
    return this._indices;
  }

  /**
   * Edge indices.
   *
   * This is either an array of 8-bit, 16-bit or 32-bit values.
   */
  readonly edgeIndices?: IntArrayParam;

  /**
   * Per-splat scales — 3 floats per splat. Only present for
   * {@link base!constants.GaussianSplatsPrimitive | GaussianSplatsPrimitive} geometry.
   */
  readonly scales?: FloatArrayParam;

  /**
   * Per-splat rotation quaternions — 4 floats per splat, `xyzw`. Only present for
   * {@link base!constants.GaussianSplatsPrimitive | GaussianSplatsPrimitive} geometry.
   */
  readonly rotations?: FloatArrayParam;

  /**
   * The count of {@link SceneMesh | SceneMeshes} that reference this SceneGeometry.
   */
  numMeshes: number;

  /**
   * True if this SceneGeometry has been destroyed.
   */
  destroyed: boolean = false;

  /**
   * @private
   */
  constructor(model: SceneModel, params: SceneGeometryCompressedParams) {
    this.model = model;
    this.id = params.id;
    this.uniqueId = `${model.id}__${this.id}`;
    this.primitive = params.primitive;
    this._positionsCompressed = params.positionsCompressed!;
    this.vertexStatesCompressed = params.vertexStatesCompressed ?? params.framesCompressed;
    this.framesCompressed = params.framesCompressed ?? (
      params.vertexStatesCompressed?.some((state: any) => state.time !== undefined)
        ? params.vertexStatesCompressed as SceneGeometryCompressedParams["framesCompressed"]
        : undefined
    );
    this.morphTargets = params.morphTargets;
    this.texCoordsCompressed = normalizeTexCoordsCompressed(params.texCoordsCompressed, params.uvsCompressed);
    this._uvsCompressed = this.texCoordsCompressed?.[0] ?? params.uvsCompressed;
    this.colorsCompressed = params.colorsCompressed;
    this._normalsCompressed = params.normalsCompressed;
    this._indices = narrowIndexArray(params.indices);
    this.edgeIndices = narrowIndexArray(params.edgeIndices);
    this.scales = params.scales;
    this.rotations = params.rotations;
    this.aabb = createAABB3Float32(params.aabb);
    this.numMeshes = 0;
  }

  /**
   * Gets or sets 3D vertex positions, quantized as 16-bit integers.
   *
   * Assigning this property is a fixed-topology dynamic update. The new array
   * must have the same length as the original positions array and the parent
   * {@link SceneModel} must use `updateMode: "dynamic"`. On success xeokit
   * bumps {@link SceneGeometry.version} and dispatches
   * {@link SceneEvents.onSceneGeometryUpdated}; renderers and BVH-backed
   * picking can then refresh their buffers from the new compressed positions.
   *
   * The geometry AABB is not changed by this setter. Quantize replacement
   * positions against the existing {@link SceneGeometry.aabb}; recreate the
   * geometry when the dynamic range or topology needs to change.
   *
   * This does not regenerate normals or edge indices. Use geometries without
   * explicit normals for flat derivative-based shading, or recreate geometry
   * when topology-derived attributes need to change.
   */
  get positionsCompressed(): IntArrayParam {
    return this._positionsCompressed;
  }

  set positionsCompressed(positionsCompressed: IntArrayParam) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.positionsCompressed] SceneGeometry already destroyed"
      });
      return;
    }
    if (!positionsCompressed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.positionsCompressed] Missing required value."
      });
      return;
    }
    if (this.model.updateMode !== "dynamic") {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.positionsCompressed] The parent SceneModel must use updateMode: \"dynamic\"."
      });
      return;
    }
    if (positionsCompressed.length !== this._positionsCompressed.length) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneGeometry.positionsCompressed] Expected ${this._positionsCompressed.length} position components, got ${positionsCompressed.length}.`
      });
      return;
    }
    if (positionsCompressed.length % 3 !== 0) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.positionsCompressed] Length must be a multiple of 3."
      });
      return;
    }

    this._positionsCompressed = positionsCompressed;
    this.version++;
    this.lastUpdateFlags = SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED;
    this.model.scene.events.onSceneGeometryUpdated.dispatch(this.model.scene, this);
  }

  /**
   * Gets or sets primitive connectivity indices.
   *
   * Assigning this property is a fixed-topology dynamic update. The replacement
   * array must have the same number of indices as the existing array and the
   * parent {@link SceneModel} must use `updateMode: "dynamic"`. On success
   * xeokit stores a narrowed copy when possible, bumps
   * {@link SceneGeometry.version} and dispatches
   * {@link SceneEvents.onSceneGeometryUpdated}; renderers can then refresh
   * their DTX/VBO/WebGPU buffers and picking structures from the new
   * connectivity.
   *
   * This does not regenerate normals or edge indices. Use flat
   * derivative-based shading and omit edge indices for fully dynamic topology,
   * or recreate geometry when topology-derived attributes need to change.
   */
  set indices(indices: IntArrayParam | undefined) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.indices] SceneGeometry already destroyed"
      });
      return;
    }
    if (this.model.updateMode !== "dynamic") {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.indices] The parent SceneModel must use updateMode: \"dynamic\"."
      });
      return;
    }
    if (!this._indices) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.indices] Cannot assign indices to geometry that was created without indices."
      });
      return;
    }
    if (!indices) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.indices] Missing required value."
      });
      return;
    }
    if (indices.length !== this._indices.length) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneGeometry.indices] Expected ${this._indices.length} indices, got ${indices.length}.`
      });
      return;
    }
    if (this.primitive === LinesPrimitive && indices.length % 2 !== 0) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.indices] Length must be a multiple of 2 for line geometry."
      });
      return;
    }
    if (
      (this.primitive === TrianglesPrimitive || this.primitive === SolidPrimitive || this.primitive === SurfacePrimitive) &&
      indices.length % 3 !== 0
    ) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.indices] Length must be a multiple of 3 for triangle geometry."
      });
      return;
    }
    if (this.primitive === PointsPrimitive || this.primitive === GaussianSplatsPrimitive) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.indices] Cannot assign indices to point or Gaussian splat geometry."
      });
      return;
    }

    const vertexCount = this._positionsCompressed.length / 3;
    for (let i = 0, len = indices.length; i < len; i++) {
      const index = indices[i];
      if (index < 0 || index >= vertexCount) {
        this.model.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneGeometry.indices] Indices out of range of vertex positions."
        });
        return;
      }
      if (this.uvsCompressed) {
        const uvCount = this.uvsCompressed.length / 2;
        if (index >= uvCount) {
          this.model.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: "[SceneGeometry.indices] Indices out of range of vertex UVs."
          });
          return;
        }
      }
    }

    this._indices = narrowIndexArray(indices);
    this.version++;
    this.lastUpdateFlags = SCENE_GEOMETRY_UPDATE_INDICES;
    this.model.scene.events.onSceneGeometryUpdated.dispatch(this.model.scene, this);
  }

  /**
   * Gets or sets octahedral-encoded vertex normals.
   *
   * Assigning this property is a fixed-count dynamic update. The replacement
   * array must have the same length as the existing normal array and the parent
   * {@link SceneModel} must use `updateMode: "dynamic"`. On success xeokit
   * bumps {@link SceneGeometry.version} and dispatches
   * {@link SceneEvents.onSceneGeometryUpdated}; renderers can then refresh
   * their normal buffers or textures without rebuilding the mesh.
   *
   * This does not recalculate normals from positions or indices. Fluid and
   * surface simulations that need smooth dynamic lighting should update this
   * alongside {@link SceneGeometry.positionsCompressed}.
   */
  set normalsCompressed(normalsCompressed: IntArrayParam | undefined) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.normalsCompressed] SceneGeometry already destroyed"
      });
      return;
    }
    if (this.model.updateMode !== "dynamic") {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.normalsCompressed] The parent SceneModel must use updateMode: \"dynamic\"."
      });
      return;
    }
    if (!this._normalsCompressed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.normalsCompressed] Cannot assign normals to geometry that was created without normals."
      });
      return;
    }
    if (!normalsCompressed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.normalsCompressed] Missing required value."
      });
      return;
    }
    if (normalsCompressed.length !== this._normalsCompressed.length) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneGeometry.normalsCompressed] Expected ${this._normalsCompressed.length} normal components, got ${normalsCompressed.length}.`
      });
      return;
    }
    if (normalsCompressed.length % 2 !== 0) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.normalsCompressed] Length must be a multiple of 2."
      });
      return;
    }
    if (normalsCompressed.length / 2 !== this._positionsCompressed.length / 3) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneGeometry.normalsCompressed] Normal count must match vertex count."
      });
      return;
    }

    this._normalsCompressed = normalsCompressed;
    this.version++;
    this.lastUpdateFlags = SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED;
    this.model.scene.events.onSceneGeometryUpdated.dispatch(this.model.scene, this);
  }

  /**
   * Gets this SceneGeometry as SceneGeometryCompressedParams.
   */
  toParams(): SDKResult<SceneGeometryCompressedParams> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.toParams] SceneGeometry already destroyed"
      });
    }
    const params = <SceneGeometryCompressedParams>{
      id: this.id,
      primitive: this.primitive,
      aabb: Array.from(this.aabb),
      positionsCompressed: Array.from(this.positionsCompressed)
    };
    if (this.positionsCompressed) {
      params.positionsCompressed = Array.from(this.positionsCompressed);
    }
    if (this.uvsCompressed) {
      params.uvsCompressed = Array.from(this.uvsCompressed);
    }
    if (this.texCoordsCompressed) {
      params.texCoordsCompressed = {};
      for (const key of Object.keys(this.texCoordsCompressed)) {
        const channel = Number(key);
        params.texCoordsCompressed[channel] = Array.from(this.texCoordsCompressed[channel]);
      }
    }
    if (this.colorsCompressed) {
      params.colorsCompressed = Array.from(this.colorsCompressed);
    }
    if (this.normalsCompressed) {
      params.normalsCompressed = Array.from(this.normalsCompressed);
    }
    if (this.indices) {
      params.indices = Array.from(this.indices);
    }
    if (this.edgeIndices) {
      params.edgeIndices = Array.from(this.edgeIndices);
    }
    if (this.scales) {
      params.scales = Array.from(this.scales);
    }
    if (this.rotations) {
      params.rotations = Array.from(this.rotations);
    }
    if (this.framesCompressed) {
      params.framesCompressed = this.framesCompressed.map((frame) => {
        const frameParams = {
          ...(frame.time !== undefined ? {time: frame.time} : {}),
          ...(frame.id !== undefined ? {id: frame.id} : {}),
          ...(frame.name !== undefined ? {name: frame.name} : {}),
          aabb: Array.from(frame.aabb),
          positionsCompressed: Array.from(frame.positionsCompressed)
        } as NonNullable<SceneGeometryCompressedParams["framesCompressed"]>[number];
        if (frame.normalsCompressed) {
          frameParams.normalsCompressed = Array.from(frame.normalsCompressed);
        }
        if (frame.uvsCompressed) {
          frameParams.uvsCompressed = Array.from(frame.uvsCompressed);
        }
        return frameParams;
      });
    }
    if (this.vertexStatesCompressed) {
      params.vertexStatesCompressed = this.vertexStatesCompressed.map((state) => {
        const stateParams = {
          ...(state.id !== undefined ? {id: state.id} : {}),
          ...(state.name !== undefined ? {name: state.name} : {}),
          ...((state as any).time !== undefined ? {time: (state as any).time} : {}),
          aabb: Array.from(state.aabb),
          positionsCompressed: Array.from(state.positionsCompressed)
        } as NonNullable<SceneGeometryCompressedParams["vertexStatesCompressed"]>[number];
        if (state.normalsCompressed) {
          stateParams.normalsCompressed = Array.from(state.normalsCompressed);
        }
        if (state.uvsCompressed) {
          stateParams.uvsCompressed = Array.from(state.uvsCompressed);
        }
        return stateParams;
      });
    }
    if (this.morphTargets) {
      params.morphTargets = this.morphTargets.map((target) => ({
        ...(target.id !== undefined ? {id: target.id} : {}),
        ...(target.name !== undefined ? {name: target.name} : {}),
        ...(target.positions !== undefined ? {positions: Array.from(target.positions)} : {}),
        ...(target.normals !== undefined ? {normals: Array.from(target.normals)} : {}),
        ...(target.uvs !== undefined ? {uvs: Array.from(target.uvs)} : {})
      }));
    }
    return {
      ok: true,
      value: params
    };
  }

  /**
   * Destroys this SceneGeometry.
   */
  destroy(): SDKResult<void> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneGeometry.destroy] SceneGeometry already destroyed"
      });
    }
    if (this.numMeshes > 0) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneGeometry.destroy] Cannot destroy SceneGeometry ${this.id} - SceneGeometry is currently used by at least one SceneMesh, which you need to destroy first`
      });
    }
    this.model._destroyGeometry(this);
    this.destroyed = true;
    return {
      ok: true,
      value: undefined
    };
  }
}

function normalizeTexCoordsCompressed(
  texCoordsCompressed: Record<number, FloatArrayParam> | undefined,
  uvsCompressed: FloatArrayParam | undefined
): Record<number, FloatArrayParam> | undefined {
  const normalized: Record<number, FloatArrayParam> = {};
  if (texCoordsCompressed) {
    for (const key of Object.keys(texCoordsCompressed)) {
      const channel = Number(key);
      if (Number.isInteger(channel) && channel >= 0 && texCoordsCompressed[channel]) {
        normalized[channel] = texCoordsCompressed[channel];
      }
    }
  }
  if (uvsCompressed) {
    normalized[0] = uvsCompressed;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
