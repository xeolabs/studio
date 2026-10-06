/**
 * Binary and ASCII STL import/export.
 *
 * ```ts
 * await new STLLoader().load({fileData: arrayBuffer, sceneModel});
 * const binary = await new STLExporter().write({sceneModel});
 * const ascii = await new STLExporter().write({sceneModel, version: "ascii"});
 * ```
 *
 * Both exports return ArrayBuffers. Import accepts ASCII strings as well.
 * Exports bake mesh and parent transforms in model coordinates, or in the requested
 * export coordinate system. STL has no units; callers must agree on them. Supply
 * load option `coordinateSystem` to interpret source units/basis explicitly;
 * otherwise vertex coordinates are taken in the target model's coordinate system.
 * Triangle winding determines face normals. Appearance, object identity and animation
 * are not representable. Non-triangle meshes are skipped with a warning.
 *
 * @module stl
 */
export {STLLoader} from "./STLLoader";
export {STLExporter} from "./STLExporter";
