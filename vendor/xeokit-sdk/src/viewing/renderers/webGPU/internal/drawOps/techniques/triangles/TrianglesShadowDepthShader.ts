import {TRIANGLE_BILLBOARD_WGSL, TRIANGLE_POSITION_DECODE_WGSL, TRIANGLE_RTC_TILE_WGSL} from "./TrianglePositionPacking";

/**
 * WGSL shader for the WebGPU triangle shadow-map depth pass.
 *
 * @internal
 */
export const TRIANGLES_SHADOW_DEPTH_SHADER = `
struct FrameUniforms {
  viewProjection: mat4x4<f32>,
  ambientLight: vec4<f32>,
  dirLightDirections: array<vec4<f32>, 3>,
  dirLightColors: array<vec4<f32>, 3>,
  sectionPlaneState: vec4<f32>,
  sectionPlanes: array<vec4<f32>, 8>,
  sectionPlaneCapColors: array<vec4<f32>, 8>,
  depthParams: vec4<f32>,
  pointParams0: vec4<f32>,
  pointParams1: vec4<f32>,
  lineParams: vec4<f32>,
  viewMatrix: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

struct MeshInstance {
  modelMatrix: mat4x4<f32>,
  color: vec4<f32>,
  flags: vec4<f32>,
  normalMatrix0: vec4<f32>,
  normalMatrix1: vec4<f32>,
  normalMatrix2: vec4<f32>,
  frame0: vec4<f32>,
  frame1: vec4<f32>,
};

@group(1) @binding(0) var<storage, read> instances: array<MeshInstance>;

${TRIANGLE_POSITION_DECODE_WGSL}
${TRIANGLE_RTC_TILE_WGSL}
${TRIANGLE_BILLBOARD_WGSL}

struct VertexInput {
  @location(0) packedPosition: vec4<f32>,
  @location(1) vertexMetadata: vec4<u32>,
  @builtin(vertex_index) vertexIndex: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) clippable: f32,
  @location(2) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let instance = instances[input.vertexMetadata.x];
  let rtcTile = getInstanceRTCTile(instance);
  let localPosition = getPackedOrFrameLocalPosition(input.packedPosition, input.vertexMetadata.y, instance, input.vertexMetadata.z);
  let rtcWorldPos = getMeshRTCWorldPosition(localPosition, instance, frame.viewMatrix);
  var output: VertexOutput;
  output.position = rtcTile.viewProjection * rtcWorldPos;
  output.worldPos = (rtcWorldPos.xyz / rtcWorldPos.w) + rtcTile.center.xyz;
  output.clippable = instance.flags.x;
  output.color = instance.color;
  return output;
}

fn shadowAlphaHash(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn shadowCoverageFromBlendAlpha(alphaInput: f32) -> f32 {
  let alpha = clamp(alphaInput, 0.0, 1.0);
  if (alpha < 0.02) {
    return 0.0;
  }
  return alpha * alpha;
}

@fragment
fn fs_main(input: VertexOutput) {
  if (input.clippable > 0.5) {
    for (var i = 0u; i < 8u; i = i + 1u) {
      if (i >= u32(frame.sectionPlaneState.x)) {
        break;
      }
      let plane = frame.sectionPlanes[i];
      if (dot(plane.xyz, input.worldPos) + plane.w > 0.0) {
        discard;
      }
    }
  }
  if (input.color.a < 0.999) {
    let shadowCoverage = shadowCoverageFromBlendAlpha(input.color.a);
    if (shadowCoverage <= 0.0 || shadowAlphaHash(input.position.xy) > shadowCoverage) {
      discard;
    }
  }
}
`;

export const TRIANGLES_MASKED_SHADOW_DEPTH_SHADER = `
struct FrameUniforms {
  viewProjection: mat4x4<f32>,
  ambientLight: vec4<f32>,
  dirLightDirections: array<vec4<f32>, 3>,
  dirLightColors: array<vec4<f32>, 3>,
  sectionPlaneState: vec4<f32>,
  sectionPlanes: array<vec4<f32>, 8>,
  sectionPlaneCapColors: array<vec4<f32>, 8>,
  depthParams: vec4<f32>,
  pointParams0: vec4<f32>,
  pointParams1: vec4<f32>,
  lineParams: vec4<f32>,
  viewMatrix: mat4x4<f32>,
  splatParams: vec4<f32>,
  splatDisplayParams: vec4<f32>,
  hemisphereSky: vec4<f32>,
  hemisphereGround: vec4<f32>,
  hemisphereUp: vec4<f32>,
  edgeParams: vec4<f32>,
  edgeColor: vec4<f32>,
  materialParams: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

struct MeshInstance {
  modelMatrix: mat4x4<f32>,
  color: vec4<f32>,
  flags: vec4<f32>,
  normalMatrix0: vec4<f32>,
  normalMatrix1: vec4<f32>,
  normalMatrix2: vec4<f32>,
  frame0: vec4<f32>,
  frame1: vec4<f32>,
};

@group(1) @binding(0) var<storage, read> instances: array<MeshInstance>;

@group(3) @binding(1) var colorSampler: sampler;
@group(3) @binding(2) var colorTexture: texture_2d<f32>;

struct TextureTransformUniforms {
  color0: vec4<f32>,
  color1: vec4<f32>,
  metallicRoughness0: vec4<f32>,
  metallicRoughness1: vec4<f32>,
  normal0: vec4<f32>,
  normal1: vec4<f32>,
  emissive0: vec4<f32>,
  emissive1: vec4<f32>,
  occlusion0: vec4<f32>,
  occlusion1: vec4<f32>,
};

@group(3) @binding(11) var<uniform> textureTransforms: TextureTransformUniforms;

${TRIANGLE_POSITION_DECODE_WGSL}
${TRIANGLE_RTC_TILE_WGSL}
${TRIANGLE_BILLBOARD_WGSL}

struct VertexInput {
  @location(0) packedPosition: vec4<f32>,
  @location(1) vertexMetadata: vec4<u32>,
  @location(2) uv: vec2<f32>,
  @location(3) material0: vec4<f32>,
  @location(4) material1: vec4<f32>,
  @location(8) material2: vec4<f32>,
  @builtin(vertex_index) vertexIndex: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) clippable: f32,
  @location(2) uv: vec2<f32>,
  @location(3) material1: vec4<f32>,
  @location(4) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let instance = instances[input.vertexMetadata.x];
  let rtcTile = getInstanceRTCTile(instance);
  let localPosition = getPackedOrFrameLocalPosition(input.packedPosition, input.vertexMetadata.y, instance, input.vertexMetadata.z);
  let rtcWorldPos = getMeshRTCWorldPosition(localPosition, instance, frame.viewMatrix);
  var output: VertexOutput;
  output.position = rtcTile.viewProjection * rtcWorldPos;
  output.worldPos = (rtcWorldPos.xyz / rtcWorldPos.w) + rtcTile.center.xyz;
  output.clippable = instance.flags.x;
  output.uv = getStaticOrFrameUV(input.uv, instance, input.vertexMetadata.z);
  output.material1 = input.material1;
  output.color = instance.color;
  return output;
}

fn shadowAlphaHash(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

fn shadowCoverageFromBlendAlpha(alphaInput: f32) -> f32 {
  let alpha = clamp(alphaInput, 0.0, 1.0);
  if (alpha < 0.02) {
    return 0.0;
  }
  return alpha * alpha;
}

fn applyTextureUVTransform(uv: vec2<f32>, row0: vec4<f32>, row1: vec4<f32>) -> vec2<f32> {
  return vec2<f32>(dot(row0.xy, uv) + row0.z, dot(row1.xy, uv) + row1.z);
}

@fragment
fn fs_main(input: VertexOutput) {
  if (input.clippable > 0.5) {
    for (var i = 0u; i < 8u; i = i + 1u) {
      if (i >= u32(frame.sectionPlaneState.x)) {
        break;
      }
      let plane = frame.sectionPlanes[i];
      if (dot(plane.xyz, input.worldPos) + plane.w > 0.0) {
        discard;
      }
    }
  }
  let colorUV = applyTextureUVTransform(input.uv, textureTransforms.color0, textureTransforms.color1);
  var baseColorSample = vec4<f32>(1.0);
  if (frame.materialParams.x > 0.5) {
    baseColorSample = textureSampleLevel(colorTexture, colorSampler, fract(colorUV), 0.0);
  }
  let sampledAlpha = input.color.a * baseColorSample.a;
  if (input.material1.y > 0.5 && input.material1.y < 1.5 && sampledAlpha < input.material1.z) {
    discard;
  }
  if (input.material1.y > 1.5 && sampledAlpha < 0.999) {
    let shadowCoverage = shadowCoverageFromBlendAlpha(sampledAlpha);
    if (shadowCoverage <= 0.0 || shadowAlphaHash(input.position.xy) > shadowCoverage) {
      discard;
    }
  }
}
`;
