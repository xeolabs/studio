/** Lightweight ordering only. Descriptors and reactive rows are built for one page, not the collection. */
export class PagedTreeCollection<T> {
  constructor(readonly keys: readonly string[], private readonly describe: (key: string) => T,
    private readonly nodeId: (key: string) => string) {}

  get length(): number { return this.keys.length; }

  page(index: number, size: number): T[] {
    return this.keys.slice(index * size, (index + 1) * size).map(this.describe);
  }

  pageOf(id: string, size: number): number {
    const index = this.keys.findIndex(key => this.nodeId(key) === id);
    return index < 0 ? -1 : Math.floor(index / size);
  }
}

export function clampTreePage(index: number, count: number, size: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, Math.ceil(count / size) - 1));
}
export interface TreeCollectionSource<T> {
  keys(): Iterable<string>;
  describe(key: string): T;
  nodeId(key: string): string;
  compare?(a: string, b: string): number;
}

export function indexTreeCollection<T>(source: TreeCollectionSource<T>): PagedTreeCollection<T> {
  const keys = Array.from(source.keys());
  if (source.compare) keys.sort(source.compare);
  return new PagedTreeCollection(keys, source.describe, source.nodeId);
}

export function* recordKeys(record: object): Generator<string> {
  for (const id in record) if (Object.prototype.hasOwnProperty.call(record, id)) yield id;
}

export function* arrayKeys(array: readonly unknown[]): Generator<string> {
  for (let index = 0; index < array.length; index++) yield String(index);
}
