import type {SceneDataResource} from "../../../../../model/scene/representation/SceneDataResource";
import type {
  WebGPUDeviceLike,
  WebGPUBufferLike,
  WebGPURenderPipelineLike,
  WebGPUBindGroupLayoutLike,
  WebGPUTextureLike,
  WebGPURenderPassEncoderLike,
} from "../../core/types";
import type {
  WebGPUPluginHost,
  WebGPUPluginPipeline,
  WebGPUPluginPipelineDescriptor,
  WebGPUPluginBuffer,
  WebGPUPluginTexture,
  WebGPUPluginTarget,
  WebGPUPluginBinding,
  WebGPUPluginDrawEncoder,
  WebGPUPluginDepth,
} from "../../plugins";
import type {GPUSceneResourceCache} from "./GPUSceneResourceCache";

type Pipeline = {
  native: WebGPURenderPipelineLike;
  layout: WebGPUBindGroupLayoutLike;
  descriptor: WebGPUPluginPipelineDescriptor;
};
type Buffer = {native: WebGPUBufferLike; usage: string};
type Target = {texture: WebGPUTextureLike; view: unknown};

/** Tracked resources and validated CPU command recording for one plugin runtime. */
export class GPUPluginResources implements WebGPUPluginHost {
  readonly buffers = new Map<WebGPUPluginBuffer, Buffer>();

  readonly targets = new Map<WebGPUPluginTarget, Target>();

  readonly pipelines = new Map<WebGPUPluginPipeline, Pipeline>();

  private readonly samplers = new Map<string, object>();

  private readonly resourceIds = new WeakMap<object, number>();

  private readonly bindGroups = new Map<string, object>();

  private nextResourceId = 0;

  private alive = true;

  private transactionUses?: Set<object>;

  constructor(
    readonly device: WebGPUDeviceLike,
    readonly cache: GPUSceneResourceCache,
    readonly requestRedraw: () => void
  ) {}

  async createPipeline(descriptor: WebGPUPluginPipelineDescriptor): Promise<WebGPUPluginPipeline> {
    this.assertAlive();
    descriptor = {
      ...descriptor,
      bindings: [...descriptor.bindings],
      vertexBuffers: descriptor.vertexBuffers?.map((layout) => ({
        ...layout,
        attributes: layout.attributes.map((attribute) => ({...attribute})),
      })),
    };
    // Explicit layouts permit unfilterable R32F/RG32F numerical tables, without
    // requesting optional float32-filterable hardware support.
    const layout = this.device.createBindGroupLayout({
      entries: descriptor.bindings.map((kind, binding) => ({
        binding,
        visibility: 3,
        ...(kind === "uniform" || kind === "read-only-storage"
          ? {buffer: {type: kind}}
          : kind.startsWith("sampler-")
          ? {sampler: {type: kind === "sampler-linear" ? "filtering" : "non-filtering"}}
          : {texture: {sampleType: kind.slice(8), viewDimension: "2d", multisampled: false}}),
      })),
    });
    const module = this.device.createShaderModule({label: descriptor.label, code: descriptor.code});
    const blend =
      descriptor.blend === "add"
        ? {color: {srcFactor: "one", dstFactor: "one"}, alpha: {srcFactor: "one", dstFactor: "one"}}
        : descriptor.blend === "over"
        ? {
            color: {srcFactor: "one", dstFactor: "one-minus-src-alpha"},
            alpha: {srcFactor: "one", dstFactor: "one-minus-src-alpha"},
          }
        : undefined;
    const depth = descriptor.depth ?? "none";
    if (descriptor.target === "intermediate" && depth !== "none")
      throw new Error("Intermediate targets have no depth");
    const desc = {
      label: descriptor.label,
      layout: this.device.createPipelineLayout({bindGroupLayouts: [layout]}),
      vertex: {module, entryPoint: descriptor.vertexEntry ?? "vs", buffers: descriptor.vertexBuffers ?? []},
      fragment: {
        module,
        entryPoint: descriptor.fragmentEntry ?? "fs",
        targets: [{format: "rgba16float", blend}],
      },
      primitive: {topology: descriptor.topology ?? "triangle-list", cullMode: "none"},
      ...(descriptor.target === "scene"
        ? {
            depthStencil: {
              format: "depth24plus-stencil8",
              depthWriteEnabled: depth === "actual-surface" || depth === "proxy",
              depthCompare: depth === "test-only" || depth === "actual-surface" ? "less-equal" : "always",
            },
          }
        : {}),
    };
    // The native asynchronous API reports WGSL/layout failures before a pipeline
    // can enter the renderer's command encoder. Test/injected devices may omit it.
    const device = this.device as WebGPUDeviceLike & {
      createRenderPipelineAsync?(descriptor: object): Promise<WebGPURenderPipelineLike>;
    };
    const native = device.createRenderPipelineAsync
      ? await device.createRenderPipelineAsync(desc)
      : device.createRenderPipeline(desc);
    this.assertAlive();
    const handle = Object.freeze({label: descriptor.label});
    this.pipelines.set(handle, {native, layout, descriptor});
    return handle;
  }

  createBuffer(data: ArrayBufferView, usage: "uniform" | "vertex" | "index" | "storage"): WebGPUPluginBuffer {
    this.assertAlive();
    const byteLength = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
    const native = this.device.createBuffer({
      size: byteLength,
      usage: 8 | {uniform: 64, vertex: 32, index: 16, storage: 128}[usage],
    });
    const handle: WebGPUPluginBuffer = Object.freeze({
      byteLength,
      release: () => {
        this.assertUnused(handle);
        if (this.buffers.delete(handle)) native.destroy?.();
      },
    });
    this.buffers.set(handle, {native, usage});
    const bytes = new Uint8Array(byteLength);
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.device.queue.writeBuffer(native, 0, bytes);
    return handle;
  }

  writeBuffer(handle: WebGPUPluginBuffer, data: ArrayBufferView, byteOffset = 0): void {
    this.assertUnused(handle);
    const buffer = this.buffers.get(handle);
    if (
      !buffer ||
      byteOffset < 0 ||
      byteOffset % 4 ||
      data.byteLength % 4 ||
      byteOffset + data.byteLength > handle.byteLength
    ) {
      throw new Error("Invalid, released or out-of-range plugin buffer write");
    }
    this.device.queue.writeBuffer(buffer.native, byteOffset, data);
  }

  createTarget(width: number, height: number, mipmaps = false): WebGPUPluginTarget {
    this.assertAlive();
    if (![width, height].every((n) => Number.isInteger(n) && n > 0))
      throw new Error("Invalid target dimensions");
    const mipLevelCount = mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    const texture = this.device.createTexture({
      size: [width, height],
      format: "rgba16float",
      mipLevelCount,
      usage: 4 | 16,
    });
    const handle: WebGPUPluginTarget = Object.freeze({
      width,
      height,
      format: "rgba16float",
      mipLevelCount,
      release: () => {
        this.assertUnused(handle);
        if (this.targets.delete(handle)) texture.destroy?.();
      },
    });
    this.targets.set(handle, {texture, view: texture.createView()});
    return handle;
  }

  texture(resource: SceneDataResource): WebGPUPluginTexture {
    this.assertAlive();
    return this.cache.texture(resource);
  }

  private assertAlive(): void {
    if (!this.alive) throw new Error("Plugin host was disposed");
  }

  /** Prevent a later queue write or release from invalidating an already recorded pass. */
  beginTransaction(): void {
    if (this.transactionUses) throw new Error("Nested plugin transaction");
    this.transactionUses = new Set();
  }

  retainForTransaction(handle: object): void {
    this.transactionUses?.add(handle);
  }

  endTransaction(): void {
    this.transactionUses = undefined;
  }

  private assertUnused(handle: object): void {
    if (this.transactionUses?.has(handle)) throw new Error("Resource already referenced by a recorded pass");
  }

  /** Resolves opaque handles by allocation identity, never by labels supplied by plugins. */
  textureView(handle: WebGPUPluginTexture, borrowed: ReadonlyMap<WebGPUPluginTexture, unknown>): unknown {
    const view =
      this.targets.get(handle as WebGPUPluginTarget)?.view ??
      this.cache.textures.get(handle)?.view ??
      borrowed.get(handle);
    if (!view) throw new Error("Unknown, expired or released plugin texture");
    return view;
  }

  /** Record first; encoding occurs only after all callbacks for this instance succeed. */
  record(
    draw: (encoder: WebGPUPluginDrawEncoder) => void,
    target: "scene" | WebGPUPluginTarget,
    depth: WebGPUPluginDepth,
    borrowed: ReadonlyMap<WebGPUPluginTexture, unknown>,
    transparent = false
  ): (pass: WebGPURenderPassEncoderLike) => void {
    this.assertAlive();
    const commands: ((pass: WebGPURenderPassEncoderLike) => void)[] = [];
    let open = true;
    let pipeline: Pipeline | undefined;
    let index: {handle: WebGPUPluginBuffer; stride: number; offset: number} | undefined;
    const vertices = new Map<number, {handle: WebGPUPluginBuffer; offset: number}>();
    const check = () => {
      if (!open) throw new Error("Draw encoder has expired");
    };
    const count = (...values: number[]) => {
      if (values.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid draw range");
    };
    const assertDraw = (
      length: number,
      instances: number,
      first: number,
      firstInstance: number,
      indexed = false
    ) => {
      check();
      count(length, instances, first, firstInstance);
      if (!pipeline) throw new Error("Draw requires a pipeline");
      for (const [slot, layout] of (pipeline.descriptor.vertexBuffers ?? []).entries()) {
        const vertex = vertices.get(slot);
        if (!vertex) throw new Error("Missing vertex buffer");
        const end = layout.stepMode === "instance" ? firstInstance + instances : indexed ? 0 : first + length;
        if (vertex.offset + end * layout.arrayStride > vertex.handle.byteLength)
          throw new Error("Vertex draw exceeds buffer");
      }
    };
    const encoder: WebGPUPluginDrawEncoder = {
      setPipeline: (handle, bindings) => {
        check();
        const state = this.pipelines.get(handle);
        if (!state || state.descriptor.target !== (target === "scene" ? "scene" : "intermediate"))
          throw new Error("Pipeline target mismatch");
        if (target === "scene" && (state.descriptor.depth ?? "none") !== depth)
          throw new Error("Pipeline depth claim mismatch");
        if (transparent && (state.descriptor.blend !== "over" || state.descriptor.depth !== "test-only"))
          throw new Error("Transparent plugin draws require premultiplied over blending and test-only depth");
        if (bindings.length !== state.descriptor.bindings.length) throw new Error("Incomplete bindings");
        const entries = bindings.map((binding, i) => {
          const kind = state.descriptor.bindings[i];
          let resource: unknown;
          if (kind === "uniform" || kind === "read-only-storage") {
            const buffer = this.buffers.get(binding as WebGPUPluginBuffer);
            if (!buffer || buffer.usage !== (kind === "uniform" ? "uniform" : "storage"))
              throw new Error("Buffer binding usage mismatch");
            resource = {buffer: buffer.native};
            this.retainForTransaction(binding as WebGPUPluginBuffer);
          } else if (kind.startsWith("sampler-")) {
            if (binding !== kind || !this.device.createSampler) throw new Error("Sampler binding mismatch");
            if (!this.samplers.has(kind))
              this.samplers.set(
                kind,
                this.device.createSampler({
                  magFilter: kind === "sampler-linear" ? "linear" : "nearest",
                  minFilter: kind === "sampler-linear" ? "linear" : "nearest",
                  mipmapFilter: kind === "sampler-linear" ? "linear" : "nearest",
                })
              );
            resource = this.samplers.get(kind);
          } else {
            if (binding === target) throw new Error("Texture read/write alias in plugin pass");
            const texture = binding as WebGPUPluginTexture;
            if ((kind === "texture-depth") !== texture.format.startsWith("depth"))
              throw new Error("Texture depth type mismatch");
            if (kind === "texture-float" && ["r32float", "rg32float", "rgba32float"].includes(texture.format))
              throw new Error("Use unfilterable-float for numerical textures");
            resource = this.textureView(texture, borrowed);
            this.retainForTransaction(texture);
          }
          return {binding: i, resource};
        });
        const resourceId = (value: object) => {
          let id = this.resourceIds.get(value);
          if (id === undefined) {
            id = ++this.nextResourceId;
            this.resourceIds.set(value, id);
          }
          return id;
        };
        // Cache by resolved allocation identity, including borrowed scene views.
        // Per-frame handle wrappers and buffer contents do not invalidate bindings.
        const key = [
          resourceId(state.native),
          ...entries.map((entry) => {
            const resource = entry.resource as {buffer?: object};
            return resourceId(resource.buffer ?? resource);
          }),
        ].join("/");
        let group = this.bindGroups.get(key);
        if (!group) {
          group = this.device.createBindGroup({layout: state.layout, entries});
          if (this.bindGroups.size >= 256) this.bindGroups.clear();
          this.bindGroups.set(key, group);
        }
        pipeline = state;
        commands.push((pass) => {
          pass.setPipeline!(state.native);
          pass.setBindGroup!(0, group);
        });
      },
      setVertexBuffer: (slot, handle, offset = 0) => {
        check();
        count(slot, offset);
        const buffer = this.buffers.get(handle);
        if (!buffer || buffer.usage !== "vertex" || offset % 4 || offset >= handle.byteLength)
          throw new Error("Invalid vertex buffer");
        vertices.set(slot, {handle, offset});
        this.retainForTransaction(handle);
        commands.push((pass) => pass.setVertexBuffer!(slot, buffer.native, offset));
      },
      setIndexBuffer: (handle, format, offset = 0) => {
        check();
        count(offset);
        const buffer = this.buffers.get(handle);
        if (
          !buffer ||
          buffer.usage !== "index" ||
          offset % (format === "uint16" ? 2 : 4) ||
          offset >= handle.byteLength
        )
          throw new Error("Invalid index buffer");
        index = {handle, stride: format === "uint16" ? 2 : 4, offset};
        this.retainForTransaction(handle);
        commands.push((pass) => pass.setIndexBuffer!(buffer.native, format, offset));
      },
      draw: (n, instances = 1, first = 0, firstInstance = 0) => {
        assertDraw(n, instances, first, firstInstance);
        commands.push((pass) => pass.draw!(n, instances, first, firstInstance));
      },
      drawIndexed: (n, instances = 1, first = 0, base = 0, firstInstance = 0) => {
        assertDraw(n, instances, first, firstInstance, true);
        if (!index || !Number.isSafeInteger(base)) throw new Error("Invalid indexed draw");
        if (index.offset + (first + n) * index.stride > index.handle.byteLength)
          throw new Error("Index draw exceeds buffer");
        commands.push((pass) => pass.drawIndexed!(n, instances, first, base, firstInstance));
      },
    };
    try {
      draw(encoder);
    } finally {
      open = false;
    }
    return (pass) => {
      for (const command of commands) command(pass);
    };
  }

  destroy(): void {
    this.alive = false;
    this.endTransaction();
    for (const handle of this.buffers.keys()) handle.release();
    for (const handle of this.targets.keys()) handle.release();
    this.pipelines.clear();
    this.samplers.clear();
    this.bindGroups.clear();
  }
}
