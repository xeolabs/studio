import {TrianglesPrimitive, SolidPrimitive, SurfacePrimitive, PointsPrimitive, LinesPrimitive} from "../../base/constants";
import {getMeshWorldMatrix, type CoordinateSystem} from "../../model/scene";
import {yieldToHost} from "../../base/utils";
import type {ModelEncodeParams} from "../ModelEncodeParams";
import type {LandXMLExportOptions} from "./LandXMLExportOptions";
import {readMeshPositions} from "../internal/readMeshPositions";
import {landXMLCoordinates} from "./coordinates";

/** @internal */
export async function encode({sceneModel, dataModel}: ModelEncodeParams, options: LandXMLExportOptions = {}): Promise<string> {
  if (!sceneModel) throw new Error("[LandXMLExporter] sceneModel is required");
  const linearUnit = options.linearUnit ?? "meter";
  const target = landXMLCoordinates(linearUnit);
  if (options.coordinateSystem) {
    if (options.coordinateSystem.basis.some((v, i) => v !== target.basis[i]) || options.coordinateSystem.units !== target.units || (options.coordinateSystem.scaleToMeters ?? target.scaleToMeters) !== target.scaleToMeters) {
      throw new Error("[LandXMLExporter] coordinateSystem must be Z-up and match linearUnit");
    }
    target.origin = options.coordinateSystem.origin;
  }
  const warn = options.onWarning ?? console.warn;
  warn("[LandXMLExporter] Writes stored TINs, points and straight linework, not analytic civil design, materials or animation. No CRS reprojection is performed.");
  const surfaces: string[] = [], points: string[] = [], plans: string[] = [];
  let pointId = 0, meshIndex = 0;
  const supported = [TrianglesPrimitive, SolidPrimitive, SurfacePrimitive, PointsPrimitive, LinesPrimitive];
  for (const object of Object.values(sceneModel.objects)) {
    const name = dataModel?.objects[object.id]?.name || object.id;
    for (const mesh of object.meshes) {
      if (mesh.model !== sceneModel) continue;
      if (!supported.includes(mesh.geometry.primitive)) { warn(`[LandXMLExporter] Unsupported primitive in '${mesh.id}' omitted.`); continue; }
      const positions = await readMeshPositions(mesh, getMeshWorldMatrix(mesh, target as CoordinateSystem), options.signal);
      const xyz = (i: number) => `${positions[i * 3 + 1]} ${positions[i * 3]} ${positions[i * 3 + 2]}`;
      const indices = mesh.geometry.indices;
      if (mesh.geometry.primitive === PointsPrimitive) {
        for (let i = 0; i < positions.length / 3; i++) {
          if ((i & 4095) === 0) await yieldToHost(options.signal);
          points.push(`<CgPoint name="${++pointId}" desc="${escapeXML(name)}">${xyz(i)}</CgPoint>`);
        }
      } else if (mesh.geometry.primitive === LinesPrimitive) {
        const lines: string[] = [];
        for (let i = 0; i < indices.length; i += 2) {
          if ((i & 4095) === 0) await yieldToHost(options.signal);
          lines.push(`<Line><Start>${xyz(indices[i])}</Start><End>${xyz(indices[i + 1])}</End></Line>`);
        }
        plans.push(`<PlanFeature name="${escapeXML(name)}"><CoordGeom>${lines.join("\n")}</CoordGeom></PlanFeature>`);
      } else {
        const pnts: string[] = [], faces: string[] = [];
        for (let i = 0; i < positions.length / 3; i++) {
          if ((i & 4095) === 0) await yieldToHost(options.signal);
          pnts.push(`<P id="${i + 1}">${xyz(i)}</P>`);
        }
        for (let i = 0; i < indices.length; i += 3) {
          if (i % 12288 === 0) await yieldToHost(options.signal);
          faces.push(`<F>${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}</F>`);
        }
        surfaces.push(`<Surface name="${escapeXML(name)}"><Definition surfType="TIN"><Pnts>${pnts.join("\n")}</Pnts><Faces>${faces.join("\n")}</Faces></Definition></Surface>`);
      }
      options.onProgress?.({phase: "Writing LandXML", current: ++meshIndex, total: Object.keys(sceneModel.meshes).length});
    }
  }
  if (!surfaces.length && !points.length && !plans.length) throw new Error("[LandXMLExporter] No supported geometry");
  const units = linearUnit === "meter" || linearUnit === "millimeter"
    ? `<Metric linearUnit="${linearUnit}" areaUnit="squareMeter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" angularUnit="decimal degrees" directionUnit="decimal degrees"/>`
    : `<Imperial linearUnit="${linearUnit}" areaUnit="squareFoot" volumeUnit="cubicFeet" temperatureUnit="fahrenheit" pressureUnit="inHG" angularUnit="decimal degrees" directionUnit="decimal degrees"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="1970-01-01" time="00:00:00" language="English" readOnly="false"><Units>${units}</Units>${options.coordinateSystemName ? `<CoordinateSystem name="${escapeXML(options.coordinateSystemName)}"/>` : ""}${points.length ? `<CgPoints>${points.join("\n")}</CgPoints>` : ""}${surfaces.length ? `<Surfaces>${surfaces.join("\n")}</Surfaces>` : ""}${plans.length ? `<PlanFeatures>${plans.join("\n")}</PlanFeatures>` : ""}</LandXML>`;
}

function escapeXML(value: string): string { return value.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"}[c])); }
