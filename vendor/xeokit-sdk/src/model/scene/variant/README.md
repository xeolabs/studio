# Scene variants

A `SceneVariantSet` groups alternative collections of `SceneObject` IDs for the same logical content. Each `SceneVariant` references its objects and can provide a projected-size range. The set declares a default variant and optional selection hints; active selection belongs to each View.

A variant chooses **which objects participate**. A `SceneRepresentation` describes **how a mesh's geometry and numerical resources are interpreted**. Objects in a variant can contain ordinary meshes, meshes bound to a representation, or both.

## Author a variant set

Once the detailed and shell objects exist in a model:

```ts
const result = model.createVariantSet({
  id: "building",
  defaultVariantId: "detailed",
  variants: [
    {
      id: "detailed",
      objectIds: ["walls", "roof", "windows"],
      range: {minPixels: 260}
    },
    {
      id: "shell",
      objectIds: ["building-shell"],
      range: {maxPixels: 220}
    }
  ],
  selection: {strategy: "projectedSize", hysteresisPixels: 12}
});
if (!result.ok) throw new Error(result.error);

const variants = model.variantSets.building;
console.log(variants.defaultVariant.id);
```

Variants reference objects; they do not own them. Destroying a set leaves its objects intact. Creating a set does not change application visibility or select a variant for a View.

## Select per View

```ts
import {VariantLODSelector} from "@xeokit/sdk/viewing/lod";

const selector = new VariantLODSelector({viewer});
const selected = selector.getActiveVariantId(view, model.variantSets.building);
```

The selector consumes the model's projected-size hints and applies per-View LOD suppression. It keeps selection separate from ordinary `ViewObject` visibility and avoids rewriting visibility on every object when switching a large group. Different Views can select different variants from the same set.

The scene types are exported from `@xeokit/sdk/model/scene` and `@xeokit/sdk/model/scene/variant`. XGF stores variant membership, defaults and selection hints as model data.
