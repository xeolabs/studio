import type {RendererPluginInstanceStatus} from "../../../rendering/plugins/RendererPluginInstanceStatus";
import type {RepresentationInstanceIdentity} from "../../../rendering/plugins/RepresentationInstanceIdentity";
import type {WebGPURepresentationSnapshot} from "./WebGPURepresentationSnapshot";
import type {WebGPUPluginFrame} from "./WebGPUPluginFrame";
import type {WebGPUPluginDepth} from "./WebGPUPluginDepth";
import type {WebGPUPluginHit} from "./WebGPUPluginHit";

/** Runtime for one registration on one device; instances and Views must have independently keyed state. */
export interface WebGPURepresentationRuntime {

  /** Host insertion point. Transparent runtimes must declare test-only depth. */
  readonly stage: import("../../../rendering/plugins/RendererPluginStage").RendererPluginStage;

  /** Depth claim checked against every scene pipeline. Proxy depth never implies exact picking. */
  readonly depth: WebGPUPluginDepth;

  /** Deterministic per-instance/view capability check, without recording GPU work. */
  validate(snapshot: WebGPURepresentationSnapshot): RendererPluginInstanceStatus;

  /** Record preparation and composition. Throwing discards this instance's entire draw transaction. */
  render(snapshot: WebGPURepresentationSnapshot, frame: WebGPUPluginFrame): void;

  /** Optional local-space intersection. Ray direction is normalized. */
  pick?(
    snapshot: WebGPURepresentationSnapshot,
    origin: number[],
    direction: number[]
  ): WebGPUPluginHit | null;

  /** Release cached state when a binding is removed or its mesh is destroyed. */
  releaseInstance?(identity: RepresentationInstanceIdentity): void;

  /** Release cached camera-dependent state when a View is destroyed. */
  releaseView?(viewId: string): void;

  /** End the runtime; the host also releases all tracked GPU allocations. */
  dispose(): void;
}
