# Baku Stadium XGF stream

Copied from `sdk-oct2/packages/website/models/BakuStadium_xgfstream_4000`
on 2026-10-09, without changing the source chunk files or indexes.

This is the dataset used by the SDK's
`examples/benchmarks/streaming/xgf-baku-4000-static` example. Studio reads the
compact `xgfstream/index.runtime.json` and resolves each chunk and shared asset
library relative to that index. The full index is retained for inspection.

The dataset contains 4,020 XGF files, including shared asset libraries. "4k"
is the dataset's name; the geometry chunk count comes from the runtime index.
The model uses meters and a Z-up coordinate system. It contains geometry;
IFC property sets and a building hierarchy are not included in this stream.

The bundled files retain the same provenance as the SDK example dataset;
copying them into Studio does not assign them a separate code license.
