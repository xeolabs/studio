import {encode as encodeV1} from "./versions/v1/encode";
import {encode as encodeV2} from "./versions/v2/encode";
import {encode as encodeV3} from "./versions/v3/encode";
import {ModelExporter} from "../ModelExporter";

/**
 * Exports a {@link model!scene.SceneModel | SceneModel} to an XGF file.
 *
 * Select version `"3.0.0"` to preserve scene representations, numerical resources
 * and mesh bindings. Exporting that content to an older version fails explicitly.
 *
 * For detailed usage, refer to {@link formats!xgf | @xeokit/sdk/formats/xgf}.
 *
 * XGF v2 carries the full visual model: geometry (positions, normals, UVs,
 * per-vertex colours, indices, edge indices, AABBs, modelling matrices and
 * fixed-topology geometry frames), per-mesh `frameTime`, 3D Gaussian Splatting
 * geometry (per-splat scales + rotation quaternions), PBR materials with
 * textures (image bytes + sampler params + colour-space encoding),
 * per-material `triplanarScale`, and objects referencing meshes.
 *
 * Geometry frames are complete replacement vertex states, not deltas. The
 * exported geometry owns the immutable frame position/normal data, while each
 * exported mesh owns its `frameTime` offset so shared framed geometry can be
 * sampled at different times by different meshes.
 */
export class XGFExporter extends ModelExporter {
  constructor() {
    super({
      format: "XGF",
      fileDataType: "arraybuffer",
      encoders: {
        "1.0.0": rejectRepresentationLoss(encodeV1),
        "2.0.0": rejectRepresentationLoss(encodeV2),
        "3.0.0": encodeV3
      },
      defaultVersion: "2.0.0"
    });
  }
}

/** An older container must not silently turn representation inputs into ordinary geometry. */
function rejectRepresentationLoss(encode: typeof encodeV2): typeof encodeV2 {
  return async (params, options) => {
    const model = params.sceneModel;
    if (model && (Object.keys(model.representations ?? {}).length || Object.keys(model.dataResources ?? {}).length ||
        Object.values(model.meshes).some(mesh => mesh.representationId !== undefined))) {
      throw new Error("Scene representations and numerical resources require XGF version 3.0.0");
    }
    return encode(params, options);
  };
}
