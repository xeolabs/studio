import type {SceneModel} from "../../../model/scene";
import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {Fix, FixApplyResult} from "../Fix";
import {getInspectionIndex} from "../internal/getInspectionIndex";
import {remapGeometryVertices} from "../internal/remapGeometryVertices";
import type {Issue} from "../Issue";

/**
 * Coalesces indexed vertices whose populated attributes all match, including
 * every UV channel, complete vertex state and morph delta. Normal/UV seams and
 * vertices that move differently remain separate. Both triangle and edge
 * indices are remapped, with a single full-buffer update after compaction.
 * Returns a no-op when all vertices are unique. Non-indexed geometry is left
 * alone because removing slots would change primitive order or multiplicity.
 */
export const mergeDuplicateVertices: Fix = {
  codes: ["GEOMETRY_DUPLICATE_VERTICES"],
  description: "Coalesce duplicate vertices",
  procedure: [
    "Compare all vertex attributes, including UV channels and deformation data",
    "Map each duplicate slot onto its first matching slot",
    "Compact all vertex arrays and remap triangle and edge indices",
    "Publish the complete geometry update and rebuild rendering buffers",
  ],
  config: {
    enabled: {
      kind: "boolean",
      key: "enableMergeDuplicateVertices",
      label: "Coalesce duplicate vertices",
      default: true,
    },
  },

  apply(issue: Issue, sceneModel: SceneModel): SDKResult<FixApplyResult> {
    const geomId = issue.resourceId;
    if (!geomId) {
      return {ok: false, type: SDKErrorType.InvalidOperation, error: "[mergeDuplicateVertices] issue has no resourceId (geometry id)"};
    }
    const geom = sceneModel.geometries[geomId];
    if (!geom || geom.destroyed) return {ok: true, value: {fixed: false, reason: "target-missing"}};
    if (!geom.indices?.length) return {ok: true, value: {fixed: false, reason: "precondition-failed"}};
    const vertCount = geom.positionsCompressed.length / 3;
    const slots = getInspectionIndex(sceneModel).canonicalSlots(geomId);
    if (!slots) return {ok: true, value: {fixed: false, reason: "precondition-failed"}};
    const {canonical, uniqueCount: unique} = slots;
    if (unique === vertCount) return {ok: true, value: {fixed: false, reason: "no-op"}};

    const kept: number[] = [];
    const remap = new Int32Array(vertCount);
    for (let v = 0; v < vertCount; v++) {
      if (canonical[v] === v) {
        remap[v] = kept.length;
        kept.push(v);
      } else {
        remap[v] = remap[canonical[v]];
      }
    }
    if (!remapGeometryVertices(geom, kept, remap)) {
      return {ok: true, value: {fixed: false, reason: "precondition-failed"}};
    }
    return {ok: true, value: {fixed: true, trace: `'${geomId}': merged ${(vertCount - unique).toLocaleString()} duplicate of ${vertCount.toLocaleString()} vertex slots`}};
  },
};
