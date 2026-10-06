import type {RepresentationValidationIssue} from "./RepresentationValidationIssue";
import type {RepresentationValidationInput} from "./RepresentationValidationInput";

/**
 * Application-owned, deterministic validation of representation meaning.
 *
 * Register on {@link Scene.representationSchemas} for authoring/loading checks,
 * independently of installing a renderer plugin. Validation must be synchronous,
 * side-effect free and independent of DOM, Viewer, network and GPU availability.
 * Device, camera and renderer capability checks belong to the consuming adapter.
 */
export interface RepresentationSchema {

  /** Exact semantic type handled by this validator. */
  readonly type: string;

  /** Nonempty list of positive integer schema versions this validator understands. */
  readonly versions: readonly number[];

  /**
   * Checks known parameter and resource requirements.
   *
   * @param input Readonly definition and resolved numerical resources.
   * @returns An empty array on success, otherwise deterministic validation issues.
   */
  validate(input: RepresentationValidationInput): readonly RepresentationValidationIssue[];
}
