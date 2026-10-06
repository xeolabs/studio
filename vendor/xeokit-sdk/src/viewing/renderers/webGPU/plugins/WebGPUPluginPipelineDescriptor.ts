import type {WebGPUPluginBindingLayout} from "./WebGPUPluginBindingLayout";
import type {WebGPUPluginVertexBufferLayout} from "./WebGPUPluginVertexBufferLayout";
import type {WebGPUPluginDepth} from "./WebGPUPluginDepth";

/** Bounded render pipeline declaration. The host supplies formats, layouts and attachment ownership. */
export interface WebGPUPluginPipelineDescriptor {
  /** Label attached to shader and pipeline diagnostics. */
  readonly label: string;

  /** WGSL module containing the vertex and fragment entry points. */
  readonly code: string;

  /** Vertex entry point; defaults to 'vs'. */
  readonly vertexEntry?: string;

  /** Fragment entry point; defaults to 'fs'. */
  readonly fragmentEntry?: string;

  /** Bindings in group zero, shared by both shader stages. */
  readonly bindings: readonly WebGPUPluginBindingLayout[];

  /** Optional vertex/instance streams, indexed by buffer slot. */
  readonly vertexBuffers?: readonly WebGPUPluginVertexBufferLayout[];

  /** Primitive topology; defaults to triangle-list. */
  readonly topology?: "triangle-list" | "triangle-strip" | "line-list" | "point-list";

  /** Scene composition has depth/stencil; intermediate targets have colour only. */
  readonly target: "scene" | "intermediate";

  /** Linear-HDR colour blending; defaults to replace. `over` requires premultiplied RGB. */
  readonly blend?: "replace" | "add" | "over";

  /** Claimed depth behavior; must agree with the runtime for scene draws. Defaults to none. */
  readonly depth?: WebGPUPluginDepth;
}
