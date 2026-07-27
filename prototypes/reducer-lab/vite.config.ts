import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: [{
      find: /^effect$/,
      replacement: fileURLToPath(new URL("./node_modules/effect/dist/index.js", import.meta.url))
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
