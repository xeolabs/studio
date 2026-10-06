import {fileURLToPath, URL} from "node:url";
import {defineConfig} from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      {find: /^vue$/, replacement: "vue/dist/vue.esm-bundler.js"},
      {find: "@xeokit/sdk", replacement: fileURLToPath(new URL("./vendor/xeokit-sdk/src", import.meta.url))}
    ],
    dedupe: ["vue"]
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  build: {target: "es2022"},
  server: {host: "127.0.0.1"}
});
