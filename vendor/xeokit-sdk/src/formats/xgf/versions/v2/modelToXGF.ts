import {
  ClampToEdgeWrapping,
  GaussianSplatsPrimitive,
  GIFMediaType,
  JPEGMediaType,
  LinearFilter,
  LinearMipMapLinearFilter,
  LinearMipMapNearestFilter,
  LinesPrimitive,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipMapLinearFilter,
  NearestMipMapNearestFilter,
  PNGMediaType,
  PointsPrimitive,
  RepeatWrapping,
  SolidPrimitive,
  SurfacePrimitive,
  TrianglesPrimitive
} from "../../../../base/constants";
import {createMat4Float64, isIdentityMat4} from "../../../../base/math/matrix";
import type {SceneModel} from "../../../../model/scene";
import type {XGFData_v2} from "./XGFData_v2";
import {createCoordinateSystemTransform, getMeshWorldMatrix} from "../../../../model/scene";
import {yieldToHost} from "../../../../base/utils";
import type {LoaderProgress} from "../../../LoaderProgress";
import type {XGFExportV2Options} from "./XGFExportV2Options";
import {DEFAULT_MATERIAL_IOR} from "../../../../model/scene/SceneMaterial";
import type {SceneAnimationParams} from "../../../../model/scene/animation";

const NUM_MATERIAL_ATTRIBUTES = 4;
const NUM_MATERIAL_TEXTURE_REFS = 5;
const NUM_MATERIAL_PBR_BYTES = 8;
const NUM_TEXTURE_SAMPLER_BYTES = 5;
const NO_INDEX = 0xffffffff;

/** Clamp to a byte — matches the renderer's saturating splat-quaternion quantisation. */
const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Compact small-int codes used by the v2 file for sampler params. */
const SAMPLER_CODE: Record<number, number> = {
  [RepeatWrapping]: 1,
  [ClampToEdgeWrapping]: 2,
  [MirroredRepeatWrapping]: 3,
  [NearestFilter]: 4,
  [LinearFilter]: 5,
  [NearestMipMapNearestFilter]: 6,
  [LinearMipMapNearestFilter]: 7,
  [NearestMipMapLinearFilter]: 8,
  [LinearMipMapLinearFilter]: 9
};

/** Compact small-int codes for texture media types. */
const MEDIA_TYPE_CODE: Record<number, number> = {
  [PNGMediaType]: 0,
  [JPEGMediaType]: 1,
  [GIFMediaType]: 2
};

const samplerCode = (v?: number): number =>
  (v !== undefined && SAMPLER_CODE[v] !== undefined) ? SAMPLER_CODE[v] : 0;

const normalizeMipmapMinFilter = (minFilter: number | undefined, mipmap: boolean): number => {
  switch (minFilter) {
    case NearestMipMapNearestFilter:
    case NearestMipMapLinearFilter:
      return mipmap ? minFilter : NearestFilter;
    case LinearMipMapNearestFilter:
    case LinearMipMapLinearFilter:
      return mipmap ? minFilter : LinearFilter;
    case NearestFilter:
      return mipmap ? NearestMipMapLinearFilter : NearestFilter;
    case LinearFilter:
      return mipmap ? LinearMipMapLinearFilter : LinearFilter;
    default:
      return mipmap ? LinearMipMapLinearFilter : LinearFilter;
  }
};

/**
 * Encode a SceneModel into the XGF v2 payload.
 *
 * Async because texture re-encoding (canvas → PNG bytes for the
 * `imageData` form) is naturally async via `canvas.toBlob()` /
 * `OffscreenCanvas.convertToBlob()`. Textures backed by `buffers`
 * (already-compressed source) are passed through synchronously.
 *
 * @private
 */
export async function modelToXGF(params: {
  sceneModel: SceneModel;
  options: XGFExportV2Options;
}): Promise<XGFData_v2> {

  const sceneModel = params.sceneModel;
  const options = params.options || {};
  const ignoreNormals = options.ignoreNormals === true;
  const ignoreUVs = options.ignoreUVs === true;
  const assetMode = options.assetMode === "assetLibrary" || options.assetMode === "referencesOnly"
    ? options.assetMode
    : "full";
  const preserveTransforms = options.preserveTransforms !== false && !options.coordinateSystem;

  const onProgress: ((p: LoaderProgress) => void) | undefined = options.onProgress;
  const signal: AbortSignal | undefined = options.signal;
  // Reusable progress payload — see the LoaderProgress
  // contract: copy out fields you need to retain.
  const progress: LoaderProgress = {phase: "", current: 0, total: 0};
  const step = async (phase: string, current: number, total: number): Promise<void> => {
    if (onProgress) {
      progress.phase = phase;
      progress.current = current;
      progress.total = total;
      onProgress(progress);
    }
    await yieldToHost(signal);
  };

  // (Coordinate-system transform is applied through getMeshWorldMatrix
  // below — we don't need to materialise the matrix here.)
  if (options.coordinateSystem) {
    createCoordinateSystemTransform(sceneModel.scene.coordinateSystem, options.coordinateSystem, createMat4Float64());
  }

  const geometriesList = Object.values(sceneModel.geometries);
  const meshesList     = Object.values(sceneModel.meshes);
  const objectsList    = Object.values(sceneModel.objects);
  const texturesList   = Object.values(sceneModel.textures);
  const materialsList  = Object.values(sceneModel.materials);
  const transformsList = Object.values(sceneModel.transforms);
  const variantSetPayload = buildVariantSetPayload(sceneModel, assetMode, new Set(objectsList.map((object: any) => object.id)));
  const animationParamsJson = assetMode === "assetLibrary"
    ? []
    : collectAnimationParamsJson(sceneModel, {
      includeTransformTargets: preserveTransforms,
      includeMeshTargets: true
    });
  const hasAnimations = animationParamsJson.length > 0;
  const preserveMeshIds = hasAnimations || options.preserveMeshIds === true;

  const numGeometries = geometriesList.length;
  const numMeshes     = meshesList.length;
  const numObjects    = objectsList.length;
  const numTextures   = texturesList.length;
  const numMaterials  = materialsList.length;

  // ── Pass 1: size geometry payload ──────────────────────────────────
  let sizePositions = 0;
  let sizeColors = 0;
  let sizeIndices = 0;
  let sizeEdgeIndices = 0;
  let maxIndex = 0;
  let maxEdgeIndex = 0;
  let sizeNormals = 0;
  let sizeUVs = 0;
  let sizeExtraTexCoords = 0;
  let sizeExtraTexCoordRecords = 0;
  let sizeScales = 0;
  let sizeRotations = 0;
  let sizeFramePositions = 0;
  let sizeFrameNormals = 0;
  let sizeFrames = 0;
  let sizeVertexStates = 0;
  let sizeMorphTargetPositions = 0;
  let sizeMorphTargetNormals = 0;
  let sizeMorphTargetUVs = 0;
  let sizeMorphTargets = 0;
  let sizeMorphWeights = 0;

  for (const geometry of geometriesList) {
    if (!geometry || !geometry.positionsCompressed) continue;
    sizePositions   += geometry.positionsCompressed.length;
    if (geometry.indices) {
      sizeIndices += geometry.indices.length;
      maxIndex = Math.max(maxIndex, maxArrayValue(geometry.indices));
    }
    if (geometry.edgeIndices) {
      sizeEdgeIndices += geometry.edgeIndices.length;
      maxEdgeIndex = Math.max(maxEdgeIndex, maxArrayValue(geometry.edgeIndices));
    }
    if (geometry.colorsCompressed) sizeColors      += geometry.colorsCompressed.length;
    if (!ignoreNormals && geometry.normalsCompressed) sizeNormals += geometry.normalsCompressed.length;
    if (!ignoreUVs && geometry.uvsCompressed) sizeUVs += geometry.uvsCompressed.length;
    if (!ignoreUVs && geometry.texCoordsCompressed) {
      for (const key of Object.keys(geometry.texCoordsCompressed)) {
        const channel = Number(key);
        if (channel > 0 && geometry.texCoordsCompressed[channel]) {
          sizeExtraTexCoords += geometry.texCoordsCompressed[channel].length;
          sizeExtraTexCoordRecords++;
        }
      }
    }
    if (geometry.scales)           sizeScales      += geometry.scales.length;
    if (geometry.rotations)        sizeRotations   += geometry.rotations.length;
    if (geometry.framesCompressed && geometry.framesCompressed.length > 0) {
      for (const frame of geometry.framesCompressed) {
        sizeFramePositions += frame.positionsCompressed.length;
        if (!ignoreNormals && frame.normalsCompressed) {
          sizeFrameNormals += frame.normalsCompressed.length;
        }
        sizeFrames++;
      }
    } else if (geometry.vertexStatesCompressed && geometry.vertexStatesCompressed.length > 0) {
      for (const state of geometry.vertexStatesCompressed) {
        sizeFramePositions += state.positionsCompressed.length;
        if (!ignoreNormals && state.normalsCompressed) {
          sizeFrameNormals += state.normalsCompressed.length;
        }
        sizeVertexStates++;
      }
    }
    if (geometry.morphTargets && geometry.morphTargets.length > 0) {
      for (const target of geometry.morphTargets) {
        if (target.positions) sizeMorphTargetPositions += target.positions.length;
        if (!ignoreNormals && target.normals) sizeMorphTargetNormals += target.normals.length;
        if (!ignoreUVs && target.uvs) sizeMorphTargetUVs += target.uvs.length;
        sizeMorphTargets++;
      }
    }
  }

  for (const object of objectsList) {
    for (const mesh of object.meshes) {
      if (mesh.geometry?.morphTargets?.length) {
        sizeMorphWeights += mesh.morphWeights.length;
      }
    }
  }

  // ── Pass 2: encode textures ────────────────────────────────────────
  // For each texture, prefer pre-existing compressed `buffers` (KTX2 /
  // already-encoded JPG/PNG). When only an `imageData` is available
  // (e.g. an HTMLImageElement loaded by GLTFLoader), re-encode it to
  // PNG bytes via canvas. Skipped textures get a zero-byte slot.
  const textureBytes: Uint8Array<any>[] = [];
  const textureMediaTypes: number[] = [];
  const textureWidths: number[] = [];
  const textureHeights: number[] = [];
  const textureSamplers: number[] = [];
  const textureEncodings: number[] = [];
  const textureIds: string[] = [];
  const textureIndexById: Record<string, number> = {};

  for (let i = 0; i < numTextures; i++) {
    if ((i & 0x03) === 0) await step("Encoding textures", i, numTextures);
    const tex = texturesList[i];
    textureIds.push(tex.id);
    textureIndexById[tex.id] = i;
    let bytes: Uint8Array<any> | null = null;
    let mediaCode = 255;
    if (tex.buffers && tex.buffers.length > 0 && tex.buffers[0]) {
      bytes = new Uint8Array(tex.buffers[0]);
      // Compressed buffers are typically KTX2/Basis — opaque (255).
      mediaCode = (tex.mediaType !== undefined && MEDIA_TYPE_CODE[tex.mediaType] !== undefined)
        ? MEDIA_TYPE_CODE[tex.mediaType]
        : 255;
    } else if (tex.imageData && tex.imageData.width && tex.imageData.height) {
      bytes = await encodeImageToPNG(tex.imageData);
      mediaCode = MEDIA_TYPE_CODE[PNGMediaType];
    } else if (tex.image && (tex.image as any).width && (tex.image as any).height) {
      // Decoded image source (e.g. an ImageBitmap from GLTFLoader, which
      // populates `image` rather than `imageData`/`buffers`). encodeImageToPNG
      // draws it to a canvas and re-encodes to PNG.
      bytes = await encodeImageToPNG(tex.image);
      mediaCode = MEDIA_TYPE_CODE[PNGMediaType];
    }
    if (!bytes) {
      console.warn(`[xgf] Texture '${tex.id}' has no buffers, imageData or image — encoded as empty`);
      bytes = new Uint8Array(0);
    }
    textureBytes.push(bytes);
    textureMediaTypes.push(mediaCode);
    textureWidths.push(tex.width || (tex.imageData?.width ?? (tex.image as any)?.width ?? 0));
    textureHeights.push(tex.height || (tex.imageData?.height ?? (tex.image as any)?.height ?? 0));
    textureSamplers.push(
      samplerCode(normalizeMipmapMinFilter(tex.minFilter, tex.mipmap)),
      samplerCode(tex.magFilter),
      samplerCode(tex.wrapS),
      samplerCode(tex.wrapT),
      samplerCode(tex.wrapR)
    );
    // Colour-space encoding (sRGB vs linear). Without this the colour/albedo
    // map — created as sRGB — reloads as linear and renders washed out.
    textureEncodings.push(tex.encoding);
  }

  let textureDataSize = 0;
  for (const b of textureBytes) textureDataSize += b.length;
  const textureData = new Uint8Array(textureDataSize);
  const eachTextureDataBase = new Uint32Array(numTextures);
  {
    let cursor = 0;
    for (let i = 0; i < numTextures; i++) {
      eachTextureDataBase[i] = cursor;
      textureData.set(textureBytes[i], cursor);
      cursor += textureBytes[i].length;
    }
  }

  // ── Pass 3: encode materials ───────────────────────────────────────
  const materialIndexById: Record<string, number> = {};
  const eachMaterialPBR = new Uint8Array(numMaterials * NUM_MATERIAL_PBR_BYTES);
  // Full-precision RGB colour factor. Kept as float (not the u8 in
  // eachMaterialPBR) because SceneMaterial.color is an unclamped multiplier that
  // commonly exceeds 1.0 (e.g. a perceptual brightness boost); u8 would clamp
  // those to 1.0 and render the material washed out on reload.
  const eachMaterialColor = new Float32Array(numMaterials * 3);
  const eachMaterialTextures = new Int32Array(numMaterials * NUM_MATERIAL_TEXTURE_REFS);
  const hasMaterialTextureBindingState = materialsList.some(hasNonDefaultTextureBindingState);
  const eachMaterialTextureTexCoord = hasMaterialTextureBindingState ? new Uint16Array(numMaterials * NUM_MATERIAL_TEXTURE_REFS) : new Uint16Array(0);
  const eachMaterialTextureTransforms = hasMaterialTextureBindingState ? new Float32Array(numMaterials * NUM_MATERIAL_TEXTURE_REFS * 6) : new Float32Array(0);
  const eachMaterialTriplanarScale = new Float32Array(numMaterials);
  const hasOpticalMaterials = materialsList.some(hasNonNeutralOpticalMaterial);
  const eachMaterialOptical = hasOpticalMaterials ? new Float32Array(numMaterials * 6) : new Float32Array(0);
  const hasIorMaterials = materialsList.some(hasNonDefaultIorMaterial);
  const eachMaterialIor = hasIorMaterials ? new Float32Array(numMaterials) : new Float32Array(0);
  const eachMaterialId: string[] = [];
  for (let i = 0; i < numMaterials; i++) {
    if ((i & 0x3F) === 0) await step("Encoding materials", i, numMaterials);
    const mat = materialsList[i];
    materialIndexById[mat.id] = i;
    eachMaterialId.push(mat.id);
    const base = i * NUM_MATERIAL_PBR_BYTES;
    eachMaterialColor[i * 3]     = mat.color[0];
    eachMaterialColor[i * 3 + 1] = mat.color[1];
    eachMaterialColor[i * 3 + 2] = mat.color[2];
    eachMaterialPBR[base]     = clampU8(mat.color[0] * 255);
    eachMaterialPBR[base + 1] = clampU8(mat.color[1] * 255);
    eachMaterialPBR[base + 2] = clampU8(mat.color[2] * 255);
    eachMaterialPBR[base + 3] = clampU8(mat.opacity * 255);
    eachMaterialPBR[base + 4] = clampU8(mat.roughness * 255);
    eachMaterialPBR[base + 5] = clampU8(mat.metallic * 255);
    eachMaterialPBR[base + 6] = clampU8(mat.alphaMode);
    eachMaterialPBR[base + 7] = clampU8(mat.alphaCutoff * 255);
    const tBase = i * NUM_MATERIAL_TEXTURE_REFS;
    eachMaterialTextures[tBase]     = textureIndexOrNone(mat.colorTexture?.id, textureIndexById);
    eachMaterialTextures[tBase + 1] = textureIndexOrNone(mat.metallicRoughnessTexture?.id, textureIndexById);
    eachMaterialTextures[tBase + 2] = textureIndexOrNone(mat.normalsTexture?.id, textureIndexById);
    eachMaterialTextures[tBase + 3] = textureIndexOrNone(mat.occlusionTexture?.id, textureIndexById);
    eachMaterialTextures[tBase + 4] = textureIndexOrNone(mat.emissiveTexture?.id, textureIndexById);
    if (hasMaterialTextureBindingState) {
      writeTextureBindingState(eachMaterialTextureTexCoord, eachMaterialTextureTransforms, tBase, 0, mat.colorTextureTexCoord, mat.colorTextureUVTransform);
      writeTextureBindingState(eachMaterialTextureTexCoord, eachMaterialTextureTransforms, tBase, 1, mat.metallicRoughnessTextureTexCoord, mat.metallicRoughnessTextureUVTransform);
      writeTextureBindingState(eachMaterialTextureTexCoord, eachMaterialTextureTransforms, tBase, 2, mat.normalsTextureTexCoord, mat.normalsTextureUVTransform);
      writeTextureBindingState(eachMaterialTextureTexCoord, eachMaterialTextureTransforms, tBase, 3, mat.occlusionTextureTexCoord, mat.occlusionTextureUVTransform);
      writeTextureBindingState(eachMaterialTextureTexCoord, eachMaterialTextureTransforms, tBase, 4, mat.emissiveTextureTexCoord, mat.emissiveTextureUVTransform);
    }
    eachMaterialTriplanarScale[i] = mat.triplanarScale;
    if (hasOpticalMaterials) {
      const oBase = i * 6;
      eachMaterialOptical[oBase] = mat.transmission;
      eachMaterialOptical[oBase + 1] = mat.thickness;
      eachMaterialOptical[oBase + 2] = mat.attenuationColor[0];
      eachMaterialOptical[oBase + 3] = mat.attenuationColor[1];
      eachMaterialOptical[oBase + 4] = mat.attenuationColor[2];
      eachMaterialOptical[oBase + 5] = Number.isFinite(mat.attenuationDistance) ? mat.attenuationDistance : 0;
    }
    if (hasIorMaterials) {
      eachMaterialIor[i] = Number.isFinite(mat.ior) ? mat.ior : DEFAULT_MATERIAL_IOR;
    }
  }

  // ── Pass 4: pack geometry payload ──────────────────────────────────
  const sizeDeformationStates = sizeFrames + sizeVertexStates;
  const xgfData: XGFData_v2 = {
    positions: new Uint16Array(sizePositions),
    colors: new Uint8Array(sizeColors),
    indexSize: new Uint8Array([maxIndex <= 0xffff ? 2 : 4]),
    indices: maxIndex <= 0xffff ? new Uint16Array(sizeIndices) : new Uint32Array(sizeIndices),
    edgeIndexSize: new Uint8Array([maxEdgeIndex <= 0xffff ? 2 : 4]),
    edgeIndices: maxEdgeIndex <= 0xffff ? new Uint16Array(sizeEdgeIndices) : new Uint32Array(sizeEdgeIndices),
    aabbs: new Float32Array(0), // populated below
    normals: new Uint16Array(sizeNormals),
    uvs: new Float32Array(sizeUVs),
    extraTexCoords: new Float32Array(sizeExtraTexCoords),
    scales: new Float32Array(sizeScales),
    rotations: new Uint8Array(sizeRotations),
    eachGeometryPositionsBase: new Uint32Array(numGeometries),
    eachGeometryColorsBase: new Uint32Array(numGeometries),
    eachGeometryIndicesBase: new Uint32Array(numGeometries),
    eachGeometryEdgeIndicesBase: new Uint32Array(numGeometries),
    eachGeometryNormalsBase: new Uint32Array(numGeometries),
    eachGeometryUVsBase: new Uint32Array(numGeometries),
    eachGeometryExtraTexCoord: new Uint32Array(sizeExtraTexCoordRecords * 3),
    eachGeometryScalesBase: new Uint32Array(numGeometries),
    eachGeometryRotationsBase: new Uint32Array(numGeometries),
    eachGeometryPrimitiveType: new Uint8Array(numGeometries),
    eachGeometryAABBBase: new Uint32Array(numGeometries),
    matrices: new Float64Array(0), // populated below
    textureData,
    eachTextureDataBase,
    eachTextureMediaType: new Uint8Array(textureMediaTypes),
    eachTextureWidth: new Uint16Array(textureWidths),
    eachTextureHeight: new Uint16Array(textureHeights),
    eachTextureSampler: new Uint8Array(textureSamplers),
    eachTextureEncoding: new Uint16Array(textureEncodings),
    eachTextureId: textureIds,
    eachMaterialPBR,
    eachMaterialColor,
    eachMaterialTextures,
    eachMaterialTextureTexCoord,
    eachMaterialTextureTransforms,
    eachMaterialId,
    eachMaterialTriplanarScale,
    eachMaterialOptical,
    eachMaterialIor,
    eachMeshGeometriesBase: new Uint32Array(numMeshes),
    eachMeshMatricesBase: new Uint32Array(numMeshes),
    eachMeshMaterialAttributes: new Uint8Array(numMeshes * NUM_MATERIAL_ATTRIBUTES),
    eachMeshMaterial: new Int32Array(numMeshes),
    eachObjectId: [],
    eachObjectMeshesBase: new Uint32Array(numObjects),
    eachGeometryId: geometriesList.map((geometry: any) => geometry.id),
    eachMeshGeometryId: new Array(numMeshes),
    eachMeshMaterialId: new Array(numMeshes),
    eachMeshId: preserveMeshIds
      ? new Array(numMeshes)
      : [],
    eachTransformId: preserveTransforms
      ? transformsList.map((transform: any) => transform.id)
      : [],
    eachTransformParentId: preserveTransforms
      ? transformsList.map((transform: any) => transform.parentTransform?.id || "")
      : [],
    eachTransformMatricesBase: preserveTransforms
      ? new Uint32Array(transformsList.length)
      : new Uint32Array(0),
    eachMeshParentTransformId: preserveTransforms
      ? new Array(numMeshes)
      : [],
    eachVariantSetId: variantSetPayload.eachVariantSetId,
    eachVariantSetDefaultVariantId: variantSetPayload.eachVariantSetDefaultVariantId,
    eachVariantSetSelectionStrategy: variantSetPayload.eachVariantSetSelectionStrategy,
    eachVariantSetHysteresisPixels: variantSetPayload.eachVariantSetHysteresisPixels,
    eachVariantSetVariantsBase: variantSetPayload.eachVariantSetVariantsBase,
    eachVariantId: variantSetPayload.eachVariantId,
    eachVariantRangeMinPixels: variantSetPayload.eachVariantRangeMinPixels,
    eachVariantRangeMaxPixels: variantSetPayload.eachVariantRangeMaxPixels,
    eachVariantObjectIdsBase: variantSetPayload.eachVariantObjectIdsBase,
    variantObjectIds: variantSetPayload.variantObjectIds,
    framePositions: new Uint16Array(sizeFramePositions),
    frameNormals: new Uint16Array(sizeFrameNormals),
    frameAABBs: new Float32Array(sizeDeformationStates * 6),
    frameTimes: new Float32Array(sizeDeformationStates),
    eachGeometryFramesBase: new Uint32Array(numGeometries),
    eachGeometryFramesCount: new Uint32Array(numGeometries),
    eachGeometryVertexStatesBase: new Uint32Array(numGeometries),
    eachGeometryVertexStatesCount: new Uint32Array(numGeometries),
    eachFramePositionsBase: new Uint32Array(sizeDeformationStates),
    eachFrameNormalsBase: new Uint32Array(sizeDeformationStates),
    eachFrameAABBBase: new Uint32Array(sizeDeformationStates),
    eachMeshFrameTime: new Float32Array(numMeshes),
    morphTargetPositions: new Float32Array(sizeMorphTargetPositions),
    morphTargetNormals: new Float32Array(sizeMorphTargetNormals),
    morphTargetUVs: new Float32Array(sizeMorphTargetUVs),
    eachGeometryMorphTargetsBase: new Uint32Array(numGeometries),
    eachMorphTargetPositionsBase: new Uint32Array(sizeMorphTargets),
    eachMorphTargetNormalsBase: new Uint32Array(sizeMorphTargets),
    eachMorphTargetUVsBase: new Uint32Array(sizeMorphTargets).fill(NO_INDEX),
    eachMorphTargetId: new Array(sizeMorphTargets),
    eachMorphTargetName: new Array(sizeMorphTargets),
    morphWeights: new Float32Array(sizeMorphWeights),
    eachMeshMorphWeightsBase: new Uint32Array(numMeshes),
    animationParamsJson
  };

  let positionsBase = 0;
  let colorsBase = 0;
  let indicesBase = 0;
  let edgeIndicesBase = 0;
  let normalsBase = 0;
  let uvsBase = 0;
  let extraTexCoordsBase = 0;
  let extraTexCoordRecordBase = 0;
  let scalesBase = 0;
  let rotationsBase = 0;
  let framePositionsBase = 0;
  let frameNormalsBase = 0;
  let frameAABBsBase = 0;
  let framesBase = 0;
  let morphTargetPositionsBase = 0;
  let morphTargetNormalsBase = 0;
  let morphTargetUVsBase = 0;
  let morphTargetsBase = 0;
  let morphWeightsBase = 0;
  let aabbsBase = 0;

  const aabbIdxMap: Record<string, number> = {};
  const aabbs: number[] = [];
  const matrices: number[] = [];
  const geometryIndices: Record<string, number> = {};

  for (let geometryIdx = 0; geometryIdx < numGeometries; geometryIdx++) {
    const geometry = geometriesList[geometryIdx];
    let primitiveType = 0;
    switch (geometry.primitive) {
      case TrianglesPrimitive: primitiveType = 0; break;
      case SolidPrimitive:     primitiveType = 1; break;
      case SurfacePrimitive:   primitiveType = 2; break;
      case LinesPrimitive:     primitiveType = 3; break;
      case PointsPrimitive:    primitiveType = 4; break;
      case GaussianSplatsPrimitive: primitiveType = 5; break;
    }
    xgfData.eachGeometryPrimitiveType[geometryIdx] = primitiveType;

    const aabb = geometry.aabb;
    const aabbHash = `${aabb[0]}-${aabb[1]}-${aabb[2]}-${aabb[3]}-${aabb[4]}-${aabb[5]}`;
    let aabbIdx = aabbIdxMap[aabbHash];
    if (aabbIdx === undefined) {
      aabbIdx = aabbsBase;
      aabbIdxMap[aabbHash] = aabbIdx;
      aabbs.push(...aabb);
      aabbsBase += 6;
    }
    xgfData.eachGeometryAABBBase[geometryIdx] = aabbIdx;

    xgfData.eachGeometryPositionsBase[geometryIdx] = positionsBase;
    xgfData.positions.set(geometry.positionsCompressed, positionsBase);
    positionsBase += geometry.positionsCompressed.length;

    xgfData.eachGeometryColorsBase[geometryIdx] = colorsBase;
    if (geometry.colorsCompressed) {
      xgfData.colors.set(geometry.colorsCompressed, colorsBase);
      colorsBase += geometry.colorsCompressed.length;
    }

    xgfData.eachGeometryIndicesBase[geometryIdx] = indicesBase;
    if (geometry.indices) {
      xgfData.indices.set(geometry.indices, indicesBase);
      indicesBase += geometry.indices.length;
    }

    xgfData.eachGeometryEdgeIndicesBase[geometryIdx] = edgeIndicesBase;
    if (geometry.edgeIndices) {
      xgfData.edgeIndices.set(geometry.edgeIndices, edgeIndicesBase);
      edgeIndicesBase += geometry.edgeIndices.length;
    }

    if (!ignoreNormals && geometry.normalsCompressed) {
      xgfData.eachGeometryNormalsBase[geometryIdx] = normalsBase;
      xgfData.normals.set(geometry.normalsCompressed, normalsBase);
      normalsBase += geometry.normalsCompressed.length;
    } else {
      xgfData.eachGeometryNormalsBase[geometryIdx] = NO_INDEX;
    }

    if (!ignoreUVs && geometry.uvsCompressed) {
      xgfData.eachGeometryUVsBase[geometryIdx] = uvsBase;
      xgfData.uvs.set(geometry.uvsCompressed, uvsBase);
      uvsBase += geometry.uvsCompressed.length;
    } else {
      xgfData.eachGeometryUVsBase[geometryIdx] = NO_INDEX;
    }
    if (!ignoreUVs && geometry.texCoordsCompressed) {
      for (const key of Object.keys(geometry.texCoordsCompressed)) {
        const channel = Number(key);
        const texCoords = geometry.texCoordsCompressed[channel];
        if (channel <= 0 || !texCoords) {
          continue;
        }
        xgfData.eachGeometryExtraTexCoord[extraTexCoordRecordBase] = geometryIdx;
        xgfData.eachGeometryExtraTexCoord[extraTexCoordRecordBase + 1] = channel;
        xgfData.eachGeometryExtraTexCoord[extraTexCoordRecordBase + 2] = extraTexCoordsBase;
        xgfData.extraTexCoords.set(texCoords, extraTexCoordsBase);
        extraTexCoordsBase += texCoords.length;
        extraTexCoordRecordBase += 3;
      }
    }

    // Gaussian-splat geometries carry per-splat scales (float xyz) and rotation
    // quaternions (float xyzw, quantised to bytes here, the .splat convention).
    if (geometry.scales && geometry.rotations) {
      xgfData.eachGeometryScalesBase[geometryIdx] = scalesBase;
      xgfData.scales.set(geometry.scales, scalesBase);
      scalesBase += geometry.scales.length;

      xgfData.eachGeometryRotationsBase[geometryIdx] = rotationsBase;
      const rotations = geometry.rotations;
      for (let i = 0, len = rotations.length; i < len; i++) {
        xgfData.rotations[rotationsBase + i] = clampByte(Math.round(rotations[i] * 128 + 128));
      }
      rotationsBase += rotations.length;
    } else {
      xgfData.eachGeometryScalesBase[geometryIdx] = NO_INDEX;
      xgfData.eachGeometryRotationsBase[geometryIdx] = NO_INDEX;
    }

    if (geometry.framesCompressed && geometry.framesCompressed.length > 0) {
      xgfData.eachGeometryFramesBase[geometryIdx] = framesBase;
      xgfData.eachGeometryFramesCount[geometryIdx] = geometry.framesCompressed.length;
      xgfData.eachGeometryVertexStatesBase[geometryIdx] = NO_INDEX;
      xgfData.eachGeometryVertexStatesCount[geometryIdx] = 0;
      for (const frame of geometry.framesCompressed) {
        xgfData.frameTimes[framesBase] = frame.time;
        xgfData.eachFrameAABBBase[framesBase] = frameAABBsBase;
        xgfData.frameAABBs.set(frame.aabb, frameAABBsBase);
        frameAABBsBase += 6;

        xgfData.eachFramePositionsBase[framesBase] = framePositionsBase;
        xgfData.framePositions.set(frame.positionsCompressed, framePositionsBase);
        framePositionsBase += frame.positionsCompressed.length;

        if (!ignoreNormals && frame.normalsCompressed) {
          xgfData.eachFrameNormalsBase[framesBase] = frameNormalsBase;
          xgfData.frameNormals.set(frame.normalsCompressed, frameNormalsBase);
          frameNormalsBase += frame.normalsCompressed.length;
        } else {
          xgfData.eachFrameNormalsBase[framesBase] = NO_INDEX;
        }
        framesBase++;
      }
    } else {
      xgfData.eachGeometryFramesBase[geometryIdx] = NO_INDEX;
      xgfData.eachGeometryFramesCount[geometryIdx] = 0;
      if (geometry.vertexStatesCompressed && geometry.vertexStatesCompressed.length > 0) {
        xgfData.eachGeometryVertexStatesBase[geometryIdx] = framesBase;
        xgfData.eachGeometryVertexStatesCount[geometryIdx] = geometry.vertexStatesCompressed.length;
        for (const state of geometry.vertexStatesCompressed) {
          xgfData.frameTimes[framesBase] = Number.NaN;
          xgfData.eachFrameAABBBase[framesBase] = frameAABBsBase;
          xgfData.frameAABBs.set(state.aabb, frameAABBsBase);
          frameAABBsBase += 6;

          xgfData.eachFramePositionsBase[framesBase] = framePositionsBase;
          xgfData.framePositions.set(state.positionsCompressed, framePositionsBase);
          framePositionsBase += state.positionsCompressed.length;

          if (!ignoreNormals && state.normalsCompressed) {
            xgfData.eachFrameNormalsBase[framesBase] = frameNormalsBase;
            xgfData.frameNormals.set(state.normalsCompressed, frameNormalsBase);
            frameNormalsBase += state.normalsCompressed.length;
          } else {
            xgfData.eachFrameNormalsBase[framesBase] = NO_INDEX;
          }
          framesBase++;
        }
      } else {
        xgfData.eachGeometryVertexStatesBase[geometryIdx] = NO_INDEX;
        xgfData.eachGeometryVertexStatesCount[geometryIdx] = 0;
      }
    }

    if (geometry.morphTargets && geometry.morphTargets.length > 0) {
      xgfData.eachGeometryMorphTargetsBase[geometryIdx] = morphTargetsBase;
      for (const target of geometry.morphTargets) {
        xgfData.eachMorphTargetId[morphTargetsBase] = target.id || "";
        xgfData.eachMorphTargetName[morphTargetsBase] = target.name || "";
        if (target.positions) {
          xgfData.eachMorphTargetPositionsBase[morphTargetsBase] = morphTargetPositionsBase;
          xgfData.morphTargetPositions.set(target.positions, morphTargetPositionsBase);
          morphTargetPositionsBase += target.positions.length;
        } else {
          xgfData.eachMorphTargetPositionsBase[morphTargetsBase] = NO_INDEX;
        }
        if (!ignoreNormals && target.normals) {
          xgfData.eachMorphTargetNormalsBase[morphTargetsBase] = morphTargetNormalsBase;
          xgfData.morphTargetNormals.set(target.normals, morphTargetNormalsBase);
          morphTargetNormalsBase += target.normals.length;
        } else {
          xgfData.eachMorphTargetNormalsBase[morphTargetsBase] = NO_INDEX;
        }
        if (!ignoreUVs && target.uvs) {
          xgfData.eachMorphTargetUVsBase[morphTargetsBase] = morphTargetUVsBase;
          xgfData.morphTargetUVs.set(target.uvs, morphTargetUVsBase);
          morphTargetUVsBase += target.uvs.length;
        }
        morphTargetsBase++;
      }
    } else {
      xgfData.eachGeometryMorphTargetsBase[geometryIdx] = NO_INDEX;
    }

    geometryIndices[geometry.id] = geometryIdx;
  }

  // ── Pass 5: meshes + objects ───────────────────────────────────────
  let identityMatrixAdded = false;
  let identityMatrixBase = 0;
  let matricesBase = 0;
  let meshesBase = 0;
  let hasInlineMaterialFallback = false;
  for (let objectIdx = 0; objectIdx < numObjects; objectIdx++) {
    if ((objectIdx & 0x1F) === 0) {
      await step("Encoding objects", objectIdx, numObjects);
    }
    const object = objectsList[objectIdx];
    xgfData.eachObjectId[objectIdx] = object.id;
    xgfData.eachObjectMeshesBase[objectIdx] = meshesBase;
    for (let i = 0; i < object.meshes.length; i++) {
      const mesh = object.meshes[i];
      if (preserveMeshIds) {
        xgfData.eachMeshId[meshesBase] = mesh.id;
      }
      xgfData.eachMeshGeometriesBase[meshesBase] = geometryIndices[mesh.geometry.id];
      xgfData.eachMeshGeometryId[meshesBase] = mesh.geometry?.id || "";
      xgfData.eachMeshMaterialId[meshesBase] = mesh.material?.id || "";
      if (preserveTransforms) {
        xgfData.eachMeshParentTransformId[meshesBase] = mesh.parentTransform?.id || "";
      }
      const matrix = preserveTransforms
        ? mesh.matrix
        : getMeshWorldMatrix(mesh, options.coordinateSystem);
      if (isIdentityMat4(matrix)) {
        if (!identityMatrixAdded) {
          matrices.push(...matrix);
          xgfData.eachMeshMatricesBase[meshesBase] = matricesBase;
          identityMatrixBase = matricesBase;
          matricesBase += 16;
          identityMatrixAdded = true;
        } else {
          xgfData.eachMeshMatricesBase[meshesBase] = identityMatrixBase;
        }
      } else {
        matrices.push(...matrix);
        xgfData.eachMeshMatricesBase[meshesBase] = matricesBase;
        matricesBase += 16;
      }
      xgfData.eachMeshMaterial[meshesBase] = mesh.material
        ? (materialIndexById[mesh.material.id] ?? -1)
        : -1;
      xgfData.eachMeshFrameTime[meshesBase] = mesh.frameTime || 0;
      if (mesh.geometry?.morphTargets?.length && mesh.morphWeights.length > 0) {
        xgfData.eachMeshMorphWeightsBase[meshesBase] = morphWeightsBase;
        xgfData.morphWeights.set(mesh.morphWeights, morphWeightsBase);
        morphWeightsBase += mesh.morphWeights.length;
      } else {
        xgfData.eachMeshMorphWeightsBase[meshesBase] = NO_INDEX;
      }
      if (!mesh.material) {
        const colorBase = meshesBase * NUM_MATERIAL_ATTRIBUTES;
        xgfData.eachMeshMaterialAttributes[colorBase] = clampU8(mesh.effectiveColor[0] * 255);
        xgfData.eachMeshMaterialAttributes[colorBase + 1] = clampU8(mesh.effectiveColor[1] * 255);
        xgfData.eachMeshMaterialAttributes[colorBase + 2] = clampU8(mesh.effectiveColor[2] * 255);
        xgfData.eachMeshMaterialAttributes[colorBase + 3] = clampU8(mesh.effectiveOpacity * 255);
        hasInlineMaterialFallback = true;
      }
      meshesBase++;
    }
  }

  if (!hasInlineMaterialFallback) {
    xgfData.eachMeshMaterialAttributes = new Uint8Array(0);
  }

  if (preserveTransforms) {
    for (let i = 0; i < transformsList.length; i++) {
      const transform: any = transformsList[i];
      xgfData.eachTransformMatricesBase[i] = matricesBase;
      matrices.push(...transform.matrix);
      matricesBase += 16;
    }
  }

  xgfData.aabbs    = new Float32Array(aabbs);
  xgfData.matrices = new Float64Array(matrices);

  if (assetMode === "assetLibrary") {
    stripInstances(xgfData);
  } else if (assetMode === "referencesOnly") {
    stripAssets(xgfData);
  } else {
    stripExternalMeshRefs(xgfData);
  }

  // Final emit so the bar reads as 100% before the promise
  // resolves regardless of which loop was last.
  if (onProgress) {
    progress.phase = "Encoding objects";
    progress.current = numObjects;
    progress.total = numObjects;
    onProgress(progress);
  }

  return xgfData;
}

function stripInstances(xgfData: XGFData_v2): void {
  xgfData.matrices = new Float64Array(0);
  xgfData.eachMeshGeometriesBase = new Uint32Array(0);
  xgfData.eachMeshMatricesBase = new Uint32Array(0);
  xgfData.eachMeshMaterialAttributes = new Uint8Array(0);
  xgfData.eachMeshMaterial = new Int32Array(0);
  xgfData.eachMeshFrameTime = new Float32Array(0);
  xgfData.morphWeights = new Float32Array(0);
  xgfData.eachMeshMorphWeightsBase = new Uint32Array(0);
  xgfData.eachMeshGeometryId = [];
  xgfData.eachMeshMaterialId = [];
  xgfData.eachMeshId = [];
  xgfData.animationParamsJson = [];
  xgfData.eachMeshParentTransformId = [];
  xgfData.eachTransformId = [];
  xgfData.eachTransformParentId = [];
  xgfData.eachTransformMatricesBase = new Uint32Array(0);
  xgfData.eachObjectId = [];
  xgfData.eachObjectMeshesBase = new Uint32Array(0);
  clearVariantSets(xgfData);
}

function stripAssets(xgfData: XGFData_v2): void {
  xgfData.morphTargetUVs = new Float32Array(0);
  xgfData.eachMorphTargetUVsBase = new Uint32Array(0);
  xgfData.positions = new Uint16Array(0);
  xgfData.colors = new Uint8Array(0);
  xgfData.indexSize = new Uint8Array([2]);
  xgfData.indices = new Uint32Array(0);
  xgfData.edgeIndexSize = new Uint8Array([2]);
  xgfData.edgeIndices = new Uint32Array(0);
  xgfData.aabbs = new Float32Array(0);
  xgfData.normals = new Uint16Array(0);
  xgfData.uvs = new Float32Array(0);
  xgfData.scales = new Float32Array(0);
  xgfData.rotations = new Uint8Array(0);
  xgfData.eachGeometryPositionsBase = new Uint32Array(0);
  xgfData.eachGeometryColorsBase = new Uint32Array(0);
  xgfData.eachGeometryIndicesBase = new Uint32Array(0);
  xgfData.eachGeometryEdgeIndicesBase = new Uint32Array(0);
  xgfData.eachGeometryNormalsBase = new Uint32Array(0);
  xgfData.eachGeometryUVsBase = new Uint32Array(0);
  xgfData.eachGeometryScalesBase = new Uint32Array(0);
  xgfData.eachGeometryRotationsBase = new Uint32Array(0);
  xgfData.eachGeometryPrimitiveType = new Uint8Array(0);
  xgfData.eachGeometryAABBBase = new Uint32Array(0);
  xgfData.eachGeometryId = [];
  xgfData.framePositions = new Uint16Array(0);
  xgfData.frameNormals = new Uint16Array(0);
  xgfData.frameAABBs = new Float32Array(0);
  xgfData.frameTimes = new Float32Array(0);
  xgfData.eachGeometryFramesBase = new Uint32Array(0);
  xgfData.eachGeometryFramesCount = new Uint32Array(0);
  xgfData.eachGeometryVertexStatesBase = new Uint32Array(0);
  xgfData.eachGeometryVertexStatesCount = new Uint32Array(0);
  xgfData.eachFramePositionsBase = new Uint32Array(0);
  xgfData.eachFrameNormalsBase = new Uint32Array(0);
  xgfData.eachFrameAABBBase = new Uint32Array(0);
  xgfData.morphTargetPositions = new Float32Array(0);
  xgfData.morphTargetNormals = new Float32Array(0);
  xgfData.eachGeometryMorphTargetsBase = new Uint32Array(0);
  xgfData.eachMorphTargetPositionsBase = new Uint32Array(0);
  xgfData.eachMorphTargetNormalsBase = new Uint32Array(0);
  xgfData.eachMorphTargetId = [];
  xgfData.eachMorphTargetName = [];

  xgfData.textureData = new Uint8Array(0);
  xgfData.eachTextureDataBase = new Uint32Array(0);
  xgfData.eachTextureMediaType = new Uint8Array(0);
  xgfData.eachTextureWidth = new Uint16Array(0);
  xgfData.eachTextureHeight = new Uint16Array(0);
  xgfData.eachTextureSampler = new Uint8Array(0);
  xgfData.eachTextureEncoding = new Uint16Array(0);
  xgfData.eachTextureId = [];

  xgfData.eachMaterialPBR = new Uint8Array(0);
  xgfData.eachMaterialColor = new Float32Array(0);
  xgfData.eachMaterialTextures = new Int32Array(0);
  xgfData.eachMaterialId = [];
  xgfData.eachMaterialTriplanarScale = new Float32Array(0);
  xgfData.eachMaterialOptical = new Float32Array(0);
  xgfData.eachMaterialIor = new Float32Array(0);
  xgfData.extraTexCoords = new Float32Array(0);
  xgfData.eachGeometryExtraTexCoord = new Uint32Array(0);
  xgfData.eachMaterialTextureTexCoord = new Uint16Array(0);
  xgfData.eachMaterialTextureTransforms = new Float32Array(0);

  for (let i = 0; i < xgfData.eachMeshGeometriesBase.length; i++) {
    xgfData.eachMeshGeometriesBase[i] = 0xffffffff;
    xgfData.eachMeshMaterial[i] = -1;
  }
}

function stripExternalMeshRefs(xgfData: XGFData_v2): void {
  xgfData.eachMeshGeometryId = [];
  xgfData.eachMeshMaterialId = [];
}

function collectAnimationParamsJson(sceneModel: SceneModel, options: {
  includeTransformTargets: boolean;
  includeMeshTargets: boolean;
}): string[] {
  const animationParamsJson: string[] = [];
  for (const animationId of Object.keys(sceneModel.animations || {})) {
    const result = sceneModel.animations[animationId].toParams();
    if (result.ok === false) {
      continue;
    }
    const params = filterAnimationParams(result.value, options);
    if (params.channels.length === 0) {
      continue;
    }
    animationParamsJson.push(JSON.stringify(toPlainAnimationParams(params)));
  }
  return animationParamsJson;
}

function filterAnimationParams(params: SceneAnimationParams, options: {
  includeTransformTargets: boolean;
  includeMeshTargets: boolean;
}): SceneAnimationParams {
  return {
    id: params.id,
    ...(params.name !== undefined ? {name: params.name} : {}),
    channels: params.channels.filter((channel) => {
      const target = channel.target;
      if (target.type === "transform") {
        return options.includeTransformTargets;
      }
      if (target.type === "vertexState" || target.type === "morphWeights") {
        return options.includeMeshTargets;
      }
      return false;
    })
  };
}

function toPlainAnimationParams(params: SceneAnimationParams): SceneAnimationParams {
  return {
    id: params.id,
    ...(params.name !== undefined ? {name: params.name} : {}),
    channels: params.channels.map((channel) => ({
      target: {...channel.target} as any,
      sampler: {
        times: Array.from(channel.sampler.times),
        values: Array.from(channel.sampler.values),
        ...(channel.sampler.valueSize !== undefined ? {valueSize: channel.sampler.valueSize} : {}),
        ...(channel.sampler.interpolation !== undefined ? {interpolation: channel.sampler.interpolation} : {})
      }
    }))
  };
}

function buildVariantSetPayload(sceneModel: any, assetMode: string, objectIdSet: Set<string>): Pick<XGFData_v2,
  "eachVariantSetId" |
  "eachVariantSetDefaultVariantId" |
  "eachVariantSetSelectionStrategy" |
  "eachVariantSetHysteresisPixels" |
  "eachVariantSetVariantsBase" |
  "eachVariantId" |
  "eachVariantRangeMinPixels" |
  "eachVariantRangeMaxPixels" |
  "eachVariantObjectIdsBase" |
  "variantObjectIds"> {
  const variantSets = assetMode === "assetLibrary"
    ? []
    : Object.values(sceneModel.variantSets || {}).filter((variantSet: any) => variantSetObjectsContained(variantSet, objectIdSet));
  const eachVariantSetId: string[] = [];
  const eachVariantSetDefaultVariantId: string[] = [];
  const eachVariantSetSelectionStrategy = new Uint8Array(variantSets.length);
  const eachVariantSetHysteresisPixels = new Float32Array(variantSets.length);
  const eachVariantSetVariantsBase = new Uint32Array(variantSets.length);
  const eachVariantId: string[] = [];
  const eachVariantRangeMinPixels: number[] = [];
  const eachVariantRangeMaxPixels: number[] = [];
  const eachVariantObjectIdsBase: number[] = [];
  const variantObjectIds: string[] = [];

  for (let i = 0; i < eachVariantSetHysteresisPixels.length; i++) {
    eachVariantSetHysteresisPixels[i] = Number.NaN;
  }

  for (let variantSetIdx = 0; variantSetIdx < variantSets.length; variantSetIdx++) {
    const variantSet: any = variantSets[variantSetIdx];
    eachVariantSetId.push(variantSet.id);
    eachVariantSetDefaultVariantId.push(variantSet.defaultVariantId);
    eachVariantSetVariantsBase[variantSetIdx] = eachVariantId.length;
    if (variantSet.selection?.strategy === "projectedSize") {
      eachVariantSetSelectionStrategy[variantSetIdx] = 1;
      if (variantSet.selection.hysteresisPixels !== undefined) {
        eachVariantSetHysteresisPixels[variantSetIdx] = variantSet.selection.hysteresisPixels;
      }
    }
    for (const variantId in variantSet.variants) {
      const variant = variantSet.variants[variantId];
      eachVariantId.push(variant.id);
      eachVariantRangeMinPixels.push(variant.range?.minPixels ?? Number.NaN);
      eachVariantRangeMaxPixels.push(variant.range?.maxPixels ?? Number.NaN);
      eachVariantObjectIdsBase.push(variantObjectIds.length);
      for (let i = 0, len = variant.objectIds.length; i < len; i++) {
        variantObjectIds.push(variant.objectIds[i]);
      }
    }
  }

  return {
    eachVariantSetId,
    eachVariantSetDefaultVariantId,
    eachVariantSetSelectionStrategy,
    eachVariantSetHysteresisPixels,
    eachVariantSetVariantsBase,
    eachVariantId,
    eachVariantRangeMinPixels: new Float32Array(eachVariantRangeMinPixels),
    eachVariantRangeMaxPixels: new Float32Array(eachVariantRangeMaxPixels),
    eachVariantObjectIdsBase: new Uint32Array(eachVariantObjectIdsBase),
    variantObjectIds
  };
}

function variantSetObjectsContained(variantSet: any, objectIdSet: Set<string>): boolean {
  for (const variantId in variantSet.variants) {
    const variant = variantSet.variants[variantId];
    for (let i = 0, len = variant.objectIds.length; i < len; i++) {
      if (!objectIdSet.has(variant.objectIds[i])) {
        return false;
      }
    }
  }
  return true;
}

function clearVariantSets(xgfData: XGFData_v2): void {
  xgfData.eachVariantSetId = [];
  xgfData.eachVariantSetDefaultVariantId = [];
  xgfData.eachVariantSetSelectionStrategy = new Uint8Array(0);
  xgfData.eachVariantSetHysteresisPixels = new Float32Array(0);
  xgfData.eachVariantSetVariantsBase = new Uint32Array(0);
  xgfData.eachVariantId = [];
  xgfData.eachVariantRangeMinPixels = new Float32Array(0);
  xgfData.eachVariantRangeMaxPixels = new Float32Array(0);
  xgfData.eachVariantObjectIdsBase = new Uint32Array(0);
  xgfData.variantObjectIds = [];
}

function clampU8(v: number): number {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function hasNonNeutralOpticalMaterial(mat: any): boolean {
  return (mat.transmission ?? 0) > 0
    || (mat.thickness ?? 0) > 0
    || !isNeutralAttenuationColor(mat.attenuationColor)
    || Number.isFinite(mat.attenuationDistance);
}

function isNeutralAttenuationColor(color: ArrayLike<number> | undefined): boolean {
  return !color
    || ((color[0] ?? 1) === 1 && (color[1] ?? 1) === 1 && (color[2] ?? 1) === 1);
}

function hasNonDefaultIorMaterial(mat: any): boolean {
  return Number.isFinite(mat.ior) && Math.abs(mat.ior - DEFAULT_MATERIAL_IOR) > 1e-6;
}

function hasNonDefaultTextureBindingState(mat: any): boolean {
  return (mat.colorTexture && textureBindingNonDefault(mat.colorTextureTexCoord, mat.colorTextureUVTransform))
    || (mat.metallicRoughnessTexture && textureBindingNonDefault(mat.metallicRoughnessTextureTexCoord, mat.metallicRoughnessTextureUVTransform))
    || (mat.normalsTexture && textureBindingNonDefault(mat.normalsTextureTexCoord, mat.normalsTextureUVTransform))
    || (mat.occlusionTexture && textureBindingNonDefault(mat.occlusionTextureTexCoord, mat.occlusionTextureUVTransform))
    || (mat.emissiveTexture && textureBindingNonDefault(mat.emissiveTextureTexCoord, mat.emissiveTextureUVTransform));
}

function textureBindingNonDefault(texCoord: number | undefined, transform: ArrayLike<number> | undefined): boolean {
  return (texCoord ?? 0) !== 0 || !isIdentityUVTransform(transform);
}

function writeTextureBindingState(
  texCoords: Uint16Array,
  transforms: Float32Array,
  materialTextureBase: number,
  slot: number,
  texCoord: number | undefined,
  transform: ArrayLike<number> | undefined
): void {
  texCoords[materialTextureBase + slot] = Math.max(0, Math.min(0xffff, texCoord ?? 0));
  const offset = (materialTextureBase + slot) * 6;
  const uvTransform = transform && transform.length === 6 ? transform : [1, 0, 0, 1, 0, 0];
  transforms[offset] = uvTransform[0] ?? 1;
  transforms[offset + 1] = uvTransform[1] ?? 0;
  transforms[offset + 2] = uvTransform[2] ?? 0;
  transforms[offset + 3] = uvTransform[3] ?? 1;
  transforms[offset + 4] = uvTransform[4] ?? 0;
  transforms[offset + 5] = uvTransform[5] ?? 0;
}

function isIdentityUVTransform(transform: ArrayLike<number> | undefined): boolean {
  if (!transform || transform.length !== 6) {
    return true;
  }
  return Math.abs((transform[0] ?? 1) - 1) < 1e-6
    && Math.abs(transform[1] ?? 0) < 1e-6
    && Math.abs(transform[2] ?? 0) < 1e-6
    && Math.abs((transform[3] ?? 1) - 1) < 1e-6
    && Math.abs(transform[4] ?? 0) < 1e-6
    && Math.abs(transform[5] ?? 0) < 1e-6;
}

function textureIndexOrNone(id: string | undefined, indexById: Record<string, number>): number {
  if (!id) return -1;
  const idx = indexById[id];
  return (idx === undefined) ? -1 : idx;
}

function maxArrayValue(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0, len = values.length; i < len; i++) {
    if (values[i] > max) {
      max = values[i];
    }
  }
  return max;
}

/**
 * Re-encode a texture image to PNG bytes. Accepts both drawable sources
 * (`HTMLImageElement` / `ImageBitmap` / `OffscreenCanvas` / `HTMLCanvasElement`)
 * and raw RGBA pixel buffers (`ImageData` or any `{data, width, height}`-shaped
 * value, e.g. `MaterialPixelBuffer` from `generation/paintMaterials`).
 *
 * Uses an `OffscreenCanvas` when available — that's the faster path;
 * falls back to a DOM canvas + `toBlob` otherwise.
 */
async function encodeImageToPNG(imageData: any): Promise<Uint8Array<any>> {
  const w = imageData.width, h = imageData.height;

  // Raw pixel buffers (MaterialPixelBuffer, ImageData, or the
  // serialised-array form) need putImageData — drawImage rejects them.
  const isPixelBuffer = imageData && imageData.data && imageData.data.length === w * h * 4;

  const paint = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    if (isPixelBuffer) {
      const bytes = imageData.data instanceof Uint8ClampedArray
        ? imageData.data
        : new Uint8ClampedArray(imageData.data);
      const id = (typeof ImageData !== "undefined" && imageData instanceof ImageData)
        ? imageData
        : new ImageData(bytes, w, h);
      ctx.putImageData(id, 0, 0);
    } else {
      ctx.drawImage(imageData, 0, 0);
    }
  };

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return new Uint8Array(0);
    paint(ctx);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new Uint8Array(0);
    paint(ctx);
    return await new Promise<Uint8Array>((resolve) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return resolve(new Uint8Array(0));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, "image/png");
    });
  }
  // Headless (Node) — no browser canvas. Encode via @napi-rs/canvas.
  return encodeImageToPNGNode(imageData, w, h, isPixelBuffer);
}

/**
 * Node fallback for {@link encodeImageToPNG} using `@napi-rs/canvas`, so the
 * XGF exporter can encode textures headlessly (CLI / conversion pipelines).
 *
 * The native module is loaded through a non-analyzable `require` so neither the
 * browser nor the CLI esbuild bundle inlines its `.node` binary; this function
 * only runs when no browser canvas is present.
 */
function encodeImageToPNGNode(imageData: any, w: number, h: number, isPixelBuffer: boolean): Uint8Array {
  const requireFn: (id: string) => any = eval("require");
  const {createCanvas, ImageData: NodeImageData} = requireFn("@napi-rs/canvas");
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (isPixelBuffer) {
    const bytes = imageData.data instanceof Uint8ClampedArray
      ? imageData.data
      : new Uint8ClampedArray(imageData.data);
    ctx.putImageData(new NodeImageData(bytes, w, h), 0, 0);
  } else {
    ctx.drawImage(imageData, 0, 0);
  }
  return new Uint8Array(canvas.toBuffer("image/png"));
}
