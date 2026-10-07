import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { corpusManifestPath, deriveCorpusManifest, validateCorpusManifest } from "./mbt-corpus-contract.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

// This fixture copies one existing production replay; it never edits its owner.
const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(await readFile(new URL(`../${corpusManifestPath}`, import.meta.url), "utf8"))
validateCorpusManifest(manifest, await deriveCorpusManifest(root))
const owner = "packages/dalph/test/conformance/result-recovery-direction.mbt.test.ts"
const temporary = new URL("../packages/dalph/test/conformance/corpus-measurement.test.ts", import.meta.url)
const source = await readFile(new URL(`../${owner}`, import.meta.url), "utf8")
const syntax = ts.createSourceFile(owner, source, ts.ScriptTarget.Latest, true)
const selected = syntax.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(syntax) === "quintIt"
)
if (!selected) throw new Error("Representative production replay is missing")
const imports = 'import { quintIt } from "@firfi/quint-connect/vitest"'
if (!source.includes(imports)) throw new Error("Representative import contract changed")
const wrapper = `import { generateTraces, quintRunWithTraceGeneration, TraceGeneration } from "@firfi/quint-connect/effect"
import { Layer } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { corpusTraceGenerationLayer, loadCorpus } from "../../../../scripts/mbt-corpus-loader.mjs"
import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { vi } from "vitest"
import { corpusProvenanceDigest, digest, validateCorpus } from "../../../../scripts/mbt-corpus-contract.mjs"
const quintIt = (itEffect: typeof it.effect, name: string, opts: Parameters<typeof quintRunWithTraceGeneration>[0], timeout: number) => {
  itEffect(name, () => Effect.gen(function* () {
    const start = performance.now()
    const traces = yield* generateTraces(opts)
    const generated = performance.now()
    const bytes = JSON.stringify(traces)
    const manifest = JSON.parse(readFileSync(".scratch/mbt-fixture/manifest.json", "utf8"))
    const receipt = {version: 1, lane: "result-recovery-direction/1", provenanceSha256: corpusProvenanceDigest(manifest), corpusSha256: digest(bytes)}
    validateCorpus(receipt, Buffer.from(bytes), manifest, manifest, receipt.lane)
    const live = yield* quintRunWithTraceGeneration(opts).pipe(Effect.provide(Layer.succeed(TraceGeneration, { generate: () => Effect.succeed(traces) })))
    const corpus = yield* Effect.promise(() => loadCorpus(receipt.lane))
    assert.deepEqual(corpus.map(({vars,states}) => ({vars,states})), traces.map(({vars,states}) => ({vars,states})))
    let replayCalls = 0
    const corpusLayer = corpusTraceGenerationLayer(receipt.lane)
    const replay = Effect.gen(function* () {
      const service = yield* TraceGeneration
      return yield* quintRunWithTraceGeneration(opts).pipe(Effect.provide(Layer.succeed(TraceGeneration, { generate: (options) => {
        replayCalls++
        return service.generate(options)
      }})))
    }).pipe(Effect.provide(corpusLayer))
    const traps = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"].map((name) => vi.spyOn(childProcess, name).mockImplementation(() => { throw new Error("Replay attempted a generator/process") }))
    const fetchTrap = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Replay attempted network") })
    let result
    try {
      result = yield* replay
      for (const trap of traps) assert.equal(trap.mock.calls.length, 0)
      assert.equal(fetchTrap.mock.calls.length, 0)
    } finally {
      for (const trap of traps) trap.mockRestore()
      fetchTrap.mockRestore()
    }
    assert.deepEqual(result, live)
    assert.equal(replayCalls, 1)
    const replayed = performance.now()
    writeFileSync(".scratch/mbt-fixture/measurement.json", JSON.stringify({generationMilliseconds: generated-start, replayMilliseconds: replayed-generated, bytes: Buffer.byteLength(bytes), traces: traces.length, states: traces.reduce((sum, trace) => sum+trace.states.length,0), live, replayCalls, generatorCallsDuringReplay: 0, processCallsDuringReplay: 0, networkCallsDuringReplay: 0, result}, null, 2))
    writeFileSync(".scratch/mbt-fixture/traces.json", bytes)
  }), { timeout })
}`
await mkdir(new URL("../.scratch/mbt-fixture/", import.meta.url), { recursive: true })
await writeFile(new URL("../.scratch/mbt-fixture/manifest.json", import.meta.url), JSON.stringify(manifest))
// wx refuses a preexisting file; cleanup only follows this exact successful creation.
await writeFile(temporary, source.slice(0, selected.end).replace(imports, wrapper), { flag: "wx" })
try {
  await runBoundedCommand({
    name: "representative MBT corpus measurement",
    executable: "pnpm",
    args: [
      "exec",
      "vitest",
      "run",
      "--mode",
      "test",
      "packages/dalph/test/conformance/corpus-measurement.test.ts",
      "--maxWorkers=1"
    ],
    cwd: root,
    timeoutMilliseconds: 60000,
    relayParentSignals: true,
    environment: { ...process.env, QUINT_BIN: fileURLToPath(new URL("../node_modules/.bin/quint", import.meta.url)) }
  })
  console.log(await readFile(new URL("../.scratch/mbt-fixture/measurement.json", import.meta.url), "utf8"))
} finally {
  await unlink(temporary)
}
