import type {SceneDataResource} from "../../../../model/scene/representation/SceneDataResource";
import type {SceneRepresentation} from "../../../../model/scene/representation/SceneRepresentation";
import type {RepresentationInstanceIdentity} from "../../../rendering/plugins/RepresentationInstanceIdentity";

/**
 * Coherent inputs for one bound mesh in one View, captured for the current frame.
 *
 * Matrices are column-major. Geometry poses and resource payloads are borrowed,
 * readonly by contract, and may be reused on subsequent frames. Cache derived
 * values by instance/revision; do not retain a pose array as an immutable recording.
 */
export interface WebGLRepresentationSnapshot {

  /** Identity of the mesh binding, independent of the current View. */
  readonly instance: RepresentationInstanceIdentity;

  /** View for which camera, visibility and style were resolved. */
  readonly viewId: string;

  /** Ownership of the binding; augmenting meshes retain their ordinary drawing. */
  readonly mode: import("../../../../model/scene/representation/SceneRepresentationMode").SceneRepresentationMode;

  /** Resolved per-View enable override, independent of object visibility. */
  readonly enabled: boolean;

  /** Object style-bin memberships. Plugins may shade or explicitly reject unsupported styles. */
  readonly styleBinIds: readonly string[];


  /** Live model-owned definition; treat all its values as readonly. */
  readonly representation: SceneRepresentation;

  /** Semantic resource inputs resolved within the owning model; missing IDs map to undefined. */
  readonly resources: Readonly<Record<string, SceneDataResource | undefined>>;

  /** Source geometry with at most two decoded sampled poses; the adapter interprets its meaning. */
  readonly geometry: {

    /** SDK primitive constant of the source geometry. */
    readonly primitive: number;

    /** Decoded XYZ positions of the first sampled pose, in mesh-local coordinates. */
    readonly positionsA: Float32Array;

    /** Decoded XYZ positions of the second sampled pose. */
    readonly positionsB: Float32Array;

    /** Index of the first pose within the source recording. */
    readonly stateA: number;

    /** Index of the second pose within the source recording. */
    readonly stateB: number;

    /** Linear interpolation weight in [0, 1]. */
    readonly factor: number;

    /** Source geometry version; invalidates cached decoded data and topology. */
    readonly revision: number;

    /** Optional interleaved RGBA8 vertex values, without interpretation by the host. */
    readonly colors?: Uint8Array;
  };

  /** Mesh-local to Scene world transform. */
  readonly worldMatrix: Float64Array;

  /** Scene world to eye-space transform from the current camera. */
  readonly viewMatrix: Float64Array;

  /** Eye-space to WebGL clip-space transform. */
  readonly projectionMatrix: Float64Array;

  /** Clip-space to mesh-local transform for ray reconstruction and depth unprojection. */
  readonly inverseModelViewProjection: Float64Array;

  /** Camera eye transformed into mesh-local coordinates as homogeneous XYZW. */
  readonly localEye: Float64Array;

  /** Projection family; declare unsupported families in runtime.validate. */
  readonly projection: "perspective" | "orthographic" | "other";

  /** Resolved ViewObject visibility/culling, followed by pickable participation. */
  readonly visible: boolean;

  /** Whether this instance participates in normal picking. */
  readonly pickable: boolean;

  /** Resolved mesh × ViewObject opacity and RGB colour multiplier. */
  readonly opacity: number;

  /** Resolved mesh colour multiplied by ViewObject colorize, as linear RGB factors. */
  readonly color: Float32Array;

  /** Active clipping planes in Scene world coordinates. Reject unsupported clipping explicitly. */
  readonly sectionPlanes: readonly {

    position: readonly number[];

    direction: readonly number[];
  }[];
}
