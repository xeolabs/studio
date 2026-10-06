# xeokit v3 source snapshot

Copied on 2026-10-06 from `sdk-oct2/packages/sdk/src` at base commit
`e6dba6b957bad56d5a415bf9bb80bff0fef18314`. This snapshot includes the source checkout's working-tree changes.
The upstream package currently labels itself `0.1.0-alpha`; it is the unreleased
v3 source, not a published v3 package.

SDK tests, generated CLI bundles and source maps are omitted. The package
manifest points to TypeScript source. Vite and TypeScript resolve `@xeokit/sdk/*`
directly to this directory's `src/`. See the root README for update instructions.

The upstream license is preserved in `LICENSE.md`.

Local compatibility fix: `viewing/viewer/MaterialPresets.ts` initializes
`HATCH_PX_TO_WORLD` before constructing presets. The original ordering throws
a temporal-dead-zone error when Vite serves native ES modules. Preserve this
fix when refreshing the snapshot unless it has landed upstream.
