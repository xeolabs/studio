import type {RepresentationValidationIssue} from "./RepresentationValidationIssue";

/**
 * CPU schema result. Unknown types and unsupported versions remain serializable;
 * neither means malformed data. Only `invalid` reports a known schema violation.
 * Runtime/device support is reported separately by a renderer plugin registry.
 */
export type RepresentationValidationResult =
  | {

      status: "valid";
    }
  | {

      status: "unknown-type" | "unsupported-schema";
    }
  | {

      status: "invalid";

      issues: readonly RepresentationValidationIssue[];
    };
