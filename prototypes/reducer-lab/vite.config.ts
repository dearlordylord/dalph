import { defineConfig } from "vite"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const git = (...args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim()
const sourceRevision = `${git("rev-parse", "--short=12", "HEAD")}${git("status", "--porcelain").length > 0 ? "+dirty" : ""}`

export default defineConfig({
  define: {
    __DALPH_SOURCE_REVISION__: JSON.stringify(sourceRevision)
  },
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
