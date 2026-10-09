import type {View, ViewObject} from "@xeokit/sdk/viewing/viewer";

export type ObjectEffectId = "visible" | "selected" | "highlighted" | "xrayed";
export type ObjectEffects = Record<ObjectEffectId, boolean>;

/** Shared semantics for individual ViewObjects and IFC subtrees. */
export function objectHasEffect(object: ViewObject | undefined, effect: ObjectEffectId): boolean {
  if (!object) return false;
  if (effect === "visible") return object.visible;
  if (effect === "highlighted") return !!object.colorize || object.hasStyleBin("highlighted");
  if (effect === "xrayed") return object.opacityUpdated || object.hasStyleBin("xrayed");
  return object.hasStyleBin("selected");
}

export function objectEffects(object?: ViewObject): ObjectEffects {
  return {visible: objectHasEffect(object, "visible"), selected: objectHasEffect(object, "selected"),
    highlighted: objectHasEffect(object, "highlighted"), xrayed: objectHasEffect(object, "xrayed")};
}

export function setObjectEffect(view: View, ids: string[], effect: ObjectEffectId, active: boolean): void {
  if (effect === "visible") {view.setObjectsVisible(ids, active); return;}
  if (effect === "highlighted") view.setObjectsColorized(ids, active ? [1, 0.86, 0.2] : null);
  if (effect === "xrayed") view.setObjectsOpacity(ids, active ? 0.28 : null);
  view.setObjectsInStyleBin(effect, ids, active);
}
