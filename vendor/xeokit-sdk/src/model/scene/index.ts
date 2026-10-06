/**
 * <img style="padding:20px" src="https://xeokit.github.io/sdk/docs/assets/xeokit_docmodel_greyscale_icon.png"/>
 *
 * # Scene Graph
 *
 * The scene module stores 3D model content: geometry, textures, materials,
 * meshes, objects and transforms. It does not render by itself. Rendering is done
 * by attaching a {@link viewing!viewer.Viewer | Viewer} and renderer such as
 * {@link viewing!renderers.webGL.WebGLRenderer | WebGLRenderer}.
 *
 * A {@link Scene} owns one or more {@link SceneModel | SceneModels}. A SceneModel
 * contains shared resources ({@link SceneGeometry | geometries},
 * {@link SceneMaterial | materials}, {@link SceneTexture | textures}) and instances
 * ({@link SceneMesh | meshes}, {@link SceneObject | objects},
 * {@link SceneTransform | transforms}).
 *
 * ## Structure
 *
 * ```mermaid
 * classDiagram
 *     Scene "1" *-- "*" SceneModel : models
 *     Scene "1" *-- "1" CoordinateSystem : coordinateSystem
 *     Scene "1" *-- "1" SceneEvents : emits
 *     Scene "1" *-- "*" SceneObject : objects
 *     SceneModel "1" *-- "1" CoordinateSystem : coordinateSystem
 *     SceneModel "1" *-- "*" SceneGeometry : geometries
 *     SceneModel "1" *-- "*" SceneTexture : textures
 *     SceneModel "1" *-- "*" SceneMaterial : materials
 *     SceneModel "1" *-- "*" SceneMesh : meshes
 *     SceneModel "1" o-- "*" SceneObject : objects
 *     SceneObject "1" o-- "*" SceneMesh : meshes
 *     SceneMesh "1" o-- "1" SceneGeometry : geometry
 *     SceneMesh "1" o-- "1" SceneMaterial : material
 *     SceneMesh "1" o-- "1" SceneTransform : parentTransform
 *     SceneTransform "1" o-- "1" SceneTransform : parentTransform
 *     SceneMaterial "1" o-- "1" SceneTexture : colorTexture
 *     Scene:createModel()
 *     SceneModel:createGeometry()
 *     SceneModel:createMaterial()
 *     SceneModel:createMesh()
 *     SceneModel:createObject()
 *     SceneModel:createTransform()
 *     SceneModel:toParams()
 *     SceneModel:fromParams()
 * ```
 *
 * Main types:
 *
 * - {@link Scene} — root container and global object index.
 * - {@link SceneModel} — owns the resources and objects for one model.
 * - {@link SceneObject} — logical object, usually one picked/selectable thing.
 * - {@link SceneMesh} — renderable instance of geometry with material, transform and per-mesh state.
 * - {@link SceneGeometry} — vertex and index data.
 * - {@link SceneMaterial} and {@link SceneTexture} — visual appearance.
 * - {@link SceneTransform} — reusable hierarchical transform.
 * - {@link CoordinateSystem} — basis, units, origin and scale.
 * - {@link SceneEvents} — lifecycle and error events.
 *
 * ## Coordinate Systems
 *
 * A {@link Scene} has a {@link CoordinateSystem}. Each {@link SceneModel} can also
 * define one. This lets one Scene contain models whose source data uses different
 * bases, units or origins.
 *
 * ```ts
 * scene.coordinateSystem.basis = [
 *   1, 0, 0,
 *   0, 1, 0,
 *   0, 0, -1,
 * ];
 * scene.coordinateSystem.units = "meters";
 * scene.coordinateSystem.origin = [0, 0, 0];
 * scene.coordinateSystem.scaleToMeters = 1.0;
 * ```
 *
 * Scene and SceneModel transforms use double-precision arrays on the CPU. Geometry
 * vertex arrays are single-precision. The WebGL renderer handles large world
 * coordinates with camera-relative matrices and tiled batches.
 *
 * ## Creating a SceneModel
 *
 * ```ts
 * import { Scene } from "@xeokit/sdk/model/scene";
 * import { TrianglesPrimitive } from "@xeokit/sdk/base/constants";
 *
 * const scene = new Scene();
 *
 * const modelRes = scene.createModel({ id: "table" });
 * if (!modelRes.ok) throw new Error(modelRes.error);
 * const model = modelRes.value;
 *
 * model.createGeometry({
 *   id: "boxGeometry",
 *   primitive: TrianglesPrimitive,
 *   positions: [
 *     1, 1, 1, -1, 1, 1,
 *     -1, -1, 1, 1, -1, 1,
 *     1, 1, -1, -1, 1, -1,
 *     -1, -1, -1, 1, -1, -1,
 *   ],
 *   indices: [
 *     0, 1, 2, 0, 2, 3,
 *     4, 0, 3, 4, 3, 7,
 *     5, 4, 7, 5, 7, 6,
 *     1, 5, 6, 1, 6, 2,
 *     4, 5, 1, 4, 1, 0,
 *     3, 2, 6, 3, 6, 7,
 *   ],
 * });
 *
 * model.createMaterial({ id: "red", color: [1, 0, 0] });
 *
 * model.addMesh({
 *   id: "legMesh",
 *   geometryId: "boxGeometry",
 *   materialId: "red",
 *   position: [0, -3, 0],
 *   scale: [1, 3, 1],
 * });
 *
 * model.createObject({ id: "legObject", meshIds: ["legMesh"] });
 * ```
 *
 * Components are indexed by id:
 *
 * ```ts
 * const tableModel = scene.models["table"];
 * const mesh = tableModel.meshes["legMesh"];
 * const objectFromModel = tableModel.objects["legObject"];
 * const objectFromScene = scene.objects["legObject"];
 * ```
 *
 * ## Update Mode and Loading Mode
 *
 * Most SceneModels can use the defaults. When an application already knows more
 * about a model, it can describe that intent with `updateMode` and
 * `loadingMode`. Renderers can then choose storage and rendering policies that
 * fit the model, without adding renderer-specific settings to SceneModel.
 *
 * ```ts
 * const model = scene.createModel({
 *   id: "hospital",
 *   updateMode: "static",
 *   loadingMode: "streaming"
 * }).value;
 * ```
 *
 * {@link SceneModelParams.updateMode | updateMode} describes how stable the
 * model's renderer-facing values are expected to be:
 *
 * Renderer-facing values are the parts of the model that renderers cache,
 * upload or reorganize for drawing after the model has been created. Typical
 * examples are mesh transforms, object visibility and selection state, colors,
 * opacity, and other per-object or per-mesh values that can affect rendered
 * output without adding new geometry.
 *
 * - `"auto"` leaves the choice to the renderer.
 * - `"static"` is for models whose renderer-facing values are mostly stable
 *   after creation.
 * - `"dynamic"` is for models whose transforms, colors or object state change
 *   often after creation.
 *
 * {@link SceneModelParams.loadingMode | loadingMode} describes how the model is
 * populated:
 *
 * - `"open"` is the default for ordinary authoring. Components can be added as
 *   needed. `commitBatch()` works in this mode, but it is just a construction
 *   boundary.
 * - `"streaming"` is for models that arrive in repeated chunks or phases. Each
 *   `commitBatch()` publishes another unit, and
 *   renderers can keep stream-friendly storage available until the model is
 *   sealed.
 *
 * The separate {@link SceneModel.sealed | sealed} runtime state closes the model
 * to new topology. After `seal()`, `beginBatch()` and component creation calls
 * reject new content.
 *
 * Size and interactivity tuning remain renderer decisions. For example, WebGPU
 * can combine `updateMode`, `loadingMode`, renderer profiles and observed model
 * size to choose compact pages, stream-friendly pages, culling and batch sizes.
 *
 * Use {@link SceneModel.seal | seal} when a model is complete and should reject
 * further topology/resource growth:
 *
 * ```ts
 * model.createGeometry({ id: "g", primitive, positions, indices });
 * model.createMesh({ id: "m", geometryId: "g" });
 * model.createObject({ id: "o", meshIds: ["m"] });
 *
 * const sealRes = model.seal();
 * if (!sealRes.ok) throw new Error(sealRes.error);
 * ```
 *
 * For progressive construction of a single SceneModel, use batches when it is
 * useful to know which components were created during a named loading interval,
 * or when an importer needs to split loading into explicit phases. A batch can
 * stage a model file or file section and then publish it as a unit. Viewers and
 * renderers can defer partial batch content until `commitBatch()`.
 *
 * In `loadingMode: "streaming"` models, each commit means one more incremental
 * construction unit is ready while the model remains open for later units.
 * Batch IDs are SceneModel construction IDs; they do not define renderer draw
 * batches or external stream structure.
 *
 * ```ts
 * const batchRes = model.beginBatch({ id: "storey-02" });
 * if (!batchRes.ok) throw new Error(batchRes.error);
 *
 * model.createGeometry({ id: "storey-02:g", primitive, positions, indices });
 * model.createMesh({ id: "storey-02:m", geometryId: "storey-02:g" });
 * model.createObject({ id: "storey-02:o", meshIds: ["storey-02:m"] });
 *
 * const commitRes = model.commitBatch();
 * if (!commitRes.ok) throw new Error(commitRes.error);
 * ```
 *
 * ## Rendering
 *
 * Browser rendering is optional. A minimal setup uses a Scene, Viewer,
 * WebGLRenderer, View and ModelNavigationController:
 *
 * ```ts
 * import { Viewer } from "@xeokit/sdk/viewing/viewer";
 * import { WebGLRenderer } from "@xeokit/sdk/viewing/renderers/webGL";
 * import { ModelNavigationController } from "@xeokit/sdk/viewing/navigation/model";
 *
 * const viewer = new Viewer({ scene });
 * new WebGLRenderer({ viewer });
 *
 * const viewRes = viewer.createView({ id: "main", elementId: "canvas" });
 * if (!viewRes.ok) throw new Error(viewRes.error);
 *
 * const view = viewRes.value;
 * view.camera.eye = [0, 0, -100];
 * view.camera.look = [0, 0, 0];
 * view.camera.up = [0, 1, 0];
 *
 * new ModelNavigationController(view, {});
 * ```
 *
 * ## Compressed Geometry
 *
 * Use {@link compressGeometryParams} when geometry has already been prepared for
 * compact storage or faster SceneModel creation.
 *
 * ```ts
 * import { compressGeometryParams } from "@xeokit/sdk/model/scene";
 * import { TrianglesPrimitive } from "@xeokit/sdk/base/constants";
 *
 * const compressed = compressGeometryParams({
 *   id: "boxGeometry",
 *   primitive: TrianglesPrimitive,
 *   positions,
 *   indices,
 * });
 *
 * model.createGeometryCompressed(compressed);
 * ```
 *
 * ## Dynamic Transforms
 *
 * Meshes can reference {@link SceneTransform | SceneTransforms}. Transforms can
 * be nested and updated after creation.
 *
 * ```ts
 * model.createTransform({
 *   id: "moving",
 *   position: [100000000, 0, 0],
 *   rotation: [0, 0, 0],
 *   scale: [1, 1, 1],
 * });
 *
 * model.addMesh({
 *   id: "movingMesh",
 *   geometryId: "boxGeometry",
 *   parentTransformId: "moving",
 *   color: [1, 0, 0],
 * });
 *
 * model.transforms["moving"].rotation = [0, performance.now() / 40, 0];
 * ```
 *
 * ## Serialization
 *
 * ```ts
 * const paramsRes = model.toParams();
 * if (!paramsRes.ok) throw new Error(paramsRes.error);
 *
 * const restoredRes = scene.createModel({ id: "restored" });
 * if (!restoredRes.ok) throw new Error(restoredRes.error);
 *
 * restoredRes.value.fromParams(paramsRes.value);
 * ```
 *
 * ## Import and Export
 *
 * Format modules can map external data into a SceneModel, or write a
 * SceneModel back out to an external representation. Those mappings belong at
 * the format boundary; the scene module owns the format-independent runtime
 * model.
 *
 * ## Events and Lifecycle
 *
 * ```ts
 * scene.events.onSceneModelCreated.subscribe((scene, sceneModel) => {
 *   console.log("SceneModel created: " + sceneModel.id);
 * });
 *
 * scene.events.onError.subscribe((scene, error) => {
 *   console.error(error.error);
 * });
 *
 * model.destroy();
 * scene.destroy();
 * ```
 *
 * @module scene
 */
export * from "./SceneParams";
export * from "./Scene";
export * from "./SceneEvents";
export * from "./SceneModel";
export * from "./SceneModelBatch";
export * from "./SceneModelParams";
export * from "./isDefaultLayer";
export * from "./SceneModelStats";
export * from "./SceneObject";
export * from "./animation";
export * from "./SceneTexture";
export * from "./SceneMaterial";
export * from "./SceneGeometry";
export * from "./evaluateMorphTargets";
export * from "./SceneMesh";

export * from "./CoordinateSystem";
export * from "./CoordinateSystemParams";
export * from "./createCoordinateSystemTransform";
export * from "./getMeshWorldMatrix";

export * from "./SceneMeshParams";
export * from "./SceneObjectParams";
export * from "./SceneTextureParams";
export * from "./SceneMaterialParams";
export * from "./SceneTransform";
export * from "./SceneTransformParams";
export * from "./SceneGeometryCompressedParams";
export * from "./SceneGeometryParams";
export * from "./SceneModelParams";
export * from "./compressGeometryParams";


export * from "./buildMat4"

export * from "./linePattern";

export * from "./hatchPattern";

import type {Viewer} from "../../viewing/viewer";

export * from "./representation";

export * from "./variant";
