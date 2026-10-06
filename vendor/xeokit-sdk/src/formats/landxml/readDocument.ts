import {TrianglesPrimitive, PointsPrimitive, LinesPrimitive} from "../../base/constants";
import {yieldToHost} from "../../base/utils";

/** Parsed, validated source geometry. No Scene or Data mutation occurs here. @internal */
export interface LandXMLFeature {
  name: string;
  type: "Surface" | "CgPoint" | "PlanFeature";
  attributes: Record<string, string>;
  positions: number[];
  indices?: number[];
  primitive: number;
}

/** @internal */
export async function readDocument(input: string | Document, signal?: AbortSignal) {
  if (typeof input === "string" && /<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("[LandXMLLoader] DTDs and entities are not supported");
  if (typeof input === "string" && typeof DOMParser === "undefined") throw new Error("[LandXMLLoader] Install a DOMParser polyfill in Node, or pass an XML Document");
  const doc = typeof input === "string" ? new DOMParser().parseFromString(input, "application/xml") : input;
  const root = doc?.documentElement;
  if (!root || root.localName !== "LandXML" || doc.getElementsByTagName("parsererror").length) throw new Error("[LandXMLLoader] Invalid LandXML document");
  const version = root.getAttribute("version");
  if (!["1.0", "1.1", "1.2"].includes(version)) throw new Error(`[LandXMLLoader] Unsupported version '${version}'`);
  const units = child(child(root, "Units"), "Metric") || child(child(root, "Units"), "Imperial");
  const linearUnit = units?.getAttribute("linearUnit");
  if (!linearUnit) throw new Error("[LandXMLLoader] Units/linearUnit is required");
  const features: LandXMLFeature[] = [];
  const warnings = new Set<string>();
  const points = new Map<string, number[]>();
  const pointElements = descendants(root, "CgPoint");
  for (const point of pointElements) {
    const name = point.getAttribute("name");
    if (name && point.textContent.trim()) {
      if (points.has(name)) throw new Error(`[LandXMLLoader] Duplicate CgPoint '${name}'`);
      points.set(name, coordinates(point.textContent));
    }
  }
  const location = (element: Element | undefined): number[] => {
    if (!element) throw new Error("[LandXMLLoader] Missing line endpoint");
    const ref = element.getAttribute("pntRef");
    const value = ref ? points.get(ref) : coordinates(element.textContent);
    if (!value) throw new Error(`[LandXMLLoader] Missing point reference '${ref}'`);
    return value;
  };
  for (const surface of descendants(root, "Surface")) {
    await yieldToHost(signal);
    const definition = child(surface, "Definition");
    if (definition?.getAttribute("surfType") !== "TIN") {
      warnings.add("Non-TIN surface definitions were omitted.");
      continue;
    }
    const positions: number[] = [], indices: number[] = [];
    const ids = new Map<string, number>();
    for (const p of children(child(definition, "Pnts"), "P")) {
      if (ids.size % 4096 === 0) await yieldToHost(signal);
      const id = p.getAttribute("id");
      if (!id || ids.has(id)) throw new Error(`[LandXMLLoader] Missing or duplicate surface point ID '${id}'`);
      ids.set(id, positions.length / 3);
      positions.push(...coordinates(p.textContent));
    }
    for (const face of children(child(definition, "Faces"), "F")) {
      if (indices.length % 12288 === 0) await yieldToHost(signal);
      if (face.getAttribute("i") === "1") continue;
      const refs = face.textContent.trim().split(/\s+/);
      if (refs.length !== 3 || refs.some(id => !ids.has(id))) throw new Error("[LandXMLLoader] TIN face must reference three existing points");
      indices.push(...refs.map(id => ids.get(id)!));
    }
    if (!indices.length) throw new Error("[LandXMLLoader] TIN surface has no visible triangles");
    features.push(feature(surface, "Surface", positions, TrianglesPrimitive, indices));
    if (descendants(surface, "Breakline").length || descendants(surface, "Boundary").length) warnings.add("Surface breaklines/boundaries are not retained as design constraints; explicit TIN faces are used.");
  }
  for (const point of pointElements) {
    await yieldToHost(signal);
    features.push(feature(point, "CgPoint", location(point), PointsPrimitive));
  }
  for (const plan of descendants(root, "PlanFeature")) {
    const positions: number[] = [], indices: number[] = [];
    for (const segment of children(child(plan, "CoordGeom"))) {
      await yieldToHost(signal);
      if (segment.localName !== "Line") { warnings.add("Curved PlanFeature segments were omitted (not replaced by chords)."); continue; }
      const offset = positions.length / 3;
      positions.push(...location(child(segment, "Start")), ...location(child(segment, "End")));
      indices.push(offset, offset + 1);
    }
    if (indices.length) features.push(feature(plan, "PlanFeature", positions, LinesPrimitive, indices));
  }
  for (const name of ["Alignments", "Parcels", "PipeNetworks", "Survey"]) {
    if (descendants(root, name).length) warnings.add(`${name} civil design data is not supported by this terrain/survey subset.`);
  }
  if (!features.length) throw new Error("[LandXMLLoader] No supported surfaces, survey points or straight PlanFeatures");
  return {features, warnings: [...warnings], linearUnit, version, coordinateSystem: attributes(child(root, "CoordinateSystem"))};
}

function coordinates(text: string): number[] {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length < 2 || values.length > 3 || !values.every(Number.isFinite)) throw new Error("[LandXMLLoader] Expected finite northing easting [elevation]");
  return [values[1], values[0], values[2] ?? 0];
}
function feature(element: Element, type: LandXMLFeature["type"], positions: number[], primitive: number, indices?: number[]): LandXMLFeature {
  return {type, name: element.getAttribute("name") || type, attributes: attributes(element), positions, primitive, indices};
}
function attributes(element?: Element): Record<string, string> {
  return element ? Object.fromEntries(Array.from(element.attributes).map(a => [a.name, a.value])) : {};
}
function children(element?: Element, name?: string): Element[] {
  return element ? Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1 && (!name || (node as Element).localName === name)) : [];
}
function child(element: Element | undefined, name: string): Element | undefined { return children(element, name)[0]; }
function descendants(element: Element, name: string): Element[] { return Array.from(element.getElementsByTagNameNS("*", name)); }
