import type {RepresentationInstanceIdentity} from "../../../rendering/plugins/RepresentationInstanceIdentity";
import type {RendererPluginInstanceStatus} from "../../../rendering/plugins/RendererPluginInstanceStatus";
import type {WebGLRepresentationSnapshot} from "./WebGLRepresentationSnapshot";
import type {WebGLPluginFrame} from "./WebGLPluginFrame";
import type {WebGLPluginHit} from "./WebGLPluginHit";
import type {WebGLPluginDepth} from "./WebGLPluginDepth";

/**
 * Synchronous adapter for an opaque-composition or host-sorted transparent contribution.
 *
 * Inputs belong to the Scene/View and must not be mutated. GPU callbacks run in
 * isolated GL state; use texture units 0..7 and your own VAOs. Draw into the bound
 * HDR framebuffer in render; prepare may draw into plugin-owned intermediates.
 * Failed rendering is rolled back to the preceding scene copy for that instance.
 * This initial adapter does not provide pre-AO, shadow or arbitrary scheduled passes.
 */
export interface WebGLRepresentationRuntime {

  /** Host insertion point. Transparent runtimes must declare test-only depth. */
  readonly stage: import("../../../rendering/plugins/RendererPluginStage").RendererPluginStage;


  /** Explicit output-depth claim, used to initialize testing and write state. */
  readonly depth: WebGLPluginDepth;

  /**
   * Pure CPU capability check, called with current camera, transform and style.
   * @returns Active, or an explicit unsupported/failure status with fallback policy.
   */
  validate(snapshot: WebGLRepresentationSnapshot): RendererPluginInstanceStatus;

  /** Optional GPU preparation. Cache intermediates and update them only when their inputs change. */
  prepare?(snapshot: WebGLRepresentationSnapshot): void;

  /**
   * Composes into the host's current HDR scene target. Viewport and writable depth
   * are initialized from the declared depth behavior. Composition starts with blending
   * disabled; transparent draws start with premultiplied alpha-over blending.
   * Preserve preceding depth for pixels without a surface/proxy claim. Write linear
   * HDR colour without tone mapping: the renderer applies bloom/tone mapping once.
   */
  render(snapshot: WebGLRepresentationSnapshot, frame: WebGLPluginFrame): void;

  /**
   * Optional synchronous CPU picking; must not issue GL calls or mutate inputs.
   * @param snapshot Current instance and View inputs.
   * @param localOrigin Unprojected ray start in mesh-local coordinates.
   * @param localDirection Normalized local ray direction.
   * @returns An exact/proxy local hit, or null. Omitting this means no active plugin hit.
   */
  pick?(
    snapshot: WebGLRepresentationSnapshot,
    localOrigin: readonly number[],
    localDirection: readonly number[]
  ): WebGLPluginHit | null;

  /** Releases optional caches when a bound mesh is destroyed. */
  releaseInstance?(identity: RepresentationInstanceIdentity): void;

  /** Releases optional per-View state when that View is destroyed. */
  releaseView?(viewId: string): void;

  /** Releases runtime state on unregister, detach or context recovery. Host allocations are also reclaimed. */
  dispose(): void;
}
