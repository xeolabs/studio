import {ModelExporter} from "../ModelExporter";
import type {ModelExportParams} from "../ModelExportParams";
import type {ThreeDTilesExportOptions, ThreeDTilesExportResult} from "./ThreeDTilesExportOptions";
import {encodeTileset} from "./export/encodeTileset";

/**
 * Writes static 3D Tiles 1.1: an explicit spatial tree and GLB leaf payloads.
 * Uses isolated headless scratch models, leaving the source untouched.
 * No simplified LODs, implicit tiling, animation or geometry deformation is exported.
 */
export class ThreeDTilesExporter extends ModelExporter {
  constructor() {
    super({format: "3D Tiles", fileDataType: "filemap", defaultVersion: "1.1", encoders: {"1.1": encodeTileset}});
  }
  /** Returns files to serve together; this method performs no file I/O. */
  write(params: ModelExportParams, options: ThreeDTilesExportOptions = {}): Promise<ThreeDTilesExportResult> {
    return super.write(params, options);
  }
}
