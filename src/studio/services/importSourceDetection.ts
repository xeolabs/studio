import type {ImportDataSet} from "../importing/ImportDataSet";
import type {ImportDataSetFile} from "../importing/ImportDataSetFile";
import type {ImportSource} from "./importDialogState";

export function sourceExtension(source: ImportSource): string {
  let name = source.name;
  if (source.mode === "url") {
    try { name = new URL(source.url).pathname; } catch { return ""; }
  }
  return name.slice(name.lastIndexOf(".")).toLowerCase();
}

export function acceptsSource(spec: ImportDataSetFile, source: ImportSource): boolean {
  const extension = sourceExtension(source);
  // Download endpoints may not have an extension; an explicit format/role is then needed.
  return source.mode === "url" && !/\.[a-z0-9]+$/.test(extension) || spec.accept.split(",").includes(extension);
}

/** Select only an unambiguous format. JSON and multiple same-role files require a choice. */
export function detectImportDataSet(sources: ImportSource[], dataSets: ImportDataSet[]): string {
  if (!sources.length) return "";
  if (sources.every(source => sourceExtension(source) === ".json")) return "";
  const candidates = dataSets.filter(set => sources.every(source => set.files.some(spec => acceptsSource(spec, source))) &&
    sources.some(source => acceptsSource(set.files[0], source)));
  const ranked = candidates.map(set => ({set, matches: set.files.filter(spec => sources.some(s => acceptsSource(spec, s))).length}));
  ranked.sort((a, b) => b.matches - a.matches || a.set.files.length - b.set.files.length);
  const best = ranked[0];
  if (!best || ranked.some((r, i) => i > 0 && r.matches === best.matches && r.set.files.length === best.set.files.length)) return "";
  return best.set.id;
}

/** Retain explicit roles, then assign only one-to-one matches. Never silently choose between two files. */
export function assignImportSources(sources: ImportSource[], dataSet?: ImportDataSet): void {
  const specs = dataSet?.files ?? [];
  const claimed = new Set<string>();
  for (const source of sources) {
    const spec = specs.find(s => s.key === source.slotKey);
    if (!spec || !acceptsSource(spec, source) || claimed.has(spec.key)) source.slotKey = "";
    else claimed.add(spec.key);
  }
  for (const spec of specs) {
    if (claimed.has(spec.key)) continue;
    const matches = sources.filter(s => !s.slotKey && acceptsSource(spec, s));
    if (matches.length !== 1) continue;
    const source = matches[0];
    const roles = specs.filter(s => !claimed.has(s.key) && acceptsSource(s, source));
    if (roles.length === 1) { source.slotKey = spec.key; claimed.add(spec.key); }
  }
}
