import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {RepresentationValidationInput} from "./RepresentationValidationInput";
import type {RepresentationSchema} from "./RepresentationSchema";
import type {RepresentationValidationResult} from "./RepresentationValidationResult";

/** Optional, scene-owned schema catalog. Unknown definitions remain serializable. */
export class RepresentationSchemaCatalog {

  private readonly schemas = new Map<string, RepresentationSchema>();

  /**
   * Adds a CPU validator without creating renderer/device state.
   *
   * @param schema Validator for exactly one semantic type and supported versions.
   * @returns Success, or InvalidInput for duplicate type or invalid version declarations.
   */
  register(schema: RepresentationSchema): SDKResult<void> {
    if (
      !schema.type ||
      !schema.versions.length ||
      schema.versions.some((version) => !Number.isSafeInteger(version) || version < 1) ||
      this.schemas.has(schema.type)
    ) {
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `Duplicate or invalid representation schema: ${schema.type}`,
      };
    }
    this.schemas.set(schema.type, schema);
    return {ok: true, value: undefined};
  }

  /**
   * Checks a definition without requiring executable rendering support.
   *
   * @param input Structurally valid definition and resolved semantic resource inputs.
   * @returns Known schema validity, or an explicit unknown/unsupported result.
   * Validator exceptions become an invalid result with code validator-failed.
   */
  validate(input: RepresentationValidationInput): RepresentationValidationResult {
    const schema = this.schemas.get(input.representation.type);
    if (!schema) return {status: "unknown-type"};
    if (!schema.versions.includes(input.representation.schemaVersion)) return {status: "unsupported-schema"};
    try {
      const issues = schema.validate(input);
      return issues.length ? {status: "invalid", issues} : {status: "valid"};
    } catch (error) {
      return {status: "invalid", issues: [{code: "validator-failed", path: "", message: String(error)}]};
    }
  }
}
