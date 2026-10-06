import type {ModelParser} from "../../../ModelParser";
import type {LoaderProgress} from "../../../LoaderProgress";
import {TrianglesPrimitive} from "../../../../base/constants";
import {createUUID, yieldToHost} from "../../../../base/utils";
import type {SceneGeometryParams} from "../../../../model/scene";
import {attr, child, children, descendants, parseXML, type XMLNode} from "./xml";

const INCH_TO_METER = 0.0254;

export const parse: ModelParser = async (params, options = {}) => {
  const {fileData, sceneModel, dataModel} = params;
  const onProgress: ((p: LoaderProgress) => void) | undefined = options.onProgress;
  const signal: AbortSignal | undefined = options.signal;
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

  if (fileData instanceof ArrayBuffer) {
    throw new Error("[ColladaLoader] Native .skp ArrayBuffer input is not supported; load a COLLADA .dae export instead.");
  }

  const root = parseXML(String(fileData || ""));
  const collada = child(root, "COLLADA");
  if (!collada) {
    throw new Error("[ColladaLoader] Expected COLLADA .dae text.");
  }

  const unitScale = readUnitScale(collada, options.units || "meters");
  const materials = readMaterials(collada);
  const geometries = readGeometries(collada, unitScale);
  const nodes = descendants(child(collada, "library_visual_scenes"), "node");
  const instanceNodes = nodes.filter((node) => descendants(node, "instance_geometry").length > 0);

  for (let i = 0, len = instanceNodes.length; i < len; i++) {
    if ((i & 0x1F) === 0) {
      await step("Importing COLLADA", i, len);
    }
    importNode(instanceNodes[i], geometries, materials, sceneModel, dataModel, options.layerId);
  }

  await step("Importing COLLADA", instanceNodes.length, instanceNodes.length);
};

interface ParsedMaterial {
  id: string;
  color: [number, number, number];
  opacity: number;
}

interface ParsedGeometry {
  id: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  materialSymbol: string;
}

interface SourceData {
  stride: number;
  values: number[];
}

function readUnitScale(collada: XMLNode, targetUnits: string): number {
  const meter = Number(attr(child(child(collada, "asset"), "unit"), "meter") || 1);
  const toMeters = Number.isFinite(meter) && meter > 0 ? meter : 1;
  return targetUnits === "inches" ? toMeters / INCH_TO_METER : toMeters;
}

function readMaterials(collada: XMLNode): Map<string, ParsedMaterial> {
  const effects = new Map<string, ParsedMaterial>();
  for (const effect of children(child(collada, "library_effects"), "effect")) {
    const colorNode = descendants(effect, "diffuse")[0] ? child(descendants(effect, "diffuse")[0], "color") : undefined;
    const transparentNode = descendants(effect, "transparent")[0] ? child(descendants(effect, "transparent")[0], "color") : undefined;
    const transparencyNode = descendants(effect, "transparency")[0] ? child(descendants(effect, "transparency")[0], "float") : undefined;
    const rgba = parseNumbers(colorNode?.text || "0.8 0.8 0.8 1");
    const transparent = parseNumbers(transparentNode?.text || "");
    const transparencyText = (transparencyNode?.text || "").trim();
    const transparency = transparencyText ? Number(transparencyText) : NaN;
    let opacity = rgba[3] ?? 1;
    if (Number.isFinite(transparency)) {
      opacity *= transparency;
    }
    if (transparent.length >= 4) {
      opacity *= transparent[3];
    }
    effects.set(`#${attr(effect, "id")}`, {
      id: attr(effect, "id") || createUUID(),
      color: [rgba[0] ?? 0.8, rgba[1] ?? 0.8, rgba[2] ?? 0.8],
      opacity: clamp01(opacity)
    });
  }

  const materials = new Map<string, ParsedMaterial>();
  for (const material of children(child(collada, "library_materials"), "material")) {
    const instanceEffect = child(material, "instance_effect");
    const parsed = effects.get(attr(instanceEffect, "url"));
    if (parsed) {
      materials.set(attr(material, "id"), {...parsed, id: attr(material, "id") || parsed.id});
    }
  }
  return materials;
}

function readGeometries(collada: XMLNode, unitScale: number): Map<string, ParsedGeometry> {
  const result = new Map<string, ParsedGeometry>();
  for (const geometry of children(child(collada, "library_geometries"), "geometry")) {
    const mesh = child(geometry, "mesh");
    if (!mesh) {
      continue;
    }
    const sources = readSources(mesh);
    const verticesMap = readVertices(mesh);
    const primitive = child(mesh, "triangles") || child(mesh, "polylist");
    if (!primitive) {
      continue;
    }
    const parsed = buildGeometry(attr(geometry, "id") || createUUID(), primitive, sources, verticesMap, unitScale);
    if (parsed.positions.length > 0 && parsed.indices.length > 0) {
      result.set(`#${attr(geometry, "id")}`, parsed);
    }
  }
  return result;
}

function readSources(mesh: XMLNode): Map<string, SourceData> {
  const result = new Map<string, SourceData>();
  for (const source of children(mesh, "source")) {
    const array = child(source, "float_array");
    if (!array) {
      continue;
    }
    const accessor = child(child(source, "technique_common"), "accessor");
    result.set(`#${attr(source, "id")}`, {
      stride: Math.max(1, Number(attr(accessor, "stride") || 1)),
      values: parseNumbers(array.text)
    });
  }
  return result;
}

function readVertices(mesh: XMLNode): Map<string, string> {
  const result = new Map<string, string>();
  for (const vertices of children(mesh, "vertices")) {
    const position = children(vertices, "input").find((input) => attr(input, "semantic") === "POSITION");
    if (position) {
      result.set(`#${attr(vertices, "id")}`, attr(position, "source"));
    }
  }
  return result;
}

function buildGeometry(id: string, primitive: XMLNode, sources: Map<string, SourceData>, verticesMap: Map<string, string>, unitScale: number): ParsedGeometry {
  const inputs = children(primitive, "input").map((input) => ({
    semantic: attr(input, "semantic"),
    source: attr(input, "semantic") === "VERTEX" ? verticesMap.get(attr(input, "source")) || attr(input, "source") : attr(input, "source"),
    offset: Number(attr(input, "offset") || 0)
  }));
  const tupleSize = Math.max(1, ...inputs.map((input) => input.offset + 1));
  const raw = parseNumbers(child(primitive, "p")?.text || "").map((value) => value | 0);
  const vcount = primitive.name === "polylist" ? parseNumbers(child(primitive, "vcount")?.text || "").map((value) => value | 0) : [];
  const working: ParsedGeometry = {id, positions: [], normals: [], uvs: [], indices: [], materialSymbol: attr(primitive, "material")};
  const vertexMap = new Map<string, number>();
  let cursor = 0;

  const emitVertex = (tupleOffset: number): number => {
    const key = inputs.map((input) => raw[tupleOffset + input.offset]).join("/");
    const existing = vertexMap.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const vertexIndex = working.positions.length / 3;
    vertexMap.set(key, vertexIndex);
    for (const input of inputs) {
      const source = sources.get(input.source);
      const index = raw[tupleOffset + input.offset];
      if (!source || index === undefined) {
        continue;
      }
      const sourceOffset = index * source.stride;
      if (input.semantic === "VERTEX") {
        working.positions.push(
          (source.values[sourceOffset] || 0) * unitScale,
          (source.values[sourceOffset + 1] || 0) * unitScale,
          (source.values[sourceOffset + 2] || 0) * unitScale
        );
      } else if (input.semantic === "NORMAL") {
        working.normals.push(
          source.values[sourceOffset] || 0,
          source.values[sourceOffset + 1] || 0,
          source.values[sourceOffset + 2] || 0
        );
      } else if (input.semantic === "TEXCOORD") {
        working.uvs.push(source.values[sourceOffset] || 0, source.values[sourceOffset + 1] || 0);
      }
    }
    return vertexIndex;
  };

  if (primitive.name === "triangles") {
    for (let i = 0; i < raw.length; i += tupleSize * 3) {
      working.indices.push(emitVertex(i), emitVertex(i + tupleSize), emitVertex(i + tupleSize * 2));
    }
    return working;
  }

  for (const count of vcount) {
    const first = emitVertex(cursor);
    let previous = emitVertex(cursor + tupleSize);
    for (let i = 2; i < count; i++) {
      const current = emitVertex(cursor + tupleSize * i);
      working.indices.push(first, previous, current);
      previous = current;
    }
    cursor += count * tupleSize;
  }
  return working;
}

function importNode(node: XMLNode, geometries: Map<string, ParsedGeometry>, materials: Map<string, ParsedMaterial>, sceneModel: any, dataModel: any, layerId?: string): void {
  const matrix = parseMatrix(child(node, "matrix")?.text);
  const meshIds: string[] = [];
  for (const instance of descendants(node, "instance_geometry")) {
    const geometry = geometries.get(attr(instance, "url"));
    if (!geometry) {
      continue;
    }
    const geometryId = createUUID();
    const geometryCfg: SceneGeometryParams = {
      id: geometryId,
      primitive: TrianglesPrimitive,
      positions: geometry.positions.slice(),
      indices: geometry.indices.slice()
    };
    const vertexCount = geometry.positions.length / 3;
    if (geometry.normals.length === vertexCount * 3) {
      geometryCfg.normals = geometry.normals.slice();
    }
    if (geometry.uvs.length === vertexCount * 2) {
      geometryCfg.uvs = geometry.uvs.slice();
    }
    const geometryResult = sceneModel?.createGeometry(geometryCfg);
    if (geometryResult && geometryResult.ok !== true) {
      throw new Error(`[ColladaLoader] Failed to create geometry '${geometry.id}': ${geometryResult.error || "unknown error"}`);
    }
    const material = resolveMaterial(instance, geometry.materialSymbol, materials);
    if (material && sceneModel && !sceneModel.materials?.[material.id]) {
      const materialResult = sceneModel.createMaterial({
        id: material.id,
        color: material.color,
        opacity: material.opacity,
        alphaMode: material.opacity < 1 ? "BLEND" : "OPAQUE"
      });
      if (materialResult.ok !== true) {
        throw new Error(`[ColladaLoader] Failed to create material '${material.id}': ${materialResult.error || "unknown error"}`);
      }
    }
    const meshId = createUUID();
    const meshResult = sceneModel?.createMesh({
      id: meshId,
      geometryId,
      materialId: material?.id,
      color: material?.color || [0.8, 0.8, 0.8],
      opacity: material?.opacity ?? 1,
      matrix
    });
    if (meshResult && meshResult.ok !== true) {
      throw new Error(`[ColladaLoader] Failed to create mesh for '${geometry.id}': ${meshResult.error || "unknown error"}`);
    }
    meshIds.push(meshId);
  }
  if (meshIds.length === 0) {
    return;
  }
  const objectId = attr(node, "id") || attr(node, "name") || createUUID();
  const objectResult = sceneModel?.createObject({id: objectId, meshIds, layerId});
  if (objectResult && objectResult.ok !== true) {
    throw new Error(`[ColladaLoader] Failed to create object '${objectId}': ${objectResult.error || "unknown error"}`);
  }
  dataModel?.createObject?.({id: objectId, type: "ColladaNode", name: attr(node, "name") || objectId});
}

function resolveMaterial(instance: XMLNode, symbol: string, materials: Map<string, ParsedMaterial>): ParsedMaterial | undefined {
  const instanceMaterial = descendants(instance, "instance_material").find((node) => attr(node, "symbol") === symbol) || descendants(instance, "instance_material")[0];
  const target = attr(instanceMaterial, "target").replace(/^#/, "");
  return materials.get(target) || materials.get(symbol);
}

function parseMatrix(source: string | undefined): number[] | undefined {
  const values = parseNumbers(source || "");
  return values.length === 16 ? values : undefined;
}

function parseNumbers(text: string): number[] {
  return text.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}
