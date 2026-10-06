import type {ModelExporter} from "@xeokit/sdk/formats";
import {TrianglesPrimitive, SolidPrimitive, SurfacePrimitive, LinesPrimitive, PointsPrimitive, GaussianSplatsPrimitive} from "@xeokit/sdk/base/constants";

export interface ExportFormatDefinition {
  id: string;
  label: string;
  group: string;
  extension: string;
  mime: string;
  description: string;
  nativeData?: boolean;
  primitives?: readonly number[];
  /** These encoders interpret every mesh as triangles instead of skipping unsupported primitives. */
  rejectMixedPrimitives?: boolean;
  preservesAnimation?: boolean;
  animationNotice?: string;
  preservesMorphTargets?: boolean;
  preservesVertexStates?: boolean;
  preservesTextures?: boolean;
  package?: "obj-mtl" | "xgf-stream";
  notices?: readonly string[];
  load(): Promise<ModelExporter>;
}

const triangles = [TrianglesPrimitive, SolidPrimitive, SurfacePrimitive];
const conventional = [...triangles, LinesPrimitive, PointsPrimitive];

/** Browser export capabilities, not the import-format catalog. No encoder is imported until requested. */
export const EXPORT_FORMATS: readonly ExportFormatDefinition[] = [
  {
    id: "xgf", label: "XGF", group: "xeokit", extension: "xgf", mime: "application/octet-stream",
    description: "xeokit geometry, materials and animation.", preservesAnimation: true, preservesMorphTargets: true, preservesVertexStates: true, preservesTextures: true,
    load: async () => new (await import("@xeokit/sdk/formats/xgf")).XGFExporter()
  },
  {
    id: "glb", label: "GLB", group: "3D interchange", extension: "glb", mime: "model/gltf-binary",
    description: "Binary glTF with embedded assets.", primitives: conventional, rejectMixedPrimitives: true, preservesMorphTargets: true, preservesTextures: true,
    load: async () => new (await import("@xeokit/sdk/formats/gltf")).GLTFExporter()
  },
  {
    id: "scene-json", label: "Scene JSON", group: "xeokit", extension: "scenemodel.json", mime: "application/json",
    description: "xeokit SceneModel JSON.", preservesAnimation: true, preservesMorphTargets: true, preservesVertexStates: true, preservesTextures: true,
    load: async () => new (await import("@xeokit/sdk/formats/scenemodel")).SceneModelExporter()
  },
  {
    id: "fbx", label: "FBX", group: "3D interchange", extension: "fbx", mime: "application/octet-stream",
    description: "Binary FBX with mesh transforms and diffuse materials.", primitives: triangles, rejectMixedPrimitives: true,
    notices: ["Only diffuse texture maps are supported. Shear, negative scale and coordinate-system metadata are not preserved."],
    load: async () => new (await import("@xeokit/sdk/formats/fbx")).FBXExporter()
  },
  {
    id: "usdz", label: "USDZ", group: "3D interchange", extension: "usdz", mime: "model/vnd.usdz+zip",
    description: "USD package with mesh geometry and color-based materials.", primitives: triangles, rejectMixedPrimitives: true,
    notices: ["The current encoder writes mesh-local transforms, not the full parent-transform hierarchy."],
    load: async () => new (await import("@xeokit/sdk/formats/usdz")).USDZExporter()
  },
  {
    id: "collada", label: "COLLADA (DAE)", group: "3D interchange", extension: "dae", mime: "model/vnd.collada+xml",
    description: "COLLADA triangle geometry and flat materials.", primitives: [TrianglesPrimitive],
    notices: ["Normals and UVs are omitted. Output declares Z-up meters; source coordinate systems are not converted."],
    load: async () => new (await import("@xeokit/sdk/formats/collada")).ColladaExporter()
  },
  {
    id: "obj", label: "OBJ + MTL", group: "3D interchange", extension: "obj", mime: "model/obj", package: "obj-mtl",
    description: "OBJ geometry with a linked MTL material file.", primitives: triangles, rejectMixedPrimitives: true,
    notices: ["The current OBJ encoder omits normals and UVs. MTL texture paths are references only; texture images are not downloaded."],
    load: async () => new (await import("@xeokit/sdk/formats/obj")).OBJExporter()
  },
  {
    id: "ply", label: "PLY", group: "3D interchange", extension: "ply", mime: "application/octet-stream",
    description: "ASCII triangle and point geometry with vertex attributes.", primitives: [TrianglesPrimitive, PointsPrimitive],
    notices: ["Object identities and material assignments are flattened into vertices and faces."],
    load: async () => new (await import("@xeokit/sdk/formats/ply")).PLYExporter()
  },
  {
    id: "threedxml", label: "3DXML", group: "3D interchange", extension: "3dxml", mime: "application/octet-stream",
    description: "Packaged triangle parts, transforms and flat colors.", primitives: triangles,
    load: async () => new (await import("@xeokit/sdk/formats/threedxml")).ThreeDXMLExporter()
  },
  {
    id: "ifc", label: "IFC", group: "BIM and geospatial", extension: "ifc", mime: "application/x-step", nativeData: true,
    description: "IFC4 geometry and supported IFC properties and relationships.", primitives: triangles, rejectMixedPrimitives: true,
    notices: ["Without an IfcProject, the encoder generates a default IFC structure. This is a reconstructed IFC, not a lossless source-file round trip."],
    load: async () => new (await import("@xeokit/sdk/formats/ifc")).IFCExporter()
  },
  {
    id: "dotbim", label: ".bim", group: "BIM and geospatial", extension: "bim", mime: "application/json", nativeData: true,
    description: "Triangle elements, colors and supported object information.", primitives: triangles, rejectMixedPrimitives: true,
    notices: ["Per-object material detail and mesh transforms are limited to the first mesh; scale and shear are not preserved."],
    load: async () => new (await import("@xeokit/sdk/formats/dotbim")).DotBIMExporter()
  },
  {
    id: "cityjson", label: "CityJSON", group: "BIM and geospatial", extension: "city.json", mime: "application/json", nativeData: true,
    description: "City objects, surface geometry and supported semantic links.", primitives: triangles, rejectMixedPrimitives: true,
    notices: ["Source coordinates are not reprojected. Geometry is quantized at a 0.001-unit grid. Semantic types must already be CityJSON-compatible; IFC types are not translated."],
    load: async () => new (await import("@xeokit/sdk/formats/cityjson")).CityJSONExporter()
  },
  {
    id: "geojson", label: "GeoJSON", group: "BIM and geospatial", extension: "geojson", mime: "application/geo+json", nativeData: true,
    description: "Features with points, lines, triangle surfaces and object properties.", primitives: conventional,
    notices: ["Coordinates are not reprojected to longitude/latitude. Triangle faces become separate polygon parts."],
    load: async () => new (await import("@xeokit/sdk/formats/geojson")).GeoJSONExporter()
  },
  {
    id: "dxf", label: "DXF", group: "CAD and drawings", extension: "dxf", mime: "application/dxf",
    description: "ASCII DXF with 3DFACE, LINE and POINT entities.", primitives: conventional,
    notices: ["Transforms are baked. Material assignments, UVs, line widths and dash patterns are not preserved."],
    load: async () => new (await import("@xeokit/sdk/formats/dxf")).DXFExporter()
  },
  {
    id: "svg", label: "SVG (XY projection)", group: "CAD and drawings", extension: "svg", mime: "image/svg+xml",
    description: "A 2D drawing projected onto the XY plane.", primitives: conventional,
    notices: ["Z depth is discarded; this is a drawing, not a 3D model."],
    load: async () => new (await import("@xeokit/sdk/formats/svg")).SVGExporter()
  },
  {
    id: "e57", label: "E57", group: "Points and splats", extension: "e57", mime: "application/octet-stream",
    description: "Point geometry and RGB as a single E57 scan.", primitives: [PointsPrimitive],
    notices: ["Intensity, scan poses and multiple scans are not exported."],
    load: async () => new (await import("@xeokit/sdk/formats/e57")).E57Exporter()
  },
  {
    id: "splat", label: "Gaussian Splat", group: "Points and splats", extension: "splat", mime: "application/octet-stream",
    description: "Stored Gaussian splats with baked RGB.", primitives: [GaussianSplatsPrimitive],
    notices: ["Spherical harmonics, object identities, mesh instances and mesh transforms are not preserved."],
    load: async () => new (await import("@xeokit/sdk/formats/gaussiansplat")).GaussianSplatExporter()
  },
  {
    id: "xgfstream", label: "XGF Stream (ZIP)", group: "xeokit", extension: "xgfstream.zip", mime: "application/zip", package: "xgf-stream",
    description: "A ZIP containing the stream index, manifests and XGF chunks.", preservesTextures: true, preservesMorphTargets: true, preservesVertexStates: true,
    animationNotice: "Animation channels spanning chunks may not survive stream partitioning. Use XGF for animation interchange.",
    notices: ["Extract the ZIP before serving the stream; preserve the index and chunk paths."],
    load: async () => new (await import("@xeokit/sdk/formats/xgfstream")).XGFStreamExporter()
  },
  {
    id: "xkt", label: "XKT v12", group: "xeokit", extension: "xkt", mime: "application/octet-stream", nativeData: true,
    description: "Legacy xeokit v2 geometry and supported metadata.", primitives: conventional,
    load: async () => new (await import("@xeokit/sdk/formats/legacy/xkt")).XKTExporter()
  }
];

export function getExportFormat(id: string): ExportFormatDefinition {
  const format = EXPORT_FORMATS.find(format => format.id === id);
  if (!format) throw new Error(`Unsupported output format: ${id}`);
  return format;
}
