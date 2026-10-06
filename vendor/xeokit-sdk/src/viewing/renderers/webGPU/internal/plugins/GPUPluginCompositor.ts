import type {
  WebGPUDeviceLike,
  WebGPUCommandEncoderLike,
  WebGPUTextureLike,
  WebGPURenderPipelineLike,
  WebGPUBindGroupLayoutLike,
} from "../../core/types";
import type {
  WebGPUPluginFrame,
  WebGPUPluginTarget,
  WebGPUPluginTexture,
  WebGPUPluginDepth,
} from "../../plugins";
import type {GPUPluginResources} from "./GPUPluginResources";

const fullscreen = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Renderer-owned colour/depth transaction targets; allocated only for Views with plugin work. */
export class GPUPluginCompositor {
  private readonly views = new Map<
    string,
    {
      width: number;
      height: number;
      color: WebGPUTextureLike;
      depth: WebGPUTextureLike;
      colorView: unknown;
      depthView: unknown;
      sampledDepth: unknown;
    }
  >();

  private readonly copyLayout: WebGPUBindGroupLayoutLike;

  private readonly copyPipeline: WebGPURenderPipelineLike;

  private readonly mipLayout: WebGPUBindGroupLayoutLike;

  private readonly mipPipeline: WebGPURenderPipelineLike;

  private readonly sampler: object;

  constructor(private readonly device: WebGPUDeviceLike) {
    this.copyLayout = device.createBindGroupLayout({
      entries: [
        {binding: 0, visibility: 2, texture: {sampleType: "float"}},
        {binding: 1, visibility: 2, texture: {sampleType: "depth"}},
      ],
    });
    const copyModule = device.createShaderModule({
      label: "Plugin colour/depth preservation",
      code:
        fullscreen +
        `
@group(0) @binding(0) var color: texture_2d<f32>;
@group(0) @binding(1) var depth: texture_depth_2d;
struct Output { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fs(@builtin(position) p: vec4f) -> Output {
  return Output(textureLoad(color, vec2i(p.xy), 0), textureLoad(depth, vec2i(p.xy), 0));
}`,
    });
    this.copyPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({bindGroupLayouts: [this.copyLayout]}),
      vertex: {module: copyModule, entryPoint: "vs"},
      fragment: {module: copyModule, entryPoint: "fs", targets: [{format: "rgba16float"}]},
      primitive: {topology: "triangle-list"},
      depthStencil: {format: "depth24plus-stencil8", depthCompare: "always", depthWriteEnabled: true},
    });
    this.mipLayout = device.createBindGroupLayout({
      entries: [
        {binding: 0, visibility: 2, texture: {sampleType: "float"}},
        {binding: 1, visibility: 2, sampler: {type: "filtering"}},
      ],
    });
    const mipModule = device.createShaderModule({
      label: "Plugin intermediate mipmaps",
      code:
        fullscreen +
        `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var filtering: sampler;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let size = max(vec2u(1), textureDimensions(source) / 2u);
  return textureSampleLevel(source, filtering, p.xy / vec2f(size), 0.0);
}`,
    });
    this.mipPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({bindGroupLayouts: [this.mipLayout]}),
      vertex: {module: mipModule, entryPoint: "vs"},
      fragment: {module: mipModule, entryPoint: "fs", targets: [{format: "rgba16float"}]},
      primitive: {topology: "triangle-list"},
    });
    this.sampler = device.createSampler!({minFilter: "linear", magFilter: "linear"});
  }

  private target(viewId: string, width: number, height: number) {
    let target = this.views.get(viewId);
    if (target?.width === width && target.height === height) return target;
    this.releaseView(viewId);
    const color = this.device.createTexture({size: [width, height], format: "rgba16float", usage: 4 | 16});
    const depth = this.device.createTexture({
      size: [width, height],
      format: "depth24plus-stencil8",
      usage: 4 | 16,
    });
    target = {
      width,
      height,
      color,
      depth,
      colorView: color.createView(),
      depthView: depth.createView(),
      sampledDepth: depth.createView({aspect: "depth-only"}),
    };
    this.views.set(viewId, target);
    return target;
  }

  private descriptor(color: unknown, depth?: unknown, clear = false) {
    return {
      colorAttachments: [
        {view: color, loadOp: clear ? "clear" : "load", storeOp: "store", clearValue: [0, 0, 0, 0]},
      ],
      ...(depth
        ? {
            depthStencilAttachment: {
              view: depth,
              depthLoadOp: clear ? "clear" : "load",
              depthStoreOp: "store",
              depthClearValue: 1,
              stencilLoadOp: clear ? "clear" : "load",
              stencilStoreOp: "store",
              stencilClearValue: 0,
            },
          }
        : {}),
    };
  }

  private copy(
    encoder: WebGPUCommandEncoderLike,
    sourceColor: unknown,
    sourceDepth: unknown,
    color: unknown,
    depth: unknown,
    clear: boolean
  ) {
    const group = this.device.createBindGroup({
      layout: this.copyLayout,
      entries: [
        {binding: 0, resource: sourceColor},
        {binding: 1, resource: sourceDepth},
      ],
    });
    const pass = encoder.beginRenderPass(this.descriptor(color, depth, clear));
    pass.setPipeline!(this.copyPipeline);
    pass.setBindGroup!(0, group);
    pass.draw!(3);
    pass.end!();
  }

  /** Execute only after all plugin callbacks have returned successfully. */
  render(
    host: GPUPluginResources,
    encoder: WebGPUCommandEncoderLike,
    viewId: string,
    width: number,
    height: number,
    color: unknown,
    depth: unknown,
    sampledDepth: unknown,
    claim: WebGPUPluginDepth,
    work: (frame: WebGPUPluginFrame) => void,
    stage: import("../../../../rendering/plugins/RendererPluginStage").RendererPluginStage = "compose-opaque"
  ): void {
    const target = this.target(viewId, width, height);
    const sceneColor = Object.freeze({width, height, format: "rgba16float"});
    const sceneDepth = Object.freeze({width, height, format: "depth24plus-stencil8"});
    const borrowed = new Map<WebGPUPluginTexture, unknown>([
      [sceneColor, color],
      [sceneDepth, sampledDepth],
    ]);
    const operations: (() => void)[] = [];
    let open = true;
    const check = () => {
      if (!open) throw new Error("Plugin frame has expired");
    };
    const frame: WebGPUPluginFrame = {
      stage,
      depthEncoding: {kind: "projective", clipRange: "zero-to-one"},
      width,
      height,
      sceneColor: stage === "compose-opaque" ? sceneColor : undefined,
      sceneDepth,
      prepare: (handle, draw, clear = true) => {
        check();
        const intermediate = host.targets.get(handle);
        if (!intermediate) throw new Error("Intermediate is not owned by this runtime");
        host.retainForTransaction(handle);
        const record = host.record(draw, handle, "none", borrowed);
        operations.push(() => {
          const pass = encoder.beginRenderPass(
            this.descriptor(
              intermediate.texture.createView({baseMipLevel: 0, mipLevelCount: 1}),
              undefined,
              clear
            )
          );
          record(pass);
          pass.end!();
        });
      },
      generateMipmaps: (handle: WebGPUPluginTarget) => {
        check();
        const intermediate = host.targets.get(handle);
        if (!intermediate) throw new Error("Intermediate is not owned by this runtime");
        host.retainForTransaction(handle);
        operations.push(() => {
          for (let level = 1; level < handle.mipLevelCount; level++) {
            const source = intermediate.texture.createView({baseMipLevel: level - 1, mipLevelCount: 1});
            const destination = intermediate.texture.createView({baseMipLevel: level, mipLevelCount: 1});
            const group = this.device.createBindGroup({
              layout: this.mipLayout,
              entries: [
                {binding: 0, resource: source},
                {binding: 1, resource: this.sampler},
              ],
            });
            const pass = encoder.beginRenderPass(this.descriptor(destination, undefined, true));
            pass.setPipeline!(this.mipPipeline);
            pass.setBindGroup!(0, group);
            pass.draw!(3);
            pass.end!();
          }
        });
      },
      draw: (draw) => {
        check();
        const record = host.record(draw, "scene", claim, borrowed, stage === "transparent");
        operations.push(() => {
          const pass = encoder.beginRenderPass(this.descriptor(target.colorView, target.depthView));
          record(pass);
          pass.end!();
        });
      },
    };
    host.beginTransaction();
    try {
      work(frame);
      open = false;
      // No command touches host attachments until recording/validation has succeeded.
      this.copy(encoder, color, sampledDepth, target.colorView, target.depthView, true);
      for (const operation of operations) operation();
      this.copy(encoder, target.colorView, target.sampledDepth, color, depth, false);
    } finally {
      open = false;
      host.endTransaction();
    }
  }

  releaseView(id: string): void {
    const target = this.views.get(id);
    target?.color.destroy?.();
    target?.depth.destroy?.();
    this.views.delete(id);
  }

  destroy(): void {
    for (const id of this.views.keys()) this.releaseView(id);
  }
}
