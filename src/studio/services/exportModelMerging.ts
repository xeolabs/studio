import type {SceneModel} from "@xeokit/sdk/model/scene";
import {exportCoordinateSystemIssue} from "./exportCoordinateSystems";

export {mergeDataModelParams} from "./exportDataModelMerging";

export function mergeSceneModelParams(sourceParams: any[], sceneModels: SceneModel[]): any {
  const coordinateIssue = exportCoordinateSystemIssue(sceneModels);
  if (coordinateIssue) throw new Error(coordinateIssue);
  const merged: any = {
    id: "merged-scene-export",
    version: "1.0",
    coordinateSystem: sourceParams[0]?.coordinateSystem,
    transforms: [],
    geometries: [],
    geometriesCompressed: [],
    textures: [],
    materials: [],
    meshes: [],
    objects: [],
    variantSets: [],
    animations: []
  };
  for (let i = 0; i < sourceParams.length; i++) {
    appendSceneModelParams(merged, remapSceneModelParams(sourceParams[i], `export${i}`));
  }
  return pruneEmptyArrays(merged);
}

function appendSceneModelParams(target: any, source: any): void {
  appendArray(target.transforms, source.transforms);
  appendArray(target.geometries, source.geometries);
  appendArray(target.geometriesCompressed, source.geometriesCompressed);
  appendArray(target.textures, source.textures);
  appendArray(target.materials, source.materials);
  appendArray(target.meshes, source.meshes);
  appendArray(target.objects, source.objects);
  appendArray(target.variantSets, source.variantSets);
  appendArray(target.animations, source.animations);
}

function remapSceneModelParams(params: any, namespace: string): any {
  const ids = {
    animation: (id: string) => scopedId(namespace, id),
    geometry: (id: string) => scopedId(namespace, id),
    material: (id: string) => scopedId(namespace, id),
    mesh: (id: string) => scopedId(namespace, id),
    variantSet: (id: string) => scopedId(namespace, id),
    texture: (id: string) => scopedId(namespace, id),
    transform: (id: string) => scopedId(namespace, id)
  };
  return {
    transforms: (params.transforms || []).map((transform: any) => ({
      ...transform,
      id: ids.transform(transform.id),
      parentTransformId: transform.parentTransformId ? ids.transform(transform.parentTransformId) : undefined
    })),
    geometries: (params.geometries || []).map((geometry: any) => ({...geometry, id: ids.geometry(geometry.id)})),
    geometriesCompressed: (params.geometriesCompressed || []).map((geometry: any) => ({...geometry, id: ids.geometry(geometry.id)})),
    textures: (params.textures || []).map((texture: any) => ({...texture, id: ids.texture(texture.id)})),
    materials: (params.materials || []).map((material: any) => remapSceneMaterialParams(material, ids)),
    meshes: (params.meshes || []).map((mesh: any) => ({
      ...mesh,
      id: ids.mesh(mesh.id),
      geometryId: ids.geometry(mesh.geometryId),
      materialId: mesh.materialId ? ids.material(mesh.materialId) : undefined,
      parentTransformId: mesh.parentTransformId ? ids.transform(mesh.parentTransformId) : undefined
    })),
    objects: (params.objects || []).map((object: any) => ({
      ...object,
      // Preserve global identity, including links to DataObjects. Only assets
      // owned locally by the source SceneModel need an export namespace.
      meshIds: (object.meshIds || []).map((meshId: string) => ids.mesh(meshId))
    })),
    variantSets: (params.variantSets || []).map((variantSet: any) => ({
      ...variantSet,
      id: ids.variantSet(variantSet.id),
      variants: (variantSet.variants || []).map((variant: any) => ({
        ...variant,
        objectIds: (variant.objectIds || []).slice()
      }))
    })),
    animations: (params.animations || []).map((animation: any) => remapSceneAnimationParams(animation, ids))
  };
}

function remapSceneMaterialParams(material: any, ids: {material: (id: string) => string; texture: (id: string) => string}): any {
  const mapped = {...material};
  mapped.id = ids.material(material.id);
  for (const key of ["colorTextureId", "metallicRoughnessTextureId", "occlusionTextureId", "normalsTextureId", "emissiveTextureId"]) {
    if (mapped[key]) {
      mapped[key] = ids.texture(mapped[key]);
    }
  }
  return mapped;
}

function remapSceneAnimationParams(animation: any, ids: any): any {
  return {
    ...animation,
    id: ids.animation(animation.id),
    channels: (animation.channels || []).map((channel: any) => {
      const target = channel.target;
      if (target?.type === "transform") {
        return {...channel, target: {...target, transformId: ids.transform(target.transformId)}};
      }
      if (target?.type === "vertexState" || target?.type === "morphWeights") {
        return {...channel, target: {...target, meshId: ids.mesh(target.meshId)}};
      }
      return channel;
    })
  };
}

function appendArray(target: any[], source: any[] | undefined): void {
  if (source && source.length > 0) {
    target.push(...source);
  }
}

function pruneEmptyArrays<T extends Record<string, any>>(params: T): T {
  for (const key of Object.keys(params)) {
    if (Array.isArray(params[key]) && params[key].length === 0) {
      delete params[key];
    }
  }
  return params;
}

function scopedId(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}
