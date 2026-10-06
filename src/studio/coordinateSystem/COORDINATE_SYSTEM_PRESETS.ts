import type {CoordinateSystemPreset} from "./CoordinateSystemPreset";

/**
 * Common coordinate-system basis presets for importer and scene editing UI.
 *
 * The special `unknown` preset has `basis: null`, which means no explicit
 * override is applied and the current loader, sidecar file or existing Scene
 * setting decides.
 */
export const COORDINATE_SYSTEM_PRESETS: CoordinateSystemPreset[] = [
  {
    id: "unknown",
    label: "Unknown / auto",
    basis: null,
  },
  {
    id: "z-up",
    label: "Z-up (Revit, IFC, AutoCAD, ArchiCAD, SketchUp)",
    basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
  {
    id: "y-up",
    label: "Y-up (glTF, Three.js, Unity, Maya, Blender export)",
    basis: [1, 0, 0, 0, 0, 1, 0, 1, 0],
  },
  {
    id: "y-down",
    label: "Y-down (3D Gaussian Splatting, COLMAP, .splat)",
    basis: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  },
  {
    id: "z-up-y-forward",
    label: "Z-up, Y-forward (Blender native)",
    basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
  {
    id: "z-up-x-forward",
    label: "Z-up, X-forward (Rhino, Civil 3D)",
    basis: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  },
];
