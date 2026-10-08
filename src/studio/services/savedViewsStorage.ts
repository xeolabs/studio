import {OrthoProjectionType, PerspectiveProjectionType, OrbitNavigationMode, PlanViewNavigationMode, FirstPersonNavigationMode} from "@xeokit/sdk/base/constants";
import type {Scene} from "@xeokit/sdk/model/scene";
import {getSceneCollisionIndex} from "@xeokit/sdk/spatial/collision";
import {modelTitle} from "./modelNames";
import type {SavedView, SavedViewSnapshot} from "../state/savedViewsState";

export const savedViewsStoragePrefix = "xeokit.studio.saved-views.v1:";

/** Stable across import-generated model IDs and load order; includes placement and element bounds. */
export function savedViewsModelKey(scene: Scene): string {
  const index = getSceneCollisionIndex(scene);
  const coord = (system: Scene["coordinateSystem"]) => [Array.from(system.basis), Array.from(system.origin), system.units, system.scaleToMeters];
  const models = Object.values(scene.models).filter(model => Object.keys(model.objects).length).map(model => {
    const objects = Object.keys(model.objects).sort().map(id => [id, Array.from(index.getObjectAABB(id) || []), model.objects[id].meshes.length]);
    // An untitled generated model ID is not a stable source name.
    const title = modelTitle(model);
    return hash(JSON.stringify([title === model.id ? "" : title, coord(model.coordinateSystem), model.stats, objects]));
  }).sort();
  return models.length ? hash(JSON.stringify([coord(scene.coordinateSystem), models])) : "";
}

function hash(value: string): string {
  let a = 2166136261, b = 3335557771;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const vector = (value: unknown, length = 3): value is number[] => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string");
const boolean = (value: unknown) => typeof value === "boolean";
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Treat browser storage as untrusted; never apply a partial or invalid viewpoint. */
export function validSavedSnapshot(value: unknown): value is SavedViewSnapshot {
  const s = value as SavedViewSnapshot;
  if (!s || typeof s !== "object") return false;
  const c = s.camera, cut = s.section, appearance = s.appearance, isolation = s.isolation;
  if (!c || !vector(c.eye) || !vector(c.look) || !vector(c.up) || Math.hypot(...c.up) < .000001
    || Math.hypot(...c.eye.map((v, i) => v - c.look[i])) < .000001
    || ![OrthoProjectionType, PerspectiveProjectionType].includes(c.projection) || !positive(c.scale)
    || !positive(c.fov) || c.fov >= 180 || !positive(c.near) || !(c.far > c.near) || !Number.isFinite(c.far)
    || !positive(c.orthoNear) || !(c.orthoFar > c.orthoNear) || !Number.isFinite(c.orthoFar) || ![OrbitNavigationMode, PlanViewNavigationMode, FirstPersonNavigationMode].includes(c.navMode)) return false;
  if (!cut || !boolean(cut.enabled) || !["horizontal", "vertical"].includes(cut.orientation)
    || !["front", "side"].includes(cut.verticalAxis) || !Number.isFinite(cut.position) || cut.position < 0 || cut.position > 100
    || !boolean(cut.flipped) || typeof cut.planFloorId !== "string" || !positive(cut.planCutHeight) || cut.planCutHeight > 5
    || !boolean(cut.planStyle) || !boolean(cut.labelsEnabled) || !["sparse", "balanced", "dense"].includes(cut.labelDensity)
    || !Array.isArray(cut.planes) || !cut.planes.every(p => p && typeof p.id === "string" && boolean(p.managed)
      && vector(p.pos) && vector(p.dir) && Math.hypot(...p.dir) > .000001 && boolean(p.active))) return false;
  if (!strings(s.hidden) || !strings(s.xrayed) || !strings(s.highlighted) || !isolation || typeof isolation.label !== "string"
    || !(isolation.previous === null || (Array.isArray(isolation.previous) && isolation.previous.every(pair => Array.isArray(pair)
      && pair.length === 2 && typeof pair[0] === "string" && boolean(pair[1]))))) return false;
  const edges = appearance?.edges;
  return !!edges && boolean(edges.enabled) && boolean(edges.useMeshColor) && vector(edges.edgeColor)
    && Number.isFinite(edges.edgeAlpha) && edges.edgeAlpha >= 0 && edges.edgeAlpha <= 1 && positive(edges.edgeWidth)
    && boolean(appearance.antiAliasing) && boolean(appearance.resolutionScale);
}

export function readSavedViews(storage: Pick<Storage, "getItem">, key: string): SavedView[] {
  const raw = storage.getItem(savedViewsStoragePrefix + key);
  if (!raw) return [];
  const record = JSON.parse(raw);
  if (record?.version !== 1 || record.modelKey !== key || !Array.isArray(record.items)) throw new Error("Invalid saved views");
  const ids = new Set<string>();
  for (const item of record.items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim()
      || item.name.length > 100 || typeof item.createdAt !== "string" || typeof item.floorTitle !== "string"
      || typeof item.thumbnail !== "string" || (item.thumbnail && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.thumbnail))
      || !validSavedSnapshot(item.snapshot)) throw new Error("Invalid saved view");
    ids.add(item.id);
  }
  return record.items;
}

export function writeSavedViews(storage: Pick<Storage, "setItem">, key: string, items: SavedView[]): void {
  storage.setItem(savedViewsStoragePrefix + key, JSON.stringify({version: 1, modelKey: key, items}));
}
