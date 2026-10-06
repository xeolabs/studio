import type {CoordinateSystemParams} from "@xeokit/sdk/model/scene";

export interface ExportCoordinateSource {
  id: string;
  coordinateSystem: CoordinateSystemParams;
}

/** Merging currently copies local geometry, so all source coordinate systems must match. */
export function exportCoordinateSystemIssue(models: readonly ExportCoordinateSource[]): string {
  if (models.length < 2) return "";
  const first = models[0];
  for (const model of models.slice(1)) {
    const a = first.coordinateSystem, b = model.coordinateSystem;
    const differences: string[] = [];
    if (!equalVector(a.basis, b.basis)) differences.push("basis");
    if (!equalVector(a.origin, b.origin)) differences.push("origin");
    if (a.units !== b.units) differences.push("units");
    if (meterScale(a) !== meterScale(b)) differences.push("scale to meters");
    if (differences.length) {
      return `SceneModels "${first.id}" and "${model.id}" have different coordinate systems (${differences.join(", ")}). `
        + "Export them separately. Automatic coordinate conversion during merge is not supported yet.";
    }
  }
  return "";
}

function equalVector(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return a.length === b.length && Array.from(a).every((value, index) => Number.isFinite(value) && value === b[index]);
}

function meterScale(coordinates: CoordinateSystemParams): number {
  return coordinates.scaleToMeters ?? {meters: 1, millimeters: 0.001, inches: 0.0254, feet: 0.3048}[coordinates.units];
}
