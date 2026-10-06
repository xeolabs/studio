import {EXPORT_FORMATS} from "./exporters/exportFormatRegistry";

/** Serializable UI metadata; encoder factories stay outside Vue state. */
export interface ExportDataSet {
  id: string;
  label: string;
  group: string;
  description: string;
  sceneFormat: string;
  sceneExtension: string;
  dataExtension?: string;
  materialExtension?: string;
  nativeData?: boolean;
  archive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  notices?: string[];
}

/** Include every selected domain, either natively or in a Data JSON companion. */
export function exportFormatsForSelection(formats: readonly ExportDataSet[], dataModelCount: number): ExportDataSet[] {
  return formats.filter(format => !format.disabled && (dataModelCount ? format.nativeData || !!format.dataExtension : !format.dataExtension));
}

export const EXPORT_DATA_SETS: ExportDataSet[] = EXPORT_FORMATS.flatMap(format => {
  const base: ExportDataSet = {
    id: format.id, label: format.label, group: format.group, description: format.description,
    sceneFormat: format.id, sceneExtension: format.extension, nativeData: format.nativeData,
    materialExtension: format.package === "obj-mtl" ? "mtl" : undefined,
    archive: format.package === "xgf-stream", notices: [...(format.notices || [])]
  };
  const companion: ExportDataSet = {...base,
    id: format.id === "scene-json" ? "scene-json-data-json" : `${format.id}-json`,
    label: `${format.label} + Data JSON`, dataExtension: "datamodel.json", notices: [...base.notices]
  };
  if (format.id === "glb") companion.notices.push("GLB re-import currently assigns mesh-node IDs to SceneObjects, which can break links to the companion Data JSON. Use XGF or Scene JSON when those links must survive a round trip.");
  else if (!["xgf", "scene-json"].includes(format.id)) companion.notices.push("The Data JSON preserves the semantic graph; this geometry format may change object IDs on re-import, so visual links are not guaranteed.");
  // Preserve the existing initial format and IDs used by commands and debug clients.
  return format.id === "xgf" ? [companion, base] : [base, companion];
});
