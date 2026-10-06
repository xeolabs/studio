/**
 * Options for authoring one projected-size variant set inside each
 * references-only stream chunk.
 */
export interface XGFStreamChunkVariantSetOptions {
  /** Enables per-chunk variant-set creation. */
  enabled?: boolean;

  /** Variant-set ID prefix. Defaults to `"chunk-lod"`. */
  idPrefix?: string;

  /** Default/all-objects variant ID. Defaults to `"all"`. */
  allVariantId?: string;

  /** Middle-detail variant ID. Defaults to `"regular"`. */
  regularVariantId?: string;

  /** Reduced variant ID. Defaults to `"dominant"`. */
  dominantVariantId?: string;

  /** Minimum dominant objects per chunk. Defaults to `1`. */
  minObjects?: number;

  /** Maximum dominant objects per chunk. Overrides `maxObjectRatio` when supplied. */
  maxObjects?: number;

  /** Maximum dominant object fraction per chunk. Defaults to `0.25`. */
  maxObjectRatio?: number;

  /** Dominance score coverage target. Defaults to `0.72`. */
  coverageRatio?: number;

  /** Minimum projected size for the all-objects variant. Defaults to `260`. */
  allMinPixels?: number;

  /** Minimum projected size for the middle-detail variant. Defaults to `220`. */
  regularMinPixels?: number;

  /** Maximum projected size for the middle-detail variant. Defaults to `260`. */
  regularMaxPixels?: number;

  /** Maximum projected size for the dominant variant. Defaults to `220`. */
  dominantMaxPixels?: number;

  /** Projected-size hysteresis in pixels. Defaults to `16`. */
  hysteresisPixels?: number;

  /**
   * Optional explicit reduced-variant object IDs.
   *
   * When supplied, each chunk's reduced variant contains the IDs from
   * this set that are already present in that chunk. When omitted, the exporter
   * falls back to visual-dominance ranking over the chunk's objects.
   */
  dominantObjectIds?: readonly string[];

  /** Optional explicit middle-detail variant object IDs. */
  regularObjectIds?: readonly string[];
}
