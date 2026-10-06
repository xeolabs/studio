import {TRIANGLE_BILLBOARD_WGSL, TRIANGLE_POSITION_DECODE_WGSL, TRIANGLE_RTC_TILE_WGSL} from "./TrianglePositionPacking";

/**
 * WGSL shader shared by the first WebGPU snap draw techniques.
 *
 * The shader projects transformed mesh vertices and emits a packed mesh-slot
 * payload for snap readback.
 *
 * @internal
 */
export const TRIANGLES_SNAP_SHADER = `
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
  @location(0) color: vec4<f32>,
  @location(1) worldPos: vec3<f32>,
  @location(2) clippable: f32,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let instance = instances[input.vertexMetadata.x];
  let rtcTile = getInstanceRTCTile(instance);
  let snapId = input.vertexMetadata.x + 1u;
  let localPosition = getPackedOrFrameLocalPosition(input.packedPosition, input.vertexMetadata.y, instance, input.vertexMetadata.z);
  let rtcWorldPos = getMeshRTCWorldPosition(localPosition, instance, frame.viewMatrix);
  var output: VertexOutput;
  output.position = rtcTile.viewProjection * rtcWorldPos;
  output.color = vec4<f32>(
    f32(snapId & 255u) / 255.0,
    f32((snapId >> 8u) & 255u) / 255.0,
    f32((snapId >> 16u) & 255u) / 255.0,
    f32((snapId >> 24u) & 255u) / 255.0
  );
  output.worldPos = (rtcWorldPos.xyz / rtcWorldPos.w) + rtcTile.center.xyz;
  output.clippable = instance.flags.x;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
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
  return input.color;
}
`;
