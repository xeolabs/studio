import type {SceneModel, SceneModelUpdateMode} from "../../../model/scene";
import type {MemoryConfigs} from "./MemoryConfigs";

/**
 * WebGPU-internal model allocation policy.
 */
export type WebGPUModelMemoryPolicy = "stream" | "compact";

/**
 * WebGPU renderer policy for models that declare renderer-neutral update mode.
 *
 * The policy is owned by WebGPURenderer. SceneModel only describes what kind of
 * model it is; this policy decides how that intent maps to WebGPU memory and
 * culling behavior.
 *
 * ```ts
 * const rendererResult = await WebGPURenderer.create({
 *   viewer,
 *   updateModePolicies: {
 *     static: {
 *       memoryPolicy: "compact",
 *       memoryConfigs: {
 *         compactSealedStreamPages: true
 *       }
 *     },
 *     dynamic: {
 *       memoryPolicy: "stream",
 *       memoryConfigs: {
 *         compactStreamPages: false,
 *         frustumCulling: true,
 *         minProjectedCanvasSize: 5
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * The matching `SceneModel` remains renderer-neutral:
 *
 * ```ts
 * const modelResult = scene.createModel({
 *   id: "campus",
 *   updateMode: "dynamic",
 *   loadingMode: "streaming"
 * });
 * ```
 */
export interface WebGPUUpdateModePolicy {
  /**
   * Renderer-owned allocation intent for matching SceneModels.
   *
   * This lets WebGPU infer compact-vs-stream storage from neutral model update
   * mode without requiring application code to set low-level renderer configurations.
   */
  memoryPolicy?: WebGPUModelMemoryPolicy;

  /**
   * GPU memory and packed-batch sizing overrides for matching SceneModels.
   */
  memoryConfigs?: Partial<MemoryConfigs>;
}

/**
 * WebGPU update-mode policy lookup table.
 *
 * Use this when the built-in `SceneModel.updateMode` mapping is close but a
 * viewer needs different WebGPU storage behavior for static or dynamic models.
 *
 * ## Static XGF/XKT/glTF Models
 *
 * Use compact storage for static models that will be sealed after loading:
 *
 * ```ts
 * const rendererResult = await WebGPURenderer.create({
 *   viewer,
 *   renderConfigs: {
 *     ...WEBGPU_RENDER_CONFIG_PROFILES.largeModel,
 *     triangleColorMode: "flat"
 *   },
 *   updateModePolicies: {
 *     static: {
 *       memoryPolicy: "compact",
 *       memoryConfigs: {
 *         compactSealedStreamPages: true
 *       }
 *     }
 *   }
 * });
 *
 * const modelResult = scene.createModel({
 *   id: "staticModel",
 *   updateMode: "static",
 *   loadingMode: "open"
 * });
 *
 * // Load the model, then seal once no more geometry will be added.
 * modelResult.value.seal();
 * ```
 *
 * ## Large Interactive Or Streaming Models
 *
 * Use stream storage for models that change often or keep receiving committed
 * chunks. Pair this with renderer-wide batch and culling limits in
 * `memoryConfigs` when interactivity matters more than minimizing draw count.
 *
 * ```ts
 * const rendererResult = await WebGPURenderer.create({
 *   viewer,
 *   renderConfigs: {
 *     ...WEBGPU_RENDER_CONFIG_PROFILES.largeModel,
 *     triangleColorMode: "flat"
 *   },
 *   memoryConfigs: {
 *     maxBatchVertices: 75000,
 *     maxBatchIndices: 225000,
 *     maxBatchGeometries: 2048,
 *     maxBatchMeshes: 2048,
 *     maxBatchPrims: 75000,
 *     maxBatchBuildSegments: 2,
 *     frustumCulling: true,
 *     minProjectedCanvasSize: 5
 *   },
 *   updateModePolicies: {
 *     dynamic: {
 *       memoryPolicy: "stream",
 *       memoryConfigs: {
 *         compactStreamPages: false
 *       }
 *     }
 *   }
 * });
 *
 * const modelResult = scene.createModel({
 *   id: "interactiveModel",
 *   updateMode: "dynamic",
 *   loadingMode: "streaming"
 * });
 * ```
 *
 * `updateModePolicies` only affects WebGPU memory policy and memory configs per
 * update-mode bucket. Render-pass choices such as triangle color mode, depth
 * prepass, edges, render bundles and transparent sorting remain renderer-level
 * `renderConfigs`.
 */
export interface WebGPUUpdateModePolicies {
  /**
   * Fallback policy for models with `updateMode: "auto"` or no matching policy.
   */
  default?: WebGPUUpdateModePolicy;

  /**
   * Policy for `SceneModel` instances with `updateMode: "static"`.
   */
  static?: WebGPUUpdateModePolicy;

  /**
   * Policy for `SceneModel` instances with `updateMode: "dynamic"`.
   */
  dynamic?: WebGPUUpdateModePolicy;
}

/**
 * Built-in WebGPU policies for renderer-neutral SceneModel update modes.
 */
export const WEBGPU_UPDATE_MODE_POLICIES: Required<WebGPUUpdateModePolicies> = {
  default: {},
  static: {
    memoryPolicy: "compact",
    memoryConfigs: {
      compactSealedStreamPages: true
    }
  },
  dynamic: {
    memoryPolicy: "stream",
    memoryConfigs: {
      compactSealedStreamPages: true
    }
  }
};

/**
 * Resolves the WebGPU model policy ID for a SceneModel.
 */
export function getWebGPUUpdateModePolicyId(sceneModel?: SceneModel | null): keyof WebGPUUpdateModePolicies {
  if (!sceneModel || sceneModel.updateMode === "auto") {
    return "default";
  }
  return sceneModel.updateMode;
}

/**
 * Resolves the effective WebGPU memory policy for a SceneModel.
 */
export function resolveWebGPUUpdateModeMemoryPolicy(
  updateModePolicies: WebGPUUpdateModePolicies,
  sceneModel?: SceneModel | null
): WebGPUModelMemoryPolicy {
  const policyId = getWebGPUUpdateModePolicyId(sceneModel);
  const defaultPolicy = WEBGPU_UPDATE_MODE_POLICIES[policyId] ?? WEBGPU_UPDATE_MODE_POLICIES.default;
  const userPolicy = updateModePolicies[policyId] ?? updateModePolicies.default ?? {};
  if (userPolicy.memoryPolicy) {
    return userPolicy.memoryPolicy;
  }
  if (sceneModel?.updateMode === "static" && !sceneModel.sealed) {
    return "stream";
  }
  return defaultPolicy.memoryPolicy ?? "stream";
}

/**
 * Resolves the effective WebGPU memory config for a SceneModel.
 */
export function resolveWebGPUUpdateModeMemoryConfigs(
  rendererDefaults: MemoryConfigs,
  updateModePolicies: WebGPUUpdateModePolicies,
  sceneModel?: SceneModel | null,
  rendererOverrides?: Partial<MemoryConfigs>
): MemoryConfigs {
  const policyId = getWebGPUUpdateModePolicyId(sceneModel);
  const defaultPolicy = WEBGPU_UPDATE_MODE_POLICIES[policyId] ?? WEBGPU_UPDATE_MODE_POLICIES.default;
  const userPolicy = updateModePolicies[policyId] ?? updateModePolicies.default ?? {};
  return {
    ...rendererDefaults,
    ...(defaultPolicy.memoryConfigs ?? {}),
    ...(rendererOverrides ?? {}),
    ...(userPolicy.memoryConfigs ?? {})
  };
}
