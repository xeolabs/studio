/**
 * Managed buffer/texture storage for a WebGLRenderer. Values use MiB (2^20
 * bytes), retaining the existing MB field names. Excludes driver overhead,
 * render targets and other resources outside the GPU memory manager.
 */
export interface MemoryUsage {

  /**
   * GPU storage requested by the memory manager, including data-texture row padding.
   */
  allocatedMB: number;

  /**
   * Active logical records in the managed GPU storage.
   */
  usedMB: number;

  /**
   * CPU arrays backing managed data textures, in MiB. Excludes Scene/Viewer
   * objects, VBO CPU buffers and material images; this is not total JS heap use.
   */
  cpuDataTextureMB?: number;
}
