import type {SceneModel} from "../../../model/scene";
import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {Fix, FixApplyResult} from "../Fix";
import {getInspectionIndex} from "../internal/getInspectionIndex";
import {remapGeometryVertices} from "../internal/remapGeometryVertices";
import type {Issue} from "../Issue";

/**
 * Drops vertex slots unreferenced by either primitive or edge indices, keeping
 * all base/deformation attributes aligned. Leaves the quantization AABB intact
 * so surviving positions do not change. Non-indexed geometry is left alone.
 */
export const compactUnusedVertices: Fix = {
  codes: ["GEOMETRY_UNUSED_VERTICES"],
  description: "Compact unused vertex slots",
  procedure: [
    "Mark each vertex slot referenced by any triangle or edge",
    "Build a map from old slot to new (compacted) slot",
    "Compact every vertex attribute, including UV channels and deformation data",
    "Re-route the triangle and edge lists and publish one complete update",
  ],
  config: {
    enabled: {
      kind: "boolean",
      key: "enableCompactUnusedVertices",
      label: "Compact unused vertex slots",
      default: true,
    },
  },

  apply(issue: Issue, sceneModel: SceneModel): SDKResult<FixApplyResult> {
    const geomId = issue.resourceId;
    if (!geomId) {
      return {ok: false, type: SDKErrorType.InvalidOperation, error: "[compactUnusedVertices] issue has no resourceId (geometry id)"};
    }
    const geom = sceneModel.geometries[geomId];
    if (!geom || geom.destroyed) return {ok: true, value: {fixed: false, reason: "target-missing"}};
    if (!geom.indices?.length) return {ok: true, value: {fixed: false, reason: "precondition-failed"}};
    const vertCount = geom.positionsCompressed.length / 3;
    const used = getInspectionIndex(sceneModel).vertexUsageMask(geomId);
    const kept: number[] = [];
    const remap = new Int32Array(vertCount).fill(-1);
    for (let v = 0; v < vertCount; v++) {
      if (!used[v]) continue;
      remap[v] = kept.length;
      kept.push(v);
    }
    if (kept.length === vertCount) return {ok: true, value: {fixed: false, reason: "no-op"}};
    if (!kept.length || !remapGeometryVertices(geom, kept, remap)) {
      return {ok: true, value: {fixed: false, reason: "precondition-failed"}};
    }
    return {ok: true, value: {fixed: true, trace: `'${geomId}': compacted ${(vertCount - kept.length).toLocaleString()} unused of ${vertCount.toLocaleString()} vertex slots`}};
  },
};
