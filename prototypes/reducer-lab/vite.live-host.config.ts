import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import lab from "./vite.config.ts"

if (lab.resolve === undefined) throw new Error("The shared Lab browser resolver is required")

/** The live page builds the same renderer with the Lab's existing dependency
 * and browser-boundary configuration. No playback entry is included. */
export default defineConfig({
  resolve: lab.resolve,
  build: {
    outDir: "../../packages/dalph/dist/browser",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("../../packages/dalph/browser/live-task-graph.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "graph.js"
    },
    cssCodeSplit: false,
    rollupOptions: { output: { assetFileNames: "graph.[ext]" } }
  }
})
