# xeokit Studio

xeokit Studio is a workspace for exploring 3D models and the information they
contain. It brings visualization, inspection, and model exchange together to
help users understand geometry, relationships, and properties.

The Models list in Explore, Floors, or Categories has Hide/Show, Fit, and Unload
controls. Unload asks for confirmation before removing a model’s geometry and
metadata from the session; source files are unchanged. Imports use readable filenames. If incoming elements conflict
with a loaded model, Studio validates the import and offers Replace existing or
Cancel before changing the current models.

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

The workspace adapts to phones, tablets, and desktops. Explore provides Building,
Floors, and Categories views with search. Explore and Floors are available in the
model toolbar at every size. Tap a tree row to activate it and reveal its subtree
actions; visibility changes only when requested. On portrait phones, tools open in
a bottom panel with collapsed, half-height, and expanded states. Tablets and
short landscape screens use a side panel. The canvas resizes around the panel
and stays interactive. Wide screens use the saved docking layout; the current
tool follows when the window is resized.

Section opens horizontal and vertical cuts with a position slider, Flip, and Clear.
Use Plan in a floor's subtree actions, or choose a floor in the Section panel, to
view that floor from above with orthographic pan and zoom. The plan cut starts
1.2 m above the floor surface inferred from slabs or wall bases, and its height
can be adjusted in metres. Outlines improves edge contrast and plan sharpness.
The Labels menu offers Off, Sparse, Balanced, and Dense. Sparse is the default
density; more labels fit as you zoom in or choose a denser setting, without a fixed
count limit. Labels prioritize selected elements and rooms with located contents,
then stairs, furniture, doors, and windows. Tiny, offscreen, clipped, or overlapping
labels stay hidden. Labels settle after navigation and avoid camera controls and
open flyouts. A slim
plan toolbar provides the floor picker, Labels, Outlines, and 3D view. Return to 3D restores
the previous camera, visibility, isolation session, visual settings, and section cuts, even after
switching floors. Floor plans use the model geometry and IFC spatial relationships.

The main toolbar is a compact rail on wide screens and a bottom bar on phones.
Select opens interaction modes: Select to inspect, Hide to remove tapped elements
from view, and X-ray to toggle their transparency. Done or Escape returns to Select.
Fit stays beside the model; its camera menu provides zoom, pan, Home, and full screen.
More provides Saved views, import, export, Show all, Clear effects, and Sun study.

Saved views (also in the View menu) stores named thumbnails with the camera,
floor plan and cut height, section cuts, hidden elements, X-ray/highlight effects,
isolation, and plan label settings. Tap a thumbnail to reopen a view; rename or
delete it using the adjacent buttons. Undo delete restores the last deleted view.
Views are kept in this browser across reloads and appear when the same model set
is loaded, matched by source names, element IDs, bounds, and coordinates. Imported
models must be reloaded before opening their views. A recalled floor plan returns
to the 3D context from which it was opened. Measurements remain session-only and
are not stored with a saved view.

Measure places a distance between two surface points. In a floor plan it measures
horizontal distance; in 3D it measures the full distance. Click two points, or touch
and slide to refine each endpoint before releasing. Two fingers pan and zoom.
Snap finds nearby vertices and edges; the optional 3× lens magnifies the placement
area and marks the snapped point. Use m, mm, ft, or in for display units. Cancel
point discards an unfinished measurement; Done or Escape leaves the tool. The
measurement list locates and highlights a distance when you tap its row. Matching
numbers identify distances in the model and list; floor names identify plan distances.
Locating a plan distance opens its floor, while locating a 3D distance returns to 3D.
Use the separate trash button to delete a distance, or Clear all to remove them all;
Undo restores deleted distances, including after the list is emptied. Plan measurements
stay with their floor. Measurements last for the current session and are removed,
including from deletion history, when their source model is unloaded.

Selecting an element shows its name and type with Properties, Focus, and Effects.
Effects has Visible, X-ray, and Highlight toggles plus Isolate. Opening Properties
moves the same actions into its header. Undo and Redo appear after visibility,
isolation, X-ray, or highlight changes, including subtree and model visibility.
Use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or the Edit menu. History keeps the last 30
view changes; model loading/unloading and floor-plan transitions start a new
history. Camera navigation and selection do not add history entries.
Properties starts with the element name, type, floor, and
searchable property sets. Long values wrap, and SDK links, geometry bounds,
copy actions, and raw JSON are available under Advanced. Floor names come from
IFC spatial relationships; missing data is shown as not provided.
Isolate shows a named isolation indicator with Restore, which returns to the
visibility state before isolation. Repeated isolation keeps that original return
point. Show all reveals every element and exits isolation. Selection style in
Subtree Effects controls appearance, independently of the element being inspected.
Explorer searches, active rows and tree state, plus the inspector's tab and scroll
position, survive layout changes. Activity logs and detailed status start hidden;
open them, technical explorers or renderer settings from Advanced. Compact screens
collect the application menus under Menu. Dialogs keep their actions visible
while their contents scroll.

The upstream license is preserved in [LICENSE.md](LICENSE.md).
