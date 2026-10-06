import type {ModelExportOptions} from "../ModelExportOptions";
import type {Mat4} from "../../base/math/matrix";

/** Options for spatially partitioned, static 3D Tiles 1.1 export. */
export interface ThreeDTilesExportOptions extends ModelExportOptions {
  /** Maximum complete SceneObjects per leaf GLB. Default 64; objects are never split. */
  maxObjectsPerTile?: number;
  /**
   * Optional affine tile-root transform, e.g. a local-to-ECEF placement.
   * No CRS reprojection or automatic geolocation is performed.
   * Tile coordinates are Z-up meters; coordinateSystem, when supplied, must use those conventions.
   */
  rootTransform?: Mat4;
}

/** One explicit 3D Tiles node. Internal nodes contain no substitute/LOD geometry. */
export interface ExportedTile {
  boundingVolume: {box: number[]};
  geometricError: number;
  refine?: "ADD";
  transform?: number[];
  content?: {uri: string};
  children?: ExportedTile[];
}

/** Multi-file export result. Write each entry under its relative filename. */
export interface ThreeDTilesExportResult {
  /** The entry point is always tileset.json. */
  entryPoint: "tileset.json";
  tileset: {
    asset: {version: "1.1"; generator: string};
    geometricError: number;
    root: ExportedTile;
    extras?: {dataModelUri: string};
  };
  /** GLB bytes, tileset JSON and optional xeokit DataModel JSON sidecar. */
  files: Record<string, ArrayBuffer | object>;
}
