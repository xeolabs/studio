import {SDKErrorType, type SDKResult} from "../../base/core";
import {TrianglesPrimitive} from "../../base/constants";
import type {
  SceneGeometry,
  SceneMaterial,
  SceneMesh,
  SceneObject,
  SceneVariantParams
} from "../scene";
import {ShellGenerator} from "./ShellGenerator";
import type {ShellVariantParams} from "./ShellVariantParams";
import type {ShellVariantResult} from "./ShellVariantResult";

/**
 * Creates a generated shell variant set in a SceneModel.
 *
 * This is the model-side utility used by viewing-layer impostor shell LOD. It
 * creates the shell geometry, mesh, object and variant set together so
 * the model itself declares that the source objects and shell object are
 * alternative variants of the same logical content.
 *
 * The shell follows the {@link ShellGeneratorResult} coordinate contract:
 * generated positions are relative to the generated center, and the shell mesh
 * is placed at that center.
 *
 * @param params Creation parameters.
 * @returns Created variant set and generated shell resources.
 *
 * @public
 */
export function createShellVariant(params: ShellVariantParams): SDKResult<ShellVariantResult> {
  if (!params) {
    return error(SDKErrorType.InvalidInput, "[createShellVariant] Missing required params.");
  }
  const model = params.model;
  if (!model || model.destroyed) {
    return error(SDKErrorType.InvalidInput, "[createShellVariant] Expected a live SceneModel.");
  }
  if (!params.id) {
    return error(SDKErrorType.InvalidInput, "[createShellVariant] Missing required variant set ID.");
  }
  if (model.variantSets[params.id]) {
    return error(SDKErrorType.InvalidInput, `[createShellVariant] SceneVariantSet already exists: '${params.id}'.`);
  }
  if (!params.objectIds || params.objectIds.length === 0) {
    return error(SDKErrorType.InvalidInput, "[createShellVariant] Expected at least one source object ID.");
  }

  const sourceObjects: SceneObject[] = [];
  for (let i = 0, len = params.objectIds.length; i < len; i++) {
    const objectId = params.objectIds[i];
    const object = model.objects[objectId];
    if (!object || object.destroyed) {
      return error(SDKErrorType.InvalidInput, `[createShellVariant] Source SceneObject not found in SceneModel '${model.id}': '${objectId}'.`);
    }
    sourceObjects.push(object);
  }

  const generator = params.generator ?? new ShellGenerator();
  const shell = generator.generate(sourceObjects, params.generation ?? {});
  if (shell.indices.length === 0 || shell.positions.length === 0) {
    return error(SDKErrorType.InvalidInput, "[createShellVariant] No shell triangles were generated.");
  }

  const shellGeometryId = params.shellGeometryId ?? `shellGeometry:${params.id}`;
  const shellMeshId = params.shellMeshId ?? `shellMesh:${params.id}`;
  const shellObjectId = params.shellObjectId ?? `shellObject:${params.id}`;
  const shellMaterialId = params.shellMaterialId ?? "shellMaterial";
  const shellColor = params.shellColor ?? [0.72, 0.76, 0.78];
  const shellOpacity = params.shellOpacity ?? 1;

  const geometryResult = model.createGeometry({
    id: shellGeometryId,
    primitive: TrianglesPrimitive,
    positions: shell.positions,
    indices: shell.indices
  });
  if (geometryResult.ok === false) {
    return geometryResult;
  }
  let geometry: SceneGeometry | null = geometryResult.value;
  let material: SceneMaterial | null = null;
  let mesh: SceneMesh | null = null;
  let object: SceneObject | null = null;

  const materialResult = ensureShellMaterial(model, shellMaterialId, shellColor, shellOpacity);
  if (materialResult.ok === false) {
    destroyCreated(geometry, mesh, object);
    return materialResult;
  }
  material = materialResult.value;

  const meshResult = model.createMesh({
    id: shellMeshId,
    geometryId: shellGeometryId,
    materialId: shellMaterialId,
    position: shell.center,
    color: shellColor,
    opacity: shellOpacity
  });
  if (meshResult.ok === false) {
    destroyCreated(geometry, mesh, object);
    return meshResult;
  }
  mesh = meshResult.value;

  const objectResult = model.createObject({
    id: shellObjectId,
    meshIds: [shellMeshId],
    originalSystemId: shellObjectId
  });
  if (objectResult.ok === false) {
    destroyCreated(geometry, mesh, object);
    return objectResult;
  }
  object = objectResult.value;

  const detailedVariant: SceneVariantParams = {
    id: params.detailedVariantId ?? "detailed",
    objectIds: params.objectIds.slice()
  };
  if (params.detailedRange) {
    detailedVariant.range = params.detailedRange;
  }
  const shellVariant: SceneVariantParams = {
    id: params.shellVariantId ?? "shell",
    objectIds: [shellObjectId]
  };
  if (params.shellRange) {
    shellVariant.range = params.shellRange;
  }

  const variantSetResult = model.createVariantSet({
    id: params.id,
    defaultVariantId: detailedVariant.id,
    selection: params.selection,
    variants: [detailedVariant, shellVariant]
  });
  if (variantSetResult.ok === false) {
    destroyCreated(geometry, mesh, object);
    geometry = null;
    mesh = null;
    object = null;
    return variantSetResult;
  }

  return {
    ok: true,
    value: {
      shell,
      variantSet: variantSetResult.value,
      geometry,
      mesh,
      object,
      material
    }
  };
}

function ensureShellMaterial(
  model: ShellVariantParams["model"],
  id: string,
  color: ShellVariantParams["shellColor"],
  opacity: number
): SDKResult<SceneMaterial> {
  const existing = model.materials[id];
  if (existing) {
    return {ok: true, value: existing};
  }
  return model.createMaterial({
    id,
    color,
    opacity
  });
}

function destroyCreated(
  geometry: SceneGeometry | null,
  mesh: SceneMesh | null,
  object: SceneObject | null
): void {
  if (object && !object.destroyed) {
    object.destroy();
  }
  if (mesh && !mesh.destroyed) {
    mesh.destroy();
  }
  if (geometry && !geometry.destroyed) {
    geometry.destroy();
  }
}

function error<T>(type: SDKErrorType, message: string): SDKResult<T> {
  return {ok: false, type, error: message};
}
