import type {View} from "@xeokit/sdk/viewing/viewer";

export function capturePlanAppearance(view: View) {
  const edges = view.effects.edges;
  return {edges: {enabled: edges.enabled, useMeshColor: edges.useMeshColor, edgeColor: new Float64Array(edges.edgeColor),
    edgeAlpha: edges.edgeAlpha, edgeWidth: edges.edgeWidth},
    antiAliasing: view.effects.antiAliasing.enabled, resolutionScale: view.resolutionScale.enabled};
}
export function restorePlanAppearance(view: View, saved: ReturnType<typeof capturePlanAppearance>): void {
  Object.assign(view.effects.edges, saved.edges);
  view.effects.antiAliasing.enabled = saved.antiAliasing;
  view.resolutionScale.enabled = saved.resolutionScale;
}
export function applyPlanAppearance(view: View): void {
  Object.assign(view.effects.edges, {enabled: true, useMeshColor: false, edgeColor: new Float32Array([.18,.22,.26]), edgeAlpha: .85, edgeWidth: 1});
  view.effects.antiAliasing.enabled = true;
  view.resolutionScale.enabled = false;
}
