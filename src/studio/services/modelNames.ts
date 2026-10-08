import type {ImportSource} from "./importDialogState";

const titles = new WeakMap<object, string>();
export function setModelTitle(model: object, title: string): void { titles.set(model, title); }
export function modelTitle(model: {id: string}): string { return titles.get(model) || model.id; }
export function importTitle(sources: ImportSource[]): string {
  const source = sources.find(source => !["datamodel", "mtl"].includes(source.slotKey)) || sources[0];
  if (!source) return "Model";
  if (source.name) return source.name;
  try { return decodeURIComponent(new URL(source.url).pathname.split("/").pop() || "Model"); }
  catch { return "Model"; }
}
