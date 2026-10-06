/**
 * CPU timing summary for WebGPU renderer startup.
 */
export interface WebGPUInitializationStats {
  /**
   * Time spent inside `navigator.gpu.requestAdapter()`, in milliseconds.
   *
   * Zero when an adapter or device was injected.
   */
  requestAdapterMs: number;

  /**
   * Time spent inside `GPUAdapter.requestDevice()`, in milliseconds.
   *
   * Zero when a device was injected.
   */
  requestDeviceMs: number;

  /**
   * Time spent constructing the WebGPURenderer facade, in milliseconds.
   */
  constructorMs: number;

  /**
   * Time spent in the most recent `attachViewer()` call, in milliseconds.
   */
  attachViewerMs: number;

  /**
   * Time spent creating and initializing the internal ViewManager, in milliseconds.
   */
  createViewManagerMs: number;

  /**
   * Time spent in `ViewManager.init()`, in milliseconds.
   */
  viewManagerInitMs: number;

  /**
   * Time spent in `RenderManager.init()`, in milliseconds.
   */
  renderManagerInitMs: number;

  /**
   * Time spent creating per-View WebGPU render state during ViewManager init, in milliseconds.
   */
  viewCreationMs: number;

  /**
   * Time spent registering scene meshes already present when the renderer attached, in milliseconds.
   */
  sceneRegistrationMs: number;

  /**
   * Time spent marking initial Views dirty after ViewManager init, in milliseconds.
   */
  requestInitialRenderMs: number;

  /**
   * Time spent in the first `RenderManager.renderView()` call observed by this renderer, in milliseconds.
   *
   * Null until the first View renders.
   */
  firstRenderViewMs: number | null;

  /**
   * Total wall-clock time spent by `WebGPURenderer.create()`, in milliseconds.
   *
   * Zero when the synchronous constructor was used directly.
   */
  totalCreateMs: number;
}

export function createWebGPUInitializationStats(): WebGPUInitializationStats {
  return {
    requestAdapterMs: 0,
    requestDeviceMs: 0,
    constructorMs: 0,
    attachViewerMs: 0,
    createViewManagerMs: 0,
    viewManagerInitMs: 0,
    renderManagerInitMs: 0,
    viewCreationMs: 0,
    sceneRegistrationMs: 0,
    requestInitialRenderMs: 0,
    firstRenderViewMs: null,
    totalCreateMs: 0
  };
}
