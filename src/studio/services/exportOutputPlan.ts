import type {ExportDataSet} from "./exportDialogDataSets";
import {sanitizeFilename} from "./exportDownloads";

export interface ExportOutputFile {
  filename: string;
  kind: "scene" | "data" | "materials" | "archive" | "model";
}

export function exportFileRole(kind: ExportOutputFile["kind"]): string {
  return {scene: "Geometry", data: "Semantic data", materials: "Materials", archive: "Stream archive", model: "Model"}[kind];
}

export function exportOutputPlan(format: ExportDataSet, baseName: string): ExportOutputFile[] {
  const files: ExportOutputFile[] = [];
  if (format.sceneExtension) files.push({filename: `${baseName}.${format.sceneExtension}`, kind: format.archive ? "archive" : format.nativeData ? "model" : "scene"});
  if (format.materialExtension) files.push({filename: `${baseName}.${format.materialExtension}`, kind: "materials"});
  if (format.dataExtension) files.push({filename: `${baseName}.${format.dataExtension}`, kind: "data"});
  return files;
}

export function exportFilenameIssue(baseName: string): string {
  if (!baseName.trim()) return "Enter a file name.";
  if (baseName.length > 120) return "Use a file name of 120 characters or fewer.";
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(baseName) || /[. ]$/.test(baseName) || /^\s/.test(baseName)) {
    return "Avoid path separators, reserved characters, and leading or trailing spaces or dots.";
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(baseName)) return "This file name is reserved. Choose another name.";
  return "";
}

export function defaultExportBaseName(models: Array<{id: string; label?: string}>): string {
  if (models.length !== 1) return "combined-model";
  const name = sanitizeFilename(models[0].label || models[0].id).slice(0, 100);
  return exportFilenameIssue(name) ? "xeokit-export" : name;
}
