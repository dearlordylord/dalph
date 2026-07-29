import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve, sep } from "node:path"

const packageDirectory = resolve(process.argv[2] ?? "")
const packagesDirectory = `${resolve(fileURLToPath(new URL("../packages/", import.meta.url)))}${sep}`

if (!packageDirectory.startsWith(packagesDirectory)) {
  throw new Error(`refusing to clean build output outside packages/: ${packageDirectory}`)
}

await rm(resolve(packageDirectory, "dist"), { force: true, recursive: true })
