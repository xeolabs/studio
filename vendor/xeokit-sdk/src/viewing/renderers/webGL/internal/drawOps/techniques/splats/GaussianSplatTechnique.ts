import type {ViewRenderState} from "../../../ViewRenderState";
import {SDKErrorType, type SDKResult} from "../../../../../../../base/core";
import type {SplatBatch} from "../../../gpuMemoryManager/SplatBatch";
import {SplatSortWorker} from "../../../gpuMemoryManager/SplatSortWorker";
import {MAX_SECTION_PLANES, packSectionPlanes} from "../../DrawTechnique";

/** Reusable scratch for packing the active section planes each draw. */
const SECTION_PLANE_SCRATCH = new Float32Array(MAX_SECTION_PLANES * 4);

/** True if any of the 16 matrix elements differ (camera-moved test). */
function viewChanged(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) {
      return true;
    }
  }
  return false;
}

/*
 * 3D Gaussian Splatting draw pass — ports the validated standalone spike
 * (baked RGB, no SH) into the renderer. Self-contained GL pass hosted by
 * RenderManager: init() / render(viewRenderState, splatBatch) / destroy(),
 * GL state saved+restored.
 *
 * Conventions are LOCKED from the spike: covariance Σ = Mᵀ·M (done at pack time
 * in packSplats), and the EWA focal-Y sign is +1 here (see FOCAL_Y_SIGN). If the
 * in-browser result is upside-down / smeared, FOCAL_Y_SIGN is the first value to
 * flip (the SDK camera's projMatrix Y convention may differ from the spike's).
 *
 * The whole batch is drawn in ONE instanced call over a sorted item-index
 * buffer; the sort runs off the main thread (see SplatSortWorker).
 *
 * NOT unit-testable (owns a live GL program) — verify in the browser.
 */
const FOCAL_Y_SIGN = 1.0;

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uTex;     // RGBA32F, 4 texels/splat
uniform highp usampler2D uFramePositionTex; // RGB16UI, complete frame positions
uniform sampler2D uFrameDecodeTex;          // RGBA32F, two texels per frame
uniform sampler2D uFrameStateTex;           // RGBA32F, six texels per splat mesh
uniform int uTexW;
uniform int uFramePositionTexW;
uniform int uFrameDecodeTexW;
uniform int uFrameStateTexW;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uLogDepthCoef;
uniform vec2 uFocal;
uniform vec2 uViewport;
uniform vec4 uSplatDisplayParams; // radiusScale, alphaSharpness, stressMix, stressGain

// Section-plane bank — plane equation packed as (normal.xyz, d), with
// dot(normal, worldPos) + d > 0 meaning "clipped side". t0.xyz is the splat's
// world-space centre, so the whole splat is culled per-centre (see comment in
// main). Compiled with a fixed array size; the renderer just updates the count.
uniform vec4 uSectionPlanes[${MAX_SECTION_PLANES}];
uniform int uSectionPlaneCount;

in vec2 aCorner;            // quad corner [-2, 2]
in uint aIndex;             // sorted splat item-index

out vec4 vColor;
out vec2 vCorner;
out float vFragDepth;

vec4 fetchTexel(int i) {
    int idx = int(aIndex) * 4 + i;
    return texelFetch(uTex, ivec2(idx % uTexW, idx / uTexW), 0);
}

ivec2 texCoord(int index, int width) {
    return ivec2(index % width, index / width);
}

vec3 decodeFramePosition(int positionIndex, int decodeTexelBase) {
    uvec3 packed = texelFetch(uFramePositionTex, texCoord(positionIndex, uFramePositionTexW), 0).rgb;
    vec3 quantized = vec3(packed);
    vec4 offset = texelFetch(uFrameDecodeTex, texCoord(decodeTexelBase, uFrameDecodeTexW), 0);
    vec4 scale = texelFetch(uFrameDecodeTex, texCoord(decodeTexelBase + 1, uFrameDecodeTexW), 0);
    return offset.xyz + quantized * scale.xyz;
}

vec4 fetchFrameState(int meshPickId, int texelOffset) {
    int idx = meshPickId * 6 + texelOffset;
    return texelFetch(uFrameStateTex, texCoord(idx, uFrameStateTexW), 0);
}

vec3 getSplatCenter(vec4 t0, vec4 t1, vec4 t3) {
    int meshPickId = int(t1.w + 0.5);
    vec4 state0 = fetchFrameState(meshPickId, 0);
    vec4 state1 = fetchFrameState(meshPickId, 1);
    if (state1.y < 0.5) {
        return t0.xyz;
    }
    int frameVertexIndex = int(t3.w + 0.5);
    vec3 positionA = decodeFramePosition(int(state0.x) + frameVertexIndex, int(state0.z));
    vec3 positionB = decodeFramePosition(int(state0.y) + frameVertexIndex, int(state0.w));
    vec3 localPosition = mix(positionA, positionB, state1.x);
    mat4 worldMatrix = mat4(
      fetchFrameState(meshPickId, 2),
      fetchFrameState(meshPickId, 3),
      fetchFrameState(meshPickId, 4),
      fetchFrameState(meshPickId, 5)
    );
    return (worldMatrix * vec4(localPosition, 1.0)).xyz;
}

vec3 stressColor(float stress) {
    vec3 cold = vec3(0.08, 0.52, 1.0);
    vec3 warm = vec3(1.0, 0.78, 0.08);
    vec3 hot = vec3(1.0, 0.10, 0.04);
    float t = clamp(stress, 0.0, 1.0);
    if (t < 0.55) {
        return mix(cold, warm, smoothstep(0.0, 0.55, t));
    }
    return mix(warm, hot, smoothstep(0.55, 1.0, t));
}

void main() {
    vec4 t0 = fetchTexel(0);
    vec4 t1 = fetchTexel(1);
    vec4 t2 = fetchTexel(2);
    vec4 t3 = fetchTexel(3);

    vec3 center = getSplatCenter(t0, t1, t3);
    int meshPickId = int(t1.w + 0.5);
    vec4 state1 = fetchFrameState(meshPickId, 1);
    float stress = clamp(length(center - t0.xyz) * max(uSplatDisplayParams.w, 0.0), 0.0, 1.0);
    vec3 color = state1.y > 0.5 ? stressColor(stress) : t1.rgb;
    vColor = vec4(color, t0.w);

    // Section-plane clipping, per splat centre in world space. Cull the whole
    // splat off-screen when its centre is on the clipped side of any active
    // plane. Centre-granularity (the soft footprint can bleed ~one radius past
    // the cut); a per-fragment clean cut would need 3D ray/gaussian work.
    for (int i = 0; i < uSectionPlaneCount; i++) {
        if (dot(uSectionPlanes[i].xyz, center) + uSectionPlanes[i].w > 0.0) {
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            return;
        }
    }

    vec4 cam = uView * vec4(center, 1.0);
    if (cam.z > -0.01) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // behind the camera: cull off-screen
        return;
    }

    mat3 Vrk = mat3(t2.x, t2.y, t2.z,
                    t2.y, t3.x, t3.y,
                    t2.z, t3.y, t3.z);
    float z = cam.z;
    mat3 J = mat3(uFocal.x / z, 0.0, -(uFocal.x * cam.x) / (z * z),
                  0.0, ${FOCAL_Y_SIGN.toFixed(1)} * uFocal.y / z, ${(-FOCAL_Y_SIGN).toFixed(1)} * (uFocal.y * cam.y) / (z * z),
                  0.0, 0.0, 0.0);
    mat3 W = transpose(mat3(uView));
    mat3 T = W * J;
    mat3 cov2d = transpose(T) * Vrk * T;

    float a = cov2d[0][0] + 0.3;
    float b = cov2d[0][1];
    float c = cov2d[1][1] + 0.3;
    float mid = 0.5 * (a + c);
    float radius = length(vec2(0.5 * (a - c), b));
    float l1 = mid + radius;
    float l2 = mid - radius;
    if (l2 <= 0.0) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // degenerate footprint: cull
        return;
    }

    vec2 e1 = vec2(1.0, 0.0);
    if (abs(b) + abs(l1 - a) > 0.000001) {
        e1 = normalize(vec2(b, l1 - a));
    }
    vec2 e2 = vec2(e1.y, -e1.x);
    float displayRadiusScale = max(uSplatDisplayParams.x, 0.05);
    vec2 major = min(sqrt(2.0 * l1) * displayRadiusScale, 1024.0) * e1;
    vec2 minor = min(sqrt(2.0 * l2) * displayRadiusScale, 1024.0) * e2;

    vec4 clip = uProj * cam;
    vFragDepth = 1.0 + clip.w;
    vec2 off = (aCorner.x * major + aCorner.y * minor) / uViewport * 2.0 * clip.w;
    gl_Position = vec4(clip.xy + off, clip.zw);
    vCorner = aCorner;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vCorner;
in float vFragDepth;
uniform vec4 uSplatDisplayParams;
uniform float uLogDepthCoef;
out vec4 outColor;

void main() {
    float alphaSharpness = max(uSplatDisplayParams.y, 0.1);
    float alpha = exp(-dot(vCorner, vCorner) * alphaSharpness) * vColor.a;
    if (alpha < 0.004) {
        discard;
    }
    gl_FragDepth = log2(max(1.0e-6, vFragDepth)) * uLogDepthCoef * 0.5;
    outColor = vec4(vColor.rgb * alpha, alpha);   // premultiplied for blendFunc(ONE, 1 - SRC_A)
}
`;

/** Billboard quad corners, expanded by the EWA footprint in the vertex shader. */
const QUAD_CORNERS = new Float32Array([-2, -2, 2, -2, -2, 2, 2, 2]);

export class GaussianSplatTechnique {

  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private cornerBuf: WebGLBuffer | null = null;
  private idxBuf: WebGLBuffer | null = null;
  private aCorner = -1;
  private aIndex = -1;
  private uTex: WebGLUniformLocation | null = null;
  private uFramePositionTex: WebGLUniformLocation | null = null;
  private uFrameDecodeTex: WebGLUniformLocation | null = null;
  private uFrameStateTex: WebGLUniformLocation | null = null;
  private uTexW: WebGLUniformLocation | null = null;
  private uFramePositionTexW: WebGLUniformLocation | null = null;
  private uFrameDecodeTexW: WebGLUniformLocation | null = null;
  private uFrameStateTexW: WebGLUniformLocation | null = null;
  private uView: WebGLUniformLocation | null = null;
  private uProj: WebGLUniformLocation | null = null;
  private uLogDepthCoef: WebGLUniformLocation | null = null;
  private uFocal: WebGLUniformLocation | null = null;
  private uViewport: WebGLUniformLocation | null = null;
  private uSplatDisplayParams: WebGLUniformLocation | null = null;
  private uSectionPlanes: WebGLUniformLocation | null = null;
  private uSectionPlaneCount: WebGLUniformLocation | null = null;
  private initialized = false;
  private destroyed = false;

  private _sortWorker: SplatSortWorker | null = null;
  private _revision = -1;
  private _count = 0;
  private _fallbackIdx = new Uint32Array(0);     // unsorted order, until first sort lands
  private _uploaded: Uint32Array | null = null;  // what's currently in idxBuf
  private _lastView: Float32Array | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  init(): SDKResult<void> {
    if (this.initialized) {
      return {ok: true, value: undefined};
    }
    try {
      const gl = this.gl;
      this.program = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
      this.cornerBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);
      this.idxBuf = gl.createBuffer();
      this._sortWorker = new SplatSortWorker();
      this.aCorner = gl.getAttribLocation(this.program, "aCorner");
      this.aIndex = gl.getAttribLocation(this.program, "aIndex");
      this.uTex = this.getUniformLocation("uTex");
      this.uFramePositionTex = this.getUniformLocation("uFramePositionTex");
      this.uFrameDecodeTex = this.getUniformLocation("uFrameDecodeTex");
      this.uFrameStateTex = this.getUniformLocation("uFrameStateTex");
      this.uTexW = this.getUniformLocation("uTexW");
      this.uFramePositionTexW = this.getUniformLocation("uFramePositionTexW");
      this.uFrameDecodeTexW = this.getUniformLocation("uFrameDecodeTexW");
      this.uFrameStateTexW = this.getUniformLocation("uFrameStateTexW");
      this.uView = this.getUniformLocation("uView");
      this.uProj = this.getUniformLocation("uProj");
      this.uLogDepthCoef = this.getUniformLocation("uLogDepthCoef");
      this.uFocal = this.getUniformLocation("uFocal");
      this.uViewport = this.getUniformLocation("uViewport");
      this.uSplatDisplayParams = this.getUniformLocation("uSplatDisplayParams");
      this.uSectionPlanes = this.getUniformLocation("uSectionPlanes[0]");
      this.uSectionPlaneCount = this.getUniformLocation("uSectionPlaneCount");
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.initialized = true;
      return {ok: true, value: undefined};
    } catch (e) {
      this.destroy();
      return {ok: false, type: SDKErrorType.InitializationFailed, error: e instanceof Error ? e.message : String(e)};
    }
  }

  render(viewRenderState: ViewRenderState, splatBatch: SplatBatch | null): void {
    if (!this.initialized || !this.program || !splatBatch || splatBatch.numSplats === 0) {
      return;
    }
    const gl = this.gl;
    const camera = viewRenderState.view.camera;
    const view = camera.viewMatrix as unknown as Float32Array;
    const proj = camera.projMatrix as unknown as Float32Array;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    // Flush any newly-added/removed splat portions to the GPU texture.
    splatBatch.uploadChanges();

    // Re-feed the sort worker whenever the splat set changes.
    if (splatBatch.revision !== this._revision) {
      this._revision = splatBatch.revision;
      const {positions, itemIndices} = splatBatch.extractSortCenters();
      this._count = itemIndices.length;
      this._fallbackIdx = itemIndices;   // unsorted order until the first sort lands
      this._uploaded = null;
      this._lastView = null;
      this._sortWorker?.setPositions(positions, itemIndices);
    }
    if (this._count === 0) {
      return;
    }

    // Request a fresh sort when the camera has moved.
    if (!this._lastView || viewChanged(view, this._lastView)) {
      this._sortWorker?.requestSort(view);
      this._lastView = view.slice() as Float32Array;
    }

    // Draw the latest sorted order (or the unsorted fallback until the first
    // async result arrives). Re-upload only when the order actually changes.
    const order = this._sortWorker?.latest ?? this._fallbackIdx;
    if (order !== this._uploaded) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.idxBuf);
      gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);
      this._uploaded = order;
    }

    // Save GL state we touch.
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const blendOn = gl.isEnabled(gl.BLEND);
    const cullOn = gl.isEnabled(gl.CULL_FACE);
    const depthTestOn = gl.isEnabled(gl.DEPTH_TEST);
    const polygonOffsetFillOn = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
    const depthFunc = gl.getParameter(gl.DEPTH_FUNC) as number;
    const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const blendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB) as number;
    const blendDstRGB = gl.getParameter(gl.BLEND_DST_RGB) as number;
    const blendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
    const blendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA) as number;

    gl.useProgram(this.program);
    // Focal length in pixels, from the camera's own projection.
    const fx = proj[0] * w * 0.5;
    const fy = proj[5] * h * 0.5;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, splatBatch.texture.texture);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, splatBatch.framePositionTexture.texture);
    gl.uniform1i(this.uFramePositionTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, splatBatch.framePositionDecodeTexture.texture);
    gl.uniform1i(this.uFrameDecodeTex, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, splatBatch.frameStateTexture.texture);
    gl.uniform1i(this.uFrameStateTex, 3);
    gl.uniform1i(this.uTexW, splatBatch.texture.width);
    gl.uniform1i(this.uFramePositionTexW, splatBatch.framePositionTexture.width);
    gl.uniform1i(this.uFrameDecodeTexW, splatBatch.framePositionDecodeTexture.width);
    gl.uniform1i(this.uFrameStateTexW, splatBatch.frameStateTexture.width);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    gl.uniform1f(this.uLogDepthCoef, 2.0 / Math.log2(camera.perspectiveProjection.far + 1.0));
    gl.uniform2f(this.uFocal, fx, fy);
    gl.uniform2f(this.uViewport, w, h);
    const displayParams = (viewRenderState.view as unknown as {splatDisplayParams?: {
      radiusScale?: number;
      alphaSharpness?: number;
      stressMix?: number;
      stressGain?: number;
    }}).splatDisplayParams;
    const radiusScale = Number(displayParams?.radiusScale ?? 1);
    const alphaSharpness = Number(displayParams?.alphaSharpness ?? 1);
    const stressMix = Number(displayParams?.stressMix ?? 0);
    const stressGain = Number(displayParams?.stressGain ?? 1);
    gl.uniform4f(
      this.uSplatDisplayParams,
      Number.isFinite(radiusScale) ? Math.max(0.05, Math.min(4, radiusScale)) : 1,
      Number.isFinite(alphaSharpness) ? Math.max(0.1, Math.min(8, alphaSharpness)) : 1,
      Number.isFinite(stressMix) ? Math.max(0, Math.min(1, stressMix)) : 0,
      Number.isFinite(stressGain) ? Math.max(0, Math.min(200, stressGain)) : 1
    );

    // Section planes (world space) — culls clipped splats per centre in the VS.
    const planeCount = packSectionPlanes(viewRenderState.view.sectionPlanesList, SECTION_PLANE_SCRATCH);
    gl.uniform1i(this.uSectionPlaneCount, planeCount);
    if (planeCount > 0) {
      gl.uniform4fv(this.uSectionPlanes, SECTION_PLANE_SCRATCH);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.enableVertexAttribArray(this.aCorner);
    gl.vertexAttribPointer(this.aCorner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.aCorner, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idxBuf);
    gl.enableVertexAttribArray(this.aIndex);
    gl.vertexAttribIPointer(this.aIndex, 1, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(this.aIndex, 1);

    gl.enable(gl.DEPTH_TEST);
    // Match the mesh colour path's tolerance for equal-depth fragments. The
    // splat pass expands billboard triangles from texture-backed centres, so
    // tiny precision differences against presentation bases should not make an
    // otherwise visible splat disappear behind coplanar/near-coplanar support
    // geometry.
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this._count);

    // Restore.
    gl.disableVertexAttribArray(this.aCorner);
    gl.disableVertexAttribArray(this.aIndex);
    gl.vertexAttribDivisor(this.aIndex, 0);
    gl.activeTexture(activeTexture);
    gl.blendFuncSeparate(blendSrcRGB, blendDstRGB, blendSrcAlpha, blendDstAlpha);
    gl.depthFunc(depthFunc);
    gl.depthMask(depthMask);
    if (!blendOn) {
      gl.disable(gl.BLEND);
    }
    if (!depthTestOn) {
      gl.disable(gl.DEPTH_TEST);
    }
    if (polygonOffsetFillOn) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
    }
    if (cullOn) {
      gl.enable(gl.CULL_FACE);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(prevProgram);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    const gl = this.gl;
    this._sortWorker?.destroy();
    this._sortWorker = null;
    if (this.program) {
      gl.deleteProgram(this.program);
    }
    if (this.cornerBuf) {
      gl.deleteBuffer(this.cornerBuf);
    }
    if (this.idxBuf) {
      gl.deleteBuffer(this.idxBuf);
    }
    this.program = null;
    this.cornerBuf = null;
    this.idxBuf = null;
    this.destroyed = true;
    this.initialized = false;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error("[GaussianSplatTechnique] Failed to create WebGL program");
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || "Program link failed";
      gl.deleteProgram(program);
      throw new Error(`[GaussianSplatTechnique] ${info}`);
    }
    return program;
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("[GaussianSplatTechnique] Failed to create shader");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || "Shader compile failed";
      gl.deleteShader(shader);
      throw new Error(`[GaussianSplatTechnique] ${info}`);
    }
    return shader;
  }

  private getUniformLocation(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program!, name);
    if (location === null) {
      throw new Error(`[GaussianSplatTechnique] Uniform not found: ${name}`);
    }
    return location;
  }
}
