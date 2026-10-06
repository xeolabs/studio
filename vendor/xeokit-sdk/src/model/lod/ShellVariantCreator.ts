import type {SDKResult} from "../../base/core";
import type {ShellVariantParams} from "./ShellVariantParams";
import type {ShellVariantResult} from "./ShellVariantResult";

/**
 * Function signature for shell variant creation.
 *
 * @public
 */
export type ShellVariantCreator = (params: ShellVariantParams) => SDKResult<ShellVariantResult>;
