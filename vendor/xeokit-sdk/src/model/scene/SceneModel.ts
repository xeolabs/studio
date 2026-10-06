import {SceneRepresentation} from "./representation/SceneRepresentation";
import {copyRepresentationParams} from "./representation/copyRepresentationParams";
import {type SceneRepresentationParams} from "./representation/SceneRepresentationParams";
import {SceneDataResource} from "./representation/SceneDataResource";
import {type SceneDataResourceParams} from "./representation/SceneDataResourceParams";
import {type SceneResourceArray} from "./representation/SceneResourceArray";
import {SDKErrorType, SDKInternalException, type SDKResult} from "../../base/core";
import {composeMat4, createMat4Float64, identityMat4, type  Mat4} from "../../base/math/matrix";
import {eulerToQuat, identityQuat} from "../../base/math/quat";
import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, SolidPrimitive, SurfacePrimitive, TrianglesPrimitive} from "../../base/constants";
import {compressGeometryParams} from "./compressGeometryParams";
import {validateMorphTargetUVs} from "./validateMorphTargetUVs";
import type {Scene} from "./Scene";
import {SceneGeometry} from "./SceneGeometry";
import type {SceneGeometryCompressedParams} from "./SceneGeometryCompressedParams";
import type {SceneGeometryParams} from "./SceneGeometryParams";
import {SceneMesh} from "./SceneMesh";
import type {SceneMeshParams} from "./SceneMeshParams";
import type {SceneModelParams, SceneModelLoadingMode, SceneModelUpdateMode} from "./SceneModelParams";
import type {SceneModelStats} from "./SceneModelStats";
import {SceneObject} from "./SceneObject";
import type {SceneObjectParams} from "./SceneObjectParams";
import {SceneTexture} from "./SceneTexture";
import type {SceneTextureParams} from "./SceneTextureParams";
import {SceneMaterial} from "./SceneMaterial";
import type {SceneMaterialParams} from "./SceneMaterialParams";
import {CoordinateSystem} from "./CoordinateSystem";
import {createCoordinateSystemTransform} from "./createCoordinateSystemTransform";
import {SceneTransform} from "./SceneTransform";
import {type SceneTransformParams} from "./SceneTransformParams";
import {SceneModelBatch, type SceneModelBatchParams} from "./SceneModelBatch";
import {SceneVariantSet} from "./variant/SceneVariantSet";
import type {SceneVariantSetParams} from "./variant/SceneVariantSetParams";
import type {SceneVariantParams} from "./variant/SceneVariantParams";
import {SceneAnimation} from "./animation";
import type {SceneAnimationParams} from "./animation";


/**
 * Texture channel for base color (albedo). Interpreted as sRGB.
 * Used by {@link SceneTexture.channel} when the texture is bound as the color map.
 */
const COLOR_TEXTURE = 0;

/**
 * Texture channel for combined metallic (B) and roughness (G) workflow.
 * Linear color space. Mipmaps recommended for correct GGX roughness.
 */
const METALLIC_ROUGHNESS_TEXTURE = 1;

/**
 * Texture channel for tangent-space normals. Linear color space.
 */
const NORMALS_TEXTURE = 2;

/**
 * Texture channel for emissive color. Interpreted as sRGB.
 */
const EMISSIVE_TEXTURE = 3;

/**
 * Texture channel for ambient occlusion. Linear color space.
 */
const OCCLUSION_TEXTURE = 4;

/**
 * Default KTX2 encoding options per texture channel.
 *
 * These are applied when the SDK encodes supplied image sources to KTX2.
 * Values are tuned for typical real-time use and may be overridden by
 * encoders/higher layers.
 *
 * @remarks
 * Keys are the numeric channel constants above (0–4). Each option object is
 * passed to the KTX2 encoder (e.g. Basis Universal) and may include:
 * - `useSRGB` — whether to store in sRGB transfer function
 * - `encodeUASTC` — whether to use UASTC mode
 * - `qualityLevel` — encoder quality hint
 * - `mipmaps` — whether to generate mip levels
 */
const TEXTURE_ENCODING_OPTIONS: {
  [key: string]: any
} = {}

function normalizeLoadingMode(loadingMode: SceneModelLoadingMode | undefined): SceneModelLoadingMode {
  return loadingMode === "streaming" ? loadingMode : "open";
}

function paramsRequestSeal(params: SceneModelParams): boolean {
  return params.sealed === true;
}

function normalizeUpdateMode(updateMode: SceneModelUpdateMode | undefined): SceneModelUpdateMode {
  return updateMode === "static" ||
  updateMode === "dynamic"
    ? updateMode
    : "auto";
}

TEXTURE_ENCODING_OPTIONS[COLOR_TEXTURE] = {
  useSRGB: true,
  qualityLevel: 50,
  encodeUASTC: true,
  mipmaps: true
};

TEXTURE_ENCODING_OPTIONS[EMISSIVE_TEXTURE] = {
  useSRGB: true,
  encodeUASTC: true,
  qualityLevel: 10,
  mipmaps: false
};

TEXTURE_ENCODING_OPTIONS[METALLIC_ROUGHNESS_TEXTURE] = {
  useSRGB: false,
  encodeUASTC: true,
  qualityLevel: 50,
  mipmaps: true // Needed for GGX roughness shading
};

TEXTURE_ENCODING_OPTIONS[NORMALS_TEXTURE] = {
  useSRGB: false,
  encodeUASTC: true,
  qualityLevel: 10,
  mipmaps: false
};

TEXTURE_ENCODING_OPTIONS[OCCLUSION_TEXTURE] = {
  useSRGB: false,
  encodeUASTC: true,
  qualityLevel: 10,
  mipmaps: false
};

/**
 * Contains a model's geometry and materials.
 *
 * - Created with {@link Scene.createModel | Scene.createModel}
 * - Stored in {@link Scene.models | Scene.models}
 * - Contains {@link SceneObject | SceneObjects}, {@link SceneMesh | SceneMeshes},
 *   {@link SceneGeometry | Geometries} and {@link SceneTexture | Textures}.
 * - View with a {@link viewing!viewer.Viewer | Viewer}
 * - Import and export various file formats
 * - Build programmatically
 *
 * See {@link model!scene | @xeokit/sdk/model/scene} for usage.
 */
export class SceneModel {

  /** Model-owned numerical payloads, indexed by resource ID. Mutate through the methods below. */
  readonly dataResources: Record<string, SceneDataResource> = Object.create(null);

  /** Portable semantic definitions, indexed by representation ID; contains no executable consumers. */
  readonly representations: Record<string, SceneRepresentation> = Object.create(null);

  /**
   * Copies and registers a numerical payload in this model.
   *
   * @param params Buffer or 2D table with a unique model-local ID and matching typed array.
   * @returns The model-owned resource, or InvalidInput without publishing partial data.
   */
  createDataResource(params: SceneDataResourceParams): SDKResult<SceneDataResource> {
    const blocked = this._assertCanCreate("createDataResource");
    if (blocked) return blocked;
    try {
      if (this.dataResources[params.id]) throw new Error(`Resource already exists: ${params.id}`);
      const resource = new SceneDataResource(this, params);
      for (const representation of Object.values(this.representations)) {
        if (Object.values(representation.resources).includes(resource.id)) {
          this._checkRepresentation(representation.toParams(), resource);
        }
      }
      this.dataResources[resource.id] = resource;
      this._activeBatch?.dataResources.push(resource);
      this.scene.events.onSceneDataResourceChanged.dispatch(this.scene, this);
      return {ok: true, value: resource};
    } catch (error) { return {ok: false, type: SDKErrorType.InvalidInput, error: String(error)}; }
  }

  /**
   * Atomically replaces values while preserving resource identity and layout.
   * Known referring schemas validate the replacement before revision/event updates.
   *
   * @param id Existing resource ID in this model.
   * @param update Complete replacement typed array; copied, with layout unchanged.
   * @returns Success, or a validation/missing-resource error with the old values intact.
   */
  updateDataResource(id: string, update: {data: SceneResourceArray}): SDKResult<void> {
    const resource = this.dataResources[id];
    if (this.destroyed || !resource) return {ok: false, type: SDKErrorType.InvalidInput, error: `Resource not found: ${id}`};
    try {
      const candidate = new SceneDataResource(this, {...resource.descriptor, data: update.data} as SceneDataResourceParams);
      for (const representation of Object.values(this.representations)) {
        if (Object.values(representation.resources).includes(id)) this._checkRepresentation(representation.toParams(), candidate);
      }
      resource._replaceFrom(candidate);
      this.scene.events.onSceneDataResourceChanged.dispatch(this.scene, this);
      return {ok: true, value: undefined};
    } catch (error) { return {ok: false, type: SDKErrorType.InvalidInput, error: String(error)}; }
  }

  /**
   * Removes an unreferenced numerical resource and notifies consumers.
   * @param id Model-local resource ID.
   * @returns InvalidOperation if missing or still referenced by any representation.
   */
  destroyDataResource(id: string): SDKResult<void> {
    const resource = this.dataResources[id];
    if (!resource || Object.values(this.representations).some(rep => Object.values(rep.resources).includes(id))) {
      return {ok: false, type: SDKErrorType.InvalidOperation, error: `Resource missing or still referenced: ${id}`};
    }
    delete this.dataResources[id];
    resource.destroyed = true;
    this.scene.events.onSceneDataResourceChanged.dispatch(this.scene, this);
    return {ok: true, value: undefined};
  }

  /**
   * Creates a renderer-independent interpretation of scene data.
   *
   * Always validates/copies portable structure. Known schemas registered on
   * scene.representationSchemas additionally validate resolved semantic inputs.
   * Unknown types, newer schemas and unresolved resource IDs remain preservable.
   *
   * @param params Unique ID, semantic type/version, finite JSON, bounds and resource references.
   * @returns The model-owned definition, or an error without publishing it.
   */
  createRepresentation(params: SceneRepresentationParams): SDKResult<SceneRepresentation> {
    const blocked = this._assertCanCreate("createRepresentation");
    if (blocked) return blocked;
    try {
      if (this.representations[params.id]) throw new Error(`Representation already exists: ${params.id}`);
      const representation = new SceneRepresentation(this, params);
      this._checkRepresentation(representation.toParams());
      this.representations[representation.id] = representation;
      this._activeBatch?.representations.push(representation);
      this._representationChanged(representation.id);
      return {ok: true, value: representation};
    } catch (error) { return {ok: false, type: SDKErrorType.InvalidInput, error: String(error)}; }
  }

  /**
   * Validates and replaces definition fields atomically, then increments revision.
   *
   * @param id Existing model-local definition ID; identity cannot change.
   * @param update Fields to replace. Parameters/resources are replaced as whole maps, not deep-merged.
   * @returns Success, or a validation error leaving the previous definition unchanged.
   */
  updateRepresentation(id: string, update: Partial<Omit<SceneRepresentationParams, "id">>): SDKResult<void> {
    const representation = this.representations[id];
    if (this.destroyed || !representation) return {ok: false, type: SDKErrorType.InvalidInput, error: `Representation not found: ${id}`};
    try {
      const params = copyRepresentationParams({...representation.toParams(), ...update, id});
      this._checkRepresentation(params);
      representation._replace(params);
      this._representationChanged(id);
      return {ok: true, value: undefined};
    } catch (error) { return {ok: false, type: SDKErrorType.InvalidInput, error: String(error)}; }
  }

  /**
   * Removes a definition when no mesh in this model still binds it.
   * @param id Model-local definition ID.
   * @returns Success, or InvalidOperation when missing or still bound.
   */
  destroyRepresentation(id: string): SDKResult<void> {
    const representation = this.representations[id];
    if (!representation || Object.values(this.meshes).some(mesh => mesh.representationId === id)) {
      return {ok: false, type: SDKErrorType.InvalidOperation, error: `Representation missing or still bound: ${id}`};
    }
    delete this.representations[id];
    representation.destroyed = true;
    this._representationChanged(id);
    return {ok: true, value: undefined};
  }

  private _checkRepresentation(params: Readonly<SceneRepresentationParams>, replacement?: SceneDataResource): void {
    const resources: Record<string, SceneDataResource | undefined> = Object.create(null);
    for (const [name, id] of Object.entries(params.resources)) resources[name] = replacement?.id === id ? replacement : this.dataResources[id];
    // Forward resource references are preserved; capability/availability is resolved by consumers.
    if (Object.values(resources).some(resource => !resource)) return;
    const result = this.scene.representationSchemas.validate({representation: params, resources});
    if (result.status === "invalid") throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  }

  private _representationChanged(id: string): void {
    for (const mesh of Object.values(this.meshes)) if (mesh.representationId === id) mesh.setWorldMatrixDirty();
    this.scene.events.onSceneRepresentationChanged.dispatch(this.scene, this);
  }

  /**
   * The {@link Scene | Scene} that contains this SceneModel.
   */
  public readonly scene: Scene;

  /**
   * Configures the SceneModel's local coordinate system.
   *
   * Internally, a matrix is created to transform coordinates between SceneModel and
   * Scene CoordinateSystems. The matrix of each {@link model!scene.SceneMesh | SceneMesh} is premultiplied by that
   * matrix, effectively transforming the SceneModel into the global coordinate system.
   */
  public readonly coordinateSystem: CoordinateSystem;

  private _coordinateSystemMatrix: Mat4;
  private _coordinateSystemMatrixDirty: boolean = true;

  /**
   * Whether IDs of {@link SceneObject | SceneObjects} are globalized.
   *
   * When globalized, the IDs are prefixed with the value of {@link SceneModel.id | SceneModel.id}
   *
   * This is ````false```` by default.
   */
  public readonly globalizedIds: boolean;

  /**
   * Whether this SceneModel is an invisible scratchpad.
   *
   * Headless models are intended for offline/import/export work inside a Scene.
   * Viewers, renderers and scene collision/AABB indexing ignore them.
   */
  public readonly headless: boolean;

  private _loadingMode: SceneModelLoadingMode;
  private _sealed: boolean = false;

  /**
   * Describes whether this SceneModel uses ordinary open authoring or expects
   * streaming committed batches.
   */
  public get loadingMode(): SceneModelLoadingMode {
    return this._loadingMode;
  }

  /**
   * Whether this SceneModel is closed against further topology/resource growth.
   */
  public get sealed(): boolean {
    return this._sealed;
  }

  private _updateMode: SceneModelUpdateMode;

  /**
   * Renderer-neutral update mode for this SceneModel.
   */
  public get updateMode(): SceneModelUpdateMode {
    return this._updateMode;
  }

  private _activeBatch: SceneModelBatch | null = null;

  /**
   * Currently active component creation batch, if any.
   */
  public get activeBatch(): SceneModelBatch | null {
    return this._activeBatch;
  }

  /**
   * Unique ID of this SceneModel.
   *
   * SceneModel are stored against this ID in {@link Scene.models | Scene.models}.
   */
  public readonly id: string;

  /**
   * If we want to view this SceneModel with a {@link viewing!viewer.Viewer | Viewer}, an
   * optional ID of a {@link viewing!viewer.ViewLayer | ViewLayer} to view it in.
   */
  public readonly layerId?: string;

  /**
   * {@link SceneTransform | SceneTransforms} within this SceneModel, each mapped to {@link SceneTransform.id | SceneTransform.id}.
   *
   * - Created by {@link SceneModel.createTransform | SceneModel.createTransform}.
   */
  public readonly transforms: { [key: string]: SceneTransform };

  /**
   * {@link SceneGeometry | Geometries} within this SceneModel, each mapped to {@link SceneGeometry.id | SceneGeometry.id}.
   *
   * - Created by {@link SceneModel.createGeometry | SceneModel.createGeometry}.
   */
  public readonly geometries: { [key: string]: SceneGeometry };

  /**
   * Live count of resident geometries per primitive type, maintained as
   * geometries are created/destroyed. Backs {@link containsPrimitive}.
   */
  private readonly _primitiveCounts: Map<number, number> = new Map();

  /**
   * {@link SceneTexture | Textures} within this SceneModel, each mapped to {@link SceneTexture.id | SceneTexture.id}.
   *
   * - Created by {@link SceneModel.createTexture | SceneModel.createTexture}.
   */
  public readonly textures: { [key: string]: SceneTexture };

  /**
   * {@link SceneMaterial | Materials} within this SceneModel, each mapped to {@link SceneMaterial.id | SceneMaterial.id}.
   *
   * - Created by {@link SceneModel.createMaterial | SceneModel.createMaterial}.
   */
  public readonly materials: { [key: string]: SceneMaterial };

  /**
   * {@link SceneMesh | SceneMeshes} within this SceneModel, each mapped to {@link SceneMesh.id | SceneMesh.id}.
   *
   * - Created by {@link SceneModel.createMesh | SceneModel.addMesh}.
   */
  public readonly meshes: { [key: string]: SceneMesh };

  /**
   * {@link SceneObject | SceneObjects} within this SceneModel, each mapped to {@link SceneObject.id | SceneObject.id}.
   *
   * - Created by {@link SceneModel.createObject | SceneModel.createObject}.
   */
  public readonly objects: { [key: string]: SceneObject };

  /**
   * {@link SceneVariantSet | Variant sets} within this SceneModel, each
   * mapped to {@link SceneVariantSet.id | SceneVariantSet.id}.
   *
   * A variant set declares alternative groups of SceneObjects that
   * represent the same logical content. It is generic model metadata and does
   * not store the active variant for any view.
   *
   * - Created by {@link SceneModel.createVariantSet | SceneModel.createVariantSet}.
   */
  public readonly variantSets: { [key: string]: SceneVariantSet };

  /**
   * Authored animation assets within this SceneModel.
   *
   * - Created by {@link SceneModel.createAnimation | SceneModel.createAnimation}.
   * - Contains no runtime playback state.
   */
  public readonly animations: { [key: string]: SceneAnimation };

  private readonly _variantSetsByObjectId: Map<string, Set<SceneVariantSet>> = new Map();

  /**
   * Statistics on this SceneModel.
   *
   * @remarks
   * Values are updated as content is created/destroyed:
   * - `numTransforms`, `numGeometries`, `numMeshes`, `numObjects`
   * - `numVertices`, `numTriangles`, `numLines`, `numPoints`
   * - `numTextures`, `numMaterials`, `textureBytes`
   */
  public readonly stats: SceneModelStats;

  /**
   * Indicates if this SceneModel has been destroyed.
   *
   * - Set ````true```` by {@link SceneModel.destroy | SceneModel.destroy}.
   * - Don't create anything more in this SceneModel once it's destroyed.
   */
  public destroyed: boolean = false;

  private _building: boolean = false;

  /**
   * Whether this SceneModel is currently being populated by a loader.
   *
   * {@link ModelLoader} sets this `true` for the duration of a load and `false`
   * when it finishes (or fails). The renderer observes the paired
   * {@link model!scene.SceneEvents.onSceneModelBuildStarted | onSceneModelBuildStarted} /
   * {@link model!scene.SceneEvents.onSceneModelBuildFinished | onSceneModelBuildFinished}
   * events to suspend per-frame uploads + draws until the model is fully
   * assembled, then renders it once — avoiding redundant mid-load frames.
   *
   * Setting the same value twice is a no-op (no event fired), so it's safe for
   * a loader to clear it in a `finally` even on the error path.
   */
  get building(): boolean {
    return this._building;
  }

  set building(building: boolean) {
    building = !!building;
    if (building === this._building) {
      return;
    }
    this._building = building;
    if (building) {
      this.scene.events.onSceneModelBuildStarted.dispatch(this.scene, this);
    } else {
      this.scene.events.onSceneModelBuildFinished.dispatch(this.scene, this);
    }
  }

  private _assertCanCreate(method: string): SDKResult<any> | null {
    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneModel.${method}] SceneModel already destroyed`
      });
    }
    if (this._sealed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneModel.${method}] SceneModel is sealed`
      });
    }
    return null;
  }

  private _recordActiveBatchComponent(component: SceneTransform | SceneGeometry | SceneTexture | SceneMaterial | SceneMesh | SceneObject): void {
    const batch = this._activeBatch;
    if (!batch) {
      return;
    }
    (component as {batchId?: string}).batchId = batch.id;
    if (component instanceof SceneTransform) {
      batch.transforms.push(component);
    } else if (component instanceof SceneGeometry) {
      batch.geometries.push(component);
    } else if (component instanceof SceneTexture) {
      batch.textures.push(component);
    } else if (component instanceof SceneMaterial) {
      batch.materials.push(component);
    } else if (component instanceof SceneMesh) {
      batch.meshes.push(component);
    } else {
      batch.objects.push(component);
    }
  }

  /**
   * Starts a component creation batch on this SceneModel.
   *
   * Components created while the batch is active are recorded in
   * {@link SceneModel.activeBatch}. Viewers and renderers may defer those
   * components until {@link SceneModel.commitBatch | commitBatch} publishes the
   * batch as a single unit.
   *
   * Batches are designed for loaders or application code that need to know
   * exactly which components were created during a named loading interval, and
   * for importers that need to partition a loading process into explicit
   * construction phases. For example, an importer might stage one model file or
   * file section before making it visible. Only one batch can be active at once.
   * Use {@link SceneModel.rollbackBatch | rollbackBatch} to discard the active
   * batch before it is committed.
   */
  beginBatch(params: SceneModelBatchParams): SDKResult<SceneModelBatch> {
    const createError = this._assertCanCreate("beginBatch");
    if (createError) {
      return createError;
    }
    if (!params?.id) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.beginBatch] Parameter expected: params.id"
      });
    }
    if (this._activeBatch) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneModel.beginBatch] SceneModel already has an active batch: ${this._activeBatch.id}`
      });
    }
    const batch = new SceneModelBatch(params);
    this._activeBatch = batch;
    this.scene.events.onSceneModelBatchStarted.dispatch(this, batch);
    return {
      ok: true,
      value: batch
    };
  }

  /**
   * Commits the active component creation batch.
   *
   * The batch is marked committed, {@link SceneModel.activeBatch} is cleared and
   * {@link SceneEvents.onSceneModelBatchCommitted} is fired. Renderers can use
   * the committed batch as a stable construction unit and combine it with
   * {@link SceneModel.updateMode | updateMode} to choose their own allocation strategy. A
   * SceneModel batch is a model construction concept; it does not require
   * renderers to preserve the same boundary as a GPU draw batch.
   */
  commitBatch(): SDKResult<SceneModelBatch> {
    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.commitBatch] SceneModel already destroyed"
      });
    }
    const batch = this._activeBatch;
    if (!batch) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.commitBatch] SceneModel has no active batch"
      });
    }
    batch.committed = true;
    this._activeBatch = null;
    this.scene.events.onSceneModelBatchCommitted.dispatch(this, batch);
    return {
      ok: true,
      value: batch
    };
  }

  /**
   * Destroys all components created in the active batch and clears it.
   *
   * This is only valid before {@link SceneModel.commitBatch | commitBatch}.
   * Components are destroyed in dependency order and
   * {@link SceneEvents.onSceneModelBatchRolledBack} is fired.
   */
  rollbackBatch(): SDKResult<void> {
    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.rollbackBatch] SceneModel already destroyed"
      });
    }
    const batch = this._activeBatch;
    if (!batch) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.rollbackBatch] SceneModel has no active batch"
      });
    }
    this._activeBatch = null;
    const destroyAll = (components: {destroy(): unknown; destroyed?: boolean}[]): void => {
      for (let i = components.length - 1; i >= 0; i--) {
        if (!components[i]?.destroyed) {
          components[i].destroy();
        }
      }
    };
    destroyAll(batch.objects);
    destroyAll(batch.meshes);
    destroyAll(batch.representations);
    destroyAll(batch.dataResources);
    destroyAll(batch.materials);
    destroyAll(batch.transforms);
    destroyAll(batch.geometries);
    destroyAll(batch.textures);
    this.scene.events.onSceneModelBatchRolledBack.dispatch(this, batch);
    return {
      ok: true,
      value: undefined
    };
  }

  /**
   * Seals this SceneModel against further topology/resource growth.
   *
   * After sealing, creation methods such as
   * {@link SceneModel.createGeometry | createGeometry},
   * {@link SceneModel.createMesh | createMesh},
   * {@link SceneModel.createObject | createObject} and
   * {@link SceneModel.beginBatch | beginBatch} reject new content. Renderers can
   * treat a sealed model as complete and may use snug allocations according to
   * the renderer's policy for this model's {@link SceneModel.updateMode | updateMode}.
   */
  seal(): SDKResult<void> {
    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.seal] SceneModel already destroyed"
      });
    }
    if (this._activeBatch) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneModel.seal] Cannot seal while batch '${this._activeBatch.id}' is active`
      });
    }
    if (this._sealed) {
      return {
        ok: true,
        value: undefined
      };
    }
    this._sealed = true;
    this.scene.events.onSceneModelSealed.dispatch(this.scene, this);
    return {
      ok: true,
      value: undefined
    };
  }

  /**
   * Constructs a new {@link model!scene.SceneModel | SceneModel}.
   *
   * @param scene The owning {@link model!scene.Scene | Scene}.
   * @param sceneModelParams Initialization parameters.
   *
   * @remarks
   * The model’s local {@link coordinateSystem} is established here, and a cached
   * {@link coordinateSystemMatrix} is computed so that any created {@link model!scene.SceneMesh | SceneMesh}
   * has its local matrix pre-multiplied into the Scene coordinate system.
   *
   * The `globalizedIds` flag controls whether created {@link model!scene.SceneObject | SceneObject} IDs
   * are automatically prefixed with the model ID when registered in the Scene.
   *
   * @private
   */
  constructor(scene: Scene, sceneModelParams: SceneModelParams) {
    this.id = sceneModelParams.id;
    this.scene = scene;
    this.coordinateSystem = new CoordinateSystem(
      this,
      () => { // Updated
        this._coordinateSystemMatrixDirty = true;
        this.setWorldMatrixDirty();
      },
      sceneModelParams?.coordinateSystem);
    this._coordinateSystemMatrix = createMat4Float64();
    this._coordinateSystemMatrixDirty = true;
    this.globalizedIds = (!!sceneModelParams.globalizedIds);
    this.headless = sceneModelParams.headless === true;
    this._loadingMode = normalizeLoadingMode(sceneModelParams.loadingMode);
    this._updateMode = normalizeUpdateMode(sceneModelParams.updateMode);
    this.layerId = sceneModelParams.layerId;
    this.transforms = {};
    this.geometries = {};
    this.textures = {};
    this.materials = {};
    this.meshes = {};
    this.objects = {};
    this.variantSets = {};
    this.animations = {};

    this.stats = {
      numTransforms: 0,
      numGeometries: 0,
      numLines: 0,
      numMeshes: 0,
      numObjects: 0,
      numPoints: 0,
      numMaterials: 0,
      numTextures: 0,
      numTriangles: 0,
      numVertices: 0,
      textureBytes: 0
    };
  }

  /**
   * Creates an authored {@link SceneAnimation} asset within this SceneModel.
   *
   * Animation assets are immutable sampled channel data. Evaluate them with
   * SceneAnimationEvaluator, and play them at runtime with
   * SceneAnimationPlayer.
   */
  createAnimation(animationParams: SceneAnimationParams): SDKResult<SceneAnimation> {
    const createError = this._assertCanCreate("createAnimation");
    if (createError) {
      return createError;
    }
    const validationError = SceneAnimation.validateParams(animationParams);
    if (validationError) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createAnimation] ${validationError}`
      });
    }
    if (this.animations[animationParams.id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createAnimation] SceneAnimation already exists with this ID: ${animationParams.id}`
      });
    }
    for (const channel of animationParams.channels) {
      if (channel.target.type === "transform" && !this.transforms[channel.target.transformId]) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createAnimation] SceneTransform not found: ${channel.target.transformId}`
        });
      }
    }
    const animation = new SceneAnimation(this, animationParams);
    this.animations[animation.id] = animation;
    this.scene.events.onSceneAnimationCreated.dispatch(this.scene, animation);
    return {ok: true, value: animation};
  }

  /**
   * @internal
   * Destroys a SceneAnimation previously created in this model.
   */
  _destroyAnimation(animation: SceneAnimation): void {
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneAnimation ${animation.id} - SceneModel already destroyed`);
    }
    if (!this.animations[animation.id]) {
      throw new SDKInternalException(`Cannot destroy SceneAnimation ${animation.id} - SceneAnimation not found in SceneModel`);
    }
    delete this.animations[animation.id];
    this.scene.events.onSceneAnimationDestroyed.dispatch(this.scene, animation);
  }

  /**
   * Caches a matrix used to transform positions between SceneModel and Scene CoordinateSystems.
   * Each SceneMesh's matrix is pre-multiplied by this matrix to effectively move the vertex
   * positions from the SceneModel CoordinateSystem to the Scene CoordinateSystem within.
   */
  get coordinateSystemMatrix(): Mat4 {
    if (this._coordinateSystemMatrixDirty) {
      this._coordinateSystemMatrix = createCoordinateSystemTransform(this.coordinateSystem, this.scene.coordinateSystem, this._coordinateSystemMatrix);
      this._coordinateSystemMatrixDirty = false;
    }
    return this._coordinateSystemMatrix;
  }

  /**
   * Creates a new {@link SceneTransform} within this SceneModel.
   *
   * - Stores the transform in {@link SceneModel.transforms}.
   * - Optionally attaches it under a parent transform using {@link SceneTransform.setParentTransformId}.
   * - The final transform matrix can be supplied directly via `matrix` or composed from
   *   `position`, `scale` and `rotation` (Euler) or `quaternion`.
   * - Fires {@link SceneEvents.onSceneTransformCreated | SceneEvents.onSceneTransformCreated} event.
   *
   * @example
   * ```javascript
   * const rootTransformResult = sceneModel.createTransform({
   *   id: "root",
   *   position: [10, 0, 0]
   * });
   *
   * if (!rootTransformResult.ok) {
   *   console.error(rootTransformResult.error);
   *   return;
   * }
   *
   * const rootTransform = rootTransformResult.value;
   *
   * sceneModel.createTransform({
   *   id: "child",
   *   parentTransformId: "root",
   *   rotation: [0, Math.PI * 0.5, 0]
   * });
   *
   * const childTransform = sceneModel.transforms["child"];
   * childTransform.position = [0, 5, 0];
   * childTransform.rotation =[0, 0, 45];
   * ```
   *
   * @param transformParams Parameters describing the transform to create.
   * @returns An SDKResult with:
   * - On success, the created {@link SceneTransform}.
   * - On failure, an error message. Reasons for failure include:
   *   - SceneModel already destroyed.
   *   - SceneTransform already exists with the given ID.
   *   - Parent SceneTransform not found with the given parentTransformId.
   */
  createTransform(transformParams: SceneTransformParams): SDKResult<SceneTransform> {

    const createError = this._assertCanCreate("createTransform");
    if (createError) {
      return createError;
    }


    if (!transformParams.id) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createTransform] Parameter expected: transformParams.id"
      });
    }

    if (this.transforms[transformParams.id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createTransform] SceneTransform already exists with this ID: ${transformParams.id}`
      });
    }

    let parentTransform: SceneTransform | undefined;
    if (transformParams.parentTransformId) {
      parentTransform = this.transforms[transformParams.parentTransformId];
      if (!parentTransform) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createTransform] Parent SceneTransform not found: ${transformParams.parentTransformId}`
        });
      }
    }

    const sceneTransform = new SceneTransform(this, transformParams);

    if (parentTransform) {
      sceneTransform.setParentTransformId(parentTransform.id);
    }

    this.transforms[transformParams.id] = sceneTransform;
    this.stats.numTransforms++;
    this._recordActiveBatchComponent(sceneTransform);
    this.scene.events.onSceneTransformCreated.dispatch(this.scene, sceneTransform);
    return {
      ok: true,
      value: sceneTransform
    };
  }

  /**
   * @internal
   * Destroys a {@link SceneTransform} previously created in this model.
   */
  _destroyTransform(sceneTransform: SceneTransform) {
    const transformId = sceneTransform.id;
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneTransform ${transformId} - SceneModel already destroyed`);
    }
    if (!this.transforms[transformId]) {
      throw new SDKInternalException(`Cannot destroy SceneTransform ${transformId} - SceneTransform not found in SceneModel`);
    }
    delete this.transforms[transformId];
    this.stats.numTransforms--;
    this.scene.events.onSceneTransformDestroyed.dispatch(this.scene, sceneTransform);
  }

  /**
   * Creates a new {@link SceneTexture} within this SceneModel.
   *
   * - Stores the new {@link SceneTexture} in {@link SceneModel.textures | SceneModel.textures}.
   * - Fires {@link SceneEvents.onSceneTextureCreated | SceneEvents.onSceneTextureCreated} event.
   *
   * ### Usage
   *
   * ````javascript
   * const textureResult = sceneModel.createTexture({
   *      id: "myColorTexture",
   *      src: // Path to JPEG, PNG, KTX2,
   *      image: // HTMLImageElement,
   *      buffers: // ArrayBuffer[] containing KTX2 MIP levels
   *      preloadColor: [1,0,0,1],
   *      flipY: false,
   *      encoding: LinearEncoding, // @xeokit/constants
   *      magFilter: LinearFilter,
   *      minFilter: LinearFilter,
   *      wrapR: ClampToEdgeWrapping,
   *      wrapS: ClampToEdgeWrapping,
   *      wrapT: ClampToEdgeWrapping,
   * });
   *
   * if (!textureResult.ok) {
   *   console.error(textureResult.error);
   *   return;
   * } else {
   *     const texture = textureResult.value;
   * }
   *
   * const textureAgain = sceneModel.textures["myColorTexture"];
   * ````
   *
   * See {@link model!scene | @xeokit/sdk/model/scene} for more usage info.
   *
   * @param textureParams - SceneTexture creation parameters.
   * @returns SDKResult with:
   * - On success, the created {@link SceneTexture}.
   * - On failure, an error message. Reasons for failure include:
   *   - SceneModel already destroyed.
   *   - Missing required parameter: textureParams.imageData, textureParams.image, textureParams.src or textureParams.buffers.
   *   - Texture already exists with the given ID.
   *   - Unsupported image extension.
   */
  createTexture(textureParams: SceneTextureParams): SDKResult<SceneTexture> {

    const createError = this._assertCanCreate("createTexture");
    if (createError) {
      return createError;
    }
    if (!textureParams.id) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createTexture] Parameter expected: textureParams.id"
      });
    }
    if (!textureParams.imageData && !textureParams.image && !textureParams.src && !textureParams.buffers) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error:
          "[SceneModel.createTexture] Parameter expected: textureParams.imageData, textureParams.image, textureParams.src or textureParams.buffers"
      });
    }

    if (this.textures[textureParams.id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createTexture] Cannot create Texture - Texture already exists with this ID: '${textureParams.id}'`
      });
    }

    if (textureParams.src) {
      const fileExt = textureParams.src.split(".").pop();
      // if (fileExt !== "jpg" && fileExt !== "jpeg" && fileExt !== "png") {
      //   return { ok: false, error: `Unsupported image extension '${fileExt}' for texture '${textureParams.id}'` };
      // }
    }

    const texture = new SceneTexture(this, textureParams);
    this.textures[textureParams.id] = texture;
    this.stats.numTextures++;
    this.stats.textureBytes += texture.textureBytes;
    this._recordActiveBatchComponent(texture);
    this.scene.events.onSceneTextureCreated.dispatch(this.scene, texture);
    return {
      ok: true,
      value: texture
    };
  }

  /**
   * Called by a {@link SceneTexture} when it is destroyed.
   * @internal
   * @param sceneTexture
   */
  _destroyTexture(sceneTexture: SceneTexture) {
    const textureId = sceneTexture.id;
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneTexture ${textureId} - SceneModel already destroyed`);
    }
    if (!this.textures[textureId]) {
      throw new SDKInternalException(`Cannot destroy SceneTexture ${textureId} - SceneTexture not found in SceneModel`);
    }
    delete this.textures[textureId];
    this.stats.numTextures--;
    this.stats.textureBytes -= sceneTexture.textureBytes;
    this.scene.events.onSceneTextureDestroyed.dispatch(this.scene, sceneTexture);
  }

  /**
   * Creates a new {@link model!scene.SceneMaterial | SceneMaterial} within this SceneModel.
   *
   * - Stores the new {@link model!scene.SceneMaterial | SceneMaterial} in {@link SceneModel.materials | SceneModel.materials}.
   * - Fires {@link SceneEvents.onSceneMaterialCreated | SceneEvents.onSceneMaterialCreated} event.
   *
   * ### Usage
   *
   * ````javascript
   * const materialResult = sceneModel.createMaterial({
   *      id: "myMaterial",
   *      colorTextureId: "myColorTexture"
   * });
   *
   * if (!materialResult.ok) {
   *   console.error(materialResult.error);
   *   return;
   * } else {
   * const material = materialResult.value;
   * }
   *
   * const materialAgain = sceneModel.materials["myMaterial"];
   * ````
   *
   * See {@link model!scene | @xeokit/sdk/model/scene}   for more usage info.
   *
   * @param materialParams SceneMaterial creation parameters.
   *
   * @returns SDKResult with:
   * - On success, the created {@link model!scene.SceneMaterial | SceneMaterial}.
   * - On failure, an error message. Reasons for failure include:
   *  - SceneModel already destroyed.
   *  - Material already exists with the given ID.
   *  - Referenced texture not found in SceneModel.
   */
  createMaterial(materialParams: SceneMaterialParams): SDKResult<SceneMaterial> {

    const createError = this._assertCanCreate("createMaterial");
    if (createError) {
      return createError;
    }


    if (this.materials[materialParams.id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMaterial] Material already exists with this ID: '${materialParams.id}'`
      });
    }

    let colorTexture: SceneTexture | undefined;
    if (materialParams.colorTextureId !== undefined && materialParams.colorTextureId !== null) {
      colorTexture = this.textures[materialParams.colorTextureId];
      if (!colorTexture) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error:
            `[SceneModel.createMaterial] Texture not found: '${materialParams.colorTextureId}' - ` +
            "ensure that you create it first with createTexture()"
        });
      }
      colorTexture.channel = COLOR_TEXTURE;
    }

    let metallicRoughnessTexture: SceneTexture | undefined;
    if (materialParams.metallicRoughnessTextureId !== undefined && materialParams.metallicRoughnessTextureId !== null) {
      metallicRoughnessTexture = this.textures[materialParams.metallicRoughnessTextureId];
      if (!metallicRoughnessTexture) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error:
            `[SceneModel.createMaterial] Texture not found: '${materialParams.metallicRoughnessTextureId}' - ` +
            "ensure that you create it first with createTexture()"
        });
      }
      metallicRoughnessTexture.channel = METALLIC_ROUGHNESS_TEXTURE;
    }

    let normalsTexture: SceneTexture | undefined;
    if (materialParams.normalsTextureId !== undefined && materialParams.normalsTextureId !== null) {
      normalsTexture = this.textures[materialParams.normalsTextureId];
      if (!normalsTexture) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error:
            `[SceneModel.createMaterial] Texture not found: '${materialParams.normalsTextureId}' - ` +
            "ensure that you create it first with createTexture()"
        });
      }
      normalsTexture.channel = NORMALS_TEXTURE;
    }

    let emissiveTexture: SceneTexture | undefined;
    if (materialParams.emissiveTextureId !== undefined && materialParams.emissiveTextureId !== null) {
      emissiveTexture = this.textures[materialParams.emissiveTextureId];
      if (!emissiveTexture) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error:
            `[SceneModel.createMaterial] Texture not found: '${materialParams.emissiveTextureId}' - ` +
            "ensure that you create it first with createTexture()"
        });
      }
      emissiveTexture.channel = EMISSIVE_TEXTURE;
    }

    let occlusionTexture: SceneTexture | undefined;
    if (materialParams.occlusionTextureId !== undefined && materialParams.occlusionTextureId !== null) {
      occlusionTexture = this.textures[materialParams.occlusionTextureId];
      if (!occlusionTexture) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error:
            `[SceneModel.createMaterial] Texture not found: '${materialParams.occlusionTextureId}' - ` +
            "ensure that you create it first with createTexture()"
        });
      }
      occlusionTexture.channel = OCCLUSION_TEXTURE;
    }

    const material = new SceneMaterial(this, materialParams, {
      emissiveTexture,
      occlusionTexture,
      metallicRoughnessTexture,
      normalsTexture,
      colorTexture
    });

    if (colorTexture)             colorTexture.numMaterials++;
    if (metallicRoughnessTexture) metallicRoughnessTexture.numMaterials++;
    if (normalsTexture)           normalsTexture.numMaterials++;
    if (occlusionTexture)         occlusionTexture.numMaterials++;
    if (emissiveTexture)          emissiveTexture.numMaterials++;

    this.materials[materialParams.id] = material;
    this.stats.numMaterials++;
    this._recordActiveBatchComponent(material);
    this.scene.events.onSceneMaterialCreated.dispatch(this.scene, material);
    return {
      ok: true,
      value: material
    };
  }


  /**
   * Called by a {@link model!scene.SceneMaterial | SceneMaterial} when it is destroyed.
   * @internal
   * @param sceneMaterial
   */
  _destroyMaterial(sceneMaterial: SceneMaterial) {
    const materialId = sceneMaterial.id;
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneMaterial '${materialId}' - SceneModel already destroyed`);
    }
    if (!this.materials[materialId]) {
      throw new SDKInternalException(`Cannot destroy SceneMaterial '${materialId}' - SceneMaterial not found in SceneModel`);
    }
    if (sceneMaterial.colorTexture)             sceneMaterial.colorTexture.numMaterials--;
    if (sceneMaterial.metallicRoughnessTexture) sceneMaterial.metallicRoughnessTexture.numMaterials--;
    if (sceneMaterial.normalsTexture)           sceneMaterial.normalsTexture.numMaterials--;
    if (sceneMaterial.occlusionTexture)         sceneMaterial.occlusionTexture.numMaterials--;
    if (sceneMaterial.emissiveTexture)          sceneMaterial.emissiveTexture.numMaterials--;
    delete this.materials[materialId];
    this.stats.numMaterials--;
    this.scene.events.onSceneMaterialDestroyed.dispatch(this.scene, sceneMaterial);
  }

  /**
   * Creates a new {@link model!scene.SceneGeometry | SceneGeometry} within this SceneModel, from non-compressed geometry parameters.
   *
   * - Stores the new {@link model!scene.SceneGeometry | SceneGeometry} in {@link SceneModel.geometries | SceneModel.geometries}.
   * - Fires {@link SceneEvents.onSceneGeometryCreated | SceneEvents.onSceneGeometryCreated} event.
   *
   * ### Usage
   *
   * ````javascript
   * const boxGeometryResult = sceneModel.createGeometry({
   *      id: "boxGeometry",
   *      primitive: TrianglesPrimitive, // @xeokit/constants
   *      positions: [
   *          1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1, // v0-v1-v2-v3 front
   *          1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1, // v0-v3-v4-v1 right
   *          1, 1, 1, 1, 1, -1, -1, 1, -1, -1, 1, 1, // v0-v1-v6-v1 top
   *          -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, // v1-v6-v7-v2 left
   *          -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,// v7-v4-v3-v2 bottom
   *          1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1 // v4-v7-v6-v1 back
   *      ],
   *      indices: [
   *          0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
   *          16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23
   *      ]
   *  });
   *
   * if (!boxGeometryResult.ok) {
   *    console.error(boxGeometryResult.error);
   *    return;
   * } else {
   *    const boxGeometry = boxGeometryResult.value;
   * }
   *
   * const boxGeometryAgain = sceneModel.geometries["boxGeometry"];
   * ````
   *
   * See {@link model!scene | @xeokit/sdk/model/scene}   for more usage info.
   *
   * `geometryParams.positions` supplies the current/base positions for ordinary
   * static geometry. For fixed-topology frame sequences, callers may omit
   * `positions` and provide {@link SceneGeometryParams.frames | frames}; in that
   * case `frames[0].positions` becomes the current/base geometry while all
   * frames are retained on the created {@link SceneGeometry}.
   *
   * @param geometryParams Non-compressed geometry parameters.
   * @returns SDKResult with:
   * - On success, the created {@link model!scene.SceneGeometry | SceneGeometry}.
   * - On failure, an error message. Reasons for failure include:
   *   - If this SceneModel has already been destroyed.
   *   - Invalid {@link SceneGeometryParams} were given.
   *   - A {@link model!scene.SceneGeometry | SceneGeometry} with the given ID already exists in this SceneModel.
   *   - Unsupported primitive type was provided.
   *   - Neither `positions` nor `frames[0].positions` were provided.
   *   - Frame arrays do not match the base vertex count.
   *   - Frame times are missing, non-finite or not strictly increasing.
   *   - Mandatory indices were not provided for primitive types other than {@link base!constants.PointsPrimitive | PointsPrimitive}.
   *   - Indices are out of range of vertex positions.
   *   - Indices are out of range of vertex UVs.
   *   - Mismatch between the quantities of vertex positions and UVs.
   */
  createGeometry(geometryParams: SceneGeometryParams): SDKResult<SceneGeometry> {

    const createError = this._assertCanCreate("createGeometry");
    if (createError) {
      return createError;
    }


    if (!geometryParams) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometry] Missing required 'geometryParams'."
      });
    }

    const {id, positions, indices, primitive, uvs, colors, normals, frames, vertexStates, morphTargets} = geometryParams;
    const sourceVertexStates = vertexStates ?? frames;
    const basePositions = positions ?? sourceVertexStates?.[0]?.positions;
    const baseNormals = normals ?? sourceVertexStates?.[0]?.normals;

    if (id === null || id === undefined) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometry] Missing required 'id' in geometryParams."
      });
    }

    if (this.geometries[id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createGeometry] A geometry with ID '${id}' already exists in this SceneModel.`
      });
    }

    if (!basePositions) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometry] Missing required 'positions' or 'frames[0].positions' in geometryParams."
      });
    }

    if (basePositions.length === 0 ) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometry] Geometry positions cannot be empty."
      });
    }

    if (basePositions.length % 3 !== 0) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometry] The length of geometry positions must be a multiple of 3."
      });
    }

    if (sourceVertexStates) {
      if (sourceVertexStates.length === 0) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometry] 'vertexStates' cannot be empty."
        });
      }
      for (let i = 0, len = sourceVertexStates.length; i < len; i++) {
        const frame = sourceVertexStates[i];
        if (!frame.positions) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] Missing required 'positions' in vertexStates[${i}].`
          });
        }
        if (frames && !Number.isFinite((frame as any).time)) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] Invalid time in frames[${i}].`
          });
        }
        if (frames && i > 0 && (frame as any).time <= (sourceVertexStates[i - 1] as any).time) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: "[SceneModel.createGeometry] Frame times must be strictly increasing."
          });
        }
        if (frame.positions.length !== basePositions.length) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] Mismatch between base positions and frames[${i}].positions`
          });
        }
        if (frame.positions.length % 3 !== 0) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] The length of frames[${i}].positions must be a multiple of 3.`
          });
        }
        if (frame.normals && frame.normals.length !== frame.positions.length) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] Mismatch between given quantities of positions and normals in frames[${i}]`
          });
        }
      }
    }
    if (morphTargets) {
      const uvError = validateMorphTargetUVs(morphTargets, uvs ?? geometryParams.texCoords?.[0], basePositions.length / 3);
      if (uvError) return this.scene.logError({ok: false, type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createGeometry] ${uvError}`});
      for (let i = 0; i < morphTargets.length; i++) {
        const target = morphTargets[i];
        if (target.positions && target.positions.length !== basePositions.length) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] morphTargets[${i}].positions length must match base positions.`
          });
        }
        if (target.normals && target.normals.length !== basePositions.length) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometry] morphTargets[${i}].normals length must match base positions.`
          });
        }
      }
    }

    if (primitive !== PointsPrimitive && primitive !== GaussianSplatsPrimitive && (!indices || indices.length===0)) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometry] Missing/empty required 'indices' for the specified primitive type."
      });
    }

    if (
      primitive !== PointsPrimitive &&
      primitive !== LinesPrimitive &&
      primitive !== TrianglesPrimitive &&
      primitive !== SolidPrimitive &&
      primitive !== SurfacePrimitive &&
      primitive !== GaussianSplatsPrimitive
    ) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error:
          `[SceneModel.createGeometry] Unsupported value for geometryParams.primitive: '${primitive}' - ` +
          "supported values are PointsPrimitive, LinesPrimitive, TrianglesPrimitive, SolidPrimitive, SurfacePrimitive and GaussianSplatsPrimitive"
      });
    }

    if (colors && colors.length > 0) {
      if (colors.length / 4 !== basePositions.length / 3) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometry] Mismatch between given quantities of vertex positions and colors"
        });
      }
    }

    if (uvs && uvs.length > 0) {
      if (uvs.length / 2 !== basePositions.length / 3) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometry] Mismatch between given quantities of vertex positions and UVs"
        });
      }
    }

    if (baseNormals && baseNormals.length > 0) {
      if (baseNormals.length !== basePositions.length) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometry] Mismatch between given quantities of vertex positions and normals"
        });
      }
    }

    if (indices) {
      const lastPositionsIdx = basePositions.length / 3;
      for (let i = 0, len = indices.length; i < len; i++) {
        const idx = indices[i];
        if (idx < 0 || idx >= lastPositionsIdx) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: "[SceneModel.createGeometry] Indices out of range of vertex positions"
          });
        }
        if (uvs) {
          const lastUVsIdx = uvs.length / 2;
          if (idx < 0 || idx >= lastUVsIdx) {
            return this.scene.logError({
              ok: false,
              type: SDKErrorType.InvalidInput,
              error: "[SceneModel.createGeometry] Indices out of range of vertex UVs"
            });
          }
        }
      }
    }

    const sceneGeometry = new SceneGeometry(
      this,
      compressGeometryParams(geometryParams) as SceneGeometryCompressedParams
    );

    this.geometries[id] = sceneGeometry;
    this.stats.numGeometries++;
    this._bumpPrimitiveCount(sceneGeometry.primitive, 1);

    if (indices) {
      if (sceneGeometry.primitive === TrianglesPrimitive) {
        this.stats.numTriangles += indices.length / 3;
      } else if (sceneGeometry.primitive === LinesPrimitive) {
        this.stats.numLines += indices.length / 2;
      }
    } else if (sceneGeometry.primitive === PointsPrimitive) {
      this.stats.numPoints += basePositions.length / 3;
    }
    this.stats.numVertices += basePositions.length / 3;

    this._recordActiveBatchComponent(sceneGeometry);
    this.scene.events.onSceneGeometryCreated.dispatch(this.scene, sceneGeometry);

    return {
      ok: true,
      value: sceneGeometry
    };
  }

  /**
   * Creates a new {@link model!scene.SceneGeometry | SceneGeometry} within this SceneModel, from pre-compressed geometry parameters.
   *
   * - Stores the new {@link model!scene.SceneGeometry | SceneGeometry} in {@link SceneModel.geometries | SceneModel.geometries}.
   * - Use {@link compressGeometryParams | compressGeometryParams} to pre-compress {@link SceneGeometryParams | SceneGeometryParams}
   *   into {@link SceneGeometryCompressedParams | SceneGeometryCompressedParams}.
   * - Fires {@link SceneEvents.onSceneGeometryCreated | SceneEvents.onSceneGeometryCreated} event.
   *
   * ### Usage
   *
   * ````javascript
   * const boxGeometryResult = sceneModel.createGeometryCompressed({
   *      id: "boxGeometry",
   *      primitive: TrianglesPrimitive, // @xeokit/constants
   *      aabb: [-1,-1,-1, 1,1,1],
   *      positionsCompressed: [
   *          65525, 65525, 65525, 0, 65525, 65525, 0, 0,
   *          65525, 65525, 0, 65525, 65525, 0, 0, 65525,
   *          65525, 0, 0, 65525, 0, 0, 0, 0
   *      ],
   *      indices: [
   *          0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6,
   *          0, 6, 1, 1, 6, 7, 1, 7, 2, 7, 4, 3, 7, 3, 2,
   *          4, 7, 6, 4, 6, 5
   *      ]
   * });
   *
   * if (!boxGeometryResult.ok) {
   *   console.error(boxGeometryResult.error);
   *   return;
   * } else {
   *    const boxGeometry = boxGeometryResult.value;
   * }
   * ````
   *
   * See {@link model!scene | @xeokit/sdk/model/scene}   for more usage info.
   *
   * `geometryCompressedParams.positionsCompressed` and `aabb` supply the
   * current/base compressed positions for ordinary static geometry. For
   * fixed-topology frame sequences, callers may omit those top-level fields and
   * provide {@link SceneGeometryCompressedParams.framesCompressed | framesCompressed};
   * in that case `framesCompressed[0].positionsCompressed` and
   * `framesCompressed[0].aabb` become the current/base geometry while all frames
   * are retained on the created {@link SceneGeometry}.
   *
   * @param geometryCompressedParams Pre-compressed geometry parameters.
   *
   * @returns SDKResult with:
   * * On success, the created {@link model!scene.SceneGeometry | SceneGeometry}.
   * * On failure, an error message. Reasons for failure include:
   *   - If this SceneModel has already been destroyed.
   *   - Invalid SceneGeometryCompressedParams were given.
   *   - SceneGeometry of given ID already exists in this SceneModel.
   *   - Unsupported primitive type given.
   *   - Neither `positionsCompressed` nor `framesCompressed[0].positionsCompressed` were given.
   *   - Frame arrays do not match the base vertex count.
   *   - Frame times are missing, non-finite or not strictly increasing.
   *   - Mandatory indices were not given for primitive type that is not {@link base!constants.PointsPrimitive | PointsPrimitive}. Indices are mandatory for all primitive types except PointsPrimitive.
   *   - Indices out of range of vertex positions.
   *   - Indices out of range of vertex UVs.
   *   - Mismatch between given quantities of vertex positions and UVs.
   */
  createGeometryCompressed(
    geometryCompressedParams: SceneGeometryCompressedParams
  ): SDKResult<SceneGeometry> {

    const createError = this._assertCanCreate("createGeometryCompressed");
    if (createError) {
      return createError;
    }


    if (!geometryCompressedParams) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] Parameters expected: geometryCompressedParams"
      });
    }

    const {
      id,
      indices,
      primitive,
      positionsCompressed: inputPositionsCompressed,
      uvsCompressed,
      texCoordsCompressed,
      normalsCompressed,
      colorsCompressed,
      aabb: inputAABB,
      framesCompressed,
      vertexStatesCompressed,
      morphTargets,
      scales,
      rotations
    } = geometryCompressedParams;
    const sourceVertexStatesCompressed = vertexStatesCompressed ?? framesCompressed;
    const positionsCompressed = inputPositionsCompressed ?? sourceVertexStatesCompressed?.[0]?.positionsCompressed;
    const aabb = inputAABB ?? sourceVertexStatesCompressed?.[0]?.aabb;

    if (id === null || id === undefined) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] Parameter expected: 'id'"
      });
    }

    if (!positionsCompressed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] Parameter expected: 'positionsCompressed' or 'framesCompressed[0].positionsCompressed'"
      });
    }

    if (positionsCompressed.length === 0) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] 'positionsCompressed' cannot be empty."
      });
    }

    if (positionsCompressed.length % 3 !== 0) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] The length of 'positionsCompressed' must be a multiple of 3."
      });
    }

    if (
      primitive !== PointsPrimitive &&
      primitive !== LinesPrimitive &&
      primitive !== TrianglesPrimitive &&
      primitive !== SolidPrimitive &&
      primitive !== SurfacePrimitive &&
      primitive !== GaussianSplatsPrimitive
    ) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error:
          `[SceneModel.createGeometryCompressed] Unsupported value for parameter 'primitive': '${primitive}' - ` +
          "supported values are PointsPrimitive, LinesPrimitive, TrianglesPrimitive, SolidPrimitive, SurfacePrimitive and GaussianSplatsPrimitive"
      });
    }

    if (!aabb || aabb.length !== 6) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] Parameter expected: 'aabb' with six elements."
      });
    }

    if (!inputPositionsCompressed) {
      geometryCompressedParams.positionsCompressed = positionsCompressed;
    }
    if (!inputAABB) {
      geometryCompressedParams.aabb = aabb;
    }

    if (sourceVertexStatesCompressed) {
      if (sourceVertexStatesCompressed.length === 0) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] 'framesCompressed' cannot be empty."
        });
      }
      for (let i = 0, len = sourceVertexStatesCompressed.length; i < len; i++) {
        const frame = sourceVertexStatesCompressed[i];
        if (!frame.positionsCompressed) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Missing required 'positionsCompressed' in framesCompressed[${i}].`
          });
        }
        if (framesCompressed && !Number.isFinite((frame as any).time)) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Invalid time in framesCompressed[${i}].`
          });
        }
        if (framesCompressed && i > 0 && (frame as any).time <= (sourceVertexStatesCompressed[i - 1] as any).time) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: "[SceneModel.createGeometryCompressed] Frame times must be strictly increasing."
          });
        }
        if (frame.positionsCompressed.length !== positionsCompressed.length) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Mismatch between base positions and framesCompressed[${i}].positionsCompressed`
          });
        }
        if (frame.positionsCompressed.length % 3 !== 0) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] The length of framesCompressed[${i}].positionsCompressed must be a multiple of 3.`
          });
        }
        if (!frame.aabb || frame.aabb.length !== 6) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Parameter expected: 'aabb' with six elements in framesCompressed[${i}].`
          });
        }
        if (frame.normalsCompressed && frame.normalsCompressed.length / 2 !== frame.positionsCompressed.length / 3) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and normals in framesCompressed[${i}]`
          });
        }
        if (frame.uvsCompressed && frame.uvsCompressed.length / 2 !== frame.positionsCompressed.length / 3) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and UVs in framesCompressed[${i}]`
          });
        }
      }
    }
    if (morphTargets) {
      const vertexCount = positionsCompressed.length / 3;
      const uvError = validateMorphTargetUVs(morphTargets, uvsCompressed ?? texCoordsCompressed?.[0], vertexCount);
      if (uvError) return this.scene.logError({ok: false, type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createGeometryCompressed] ${uvError}`});
      for (let i = 0; i < morphTargets.length; i++) {
        const target = morphTargets[i];
        if (target.positions && target.positions.length !== positionsCompressed.length) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] morphTargets[${i}].positions length must match base positions.`
          });
        }
        if (target.normals && target.normals.length !== vertexCount * 3) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] morphTargets[${i}].normals length must match vertex count * 3.`
          });
        }
      }
    }

    if ((!indices || indices.length === 0) && primitive !== PointsPrimitive && primitive !== GaussianSplatsPrimitive) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createGeometryCompressed] Missing expected 'indices' for the specified primitive type."
      });
    }

    if (indices) {
      if (primitive === LinesPrimitive && indices.length % 2 !== 0) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] The length of 'indices' must be a multiple of 2 for line geometry."
        });
      }
      if (
        (primitive === TrianglesPrimitive || primitive === SolidPrimitive || primitive === SurfacePrimitive) &&
        indices.length % 3 !== 0
      ) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] The length of 'indices' must be a multiple of 3 for triangle geometry."
        });
      }
    }

    const numVertices = positionsCompressed.length / 3;

    if (colorsCompressed) {
      if (colorsCompressed.length / 4 !== numVertices) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and colors"
        });
      }
    }

    if (uvsCompressed) {
      if (uvsCompressed.length / 2 !== numVertices) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and UVs"
        });
      }
    }

    if (texCoordsCompressed) {
      for (const key of Object.keys(texCoordsCompressed)) {
        const channel = Number(key);
        const texCoords = texCoordsCompressed[channel];
        if (!Number.isInteger(channel) || channel < 0) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: "[SceneModel.createGeometryCompressed] Texture-coordinate channel indices must be non-negative integers"
          });
        }
        if (texCoords && texCoords.length / 2 !== numVertices) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and texture-coordinate channel ${channel}`
          });
        }
      }
    }

    if (normalsCompressed) {
      if (normalsCompressed.length / 2 !== numVertices) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and normals"
        });
      }
    }

    if (scales) {
      if (scales.length / 3 !== numVertices) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and splat scales"
        });
      }
    }

    if (rotations) {
      if (rotations.length / 4 !== numVertices) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createGeometryCompressed] Mismatch between given quantities of vertex positions and splat rotations"
        });
      }
    }

    if (indices) {
      const lastPositionsIdx = numVertices;
      for (let i = 0, len = indices.length; i < len; i++) {
        const idx = indices[i];
        if (idx < 0 || idx >= lastPositionsIdx) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: "[SceneModel.createGeometryCompressed] Indices out of range of vertex positions"
          });
        }
        if (uvsCompressed) {
          const lastUVsIdx = uvsCompressed.length / 2;
          if (idx < 0 || idx >= lastUVsIdx) {
            return this.scene.logError({
              ok: false,
              type: SDKErrorType.InvalidInput,
              error: "[SceneModel.createGeometryCompressed] Indices out of range of vertex UVs"
            });
          }
        }
      }
    }

    const geometryId = id;
    if (this.geometries[geometryId]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createGeometryCompressed] SceneGeometry with this ID already exists: '${geometryId}'`
      });
    }

    const sceneGeometry = new SceneGeometry(this, geometryCompressedParams);
    this.geometries[geometryId] = sceneGeometry;
    this.stats.numGeometries++;
    this._bumpPrimitiveCount(sceneGeometry.primitive, 1);


    if (indices) {
      if (sceneGeometry.primitive === TrianglesPrimitive) {
        this.stats.numTriangles += indices.length / 3;
      } else if (sceneGeometry.primitive === LinesPrimitive) {
        this.stats.numLines += indices.length / 2;
      }
    } else if (sceneGeometry.primitive === PointsPrimitive) {
      this.stats.numPoints += positionsCompressed.length / 3;
    }
    this.stats.numVertices += positionsCompressed.length / 3;

    this._recordActiveBatchComponent(sceneGeometry);
    this.scene.events.onSceneGeometryCreated.dispatch(this.scene, sceneGeometry);

    return {
      ok: true,
      value: sceneGeometry
    };
  }


  /**
   * Returns `true` if this SceneModel currently holds at least one
   * {@link SceneGeometry} of the given primitive type — e.g.
   * `model.containsPrimitive(GaussianSplatsPrimitive)`.
   *
   * Backed by a live per-primitive count maintained as geometries are created
   * and destroyed, so it is O(1) and correct regardless of when geometries were
   * added relative to the model's creation event.
   */
  containsPrimitive(primitive: number): boolean {
    return (this._primitiveCounts.get(primitive) ?? 0) > 0;
  }

  /** Adjusts the per-primitive geometry count, clearing zeroed entries. */
  private _bumpPrimitiveCount(primitive: number, delta: number): void {
    const next = (this._primitiveCounts.get(primitive) ?? 0) + delta;
    if (next > 0) {
      this._primitiveCounts.set(primitive, next);
    } else {
      this._primitiveCounts.delete(primitive);
    }
  }

  /**
   * @internal
   * Destroys a {@link model!scene.SceneGeometry | SceneGeometry} previously
   * created in this model.
   * Called by a {@link model!scene.SceneGeometry | SceneGeometry} when it is
   * destroyed.
   */
  _destroyGeometry(sceneGeometry: SceneGeometry) {
    const geometryId = sceneGeometry.id;
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneGeometry '${geometryId}' - SceneModel already destroyed`);
    }
    if (!this.geometries[geometryId]) {
      throw new SDKInternalException(`Cannot destroy SceneGeometry '${geometryId}' - SceneGeometry not found in SceneModel`);
    }
    if (sceneGeometry.numMeshes > 0) {
      // We catch this gracefully in SceneGeometry.destroy(), but just in case...
      throw new SDKInternalException(`Cannot destroy SceneGeometry '${geometryId}' - SceneGeometry is currently used by at least one SceneMesh, which you need to destroy first`);
    }
    delete this.geometries[geometryId];
    this.stats.numGeometries--;
    this._bumpPrimitiveCount(sceneGeometry.primitive, -1);
    if (sceneGeometry.indices) {
      if (sceneGeometry.primitive === TrianglesPrimitive) {
        this.stats.numTriangles -= sceneGeometry.indices.length / 3;
      } else if (sceneGeometry.primitive === LinesPrimitive) {
        this.stats.numLines -= sceneGeometry.indices.length / 2;
      }
    } else if (sceneGeometry.primitive === PointsPrimitive) {
      this.stats.numPoints -= sceneGeometry.positionsCompressed.length / 3;
    }
    this.stats.numVertices -= sceneGeometry.positionsCompressed.length / 3;
    this.scene.events.onSceneGeometryDestroyed.dispatch(this.scene, sceneGeometry);
  }

  /**
   * Creates a new {@link model!scene.SceneMesh | SceneMesh} within this SceneModel.
   *
   * - Stores the new {@link model!scene.SceneMesh | SceneMesh} in {@link SceneModel.meshes | SceneModel.meshes}.
   * - A {@link model!scene.SceneMesh | SceneMesh} can be owned by one {@link model!scene.SceneObject | SceneObject}, which can own multiple {@link model!scene.SceneMesh | SceneMesh}es.
   * - Increments the {@link SceneGeometry.numMeshes | numMeshes} of the associated {@link model!scene.SceneGeometry | SceneGeometry}.
   * - Fires {@link SceneEvents.onSceneMeshCreated | SceneEvents.onSceneMeshCreated} event.
   *
   * ### Usage
   *
   * ````javascript
   * const redBoxMeshResult = sceneModel.createLayerMesh({
   *      id: "redBoxMesh",
   *      geometryId: "boxGeometry",
   *      materialId: "myMaterial",
   *      position: [-4, -6, -4],
   *      scale: [1, 3, 1],
   *      rotation: [0, 0, 0],
   *      color: [1, 0.3, 0.3]
   * });
   *
   * if (!redBoxMeshResult.ok) {
   *   console.error(redBoxMeshResult.error);
   *   return;
   * } else {
   *    const redBoxMesh = redBoxMeshResult.value;
   * }
   * ````
   *
   * See {@link model!scene | @xeokit/sdk/model/scene}   for more usage info.
   *
   * @param meshParams Pre-compressed mesh parameters.
   * @returns SDKResult with:
   * * On success, the created {@link model!scene.SceneMesh | SceneMesh}.
   * * On failure, an error message. Reasons for failure include:
   *   - If this SceneModel has already been destroyed.
   *   - Invalid {@link SceneMeshParams} were given.
   *   - A {@link model!scene.SceneMesh | SceneMesh} with the given ID already exists in this SceneModel.
   *   - The specified parent {@link SceneTransform} was not found.
   *   - The specified {@link model!scene.SceneGeometry | SceneGeometry} was not found.
   *   - The specified {@link model!scene.SceneMaterial | SceneMaterial} was not found.
   *   - `frameTime` was supplied but is not finite.
   */
  createMesh(meshParams: SceneMeshParams): SDKResult<SceneMesh> {

    if (meshParams.representationMode !== undefined && !["replace", "augment"].includes(meshParams.representationMode)) {
      return {ok: false, type: SDKErrorType.InvalidInput, error: "Invalid representation ownership mode"};
    }
    if (meshParams.representationId !== undefined &&
        (typeof meshParams.representationId !== "string" || !meshParams.representationId)) {
      return {ok: false, type: SDKErrorType.InvalidInput, error: "Representation binding must be a nonempty ID"};
    }

    let {
      id,
      geometryId,
      parentTransformId,
      materialId,
      matrix,
      position,
      scale,
      rotation,
      quaternion,
      origin,
      color,
      opacity,
      frameTime,
      morphWeights,
      billboard,
      bin
    } = meshParams;

    const createError = this._assertCanCreate("createMesh");
    if (createError) {
      return createError;
    }


    if (this.meshes[id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMesh] SceneMesh already exists with this ID: '${id}'`
      });
    }

    let transform: SceneTransform | undefined;
    if (parentTransformId) {
      transform = this.transforms[parentTransformId];
      if (!transform) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createMesh] parent SceneTransform not found: '${parentTransformId}'`
        });
      }
    }

    const geometry = this.geometries[geometryId];
    if (!geometry) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMesh] SceneGeometry not found: '${geometryId}'`
      });
    }

    const material = materialId ? this.materials[materialId] : undefined;
    if (materialId && !material) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMesh] Material not found: '${materialId}'`
      });
    }

    // Build matrix (clone if provided; otherwise compose or identity)

    if (origin && origin.length !== 3) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMesh] Parameter 'origin' is not a vec3 array`
      });
    }

    if (!matrix) {
      if (position || scale || rotation || quaternion || origin) {

        if (position && position.length !== 3) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createMesh] Parameter 'position' is not a vec3 array`
          });
        }

        if (scale && scale.length !== 3) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createMesh] Parameter 'scale' is not a vec3 array`
          });
        }

        if (rotation && rotation.length !== 3) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createMesh] Parameter 'rotation' is not a vec3 array`
          });
        }

        if (quaternion && quaternion.length !== 4) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createMesh] Parameter 'quaternion' is not a vec4 array`
          });
        }

        matrix = identityMat4();

        composeMat4(
          position || [0, 0, 0],
          quaternion || eulerToQuat(rotation || [0, 0, 0], "XYZ", identityQuat()),
          scale || [1, 1, 1],
          matrix
        );
      }
      // No transform params at all: leave `matrix` undefined so the SceneMesh
      // shares its identity sentinel instead of allocating a per-mesh identity.
    } else {
      if (matrix.length !== 16) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createMesh] Parameter 'matrix' is not a mat4 array`
        });
      }
      matrix = createMat4Float64(matrix);
    }

    if (origin && matrix) {
      matrix[12] += origin[0];
      matrix[13] += origin[1];
      matrix[14] += origin[2];
    }

    if (color && color.length !== 3) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMesh] Parameter 'color' is not a vec3 array`
      });
    }

    if (billboard !== undefined && billboard !== "none" && billboard !== "spherical") {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createMesh] Unsupported billboard mode: '${billboard}'`
      });
    }

    if (frameTime !== undefined && !Number.isFinite(frameTime)) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createMesh] Parameter 'frameTime' must be finite"
      });
    }

    const morphTargetCount = geometry.morphTargets?.length ?? 0;
    if (morphWeights !== undefined) {
      if (morphWeights.length !== morphTargetCount) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createMesh] Parameter 'morphWeights' length must match geometry morph target count ${morphTargetCount}`
        });
      }
      for (let i = 0; i < morphWeights.length; i++) {
        if (!Number.isFinite(morphWeights[i])) {
          return this.scene.logError({
            ok: false,
            type: SDKErrorType.InvalidInput,
            error: `[SceneModel.createMesh] Parameter 'morphWeights[${i}]' must be finite`
          });
        }
      }
    }

    const sceneMesh = new SceneMesh({
      id,
      model: this,
      geometry,
      material,
      matrix,
      color,
      opacity,
      frameTime,
      morphWeights,
      billboard: billboard ?? "none",
      representationId: meshParams.representationId,
      representationMode: meshParams.representationMode,
      bin
    });

    if (transform) {
      sceneMesh.setParentTransformId(transform.id);
    }

    geometry.numMeshes++;
    if (material) {
      material.numMeshes++;
    }
    this.meshes[id] = sceneMesh;
    this.stats.numMeshes++;
    this._recordActiveBatchComponent(sceneMesh);
    this.scene.events.onSceneMeshCreated.dispatch(this.scene, sceneMesh);

    return {
      ok: true,
      value: sceneMesh
    };
  }

  /**
   * @internal
   * Destroys a {@link model!scene.SceneMesh | SceneMesh} previously created in this model.
   * Called by a {@link model!scene.SceneMesh | SceneMesh} when it is destroyed.
   */
  _destroyMesh(sceneMesh: SceneMesh) {
    const meshId = sceneMesh.id;
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneMesh '${meshId}' - SceneModel already destroyed`);
    }
    const existing = this.meshes[meshId];
    if (!existing) {
      throw new SDKInternalException(`Cannot destroy SceneMesh '${meshId}' - SceneMesh not found in SceneModel`);
    }
    // (Optional strengthening) Ensure the passed instance matches the one stored.
    if (existing !== sceneMesh) {
      throw new SDKInternalException(`Cannot destroy SceneMesh '${meshId}' - provided instance does not match stored mesh`);
    }
    if (existing.object) {
      // We catch this gracefully in SceneMesh.destroy(), but just in case...
      throw new SDKInternalException(
        `Cannot destroy SceneMesh '${meshId}' - SceneMesh belongs to SceneObject '${existing.object.id}', which you need to destroy first`
      );
    }
    if (existing.geometry) {
      existing.geometry.numMeshes--;
    }
    if (existing.material) {
      existing.material.numMeshes--;
    }
    delete this.meshes[meshId];
    this.stats.numMeshes--;
    this.scene.events.onSceneMeshDestroyed.dispatch(this.scene, existing);
  }

  /**
   * Creates a variant set in this SceneModel.
   *
   * A variant set declares alternative groups of objects for the same
   * logical content. Each variant references SceneObjects by ID; it does
   * not own those objects and does not reference raw geometry or mesh resources.
   *
   * The active variant belongs to the viewing layer. Different Views can
   * select different variants from the same model at the same time.
   *
   * @param variantSetParams Variant set parameters.
   * @returns SDKResult with the created variant set, or an error when
   * validation fails.
   */
  createVariantSet(variantSetParams: SceneVariantSetParams): SDKResult<SceneVariantSet> {
    const createError = this._assertCanCreate("createVariantSet");
    if (createError) {
      return createError;
    }
    const validation = this._validateVariantSetParams(variantSetParams);
    if (validation) {
      return validation;
    }

    const variantSet = new SceneVariantSet(this, variantSetParams);
    this.variantSets[variantSet.id] = variantSet;
    this._indexVariantSet(variantSet);
    this.scene.events.onSceneVariantSetCreated.dispatch(this, variantSet);
    return {
      ok: true,
      value: variantSet
    };
  }

  /**
   * Gets variant sets that reference a SceneObject.
   *
   * @param objectId SceneObject ID.
   * @returns Variant sets that contain the object in at least one
   * variant.
   */
  getVariantSetsForObject(objectId: string): SceneVariantSet[] {
    return Array.from(this._variantSetsByObjectId.get(objectId) ?? []);
  }

  /**
   * @internal
   * Destroys a variant set previously created in this model.
   * Called by {@link SceneVariantSet.destroy}.
   */
  _destroyVariantSet(variantSet: SceneVariantSet): void {
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneVariantSet '${variantSet.id}' - SceneModel already destroyed`);
    }
    if (!this.variantSets[variantSet.id]) {
      throw new SDKInternalException(`Cannot destroy SceneVariantSet '${variantSet.id}' - SceneVariantSet not found in SceneModel`);
    }
    this._unindexVariantSet(variantSet);
    delete this.variantSets[variantSet.id];
    this.scene.events.onSceneVariantSetDestroyed.dispatch(this, variantSet);
  }

  private _validateVariantSetParams(variantSetParams: SceneVariantSetParams): SDKResult<SceneVariantSet> | null {
    if (!variantSetParams) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createVariantSet] Missing required 'variantSetParams'."
      });
    }
    if (!variantSetParams.id) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createVariantSet] Missing required 'id'."
      });
    }
    if (this.variantSets[variantSetParams.id]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createVariantSet] SceneVariantSet already exists with this ID: '${variantSetParams.id}'`
      });
    }
    if (!variantSetParams.defaultVariantId) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createVariantSet] Missing required 'defaultVariantId'."
      });
    }
    if (!Array.isArray(variantSetParams.variants) || variantSetParams.variants.length === 0) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createVariantSet] Expected at least one variant."
      });
    }
    const selection = variantSetParams.selection;
    if (selection) {
      if (selection.strategy !== "projectedSize") {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] Unsupported selection strategy: '${(selection as any).strategy}'`
        });
      }
      if (selection.hysteresisPixels !== undefined && (!Number.isFinite(selection.hysteresisPixels) || selection.hysteresisPixels < 0)) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: "[SceneModel.createVariantSet] selection.hysteresisPixels must be a finite non-negative number."
        });
      }
    }

    const variantIds = new Set<string>();
    for (let i = 0, len = variantSetParams.variants.length; i < len; i++) {
      const variant = variantSetParams.variants[i];
      const result = this._validateVariantParams(variantSetParams.id, variant, variantIds, variant.id === variantSetParams.defaultVariantId);
      if (result) {
        return result;
      }
    }
    if (!variantIds.has(variantSetParams.defaultVariantId)) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createVariantSet] defaultVariantId '${variantSetParams.defaultVariantId}' does not reference a variant in SceneVariantSet '${variantSetParams.id}'.`
      });
    }
    return null;
  }

  private _validateVariantParams(variantSetId: string, variantParams: SceneVariantParams, variantIds: Set<string>, isDefaultVariant: boolean): SDKResult<SceneVariantSet> | null {
    if (!variantParams || !variantParams.id) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createVariantSet] Variant in SceneVariantSet '${variantSetId}' is missing required 'id'.`
      });
    }
    if (variantIds.has(variantParams.id)) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createVariantSet] Duplicate variant ID '${variantParams.id}' in SceneVariantSet '${variantSetId}'.`
      });
    }
    variantIds.add(variantParams.id);
    if (!Array.isArray(variantParams.objectIds)) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createVariantSet] Variant '${variantParams.id}' in SceneVariantSet '${variantSetId}' must provide SceneObject IDs.`
      });
    }
    if (isDefaultVariant && variantParams.objectIds.length === 0) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createVariantSet] Default variant '${variantParams.id}' in SceneVariantSet '${variantSetId}' must reference at least one SceneObject.`
      });
    }
    const objectIds = new Set<string>();
    for (let i = 0, len = variantParams.objectIds.length; i < len; i++) {
      const objectId = variantParams.objectIds[i];
      if (!objectId) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] Variant '${variantParams.id}' in SceneVariantSet '${variantSetId}' has an empty SceneObject ID.`
        });
      }
      if (objectIds.has(objectId)) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] Variant '${variantParams.id}' in SceneVariantSet '${variantSetId}' references SceneObject '${objectId}' more than once.`
        });
      }
      objectIds.add(objectId);
      if (!this.objects[objectId]) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] SceneObject not found: '${objectId}'`
        });
      }
    }
    const range = variantParams.range;
    if (range) {
      const minPixels = range.minPixels;
      const maxPixels = range.maxPixels;
      if (minPixels !== undefined && (!Number.isFinite(minPixels) || minPixels < 0)) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] Variant '${variantParams.id}' range.minPixels must be a finite non-negative number.`
        });
      }
      if (maxPixels !== undefined && (!Number.isFinite(maxPixels) || maxPixels < 0)) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] Variant '${variantParams.id}' range.maxPixels must be a finite non-negative number.`
        });
      }
      if (minPixels !== undefined && maxPixels !== undefined && minPixels > maxPixels) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createVariantSet] Variant '${variantParams.id}' has contradictory projected-size range.`
        });
      }
    }
    return null;
  }

  private _indexVariantSet(variantSet: SceneVariantSet): void {
    for (const variantId in variantSet.variants) {
      const variant = variantSet.variants[variantId];
      for (let i = 0, len = variant.objectIds.length; i < len; i++) {
        const objectId = variant.objectIds[i];
        let variantSets = this._variantSetsByObjectId.get(objectId);
        if (!variantSets) {
          variantSets = new Set<SceneVariantSet>();
          this._variantSetsByObjectId.set(objectId, variantSets);
        }
        variantSets.add(variantSet);
      }
    }
  }

  private _unindexVariantSet(variantSet: SceneVariantSet): void {
    for (const variantId in variantSet.variants) {
      const variant = variantSet.variants[variantId];
      for (let i = 0, len = variant.objectIds.length; i < len; i++) {
        const objectId = variant.objectIds[i];
        const variantSets = this._variantSetsByObjectId.get(objectId);
        if (!variantSets) {
          continue;
        }
        variantSets.delete(variantSet);
        if (variantSets.size === 0) {
          this._variantSetsByObjectId.delete(objectId);
        }
      }
    }
  }

  /**
   * Creates a new {@link model!scene.SceneObject | SceneObject}.
   *
   * - Stores the new {@link model!scene.SceneObject | SceneObject} in {@link SceneModel.objects | SceneModel.objects} and {@link Scene.objects | Scene.objects}.
   * - Each {@link model!scene.SceneMesh | SceneMesh} is allowed to belong to one SceneObject.
   * - SceneObject IDs must be unique within the SceneModel's {@link Scene | Scene}.
   * - Triggers {@link SceneEvents.onSceneObjectCreated | SceneEvents.onSceneObjectCreated}.
   *
   * ### Usage
   *
   * ````javascript
   * const redBoxObjectResult = sceneModel.createObject({
   *     id: "redBoxObject",
   *     meshIds: ["redBoxMesh"]
   * });
   *
   * if (!redBoxObjectResult.ok) {
   *   console.error(redBoxObjectResult.error);
   *   return;
   *   } else {
   *      const redBoxObject = redBoxObjectResult.value;
   *      const redBoxObjectAgain = sceneModel.objects["redBoxObject"];
   *      const redBoxObjectOnceMore = scene.objects["redBoxObject"];
   * }
   * ````
   *
   * See {@link model!scene | @xeokit/sdk/model/scene}   for more usage info.
   *
   * @param objectParams SceneObject parameters.
   * @returns SDKResult with:
   * * On success, the created {@link model!scene.SceneObject | SceneObject}.
   * * On failure, an error message. Reasons for failure include:
   *   - If this SceneModel has already been destroyed.
   *   - No {@link model!scene.SceneMesh | SceneMesh} IDs were specified.
   *   - A {@link model!scene.SceneObject | SceneObject} with the given ID already exists in this SceneModel's {@link Scene | Scene}.
   *   - A specified {@link model!scene.SceneMesh | SceneMesh} was not found.
   *   - A specified {@link model!scene.SceneMesh | SceneMesh} already belongs to an existing {@link model!scene.SceneObject | SceneObject}.
   */
  createObject(objectParams: SceneObjectParams): SDKResult<SceneObject> {

    const {
      id,
      meshIds,
      layerId,
      originalSystemId
    } = objectParams;

    const createError = this._assertCanCreate("createObject");
    if (createError) {
      return createError;
    }


    if (!meshIds || meshIds.length === 0) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[SceneModel.createObject] No meshes specified"
      });
    }

    const objectId = this.globalizedIds ? `${this.id}.${id}` : id;
    if (this.scene.objects[objectId]) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneModel.createObject] SceneObject already exists: '${objectId}'`
      });
    }

    const meshes = [];
    for (let meshIdIdx = 0, meshIdLen = meshIds.length; meshIdIdx < meshIdLen; meshIdIdx++) {
      const meshId = meshIds[meshIdIdx];
      const mesh = this.meshes[meshId];
      if (!mesh) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createObject] SceneMesh not found: '${meshId}'`
        });
      }
      if (mesh.object) {
        return this.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneModel.createObject] SceneMesh '${meshId}' already belongs to existing SceneObject '${mesh.object.id}'`
        });
      }
      meshes.push(mesh);
    }

    const sceneObject = new SceneObject({
      id: objectId,
      originalSystemId: originalSystemId,
      layerId: this.layerId || layerId,
      clippable: objectParams.clippable,
      model: this,
      meshes
    });

    for (let i = 0, len = meshes.length; i < len; i++) {
      const mesh = meshes[i];
      mesh.object = sceneObject;
    }

    this.objects[objectId] = sceneObject;
    this.stats.numObjects++;
    this._recordActiveBatchComponent(sceneObject);
    this.scene._registerObject(sceneObject);

    return {
      ok: true,
      value: sceneObject
    };
  }

  /**
   * Marks this transform globally dirty and propagates that state to all descendants.
   * @internal
   */
  public setWorldMatrixDirty(): void {
    for (const id in this.transforms) {
      this.transforms[id].setWorldMatrixDirty();
    }
    for (const id in this.meshes) {
      this.meshes[id].setWorldMatrixDirty();
    }
  }

  /**
   * @internal
   * Destroys a {@link model!scene.SceneObject | SceneObject} previously created in this model.
   * Called by a {@link model!scene.SceneObject | SceneObject} when it is destroyed.
   */
  _destroyObject(sceneObject: SceneObject) {
    const objectId = sceneObject.id;
    if (this.destroyed) {
      throw new SDKInternalException(`Cannot destroy SceneObject '${objectId}' - SceneModel already destroyed`);
    }
    if (!this.objects[objectId]) {
      throw new SDKInternalException(`Cannot destroy SceneObject '${objectId}' - SceneObject not found in SceneModel`);
    }
    const variantSets = this.getVariantSetsForObject(objectId);
    for (let i = 0, len = variantSets.length; i < len; i++) {
      const variantSet = variantSets[i];
      if (!variantSet.destroyed) {
        variantSet.destroy();
      }
    }
    const meshes = sceneObject.meshes;
    for (let i = 0, len = meshes.length; i < len; i++) {
      const mesh = meshes[i];
      mesh.object = null;
    }
    delete this.objects[objectId];
    this.stats.numObjects--;
    this.scene._deregisterObject(sceneObject);
  }

  /**
   * Creates components in this SceneModel from {@link SceneModelParams}.
   *
   * See {@link model!scene | @xeokit/sdk/model/scene} for usage.
   *
   * @param sceneModelParams The batch of components to create.
   * @returns SDKResult with:
   * * On success, value==`undefined`.
   * * On failure, an error message.
   */
  fromParams(sceneModelParams: SceneModelParams): SDKResult<any> {

    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.fromParams] SceneModel already destroyed"
      });
    }

    if (this._sealed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.fromParams] SceneModel is sealed"
      });
    }


    if (sceneModelParams.coordinateSystem) {
      this.coordinateSystem.fromParams(sceneModelParams.coordinateSystem);
    }

    if (sceneModelParams.loadingMode !== undefined) {
      this._loadingMode = normalizeLoadingMode(sceneModelParams.loadingMode);
    }
    if (sceneModelParams.updateMode !== undefined) {
      this._updateMode = normalizeUpdateMode(sceneModelParams.updateMode);
    }

    for (const params of sceneModelParams.dataResources ?? []) {
      const result = this.createDataResource(params);
      if (!result.ok) return result;
    }
    for (const params of sceneModelParams.representations ?? []) {
      const result = this.createRepresentation(params);
      if (!result.ok) return result;
    }

    if (sceneModelParams.transforms) {
      for (let i = 0, len = sceneModelParams.transforms.length; i < len; i++) {
        const transformParams = {...sceneModelParams.transforms[i]};
        delete transformParams.parentTransformId;
        const res = this.createTransform(transformParams);
        if (!res.ok) return res;
      }
      for (let i = 0, len = sceneModelParams.transforms.length; i < len; i++) {
        const transformParams = sceneModelParams.transforms[i];
        if (transformParams.parentTransformId) {
          const res = this.transforms[transformParams.id].setParentTransformId(transformParams.parentTransformId);
          if (!res.ok) return res;
        }
      }
    }

    if (sceneModelParams.geometries) {
      for (let i = 0, len = sceneModelParams.geometries.length; i < len; i++) {
        const res = this.createGeometry(sceneModelParams.geometries[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.geometriesCompressed) {
      for (let i = 0, len = sceneModelParams.geometriesCompressed.length; i < len; i++) {
        const res = this.createGeometryCompressed(sceneModelParams.geometriesCompressed[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.textures) {
      for (let i = 0, len = sceneModelParams.textures.length; i < len; i++) {
        const res = this.createTexture(sceneModelParams.textures[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.materials) {
      for (let i = 0, len = sceneModelParams.materials.length; i < len; i++) {
        const res = this.createMaterial(sceneModelParams.materials[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.meshes) {
      for (let i = 0, len = sceneModelParams.meshes.length; i < len; i++) {
        const res = this.createMesh(sceneModelParams.meshes[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.objects) {
      for (let i = 0, len = sceneModelParams.objects.length; i < len; i++) {
        const res = this.createObject(sceneModelParams.objects[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.variantSets) {
      for (let i = 0, len = sceneModelParams.variantSets.length; i < len; i++) {
        const res = this.createVariantSet(sceneModelParams.variantSets[i]);
        if (!res.ok) return res;
      }
    }

    if (sceneModelParams.animations) {
      for (let i = 0, len = sceneModelParams.animations.length; i < len; i++) {
        const res = this.createAnimation(sceneModelParams.animations[i]);
        if (!res.ok) return res;
      }
    }

    if (paramsRequestSeal(sceneModelParams)) {
      return this.seal();
    }

    return {
      ok: true,
      value: undefined
    };
  }

  /**
   * Gets this SceneModel as {@link SceneModelParams}.
   *
   * @remarks
   * Currently serializes: `transforms`, `geometriesCompressed`, `meshes`, and `objects`.
   * (Textures and materials are intentionally omitted/commented.)
   *
   * See {@link model!scene | @xeokit/sdk/model/scene} for usage.
   */
  toParams(): SDKResult<SceneModelParams> {
    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.toParams] SceneModel already destroyed"
      });
    }
    const sceneModelParams: SceneModelParams = {
      id: this.id,
      coordinateSystem: this.coordinateSystem.toParams(),
      dataResources: Object.values(this.dataResources).map(resource => resource.toParams()),
      representations: Object.values(this.representations).map(representation => representation.toParams()),
      headless: this.headless,
      loadingMode: this.loadingMode,
      sealed: this.sealed,
      updateMode: this.updateMode,
      geometriesCompressed: [],
      textures: [],
      materials: [],
      transforms: [],
      meshes: [],
      objects: [],
      variantSets: [],
      animations: []
    };
    // for (const key in this.transforms) {
    //         sceneModelParams.transforms.push(this.transforms[key].toParams());
    // }
    for (const key in this.geometries) {
      const res = this.geometries[key].toParams();
      if (!res.ok) {
        return res;
      }
      sceneModelParams.geometriesCompressed.push(res.value);
    }
    for (const key in this.meshes) {
      const res = this.meshes[key].toParams();
      if (!res.ok) {
        return res;
      }
      sceneModelParams.meshes.push(res.value);
    }
    for (const key in this.objects) {
      const res = this.objects[key].toParams();
      if (!res.ok) {
        return res;
      }
      sceneModelParams.objects.push(res.value);
    }
    for (const key in this.variantSets) {
      sceneModelParams.variantSets.push(this.variantSets[key].toParams());
    }
    for (const key in this.animations) {
      const res = this.animations[key].toParams();
      if (!res.ok) {
        return res;
      }
      sceneModelParams.animations.push(res.value);
    }
    for (const key in this.transforms) {
      const res = this.transforms[key].toParams();
      if (!res.ok) {
        return res;
      }
      sceneModelParams.transforms.push(res.value);
    }
    for (const key in this.textures) {
           const res =  this.textures[key].toParams();
           if (!res.ok) {
             return res;
           }
             sceneModelParams.textures.push(res.value);
    }
    for (const key in this.materials) {
      const res =  this.materials[key].toParams();
      if (!res.ok) {
        return res;
      }
      sceneModelParams.materials.push(res.value);
    }
    return {
      ok: true,
      value: sceneModelParams
    };
  }

  /**
   * Destroys this SceneModel.
   *
   * - Fires {@link SceneEvents.onSceneModelDestroyed | SceneEvents.onSceneModelDestroyed}.
   * - Removes this SceneModel from its {@link model!scene.Scene | Scene}.
   * - Destroys all components created within this SceneModel.
   */
  destroy(): SDKResult<any> {
    if (this.destroyed) {
      return this.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[SceneModel.destroy] SceneModel already destroyed"
      });
    }
    // Order matters: meshes release the geometry/material refs they
    // hold, then materials release the texture refs they hold, then
    // each leaf can destroy with its `numMeshes`/`numMaterials`
    // guard satisfied.
    //
    // Each child's `destroy()` removes itself from the registry it
    // came from, so we snapshot the keys with `Object.keys` before
    // iterating instead of relying on `for..in` over a mutating
    // collection.
    const destroyAll = (registry: { [k: string]: { destroy(): unknown } }): void => {
      for (const key of Object.keys(registry)) {
        registry[key]?.destroy();
      }
    };
    destroyAll(this.objects);
    destroyAll(this.meshes);
    destroyAll(this.representations);
    destroyAll(this.dataResources);
    destroyAll(this.animations);
    destroyAll(this.transforms);
    destroyAll(this.materials);
    destroyAll(this.geometries);
    destroyAll(this.textures);
    this.scene._destroyModel(this);
    this.destroyed = true;
    return {
      ok: true,
      value: undefined
    };
  }
}
