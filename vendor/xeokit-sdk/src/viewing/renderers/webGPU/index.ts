/**
 * # xeokit WebGPU Renderer
 *
 * WebGPURenderer is xeokit's WebGPU backend for
 * {@link viewing!viewer.Viewer | Viewer}. It owns the WebGPU device, attaches to
 * one or more viewer canvases, renders scene geometry, and provides picking,
 * snapping, memory diagnostics, and per-view render statistics.
 *
 * In most applications, create it with {@link WebGPURenderer.create}. That
 * helper checks browser support, requests the adapter and device, attaches the
 * renderer to the viewer, and returns an SDKResult instead of throwing for
 * normal capability failures.
 *
 * ## Basic Usage
 *
 * ```ts
 * import {Scene} from "@xeokit/sdk/model/scene";
 * import {Viewer} from "@xeokit/sdk/viewing/viewer";
 * import {WebGPURenderer} from "@xeokit/sdk/viewing/renderers/webGPU";
 *
 * const scene = new Scene();
 * const viewer = new Viewer({scene});
 *
 * const result = await WebGPURenderer.create({viewer});
 *
 * if (result.ok) {
 *   const renderer = result.value;
 *
 *   renderer.events.onError.subscribe((_renderer, error) => {
 *     console.error(error.error);
 *   });
 * } else {
 *   console.error(result.error);
 * }
 * ```
 *
 * ## Injecting A Device
 *
 * Applications that already own a WebGPU device can pass it directly. In that
 * case, construct the renderer synchronously and attach it to the viewer
 * yourself. Set `destroyDeviceOnDestroy: false` when the device is shared with
 * code outside xeokit.
 *
 * ```ts
 * import {WebGPURenderer} from "@xeokit/sdk/viewing/renderers/webGPU";
 *
 * const adapter = await navigator.gpu?.requestAdapter();
 * const device = await adapter?.requestDevice();
 *
 * if (device) {
 *   const renderer = new WebGPURenderer({
 *     device,
 *     destroyDeviceOnDestroy: false
 *   });
 *
 *   renderer.attachViewer(viewer);
 * }
 * ```
 *
 * ## Render And Memory Configuration
 *
 * Most applications do not need to set renderer configuration at all. The
 * defaults are intended to be a reasonable starting point for ordinary model
 * viewing, including streamed models.
 *
 * The configuration hooks are there for applications with clearer performance
 * goals: very large static models, streams that need faster first visibility,
 * memory-constrained devices, or interactive tools that update many objects
 * while the user is working.
 *
 * ```ts
 * import {WebGPURenderer, WEBGPU_RENDER_CONFIG_PROFILES} from "@xeokit/sdk/viewing/renderers/webGPU";
 *
 * const result = await WebGPURenderer.create({
 *   viewer,
 *   memoryConfigs: {
 *     maxBatchVertices: 200000,
 *     maxBatchIndices: 600000,
 *     compactSealedStreamPages: true
 *   },
 *   renderConfigs: {
 *     ...WEBGPU_RENDER_CONFIG_PROFILES.largeModel,
 *   }
 * });
 * ```
 *
 * Think of `memoryConfigs` as storage tuning. It affects how the renderer sizes
 * and reuses GPU buffers: packed geometry page sizes, stream compaction, RTC
 * tile capacity, culling thresholds, and related allocation limits.
 *
 * Think of `renderConfigs` as frame tuning. It affects how each frame is drawn:
 * render-bundle caching, color path selection, edges, depth prepasses,
 * transparent sorting, and similar render-pass choices.
 *
 * `WEBGPU_RENDER_CONFIG_PROFILES.largeModel` is a renderer preset for large
 * scenes. It is optional; use it when you know the page is mainly about large,
 * many-object models. Pair it with `DEFAULT_VIEW_PROFILES.fast` when Views
 * should also use low-cost effects during navigation.
 *
 * ## Per-Model Update-Mode Policies
 *
 * You can usually just use `SceneModel.updateMode` and
 * `SceneModel.loadingMode`.
 * The renderer has built-in policies for those model intents.
 *
 * `SceneModel` does not expose WebGPU storage configurations. It only describes
 * the model: `updateMode` says whether renderer-facing values are expected to be
 * stable or frequently updated, `loadingMode` says whether topology is arriving
 * as ordinary ad-hoc additions or as a stream, and `sealed` says that no more
 * topology can be added.
 *
 * WebGPURenderer reads that model intent and chooses WebGPU-specific storage
 * through renderer-owned update-mode policies.
 *
 * Built-in policy selection is keyed by `SceneModel.updateMode`:
 *
 * | SceneModel updateMode | Built-in WebGPU policy |
 * |---|---|
 * | `"auto"` or unset | Use the renderer default stream policy. |
 * | `"static"` while not sealed | Use append-friendly stream storage so more topology can arrive. |
 * | `"static"` after `sceneModel.seal()` | Use compact storage where configured. |
 * | `"dynamic"` | Use stream storage for frequently updated renderer-facing values. |
 *
 * On the SceneModel side, the application describes the loading pattern without
 * choosing WebGPU buffers or page sizes:
 *
 * ```ts
 * const sceneModel = scene.createModel({
 *   id: "campus-stream",
 *   updateMode: "static",
 *   loadingMode: "streaming"
 * }).value;
 *
 * for (const chunk of chunks) {
 *   const batch = sceneModel.beginBatch({id: chunk.id});
 *   if (!batch.ok) throw new Error(batch.error);
 *
 *   // Create this chunk's geometries, meshes and objects.
 *
 *   const commit = sceneModel.commitBatch();
 *   if (!commit.ok) throw new Error(commit.error);
 * }
 *
 * const sealed = sceneModel.seal();
 * if (!sealed.ok) throw new Error(sealed.error);
 * ```
 *
 * From those fields, WebGPURenderer resolves storage per model:
 *
 * - `updateMode: "static"` says completed renderer-facing values are stable.
 * - `loadingMode: "streaming"` says more committed batches may arrive, so the
 *   renderer keeps append-friendly storage while `sceneModel.sealed` is `false`.
 * - `commitBatch()` publishes the next construction unit for renderer
 *   registration.
 * - `seal()` sets `sceneModel.sealed` to `true`; the renderer can then compact
 *   or finalize packed pages where the active memory policy allows it.
 *
 * For ad-hoc application geometry such as UI overlays, measurements, or edit
 * previews, use an open dynamic model:
 *
 * ```ts
 * const overlays = scene.createModel({
 *   id: "overlays",
 *   updateMode: "dynamic",
 *   loadingMode: "open"
 * }).value;
 * ```
 *
 * Here WebGPURenderer still applies the `dynamic` model policy, but occasional
 * commits are just construction boundaries. They are not treated as stream
 * payload boundaries.
 *
 * `updateModePolicies` is the advanced form of the same idea. Override it only
 * when the built-in mapping is not a good fit for your models or target
 * hardware. For example, a product viewer might keep static models compact,
 * while an operations dashboard might leave more stream headroom for models that
 * are updated continuously.
 *
 * Policies apply to all models with the matching `updateMode`:
 *
 * ```ts
 * const result = await WebGPURenderer.create({
 *   viewer,
 *   updateModePolicies: {
 *     static: {
 *       memoryPolicy: "compact",
 *       memoryConfigs: {
 *         compactSealedStreamPages: true
 *       }
 *     },
 *     dynamic: {
 *       memoryPolicy: "stream",
 *       memoryConfigs: {
 *         maxBatchMeshes: 2048,
 *         maxBatchGeometries: 2048,
 *         frustumCulling: true,
 *         minProjectedCanvasSize: 5
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * Update-mode policies can override `MemoryConfigs`, including packed segment
 * limits, culling thresholds, pending segment-build work, and stream-page
 * compaction. They do not replace `renderConfigs`: render-pass choices such as
 * `triangleColorMode`, `edges`, `depthPrepass`, `renderBundleCaching`, and
 * transparent sorting remain renderer-level settings.
 *
 * ## Diagnostics
 *
 * ```ts
 * const memory = renderer.getMemoryStats();
 *
 * if (memory) {
 *   console.log(memory.totalBytes);
 *   console.log(memory.packedTrianglePages);
 * }
 *
 * const viewStats = renderer.getViewRenderStats(0);
 *
 * if (viewStats) {
 *   console.log(viewStats.numDrawCalls);
 *   console.log(viewStats.cpuTime.commandEncodingMs);
 * }
 * ```
 *
 * @module webGPU
 */
export * from "./WebGPURenderer";
export * from "./WebGPURendererEvents";
export * from "./WebGPURendererParams";
export * from "./WebGPUViewRenderStats";
export * from "./MemoryConfigs";
export * from "./WebGPUUpdateModePolicies";
export * from "./WebGPURenderConfigs";
export * from "./WebGPUMemoryStats";

export * from "./plugins";
