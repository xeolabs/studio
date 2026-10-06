import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {TreeSearchEntry} from "../explorers/tree/treeSearchEntries";
import {revealTreePath} from "../explorers/tree/revealTreePath";
import {findObjectPath} from "../explorers/ifc/findObjectPath";
import type {ExplorerHostController} from "../explorers/ExplorerHostController";
import type {ExplorerSource, NavigableExplorerStore} from "../explorers/types";
import {searchTreeEntries} from "../explorers/searchTreeEntries";
import type {CommandRegistry} from "../commands/CommandRegistry";
import {REVEAL_DESTINATIONS} from "../explorers/revealDestinations";

const PANEL_IDS: Record<ExplorerSource, string> = {data: "data", scene: "scene", viewer: "viewerExplorer", ifc: "ifcStructure", ifcTypes: "ifcTypes", ifcStoreys: "ifcStoreys"};

interface NavigationRuntime {data: Data; scene: Scene; view: View;}

/** Resolves model identities to lazy explorer paths. Runtime is connected once after startup. */
export class ExplorerNavigationService {
  private runtime: NavigationRuntime | null = null;
  private revealRevision = 0;
  private disposed = false;

  constructor(private readonly params: {
    hosts: ExplorerHostController; commands: CommandRegistry; openPanel(id: string): void;
  }) {
    for (const destination of REVEAL_DESTINATIONS) {
      params.commands.register({
        id: destination.commandId, title: destination.label, category: "Explorers",
        enabled: (context, payload) => this.canReveal(destination.source, objectId(payload, context.selectedObjectId)),
        run: (payload, context) => this.revealObject(destination.source, objectId(payload, context?.selectedObjectId)!)
      });
    }
    params.commands.register({
      id: "explorer.revealResult", title: "Reveal Search Result", category: "Explorers",
      enabled: (_context, payload) => !!this.runtime && isSearchTarget(payload),
      run: async (payload) => {
        if (isSearchTarget(payload)) await this.revealResult(payload.source, payload.entry);
      }
    });
  }

  connect(runtime: NavigationRuntime): void { this.runtime = runtime; }
  dispose(): void { this.disposed = true; this.revealRevision++; this.runtime = null; }

  canReveal(source: ExplorerSource, id: string | null): boolean {
    if (!id || !this.runtime) return false;
    if (source === "scene") return !!this.runtime.scene.objects[id];
    if (source === "viewer") return !!this.runtime.view.objects[id];
    if (!this.runtime.data.objects[id]) return false;
    if (source === "data" || source === "ifcTypes") return true;
    if (source === "ifcStoreys") return !!this.params.hosts.getIfcStore(source)?.getObjectPath(id);
    const data = this.runtime.data;
    return !!findObjectPath(Object.keys(data.rootObjects), (parent) =>
      Object.values(data.objects[parent]?.related || {}).flatMap((relations) => relations.map((relation) => relation.relatedObject.id)), id);
  }

  async search(source: ExplorerSource, query: string, signal: AbortSignal, limit?: number) {
    const store = this.params.hosts.getStore(source);
    return searchTreeEntries(store?.getSearchEntries() || [], query, signal, limit);
  }

  revision(source: ExplorerSource): number { return this.params.hosts.getStore(source)?.state.revision || 0; }

  whenMounted(source: ExplorerSource) { return this.params.hosts.whenMounted(source); }

  async revealModel(source: "scene" | "data", id: string): Promise<void> {
    if (!this.runtime || !(source === "scene" ? this.runtime.scene.models[id] : this.runtime.data.models[id])) return;
    const revision = ++this.revealRevision;
    this.params.openPanel(PANEL_IDS[source]);
    const store = await this.params.hosts.whenMounted(source);
    if (!store || this.disposed || revision !== this.revealRevision) return;
    for (const entry of store.getSearchEntries()) {
      if (entry.kind === "model" && (entry.id === id || entry.id === `model:${id}`)) {
        await this.focusEntry(source, store, entry, revision);
        return;
      }
    }
    throw new Error("The imported model is no longer available in this explorer.");
  }

  private async revealObject(source: ExplorerSource, id: string): Promise<void> {
    if (!this.canReveal(source, id)) return;
    const revision = ++this.revealRevision;
    this.params.openPanel(PANEL_IDS[source]);
    const store = await this.params.hosts.whenMounted(source);
    if (!store || revision !== this.revealRevision || this.disposed) return;
    const path = store.getObjectPath?.(id);
    if (path) {
      await this.focusEntry(source, store, {id, title: id, type: "object", kind: "object", objectId: id, path}, revision);
      return;
    }
    let count = 0;
    for (const entry of store.getSearchEntries()) {
      if (entry.objectId === id) {
        await this.focusEntry(source, store, entry, revision);
        return;
      }
      if (++count % 256 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (revision !== this.revealRevision || this.disposed) return;
      }
    }
    throw new Error("The linked object is no longer available in this explorer.");
  }

  private async revealResult(source: ExplorerSource, entry: TreeSearchEntry): Promise<void> {
    const revision = ++this.revealRevision;
    this.params.openPanel(PANEL_IDS[source]);
    const store = await this.params.hosts.whenMounted(source);
    if (!store || this.disposed) return;
    await this.focusEntry(source, store, entry, revision);
  }

  private async focusEntry(source: ExplorerSource, store: NavigableExplorerStore, entry: TreeSearchEntry, revision: number): Promise<void> {
    const current = () => !this.disposed && revision === this.revealRevision && this.params.hosts.getStore(source) === store;
    const node = await revealTreePath(store, entry.path, current);
    if (node) this.params.hosts.focusNode(source, node);
    else if (current()) throw new Error("The search result changed or was removed. Search again.");
  }
}

function objectId(payload: unknown, selected?: string | null): string | null {
  if (payload === undefined) return selected || null;
  const id = (payload as {objectId?: unknown} | null)?.objectId;
  return typeof id === "string" && id ? id : null;
}

function isSearchTarget(payload: unknown): payload is {source: ExplorerSource; entry: TreeSearchEntry} {
  const target = payload as {source?: string; entry?: TreeSearchEntry} | null;
  return !!target && Object.prototype.hasOwnProperty.call(PANEL_IDS, target.source || "") && Array.isArray(target.entry?.path) &&
    target.entry.path.length > 0 && target.entry.path.every((id) => typeof id === "string");
}
