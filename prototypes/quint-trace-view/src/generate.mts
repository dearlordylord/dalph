import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  renderObservedDagHtml,
  renderTable
} from "./render.mjs"
import {
  decodeTrace,
  FixtureManifestSchema,
  ImplementationFixtureSchema,
  type NormalizedTrace
} from "./trace.mjs"
import { Effect, Schema } from "effect"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(packageRoot, "..", "..")
const manifests = [
  "normal",
  "restart",
  "counterexample",
  "story-crash-after-intent",
  "story-pause-independent",
  "story-claim-loss",
  "story-git-rewrite",
  "story-external-completion"
]
await mkdir(resolve(packageRoot, "artifacts"), { recursive: true })

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"))

const modelSha256 = createHash("sha256")
  .update(await readFile(resolve(repositoryRoot, "specs", "frontierRecovery.qnt")))
  .digest("hex")
const scenarioTestSourceSha256 = createHash("sha256")
  .update(await readFile(resolve(repositoryRoot, "specs", "frontierRecovery_test.qnt")))
  .digest("hex")

const traces: Array<NormalizedTrace> = []
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
  if (
    manifest.provenance.scenarioTestSourceSha256 !== undefined
    && manifest.provenance.scenarioTestSourceSha256
      !== scenarioTestSourceSha256
  ) {
    throw new Error(
      `scenario test SHA mismatch: expected ${manifest.provenance.scenarioTestSourceSha256}, got ${scenarioTestSourceSha256}`
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
  const trace = await Effect.runPromise(
    decodeTrace(
      raw,
      manifest.provenance,
      implementationFixture?.frames
    )
  )
  traces.push(trace)
  const table = renderTable(trace)
  const artifactRoot = resolve(packageRoot, "artifacts", name)
  await Promise.all([
    writeFile(`${artifactRoot}.normalized.json`, `${JSON.stringify(trace)}\n`),
    writeFile(`${artifactRoot}.table.md`, table)
  ])
  process.stdout.write(
    `generated ${basename(artifactRoot)}: ${trace.frames.length} frames\n`
  )
}

const storyTraces = traces.filter(({ provenance }) =>
  provenance.traceKind.startsWith("story-")
)
const dagHtml = renderObservedDagHtml(storyTraces)
await Promise.all([
  writeFile(resolve(packageRoot, "index.html"), dagHtml),
  writeFile(resolve(packageRoot, "artifacts", "observed-state-dag.html"), dagHtml)
])
process.stdout.write("generated observed-state-dag.html\n")
