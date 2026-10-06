const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const {buildSync} = require("esbuild");
const app = path.resolve(__dirname, "../src");
const source = path.join(app, "studio");
const dependencies = new Set(Object.keys(require("../package.json").dependencies));

function files(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function resolve(file, specifier) {
  const target = path.resolve(path.dirname(file), specifier);
  return [target, target + ".ts", path.join(target, "index.ts")]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

test("Studio-owned TypeScript imports stay in Studio, apart from declared library dependencies", () => {
  for (const file of files(source).filter(file => file.endsWith(".ts"))) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith("@xeokit/sdk")) return;
        if ([...dependencies].some(name => specifier === name || specifier.startsWith(name + "/"))) return;
        assert.ok(specifier.startsWith("."), `${file}: unexpected external ownership ${specifier}`);
        const target = resolve(file, specifier);
        assert.ok(target, `${file}: unresolved ${specifier}`);
        assert.ok(inside(source, target), `${file}: escapes Studio to ${target}`);
        assert.notEqual(target, path.join(app, "main.ts"), "leaf modules must not import the executable entrypoint");
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});

test("standalone explorer modules bundle without the Studio application or legacy libraries", () => {
  for (const explorer of ["data", "scene", "viewer", "ifc"]) {
    const result = buildSync({
      entryPoints: [path.join(source, "explorers", explorer, "index.ts")],
      bundle: true, write: false, metafile: true, format: "esm", platform: "browser",
      external: ["@xeokit/sdk", "@xeokit/sdk/*", "vue", "lucide-vue-next"], logLevel: "silent"
    });
    const inputs = Object.keys(result.metafile.inputs).map(file => path.resolve(file));
    assert.ok(inputs.some(file => file.endsWith("PagedTreeState.ts")), explorer);
    for (const file of inputs) {
      assert.ok(inside(source, file), `${explorer}: external implementation ${file}`);
      assert.ok(!inside(path.join(source, "app"), file), `${explorer}: pulls in application bootstrap`);
      assert.ok(!inside(path.join(source, "components"), file), `${explorer}: pulls in the docked shell`);
    }
  }
});

test("all local Studio stylesheet imports resolve", () => {
  for (const file of [path.join(app, "styles.css"), ...files(source).filter(file => file.endsWith(".css"))]) {
    const css = fs.readFileSync(file, "utf8");
    for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
      if (!match[1].startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(fs.existsSync(target), `${file}: missing stylesheet ${match[1]}`);
      assert.ok(inside(source, target), `${file}: styles owned outside Studio`);
    }
  }
});
