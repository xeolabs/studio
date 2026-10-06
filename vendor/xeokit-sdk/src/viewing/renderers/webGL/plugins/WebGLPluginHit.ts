/** CPU intersection returned by a plugin; classification is preserved in PickResult. */
export type WebGLPluginHit =
  | {

      /** Claims an actual surface intersection. The plugin is responsible for accuracy. */
      kind: "plugin-exact";

      /** Finite XYZ position in the bound mesh's local coordinates. */
      localPosition: readonly [number, number, number] | readonly number[];
    }
  | {

      /** Intersection with a surrogate, unsuitable for exact surface measurements. */
      kind: "plugin-proxy";

      /** Required name of the surrogate, for example influence-sphere. */
      representation: string;

      /** Finite XYZ position on the surrogate in mesh-local coordinates. */
      localPosition: readonly [number, number, number] | readonly number[];
    };
