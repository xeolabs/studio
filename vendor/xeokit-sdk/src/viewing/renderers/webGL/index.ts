/**
 * <img
 *   style="padding-top:20px; padding-bottom:30px; height:100px;"
 *   src="https://xeokit.github.io/sdk/docs/assets/xeokit_webgl_logo.svg"
 * />
 *
 * # xeokit WebGL Renderer
 *
 * WebGLRenderer is xeokit's WebGL2 backend for
 * {@link viewing!viewer.Viewer | Viewer}. It attaches to a Viewer, renders one
 * or more View canvases, keeps GPU state synchronized with Scene and View
 * changes, and provides picking, snapping, context restoration, memory
 * diagnostics, and shader diagnostics.
 *
 * WebGL is the broadly available renderer backend. In most applications, create
 * a Scene, create a Viewer for that Scene, then create a WebGLRenderer with the
 * Viewer. The renderer starts observing Scene and View changes as soon as it is
 * attached.
 *
 * ## Basic Usage
 *
 * ```ts
 * import {SDKErrorType} from "@xeokit/sdk/base/core";
 * import {Scene} from "@xeokit/sdk/model/scene";
 * import {Viewer} from "@xeokit/sdk/viewing/viewer";
 * import {WebGLRenderer} from "@xeokit/sdk/viewing/renderers/webGL";
 *
 * const scene = new Scene();
 * const viewer = new Viewer({scene});
 * const renderer = new WebGLRenderer({viewer});
 *
 * renderer.events.onError.subscribe((_renderer, err) => {
 *   switch (err.type) {
 *     case SDKErrorType.NotSupported:
 *       console.error("WebGL2 not supported:", err.error);
 *       break;
 *     case SDKErrorType.OutOfMemory:
 *       console.error("GPU memory exhausted:", err.error);
 *       break;
 *     default:
 *       console.error("WebGLRenderer error:", err.error);
 *   }
 * });
 * ```
 *
 * If you prefer to attach later, construct the renderer without a Viewer and
 * call {@link WebGLRenderer.attachViewer} when the Viewer is ready.
 *
 * ## Render And Memory Configuration
 *
 * Most applications do not need to set WebGL memory configuration. The defaults
 * are intended to be a reasonable starting point for ordinary model viewing.
 *
 * The configuration hooks are there for applications with clearer constraints:
 * very large models, limited GPU memory, unusually many Views, or models whose
 * geometry needs to be packed into larger or smaller batches.
 *
 * ```ts
 * import {createMemoryConfigs, WebGLRenderer} from "@xeokit/sdk/viewing/renderers/webGL";
 *
 * const memoryConfigs = createMemoryConfigs({
 *   grossMemoryMB: 500,
 *   device: "high",
 *   utilization: 0.8,
 *   user: {
 *     maxViews: 1
 *   }
 * });
 *
 * const renderer = new WebGLRenderer({viewer, memoryConfigs});
 * ```
 *
 * Think of `memoryConfigs` as storage tuning. It affects how the renderer sizes
 * GPU data textures, VBO batches, RTC tiles, and the per-batch limits for
 * vertices, indices, geometries, meshes, and primitives.
 *
 * `createMemoryConfigs` is the usual way to make a complete configuration from
 * a coarse device class and memory budget. You can also pass direct overrides
 * when you already know the limits you want:
 *
 * ```ts
 * import {WebGLRenderer} from "@xeokit/sdk/viewing/renderers/webGL";
 *
 * const renderer = new WebGLRenderer({
 *   viewer,
 *   memoryConfigs: {
 *     maxViews: 1,
 *     maxTiles: 4096,
 *     maxBatchVertices: 500000,
 *     maxBatchIndices: 800000,
 *     maxBatchPrims: 400000,
 *     vboGeometry: {
 *       maxBatchPrims: 200000
 *     }
 *   }
 * });
 * ```
 *
 * ## Per-Model Update-Mode Policies
 *
 * You can usually just use `SceneModel.updateMode` and
 * `SceneModel.loadingMode`. The renderer has built-in policies for those model
 * intents.
 *
 * {@link model!scene.SceneModel.updateMode | SceneModel.updateMode} describes
 * whether a model's renderer-facing values are stable (`"static"`), frequently
 * changing (`"dynamic"`) or left to the renderer (`"auto"`). The WebGL renderer
 * maps that neutral model intent to WebGL-specific storage through
 * renderer-owned update-mode policies.
 *
 * Built-in policy selection is keyed by `SceneModel.updateMode`:
 *
 * | SceneModel updateMode | Built-in WebGL policy |
 * |---|---|
 * | `"auto"` or unset | Use data-texture triangle storage and stream memory policy. |
 * | `"static"` | Use VBO triangle storage and compact memory policy. |
 * | `"dynamic"` | Use data-texture triangle storage and stream memory policy. |
 *
 * Point meshes use VBO geometry by default. Authored line meshes use
 * data-texture geometry. Triangle-derived edges, pick and snap passes follow the
 * triangle policy because they render from the same triangle batch.
 *
 * On the SceneModel side, the application describes the model without choosing
 * WebGL storage directly:
 *
 * ```ts
 * const sceneModel = scene.createModel({
 *   id: "campus",
 *   updateMode: "static",
 *   loadingMode: "streaming"
 * }).value;
 *
 * // Load or create geometry, meshes and objects.
 *
 * const sealed = sceneModel.seal();
 * if (!sealed.ok) throw new Error(sealed.error);
 * ```
 *
 * `updateModePolicies` is the advanced form of the same idea. Override it only
 * when the built-in mapping is not a good fit for your models or target
 * hardware. Policies apply to all models with the matching `updateMode`, and can
 * be refined per primitive family:
 *
 * ```ts
 * import {WebGLRenderer} from "@xeokit/sdk/viewing/renderers/webGL";
 *
 * const renderer = new WebGLRenderer({
 *   viewer,
 *   updateModePolicies: {
 *     static: {
 *       triangles: { geometryStorage: "vbo", memoryPolicy: "compact" },
 *       points: { geometryStorage: "vbo", memoryPolicy: "compact" }
 *     },
 *     dynamic: {
 *       triangles: { geometryStorage: "dtx", memoryPolicy: "stream" },
 *       points: { geometryStorage: "vbo", memoryPolicy: "stream" },
 *       lines: { geometryStorage: "dtx", memoryPolicy: "stream" }
 *     }
 *   }
 * });
 * ```
 *
 * Update-mode policies can choose between VBO and data-texture geometry storage
 * where WebGL supports both, and can select compact or stream memory policy for
 * matching models. They do not replace `memoryConfigs`: capacity limits such as
 * `maxBatchVertices`, `maxBatchMeshes`, `maxViews`, and `maxTiles` remain
 * renderer-level storage settings.
 *
 * ## Diagnostics
 *
 * ```ts
 * const memory = renderer.getMemoryUsage();
 *
 * console.log(memory.allocatedMB);
 * console.log(memory.usedMB);
 *
 * const capabilities = renderer.getCapabilities();
 * console.log(capabilities);
 * ```
 *
 * ## Internal Diagnostics API
 *
 * The {@link internal} namespace exposes internal diagnostics and debugging facilities
 * used by the WebGLRenderer implementation itself. These APIs provide deep visibility
 * into GPU-resident resources, shader programs, command submission, and internal
 * rendering state while the renderer is running.
 *
 * This namespace is **not part of the public API** and is intended solely for
 * xeokit SDK development and debugging. It is not supported for application use
 * and may change or be removed without notice.
 *
 * @module webGL
 */
export * from "./WebGLRenderer";
export * from "./WebGLRendererEvents";
export * from "./Capabilities";
export * from "./MemoryConfigs";
export * from "./createMemoryConfigs";
export * from "./MemoryUsage";
export * from "./MarkerOcclusionTester";
export * from "./MarkerOcclusionTesterParams";
export * from "./MarkerOcclusionResult";
export * from "./WebGLUpdateModePolicies";

export * as internal from "./internal";

export * from "./plugins";
