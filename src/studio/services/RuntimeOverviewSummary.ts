export interface RuntimeOverviewSummaryParams {
  aabbPanelState: any;
  dataHealthPanelState: any;
  diagnosticsPanelState: any;
  sceneHealthPanelState: any;
  tilesPanelState: any;
  workspace: any;
}

export interface RuntimeOverviewCard {
  id: RuntimeOverviewTargetId;
  title: string;
  value: string;
  detail: string;
  tone: "healthy" | "warning" | "critical" | "unknown";
  inspectCommandId: string;
  actionCommandId: string;
  action: string;
}

export type RuntimeOverviewTargetId = "viewer" | "scene" | "data" | "diagnostics" | "tiles";

export interface RuntimeOverviewSnapshot {
  cards: RuntimeOverviewCard[];
  sceneModels: any[];
  dataModels: any[];
  selectedObject: any;
  selectionRows: Array<{label: string; value: string}>;
  diagnosticSources: any[];
  timestamp: string;
}

export function createRuntimeOverviewSnapshot(params: RuntimeOverviewSummaryParams): RuntimeOverviewSnapshot {
  const {
    aabbPanelState,
    dataHealthPanelState,
    diagnosticsPanelState,
    sceneHealthPanelState,
    tilesPanelState,
    workspace
  } = params;
  const selectedObject = workspace.selectedObjectDetails || null;
  return {
    cards: [
      {
        id: "viewer",
        title: "Viewer",
        value: workspace.loaded ? "Ready" : "Loading",
        detail: workspace.status || "Studio runtime status.",
        tone: workspace.loaded ? "healthy" : "warning",
        inspectCommandId: "runtime.inspectViewer",
        actionCommandId: "runtime.openViewer",
        action: "Open Viewer"
      },
      {
        id: "scene",
        title: "Scene",
        value: modelCount(sceneHealthPanelState.models, "SceneModel"),
        detail: `${aabbPanelState.objectCount || 0} objects · ${aabbPanelState.indexedObjectCount || 0} indexed AABBs`,
        tone: healthTone(sceneHealthPanelState.status),
        inspectCommandId: "runtime.inspectScene",
        actionCommandId: "runtime.openScene",
        action: "Open Scene"
      },
      {
        id: "data",
        title: "Data",
        value: modelCount(dataHealthPanelState.models, "DataModel"),
        detail: dataHealthPanelState.statusText || "Semantic model health and counts.",
        tone: healthTone(dataHealthPanelState.status),
        inspectCommandId: "runtime.inspectData",
        actionCommandId: "runtime.openData",
        action: "Open Data"
      },
      {
        id: "diagnostics",
        title: "Diagnostics",
        value: `${diagnosticsPanelState.errors || 0} E · ${diagnosticsPanelState.warnings || 0} W`,
        detail: diagnosticsPanelState.entries?.length ? "Warnings or errors have been recorded." : "No warnings or errors recorded.",
        tone: diagnosticsPanelState.errors > 0 ? "critical" : diagnosticsPanelState.warnings > 0 ? "warning" : "healthy",
        inspectCommandId: "runtime.inspectDiagnostics",
        actionCommandId: "runtime.openDiagnostics",
        action: "Open Diagnostics"
      },
      {
        id: "tiles",
        title: "Tiles",
        value: `${tilesPanelState.tileCount || 0} tiles`,
        detail: `${tilesPanelState.meshCount || 0} meshes · ${tilesPanelState.statusText || "No tile report"}`,
        tone: tilesPanelState.supportsTileMap ? "healthy" : "unknown",
        inspectCommandId: "runtime.inspectTiles",
        actionCommandId: "runtime.openTiles",
        action: "Open Tiles"
      }
    ],
    sceneModels: normalizeSceneModels(sceneHealthPanelState.models),
    dataModels: normalizeDataModels(dataHealthPanelState.models),
    selectedObject,
    selectionRows: createSelectionRows(selectedObject),
    diagnosticSources: Array.isArray(diagnosticsPanelState.sourceSummaries) ? diagnosticsPanelState.sourceSummaries : [],
    timestamp: new Date().toISOString()
  };
}

export function createRuntimeInspectorContext(targetId: RuntimeOverviewTargetId, snapshot: RuntimeOverviewSnapshot) {
  const card = snapshot.cards.find((candidate) => candidate.id === targetId);
  const detailByTarget: Record<RuntimeOverviewTargetId, string> = {
    viewer: "Viewer runtime is ready for View, Camera, renderer and input inspection.",
    scene: `Scene contains ${snapshot.sceneModels.length} SceneModel${snapshot.sceneModels.length === 1 ? "" : "s"}.`,
    data: `Data contains ${snapshot.dataModels.length} DataModel${snapshot.dataModels.length === 1 ? "" : "s"}.`,
    diagnostics: card?.detail || "Runtime warnings and errors.",
    tiles: card?.detail || "Renderer tile and mesh allocation summary."
  };
  return {
    source: targetId === "data" ? "data" : targetId === "viewer" ? "viewer" : "scene",
    title: card?.title || "Runtime",
    kind: "Runtime",
    detail: detailByTarget[targetId]
  };
}

function createSelectionRows(details: any): Array<{label: string; value: string}> {
  if (!details) {
    return [
      {label: "Selection", value: "None"},
      {label: "SceneObject", value: "n/a"},
      {label: "DataObject", value: "n/a"},
      {label: "Type", value: "n/a"}
    ];
  }
  return [
    {label: "Selection", value: details.title || details.sceneObjectId || "Selected object"},
    {label: "SceneObject", value: details.sceneObjectId || "n/a"},
    {label: "DataObject", value: details.dataObjectId || "n/a"},
    {label: "Type", value: details.type || "n/a"}
  ];
}

function normalizeSceneModels(models: any): any[] {
  return Array.isArray(models) ? models.map((model) => ({
    id: model.id,
    selected: !!model.selected,
    status: model.status,
    errors: model.errors || 0,
    warnings: model.warnings || 0,
    issueCount: model.issueCount || 0,
    objectCount: model.objectCount || 0,
    meshCount: model.meshCount || 0,
    geometryCount: model.geometryCount || 0,
    materialCount: model.materialCount || 0,
    textureCount: model.textureCount || 0,
    transformCount: model.transformCount || 0
  })) : [];
}

function normalizeDataModels(models: any): any[] {
  return Array.isArray(models) ? models.map((model) => ({
    id: model.id,
    schema: model.schema || "",
    selected: !!model.selected,
    status: model.status,
    errors: model.errors || 0,
    warnings: model.warnings || 0,
    issueCount: model.issueCount || 0,
    objectCount: model.objectCount || 0,
    propertySetCount: model.propertySetCount || 0,
    relationshipCount: model.relationshipCount || 0,
    typeCount: model.typeCount || 0
  })) : [];
}

function healthTone(status: string): RuntimeOverviewCard["tone"] {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "loading") {
    return "warning";
  }
  if (status === "healthy") {
    return "healthy";
  }
  return "unknown";
}

function modelCount(models: any, label: string): string {
  const count = Array.isArray(models) ? models.length : 0;
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}
