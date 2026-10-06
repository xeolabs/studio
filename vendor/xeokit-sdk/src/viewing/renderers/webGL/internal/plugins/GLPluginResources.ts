import type {SceneDataResource} from "../../../../../model/scene/representation/SceneDataResource";
import type {WebGLPluginHost} from "../../plugins/WebGLPluginHost";
import type {WebGLPluginTarget} from "../../plugins/WebGLPluginTarget";

/** One cache per device. Definitions, instances and views share compatible scene uploads. */
export class GLSceneResourceCache {

  private entries = new Map<
    SceneDataResource,
    {

      texture: WebGLTexture;

      revision: number;
    }
  >();

  uploadedBytes = 0;

  constructor(readonly gl: WebGL2RenderingContext) {}

  texture(resource: SceneDataResource): WebGLTexture {
    const gl = this.gl,
      descriptor = resource.descriptor;
    if (resource.destroyed || descriptor.kind !== "texture2d")
      throw new Error("Expected a live texture2d scene resource");
    if (
      descriptor.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
      descriptor.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)
    )
      throw new Error("Scene resource exceeds MAX_TEXTURE_SIZE");
    let entry = this.entries.get(resource);
    if (!entry) this.entries.set(resource, (entry = {texture: gl.createTexture()!, revision: -1}));
    if (entry.revision !== resource.revision) {
      const formats = {
        r32float: [gl.R32F, gl.RED, gl.FLOAT],
        rg32float: [gl.RG32F, gl.RG, gl.FLOAT],
        rgba32float: [gl.RGBA32F, gl.RGBA, gl.FLOAT],
        rgba8unorm: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
      };
      const [internal, format, type] = formats[descriptor.format];
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internal,
        descriptor.width,
        descriptor.height,
        0,
        format,
        type,
        resource.data as ArrayBufferView
      );
      const filter = gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry.revision = resource.revision;
      this.uploadedBytes += resource.data.byteLength;
    }
    return entry.texture;
  }

  prune(): void {
    for (const [resource, entry] of this.entries)
      if (resource.destroyed) {
        this.gl.deleteTexture(entry.texture);
        this.entries.delete(resource);
      }
  }

  destroy(): void {
    for (const entry of this.entries.values()) this.gl.deleteTexture(entry.texture);
    this.entries.clear();
  }
}

/** Tracked runtime allocations. Dispose also cleans up partially failed plugin initialization. */
export class GLPluginResources implements WebGLPluginHost {

  private disposers = new Set<() => void>();

  constructor(
    readonly gl: WebGL2RenderingContext,
    private cache: GLSceneResourceCache,
    readonly requestRedraw: () => void
  ) {}

  createProgram(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl,
      program = gl.createProgram()!,
      shaders: WebGLShader[] = [];
    try {
      for (const [type, code] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type)!;
        shaders.push(shader);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || "Plugin shader failed");
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || "Plugin linking failed");
      this.disposers.add(() => gl.deleteProgram(program));
      return program;
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }

  createBuffer(data: ArrayBufferView, usage = this.gl.DYNAMIC_DRAW): WebGLBuffer {
    const gl = this.gl,
      buffer = gl.createBuffer()!;
    this.disposers.add(() => gl.deleteBuffer(buffer));
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return buffer;
  }

  createVertexArray(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray()!;
    this.disposers.add(() => this.gl.deleteVertexArray(vao));
    return vao;
  }

  createTarget(width: number, height: number, mipmaps = false): WebGLPluginTarget {
    const gl = this.gl;
    if (!gl.getExtension("EXT_color_buffer_float"))
      throw new Error("HDR plugin targets require EXT_color_buffer_float");
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      Math.max(width, height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)
    )
      throw new Error("Invalid plugin target dimensions");
    const texture = gl.createTexture()!,
      framebuffer = gl.createFramebuffer()!;
    const release = () => {
      if (this.disposers.delete(release)) {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
      }
    };
    this.disposers.add(release);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1,
      gl.RGBA16F,
      width,
      height
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      release();
      throw new Error("Incomplete plugin target");
    }
    return {texture, framebuffer, width, height, release};
  }

  texture(resource: SceneDataResource): WebGLTexture {
    return this.cache.texture(resource);
  }

  destroy(): void {
    for (const dispose of [...this.disposers]) dispose();
    this.disposers.clear();
  }
}
