import type {SceneTexture} from "./SceneTexture";
import type {SceneTextureUVTransform} from "./SceneTextureParams";
import type {SceneMaterialParams} from "./SceneMaterialParams";
import type {SceneModel} from "./SceneModel";
import {createVec3Float32, type Vec3} from "../../base/math/vector";
import {clamp01} from "../../base/math";
import {SDKErrorType, type SDKResult} from "../../base/core";
import {
  type LineStyle,
  type NormalisedLinePattern,
  emptyLinePattern,
  normaliseLinePattern,
} from "./linePattern";
import {
  type HatchStyle,
  type HatchParams,
  type NormalisedHatchPattern,
  emptyHatchPattern,
  normaliseHatchPattern,
} from "./hatchPattern";

export const DEFAULT_MATERIAL_IOR = 1.5;
const IDENTITY_UV_TRANSFORM: SceneTextureUVTransform = [1, 0, 0, 1, 0, 0];

export function dielectricF0FromIor(ior: number): number {
  const safeIor = iorOrDefault(ior);
  const ratio = (safeIor - 1) / (safeIor + 1);
  return ratio * ratio;
}

/**
 * A set of {@link SceneTexture | Textures} in a {@link SceneModel | SceneModel}.
 *
 * * Stored in {@link SceneModel.materials | SceneModel.materials}
 * * Created with {@link SceneModel.createMaterial | SceneModel.createMaterial}
 * * Referenced by {@link SceneMaterial.material | SceneMaterial.material}
 *
 * See {@link model!scene | @xeokit/sdk/model/scene}   for usage.
 */
export class SceneMaterial {

  /**
   * The {@link model!scene.SceneModel | SceneModel} that owns this SceneMaterial.
   * @private
   */
  readonly model: SceneModel;

  /**
   * The ID of this SceneMaterial within the SceneModel.
   */
  readonly id: string;

  /**
   * The global ID of this SceneMaterial, unique among all SceneMaterials within the Scene,
   * which is the concatenation of the SceneModel's ID and this SceneMaterial's ID, separated by "__".
   */
  readonly uniqueId: string;

  private _color: Vec3;

  /** @internal Emissive color factor (RGB, [0..1]). */
  private _emissiveColor: Vec3;

  private _opacity: number;

  private _roughness: number;

  private _metallic: number;

  private _ior: number;

  private _clearcoat: number;

  private _clearcoatRoughness: number;

  private _sheen: number;

  private _sheenRoughness: number;

  private _transmission: number;

  private _thickness: number;

  private _attenuationColor: Vec3;

  private _attenuationDistance: number;

  /**
   * Alpha-handling mode encoded as a small integer:
   * `0 = OPAQUE`, `1 = MASK`, `2 = BLEND`. Renderers read this to decide
   * whether to discard low-alpha fragments (`MASK`) or pass alpha through to
   * the blender (`BLEND`).
   */
  private _alphaMode: number;

  /**
   * Cut-off threshold for `MASK` mode. Fragments with
   * `albedoAlpha < alphaCutoff` are discarded.
   */
  private _alphaCutoff: number;

  /**
   * World-space repeat distance for the renderer's triplanar
   * texture-sampling fallback (engages when a mesh that carries
   * this material has no UV coordinates). Stored in scene units
   * per texture repeat. Materials whose meshes all carry UVs
   * ignore this value.
   */
  private _triplanarScale: number;

  /**
   * Per-material pixel line thickness for the renderer's thick
   * line draw technique. `0` means "use the View's
   * `linesMaterial.lineWidth` fallback"; any positive value
   * overrides that fallback per-material.
   */
  private _lineWidth: number;

  /**
   * Per-material dash / gap pattern, in line-width units. `len`
   * is `0` for the default "inherit the View-level pattern"
   * sentinel; any positive `len` overrides per-material. See
   * {@link linePattern}.
   */
  private _linePattern: NormalisedLinePattern;

  /**
   * Original user-facing value of {@link linePattern}, kept so
   * the getter can return what the caller passed in (`"dashed"`
   * vs. an equivalent `[3, 2]`) rather than the normalised
   * internal form.
   */
  private _linePatternUserValue: LineStyle | number[];

  /**
   * Per-material screen-space hatch pattern for triangle-surface
   * meshes. `count` is `0` for the default "solid (no hatch)"
   * sentinel; any positive `count` paints one to four line
   * families over the surface. See {@link hatchPattern}.
   */
  private _hatchPattern: NormalisedHatchPattern;

  /**
   * Original user-facing value of {@link hatchPattern}, kept so
   * the getter can return what the caller passed in (preset
   * name or {@link HatchParams}) rather than the normalised
   * internal form.
   */
  private _hatchPatternUserValue: HatchStyle | HatchParams;

  /**
   * The color {@link SceneTexture} in this set.
   */
  colorTexture?: SceneTexture;

  /**
   * The metallic-roughness {@link SceneTexture} in this set.
   */
  metallicRoughnessTexture?: SceneTexture;

  /**
   * The tangent-space normal map {@link SceneTexture} in this set.
   *
   * RGB encodes a tangent-space perturbation as `(x*0.5+0.5,
   * y*0.5+0.5, z*0.5+0.5)`. The renderer transforms it into view
   * space via a per-pixel TBN built from view-space derivatives.
   */
  normalsTexture?: SceneTexture;

  /**
   * The occlusion {@link SceneTexture} in this set.
   */
  occlusionTexture?: SceneTexture;

  /**
   * The emissive {@link SceneTexture} in this set.
   */
  emissiveTexture?: SceneTexture;

  private _colorTextureTexCoord: number;
  private _metallicRoughnessTextureTexCoord: number;
  private _normalsTextureTexCoord: number;
  private _occlusionTextureTexCoord: number;
  private _emissiveTextureTexCoord: number;
  private _colorTextureUVTransform: SceneTextureUVTransform;
  private _metallicRoughnessTextureUVTransform: SceneTextureUVTransform;
  private _normalsTextureUVTransform: SceneTextureUVTransform;
  private _occlusionTextureUVTransform: SceneTextureUVTransform;
  private _emissiveTextureUVTransform: SceneTextureUVTransform;

  /**
   * The count of {@link SceneMesh | SceneMeshes} that reference this
   * SceneMaterial. SceneModel updates this count as meshes are created and
   * destroyed. Used by {@link destroy} to refuse destruction while at least one
   * mesh still references the material (the same guard
   * {@link SceneGeometry.destroy} carries).
   */
  numMeshes: number;

  /**
   * True if this SceneMaterial has been destroyed.
   */
  public destroyed: boolean = false;

  /**
   * @private
   */
  constructor(model: SceneModel, materialParams: SceneMaterialParams,
              textures: {
                emissiveTexture?: SceneTexture;
                occlusionTexture?: SceneTexture;
                metallicRoughnessTexture?: SceneTexture;
                normalsTexture?: SceneTexture;
                colorTexture?: SceneTexture;
              }) {

    this.model = model;
    this.id = materialParams.id;
    this.uniqueId = `${model.id}__${this.id}`;
    this._color = createVec3Float32(materialParams.color || [1, 1, 1]);
    this._opacity = (materialParams.opacity !== undefined && materialParams.opacity !== null) ? materialParams.opacity : 1.0;
    // Cook-Torrance defaults: moderately rough dielectric. Clamped on
    // construction so out-of-range params logged as a constructor argument
    // can't break the shader (e.g. negative roughness producing NaN in
    // the GGX denominator).
    this._roughness = clamp01(
      (materialParams.roughness !== undefined && materialParams.roughness !== null) ? materialParams.roughness : 0.6
    );
    this._metallic = clamp01(
      (materialParams.metallic !== undefined && materialParams.metallic !== null) ? materialParams.metallic : 0.0
    );
    this._ior = iorOrDefault(materialParams.ior);
    this._clearcoat = clamp01(
      (materialParams.clearcoat !== undefined && materialParams.clearcoat !== null) ? materialParams.clearcoat : 0.0
    );
    this._clearcoatRoughness = clamp01(
      (materialParams.clearcoatRoughness !== undefined && materialParams.clearcoatRoughness !== null) ? materialParams.clearcoatRoughness : 0.0
    );
    this._sheen = clamp01(
      (materialParams.sheen !== undefined && materialParams.sheen !== null) ? materialParams.sheen : 0.0
    );
    this._sheenRoughness = clamp01(
      (materialParams.sheenRoughness !== undefined && materialParams.sheenRoughness !== null) ? materialParams.sheenRoughness : 0.5
    );
    this._transmission = clamp01(
      (materialParams.transmission !== undefined && materialParams.transmission !== null) ? materialParams.transmission : 0.0
    );
    this._thickness = nonNegativeFiniteOrDefault(materialParams.thickness, 0.0);
    this._attenuationColor = createVec3Float32(materialParams.attenuationColor || [1, 1, 1]);
    this._attenuationColor[0] = clamp01(this._attenuationColor[0]);
    this._attenuationColor[1] = clamp01(this._attenuationColor[1]);
    this._attenuationColor[2] = clamp01(this._attenuationColor[2]);
    this._attenuationDistance = attenuationDistanceOrDefault(materialParams.attenuationDistance);
    // Alpha mode is accepted as a public string and stored as a compact integer
    // because that's what renderer-side material packing consumes.
    const alphaMode = materialParams.alphaMode;
    this._alphaMode = alphaMode === "MASK" ? 1 : alphaMode === "BLEND" ? 2 : 0;
    this._alphaCutoff = clamp01(
      (materialParams.alphaCutoff !== undefined && materialParams.alphaCutoff !== null)
        ? materialParams.alphaCutoff
        : 0.5
    );
    // Triplanar scale: clamp to a strictly positive minimum so the
    // shader's `worldPos / triplanarScale` can never blow up. The
    // upper bound is left open — values much larger than the scene
    // produce a single (mostly invisible) atlas tile across the
    // model, which is the user's intent if they ask for it.
    {
      const t = materialParams.triplanarScale;
      this._triplanarScale = (t !== undefined && t !== null && t > 1e-4) ? t : 1.0;
    }
    // Per-material line thickness. `0` flags "use the View's
    // global fallback" and is the default — clamp negative input
    // to that sentinel so a stray negative value can't reach the
    // shader as a perpendicular-direction sign-flip.
    {
      const w = materialParams.lineWidth;
      this._lineWidth = (w !== undefined && w !== null && w > 0) ? w : 0;
    }
    // Per-material dash / gap pattern. Default is "solid"
    // (= `len === 0`), which downstream consumers interpret as
    // "inherit the View-level pattern".
    this._linePattern = emptyLinePattern();
    this._linePatternUserValue = "solid";
    if (materialParams.linePattern !== undefined && materialParams.linePattern !== null) {
      this._linePatternUserValue = materialParams.linePattern;
      normaliseLinePattern(materialParams.linePattern, this._linePattern);
    }
    // Per-material screen-space hatch. Default is "solid"
    // (= `count === 0`), no overlay.
    this._hatchPattern = emptyHatchPattern();
    this._hatchPatternUserValue = "solid";
    if (materialParams.hatchPattern !== undefined && materialParams.hatchPattern !== null) {
      this._hatchPatternUserValue = materialParams.hatchPattern;
      normaliseHatchPattern(materialParams.hatchPattern, this._hatchPattern);
    }
    this.colorTexture = textures.colorTexture;
    this.metallicRoughnessTexture = textures.metallicRoughnessTexture;
    this.normalsTexture = textures.normalsTexture;
    this.occlusionTexture = textures.occlusionTexture;
    this.emissiveTexture = textures.emissiveTexture;
    this._colorTextureTexCoord = texCoordOrDefault(materialParams.colorTextureTexCoord);
    this._metallicRoughnessTextureTexCoord = texCoordOrDefault(materialParams.metallicRoughnessTextureTexCoord);
    this._normalsTextureTexCoord = texCoordOrDefault(materialParams.normalsTextureTexCoord);
    this._occlusionTextureTexCoord = texCoordOrDefault(materialParams.occlusionTextureTexCoord);
    this._emissiveTextureTexCoord = texCoordOrDefault(materialParams.emissiveTextureTexCoord);
    this._colorTextureUVTransform = normalizeBindingUVTransform(materialParams.colorTextureUVTransform, textures.colorTexture);
    this._metallicRoughnessTextureUVTransform = normalizeBindingUVTransform(materialParams.metallicRoughnessTextureUVTransform, textures.metallicRoughnessTexture);
    this._normalsTextureUVTransform = normalizeBindingUVTransform(materialParams.normalsTextureUVTransform, textures.normalsTexture);
    this._occlusionTextureUVTransform = normalizeBindingUVTransform(materialParams.occlusionTextureUVTransform, textures.occlusionTexture);
    this._emissiveTextureUVTransform = normalizeBindingUVTransform(materialParams.emissiveTextureUVTransform, textures.emissiveTexture);
    // Auto-default the emissive factor to white when a material has an
    // emissive texture but no explicit factor — so it glows without the
    // caller restating `[1,1,1]`. No texture → `[0,0,0]` (no emission).
    this._emissiveColor = createVec3Float32(
      materialParams.emissiveColor || (textures.emissiveTexture ? [1, 1, 1] : [0, 0, 0])
    );
    this.numMeshes = 0;
  }


  /**
   * Gets the RGB color for this SceneMaterial.
   *
   * Each element of the color is in range ````[0..1]````.
   */
  get color(): Vec3 {
    return this._color;
  }

  /**
   * Gets the emissive color factor for this SceneMaterial, as *RGB* in
   * `[0..1]`. Multiplied against {@link SceneMaterial.emissiveTexture}.
   */
  get emissiveColor(): Vec3 {
    return this._emissiveColor;
  }

  /**
   * Sets the emissive color factor for this SceneMaterial.
   *
   * - Multiplied against {@link SceneMaterial.emissiveTexture}.
   * - Fires an {@link SceneEvents.onSceneMaterialEmissiveColorChanged | SceneEvents.onSceneMaterialEmissiveColorChanged} event on the Scene.
   * - Each element of the color is in range ````[0..1]````.
   */
  set emissiveColor(value: Vec3) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.emissiveColor] Cannot set emissiveColor on destroyed SceneMaterial ${this.id}`
      });
      return;
    }
    if (!value || value.length !== 3) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneMaterial.emissiveColor] Invalid emissiveColor for SceneMaterial ${this.id}`
      });
      return;
    }
    const emissiveColor = this._emissiveColor;
    emissiveColor[0] = value[0];
    emissiveColor[1] = value[1];
    emissiveColor[2] = value[2];
    this.model.scene.events.onSceneMaterialEmissiveColorChanged.dispatch(this.model.scene, this);
  }

  /**
   * Sets the RGB color for this SceneMaterial.
   *
   * - Fires an {@link SceneEvents.onSceneMaterialColorChanged | SceneEvents.onSceneMaterialColorChanged} event on the Scene.
   * - Each element of the color is in range ````[0..1]````.
   */
  set color(value: Vec3) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.color] Cannot set color on destroyed SceneMaterial ${this.id}`
      });
      return;
    }
    if (!value || value.length !== 3) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[SceneMaterial.color] Invalid color for SceneMaterial ${this.id}`
      });
      return;
    }
    let color = this._color;
    if (value) {
      color[0] = value[0];
      color[1] = value[1];
      color[2] = value[2];
    } else {
      color[0] = 1;
      color[1] = 1;
      color[2] = 1;
    }
    this.model.scene.events.onSceneMaterialColorChanged.dispatch(this.model.scene, this);
  }


  /**
   * Gets the opacity factor for this SceneMaterial.
   *
   * This is a factor in range ````[0..1]````.
   */
  get opacity(): number {
    return this._opacity;
  }

  /**
   * Microfacet roughness consumed by the Cook-Torrance BRDF.
   *
   * `0` is mirror-smooth, `1` is fully diffuse. Only consulted on the
   * smooth-shaded (per-vertex normals) render path.
   */
  get roughness(): number {
    return this._roughness;
  }

  /**
   * Metallic factor consumed by the Cook-Torrance BRDF.
   *
   * `0` is a pure dielectric whose Fresnel base reflectance is derived from
   * {@link SceneMaterial.ior}; `1` is a pure metal whose Fresnel base
   * reflectance is the surface colour or sampled colour-texture value, with
   * the diffuse term suppressed. Only consulted on the smooth-shaded render
   * path.
   */
  get metallic(): number {
    return this._metallic;
  }

  /**
   * Index of refraction used to derive dielectric surface reflectance.
   *
   * The default `1.5` preserves the conventional dielectric `F0` of
   * approximately `0.04`. This is a material reflectance property and does not
   * imply geometric refraction.
   */
  get ior(): number {
    return this._ior;
  }

  /**
   * Scalar dielectric clearcoat strength consumed by the Cook-Torrance
   * BRDF. `0` disables the coat; `1` applies the full coat layer.
   */
  get clearcoat(): number {
    return this._clearcoat;
  }

  /**
   * Microfacet roughness for the scalar clearcoat layer.
   */
  get clearcoatRoughness(): number {
    return this._clearcoatRoughness;
  }

  /**
   * Scalar sheen strength consumed by the Cook-Torrance render path.
   */
  get sheen(): number {
    return this._sheen;
  }

  /**
   * Roughness for the scalar sheen lobe.
   */
  get sheenRoughness(): number {
    return this._sheenRoughness;
  }

  /**
   * Fraction of non-reflected light intended to pass through this material.
   */
  get transmission(): number {
    return this._transmission;
  }

  /**
   * Characteristic/effective thickness of the material volume, in scene units.
   */
  get thickness(): number {
    return this._thickness;
  }

  /**
   * RGB colour reached by transmitted light after traveling
   * {@link attenuationDistance} through the material.
   */
  get attenuationColor(): Vec3 {
    return this._attenuationColor;
  }

  /**
   * Distance, in scene units, at which transmitted light reaches
   * {@link attenuationColor}. `Infinity` means unlimited/no distance-based
   * attenuation.
   */
  get attenuationDistance(): number {
    return this._attenuationDistance;
  }

  /**
   * Alpha-handling mode: `0 = OPAQUE`, `1 = MASK`, `2 = BLEND`.
   */
  get alphaMode(): number {
    return this._alphaMode;
  }

  /**
   * Cut-off threshold used when `alphaMode === MASK`. Fragments with
   * `albedoAlpha < alphaCutoff` are discarded by the renderer.
   */
  get alphaCutoff(): number {
    return this._alphaCutoff;
  }

  /**
   * World-space repeat distance for triplanar texture sampling, in
   * scene units per texture repeat. Consulted by a renderer when
   * a mesh carrying this material has no UV coordinates and the
   * material binds a texture; ignored otherwise.
   */
  get triplanarScale(): number {
    return this._triplanarScale;
  }

  get colorTextureTexCoord(): number { return this._colorTextureTexCoord; }
  get metallicRoughnessTextureTexCoord(): number { return this._metallicRoughnessTextureTexCoord; }
  get normalsTextureTexCoord(): number { return this._normalsTextureTexCoord; }
  get occlusionTextureTexCoord(): number { return this._occlusionTextureTexCoord; }
  get emissiveTextureTexCoord(): number { return this._emissiveTextureTexCoord; }
  get colorTextureUVTransform(): SceneTextureUVTransform { return Array.from(this._colorTextureUVTransform) as SceneTextureUVTransform; }
  get metallicRoughnessTextureUVTransform(): SceneTextureUVTransform { return Array.from(this._metallicRoughnessTextureUVTransform) as SceneTextureUVTransform; }
  get normalsTextureUVTransform(): SceneTextureUVTransform { return Array.from(this._normalsTextureUVTransform) as SceneTextureUVTransform; }
  get occlusionTextureUVTransform(): SceneTextureUVTransform { return Array.from(this._occlusionTextureUVTransform) as SceneTextureUVTransform; }
  get emissiveTextureUVTransform(): SceneTextureUVTransform { return Array.from(this._emissiveTextureUVTransform) as SceneTextureUVTransform; }

  /**
   * Per-material pixel line thickness, in screen pixels. `0`
   * means "fall back to the View's `linesMaterial.lineWidth`";
   * any positive value overrides that fallback for meshes using
   * this material. Only line-primitive meshes consume it.
   */
  get lineWidth(): number {
    return this._lineWidth;
  }

  /**
   * Per-material dash / gap pattern. Returns the originally-set
   * preset name or `number[]` value the caller passed in — not
   * the normalised internal form. Default is `"solid"`
   * (= inherit the View-level pattern).
   */
  get linePattern(): LineStyle | number[] {
    return this._linePatternUserValue;
  }

  /** @internal — read by downstream consumers. */
  get _linePatternEntries(): Float32Array<any> {
    return this._linePattern.entries;
  }

  /** @internal — read by downstream consumers. */
  get _linePatternLen(): number {
    return this._linePattern.len;
  }

  /** @internal — read by downstream consumers. */
  get _linePatternPeriod(): number {
    return this._linePattern.period;
  }

  /**
   * Updates the per-material dash / gap pattern. Accepts the
   * same value shapes as the constructor's `linePattern` param
   * — a {@link LineStyle} preset name or a custom `number[]`.
   * The change fires
   * {@link SceneEvents.onSceneMaterialPatternChanged}, which
   * the renderer picks up to re-encode the material's slot in
   * its per-batch pattern table without re-uploading per-mesh
   * data.
   */
  set linePattern(value: LineStyle | number[]) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.linePattern] Cannot set linePattern on destroyed SceneMaterial ${this.id}`
      });
      return;
    }
    this._linePatternUserValue = value;
    normaliseLinePattern(value, this._linePattern);
    this.model.scene.events.onSceneMaterialPatternChanged.dispatch(this.model.scene, this);
  }

  /**
   * Per-material hatch pattern. Returns the originally-set
   * preset name or {@link HatchParams} value the caller passed
   * in — not the normalised internal form. Default is
   * `"solid"` (no hatch).
   */
  get hatchPattern(): HatchStyle | HatchParams {
    return this._hatchPatternUserValue;
  }

  /** @internal — read by downstream consumers. */
  get _hatchPatternFamilies(): Float32Array<any> {
    return this._hatchPattern.families;
  }

  /** @internal — read by downstream consumers. */
  get _hatchPatternCount(): number {
    return this._hatchPattern.count;
  }

  /** @internal — read by downstream consumers. */
  get _hatchPatternColor(): Float32Array<any> {
    return this._hatchPattern.color;
  }

  /** @internal — read by downstream consumers. `0` for screen-space, `1` for world-space. */
  get _hatchPatternSpace(): number {
    return this._hatchPattern.space;
  }

  /**
   * Updates the per-material hatch pattern. Accepts the same
   * value shapes as the constructor's `hatchPattern` param —
   * a {@link HatchStyle} preset name or a {@link HatchParams}
   * object. Fires
   * {@link SceneEvents.onSceneMaterialPatternChanged}.
   */
  set hatchPattern(value: HatchStyle | HatchParams) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.hatchPattern] Cannot set hatchPattern on destroyed SceneMaterial ${this.id}`
      });
      return;
    }
    this._hatchPatternUserValue = value;
    normaliseHatchPattern(value, this._hatchPattern);
    this.model.scene.events.onSceneMaterialPatternChanged.dispatch(this.model.scene, this);
  }

  /**
   * Sets the opacity factor for this SceneMaterial.
   *
   * - This is a factor in range ````[0..1]````.
   * - Fires an {@link SceneEvents.onSceneMaterialOpacityChanged | SceneEvents.onSceneMaterialOpacityChanged} event on the Scene.
   */
  set opacity(opacity: number) {
    if (this.destroyed) {
      this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.opacity] Cannot set opacity on destroyed SceneMaterial ${this.id}`
      });
      return;
    }
    opacity = (opacity !== undefined && opacity !== null) ? opacity : 1.0;
    if (this._opacity === opacity) {
      return;
    }
    this._opacity = opacity;
    this.model.scene.events.onSceneMaterialOpacityChanged.dispatch(this.model.scene, this);
  }

  /**
   * Gets this SceneMaterial as SceneMaterialParams.
   */
  toParams(): SDKResult<SceneMaterialParams> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.toParams] Cannot get params of destroyed SceneMaterial ${this.id}`
      });
    }
    const materialParams = <SceneMaterialParams>{
      id: this.id,
      color: Array.from(this._color),
      emissiveColor: Array.from(this._emissiveColor),
      opacity: this._opacity,
      roughness: this._roughness,
      metallic: this._metallic,
      ior: this._ior,
      clearcoat: this._clearcoat,
      clearcoatRoughness: this._clearcoatRoughness,
      sheen: this._sheen,
      sheenRoughness: this._sheenRoughness,
      transmission: this._transmission,
      thickness: this._thickness,
      attenuationColor: Array.from(this._attenuationColor),
      attenuationDistance: this._attenuationDistance,
      alphaMode: this._alphaMode === 1 ? "MASK" : this._alphaMode === 2 ? "BLEND" : "OPAQUE",
      alphaCutoff: this._alphaCutoff,
      triplanarScale: this._triplanarScale,
      lineWidth: this._lineWidth,
      linePattern: cloneLinePattern(this._linePatternUserValue),
      hatchPattern: cloneHatchPattern(this._hatchPatternUserValue),
    };
    if (this.colorTexture) {
      materialParams.colorTextureId = this.colorTexture.id;
      materialParams.colorTextureTexCoord = this._colorTextureTexCoord;
      materialParams.colorTextureUVTransform = Array.from(this._colorTextureUVTransform) as SceneTextureUVTransform;
    }
    if (this.metallicRoughnessTexture) {
      materialParams.metallicRoughnessTextureId = this.metallicRoughnessTexture.id;
      materialParams.metallicRoughnessTextureTexCoord = this._metallicRoughnessTextureTexCoord;
      materialParams.metallicRoughnessTextureUVTransform = Array.from(this._metallicRoughnessTextureUVTransform) as SceneTextureUVTransform;
    }
    if (this.normalsTexture) {
      materialParams.normalsTextureId = this.normalsTexture.id;
      materialParams.normalsTextureTexCoord = this._normalsTextureTexCoord;
      materialParams.normalsTextureUVTransform = Array.from(this._normalsTextureUVTransform) as SceneTextureUVTransform;
    }
    if (this.occlusionTexture) {
      materialParams.occlusionTextureId = this.occlusionTexture.id;
      materialParams.occlusionTextureTexCoord = this._occlusionTextureTexCoord;
      materialParams.occlusionTextureUVTransform = Array.from(this._occlusionTextureUVTransform) as SceneTextureUVTransform;
    }
    if (this.emissiveTexture) {
      materialParams.emissiveTextureId = this.emissiveTexture.id;
      materialParams.emissiveTextureTexCoord = this._emissiveTextureTexCoord;
      materialParams.emissiveTextureUVTransform = Array.from(this._emissiveTextureUVTransform) as SceneTextureUVTransform;
    }
    return {
      ok: true,
      value: materialParams
    };
  }

  /**
   * Destroys this SceneMaterial.
   *
   * Refuses to destroy while at least one {@link model!scene.SceneMesh | SceneMesh} in the
   * SceneModel still references this material — destroy or
   * reassign those meshes first. Mirrors {@link SceneGeometry.destroy}.
   */
  destroy(): SDKResult<void> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.destroy] SceneMaterial '${this.id}' already destroyed`
      });
    }
    if (this.numMeshes > 0) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneMaterial.destroy] Cannot destroy SceneMaterial '${this.id}' - ` +
               `still referenced by ${this.numMeshes} SceneMesh(es), which you need to destroy first`
      });
    }
    this.model._destroyMaterial(this);
    this.destroyed = true;
    return {ok: true, value: undefined};
  }
}

function cloneLinePattern(value: LineStyle | number[]): LineStyle | number[] {
  return Array.isArray(value) ? Array.from(value) : value;
}

function cloneHatchPattern(value: HatchStyle | HatchParams): HatchStyle | HatchParams {
  if (typeof value === "string") {
    return value;
  }
  const cloned: HatchParams = {
    families: value.families.map(family => ({...family})),
  };
  if (value.color) {
    cloned.color = <Vec3>Array.from(value.color);
  }
  if (value.opacity !== undefined) {
    cloned.opacity = value.opacity;
  }
  if (value.space !== undefined) {
    cloned.space = value.space;
  }
  return cloned;
}

function nonNegativeFiniteOrDefault(value: number | undefined, defaultValue: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(0, value);
}

function iorOrDefault(value: number | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return DEFAULT_MATERIAL_IOR;
  }
  return Math.max(1, value);
}

function attenuationDistanceOrDefault(value: number | undefined): number {
  if (value === undefined || value === null) {
    return Infinity;
  }
  if (value === Infinity) {
    return Infinity;
  }
  return Number.isFinite(value) && value > 0 ? value : Infinity;
}

function texCoordOrDefault(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 0 ? value! : 0;
}

function normalizeBindingUVTransform(
  value: SceneTextureUVTransform | undefined,
  texture: SceneTexture | undefined
): SceneTextureUVTransform {
  const source = value ?? texture?.uvTransform ?? IDENTITY_UV_TRANSFORM;
  if (!source || source.length !== 6) {
    return Array.from(IDENTITY_UV_TRANSFORM) as SceneTextureUVTransform;
  }
  return [
    finiteOrDefault(source[0], 1),
    finiteOrDefault(source[1], 0),
    finiteOrDefault(source[2], 0),
    finiteOrDefault(source[3], 1),
    finiteOrDefault(source[4], 0),
    finiteOrDefault(source[5], 0)
  ];
}

function finiteOrDefault(value: number | undefined, defaultValue: number): number {
  return Number.isFinite(value) ? value! : defaultValue;
}
