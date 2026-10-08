export interface InitialCamera {
  eye: [number, number, number];
  look: [number, number, number];
  up: [number, number, number];
  fov: number;
}

export interface BundledModel {
  id: string;
  title: string;
  sceneModelId: string;
  camera: InitialCamera;
  source: {kind: "xgf"; geometry: string; coordinates: string; data: string; dataModelId: string}
    | {kind: "xgfstream"; index: string};
}

/** All startup model URLs come from this local catalogue, never from query strings. */
export const BUNDLED_MODELS: readonly BundledModel[] = [
  {
    id: "duplex", title: "Duplex", sceneModelId: "duplexSceneModel",
    camera: {eye: [24.40, 23.70, 27.04], look: [4.39, 8.90, 2.54], up: [-0.56, -0.41, 0.71], fov: 60},
    source: {kind: "xgf", geometry: "models/Duplex/xgf/model.xgf", coordinates: "models/Duplex/coordSys.json",
      data: "models/Duplex/datamodel/model.json", dataModelId: "duplexDataModel"}
  },
  {
    id: "baku", title: "Baku Stadium", sceneModelId: "bakuSceneModel",
    camera: {eye: [-67.75803, 116.28819, 46.98897], look: [-75.49979, 118.42810, 44.85021],
      up: [-0.24801, 0.06855, 0.96633], fov: 30},
    source: {kind: "xgfstream", index: "models/BakuStadium_xgfstream_4000/xgfstream/index.runtime.json"}
  }
];
