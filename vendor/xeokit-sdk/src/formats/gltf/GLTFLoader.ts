import {
  ClampToEdgeWrapping,
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
  sRGBEncoding,
  TrianglesPrimitive
} from "../../base/constants";
import {createMat4Float64, identityMat4, type Mat4, mulMat4, scalingMat4v, translationMat4v} from "../../base/math/matrix";
import type {FloatArrayParam, IntArrayParam} from "../../base/math";
import {createUUID, yieldToHost} from "../../base/utils";
import {GLTFLoader as glGLTFLoader, postProcessGLTF} from '@loaders.gl/gltf';
import type {ModelLoadParams} from "../ModelLoadParams";
import type {GLTFLoadOptions} from "./GLTFLoadOptions";
import {ModelLoader} from "../ModelLoader";
import type {
  SceneGeometryMorphTargetParams,
  SceneGeometryParams,
  SceneMeshParams,
  SceneModel,
  SceneAnimationParams,
  SceneAnimationTransformProperty,
  SceneMaterialParams
} from "../../model/scene";
import type {DataModel} from "../../model/data/DataModel";
import {parse} from '@loaders.gl/core';
import {quatToMat4} from "../../base/math/quat";
import type {LoaderProgress} from "../LoaderProgress";

/**
 * Loads a glTF file into a {@link model!scene.SceneModel | SceneModel} and/or a {@link model!data.DataModel | DataModel}.
 *
 * For detailed usage, refer to {@link formats!gltf | @xeokit/sdk/formats/gltf}.
 */
export class GLTFLoader extends ModelLoader {
  constructor() {
    super({
      format: "glTF",
      fileDataType: "arraybuffer",
      parsers: {
        "*": parseGLTF
      },
      getVersion: (fileData: any): string => {
        return "*";
      }
    });
  }

  load(params: ModelLoadParams, options: GLTFLoadOptions = {}): Promise<any> {
    return super.load(params, options);
  }
}

interface ParsingContext {
  nodesHaveNames: boolean,
  baseId: string,
  gltfData: any;
  nextId: number;
  errors: string[];
  dataModel?: DataModel;
  sceneModel?: SceneModel;
  meshIds: any;
  meshIdsStack: string[];
  objectIdStack: string[];
  options: any;
  nodeTransformIds?: Map<number, string>;
  usedTransformIds?: Set<string>;
  usedObjectIds?: Set<string>;
}

/**
 * Fail fast with a clear message on a corrupt binary GLB whose 12-byte header
 * declares a total length larger than the actual file. Without this guard,
 * loaders.gl trusts the bogus length, reads chunks/accessors past the end of
 * the buffer, and throws a cryptic `RangeError: Offset is outside the bounds of
 * the DataView`. Only inspects binary GLB input (magic `glTF`); JSON `.gltf`
 * (string/object) and non-buffer inputs are left for loaders.gl to handle.
 *
 * @internal
 */
export function assertValidGLBHeader(fileData: any): void {
  let dv: DataView | null = null;
  if (fileData instanceof ArrayBuffer) {
    dv = new DataView(fileData);
  } else if (ArrayBuffer.isView(fileData)) {
    dv = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  }
  if (!dv || dv.byteLength < 12) {
    return; // not a binary buffer, or too small to be a GLB — let parse() decide
  }
  const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
  if (dv.getUint32(0, true) !== GLB_MAGIC) {
    return; // JSON .gltf or some other input — not a binary GLB
  }
  const declaredLength = dv.getUint32(8, true);
  if (declaredLength > dv.byteLength) {
    throw new Error(
      `[GLTFLoader.load] Corrupt GLB: the header declares a total length of ` +
      `${declaredLength} bytes but the file is only ${dv.byteLength} bytes — ` +
      `the model is truncated or its GLB length field is invalid.`);
  }
}

async function parseGLTF(params: ModelLoadParams, options: any): Promise<any> {
  const {fileData, sceneModel, dataModel} = params;
  if (!sceneModel && !dataModel) {
    return;
  }
  // Clear error on a corrupt GLB length header, before loaders.gl overruns the
  // buffer with an opaque DataView RangeError.
  assertValidGLBHeader(fileData);
  // baseUri lets loaders.gl resolve external buffers + textures (`.bin`,
  // `.jpg`, etc.) referenced by relative URIs in the .gltf JSON. Without
  // it, multi-file models can only be loaded once their resources have
  // been pre-fetched. Single-file `.glb` doesn't need it.
  const parseOptions: any = {};
  if (options && options.baseUri) {
    parseOptions.baseUri = options.baseUri;
  }
  // Caller-injected Draco decoder for KHR_draco_mesh_compression. The glTF
  // decoder decompresses meshes by default; it just needs the draco3d module,
  // which the SDK does not bundle.
  if (options && options.dracoModule) {
    parseOptions.modules = {draco3d: options.dracoModule};
  }

  // Headless (Node) has no 2D-canvas image decoder, and loaders.gl's JPEG path
  // (jpeg-js) caps decode memory at 512 MB — large textures exceed it and abort
  // the whole parse. Outside a browser, skip image DECODING: parseTexture
  // carries each texture's original encoded PNG/JPEG bytes through to the
  // SceneModel, which exporters (XGF) store verbatim. Browsers keep decoding so
  // the viewer still renders textures.
  const headless = typeof OffscreenCanvas === "undefined" && typeof document === "undefined";
  if (headless) {
    parseOptions.gltf = {...(parseOptions.gltf || {}), loadImages: false, loadBuffers: true};
  }

  const onProgress: ((p: LoaderProgress) => void) | undefined = options?.onProgress;
  const signal: AbortSignal | undefined = options?.signal;
  // Reusable progress payload — see the LoaderProgress
  // contract: consumers must copy out fields they retain.
  const progress: LoaderProgress = {phase: "Decoding glTF", current: 0, total: 0};
  const emit = (phase: string, current: number, total: number): void => {
    if (!onProgress) return;
    progress.phase = phase;
    progress.current = current;
    progress.total = total;
    onProgress(progress);
  };

  emit("Decoding glTF", 0, 0);
  await yieldToHost(signal);

  let processedGLTF: any;
  try {
    const gltfData = await parse(fileData, glGLTFLoader, parseOptions);
    processedGLTF = postProcessGLTF(gltfData);
  } catch (errMsg) {
    throw new Error(`[GLTFLoader.load] Error parsing glTF -> ${errMsg}`);
  }
  await yieldToHost(signal);

  const ctx: ParsingContext = {
    nodesHaveNames: false, // determined in testIfNodesHaveNames()
    meshIds: [],
    meshIdsStack: [],
    objectIdStack: [],
    baseId: createUUID(),
    gltfData: processedGLTF,
    nextId: 0,
    errors: [],
    dataModel,
    sceneModel,
    options: options || {}
  };

  // Phase boundaries — yield + emit between each so the dialog
  // paints during the heaviest phase transitions. Per-item
  // yields inside the recursive scene walker are a future
  // refinement; this minimum gives huge glTFs three or four
  // paint opportunities mid-load instead of zero.
  emit("Decoding textures", 0, 0);
  if (!parseTextures(ctx)) {
    throw new Error(ctx.errors.length > 0 ? ctx.errors[0] : `[GLTFLoader.load] Error parsing glTF`);
  }
  await yieldToHost(signal);

  emit("Building materials", 0, 0);
  if (!parseMaterials(ctx)) {
    throw new Error(ctx.errors.length > 0 ? ctx.errors[0] : `[GLTFLoader.load] Error parsing glTF`);
  }
  await yieldToHost(signal);

  emit("Building scene", 0, 0);
  if (!parseDefaultScene(ctx)) {
    throw new Error(ctx.errors.length > 0 ? ctx.errors[0] : `[GLTFLoader.load] Error parsing glTF`);
  }
  if (!parseAnimations(ctx)) {
    throw new Error(ctx.errors.length > 0 ? ctx.errors[0] : `[GLTFLoader.load] Error parsing glTF animations`);
  }
  emit("Building scene", 1, 1);

  parseStructuralMetadata(ctx);
}

const METADATA_COMPONENTS: Record<string, number> = {
  VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

/**
 * Value of property row `i` from a decoded `EXT_structural_metadata` column.
 * loaders.gl returns fixed-size numeric vectors / matrices as one flat typed
 * array, so a `VEC*` / `MAT*` row is the matching slice; SCALAR and everything
 * else is indexed directly.
 */
function featureMetadataValue(data: any, i: number, type: string | undefined): any {
  if (data == null) return undefined;
  const components = type ? METADATA_COMPONENTS[type] : undefined;
  if (components && typeof data[i * components] === "number") {
    return Array.from(data.slice(i * components, i * components + components));
  }
  return data[i];
}

/**
 * Stable id shared between a feature's DataObject (from an
 * `EXT_structural_metadata` property table) and the SceneObject holding that
 * feature's geometry (split out per `EXT_mesh_features` feature id). A
 * SceneObject and DataObject with the same id are the same logical object, so
 * matching ids is what links a picked feature to its metadata.
 */
function featureObjectId(baseId: string, tableIndex: number, featureIndex: number): string {
  return `${baseId}-pt${tableIndex}-f${featureIndex}`;
}

/**
 * Maps `EXT_structural_metadata` property tables onto the DataModel: one
 * DataObject (with a property set) per feature row, typed by the table's
 * schema class. loaders.gl decodes each property column into
 * `propertyTableProperty.data`, indexed by feature. When `dataParentId` is
 * set, each feature aggregates under that DataObject (the 3D Tiles loader
 * passes the tileset's root). Feature ids are shared with the geometry split in
 * {@link splitPrimitiveByFeature}, so a feature's DataObject and SceneObject
 * carry the same id.
 */
function parseStructuralMetadata(ctx: ParsingContext): void {
  const dataModel = ctx.dataModel;
  const sm = ctx.gltfData?.extensions?.EXT_structural_metadata;
  if (!dataModel || !sm?.propertyTables) {
    return;
  }
  const parentId: string | undefined = ctx.options.dataParentId;
  for (let t = 0; t < sm.propertyTables.length; t++) {
    const table = sm.propertyTables[t];
    const count = table.count || 0;
    const className = table.class || "Feature";
    const schemaClass = sm.schema?.classes?.[className];
    const propNames = Object.keys(table.properties || {});
    for (let i = 0; i < count; i++) {
      const objectId = featureObjectId(ctx.baseId, t, i);
      const propertySetId = `${objectId}-props`;
      dataModel.createPropertySet({
        id: propertySetId,
        name: className,
        type: className,
        properties: propNames.map(name => ({
          name,
          value: featureMetadataValue(table.properties[name]?.data, i, schemaClass?.properties?.[name]?.type),
        })),
      });
      dataModel.createObject({id: objectId, type: className, name: `${className} ${i}`, propertySetIds: [propertySetId]});
      if (parentId) {
        dataModel.createRelationship({type: "BasicAggregation", relatingObjectId: parentId, relatedObjectId: objectId});
      }
    }
  }
}

function parseTextures(ctx: any): boolean {
  if (!ctx.sceneModel) {
    return true;
  }
  const gltfData = ctx.gltfData;
  const textures = gltfData.textures;
  if (textures) {
    for (let i = 0, len = textures.length; i < len; i++) {
      textures[i]._textureIndex = i;
      if (!parseTexture(ctx, textures[i])) {
        return false;
      }
    }
  }
  return true;
}

function parseTexture(ctx: any, texture: any): boolean {
  if (!texture.source) {
    ctx.errors.push(`[GLTFLoader.load] Texture has no image source`);
    return false;
  }
  const textureId = `texture-${ctx.baseId}-${ctx.nextId++}`;
  let minFilter = NearestMipMapLinearFilter;
  switch (texture.sampler.minFilter) {
    case 9728:
      minFilter = NearestFilter;
      break;
    case 9729:
      minFilter = LinearFilter;
      break;
    case 9984:
      minFilter = NearestMipMapNearestFilter;
      break;
    case 9985:
      minFilter = LinearMipMapNearestFilter;
      break;
    case 9986:
      minFilter = NearestMipMapLinearFilter;
      break;
    case 9987:
      minFilter = LinearMipMapLinearFilter;
      break;
  }
  const mipmap = isMipmapMinFilter(minFilter);
  let magFilter = LinearFilter;
  switch (texture.sampler.magFilter) {
    case 9728:
      magFilter = NearestFilter;
      break;
    case 9729:
      magFilter = LinearFilter;
      break;
  }
  let wrapS = RepeatWrapping;
  switch (texture.sampler.wrapS) {
    case 33071:
      wrapS = ClampToEdgeWrapping;
      break;
    case 33648:
      wrapS = MirroredRepeatWrapping;
      break;
    case 10497:
      wrapS = RepeatWrapping;
      break;
  }
  let wrapT = RepeatWrapping;
  switch (texture.sampler.wrapT) {
    case 33071:
      wrapT = ClampToEdgeWrapping;
      break;
    case 33648:
      wrapT = MirroredRepeatWrapping;
      break;
    case 10497:
      wrapT = RepeatWrapping;
      break;
  }
  let wrapR = RepeatWrapping;
  switch (texture.sampler.wrapR) {
    case 33071:
      wrapR = ClampToEdgeWrapping;
      break;
    case 33648:
      wrapR = MirroredRepeatWrapping;
      break;
    case 10497:
      wrapR = RepeatWrapping;
      break;
  }
  // loaders.gl decodes the image for rendering but retains the original
  // encoded PNG/JPEG bytes on the source's bufferView. Carry those through as
  // `buffers` so exporters re-emit them losslessly without re-encoding (which
  // needs a 2D canvas, unavailable under Node) — always when no decoded image
  // is present (headless `loadImages:false`), or on request via
  // `retainTextureBytes`.
  const decodedImage = texture.source.image;
  const encodedBytes = (ctx.options.retainTextureBytes || !decodedImage)
    ? extractEncodedImageBytes(texture.source)
    : null;
  if (!decodedImage && !encodedBytes) {
    ctx.errors.push(`[GLTFLoader.load] Texture has no image source`);
    return false;
  }
  // Dimensions come from the decoded image when available, else from the
  // encoded bytes' header (cheap — no full decode, so the jpeg-js cap is moot).
  const dims = decodedImage
    ? {width: decodedImage.width, height: decodedImage.height}
    : imageSizeFromBytes(new Uint8Array(encodedBytes as ArrayBuffer), texture.source.mimeType);
  const result = ctx.sceneModel.createTexture({
    id: textureId,
    image: decodedImage || undefined,
    buffers: encodedBytes ? [encodedBytes] : undefined,
    mediaType: encodedBytes ? mimeTypeToMediaType(texture.source.mimeType) : undefined,
    width: dims.width,
    height: dims.height,
    minFilter,
    magFilter,
    wrapS,
    wrapT,
    wrapR,
    flipY: !!texture.flipY,
    encoding: isColorSpaceTexture(ctx, texture) ? sRGBEncoding : undefined,
    mipmap
  });
  if (result.ok === false) {
    ctx.errors.push(`[GLTFLoader.load] Failed to create texture -> ${result.error}`);
    return false;
  }
  texture._textureId = textureId;
  return true;
}

function isMipmapMinFilter(minFilter: number): boolean {
  return minFilter === NearestMipMapNearestFilter ||
    minFilter === NearestMipMapLinearFilter ||
    minFilter === LinearMipMapNearestFilter ||
    minFilter === LinearMipMapLinearFilter;
}

function isColorSpaceTexture(ctx: any, texture: any): boolean {
  const materials = ctx.gltfData?.materials || [];
  for (let i = 0, len = materials.length; i < len; i++) {
    const material = materials[i];
    const metallicPBR = material.pbrMetallicRoughness;
    if (textureInfoReferencesTexture(metallicPBR?.baseColorTexture || metallicPBR?.colorTexture, texture) ||
        textureInfoReferencesTexture(material.emissiveTexture, texture) ||
        textureInfoReferencesTexture(material.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture, texture)) {
      return true;
    }
  }
  return false;
}

function textureInfoReferencesTexture(textureInfo: any, texture: any): boolean {
  if (!textureInfo) {
    return false;
  }
  if (textureInfo.texture === texture) {
    return true;
  }
  if (textureInfo.index === texture) {
    return true;
  }
  if (typeof textureInfo.index === "number") {
    return textureInfo.index === texture._textureIndex;
  }
  return false;
}

/**
 * Original encoded image bytes for a glTF image source, as a standalone
 * ArrayBuffer, or `null` when none are present. loaders.gl keeps the source
 * bytes on `source.bufferView.data` (a view into the GLB binary chunk) even
 * after decoding the image for rendering.
 */
function extractEncodedImageBytes(source: any): ArrayBuffer | null {
  const data: Uint8Array | undefined = source?.bufferView?.data;
  if (!data || data.byteLength === 0) {
    return null;
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/**
 * Pixel dimensions of an encoded PNG or JPEG, read from its header without
 * decoding the pixels — so a multi-hundred-MB texture costs nothing and never
 * trips a decoder memory cap. Returns `{width:0,height:0}` if unrecognised.
 */
function imageSizeFromBytes(bytes: Uint8Array, mimeType: string | undefined): {width: number; height: number} {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8-byte signature, then IHDR (width @16, height @20, big-endian).
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return {width: dv.getUint32(16, false), height: dv.getUint32(20, false)};
  }
  // JPEG: walk segment markers to the Start-Of-Frame (SOFn) and read its size.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) { off++; continue; }
      const marker = bytes[off + 1];
      // SOF0..SOF15 carry frame size; skip DHT(C4)/JPG(C8)/DAC(CC) and others.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {height: dv.getUint16(off + 5, false), width: dv.getUint16(off + 7, false)};
      }
      const segLen = dv.getUint16(off + 2, false);
      if (segLen < 2) break;
      off += 2 + segLen;
    }
  }
  return {width: 0, height: 0};
}

function mimeTypeToMediaType(mimeType: string | undefined): number | undefined {
  switch (mimeType) {
    case "image/png":  return PNGMediaType;
    case "image/jpeg": return JPEGMediaType;
    case "image/gif":  return GIFMediaType;
    default:           return undefined;
  }
}

function parseMaterials(ctx: ParsingContext): boolean {
  const gltfData = ctx.gltfData;
  const materials = gltfData.materials;
  if (materials) {
    for (let i = 0, len = materials.length; i < len; i++) {
      const material = materials[i];
      // Always-create: every glTF material maps to one SceneMaterial,
      // even ones without textures, so meshes referencing them get
      // their PBR factors via `materialId` rather than via a
      // per-mesh fallback. color/opacity/roughness/metallic are baked
      // into the SceneMaterial up front.
      const materialCfg = parseMaterial(ctx, material);
      const materialResult = ctx.sceneModel.createMaterial(materialCfg);
      if (materialResult.ok === false) {
        ctx.errors.push(`Failed to create SceneMaterial set -> ${materialResult.error}`);
        return false;
      }
      material._materialId = materialResult.value.id;
    }
  }
  return true;
}

/**
 * Translates a glTF material into a {@link SceneMaterialParams}.
 *
 * Maps:
 *   - `pbrMetallicRoughness.baseColorFactor` → `color` + `opacity`
 *   - `pbrMetallicRoughness.metallicFactor`  → `metallic` (default 1)
 *   - `pbrMetallicRoughness.roughnessFactor` → `roughness` (default 1)
 *   - `pbrMetallicRoughness.baseColorTexture`         → `colorTextureId`
 *   - `pbrMetallicRoughness.metallicRoughnessTexture` → `metallicRoughnessTextureId`
 *   - `KHR_materials_clearcoat.clearcoatFactor` → `clearcoat`
 *   - `KHR_materials_clearcoat.clearcoatRoughnessFactor` → `clearcoatRoughness`
 *   - `KHR_materials_sheen.sheenColorFactor` → `sheen` (max RGB channel)
 *   - `KHR_materials_sheen.sheenRoughnessFactor` → `sheenRoughness`
 *   - `KHR_materials_ior.ior` → `ior`
 *   - `normalTexture`                                  → `normalsTextureId`
 *   - `occlusionTexture`                               → `occlusionTextureId`
 *   - `emissiveTexture`                                → `emissiveTextureId`
 *
 * Falls back to legacy `KHR_materials_pbrSpecularGlossiness` when no
 * MetallicRoughness block is present (some older models use it).
 *
 * Texture references rely on `parseTextures` having run first — that
 * stamps a `_textureId` on each glTF texture entry which we look up
 * here. The chain is `material.<map>.texture._textureId` (after
 * `postProcessGLTF` resolves indices to objects); when the texture
 * field hasn't been resolved we fall back to the raw `index` lookup.
 */
function parseMaterial(ctx: ParsingContext, material: any): SceneMaterialParams {
  const materialCfg: SceneMaterialParams = {
    id: `material-${ctx.baseId}-${ctx.nextId++}`,
    color: [1, 1, 1],
    opacity: 1,
    roughness: 1,
    metallic: 1  // glTF default — texture-driven materials use 1×1; lit materials override.
  };

  // ── Factors (always present in glTF 2.0 PBR) ───────────────────────────
  const metallicPBR = material.pbrMetallicRoughness;
  if (metallicPBR) {
    const baseColorFactor = metallicPBR.baseColorFactor;
    if (baseColorFactor) {
      materialCfg.color   = [baseColorFactor[0], baseColorFactor[1], baseColorFactor[2]];
      materialCfg.opacity = baseColorFactor[3] ?? 1;
    }
    if (metallicPBR.metallicFactor !== undefined && metallicPBR.metallicFactor !== null) {
      materialCfg.metallic = metallicPBR.metallicFactor;
    }
    if (metallicPBR.roughnessFactor !== undefined && metallicPBR.roughnessFactor !== null) {
      materialCfg.roughness = metallicPBR.roughnessFactor;
    }
    // ── PBR maps ─────────────────────────────────────────────────────────
    const baseColorTexture = metallicPBR.baseColorTexture || metallicPBR.colorTexture;
    if (baseColorTexture) {
      applyTextureBinding(ctx, materialCfg, "colorTexture", baseColorTexture);
    }
    if (metallicPBR.metallicRoughnessTexture) {
      applyTextureBinding(ctx, materialCfg, "metallicRoughnessTexture", metallicPBR.metallicRoughnessTexture);
    }
  }

  const clearcoatPBR = material.extensions?.KHR_materials_clearcoat;
  if (clearcoatPBR) {
    if (clearcoatPBR.clearcoatFactor !== undefined && clearcoatPBR.clearcoatFactor !== null) {
      materialCfg.clearcoat = clearcoatPBR.clearcoatFactor;
    }
    if (clearcoatPBR.clearcoatRoughnessFactor !== undefined && clearcoatPBR.clearcoatRoughnessFactor !== null) {
      materialCfg.clearcoatRoughness = clearcoatPBR.clearcoatRoughnessFactor;
    }
  }

  const sheenPBR = material.extensions?.KHR_materials_sheen;
  if (sheenPBR) {
    if (sheenPBR.sheenColorFactor !== undefined && sheenPBR.sheenColorFactor !== null) {
      const sheenColor = sheenPBR.sheenColorFactor;
      materialCfg.sheen = Math.max(sheenColor[0] ?? 0, sheenColor[1] ?? 0, sheenColor[2] ?? 0);
    }
    if (sheenPBR.sheenRoughnessFactor !== undefined && sheenPBR.sheenRoughnessFactor !== null) {
      materialCfg.sheenRoughness = sheenPBR.sheenRoughnessFactor;
    }
  }

  const iorPBR = material.extensions?.KHR_materials_ior;
  if (iorPBR && iorPBR.ior !== undefined && iorPBR.ior !== null && Number.isFinite(iorPBR.ior)) {
    materialCfg.ior = Math.max(1, iorPBR.ior);
  }

  const transmissionPBR = material.extensions?.KHR_materials_transmission;
  if (transmissionPBR) {
    materialCfg.transmission = clamp01Number(
      transmissionPBR.transmissionFactor !== undefined && transmissionPBR.transmissionFactor !== null
        ? transmissionPBR.transmissionFactor
        : 0
    );
  }

  const volumePBR = material.extensions?.KHR_materials_volume;
  if (volumePBR) {
    if (volumePBR.thicknessFactor !== undefined && volumePBR.thicknessFactor !== null && Number.isFinite(volumePBR.thicknessFactor)) {
      materialCfg.thickness = Math.max(0, volumePBR.thicknessFactor);
    }
    if (volumePBR.attenuationColor) {
      materialCfg.attenuationColor = [
        clamp01Number(volumePBR.attenuationColor[0] ?? 1),
        clamp01Number(volumePBR.attenuationColor[1] ?? 1),
        clamp01Number(volumePBR.attenuationColor[2] ?? 1)
      ];
    }
    if (volumePBR.attenuationDistance !== undefined && volumePBR.attenuationDistance !== null) {
      materialCfg.attenuationDistance =
        volumePBR.attenuationDistance === Infinity
          ? Infinity
          : (Number.isFinite(volumePBR.attenuationDistance) && volumePBR.attenuationDistance > 0
            ? volumePBR.attenuationDistance
            : Infinity);
    }
  }

  // ── Alpha mode + cutoff (glTF 2.0 alphaMode/alphaCutoff) ───────────────
  // OPAQUE is the glTF default. MASK + cutoff drives cutout cases like
  // Sponza's drape and the leaves on foliage glTFs; BLEND lets the
  // sampled alpha through to the framebuffer for translucent materials.
  if (material.alphaMode === "MASK" || material.alphaMode === "BLEND") {
    materialCfg.alphaMode = material.alphaMode;
  }
  if (material.alphaCutoff !== undefined && material.alphaCutoff !== null) {
    materialCfg.alphaCutoff = material.alphaCutoff;
  }

  // ── Standard non-PBR maps ──────────────────────────────────────────────
  if (material.normalTexture) {
    applyTextureBinding(ctx, materialCfg, "normalsTexture", material.normalTexture);
  }
  if (material.occlusionTexture) {
    applyTextureBinding(ctx, materialCfg, "occlusionTexture", material.occlusionTexture);
  }
  if (material.emissiveTexture) {
    applyTextureBinding(ctx, materialCfg, "emissiveTexture", material.emissiveTexture);
  }
  // Emissive factor (glTF `emissiveFactor`, RGB), scaled by
  // KHR_materials_emissive_strength when present. When the factor is omitted,
  // we leave `emissiveColor` unset so createMaterial auto-defaults it to
  // `[1,1,1]` for textured materials (glow without restating the factor).
  // The per-mesh slot is RGB8, so HDR strengths > 1 clamp to white.
  if (material.emissiveFactor) {
    const strength = material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    materialCfg.emissiveColor = [
      Math.min(1, material.emissiveFactor[0] * strength),
      Math.min(1, material.emissiveFactor[1] * strength),
      Math.min(1, material.emissiveFactor[2] * strength),
    ];
  }

  // ── Legacy KHR_materials_pbrSpecularGlossiness fallback ────────────────
  // Older glTFs (especially exported from Substance) still ship this
  // extension with a diffuseFactor + diffuseTexture instead of base-
  // colour. Map the diffuse colour onto our base colour so the
  // material at least picks up the right tint; we don't try to convert
  // the gloss/spec textures to MR here.
  const extensions = material.extensions;
  if (extensions) {
    const specularPBR = extensions["KHR_materials_pbrSpecularGlossiness"];
    if (specularPBR) {
      const diffuseFactor = specularPBR.diffuseFactor;
      if (diffuseFactor) {
        materialCfg.color   = [diffuseFactor[0], diffuseFactor[1], diffuseFactor[2]];
        materialCfg.opacity = diffuseFactor[3] ?? materialCfg.opacity;
      }
      if (specularPBR.diffuseTexture && !materialCfg.colorTextureId) {
        applyTextureBinding(ctx, materialCfg, "colorTexture", specularPBR.diffuseTexture);
      }
    }
  }

  return materialCfg;
}

function clamp01Number(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolves a glTF textureInfo into the SceneTexture id that
 * {@link parseTexture} stamped onto the texture entry. Handles both
 * post-processed form (`textureInfo.texture._textureId`) and the raw
 * index form (`gltfData.textures[textureInfo.index]._textureId`).
 * Returns `undefined` if the texture entry is missing — surfaces fall
 * back to factor-only rendering when that happens.
 */
function resolveTextureId(ctx: ParsingContext, textureInfo: any): string | undefined {
  if (!textureInfo) return undefined;
  if (textureInfo.texture && textureInfo.texture._textureId) {
    return textureInfo.texture._textureId;
  }
  if (typeof textureInfo.index === "number" && ctx.gltfData.textures) {
    const entry = ctx.gltfData.textures[textureInfo.index];
    return entry && entry._textureId;
  }
  return undefined;
}

function applyTextureBinding(ctx: ParsingContext, materialCfg: any, prefix: string, textureInfo: any): void {
  const textureId = resolveTextureId(ctx, textureInfo);
  if (!textureId) {
    return;
  }
  const binding = resolveTextureBinding(textureInfo);
  materialCfg[`${prefix}Id`] = textureId;
  materialCfg[`${prefix}TexCoord`] = binding.texCoord;
  materialCfg[`${prefix}UVTransform`] = binding.uvTransform;
}

function resolveTextureBinding(textureInfo: any): {texCoord: number; uvTransform: [number, number, number, number, number, number]} {
  const transform = textureInfo?.extensions?.KHR_texture_transform;
  const texCoord = texCoordOrDefault(transform?.texCoord ?? textureInfo?.texCoord);
  return {
    texCoord,
    uvTransform: textureTransformToAffine(transform)
  };
}

function texCoordOrDefault(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 0 ? value! : 0;
}

function textureTransformToAffine(transform: any): [number, number, number, number, number, number] {
  if (!transform) {
    return [1, 0, 0, 1, 0, 0];
  }
  const offset = transform.offset || [0, 0];
  const scale = transform.scale || [1, 1];
  const rotation = Number.isFinite(transform.rotation) ? transform.rotation : 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const sx = Number.isFinite(scale[0]) ? scale[0] : 1;
  const sy = Number.isFinite(scale[1]) ? scale[1] : 1;
  const ox = Number.isFinite(offset[0]) ? offset[0] : 0;
  const oy = Number.isFinite(offset[1]) ? offset[1] : 0;
  return [
    cos * sx,
    sin * sx,
    -sin * sy,
    cos * sy,
    ox,
    oy
  ];
}

function extractTexCoordChannels(attributes: any): Record<number, FloatArrayParam> | undefined {
  const texCoords: Record<number, FloatArrayParam> = {};
  for (const key of Object.keys(attributes || {})) {
    const match = /^TEXCOORD_(\d+)$/.exec(key);
    if (!match) {
      continue;
    }
    const channel = Number(match[1]);
    const value = attributes[key]?.value;
    if (Number.isInteger(channel) && channel >= 0 && value) {
      texCoords[channel] = value as FloatArrayParam;
    }
  }
  return Object.keys(texCoords).length > 0 ? texCoords : undefined;
}

function parseDefaultScene(ctx: ParsingContext): boolean {
  const gltfData = ctx.gltfData;
  const scene = gltfData.scene || gltfData.scenes[0];
  if (!scene) {
    ctx.errors.push("[GLTFLoader.load] Cannot load glTF - glTF has no default scene");
    return false;
  }
  return parseScene(ctx, scene);
}

function parseScene(ctx: ParsingContext, scene: any): boolean {
  const nodes = scene.nodes;
  if (!nodes) {
    return true;
  }
  if (ctx.sceneModel && ctx.gltfData.animations && ctx.gltfData.animations.length > 0) {
    return parseSceneWithTransforms(ctx, scene);
  }
  for (let i = 0, len = nodes.length; i < len && !ctx.nodesHaveNames; i++) {
    const node = nodes[i];
    if (testIfNodesHaveNames(node)) {
      ctx.nodesHaveNames = true;
    }
  }
  // Optional root transform pre-multiplied into every node's world matrix.
  // Used by the 3D Tiles loader to place a tile's glTF content with the tile's
  // composed world transform without baking it into the geometry.
  const rootMatrix = ctx.options.rootMatrix || null;
  if (!ctx.nodesHaveNames) {
    //   ctx.log(`Warning: No "name" attributes found on glTF scene nodes - objects in XKT may not be what you expect`);
    ctx.meshIds = [];
    for (let i = 0, len = nodes.length; i < len; i++) {
      const node = nodes[i];
      if (!parseNodesWithoutNames(ctx, node, 0, rootMatrix)) {
        return false;
      }
    }
  } else {
    ctx.meshIds = null;
    for (let i = 0, len = nodes.length; i < len; i++) {
      const node = nodes[i];
      if (!parseNodesWithNames(ctx, node, 0, rootMatrix)) {
        return false;
      }
    }
  }
  return true;
}

function parseSceneWithTransforms(ctx: ParsingContext, scene: any): boolean {
  const nodes = scene.nodes || [];
  const rootMatrix = ctx.options.rootMatrix || null;
  ctx.nodeTransformIds = new Map();
  ctx.usedTransformIds = new Set(Object.keys(ctx.sceneModel!.transforms));
  ctx.usedObjectIds = new Set(Object.keys(ctx.sceneModel!.objects));

  for (let i = 0, len = nodes.length; i < len; i++) {
    if (!createNodeTransforms(ctx, nodes[i], undefined, rootMatrix)) {
      return false;
    }
  }

  for (let i = 0, len = nodes.length; i < len; i++) {
    if (!parseNodeWithTransforms(ctx, nodes[i])) {
      return false;
    }
  }

  return true;
}

function createNodeTransforms(ctx: ParsingContext, node: any, parentTransformId?: string, rootMatrix?: Mat4 | null): boolean {
  if (!node) {
    return true;
  }
  const nodeIndex = ctx.gltfData.nodes.indexOf(node);
  if (nodeIndex < 0) {
    ctx.errors.push("[GLTFLoader.load] Animated glTF node not found in node table");
    return false;
  }
  const transformId = uniqueResourceId(
    sanitizeGLTFId(node.name) || `gltfNode-${nodeIndex}`,
    ctx.usedTransformIds!
  );
  ctx.nodeTransformIds!.set(nodeIndex, transformId);

  const localMatrix = parseNodeMatrix(node, null) || identityMat4(createMat4Float64());
  const matrix = rootMatrix && !parentTransformId
    ? mulMat4(rootMatrix, localMatrix, createMat4Float64())
    : localMatrix;
  const result = ctx.sceneModel!.createTransform({
    id: transformId,
    matrix: createMat4Float64(matrix),
    parentTransformId
  });
  if (result.ok === false) {
    ctx.errors.push(`[GLTFLoader.load] Failed to create SceneTransform -> ${result.error}`);
    return false;
  }

  if (node.children) {
    const children = node.children;
    for (let i = 0, len = children.length; i < len; i++) {
      if (!createNodeTransforms(ctx, children[i], transformId, null)) {
        return false;
      }
    }
  }
  return true;
}

function parseNodeWithTransforms(ctx: ParsingContext, node: any): boolean {
  if (!node) {
    return true;
  }
  const nodeIndex = ctx.gltfData.nodes.indexOf(node);
  const transformId = ctx.nodeTransformIds?.get(nodeIndex);
  if (!transformId) {
    ctx.errors.push("[GLTFLoader.load] Missing SceneTransform for animated glTF node");
    return false;
  }

  if (node.mesh) {
    const meshIds: string[] = [];
    if (!parseMesh(node, ctx, identityMat4(createMat4Float64()), meshIds, transformId)) {
      return false;
    }
    if (meshIds.length > 0) {
      const objectId = uniqueResourceId(
        sanitizeGLTFId(node.name) || `entity-${ctx.baseId}-${ctx.nextId++}`,
        ctx.usedObjectIds!
      );
      const result = ctx.sceneModel!.createObject({
        id: objectId,
        meshIds,
        layerId: ctx.options.layerId
      });
      if (result.ok === false) {
        ctx.errors.push(`[GLTFLoader.load] Failed to create SceneObject -> ${result.error}`);
        return false;
      }
    }
  }

  if (node.children) {
    const children = node.children;
    for (let i = 0, len = children.length; i < len; i++) {
      if (!parseNodeWithTransforms(ctx, children[i])) {
        return false;
      }
    }
  }

  return true;
}

function createPrimitiveHash(ctx, primitive) {
  const hash = [ctx.baseId];
  const attributes = primitive.attributes;
  if (attributes) {
    for (const key in attributes) {
      hash.push(attributes[key].id);
      hash.push(attributes[key].count);
    }
  }
  hash.push(primitive.mode);
  if (primitive.indices) {
    hash.push(primitive.indices.id);
    hash.push(primitive.indices.count);
  }
  if (primitive.targets) {
    for (const target of primitive.targets) {
      hash.push("target");
      const targetKeys = Object.keys(target).sort();
      for (const key of targetKeys) {
        const attribute = target[key];
        hash.push(key);
        hash.push(typeof attribute === "number" ? attribute : (attribute?.id ?? ""));
        hash.push(typeof attribute === "number" ? "" : (attribute?.count ?? ""));
      }
    }
  }
  return hash.join(".");
}

function testIfNodesHaveNames(node, level = 0): boolean {
  if (!node) {
    return false;
  }
  if (node.name) {
    return true;
  }
  if (node.children) {
    const children = node.children;
    for (let i = 0, len = children.length; i < len; i++) {
      const childNode = children[i];
      if (testIfNodesHaveNames(childNode, level + 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parses a glTF node hierarchy that is known to NOT contain "name" attributes on the nodes.
 * Create a XKTMesh for each mesh primitive, and a single XKTEntity.
 */
// State lives on `ctx` (not in a closure) so concurrent glTF loads — e.g. the
// 3D Tiles streamer decoding several tiles at once — don't corrupt each other.
function parseNodesWithoutNames(ctx, node, depth, matrix): boolean {
  if (!node) {
    return true;
  }
  const meshIds = ctx.meshIds;
  matrix = parseNodeMatrix(node, matrix);
  if (node.mesh) {
    parseMesh(node, ctx, matrix, meshIds);
  }
  if (node.children) {
    const children = node.children;
    for (let i = 0, len = children.length; i < len; i++) {
      const childNode = children[i];
      parseNodesWithoutNames(ctx, childNode, depth + 1, matrix);
    }
  }
  if (depth === 0) {
    const objectId = `entity-${ctx.baseId}-${ctx.nextId++}`;
    if (meshIds && meshIds.length > 0) {
      const result = ctx.sceneModel.createObject({
        id: objectId,
        meshIds,
        layerId: ctx.options.layerId
      });
      if (result.ok === false) {
        ctx.errors.push(`[GLTFLoader.load] Failed to create SceneObject -> ${result.error}`);
        return false;
      }
      meshIds.length = 0;
    }
  }
  return true;
}


/**
 * Parses a glTF node hierarchy that is known to contain "name" attributes on the nodes.
 *
 * Create a XKTMesh for each mesh primitive, and XKTEntity for each named node.
 *
 * Following a depth-first traversal, each XKTEntity is created on post-visit of each named node,
 * and gets all the XKTMeshes created since the last XKTEntity created.
 */
// State lives on `ctx` (not in a closure) so concurrent glTF loads don't
// corrupt each other (see parseNodesWithoutNames).
function parseNodesWithNames(ctx, node, depth, matrix): boolean {
    const objectIdStack = ctx.objectIdStack;
    const meshIdsStack = ctx.meshIdsStack;
    if (!node) {
      return true;
    }
    matrix = parseNodeMatrix(node, matrix);
    if (node.name) {
      ctx.meshIds = [];
      let objectId = node.name;
      // Some exporters (notably 3DS Max) emit duplicate node names like
      // `3DSMeshMatrix` across many nodes. We can't fail the whole load
      // on that — synthesize a unique fallback ID instead and warn once
      // per duplicate so the issue is still visible in the console.
      if (objectId && ctx.sceneModel.objects[objectId]) {
        console.warn(`[GLTFLoader.load] Duplicate glTF node 'name' attribute: '${objectId}' — assigning a synthetic ID`);
        objectId = "";
      }
      while (!objectId || ctx.sceneModel.objects[objectId]) {
        objectId = `entity-${ctx.baseId}-${ctx.nextId++}`;
      }
      objectIdStack.push(objectId);
      meshIdsStack.push(ctx.meshIds);
    }
    if (ctx.meshIds && node.mesh) {
      if (!parseMesh(node, ctx, matrix, ctx.meshIds)) {
        return false;
      }
    }
    if (node.children) {
      const children = node.children;
      for (let i = 0, len = children.length; i < len; i++) {
        const childNode = children[i];
        if (!parseNodesWithNames(ctx, childNode, depth + 1, matrix)) {
          return false;
        }
      }
    }
    const nodeName = node.name;
    if ((nodeName !== undefined && nodeName !== null) || depth === 0) {
      let objectId = objectIdStack.pop();
      if (!objectId) { // For when there are no nodes with names
        objectId = `entity-${ctx.baseId}-${ctx.nextId++}`;
      }
      const entityMeshIds = meshIdsStack.pop();
      if (ctx.meshIds && ctx.meshIds.length > 0) {
        const result = ctx.sceneModel.createObject({
          id: objectId,
          meshIds: entityMeshIds
        });
        if (result.ok === false) {
          ctx.errors.push(`[GLTFLoader.load] Failed to create SceneObject -> ${result.error}`);
          return false;
        }
      }
      ctx.meshIds = meshIdsStack.length > 0 ? meshIdsStack[meshIdsStack.length - 1] : null;
    }
    return true;
}

function parseNodeMatrix(node, matrix) {
  if (!node) {
    return;
  }
  let localMatrix;
  if (node.matrix) {
    localMatrix = node.matrix;
    if (matrix) {
      matrix = mulMat4(matrix, localMatrix, createMat4Float64());
    } else {
      matrix = localMatrix;
    }
  }
  if (node.translation) {
    localMatrix = translationMat4v(node.translation);
    if (matrix) {
      matrix = mulMat4(matrix, localMatrix, createMat4Float64());
    } else {
      matrix = localMatrix;
    }
  }
  if (node.rotation) {
    localMatrix = quatToMat4(node.rotation);
    if (matrix) {
      matrix = mulMat4(matrix, localMatrix, createMat4Float64());
    } else {
      matrix = localMatrix;
    }
  }
  if (node.scale) {
    localMatrix = scalingMat4v(node.scale);
    if (matrix) {
      matrix = mulMat4(matrix, localMatrix, createMat4Float64());
    } else {
      matrix = localMatrix;
    }
  }
  return matrix;
}

function parseMesh(node: any, ctx: ParsingContext, matrix: Mat4, meshIds: string[], parentTransformId?: string): boolean {

  if (node.mesh) {

    const mesh = node.mesh;
    const numPrimitives = mesh.primitives.length;

    for (let i = 0; i < numPrimitives; i++) {
      const primitive = mesh.primitives[i];

      // A primitive whose EXT_mesh_features feature id is a per-vertex attribute
      // bound to a property table is split into one SceneObject per feature, so
      // each feature is an individually pickable object linked to its metadata.
      if (splitPrimitiveByFeature(ctx, primitive, matrix)) {
        continue;
      }

      const geometryId = createPrimitiveHash(ctx, primitive);

      //  geometryId = createUUID();
      if (!ctx.sceneModel.geometries[geometryId]) {
        const POSITION = primitive.attributes.POSITION;
        if (!POSITION) {
          ctx.errors.push(`[GLTFLoader.load] Primitive has no POSITION attribute`);
          return false;
        }
        const geometryParams: SceneGeometryParams = {
          id: geometryId,
          primitive: 0,
          // @ts-ignore
          positions: undefined
        };
        switch (primitive.mode) {
          case 0: // POINTS
            geometryParams.primitive = PointsPrimitive;
            break;
          case 1: // LINES
            geometryParams.primitive = LinesPrimitive;
            break;
          case 2: // LINE_LOOP
            geometryParams.primitive = LinesPrimitive;
            break;
          case 3: // LINE_STRIP
            geometryParams.primitive = LinesPrimitive;
            break;
          case 4: // TRIANGLES
            geometryParams.primitive = TrianglesPrimitive;
            break;
          case 5: // TRIANGLE_STRIP
            geometryParams.primitive = TrianglesPrimitive;
            break;
          case 6: // TRIANGLE_FAN
            geometryParams.primitive = TrianglesPrimitive;
            break;
          default:
            geometryParams.primitive = TrianglesPrimitive;
        }
        geometryParams.positions = primitive.attributes.POSITION.value;
        if (primitive.attributes.COLOR_0) {
          geometryParams.colors = primitive.attributes.COLOR_0.value;
        }
        if (!ctx.options.ignoreNormals && primitive.attributes.NORMAL) {
          geometryParams.normals = primitive.attributes.NORMAL.value;
        }
        if (!ctx.options.ignoreUVs) {
          const texCoords = extractTexCoordChannels(primitive.attributes);
          if (texCoords) {
            geometryParams.texCoords = texCoords;
            if (texCoords[0]) {
              geometryParams.uvs = texCoords[0];
            }
          }
        }
        if (primitive.indices) {
          geometryParams.indices = indicesForPrimitiveMode(primitive.mode, primitive.indices.value);
        } else {
          const implicitIndices = implicitSequentialIndices(POSITION.value.length / 3);
          const expanded = indicesForPrimitiveMode(primitive.mode, implicitIndices);
          if (expanded !== implicitIndices || primitive.mode === 1) {
            geometryParams.indices = expanded;
          }
        }
        const morphTargets = buildMorphTargets(
          geometryParams.positions,
          geometryParams.normals,
          primitive.targets,
          ctx.gltfData.accessors,
          !!ctx.options.ignoreNormals
        );
        if (morphTargets) {
          geometryParams.morphTargets = morphTargets;
        }
        // @ts-ignore
        const result = ctx.sceneModel.createGeometry(geometryParams);
        if (result.ok === false) {
          ctx.errors.push(`[GLTFLoader.load] Failed to create SceneGeometry -> ${result.error}`);
          return false;
        }
      }

      const meshId = `${ctx.baseId}-${ctx.nextId++}`;
      const meshParams: SceneMeshParams = {
        id: meshId,
        geometryId,
        matrix: parentTransformId ? identityMat4(createMat4Float64()) : (matrix ? createMat4Float64(matrix) : identityMat4(createMat4Float64())),
        materialId: undefined
      };
      if (parentTransformId) {
        meshParams.parentTransformId = parentTransformId;
      }
      const material = primitive.material;
      if (material && material._materialId) {
        meshParams.materialId = material._materialId;
      } else {
        meshParams.color = [1.0, 1.0, 1.0];
        meshParams.opacity = 1.0;
      }
      const morphWeightCount = primitive.targets?.length ?? 0;
      if (morphWeightCount > 0) {
        meshParams.morphWeights = defaultMorphWeights(node, mesh, morphWeightCount);
      }
      // @ts-ignore
      const result = ctx.sceneModel.createMesh(meshParams);
      if (result.ok === false) {
        ctx.errors.push(`[GLTFLoader.load] Failed to create SceneMesh -> ${result.error}`);
        return false;
      }
      meshIds.push(meshId);
    }
  }

  return true;
}

function parseAnimations(ctx: ParsingContext): boolean {
  if (!ctx.sceneModel || !ctx.gltfData.animations || ctx.gltfData.animations.length === 0) {
    return true;
  }
  if (!ctx.nodeTransformIds) {
    // Static import path intentionally bakes node transforms into mesh matrices.
    return true;
  }

  const usedAnimationIds = new Set(Object.keys(ctx.sceneModel.animations));
  for (let animationIdx = 0; animationIdx < ctx.gltfData.animations.length; animationIdx++) {
    const gltfAnimation = ctx.gltfData.animations[animationIdx];
    const channels: SceneAnimationParams["channels"] = [];
    const animationId = uniqueResourceId(
      sanitizeGLTFId(gltfAnimation.name) || `animation-${animationIdx}`,
      usedAnimationIds
    );

    for (const channel of gltfAnimation.channels || []) {
      const target = channel.target;
      const targetNodeIndex = typeof target.node === "number"
        ? target.node
        : ctx.gltfData.nodes.indexOf(target.node);
      const transformId = ctx.nodeTransformIds.get(targetNodeIndex);
      if (!transformId) {
        ctx.errors.push(`[GLTFLoader.load] Animation channel targets missing node ${target.node}`);
        return false;
      }
      const property = gltfAnimationPathToSceneProperty(target.path);
      if (!property) {
        ctx.errors.push(`[GLTFLoader.load] Unsupported glTF animation target path '${target.path}'`);
        return false;
      }
      const sampler = gltfAnimation.samplers[channel.sampler];
      if (!sampler) {
        ctx.errors.push(`[GLTFLoader.load] Animation channel references missing sampler ${channel.sampler}`);
        return false;
      }
      if (sampler.interpolation && sampler.interpolation !== "LINEAR" && sampler.interpolation !== "STEP") {
        ctx.errors.push(`[GLTFLoader.load] Unsupported glTF animation interpolation '${sampler.interpolation}'`);
        return false;
      }
      const timesAccessor = ctx.gltfData.accessors[sampler.input];
      const valuesAccessor = ctx.gltfData.accessors[sampler.output];
      if (!timesAccessor?.value || !valuesAccessor?.value) {
        ctx.errors.push("[GLTFLoader.load] Animation sampler is missing decoded input/output accessors");
        return false;
      }
      channels.push({
        target: {
          type: "transform",
          transformId,
          property
        },
        sampler: {
          times: timesAccessor.value,
          values: valuesAccessor.value,
          interpolation: sampler.interpolation === "STEP" ? "STEP" : "LINEAR"
        }
      });
    }

    if (channels.length > 0) {
      const result = ctx.sceneModel.createAnimation({
        id: animationId,
        name: gltfAnimation.name,
        channels
      });
      if (result.ok === false) {
        ctx.errors.push(`[GLTFLoader.load] Failed to create SceneAnimation -> ${result.error}`);
        return false;
      }
    }
  }

  return true;
}

function gltfAnimationPathToSceneProperty(path: string): SceneAnimationTransformProperty | undefined {
  switch (path) {
    case "translation":
      return "translation";
    case "rotation":
      return "rotation";
    case "scale":
      return "scale";
    default:
      return undefined;
  }
}

function sanitizeGLTFId(id: string | undefined): string {
  return typeof id === "string" ? id.trim() : "";
}

function uniqueResourceId(baseId: string, usedIds: Set<string>): string {
  let id = baseId || "resource";
  if (!usedIds.has(id)) {
    usedIds.add(id);
    return id;
  }
  let suffix = 1;
  while (usedIds.has(`${id}-${suffix}`)) {
    suffix++;
  }
  id = `${id}-${suffix}`;
  usedIds.add(id);
  return id;
}

function implicitSequentialIndices(vertexCount: number): Uint32Array {
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    indices[i] = i;
  }
  return indices;
}

function indicesForPrimitiveMode(mode: number | undefined, indices: IntArrayParam): IntArrayParam {
  switch (mode) {
    case 2: // LINE_LOOP
      return expandLineLoopIndices(indices);
    case 3: // LINE_STRIP
      return expandLineStripIndices(indices);
    case 1: // LINES
      return indices.length % 2 === 0 ? indices : copyIndices(indices, indices.length - 1);
    default:
      return indices;
  }
}

function expandLineStripIndices(indices: ArrayLike<number>): Uint32Array {
  if (indices.length < 2) {
    return new Uint32Array(0);
  }
  const expanded = new Uint32Array((indices.length - 1) * 2);
  for (let i = 0, cursor = 0; i < indices.length - 1; i++) {
    expanded[cursor++] = indices[i];
    expanded[cursor++] = indices[i + 1];
  }
  return expanded;
}

function expandLineLoopIndices(indices: ArrayLike<number>): Uint32Array {
  if (indices.length < 2) {
    return new Uint32Array(0);
  }
  const expanded = new Uint32Array(indices.length * 2);
  for (let i = 0, cursor = 0; i < indices.length; i++) {
    expanded[cursor++] = indices[i];
    expanded[cursor++] = indices[(i + 1) % indices.length];
  }
  return expanded;
}

function copyIndices(indices: ArrayLike<number>, length: number): Uint32Array {
  const copied = new Uint32Array(Math.max(0, length));
  for (let i = 0; i < copied.length; i++) {
    copied[i] = indices[i];
  }
  return copied;
}

function buildMorphTargets(
  basePositions: ArrayLike<number>,
  baseNormals: ArrayLike<number> | undefined,
  targets: any[] | undefined,
  accessors: any[] | undefined,
  ignoreNormals: boolean
): SceneGeometryMorphTargetParams[] | undefined {
  if (!targets || targets.length === 0) {
    return undefined;
  }
  const validTargets = targets
    .map((target, index) => ({
      id: `morphTarget-${index}`,
      name: target.name,
      positionDelta: attributeValue(target.POSITION, accessors),
      normalDelta: attributeValue(target.NORMAL, accessors)
    }))
    .filter((target) => target.positionDelta && target.positionDelta.length === basePositions.length);

  if (validTargets.length === 0) {
    return undefined;
  }

  const includeNormals = !ignoreNormals
    && !!baseNormals
    && baseNormals.length === basePositions.length
    && validTargets.every((target) => target.normalDelta && target.normalDelta.length === basePositions.length);

  return validTargets.map((target) => ({
    id: target.id,
    name: target.name,
    positions: copyFloatArray(target.positionDelta!),
    normals: includeNormals ? copyFloatArray(target.normalDelta!) : undefined
  }));
}

function defaultMorphWeights(node: any, mesh: any, morphWeightCount: number): number[] {
  const authoredWeights = node.weights ?? mesh.weights;
  const weights = new Array(morphWeightCount);
  for (let i = 0; i < morphWeightCount; i++) {
    const weight = authoredWeights?.[i];
    weights[i] = Number.isFinite(weight) ? weight : 0;
  }
  return weights;
}

function attributeValue(attribute: any, accessors?: any[]): ArrayLike<number> | undefined {
  if (typeof attribute === "number") {
    return accessors?.[attribute]?.value;
  }
  return attribute?.value ?? attribute;
}

function copyFloatArray(values: ArrayLike<number>): Float32Array {
  const copied = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    copied[i] = values[i];
  }
  return copied;
}

/**
 * If `primitive` is a triangle mesh whose `EXT_mesh_features` declares a feature
 * id carried by a per-vertex attribute (`_FEATURE_ID_n`) and bound to a property
 * table, splits it into one geometry + mesh + SceneObject per distinct feature
 * value and returns `true` (the caller then skips its normal per-primitive
 * path). Each SceneObject's id is {@link featureObjectId}, matching the feature's
 * property-table DataObject so the two are the same logical object. Returns
 * `false` for any primitive without that structure, leaving it to the normal
 * path.
 *
 * Triangles by feature: a triangle belongs to the feature of its first corner
 * (feature regions don't straddle triangles in well-formed assets). Feature
 * id textures, non-triangle primitives, and vertex colours are not split.
 */
function splitPrimitiveByFeature(ctx: ParsingContext, primitive: any, matrix: Mat4): boolean {
  if (primitive.mode != null && primitive.mode !== 4) {
    return false;
  }
  const featureId = primitive.extensions?.EXT_mesh_features?.featureIds?.find(
    (f: any) => f.attribute != null && f.propertyTable != null,
  );
  if (!featureId) {
    return false;
  }
  const featureValues = primitive.attributes[`_FEATURE_ID_${featureId.attribute}`]?.value;
  const positions = primitive.attributes.POSITION?.value;
  if (!featureValues || !positions) {
    return false;
  }
  const normals = ctx.options.ignoreNormals ? undefined : primitive.attributes.NORMAL?.value;
  const uvs = ctx.options.ignoreUVs ? undefined : primitive.attributes.TEXCOORD_0?.value;
  const srcIndices = primitive.indices?.value;
  const triangleCount = srcIndices ? srcIndices.length / 3 : positions.length / 9;

  const cornersByFeature = new Map<number, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    const a = srcIndices ? srcIndices[t * 3] : t * 3;
    const b = srcIndices ? srcIndices[t * 3 + 1] : t * 3 + 1;
    const c = srcIndices ? srcIndices[t * 3 + 2] : t * 3 + 2;
    const feature = featureValues[a];
    let corners = cornersByFeature.get(feature);
    if (!corners) {
      corners = [];
      cornersByFeature.set(feature, corners);
    }
    corners.push(a, b, c);
  }

  let materialId: string | undefined;
  const material = primitive.material;
  if (material && material._materialId) {
    materialId = material._materialId;
  }

  for (const [feature, corners] of cornersByFeature) {
    const remap = new Map<number, number>();
    const outPositions: number[] = [];
    const outNormals: number[] | null = normals ? [] : null;
    const outUvs: number[] | null = uvs ? [] : null;
    const outIndices: number[] = [];
    for (const v of corners) {
      let local = remap.get(v);
      if (local === undefined) {
        local = remap.size;
        remap.set(v, local);
        outPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        if (outNormals) outNormals.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        if (outUvs) outUvs.push(uvs[v * 2], uvs[v * 2 + 1]);
      }
      outIndices.push(local);
    }

    const objectId = featureObjectId(ctx.baseId, featureId.propertyTable, feature);
    const geometryId = `${objectId}-geometry`;
    const geometryParams: SceneGeometryParams = {
      id: geometryId,
      primitive: TrianglesPrimitive,
      positions: new Float32Array(outPositions),
      indices: new Uint32Array(outIndices),
    };
    if (outNormals) geometryParams.normals = new Float32Array(outNormals);
    if (outUvs) geometryParams.uvs = new Float32Array(outUvs);
    if (ctx.sceneModel.createGeometry(geometryParams).ok === false) {
      continue;
    }

    const meshId = `${objectId}-mesh`;
    const meshParams: SceneMeshParams = {
      id: meshId,
      geometryId,
      matrix: matrix ? createMat4Float64(matrix) : identityMat4(createMat4Float64()),
      materialId,
    };
    if (!materialId) {
      meshParams.color = [1.0, 1.0, 1.0];
      meshParams.opacity = 1.0;
    }
    if (ctx.sceneModel.createMesh(meshParams).ok === false) {
      continue;
    }
    ctx.sceneModel.createObject({id: objectId, meshIds: [meshId], layerId: ctx.options.layerId});
  }
  return true;
}
