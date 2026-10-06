import type {SceneDataResourceParams} from "./SceneDataResourceParams";

/** @internal Validates CPU layout without allocating or copying the payload. */
export function validateDataResourceParams(params: SceneDataResourceParams): void {
  if (typeof params.id !== "string" || !params.id) throw new Error("Resource id is required");
  if (params.kind === "buffer") {
    const Type = {float32: Float32Array, uint32: Uint32Array, uint8: Uint8Array}[params.componentType];
    if (!Type || !(params.data instanceof Type))
      throw new Error("Resource componentType does not match its typed array");
  } else if (params.kind === "texture2d") {
    const channels = {r32float: 1, rg32float: 2, rgba32float: 4, rgba8unorm: 4}[params.format];
    const Type = params.format === "rgba8unorm" ? Uint8Array : Float32Array;
    if (
      !channels ||
      !Number.isSafeInteger(params.width) ||
      !Number.isSafeInteger(params.height) ||
      params.width < 1 ||
      params.height < 1 ||
      !(params.data instanceof Type) ||
      params.data.length !== params.width * params.height * channels
    )
      throw new Error("Invalid numerical texture shape or data type");
  } else throw new Error("Unsupported scene data resource kind");
}
