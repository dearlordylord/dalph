import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const workspace = fileURLToPath(new URL("../../../../", import.meta.url))
const packageEntries = new Map([
  ["@dalph/contracts", pathToFileURL(`${workspace}packages/contracts/src/index.ts`).href],
  ["@dalph/executor", pathToFileURL(`${workspace}packages/executor/src/index.ts`).href],
  ["@dalph/orchestrator", pathToFileURL(`${workspace}packages/orchestrator/src/index.ts`).href]
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const packageEntry = packageEntries.get(specifier)
    if (packageEntry !== undefined) return { shortCircuit: true, url: packageEntry }
    if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:") === true) {
      const typescriptUrl = new URL(specifier.replace(/\.js$/u, ".ts"), context.parentURL)
      if (existsSync(fileURLToPath(typescriptUrl))) return { shortCircuit: true, url: typescriptUrl.href }
    }
    return nextResolve(specifier, context)
  }
})
