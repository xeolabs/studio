import type {LODSuppressionDelta} from "./LODSuppressionDelta";

/** Ordered explicit-suppression changes between two versions of a View's state. */
export interface LODSuppressionDeltas {

  /** Version from which the consumer requests changes. */
  fromVersion: number;

  /** Version reached after applying these changes. */
  toVersion: number;

  /** Incremental changes to apply in order. */
  deltas: readonly LODSuppressionDelta[];
}
