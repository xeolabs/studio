import {LinesPrimitive, PointsPrimitive, TrianglesPrimitive} from "../../../../base/constants";
import {yieldToHost} from "../../../../base/utils";
import type {Vec3} from "../../../../base/math/vector";
import type {LoaderProgress} from "../../../LoaderProgress";
import type {ModelParser} from "../../../ModelParser";
import type {GeoJSONLoadOptions} from "../../GeoJSONLoadOptions";

// @ts-ignore
import {earcut} from "../../../cityjson/versions/v1_0/earcut";

const SCHEMA = "geojson_7946";
const DEFAULT_POINT_COLOR: Vec3 = [0.9, 0.2, 0.16];
const DEFAULT_LINE_COLOR: Vec3 = [0.1, 0.32, 0.82];
const DEFAULT_POLYGON_COLOR: Vec3 = [0.22, 0.62, 0.36];

type GeoJSONPosition = number[];
type GeoJSONGeometry = {
  type: string;
  coordinates?: any;
  geometries?: GeoJSONGeometry[];
};
type GeoJSONFeature = {
  type: "Feature";
  id?: string | number;
  properties?: Record<string, any> | null;
  geometry?: GeoJSONGeometry | null;
};
type ParseFeature = {
  id: string;
  name: string;
  properties: Record<string, any> | null;
  geometry: GeoJSONGeometry | null;
};
type ParseContext = {
  sceneModel: any;
  dataModel: any;
  options: GeoJSONLoadOptions;
  errors: string[];
  nextId: number;
  origin: Vec3;
  scale: Vec3;
};

/**
 * @private
 */
export const parse: ModelParser = async (params, options: GeoJSONLoadOptions = {}) => {
  const {fileData, sceneModel, dataModel} = params;
  const features = collectFeatures(fileData);
  const origin = toVec3(options.origin || findFirstPosition(fileData) || [0, 0, 0]);
  const uniformScale = typeof options.scale === "number" ? options.scale : 1;
  const scale = typeof options.scale === "number" || options.scale === undefined
    ? toVec3([uniformScale, uniformScale, uniformScale])
    : toVec3(options.scale);
  const ctx: ParseContext = {
    sceneModel,
    dataModel,
    options,
    errors: [],
    nextId: 0,
    origin,
    scale
  };

  const onProgress: ((p: LoaderProgress) => void) | undefined = options.onProgress;
  const progress: LoaderProgress = {phase: "Parsing GeoJSON", current: 0, total: features.length};
  const step = async (current: number): Promise<void> => {
    if (onProgress) {
      progress.current = current;
      onProgress(progress);
    }
    await yieldToHost(options.signal);
  };

  for (let i = 0; i < features.length; i++) {
    if ((i & 0x1F) === 0) {
      await step(i);
    }
    parseFeature(ctx, features[i]);
  }
  await step(features.length);

  if (ctx.errors.length > 0) {
    throw new Error(`[GeoJSONLoader] Failed to parse GeoJSON file: ${ctx.errors[0]}`);
  }
};

function collectFeatures(fileData: any): ParseFeature[] {
  if (!fileData || typeof fileData.type !== "string") {
    throw new Error("[GeoJSONLoader] Expected a GeoJSON object with a type property");
  }
  if (fileData.type === "FeatureCollection") {
    const features = Array.isArray(fileData.features) ? fileData.features : [];
    const usedIds = new Set<string>();
    return features.map((feature, index) => normalizeFeature(feature, index, usedIds));
  }
  if (fileData.type === "Feature") {
    return [normalizeFeature(fileData, 0, new Set<string>())];
  }
  return [{
    id: "geojson-geometry",
    name: fileData.type,
    properties: null,
    geometry: fileData
  }];
}

function normalizeFeature(feature: GeoJSONFeature, index: number, usedIds: Set<string>): ParseFeature {
  const properties = feature.properties || null;
  const propertyId = properties && (properties.id || properties.ID || properties.objectid || properties.OBJECTID || properties.cartodb_id || properties.nid);
  const baseId = feature.id !== undefined ? String(feature.id) : (propertyId !== undefined ? String(propertyId) : `geojson-feature-${index}`);
  const id = uniqueFeatureId(baseId, index, usedIds);
  const nameValue = properties && (properties.name || properties.Name || properties.title || properties.nbrhood);
  return {
    id,
    name: nameValue !== undefined ? String(nameValue) : id,
    properties,
    geometry: feature.geometry || null
  };
}

function parseFeature(ctx: ParseContext, feature: ParseFeature): void {
  const meshIds: string[] = [];
  if (ctx.sceneModel && feature.geometry) {
    parseGeometry(ctx, feature, feature.geometry, meshIds);
  }
  if (ctx.sceneModel && meshIds.length > 0) {
    const result = ctx.sceneModel.createObject({
      id: feature.id,
      schema: SCHEMA,
      meshIds,
      layerId: ctx.options.layerId
    });
    if (!result.ok) {
      ctx.errors.push(`failed to create SceneObject "${feature.id}" -> ${result.error}`);
    }
  }
  if (ctx.dataModel) {
    const propertySetIds = createPropertySet(ctx, feature);
    const result = ctx.dataModel.createObject({
      id: feature.id,
      name: feature.name,
      type: feature.geometry?.type || "Feature",
      schema: SCHEMA,
      propertySetIds
    });
    if (!result.ok) {
      ctx.errors.push(`failed to create DataObject "${feature.id}" -> ${result.error}`);
    }
  }
}

function parseGeometry(ctx: ParseContext, feature: ParseFeature, geometry: GeoJSONGeometry, meshIds: string[]): void {
  switch (geometry.type) {
    case "Point":
      createPointMesh(ctx, feature, [geometry.coordinates], meshIds);
      break;
    case "MultiPoint":
      createPointMesh(ctx, feature, geometry.coordinates || [], meshIds);
      break;
    case "LineString":
      createLineMesh(ctx, feature, [geometry.coordinates || []], meshIds);
      break;
    case "MultiLineString":
      createLineMesh(ctx, feature, geometry.coordinates || [], meshIds);
      break;
    case "Polygon":
      createPolygonMeshes(ctx, feature, [geometry.coordinates || []], meshIds);
      break;
    case "MultiPolygon":
      createPolygonMeshes(ctx, feature, geometry.coordinates || [], meshIds);
      break;
    case "GeometryCollection":
      for (const child of geometry.geometries || []) {
        parseGeometry(ctx, feature, child, meshIds);
      }
      break;
  }
}

function createPointMesh(ctx: ParseContext, feature: ParseFeature, points: GeoJSONPosition[], meshIds: string[]): void {
  if (points.length === 0) {
    return;
  }
  const id = nextComponentId(ctx, feature.id, "points");
  const positions: number[] = [];
  for (const point of points) {
    positions.push(...toScenePosition(ctx, point));
  }
  createGeometryMesh(ctx, id, PointsPrimitive, positions, undefined, colorForFeature(feature, ctx.options.pointColor || DEFAULT_POINT_COLOR), 1, meshIds);
}

function createLineMesh(ctx: ParseContext, feature: ParseFeature, lines: GeoJSONPosition[][], meshIds: string[]): void {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexBase = 0;
  for (const line of lines) {
    for (const point of line) {
      positions.push(...toScenePosition(ctx, point));
    }
    for (let i = 0; i < line.length - 1; i++) {
      indices.push(vertexBase + i, vertexBase + i + 1);
    }
    vertexBase += line.length;
  }
  if (positions.length === 0 || indices.length === 0) {
    return;
  }
  const id = nextComponentId(ctx, feature.id, "lines");
  createGeometryMesh(ctx, id, LinesPrimitive, positions, indices, colorForFeature(feature, ctx.options.lineColor || DEFAULT_LINE_COLOR), 1, meshIds);
}

function createPolygonMeshes(ctx: ParseContext, feature: ParseFeature, polygons: GeoJSONPosition[][][], meshIds: string[]): void {
  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) {
      continue;
    }
    const positions: number[] = [];
    const flat: number[] = [];
    const holes: number[] = [];
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
      const ring = withoutClosingPosition(polygon[ringIndex] || []);
      if (ring.length < 3) {
        continue;
      }
      if (ringIndex > 0) {
        holes.push(flat.length / 2);
      }
      for (const point of ring) {
        flat.push((point[0] - ctx.origin[0]) * ctx.scale[0], (point[1] - ctx.origin[1]) * ctx.scale[1]);
        positions.push(...toScenePosition(ctx, point));
      }
    }
    if (positions.length === 0) {
      continue;
    }
    const indices = earcut(flat, holes, 2);
    if (indices.length === 0) {
      continue;
    }
    const id = nextComponentId(ctx, feature.id, "polygon");
    createGeometryMesh(
      ctx,
      id,
      TrianglesPrimitive,
      positions,
      indices,
      colorForFeature(feature, ctx.options.polygonColor || DEFAULT_POLYGON_COLOR),
      ctx.options.polygonOpacity ?? 0.55,
      meshIds);
  }
}

function createGeometryMesh(
  ctx: ParseContext,
  id: string,
  primitive: number,
  positions: number[],
  indices: number[] | undefined,
  color: Vec3,
  opacity: number,
  meshIds: string[]
): void {
  const geometryResult = ctx.sceneModel.createGeometry({
    id: `${id}-geometry`,
    primitive,
    positions,
    ...(indices ? {indices} : {})
  });
  if (!geometryResult.ok) {
    ctx.errors.push(`failed to create geometry "${id}-geometry" -> ${geometryResult.error}`);
    return;
  }
  const meshResult = ctx.sceneModel.createMesh({
    id: `${id}-mesh`,
    geometryId: `${id}-geometry`,
    color,
    opacity
  });
  if (!meshResult.ok) {
    ctx.errors.push(`failed to create mesh "${id}-mesh" -> ${meshResult.error}`);
    return;
  }
  meshIds.push(`${id}-mesh`);
}

function createPropertySet(ctx: ParseContext, feature: ParseFeature): string[] {
  const properties = feature.properties;
  if (!properties || Object.keys(properties).length === 0) {
    return [];
  }
  const propertySetId = `${feature.id}-properties`;
  const result = ctx.dataModel.createPropertySet({
    id: propertySetId,
    name: "GeoJSON properties",
    type: "GeoJSONProperties",
    schema: SCHEMA,
    properties: Object.keys(properties).map(name => ({
      name,
      value: properties[name],
      type: typeof properties[name]
    }))
  });
  if (!result.ok) {
    ctx.errors.push(`failed to create PropertySet "${propertySetId}" -> ${result.error}`);
    return [];
  }
  return [propertySetId];
}

function toScenePosition(ctx: ParseContext, coordinate: GeoJSONPosition): Vec3 {
  const x = (coordinate[0] - ctx.origin[0]) * ctx.scale[0];
  const y = (coordinate[1] - ctx.origin[1]) * ctx.scale[1];
  const z = ((coordinate[2] ?? ctx.options.defaultElevation ?? 0) - (ctx.origin[2] || 0)) * ctx.scale[2];
  return [x, y, z];
}

function findFirstPosition(value: any): Vec3 | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
    return [value[0], value[1], value[2] || 0];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const position = findFirstPosition(item);
      if (position) {
        return position;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    return findFirstPosition(value.coordinates || value.geometry || value.geometries || value.features);
  }
  return null;
}

function withoutClosingPosition(ring: GeoJSONPosition[]): GeoJSONPosition[] {
  if (ring.length < 2) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] && (first[2] || 0) === (last[2] || 0)
    ? ring.slice(0, ring.length - 1)
    : ring;
}

function colorForFeature(feature: ParseFeature, fallback: Vec3): Vec3 {
  const color = feature.properties?.color || feature.properties?.fill || feature.properties?.stroke;
  if (typeof color === "string") {
    const parsed = parseHexColor(color);
    if (parsed) {
      return parsed;
    }
  }
  return fallback;
}

function parseHexColor(color: string): Vec3 | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  ];
}

function uniqueFeatureId(baseId: string, index: number, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  const id = `${baseId}-${index}`;
  usedIds.add(id);
  return id;
}

function nextComponentId(ctx: ParseContext, featureId: string, suffix: string): string {
  return `${featureId}-${suffix}-${ctx.nextId++}`;
}

function toVec3(value: ArrayLike<number>): Vec3 {
  return [value[0], value[1], value[2]];
}
