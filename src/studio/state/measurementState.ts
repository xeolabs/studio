export type MeasurementUnit = "m" | "mm" | "ft" | "in";
export interface StudioMeasurement {
  id: string;
  number: number;
  origin: [number, number, number];
  target: [number, number, number];
  objectIds: string[];
  floorId: string;
  floorTitle?: string;
  planCutHeight?: number;
  text: string;
}
export function createMeasurementState() {
  return {unit: "m" as MeasurementUnit, snapping: true, lensEnabled: true, pending: false,
    snapHint: "", visible: true, selectedId: "", undoLabel: "", items: [] as StudioMeasurement[]};
}
export type MeasurementState = ReturnType<typeof createMeasurementState>;
