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
  type ArtifactProvenance,
  type MbtComparableProjection
} from "./trace.mjs"

interface FixtureManifest {
  readonly implementationProjection?: string
  readonly provenance: ArtifactProvenance
  readonly rawItf: string
}

interface ImplementationFixture {
  readonly frames: ReadonlyArray<MbtComparableProjection>
  readonly provenance: {
    readonly dalphRevision: string
    readonly projectionVersion: number
  }
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const manifests = ["normal", "restart", "counterexample"]
await mkdir(resolve(packageRoot, "artifacts"), { recursive: true })

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"))

for (const name of manifests) {
  const manifestPath = resolve(packageRoot, "fixtures", `${name}.manifest.json`)
  const manifest = await readJson(manifestPath) as FixtureManifest
  const raw = await readJson(resolve(packageRoot, "fixtures", manifest.rawItf))
  const implementation = manifest.implementationProjection === undefined
    ? []
    : (await readJson(
      resolve(packageRoot, "fixtures", manifest.implementationProjection)
    ) as ImplementationFixture).frames
  const trace = decodeTrace(raw, manifest.provenance, implementation)
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
