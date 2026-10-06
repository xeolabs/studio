import type {ExportContent} from "./exportContent";
import type {ExportDataSet} from "./exportDialogDataSets";
import {getExportFormat} from "./exporters/exportFormatRegistry";

export function exportFormatIssue(format: ExportDataSet, content: ExportContent, dataCount: number): string {
  const definition = getExportFormat(format.sceneFormat);
  if (definition.primitives) {
    const counts = Object.entries(content.primitiveMeshes);
    const supported = counts.filter(([primitive]) => definition.primitives.includes(Number(primitive))).reduce((sum, [, count]) => sum + count, 0);
    if (!supported) return `${definition.label} cannot encode the geometry types in this selection.`;
    if (definition.rejectMixedPrimitives && counts.some(([primitive]) => !definition.primitives.includes(Number(primitive)))) {
      return `${definition.label} cannot safely encode this mixture of geometry types. Export the unsupported types separately.`;
    }
  }
  if (format.sceneFormat === "ifc" && dataCount && !content.ifcProjects && !format.dataExtension) {
    return "No IfcProject was found in the selected data. Choose IFC + Data JSON to retain that data alongside a generated IFC structure.";
  }
  return "";
}

export function exportFormatNotices(format: ExportDataSet, content: ExportContent, dataCount: number): string[] {
  const definition = getExportFormat(format.sceneFormat), notices = [...(format.notices || [])];
  if (definition.primitives && !definition.rejectMixedPrimitives) {
    const skipped = Object.entries(content.primitiveMeshes).filter(([primitive]) => !definition.primitives.includes(Number(primitive)))
      .reduce((sum, [, count]) => sum + count, 0);
    if (skipped) notices.push(`${skipped} mesh(es) use unsupported geometry types and will be omitted.`);
  }
  if (content.animations && !definition.preservesAnimation) notices.push(definition.animationNotice || "The current encoder does not preserve authored animation channels. Only static transforms are written.");
  if (content.morphTargets && !definition.preservesMorphTargets) notices.push("Morph targets and weights are not preserved by this encoder.");
  if (content.vertexStates && !definition.preservesVertexStates) notices.push("Complete alternate vertex states are not preserved by this encoder.");
  if (content.textures && !definition.preservesTextures && definition.id !== "fbx") notices.push("Texture images are not included by this encoder.");
  if (format.nativeData && dataCount) notices.push("Only semantic properties and relationships supported by this format are embedded. Add Data JSON to retain the complete xeokit semantic graph.");
  return notices;
}
