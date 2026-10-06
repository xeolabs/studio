/**
 * Shared packed-position contract for WebGPU triangle techniques.
 *
 * Positions are uploaded as unorm16x4 and decoded in the vertex shader with a
 * segment-local min/extent uniform. CPU-side decoded float positions remain in
 * RendererGeometry for picking and snapping math.
 *
 * @internal
 */
export const TRIANGLE_POSITION_DECODE_UNIFORM_FLOATS = 8;

/**
 * @internal
 */
export const TRIANGLE_POSITION_DECODE_UNIFORM_BYTES = TRIANGLE_POSITION_DECODE_UNIFORM_FLOATS * 4;

/**
 * @internal
 */
export const PACKED_TRIANGLE_POSITION_VERTEX_BUFFER_LAYOUTS = [
  {
    arrayStride: 8,
    attributes: [{
      shaderLocation: 0,
      offset: 0,
      format: "unorm16x4"
    }]
  },
  {
    arrayStride: 16,
    attributes: [{
      shaderLocation: 1,
      offset: 0,
      format: "uint32x4"
    }]
  }
];

/**
 * @internal
 */
export const TRIANGLE_POSITION_DECODE_WGSL = `
struct PositionDecode {
  min: vec4<f32>,
  extent: vec4<f32>,
};

@group(2) @binding(0) var<storage, read> positionDecodes: array<PositionDecode>;
@group(2) @binding(12) var<storage, read> framePositions: array<vec2<u32>>;
@group(2) @binding(13) var<storage, read> framePositionDecodes: array<PositionDecode>;
@group(2) @binding(14) var<storage, read> frameNormals: array<u32>;
@group(2) @binding(15) var<storage, read> frameUVs: array<vec2<f32>>;

fn decodePackedPosition(packedPosition: vec4<f32>, decodeIndex: u32) -> vec3<f32> {
  let positionDecode = positionDecodes[decodeIndex];
  return positionDecode.min.xyz + packedPosition.xyz * positionDecode.extent.xyz;
}

fn unpackFramePosition(packedPosition: vec2<u32>, decodeIndex: u32) -> vec3<f32> {
  let compressed = vec3<f32>(
    f32(packedPosition.x & 0xffffu),
    f32((packedPosition.x >> 16u) & 0xffffu),
    f32(packedPosition.y & 0xffffu)
  );
  let positionDecode = framePositionDecodes[decodeIndex];
  return positionDecode.min.xyz + compressed * positionDecode.extent.xyz;
}

fn getFrameLocalPosition(localVertexIndex: u32, instance: MeshInstance) -> vec3<f32> {
  let indexA = u32(i32(instance.frame0.x) + i32(localVertexIndex));
  let indexB = u32(i32(instance.frame0.y) + i32(localVertexIndex));
  let positionA = unpackFramePosition(framePositions[indexA], u32(instance.frame1.x));
  let positionB = unpackFramePosition(framePositions[indexB], u32(instance.frame1.y));
  return mix(positionA, positionB, instance.frame0.z);
}

fn getFrameFlags(instance: MeshInstance) -> u32 {
  return u32(instance.frame0.w + 0.5);
}

fn hasFramePositions(instance: MeshInstance) -> bool {
  return (getFrameFlags(instance) & 1u) != 0u;
}

fn hasFrameNormals(instance: MeshInstance) -> bool {
  return (getFrameFlags(instance) & 2u) != 0u;
}

fn hasFrameUVs(instance: MeshInstance) -> bool {
  return (getFrameFlags(instance) & 4u) != 0u;
}

fn getPackedOrFrameLocalPosition(packedPosition: vec4<f32>, decodeIndex: u32, instance: MeshInstance, localVertexIndex: u32) -> vec3<f32> {
  if (!hasFramePositions(instance)) {
    return decodePackedPosition(packedPosition, decodeIndex);
  }
  return getFrameLocalPosition(localVertexIndex, instance);
}

fn octDecodeFrameNormal(packedNormal: u32) -> vec3<f32> {
  let x = f32(packedNormal & 0xffffu) / 65535.0 * 2.0 - 1.0;
  let y = f32((packedNormal >> 16u) & 0xffffu) / 65535.0 * 2.0 - 1.0;
  var normal = vec3<f32>(x, y, 1.0 - abs(x) - abs(y));
  if (normal.z < 0.0) {
    let oldX = normal.x;
    normal.x = (1.0 - abs(normal.y)) * select(-1.0, 1.0, oldX >= 0.0);
    normal.y = (1.0 - abs(oldX)) * select(-1.0, 1.0, normal.y >= 0.0);
  }
  return normalize(normal);
}

fn getTriangleLocalNormal(baseNormal: vec3<f32>, instance: MeshInstance, localVertexIndex: u32) -> vec3<f32> {
  if (!hasFrameNormals(instance)) {
    return baseNormal;
  }
  let indexA = u32(i32(instance.frame1.z) + i32(localVertexIndex));
  let indexB = u32(i32(instance.frame1.w) + i32(localVertexIndex));
  return normalize(mix(
    octDecodeFrameNormal(frameNormals[indexA]),
    octDecodeFrameNormal(frameNormals[indexB]),
    instance.frame0.z
  ));
}

fn getStaticOrFrameUV(staticUV: vec2<f32>, instance: MeshInstance, localVertexIndex: u32) -> vec2<f32> {
  if (!hasFrameUVs(instance)) {
    return staticUV;
  }
  let indexA = u32(i32(instance.frame0.x) + i32(localVertexIndex));
  let indexB = u32(i32(instance.frame0.y) + i32(localVertexIndex));
  return mix(frameUVs[indexA], frameUVs[indexB], instance.frame0.z);
}
`;

/**
 * Shared RTC tile contract for WebGPU triangle techniques.
 *
 * Mesh instance matrices are uploaded relative to a dynamically assigned RTC
 * tile. The tile index is stored in MeshInstance.flags.y.
 *
 * @internal
 */
export const TRIANGLE_RTC_TILE_WGSL = `
struct RTCTile {
  viewProjection: mat4x4<f32>,
  center: vec4<f32>,
};

@group(0) @binding(1) var<storage, read> rtcTiles: array<RTCTile>;

fn getInstanceRTCTile(instance: MeshInstance) -> RTCTile {
  return rtcTiles[u32(instance.flags.y)];
}
`;

/**
 * Shared spherical billboard transform for WebGPU mesh techniques.
 *
 * Mesh instance matrices are already uploaded relative to their RTC tile. For
 * billboard meshes, the matrix translation remains the anchor and local vertex
 * offsets are rotated onto the camera right/up/back axes while preserving the
 * scale embedded in the mesh matrix.
 *
 * @internal
 */
export const TRIANGLE_BILLBOARD_WGSL = `
fn getMeshScale(modelMatrix: mat4x4<f32>) -> vec3<f32> {
  return vec3<f32>(
    length(modelMatrix[0].xyz),
    length(modelMatrix[1].xyz),
    length(modelMatrix[2].xyz)
  );
}

fn getCameraRightWorld(viewMatrix: mat4x4<f32>) -> vec3<f32> {
  return normalize(vec3<f32>(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
}

fn getCameraUpWorld(viewMatrix: mat4x4<f32>) -> vec3<f32> {
  return normalize(vec3<f32>(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
}

fn getCameraBackWorld(viewMatrix: mat4x4<f32>) -> vec3<f32> {
  return normalize(vec3<f32>(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
}

fn getMeshRTCWorldPosition(modelPos: vec3<f32>, instance: MeshInstance, viewMatrix: mat4x4<f32>) -> vec4<f32> {
  if (instance.flags.z > 0.5) {
    let scale = getMeshScale(instance.modelMatrix);
    let centerWorld = instance.modelMatrix[3].xyz;
    let rtcWorldPos =
      centerWorld +
      getCameraRightWorld(viewMatrix) * modelPos.x * scale.x +
      getCameraUpWorld(viewMatrix)    * modelPos.y * scale.y +
      getCameraBackWorld(viewMatrix)  * modelPos.z * scale.z;
    return vec4<f32>(rtcWorldPos, 1.0);
  }
  return instance.modelMatrix * vec4<f32>(modelPos, 1.0);
}

fn getMeshWorldNormal(modelNormal: vec3<f32>, instance: MeshInstance, viewMatrix: mat4x4<f32>) -> vec3<f32> {
  if (instance.flags.z > 0.5) {
    return normalize(
      getCameraRightWorld(viewMatrix) * modelNormal.x +
      getCameraUpWorld(viewMatrix)    * modelNormal.y +
      getCameraBackWorld(viewMatrix)  * modelNormal.z
    );
  }
  return normalize(vec3<f32>(
    dot(instance.normalMatrix0.xyz, modelNormal),
    dot(instance.normalMatrix1.xyz, modelNormal),
    dot(instance.normalMatrix2.xyz, modelNormal)
  ));
}
`;
