import {
  LinesPrimitive,
  PointsPrimitive,
  SolidPrimitive,
  SurfacePrimitive,
  TrianglesPrimitive,
} from "../../../../base/constants";
import type {AABB3} from "../../../../base/math/boundaries";
import {decompressPoint3WithAABB3} from "../../../../base/math/compression";
import {transformPoint3, type Mat4} from "../../../../base/math/matrix";
import {createVec3Float64} from "../../../../base/math/vector";
import {yieldToHost} from "../../../../base/utils";
import {getMeshWorldMatrix} from "../../../../model/scene";
import type {LoaderProgress} from "../../../LoaderProgress";
import type {ModelEncodeParams} from "../../../ModelEncodeParams";
import type {GeoJSONExportOptions} from "../../GeoJSONExportOptions";

type Coordinate = number[]; // [x, y] or [x, y, elevation]
type BBox = [number, number, number, number];
type GeoJSONGeometry =
  | {type: "Point"; coordinates: Coordinate}
  | {type: "MultiPoint"; coordinates: Coordinate[]}
  | {type: "LineString"; coordinates: Coordinate[]}
  | {type: "MultiLineString"; coordinates: Coordinate[][]}
  | {type: "Polygon"; coordinates: Coordinate[][]}
  | {type: "MultiPolygon"; coordinates: Coordinate[][][]}
  | {type: "GeometryCollection"; geometries: GeoJSONGeometry[]};

const tempCompressed = createVec3Float64();
const tempLocal = createVec3Float64();
const tempWorld = createVec3Float64();

/**
 * Encodes a SceneModel as a GeoJSON FeatureCollection.
 *
 * GeoJSON is a 2D GIS format with optional per-position elevation, while a
 * SceneModel stores generic renderable geometry. This encoder therefore
 * projects mesh vertices onto a selected plane. Triangulated surfaces are
 * emitted as one polygon ring per triangle because generic SceneGeometry does
 * not retain source polygon ring and hole boundaries.
 *
 * @private
 */
export async function encode(params: ModelEncodeParams, options: GeoJSONExportOptions = {}): Promise<any> {
  const {sceneModel, dataModel} = params;
  if (!sceneModel) {
    throw new Error("[GeoJSONExporter] sceneModel is required");
  }

  const opts = normalizeOptions(options);
  const targetCoordinateSystem = options.coordinateSystem as any;
  const onProgress: ((p: LoaderProgress) => void) | undefined = options.onProgress;
  const signal: AbortSignal | undefined = options.signal;
  const progress: LoaderProgress = {phase: "Encoding GeoJSON", current: 0, total: 0};
  const step = async (current: number, total: number): Promise<void> => {
    if (onProgress) {
      progress.current = current;
      progress.total = total;
      onProgress(progress);
    }
    await yieldToHost(signal);
  };

  const features: any[] = [];
  let collectionBbox: BBox | null = null;
  const sceneObjects = Object.values(sceneModel.objects);

  for (let i = 0, len = sceneObjects.length; i < len; i++) {
    if ((i & 0x1F) === 0) {
      await step(i, len);
    }
    const sceneObject = sceneObjects[i];
    const geometries: GeoJSONGeometry[] = [];
    let featureBbox: BBox | null = null;

    for (const sceneMesh of sceneObject.meshes || []) {
      const geometry = sceneMesh.geometry;
      if (!geometry || !geometry.positionsCompressed || !geometry.aabb) {
        continue;
      }
      const positions = projectVertices(
        geometry.positionsCompressed,
        geometry.aabb,
        getMeshWorldMatrix(sceneMesh, targetCoordinateSystem),
        opts
      );
      if (positions.length === 0) {
        continue;
      }
      featureBbox = includePositionsInBbox(featureBbox, positions);

      const primitive = geometry.primitive;
      if (primitive === PointsPrimitive) {
        geometries.push(pointsGeometry(positions));
        continue;
      }
      if (primitive === LinesPrimitive) {
        const lineGeometry = linesGeometry(positions, geometry.indices);
        if (lineGeometry) {
          geometries.push(lineGeometry);
        }
        continue;
      }
      if (primitive === TrianglesPrimitive || primitive === SolidPrimitive || primitive === SurfacePrimitive) {
        const polygonGeometry = trianglesGeometry(positions, geometry.indices);
        if (polygonGeometry) {
          geometries.push(polygonGeometry);
        }
      }
    }

    if (geometries.length === 0) {
      continue;
    }
    const feature: any = {
      type: "Feature",
      id: sceneObject.originalSystemId || sceneObject.id,
      properties: propertiesForObject(dataModel, sceneObject.id),
      geometry: geometries.length === 1 ? geometries[0] : {
        type: "GeometryCollection",
        geometries
      }
    };
    if (opts.includeBbox && featureBbox) {
      feature.bbox = featureBbox;
    }
    collectionBbox = mergeBbox(collectionBbox, featureBbox);
    features.push(feature);
  }

  await step(sceneObjects.length, sceneObjects.length);

  const collection: any = {
    type: "FeatureCollection",
    features
  };
  if (opts.includeBbox && collectionBbox) {
    collection.bbox = collectionBbox;
  }
  return collection;
}

function normalizeOptions(options: GeoJSONExportOptions): Required<Pick<GeoJSONExportOptions, "projectionPlane" | "includeElevation" | "decimals" | "includeBbox">> {
  return {
    projectionPlane: options.projectionPlane || "XY",
    includeElevation: options.includeElevation ?? "auto",
    decimals: options.decimals ?? 9,
    includeBbox: options.includeBbox ?? false
  };
}

function projectVertices(
  positionsCompressed: ArrayLike<number>,
  aabb: AABB3,
  matrix: Mat4,
  options: Required<Pick<GeoJSONExportOptions, "projectionPlane" | "includeElevation" | "decimals" | "includeBbox">>
): Coordinate[] {
  const axes = axesForProjection(options.projectionPlane);
  const numVerts = (positionsCompressed.length / 3) | 0;
  const coordinates: Coordinate[] = new Array(numVerts);
  for (let i = 0; i < numVerts; i++) {
    const offset = i * 3;
    tempCompressed[0] = positionsCompressed[offset];
    tempCompressed[1] = positionsCompressed[offset + 1];
    tempCompressed[2] = positionsCompressed[offset + 2];
    decompressPoint3WithAABB3(tempCompressed, aabb, tempLocal);
    transformPoint3(matrix, tempLocal, tempWorld);
    const x = roundCoordinate(tempWorld[axes.x], options.decimals);
    const y = roundCoordinate(tempWorld[axes.y], options.decimals);
    const elevation = roundCoordinate(tempWorld[axes.elevation], options.decimals);
    coordinates[i] = options.includeElevation === true || (options.includeElevation === "auto" && elevation !== 0)
      ? [x, y, elevation]
      : [x, y];
  }
  return coordinates;
}

function pointsGeometry(positions: Coordinate[]): GeoJSONGeometry {
  return positions.length === 1
    ? {type: "Point", coordinates: positions[0]}
    : {type: "MultiPoint", coordinates: positions};
}

function linesGeometry(positions: Coordinate[], indices?: ArrayLike<number>): GeoJSONGeometry | null {
  if (!indices || indices.length < 2) {
    return null;
  }
  const lines: Coordinate[][] = [];
  let current: Coordinate[] | null = null;
  let lastIndex = -1;
  for (let i = 0; i < indices.length; i += 2) {
    const a = indices[i] | 0;
    const b = indices[i + 1] | 0;
    if (!positions[a] || !positions[b]) {
      continue;
    }
    if (current && lastIndex === a) {
      current.push(positions[b]);
    } else {
      if (current && current.length >= 2) {
        lines.push(current);
      }
      current = [positions[a], positions[b]];
    }
    lastIndex = b;
  }
  if (current && current.length >= 2) {
    lines.push(current);
  }
  if (lines.length === 0) {
    return null;
  }
  return lines.length === 1
    ? {type: "LineString", coordinates: lines[0]}
    : {type: "MultiLineString", coordinates: lines};
}

function trianglesGeometry(positions: Coordinate[], indices?: ArrayLike<number>): GeoJSONGeometry | null {
  if (!indices || indices.length < 3) {
    return null;
  }
  const polygons: Coordinate[][][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = positions[indices[i] | 0];
    const b = positions[indices[i + 1] | 0];
    const c = positions[indices[i + 2] | 0];
    if (!a || !b || !c) {
      continue;
    }
    polygons.push([[a, b, c, a]]);
  }
  if (polygons.length === 0) {
    return null;
  }
  return polygons.length === 1
    ? {type: "Polygon", coordinates: polygons[0]}
    : {type: "MultiPolygon", coordinates: polygons};
}

function propertiesForObject(dataModel: any, objectId: string): Record<string, any> {
  const dataObject = dataModel?.objects?.[objectId];
  const properties: Record<string, any> = {};
  if (!dataObject) {
    return properties;
  }
  for (const propertySet of dataObject.propertySets || []) {
    if (propertySet.type !== "GeoJSONProperties" && propertySet.name !== "GeoJSON properties") {
      continue;
    }
    for (const property of propertySet.properties || []) {
      properties[property.name] = property.value;
    }
  }
  return properties;
}

function axesForProjection(projectionPlane: "XY" | "XZ" | "YZ"): {x: 0 | 1 | 2; y: 0 | 1 | 2; elevation: 0 | 1 | 2} {
  switch (projectionPlane) {
    case "XZ":
      return {x: 0, y: 2, elevation: 1};
    case "YZ":
      return {x: 1, y: 2, elevation: 0};
    case "XY":
    default:
      return {x: 0, y: 1, elevation: 2};
  }
}

function includePositionsInBbox(bbox: BBox | null, positions: Coordinate[]): BBox | null {
  let next = bbox;
  for (const position of positions) {
    next = includePointInBbox(next, position);
  }
  return next;
}

function includePointInBbox(bbox: BBox | null, point: Coordinate): BBox {
  if (!bbox) {
    return [point[0], point[1], point[0], point[1]];
  }
  bbox[0] = Math.min(bbox[0], point[0]);
  bbox[1] = Math.min(bbox[1], point[1]);
  bbox[2] = Math.max(bbox[2], point[0]);
  bbox[3] = Math.max(bbox[3], point[1]);
  return bbox;
}

function mergeBbox(a: BBox | null, b: BBox | null): BBox | null {
  if (!b) {
    return a;
  }
  if (!a) {
    return [b[0], b[1], b[2], b[3]];
  }
  a[0] = Math.min(a[0], b[0]);
  a[1] = Math.min(a[1], b[1]);
  a[2] = Math.max(a[2], b[2]);
  a[3] = Math.max(a[3], b[3]);
  return a;
}

function roundCoordinate(value: number, decimals: number): number {
  if (!isFinite(value)) {
    return 0;
  }
  const factor = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * factor) / factor;
}
