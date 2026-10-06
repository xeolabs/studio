import type {SceneRepresentationFallback} from "../../../model/scene/representation/SceneRepresentationFallback";

/**
 * Queryable routing outcome for one instance in one View.
 * Active means the adapter accepted the current inputs. Other states expose a
 * stable reason code plus resolved fallback policy; detail is explanatory text.
 * Availability can differ between Views and change after registration or updates.
 */
export type RendererPluginInstanceStatus =
  | {

      state: "active";
    }
  | {

      state: "pending" | "fallback" | "failed";

      policy: SceneRepresentationFallback;

      reason:
        | "disabled"
        | "plugin-missing"
        | "initializing"
        | "backend-unsupported"
        | "schema-invalid"
        | "schema-unsupported"
        | "resource-unavailable"
        | "camera-unsupported"
        | "capability-unsupported"
        | "execution-failed";

      detail?: string;
    };
