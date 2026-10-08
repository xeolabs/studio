import {BUNDLED_MODELS, type BundledModel, type InitialCamera} from "./bundledModels";

export interface StartupOptions {models: BundledModel[]; camera: InitialCamera;}

/** Validate the whole request before starting any model fetches. */
export function parseStartupOptions(search: string): StartupOptions {
  const query = new URLSearchParams(search);
  const requested = [...query.getAll("models"), ...query.getAll("model")];
  const ids = requested.length ? [...new Set(requested.flatMap(value => value.split(",").map(id => id.trim().toLowerCase())))] : ["duplex"];
  const models = ids.map(id => {
    const model = BUNDLED_MODELS.find(candidate => candidate.id === id);
    if (!model) throw new Error(`Unknown bundled model '${id}'. Choose ${BUNDLED_MODELS.map(model => model.id).join(", ")}.`);
    return model;
  });
  const fallback = models[0].camera;
  const vector = (key: "eye" | "look" | "up"): [number, number, number] => {
    if (!query.has(key)) return [...fallback[key]];
    const parts = query.get(key)!.split(",").map(part => part.trim());
    const values = parts.map(Number);
    if (parts.length !== 3 || parts.some(part => !part) || values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
      throw new Error(`Camera ${key} must contain three finite comma-separated coordinates.`);
    }
    return values as [number, number, number];
  };
  const camera: InitialCamera = {eye: vector("eye"), look: vector("look"), up: vector("up"),
    fov: query.has("fov") ? Number(query.get("fov")) : fallback.fov};
  if (!Number.isFinite(camera.fov) || camera.fov < 1 || camera.fov > 175) throw new Error("Camera fov must be between 1 and 175 degrees.");
  const direction = camera.look.map((value, axis) => value - camera.eye[axis]);
  const length = Math.hypot(...direction), upLength = Math.hypot(...camera.up);
  const cross = [direction[1] * camera.up[2] - direction[2] * camera.up[1],
    direction[2] * camera.up[0] - direction[0] * camera.up[2], direction[0] * camera.up[1] - direction[1] * camera.up[0]];
  if (length < 1e-8 || upLength < 1e-8 || Math.hypot(...cross) / length / upLength < 1e-6) {
    throw new Error("Camera eye and look must differ, and up must not be zero or parallel to the viewing direction.");
  }
  return {models, camera};
}
