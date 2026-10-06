# XGF3 scene representations

XGF3 preserves scene representation definitions, numerical resources and mesh bindings. Shader code and executable adapters are application-installed and are never serialized.

Use `XGFExporter.write({sceneModel, version: "3.0.0"})` and `XGFLoader.load({sceneModel, fileData: arrayBuffer})`. The ordinary export default remains XGF2. Exporting representation-bearing content to XGF1/2 fails explicitly; older loaders reject version 3 before creating source meshes.

## Envelope

The first 24 bytes contain six little-endian unsigned 32-bit words:

| Byte offset | Meaning |
| --- | --- |
| 0 | File version, `3` |
| 4 | UTF-8 JSON declaration length |
| 8 | Absolute offset of ordinary XGF2 payload, aligned to 8 bytes |
| 12 | Ordinary payload byte length |
| 16 | Absolute numerical resource section offset, aligned to 8 bytes |
| 20 | Numerical resource section byte length |

JSON starts at byte 24 and has declaration schema version `2`. It contains the authored coordinate system, representation definitions, mesh bindings (`{representationId, mode}` keyed by mesh ID) and numerical resource descriptors. Each binding declares `replace` or `augment`; the loader validates the declaration schema and ownership mode before publishing any source mesh. Resource byte offsets are relative to the numerical section and aligned to four bytes. Float32 and Uint32 values are little-endian; Uint8 values are unmodified. No image decoding or colour conversion is applied.

The embedded ordinary payload preserves mesh IDs even without animation, allowing bindings to resolve before mesh-created events. Loader `idPrefix` also prefixes representation IDs, resource IDs and their references. An explicit coordinate-system load option overrides the authored coordinate system.

Malformed section bounds, overlapping resource ranges and incompatible resource layouts fail validation. Unknown semantic representation types remain loadable and exportable. Register pure validators on `scene.representationSchemas` to additionally reject known-invalid parameters.

See the [black-hole tutorial](../../../../../../website/examples/simulation/black-hole-plugin/README.md) for an executable authoring/loading example.
