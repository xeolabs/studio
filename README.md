# xeokit Studio

A standalone Vue 3 and TypeScript workspace for viewing, inspecting, importing,
and exporting 3D models with the unreleased xeokit v3 SDK. It includes Pinia,
Element Plus, Dockview, the Scene/Data/Viewer/IFC explorers, diagnostics, and
Sun Study. The bundled Duplex model opens at startup.

## Run

Use Node.js 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Studio tries WebGPU first and falls back to
WebGL when it is unavailable. Append `?renderer=webgl` to choose WebGL explicitly.

```sh
npm test              # Studio regression tests
npm run typecheck     # TypeScript checks
npm run build         # Production site in dist/
npm run preview       # Serve the production build locally
```

Deploy the contents of `dist/` to a static HTTP server. Relative asset URLs allow
hosting under a subdirectory. Serve over HTTPS outside localhost for WebGPU.

## Source layout

```text
src/main.ts                 Application entrypoint
src/studio/                 Vue components, state, explorers, services and styles
src/studio/sunStudy/         Sun Study presentation controller
public/models/Duplex/       Default geometry, metadata and coordinate system
vendor/xeokit-sdk/src/      Unreleased xeokit v3 TypeScript source
tests/                      Studio regression suite
```

The application comes from `sdk-oct2/packages/website/examples/apps/studio`.
Its Vue component factories and inline templates are preserved. Vite uses Vue's
compiler-enabled build to compile those templates; see the
[Vue tooling documentation](https://vuejs.org/guide/scaling-up/tooling.html#note-on-in-browser-template-compilation).
Vue, UI styles, and icons are installed through npm and bundled locally.

The SDK is a local file dependency. Vite and TypeScript resolve `@xeokit/sdk/*`
directly to `vendor/xeokit-sdk/src`, so no published SDK or sibling checkout is
required. Snapshot details are in
[vendor/xeokit-sdk/PROVENANCE.md](vendor/xeokit-sdk/PROVENANCE.md).
To update it, copy the upstream SDK source into that directory, update the
snapshot metadata and dependencies, and rerun the checks above. Keep generated
CLI bundles, SDK tests, and source maps out of the snapshot. When v3 is released,
replace the file dependency and remove the source aliases in `vite.config.ts`
and `tsconfig.json`.

The default model and application UI are served locally. Some optional SDK
importers still fetch upstream decoder assets (including IFC and USDZ WASM)
from their configured CDNs; those imports require network access. URL imports
also depend on the remote server allowing browser access.

The upstream license is preserved in [LICENSE.md](LICENSE.md).
