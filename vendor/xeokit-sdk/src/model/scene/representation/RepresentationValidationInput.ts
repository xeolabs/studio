import type {SceneDataResource} from "./SceneDataResource";
import type {SceneRepresentationParams} from "./SceneRepresentationParams";

/** Immutable inputs to {@link RepresentationSchema.validate}, usable without a Viewer or device. */
export interface RepresentationValidationInput {

  /** Structurally valid definition to check against a known semantic schema. */
  representation: Readonly<SceneRepresentationParams>;

  /** Resolved semantic input names; undefined denotes an unresolved model-local reference. */
  resources: Readonly<Record<string, SceneDataResource | undefined>>;
}
