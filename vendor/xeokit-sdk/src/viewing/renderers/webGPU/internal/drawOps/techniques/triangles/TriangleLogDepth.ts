/**
 * WGSL snippets for optional logarithmic depth writes in WebGPU triangle
 * techniques.
 *
 * @internal
 */
export function triangleLogDepthVertexField(logDepth: boolean, location: number): string {
  return logDepth ? `  @location(${location}) fragDepth: f32,\n` : "";
}

/**
 * @internal
 */
export function triangleLogDepthVertexWrite(logDepth: boolean): string {
  return logDepth ? "  output.fragDepth = 1.0 + output.position.w;\n" : "";
}

/**
 * @internal
 */
export function triangleLogDepthFragmentOutputStruct(logDepth: boolean, color: boolean): string {
  if (!logDepth) {
    return "";
  }
  return color
    ? `
struct FragmentOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};
`
    : `
struct FragmentOutput {
  @builtin(frag_depth) depth: f32,
};
`;
}

/**
 * @internal
 */
export function triangleLogDepthReturnType(logDepth: boolean, color: boolean): string {
  if (!logDepth) {
    return color ? "@location(0) vec4<f32>" : "";
  }
  return "FragmentOutput";
}

/**
 * @internal
 */
export function triangleLogDepthReturn(logDepth: boolean, colorExpression = "vec4<f32>(0.0)"): string {
  if (!logDepth) {
    return colorExpression;
  }
  return `FragmentOutput(${colorExpression}, ${triangleFragmentDepth()})`;
}

/**
 * @internal
 */
export function triangleLogDepthOnlyReturn(): string {
  return `FragmentOutput(${triangleFragmentDepth()})`;
}

function triangleFragmentDepth(): string {
  // Fragment-stage position.z already contains the projected depth in [0, 1].
  // Use it for ortho in every pass, including picking, edges and the prepass.
  return "select(input.position.z, log2(max(1.0e-6, input.fragDepth)) * frame.depthParams.x * 0.5, frame.depthParams.y > 0.5)";
}
