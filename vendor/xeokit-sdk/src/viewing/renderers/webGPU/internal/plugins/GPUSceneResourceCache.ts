import type {SceneDataResource} from "../../../../../model/scene/representation/SceneDataResource";
import type {WebGPUDeviceLike, WebGPUTextureLike} from "../../core/types";
import type {WebGPUPluginTexture} from "../../plugins";

/** Device-local, revision-aware numerical uploads shared across plugin runtimes. */
export class GPUSceneResourceCache {
  readonly textures = new Map<WebGPUPluginTexture, {view: unknown; texture?: WebGPUTextureLike}>();

  private readonly resources = new Map<SceneDataResource, {revision: number; handle: WebGPUPluginTexture}>();

  uploadedBytes = 0;

  constructor(private readonly device: WebGPUDeviceLike) {}

  texture(resource: SceneDataResource): WebGPUPluginTexture {
    if (resource.destroyed) throw new Error("Scene resource was destroyed");
    const previous = this.resources.get(resource);
    if (previous?.revision === resource.revision) return previous.handle;
    if (previous) this.remove(resource);
    const d = resource.descriptor;
    if (d.kind !== "texture2d") throw new Error("Expected a texture2d numerical resource");
    if (!this.device.queue.writeTexture) throw new Error("Device does not support texture uploads");
    const texture = this.device.createTexture({size: [d.width, d.height], format: d.format, usage: 4 | 2});
    const handle = Object.freeze({width: d.width, height: d.height, format: d.format});
    try {
      this.device.queue.writeTexture(
        {texture},
        resource.data as ArrayBufferView,
        {bytesPerRow: resource.data.byteLength / d.height},
        {width: d.width, height: d.height}
      );
      this.uploadedBytes += resource.data.byteLength;
      this.textures.set(handle, {texture, view: texture.createView()});
      this.resources.set(resource, {revision: resource.revision, handle});
      return handle;
    } catch (error) {
      texture.destroy?.();
      throw error;
    }
  }

  private remove(resource: SceneDataResource): void {
    const entry = this.resources.get(resource);
    if (!entry) return;
    this.textures.get(entry.handle)?.texture?.destroy?.();
    this.textures.delete(entry.handle);
    this.resources.delete(resource);
  }

  prune(): void {
    for (const [resource, entry] of this.resources) {
      if (resource.destroyed || resource.revision !== entry.revision) this.remove(resource);
    }
  }

  destroy(): void {
    for (const resource of this.resources.keys()) this.remove(resource);
  }
}
