import type {TriangleGeometryVBOBuffers} from "./TriangleGeometryVBOBuffers";
import {
  TRIANGLE_GEOMETRY_VBO_PASS_ORDER,
  TRIANGLE_GEOMETRY_VBO_PICK_REGION_INDEX,
  type TriangleGeometryVBOMeshRecord,
  type TriangleGeometryVBOViewState
} from "./TriangleGeometryVBOState";
import type {TriangleGeometryVBOTileDrawState} from "../TriangleGeometryVBOBatch";

/**
 * Packs visible indices by pass and RTC tile. The picking pass reuses those
 * same indices, and feature-edge storage is only populated after first use.
 * Membership changes invalidate a view; camera changes reuse its draw ranges.
 * Vertex slots remain stable so colors, transforms and geometry can be edited
 * independently of this compact index list.
 * @internal
 */
export class TriangleGeometryVBODrawList {
  constructor(private readonly _buffers: TriangleGeometryVBOBuffers, private readonly _verticesPerPrim: number) {}

  rebuildViewIndices(view: TriangleGeometryVBOViewState, viewIndex: number,
                     records: ReadonlyMap<number, TriangleGeometryVBOMeshRecord>): void {
    const groups = TRIANGLE_GEOMETRY_VBO_PASS_ORDER.map(() => new Map<number, TriangleGeometryVBOMeshRecord[]>());
    for (const record of records.values()) {
      const state = record.meshViewStates[viewIndex];
      if (!state?.visible) continue;
      const passIndex = TRIANGLE_GEOMETRY_VBO_PASS_ORDER.indexOf(state.renderPass);
      if (passIndex < 0) continue;
      const tiles = groups[passIndex];
      let tile = tiles.get(record.tileIndex);
      if (!tile) tiles.set(record.tileIndex, tile = []);
      tile.push(record);
    }
    view.tileDrawStates.clear();
    // Geometry/placement writes also dirty the indices. Drop shadow metadata
    // here, but rebuild it only if this view actually renders shadows again.
    view.shadowRanges = null;
    this._pack(view, groups, false);
    if (view.edgesEnabled) this._pack(view, groups, true);
    view.indicesDirty = false;
  }

  private _pack(view: TriangleGeometryVBOViewState,
                groups: Map<number, TriangleGeometryVBOMeshRecord[]>[], edges: boolean): void {
    const count = edges ? view.pickEdgePrimCount * 2 : view.pickPrimCount * this._verticesPerPrim;
    const previous = edges ? view.edgeIndices : view.indices;
    // Keep modest growth room during streaming, and release large obsolete
    // allocations after an unload. No capacity is reserved for inactive passes.
    const data = previous && previous.length >= count && previous.length <= Math.max(256, count * 2)
      ? previous
      : new Uint32Array(count);
    if (edges) view.edgeIndices = data; else view.indices = data;
    const ranges = edges ? view.edgeIndexRanges : view.indexRanges;
    const pickTiles = new Map<number, TriangleGeometryVBOTileDrawState>();
    let cursor = 0;
    for (let passIndex = 0; passIndex < groups.length; passIndex++) {
      const start = cursor;
      const states: TriangleGeometryVBOTileDrawState[] = [];
      for (const [tileIndex, records] of groups[passIndex]) {
        const tileStart = cursor;
        for (const record of records) {
          if (edges) {
            data.set(record.edgeVertexIndices, cursor);
            cursor += record.edgeVertexIndices.length;
          } else {
            const indices = record.sceneMesh.geometry.indices;
            const indexCount = record.primitiveCount * this._verticesPerPrim;
            for (let i = 0; i < indexCount; i++) {
              data[cursor++] = record.vertexBase + (this._verticesPerPrim === 1 ? i : indices![i]);
            }
          }
        }
        if (cursor === tileStart) continue;
        const span = {firstIndex: tileStart, indexCount: cursor - tileStart,
          primCount: (cursor - tileStart) / (edges ? 2 : this._verticesPerPrim)};
        states.push({tileIndex, spans: [span]});
        let pickTile = pickTiles.get(tileIndex);
        if (!pickTile) pickTiles.set(tileIndex, pickTile = {tileIndex, spans: []});
        pickTile.spans.push(span);
      }
      const range = ranges.get(TRIANGLE_GEOMETRY_VBO_PASS_ORDER[passIndex])!;
      range.firstIndex = start;
      range.indexCount = cursor - start;
      view.tileDrawStates.set(passIndex * 2 + (edges ? 1 : 0), states);
    }
    const pickRange = edges ? view.pickEdgeIndexRange : view.pickIndexRange;
    pickRange.firstIndex = 0;
    pickRange.indexCount = cursor;
    view.tileDrawStates.set(TRIANGLE_GEOMETRY_VBO_PICK_REGION_INDEX * 2 + (edges ? 1 : 0), Array.from(pickTiles.values()));
    if (edges) {
      view.edgeIndexCount = cursor;
      view.edgeIndexDirtySpans.length = 0;
      this._buffers.markEdgeIndexRangeDirty(view, 0, cursor);
    } else {
      view.indexCount = cursor;
      view.indexDirtySpans.length = 0;
      this._buffers.markIndexRangeDirty(view, 0, cursor);
    }
  }

  addRecordViewIndices(view: TriangleGeometryVBOViewState, viewIndex: number,
                       record: TriangleGeometryVBOMeshRecord, refreshRanges = true): void {
    this._count(view, viewIndex, record, 1);
    view.indicesDirty = true;
    if (refreshRanges) this.refreshViewRanges(view);
  }

  removeRecordViewIndices(view: TriangleGeometryVBOViewState, viewIndex: number,
                          record: TriangleGeometryVBOMeshRecord): void {
    this._count(view, viewIndex, record, -1);
    view.indicesDirty = true;
  }

  setRecordRenderPass(view: TriangleGeometryVBOViewState, viewIndex: number,
                      record: TriangleGeometryVBOMeshRecord, renderPass: number): void {
    this._count(view, viewIndex, record, -1);
    record.meshViewStates[viewIndex].renderPass = renderPass;
    this._count(view, viewIndex, record, 1);
    view.indicesDirty = true;
    this.refreshViewRanges(view);
  }

  setRecordVisible(view: TriangleGeometryVBOViewState, viewIndex: number,
                   record: TriangleGeometryVBOMeshRecord, visible: boolean): void {
    this._count(view, viewIndex, record, -1);
    record.meshViewStates[viewIndex].visible = visible;
    this._count(view, viewIndex, record, 1);
    view.indicesDirty = true;
    this.refreshViewRanges(view);
  }

  refreshViewRanges(view: TriangleGeometryVBOViewState): void {
    for (let i = 0; i < TRIANGLE_GEOMETRY_VBO_PASS_ORDER.length; i++) {
      const pass = TRIANGLE_GEOMETRY_VBO_PASS_ORDER[i];
      view.passRanges.get(pass)!.numPrims = view.passPrimCounts[i];
      view.edgePassRanges.get(pass)!.numPrims = view.edgePassPrimCounts[i];
    }
    view.pickRange.numPrims = view.pickPrimCount;
    view.pickEdgeRange.numPrims = view.pickEdgePrimCount;
  }

  private _count(view: TriangleGeometryVBOViewState, viewIndex: number,
                 record: TriangleGeometryVBOMeshRecord, sign: number): void {
    const state = record.meshViewStates[viewIndex];
    if (!state?.visible) return;
    const region = TRIANGLE_GEOMETRY_VBO_PASS_ORDER.indexOf(state.renderPass);
    if (region < 0) return;
    const edges = record.edgeVertexIndices.length / 2;
    view.pickPrimCount += sign * record.primitiveCount;
    view.pickEdgePrimCount += sign * edges;
    view.passPrimCounts[region] += sign * record.primitiveCount;
    view.edgePassPrimCounts[region] += sign * edges;
  }
}
