import {TrianglesPrimitive} from "../../../../base/constants";
import {decompressPoint3WithAABB3} from "../../../../base/math/compression";
import {createVec3Float64} from "../../../../base/math/vector";
import {transformPoint3} from "../../../../base/math/matrix";
import {getMeshWorldMatrix} from "../../../../model/scene";
import {yieldToHost} from "../../../../base/utils";
import type {ModelEncodeParams} from "../../../ModelEncodeParams";
import type {LoaderProgress} from "../../../LoaderProgress";

const tempIn = createVec3Float64();
const tempOut = createVec3Float64();

export async function encode(params: ModelEncodeParams, options: any = {}): Promise<string> {
  const {sceneModel} = params;
  if (!sceneModel) {
    throw new Error("[ColladaExporter] Argument expected: params.sceneModel");
  }
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

  const objects = Object.values(sceneModel.objects || {}) as any[];
  const geometrySections: string[] = [];
  const materialSections: string[] = [];
  const effectSections: string[] = [];
  const nodeSections: string[] = [];
  const writtenMaterials = new Set<string>();

  for (let i = 0, len = objects.length; i < len; i++) {
    if ((i & 0x1F) === 0) {
      await step("Exporting COLLADA", i, len);
    }
    const object = objects[i];
    const instanceLines: string[] = [];
    for (const mesh of object.meshes || []) {
      const geometry = mesh.geometry;
      if (!geometry || geometry.primitive !== TrianglesPrimitive || !geometry.positionsCompressed || !geometry.aabb) {
        continue;
      }
      const ids = writeGeometry(geometrySections, object, mesh);
      const materialId = materialIdForMesh(mesh);
      writeMaterial(materialSections, effectSections, writtenMaterials, materialId, mesh);
      instanceLines.push([
        `      <instance_geometry url="#${ids.geometryId}">`,
        `        <bind_material><technique_common>`,
        `          <instance_material symbol="${escapeXML(materialId)}" target="#${escapeXML(materialId)}"/>`,
        `        </technique_common></bind_material>`,
        `      </instance_geometry>`
      ].join("\n"));
    }
    if (instanceLines.length === 0) {
      continue;
    }
    nodeSections.push([
      `    <node id="${escapeXML(object.id)}" name="${escapeXML(object.id)}">`,
      ...instanceLines,
      `    </node>`
    ].join("\n"));
  }

  await step("Exporting COLLADA", objects.length, objects.length);

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">`,
    `  <asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>`,
    `  <library_effects>`,
    effectSections.join("\n"),
    `  </library_effects>`,
    `  <library_materials>`,
    materialSections.join("\n"),
    `  </library_materials>`,
    `  <library_geometries>`,
    geometrySections.join("\n"),
    `  </library_geometries>`,
    `  <library_visual_scenes>`,
    `    <visual_scene id="Scene" name="Scene">`,
    nodeSections.join("\n"),
    `    </visual_scene>`,
    `  </library_visual_scenes>`,
    `  <scene><instance_visual_scene url="#Scene"/></scene>`,
    `</COLLADA>`
  ].join("\n");
}

function writeGeometry(target: string[], object: any, mesh: any): {geometryId: string} {
  const geometry = mesh.geometry;
  const geometryId = sanitizeId(`${object.id}_${mesh.id}_geometry`);
  const positions = dequantizePositions(geometry, getMeshWorldMatrix(mesh));
  const indices = geometry.indices && geometry.indices.length > 0
    ? Array.from(geometry.indices)
    : buildSequentialIndices(positions.length / 3);
  const triangleCount = Math.floor(indices.length / 3);
  const p = indices.join(" ");

  target.push([
    `    <geometry id="${geometryId}" name="${escapeXML(geometryId)}">`,
    `      <mesh>`,
    `        <source id="${geometryId}-positions">`,
    `          <float_array id="${geometryId}-positions-array" count="${positions.length}">${positions.map(formatNum).join(" ")}</float_array>`,
    `          <technique_common><accessor source="#${geometryId}-positions-array" count="${positions.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>`,
    `        </source>`,
    `        <vertices id="${geometryId}-vertices"><input semantic="POSITION" source="#${geometryId}-positions"/></vertices>`,
    `        <triangles count="${triangleCount}" material="${escapeXML(materialIdForMesh(mesh))}">`,
    `          <input semantic="VERTEX" source="#${geometryId}-vertices" offset="0"/>`,
    `          <p>${p}</p>`,
    `        </triangles>`,
    `      </mesh>`,
    `    </geometry>`
  ].join("\n"));

  return {geometryId};
}

function writeMaterial(materials: string[], effects: string[], written: Set<string>, materialId: string, mesh: any): void {
  if (written.has(materialId)) {
    return;
  }
  written.add(materialId);
  const color = mesh.material?.color || mesh.color || [0.8, 0.8, 0.8];
  const opacity = mesh.material?.opacity ?? mesh.opacity ?? 1;
  effects.push([
    `    <effect id="${escapeXML(materialId)}-effect">`,
    `      <profile_COMMON><technique sid="common"><lambert>`,
    `        <diffuse><color>${formatNum(color[0] ?? 0.8)} ${formatNum(color[1] ?? 0.8)} ${formatNum(color[2] ?? 0.8)} ${formatNum(opacity)}</color></diffuse>`,
    `      </lambert></technique></profile_COMMON>`,
    `    </effect>`
  ].join("\n"));
  materials.push(`    <material id="${escapeXML(materialId)}" name="${escapeXML(materialId)}"><instance_effect url="#${escapeXML(materialId)}-effect"/></material>`);
}

function dequantizePositions(geometry: any, matrix: any): number[] {
  const result: number[] = [];
  const positions = geometry.positionsCompressed;
  for (let i = 0, len = positions.length; i < len; i += 3) {
    tempIn[0] = positions[i];
    tempIn[1] = positions[i + 1];
    tempIn[2] = positions[i + 2];
    decompressPoint3WithAABB3(tempIn, geometry.aabb, tempOut);
    transformPoint3(matrix, tempOut, tempIn);
    result.push(tempIn[0], tempIn[1], tempIn[2]);
  }
  return result;
}

function buildSequentialIndices(vertexCount: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    indices.push(i);
  }
  return indices;
}

function materialIdForMesh(mesh: any): string {
  return sanitizeId(mesh.material?.id || `mesh_${mesh.id}_material`);
}

function sanitizeId(value: string): string {
  return String(value || "item").replace(/[^\w.-]+/g, "_");
}

function formatNum(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(9)).toString() : "0";
}

function escapeXML(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
