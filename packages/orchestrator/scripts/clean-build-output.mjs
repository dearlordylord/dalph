import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const packageBuildOutput = fileURLToPath(new URL("../dist/", import.meta.url))

await rm(packageBuildOutput, { force: true, recursive: true })
