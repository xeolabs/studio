import type {ImportDialogState} from "./importDialogState";
import {acceptsSource} from "./importSourceDetection";

export function importValidation(state: ImportDialogState): {message: string; sources: Record<string, string>; slots: Record<string, string>} {
  const sources = state.sources.filter(s => s.mode === state.sourceMode);
  const errors: Record<string, string> = {};
  const slots: Record<string, string> = {};
  const dataSet = state.dataSets.find(d => d.id === state.dataSetId);
  for (const source of sources) {
    if (source.mode === "url") {
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch { errors[source.id] = "Enter a complete HTTP or HTTPS URL."; }
    } else if (!source.file?.size) errors[source.id] = "This file is empty. Choose a model file.";
    if (dataSet && !source.slotKey && !errors[source.id]) errors[source.id] = dataSet.files.some(spec => acceptsSource(spec, source))
      ? "Choose a file role or remove this source."
      : `${dataSet.label} does not accept this file. Change format or remove this source.`;
  }
  for (const spec of dataSet?.files ?? []) {
    if (spec.required && !sources.some(s => s.slotKey === spec.key)) slots[spec.key] = `Add ${spec.label}.`;
  }
  let message = !sources.length ? (state.sourceMode === "file" ? "Choose a model file." : "Add a model URL.")
    : !dataSet ? "Choose a format for these sources." : Object.values(errors)[0] || Object.values(slots)[0] || "";
  if (!message && dataSet?.loadsSceneGeometry !== false && state.coordinateMode === "override") {
    if (!state.bases.some(b => b.id === state.basisId && b.basis)) message = "Choose a coordinate-system basis.";
    else if (!state.unitsOptions.includes(state.units) || !state.origin.every(Number.isFinite)) message = "Enter valid units and finite origin coordinates.";
  }
  return {message, sources: errors, slots};
}
