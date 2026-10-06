/** Save only the public adapter's permitted state. No work occurs for ordinary frames.
 * Plugins own their VAOs and may use texture units 0..7. RenderManager invalidates its
 * program/texture caches after this scope; the live View/frame inputs are preserved.
 */
export function withPluginState<T>(gl: WebGL2RenderingContext, work: () => T): T {
  const get = (parameter: number) => gl.getParameter(parameter);
  const enabled = [
    gl.BLEND,
    gl.DEPTH_TEST,
    gl.CULL_FACE,
    gl.SCISSOR_TEST,
    gl.STENCIL_TEST,
    gl.POLYGON_OFFSET_FILL,
    gl.RASTERIZER_DISCARD,
    gl.SAMPLE_ALPHA_TO_COVERAGE,
  ].map((cap) => [cap, gl.isEnabled(cap)] as const);
  const state = {
    program: get(gl.CURRENT_PROGRAM),
    vao: get(gl.VERTEX_ARRAY_BINDING),
    array: get(gl.ARRAY_BUFFER_BINDING),
    draw: get(gl.DRAW_FRAMEBUFFER_BINDING),
    read: get(gl.READ_FRAMEBUFFER_BINDING),
    renderbuffer: get(gl.RENDERBUFFER_BINDING),
    viewport: get(gl.VIEWPORT),
    scissor: get(gl.SCISSOR_BOX),
    active: get(gl.ACTIVE_TEXTURE),
    depthFunc: get(gl.DEPTH_FUNC),
    depthMask: get(gl.DEPTH_WRITEMASK),
    depthRange: get(gl.DEPTH_RANGE),
    colorMask: get(gl.COLOR_WRITEMASK),
    clearColor: get(gl.COLOR_CLEAR_VALUE),
    clearDepth: get(gl.DEPTH_CLEAR_VALUE),
    frontFace: get(gl.FRONT_FACE),
    cull: get(gl.CULL_FACE_MODE),
    line: get(gl.LINE_WIDTH),
    srcRGB: get(gl.BLEND_SRC_RGB),
    dstRGB: get(gl.BLEND_DST_RGB),
    srcAlpha: get(gl.BLEND_SRC_ALPHA),
    dstAlpha: get(gl.BLEND_DST_ALPHA),
    equationRGB: get(gl.BLEND_EQUATION_RGB),
    equationAlpha: get(gl.BLEND_EQUATION_ALPHA),
    blendColor: get(gl.BLEND_COLOR),
    polygonFactor: get(gl.POLYGON_OFFSET_FACTOR),
    polygonUnits: get(gl.POLYGON_OFFSET_UNITS),
    stencilClear: get(gl.STENCIL_CLEAR_VALUE),
    stencilFront: [
      get(gl.STENCIL_FUNC),
      get(gl.STENCIL_REF),
      get(gl.STENCIL_VALUE_MASK),
      get(gl.STENCIL_WRITEMASK),
      get(gl.STENCIL_FAIL),
      get(gl.STENCIL_PASS_DEPTH_FAIL),
      get(gl.STENCIL_PASS_DEPTH_PASS),
    ],
    stencilBack: [
      get(gl.STENCIL_BACK_FUNC),
      get(gl.STENCIL_BACK_REF),
      get(gl.STENCIL_BACK_VALUE_MASK),
      get(gl.STENCIL_BACK_WRITEMASK),
      get(gl.STENCIL_BACK_FAIL),
      get(gl.STENCIL_BACK_PASS_DEPTH_FAIL),
      get(gl.STENCIL_BACK_PASS_DEPTH_PASS),
    ],
    pack: get(gl.PACK_ALIGNMENT),
    unpack: get(gl.UNPACK_ALIGNMENT),
    flip: get(gl.UNPACK_FLIP_Y_WEBGL),
    premultiply: get(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
    colorspace: get(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL),
    packBuffer: get(gl.PIXEL_PACK_BUFFER_BINDING),
    unpackBuffer: get(gl.PIXEL_UNPACK_BUFFER_BINDING),
  };
  const textures = Array.from({length: 8}, (_, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    return [get(gl.TEXTURE_BINDING_2D), get(gl.TEXTURE_BINDING_CUBE_MAP), get(gl.SAMPLER_BINDING)];
  });
  try {
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let unit = 0; unit < 8; unit++) gl.bindSampler(unit, null);
    return work();
  } finally {
    gl.useProgram(state.program);
    gl.bindVertexArray(state.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.array);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.draw);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.read);
    gl.bindRenderbuffer(gl.RENDERBUFFER, state.renderbuffer);
    gl.viewport(...(state.viewport as [number, number, number, number]));
    gl.scissor(...(state.scissor as [number, number, number, number]));
    gl.depthFunc(state.depthFunc);
    gl.depthMask(state.depthMask);
    gl.depthRange(state.depthRange[0], state.depthRange[1]);
    gl.colorMask(...(state.colorMask as [boolean, boolean, boolean, boolean]));
    gl.clearColor(...(state.clearColor as [number, number, number, number]));
    gl.clearDepth(state.clearDepth);
    gl.frontFace(state.frontFace);
    gl.cullFace(state.cull);
    gl.lineWidth(state.line);
    gl.blendFuncSeparate(state.srcRGB, state.dstRGB, state.srcAlpha, state.dstAlpha);
    gl.blendEquationSeparate(state.equationRGB, state.equationAlpha);
    gl.blendColor(...(state.blendColor as [number, number, number, number]));
    gl.polygonOffset(state.polygonFactor, state.polygonUnits);
    gl.clearStencil(state.stencilClear);
    [gl.FRONT, gl.BACK].forEach((face, i) => {
      const s = i ? state.stencilBack : state.stencilFront;
      gl.stencilFuncSeparate(face, s[0], s[1], s[2]);
      gl.stencilMaskSeparate(face, s[3]);
      gl.stencilOpSeparate(face, s[4], s[5], s[6]);
    });
    gl.pixelStorei(gl.PACK_ALIGNMENT, state.pack);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, state.unpack);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, state.flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, state.premultiply);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, state.colorspace);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.packBuffer);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, state.unpackBuffer);
    textures.forEach(([texture, cube, sampler], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
      gl.bindSampler(unit, sampler);
    });
    gl.activeTexture(state.active);
    enabled.forEach(([cap, on]) => (on ? gl.enable(cap) : gl.disable(cap)));
  }
}
