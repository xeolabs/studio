import type {SceneDataResource} from "../../../../model/scene/representation/SceneDataResource";
import type {WebGLPluginTarget} from "./WebGLPluginTarget";

/**
 * Public WebGL2 services scoped to one plugin runtime and device generation.
 *
 * Use allocations only in create, prepare, render and disposal callbacks. Never
 * retain host or GPU handles after disposal. Allocations made through this host
 * are cleaned up even when adapter initialization throws part-way through.
 */
export interface WebGLPluginHost {

  /**
   * Borrowed context for synchronous drawing. Use your own VAOs, texture units
   * 0..7 and ordinary uniforms. Do not mutate host attachments, other programs,
   * shared resource textures, UBO bindings, transform feedback or query state.
   */
  readonly gl: WebGL2RenderingContext;

  /** Compiles/links GLSL ES 3.00 sources; throws with diagnostics on failure. */
  createProgram(vertex: string, fragment: string): WebGLProgram;

  /** Creates and uploads an ARRAY_BUFFER; usage defaults to DYNAMIC_DRAW. */
  createBuffer(data: ArrayBufferView, usage?: number): WebGLBuffer;

  /** Creates an initially empty VAO for plugin-owned vertex bindings. */
  createVertexArray(): WebGLVertexArrayObject;

  /**
   * Creates a floating-point colour target, requiring EXT_color_buffer_float.
   * Dimensions must be positive integers within MAX_TEXTURE_SIZE. Optional mip
   * storage is allocated, but the plugin must generate its mipmaps after drawing.
   */
  createTarget(width: number, height: number, mipmaps?: boolean): WebGLPluginTarget;

  /**
   * Borrows a shared texture2d scene upload with nearest sampling and clamp-to-edge.
   * Uploads once per resource revision/device; compatible instances share storage.
   * Never delete or change its storage/sampler state. Float filtering can be done
   * explicitly in the shader without requiring a float-linear extension.
   */
  texture(resource: SceneDataResource): WebGLTexture;

  /** Schedules another render of attached Views without mutating scene data. */
  requestRedraw(): void;
}
