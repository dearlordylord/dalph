import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: [{
      find: /^effect\/testing\/TestClock$/,
      replacement: fileURLToPath(new URL("../../node_modules/effect/dist/testing/TestClock.js", import.meta.url))
    }, {
      find: /^effect\/testing\/TestConsole$/,
      replacement: fileURLToPath(new URL("../../node_modules/effect/dist/testing/TestConsole.js", import.meta.url))
    }, {
      find: /^effect$/,
      replacement: fileURLToPath(new URL("../../node_modules/effect/dist/index.js", import.meta.url))
    }, {
      find: /^@dalph\/contracts$/,
      replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url))
    }, {
      find: /^@dalph\/orchestrator$/,
      replacement: fileURLToPath(new URL("../../packages/orchestrator/src/index.ts", import.meta.url))
    }, {
      find: /^@effect\/sql-sqlite-node\/(?:SqliteClient|SqliteMigrator)$/,
      replacement: fileURLToPath(new URL("./src/node-only-module-shim.ts", import.meta.url))
    }, {
      find: /^fs-ext-extra-prebuilt$/,
      replacement: fileURLToPath(new URL("./src/node-only-module-shim.ts", import.meta.url))
    }, {
      find: /^@effect\/platform-node$/,
      replacement: fileURLToPath(new URL("./src/platform-node-shim.ts", import.meta.url))
    }]
  },
  server: {
    allowedHosts: ["determined_johnson.orb.local"],
    host: "0.0.0.0"
  }
})
