/** Identifies whether a picked position lies on a rendered surface or an explicit surrogate.
 * Measurement tools must not treat proxy or bounds hits as physical surface intersections.
 */
export type PickClassification =
  | {kind: "ordinary"}
  | {kind: "plugin-exact"; pluginType: string}
  | {kind: "plugin-proxy"; pluginType: string; representation: string}
  | {kind: "bounds-fallback"; pluginType: string; reason: string};
