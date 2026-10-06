import type {
  USDSceneLike,
  USDTransformAnimationChannelLike,
  USDTransformAnimationLike,
  USDTransformAnimationProperty
} from "./buildSceneModel";

/**
 * Wraps a raw USD scene object and normalizes optional animation accessors.
 *
 * The current tinyusdz JS binding exposes static scene graph methods only.
 * This adapter accepts a small set of likely array/vector/count based shapes
 * so a future binding can provide sampled transform animation without another
 * mapper refactor.
 *
 * @internal
 */
export function adaptUSDScene(scene: USDSceneLike): USDSceneLike {
  return {
    getDefaultRootNode: () => scene.getDefaultRootNode(),
    getMesh: (contentId: number) => scene.getMesh(contentId),
    getMaterial: (materialId: number) => scene.getMaterial(materialId),
    getAnimations: () => normalizeAnimations(readRawAnimations(scene))
  };
}

function readRawAnimations(scene: any): any[] {
  if (!scene) {
    return [];
  }
  if (typeof scene.getAnimations === "function") {
    return vectorToArray(scene.getAnimations());
  }
  if (scene.animations) {
    return vectorToArray(scene.animations);
  }
  if (typeof scene.getAnimationCount === "function" && typeof scene.getAnimation === "function") {
    const out = [];
    for (let i = 0, n = Number(scene.getAnimationCount()) || 0; i < n; i++) {
      out.push(scene.getAnimation(i));
    }
    return out;
  }
  if (typeof scene.numAnimations === "function" && typeof scene.getAnimation === "function") {
    const out = [];
    for (let i = 0, n = Number(scene.numAnimations()) || 0; i < n; i++) {
      out.push(scene.getAnimation(i));
    }
    return out;
  }
  return [];
}

function normalizeAnimations(rawAnimations: any[]): USDTransformAnimationLike[] {
  const animations: USDTransformAnimationLike[] = [];
  for (const raw of rawAnimations) {
    const channels = normalizeChannels(readRawChannels(raw));
    if (channels.length === 0) {
      continue;
    }
    animations.push({
      id: readString(raw, ["id", "animationId"]),
      name: readString(raw, ["name", "displayName"]),
      channels
    });
  }
  return animations;
}

function readRawChannels(animation: any): any[] {
  if (!animation) {
    return [];
  }
  if (typeof animation.getChannels === "function") {
    return vectorToArray(animation.getChannels());
  }
  if (animation.channels) {
    return vectorToArray(animation.channels);
  }
  if (typeof animation.getChannelCount === "function" && typeof animation.getChannel === "function") {
    const out = [];
    for (let i = 0, n = Number(animation.getChannelCount()) || 0; i < n; i++) {
      out.push(animation.getChannel(i));
    }
    return out;
  }
  if (typeof animation.numChannels === "function" && typeof animation.getChannel === "function") {
    const out = [];
    for (let i = 0, n = Number(animation.numChannels()) || 0; i < n; i++) {
      out.push(animation.getChannel(i));
    }
    return out;
  }
  return [];
}

function normalizeChannels(rawChannels: any[]): USDTransformAnimationChannelLike[] {
  const channels: USDTransformAnimationChannelLike[] = [];
  for (const raw of rawChannels) {
    const property = readString(raw, ["property", "targetProperty", "xformProperty"]);
    if (!isTransformAnimationProperty(property)) {
      continue;
    }
    const times = readNumberValues(raw, ["times", "timeCodes", "sampleTimes"]);
    const values = readNumberValues(raw, ["values", "sampleValues"]);
    channels.push({
      targetPath: readString(raw, ["targetPath", "primPath", "nodePath", "path"]),
      targetNode: readValue(raw, ["targetNode", "node"]),
      property,
      times,
      values,
      interpolation: readString(raw, ["interpolation"]) === "STEP" ? "STEP" : "LINEAR"
    });
  }
  return channels;
}

function readValue(object: any, names: string[]): any {
  if (!object) {
    return undefined;
  }
  for (const name of names) {
    const value = object[name];
    if (value !== undefined) {
      return typeof value === "function" ? value.call(object) : value;
    }
    const getterName = `get${name[0].toUpperCase()}${name.slice(1)}`;
    const getter = object[getterName];
    if (typeof getter === "function") {
      return getter.call(object);
    }
  }
  return undefined;
}

function readString(object: any, names: string[]): string | undefined {
  const value = readValue(object, names);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberValues(object: any, names: string[]): number[] {
  return numberArray(readValue(object, names));
}

function numberArray(values: any): number[] {
  if (!values) {
    return [];
  }
  if (Array.isArray(values) || ArrayBuffer.isView(values)) {
    return Array.from(values as ArrayLike<number>);
  }
  if (typeof values.size === "function" && typeof values.get === "function") {
    const out = [];
    for (let i = 0, n = values.size(); i < n; i++) {
      out.push(values.get(i));
    }
    return out;
  }
  if (typeof values.length === "number") {
    return Array.from(values as ArrayLike<number>);
  }
  return [];
}

function vectorToArray(values: any): any[] {
  if (!values) {
    return [];
  }
  if (Array.isArray(values)) {
    return values;
  }
  if (typeof values.size === "function" && typeof values.get === "function") {
    const out = [];
    for (let i = 0, n = values.size(); i < n; i++) {
      out.push(values.get(i));
    }
    return out;
  }
  if (typeof values.length === "number") {
    return Array.from(values);
  }
  return [];
}

function isTransformAnimationProperty(property: any): property is USDTransformAnimationProperty {
  return property === "translation" || property === "rotation" || property === "scale";
}
