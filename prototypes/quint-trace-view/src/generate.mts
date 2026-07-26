import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  renderSideBySideHtml,
  renderTable,
  renderVisuals
} from "./render.mjs"
import {
  decodeTrace,
  FixtureManifestSchema,
  ImplementationFixtureSchema
} from "./trace.mjs"
import { Schema } from "effect"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(packageRoot, "..", "..")
const manifests = ["normal", "restart", "counterexample"]
await mkdir(resolve(packageRoot, "artifacts"), { recursive: true })

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"))

const modelSha256 = createHash("sha256")
  .update(await readFile(resolve(repositoryRoot, "specs", "frontierRecovery.qnt")))
  .digest("hex")

for (const name of manifests) {
  const manifestPath = resolve(packageRoot, "fixtures", `${name}.manifest.json`)
  const manifest = Schema.decodeUnknownSync(FixtureManifestSchema)(
    await readJson(manifestPath)
  )
  if (manifest.provenance.modelSha256 !== modelSha256) {
    throw new Error(
      `model SHA mismatch: expected ${manifest.provenance.modelSha256}, got ${modelSha256}`
    )
  }
  const raw = await readJson(resolve(packageRoot, "fixtures", manifest.rawItf))
  const implementationFixture = manifest.implementationProjection === undefined
    ? undefined
    : Schema.decodeUnknownSync(ImplementationFixtureSchema)(
      await readJson(
        resolve(packageRoot, "fixtures", manifest.implementationProjection)
      )
    )
  if (
    implementationFixture !== undefined
    && JSON.stringify(implementationFixture.provenance)
      !== JSON.stringify(manifest.provenance)
  ) {
    throw new Error("implementation and ITF fixture provenance disagree")
  }
  const trace = decodeTrace(
    raw,
    manifest.provenance,
    implementationFixture?.frames
  )
  const table = renderTable(trace)
  const { mermaid, svg } = renderVisuals(trace)
  const artifactRoot = resolve(packageRoot, "artifacts", name)
  await Promise.all([
    writeFile(`${artifactRoot}.normalized.json`, `${JSON.stringify(trace)}\n`),
    writeFile(`${artifactRoot}.table.md`, table),
    writeFile(`${artifactRoot}.visual.mmd`, mermaid),
    writeFile(`${artifactRoot}.visual.svg`, svg),
    writeFile(
      `${artifactRoot}.side-by-side.html`,
      renderSideBySideHtml(trace, table, svg)
    )
  ])
  process.stdout.write(
    `generated ${basename(artifactRoot)}: ${trace.frames.length} frames\n`
  )
}
