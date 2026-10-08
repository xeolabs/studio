import type {StudioActions} from "./types";
import {HealthFindings} from "../services/HealthFindings";

export function createStudioActions(): StudioActions {
  const emptyFindings = new HealthFindings();
  return {
    importActions: {
      open: () => {},
      close: () => {},
      setDataSet: () => {},
      setSourceMode: () => {},
      setSlotFile: () => {},
      setSlotUrl: () => {},
      setOrigin: () => {},
      addFiles: () => {}, addUrl: () => {}, removeSource: () => {}, assignSource: () => {},
      replaceSource: () => {}, updateUrl: () => {}, reset: () => {},
      cancelReplacement: () => {}, replaceExisting: () => {},
      canLoad: () => false,
      load: async () => {}
    },
    exportActions: {
      open: () => {},
      close: () => {},
      refreshModels: () => {},
      setDataSet: () => {},
      toggleSceneModel: () => {},
      toggleDataModel: () => {},
      setBaseName: () => {}, selectAll: () => {}, clearSelection: () => {},
      reset: () => {}, downloadFile: () => {},
      canExport: () => false,
      exportSelected: async () => {}
    },
    rendererActions: {
      switchTo: async () => {}
    },
    sceneHealthActions: {
      queryFindings: (query) => emptyFindings.query(query),
      selectModel: () => {},
      inspectSelected: () => {},
      cleanupAll: () => {},
      cleanupCodes: async () => {}
    },
    dataHealthActions: {
      queryFindings: (query) => emptyFindings.query(query),
      selectModel: () => {},
      inspectSelected: () => {},
      cleanupCodes: async () => {}
    },
    tilesActions: {
      refresh: () => {},
      copyJson: () => {}
    },
    diagnosticsActions: {
      clear: () => {},
      copyJson: () => {},
      copyEntry: () => {}
    },
    sunStudyActions: {
      setPreset: () => {},
      setLatitude: () => {},
      setLongitude: () => {},
      setNorthAngle: () => {},
      setDate: () => {},
      setMinutesUtc: () => {},
      setNightExposureFactor: () => {},
      setMode: () => {},
      setDurationSeconds: () => {},
      togglePlayback: () => {}
    },
    explorerHostActions: {
      mounted: () => {},
      unmounted: () => {}
    },
    viewerHostActions: {
      mounted: () => {},
      unmounted: () => {}
    }
  };
}
