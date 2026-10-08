import type {TreeSearchEntry} from "./tree/treeSearchEntries";

export interface ExplorerSearchResult {entries: TreeSearchEntry[]; total: number;}
export const EXPLORER_SEARCH_LIMIT = 100;

/** Bounds reactive results and yields between batches; scanning does not expand any UI nodes. */
export async function searchTreeEntries(entries: Iterable<TreeSearchEntry>, query: string, signal?: AbortSignal, limit = EXPLORER_SEARCH_LIMIT): Promise<ExplorerSearchResult> {
  const phrase = query.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const terms = phrase.split(" ").filter(Boolean);
  // Keep bounded candidates at each relevance level, even when the best match is
  // encountered after the first page. IDs remain searchable without outranking names.
  const matches: TreeSearchEntry[][] = Array.from({length: 5}, () => []);
  const result: ExplorerSearchResult = {entries: [], total: 0};
  if (!terms.length) return result;
  let scanned = 0;
  for (const entry of entries) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    const title = entry.title.toLocaleLowerCase();
    const id = entry.id.toLocaleLowerCase();
    const semanticText = `${entry.title} ${entry.type} ${entry.context || ''}`.toLocaleLowerCase();
    const text = `${semanticText} ${id}`;
    if (terms.every((term) => text.includes(term))) {
      result.total++;
      const rank = title === phrase || id === phrase ? 0 : title.includes(phrase) ? 1
        : semanticText.includes(phrase) ? 2 : terms.every(term => semanticText.includes(term)) ? 3 : 4;
      if (matches[rank].length < limit) matches[rank].push(entry);
    }
    if (++scanned % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  result.entries = matches.flat().slice(0, limit);
  return result;
}
