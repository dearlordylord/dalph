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
  "responsibility-first",
  "restart",
  "counterexample",
  "story-crash-after-intent",
  "story-pause-independent",
  "story-pause-resume",
  "story-success",
  "story-lost-worktree",
  "story-blocker",
  "story-claim-loss",
  "story-git-rewrite",
  "story-external-completion",
  "explore-claim-c-then-claim-loss",
  "explore-claim-loss-then-claim-c",
  "explore-claim-c-then-git-rewrite",
  "explore-git-rewrite-then-claim-c",
  "explore-claim-c-then-authority-conflict",
  "explore-authority-conflict-then-claim-c"
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
    "scenarioTestSourceSha256" in manifest.provenance
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

const freshPriorityTrace = traces.find(
  ({ provenance }) =>
    provenance.traceKind === "sampled"
    && provenance.init === "init"
)
const responsibilityPriorityTrace = traces.find(
  ({ provenance }) =>
    provenance.traceKind === "sampled"
    && provenance.init === "initCapacityOneResponsibilityFirstProfile"
)
if (
  freshPriorityTrace === undefined
  || responsibilityPriorityTrace === undefined
) {
  throw new Error("capacity-one admission story traces are missing")
}
const dagHtml = renderObservedDagHtml(
  traces,
  freshPriorityTrace,
  responsibilityPriorityTrace
).replace(/[ \t]+$/gm, "")
await Promise.all([
  writeFile(resolve(packageRoot, "index.html"), dagHtml),
  writeFile(resolve(packageRoot, "artifacts", "observed-state-dag.html"), dagHtml)
])
process.stdout.write("generated observed-state-dag.html\n")
