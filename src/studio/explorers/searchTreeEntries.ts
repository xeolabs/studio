import type {TreeSearchEntry} from "./tree/treeSearchEntries";

export interface ExplorerSearchResult {entries: TreeSearchEntry[]; total: number;}
export const EXPLORER_SEARCH_LIMIT = 100;

/** Bounds reactive results and yields between batches; scanning does not expand any UI nodes. */
export async function searchTreeEntries(entries: Iterable<TreeSearchEntry>, query: string, signal?: AbortSignal, limit = EXPLORER_SEARCH_LIMIT): Promise<ExplorerSearchResult> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const result: ExplorerSearchResult = {entries: [], total: 0};
  if (!terms.length) return result;
  let scanned = 0;
  for (const entry of entries) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    const text = `${entry.title} ${entry.id} ${entry.type} ${entry.context || ''}`.toLocaleLowerCase();
    if (terms.every((term) => text.includes(term))) {
      result.total++;
      if (result.entries.length < limit) result.entries.push(entry);
    }
    if (++scanned % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return result;
}
