import type {SDKResult} from "@xeokit/sdk/base/core";
import type {Renderer} from "@xeokit/sdk/viewing/rendering/core";
import {WebGLRenderer} from "@xeokit/sdk/viewing/renderers/webGL";
import {WebGPURenderer} from "@xeokit/sdk/viewing/renderers/webGPU";
import {createStudioPerformanceWebGPUSettings} from "./studioPerformanceSettings";
import type {View, Viewer} from "@xeokit/sdk/viewing/viewer";

export type RendererMode = "webgl" | "webgpu";

export interface RendererServiceParams {
  viewer: Viewer;
  view: View;
  canvasHost: HTMLElement;
  initialMode: RendererMode;
}

export interface RendererSwitchResult {
  renderer: Renderer;
  mode: RendererMode;
  label: string;
}

export class RendererService {
  private readonly _viewer: Viewer;
  private readonly _view: View;
  private readonly _canvasHost: HTMLElement;
  private _renderer: Renderer | null = null;
  private _mode: RendererMode;

  constructor(params: RendererServiceParams) {
    this._viewer = params.viewer;
    this._view = params.view;
    this._canvasHost = params.canvasHost;
    this._mode = params.initialMode;
  }

  get renderer(): Renderer | null {
    return this._renderer;
  }

  get mode(): RendererMode {
    return this._mode;
  }

  get label(): string {
    return rendererLabel(this._mode);
  }

  async initialize(): Promise<RendererSwitchResult> {
    return this.switchTo(this._mode);
  }

  async switchTo(mode: RendererMode, beforeReplace?: () => void): Promise<RendererSwitchResult> {
    if (this._renderer && mode === this._mode) {
      return {renderer: this._renderer, mode: this._mode, label: this.label};
    }

    const nextRenderer = await createDetachedRenderer(mode);
    const previousRenderer = this._renderer;
    this._renderer = null;
    beforeReplace?.();
    previousRenderer?.destroy();
    this._replaceViewCanvas();

    const attachResult = nextRenderer.attachViewer(this._viewer);
    if (attachResult.ok === false) {
      nextRenderer.destroy();
      throw new Error(attachResult.error);
    }
    const renderer = nextRenderer;
    const gridResult = maybeSetInfiniteGrid(renderer, false);
    if (gridResult && gridResult.ok === false) {
      renderer.destroy();
      throw new Error(gridResult.error);
    }

    this._renderer = renderer;
    this._mode = mode;
    window.dispatchEvent(new Event("resize"));
    this._view.needsRender();
    return {renderer, mode, label: this.label};
  }

  destroy(): void {
    this._renderer?.destroy();
    this._renderer = null;
  }

  private _replaceViewCanvas(): void {
    const oldCanvas = this._view.htmlElement;
    const nextCanvas = document.createElement("canvas");
    nextCanvas.id = "demoCanvas";
    nextCanvas.style.position = "absolute";
    nextCanvas.style.inset = "0";
    nextCanvas.style.width = "100%";
    nextCanvas.style.height = "100%";
    nextCanvas.style.display = "block";
    nextCanvas.style.zIndex = "0";
    if (oldCanvas.parentElement) {
      oldCanvas.replaceWith(nextCanvas);
    } else {
      this._canvasHost.appendChild(nextCanvas);
    }
    if (nextCanvas.parentElement !== this._canvasHost) {
      this._canvasHost.appendChild(nextCanvas);
    }
    this._view.htmlElement = nextCanvas;
  }
}

async function createDetachedRenderer(mode: RendererMode): Promise<Renderer> {
  if (mode === "webgl") {
    return new WebGLRenderer({memoryConfigs: {maxViews: 2}});
  }
  const result = await WebGPURenderer.create(createStudioPerformanceWebGPUSettings());
  if (result.ok === false) {
    throw new Error(result.error);
  }
  return result.value;
}

function rendererLabel(mode: RendererMode): string {
  return mode === "webgl" ? "WebGLRenderer" : "WebGPURenderer";
}

function maybeSetInfiniteGrid(renderer: Renderer, enabled: boolean): SDKResult<void> | null {
  const candidate = renderer as Renderer & {
    setInfiniteGridEnabled?: (enabled: boolean) => SDKResult<void>;
  };
  return candidate.setInfiniteGridEnabled ? candidate.setInfiniteGridEnabled(enabled) : null;
}
