import type {SceneGeometryCompressedParams} from "./SceneGeometryCompressedParams";
import type {SceneGeometryParams} from "./SceneGeometryParams";
import type {SceneMeshParams} from "./SceneMeshParams";
import type {SceneObjectParams} from "./SceneObjectParams";
import type {SceneTextureParams} from "./SceneTextureParams";
import type {SceneMaterialParams} from "./SceneMaterialParams";
import type {CoordinateSystemParams} from "./CoordinateSystemParams";
import type  {  Vec3} from "../../base/math/vector";
import type  {Mat4} from "../../base/math/matrix";
import type {Quat} from "../../base/math/quat";
import type {SceneTransformParams} from "./SceneTransformParams";
import type {SceneVariantSetParams} from "./variant/SceneVariantSetParams";
import type {SceneAnimationParams} from "./animation";

/**
 * Describes how a {@link model!scene.SceneModel | SceneModel}'s topology is
 * expected to be populated before it is sealed.
 *
 * `open` and `streaming` both allow component creation and
 * {@link model!scene.SceneModel.commitBatch | commitBatch}. The difference is
 * intent: `open` is ordinary ad-hoc authoring, while `streaming` tells renderers
 * that committed batches are expected to keep arriving over time.
 *
 * The terminal closed state is represented by
 * {@link model!scene.SceneModel.sealed | sealed}, not by changing this
 * loading mode.
 */
export type SceneModelLoadingMode = "open" | "streaming";

/**
 * Renderer-neutral update intent for a {@link model!scene.SceneModel | SceneModel}.
 *
 * This describes how stable the model's renderer-facing values are expected to
 * be after the model has been populated. Renderer-facing values are the parts
 * of the model that a renderer may cache, upload or reorganize for drawing,
 * such as mesh transforms, object visibility, selection state, colors, opacity
 * and other per-object or per-mesh values. Adding new geometry or new objects is
 * described separately by {@link model!scene.SceneModelLoadingMode | SceneModelLoadingMode}.
 *
 * Use `"auto"` when the application does not know the model's update pattern,
 * or when the renderer defaults are good enough. Use `"static"` for models that
 * are loaded or authored once and then mostly inspected. Use `"dynamic"` for
 * models whose renderer-facing values are expected to change often after
 * creation, for example animated, frequently recolored, interactively edited or
 * state-driven content.
 *
 * Renderers use this value as an intent signal, not as a renderer-specific
 * configuration object. WebGL and WebGPU may map the same update mode to
 * different internal storage choices, such as VBO-backed or data-texture-backed
 * geometry in WebGL, or compact or append-friendly model memory policies in
 * WebGPU. Applications that need deeper tuning should configure renderer-owned
 * update-mode policies on the renderer, while keeping SceneModel params
 * renderer-neutral.
 *
 * `SceneModelUpdateMode` is independent from
 * {@link model!scene.SceneModelLoadingMode | SceneModelLoadingMode} and
 * {@link model!scene.SceneModel.sealed | SceneModel.sealed}. For example, a
 * streamed model can use `updateMode: "static"` with `loadingMode:
 * "streaming"` when chunks keep arriving but completed chunks are stable. A
 * model can then be sealed when no more topology will be added.
 */
export type SceneModelUpdateMode =
  | "auto"
  | "static"
  | "dynamic";

/**
 * Parameters for a {@link model!scene.SceneModel | SceneModel}.
 *
 * * Returned by {@link SceneModel.toParams | SceneModel.toParams}
 * * Passed to {@link SceneModel.fromParams | SceneModel.fromParams} and {@link Scene.createModel | Scene.createModel}
 *
 * See {@link model!scene | @xeokit/sdk/model/scene} for usage.
 */
export interface SceneModelParams {

  /** Persistent numerical payloads used by authored representations. */
  dataResources?: import("./representation/SceneDataResourceParams").SceneDataResourceParams[];
  /** Typed, renderer-independent visual descriptions. */
  representations?: import("./representation/SceneRepresentationParams").SceneRepresentationParams[];

  /**
   * Unique ID for the SceneModel.
   *
   * The SceneModel is stored with this ID in {@link Scene.models | Scene.models}
   */
  id?: string;

  /**
   * Configures the SceneModel's local coordinate system.
   *
   * By default, itis a right-handed Z-up coordinate system.
   */
  coordinateSystem?: CoordinateSystemParams;

  /**
   * Whether IDs of the {@link SceneObject | SceneObjects} are globalized.
   *
   * When globalized, the IDs are prefixed with the value of {@link SceneModel.id | SceneModel.id}
   *
   * Default is ````false````.
   */
  globalizedIds?: boolean

  /**
   * Whether this SceneModel is an invisible scratchpad.
   *
   * Headless models remain valid SceneModels for import/export and offline
   * tooling, but Viewers, renderers and scene AABB/collision indexing ignore
   * their objects and meshes.
   *
   * Default is `false`.
   */
  headless?: boolean;

  /**
   * Describes the model's topology loading mode.
   *
   * - `"open"`: components can be added until the model is destroyed or sealed.
   *   Batches are allowed, but future commits are not assumed to be the normal
   *   loading pattern.
   * - `"streaming"`: components can continue to arrive over time. Each
   *   `commitBatch()` can publish another chunk, tile or loading phase, and
   *   renderers should keep append-friendly behavior available until `seal()`.
   *
   * Default is `"open"`.
   */
  loadingMode?: SceneModelLoadingMode;

  /**
   * Whether the model should be closed to new topology after params are loaded.
   *
   * `loadingMode` remains the construction intent that was requested
   * (`"open"` or `"streaming"`). `sealed` is the mutable runtime state reached
   * by calling {@link SceneModel.seal | seal}. `SceneModel.toParams()`
   * serializes this flag separately so replaying params can reconstruct a
   * sealed model without losing the original loading mode.
   *
   * Default is `false`.
   */
  sealed?: boolean;

  /**
   * Renderer-neutral update mode for this SceneModel.
   *
   * Use this when the application can describe the model at a higher level
   * than individual renderer allocation configurations.
   *
   * Renderer-facing data is the data that renderers cache, upload or reorganize
   * for drawing after the model has been created. Typical examples are mesh
   * transforms, object visibility and selection state, colors, opacity, and
   * other per-object or per-mesh values that can affect rendered output without
   * adding new geometry.
   *
   * - `"auto"`: let renderers choose their safe default.
   * - `"static"`: renderer-facing data is stable after creation.
   * - `"dynamic"`: renderer-facing data changes frequently after creation.
   *
   * For WebGPU, this value selects a renderer-owned update-mode policy. For
   * example, `updateMode: "static"` can map to compact storage after `seal()`,
   * while `updateMode: "dynamic"` can map to append-friendly stream storage.
   * Configure those mappings with
   * {@link viewing!renderers.webGPU.WebGPURendererParams.updateModePolicies | WebGPURendererParams.updateModePolicies}
   * instead of adding renderer-specific settings to SceneModel params.
   *
   * Use {@link SceneModel.loadingMode | loadingMode} to describe
   * whether topology is ordinary open authoring or explicit incremental
   * streaming. Renderers combine update mode, loading mode, sealed state
   * and observed model size to choose backend-specific storage and rendering
   * policies.
   *
   * Default is `"auto"`.
   */
  updateMode?: SceneModelUpdateMode;

  /**
   * 4x4 transform matrix.
   */
  matrix?: Mat4;

  /**
   * Scale of the SceneModel.
   *
   * Default is ````[1,1,1]````.
   */
  scale?: Vec3;

  /**
   * Quaternion defining the orientation of the SceneModel.
   */
  quaternion?: Quat;

  /**
   * Orientation of the SceneModel, given as Euler angles in degrees for X, Y and Z axis.
   */
  rotation?: Vec3;

  /**
   * World-space position of the SceneModel.
   */
  position?: Vec3;

  /**
   * Parameters for {@link SceneTransform  | SceneTransforms} in the {@link SceneModel | SceneModel}.
   */
  transforms?: SceneTransformParams[];

  /**
   * Parameters for {@link SceneGeometry  | SceneGeometries} in the {@link SceneModel | SceneModel}.
   */
  geometries?: SceneGeometryParams[];

  /**
   * Compressed parameters for {@link SceneGeometry  | SceneGeometries} in the {@link SceneModel | SceneModel}.
   */
  geometriesCompressed?: SceneGeometryCompressedParams[];

  /**
   * Parameters for {@link SceneTexture  | SceneTextures} in the {@link SceneModel | SceneModel}.
   */
  textures?: SceneTextureParams[];

  /**
   * Parameters for {@link SceneMaterial  | SceneMaterials} in the {@link SceneModel | SceneModel}.
   */
  materials?: SceneMaterialParams[];

  /**
   * Parameters for {@link SceneMesh  | SceneMeshes} in the {@link SceneModel | SceneModel}.
   */
  meshes?: SceneMeshParams[];

  /**
   * Parameters for {@link SceneObject  | SceneObjects} in the {@link SceneModel | SceneModel}.
   */
  objects?: SceneObjectParams[];

  /**
   * Parameters for variant sets in the SceneModel.
   *
   * A variant set declares alternative groups of objects for the same
   * logical content by referencing SceneObjects.
   */
  variantSets?: SceneVariantSetParams[];

  /**
   * Authored transform animations in the SceneModel.
   *
   * These are animation assets only. Runtime playback state is owned by
   * SceneAnimationPlayer, not serialized here.
   */
  animations?: SceneAnimationParams[];

  /**
   * If we want to view the SceneModel with a {@link viewing!viewer.Viewer | Viewer}, an
   * optional ID of the {@link viewing!viewer.ViewLayer | ViewLayer} to view the SceneModel in.
   *
   * Will be "default" by default.
   *
   * Overrides {@link SceneObjectParams.layerId | SceneObjectParams.layerId}.
   */
  layerId?: string;
}
