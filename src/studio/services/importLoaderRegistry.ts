import {LoaderRegistry, type LoaderInput} from "../importing/LoaderRegistry";

export function createLazyLoaderRegistry(): LoaderRegistry {
  const registry = new LoaderRegistry();

  registry.register("xgf", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {XGFLoader} = await import("@xeokit/sdk/formats/xgf");
      return new XGFLoader().load(input, options);
    }
  });

  registry.register("ifc", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {IFCLoader} = await import("@xeokit/sdk/formats/ifc");
      return new IFCLoader().load(input, options);
    }
  });

  registry.register("gltf", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {GLTFLoader} = await import("@xeokit/sdk/formats/gltf");
      return new GLTFLoader().load(input, options);
    }
  });

  registry.register("fbx", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {FBXLoader} = await import("@xeokit/sdk/formats/fbx");
      return new FBXLoader().load(input, options);
    }
  });

  registry.register("usdz", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {USDZLoader} = await import("@xeokit/sdk/formats/usdz");
      return new USDZLoader().load(input, options);
    }
  });

  registry.register("e57", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {E57Loader} = await import("@xeokit/sdk/formats/e57");
      return new E57Loader().load(input, options);
    }
  });

  const loadLas = async (input: LoaderInput, options: any) => {
    const {LASLoader} = await import("@xeokit/sdk/formats/las");
    return new LASLoader().load(input, options);
  };
  registry.register("las", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: true,
    load: loadLas
  });
  registry.register("laz", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: true,
    load: loadLas
  });

  registry.register("splat", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {GaussianSplatLoader} = await import("@xeokit/sdk/formats/gaussiansplat");
      return new GaussianSplatLoader().load(input, options);
    }
  });

  registry.register("mtl", {
    fetch: "text",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {MTLLoader} = await import("@xeokit/sdk/formats/mtl");
      return new MTLLoader().load(input, options);
    }
  });

  registry.register("obj", {
    fetch: "text",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {OBJLoader} = await import("@xeokit/sdk/formats/obj");
      return new OBJLoader().load(input, options);
    }
  });

  registry.register("ply", {
    fetch: "text",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {PLYLoader} = await import("@xeokit/sdk/formats/ply");
      return new PLYLoader().load(input, options);
    }
  });

  registry.register("dotbim", {
    fetch: "json",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {DotBIMLoader} = await import("@xeokit/sdk/formats/dotbim");
      return new DotBIMLoader().load(input, options);
    }
  });

  registry.register("cityjson", {
    fetch: "json",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {CityJSONLoader} = await import("@xeokit/sdk/formats/cityjson");
      return new CityJSONLoader().load(input, options);
    }
  });

  registry.register("citygml", {
    fetch: "text",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {CityGMLLoader} = await import("@xeokit/sdk/formats/citygml");
      return new CityGMLLoader().load(input, options);
    }
  });

  registry.register("fds", {
    fetch: "text",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {FDSLoader} = await import("@xeokit/sdk/formats/fds");
      return new FDSLoader().load(input, options);
    }
  });

  registry.register("threedxml", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {ThreeDXMLLoader} = await import("@xeokit/sdk/formats/threedxml");
      return new ThreeDXMLLoader().load(input, options);
    }
  });

  registry.register("threedtiles", {
    fetch: "json",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {ThreeDTilesLoader} = await import("@xeokit/sdk/formats/threedtiles");
      return new ThreeDTilesLoader().load(input, options);
    }
  });

  registry.register("xkt", {
    fetch: "arrayBuffer",
    needsScene: true,
    needsData: true,
    load: async (input, options) => {
      const {XKTLoader} = await import("@xeokit/sdk/formats/legacy/xkt");
      return new XKTLoader().load(input, options);
    }
  });

  registry.register("metamodel", {
    fetch: "json",
    needsScene: false,
    needsData: true,
    load: async (input, options) => {
      const {MetaModelLoader} = await import("@xeokit/sdk/formats/legacy/metamodel");
      return new MetaModelLoader().load(input, options);
    }
  });

  registry.register("datamodel", {
    fetch: "json",
    needsScene: false,
    needsData: true,
    load: async (input, options) => {
      const {DataModelImporter} = await import("@xeokit/sdk/formats/datamodel");
      return new DataModelImporter().load(input, options);
    }
  });

  registry.register("scenemodel", {
    fetch: "json",
    needsScene: true,
    needsData: false,
    load: async (input, options) => {
      const {SceneModelImporter} = await import("@xeokit/sdk/formats/scenemodel");
      return new SceneModelImporter().load(input, options);
    }
  });

  return registry;
}
