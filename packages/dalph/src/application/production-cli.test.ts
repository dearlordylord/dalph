import { it } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import { RunId } from "@dalph/contracts"
import {
  ApplicationExitResult,
  AllocatedWorkflowRunId,
  currentSignalOf,
  deterministicOperationIdAllocatorLayer,
  fixtureReaderFileLayer,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  JournalPosition,
  ProductionRunSelection,
  RunTerminationDisposition,
  TraceAtCursor,
  TraceCursor,
  TraceOutput,
  TrackerGraphReader,
  WorkflowTrace,
  traceControlDispositionFacetVersion,
  traceReaderSchemaVersion
} from "@dalph/orchestrator"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Redacted, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  decodeRunInvocation,
  encodeProductionCliRecord,
  loadProductionConfiguration,
  presentSelectedProductionRun,
  ProductionCliConfigurationError,
  ProductionCliRecord,
  ProductionCliUsageError
} from "./production-cli.js"
import { runProductionCli } from "./live-cli.js"
import { makeDryRunTrackerGraphReaderLayer } from "./dry-run.js"

const runId = AllocatedWorkflowRunId.make(RunId.make("production-cli-run"))
const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})
const cursor = TraceCursor.make({ runId, position: JournalPosition.make(1) })
const snapshot = TraceAtCursor.make({
  cursor,
  derivedTaskOrder: { _tag: "DerivedTaskOrder", basis: "TaskIdCodeUnitAscending", taskIds: [] },
  facets: {
    controlDisposition: { cleanup: [], controls: [], dispositions: [], version: traceControlDispositionFacetVersion },
    integration: { facts: [] },
    recovery: { observationGaps: [], preservationDispositions: [], retainedResponsibilities: [] }
  },
  graph: null,
  items: [],
  relationships: {
    outsideAuthorityAcknowledgements: [],
    processLocalResourceSerializations: [],
    taskGraphEdges: [],
    workflowCausalEdges: []
  },
  version: traceReaderSchemaVersion
})

const validProductionDocument = {
  activationInterval: "1 minute",
  claimOwner: "dalph:production",
  codexClientName: "dalph",
  codexClientVersion: "0.0.0",
  codexExecutable: "/usr/local/bin/codex",
  codexProvider: "openai",
  codexStateDirectory: "/var/lib/dalph/codex",
  commonDirectory: "/srv/dalph/repository.git",
  evidenceStoreRoot: "/var/lib/dalph/evidence",
  failureCooldown: "5 seconds",
  integrationRef: "refs/heads/master",
  integratorCandidateWorktreeRoot: "/srv/dalph/integrator-candidates",
  integratorPrivateStore: "/var/lib/dalph/integrator-private.json",
  journalDatabase: "/var/lib/dalph/journal.sqlite",
  plannedAttemptBaseSha: "a".repeat(40),
  plannedAttemptExecutor: "codex:production",
  plannedAttemptWorktreeRoot: "/srv/dalph/planned-attempts",
  repository: "/srv/dalph/repository.git",
  taskWorkCapacity: 2
}

it.effect("keeps dry-run explicit and selects production only from --production", () =>
  Effect.gen(function* () {
    const dry = yield* decodeRunInvocation({
      config: undefined,
      dry: true,
      production: false,
      target: "packages/orchestrator/fixtures/empty.json"
    })
    expect(dry._tag).toBe("DryRun")

    const production = yield* decodeRunInvocation({
      config: "/tmp/dalph-production.json",
      dry: false,
      production: true,
      target: "github:octo/dalph#42"
    })
    expect(production._tag).toBe("Production")

    for (const modes of [
      { dry: false, production: false },
      { dry: true, production: true }
    ]) {
      const failure = yield* decodeRunInvocation({
        config: "/tmp/dalph-production.json",
        ...modes,
        target: "github:octo/dalph#42"
      }).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ProductionCliUsageError)
    }
  })
)

it.effect("the explicit dry mode keeps the controlled dry-run interpreter and never invokes the production host", () =>
  Effect.gen(function* () {
    const emitted = yield* Ref.make(0)
    const hostAcquisitions = yield* Ref.make(0)
    const application = runProductionCli(() =>
      Ref.update(hostAcquisitions, (count) => count + 1).pipe(
        Effect.andThen(Effect.die("dry mode reached the production host"))
      )
    )
    const target = new URL("../../../orchestrator/fixtures/empty.json", import.meta.url).pathname
    const layer = Layer.mergeAll(
      makeDryRunTrackerGraphReaderLayer(fixtureReaderFileLayer),
      Layer.succeed(TraceOutput, TraceOutput.of({ writeLine: () => Effect.void })),
      Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Ref.update(emitted, (count) => count + 1) })),
      deterministicOperationIdAllocatorLayer("production-cli-explicit-dry")
    ).pipe(Layer.provideMerge(NodeServices.layer))

    yield* application(["run", target, "--dry"]).pipe(Effect.provide(layer))

    expect(yield* Ref.get(hostAcquisitions)).toBe(0)
    expect(yield* Ref.get(emitted)).toBeGreaterThan(0)
  })
)

it.effect("maps invalid production input to a stable redacted configuration code", () =>
  Effect.gen(function* () {
    const credential = "production-cli-secret-needle"
    const failure = yield* loadProductionConfiguration("/tmp/dalph-production.json", target, () =>
      Effect.succeed(`{"unsafe":"${credential}"`)
    ).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: credential, GITHUB_TOKEN: credential })
        )
      ),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(ProductionCliConfigurationError)
    expect(failure.code).toBe("configuration.invalid")
    expect(JSON.stringify(failure)).not.toContain(credential)

    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const hostAcquisitions = yield* Ref.make(0)
    const application = runProductionCli(() => Ref.update(hostAcquisitions, (count) => count + 1))
    yield* application(["run", "github:octo/dalph#42", "--production", "--config", "/tmp/production.json"]).pipe(
      Effect.provide(liveCliLayer(lines, chronology, `{"unsafe":"${credential}"`)),
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: credential, GITHUB_TOKEN: credential })
        )
      ),
      Effect.flip
    )
    expect(yield* Ref.get(hostAcquisitions)).toBe(0)
    expect(yield* Ref.get(chronology)).toEqual(["configuration-read", "output:Failure"])
    expect(yield* Ref.get(lines)).toHaveLength(1)
    expect((yield* Ref.get(lines))[0]).not.toContain(credential)
    expect(JSON.parse((yield* Ref.get(lines))[0] ?? "{}").code).toBe("configuration.invalid")
  })
)

it.effect("rejects a schema-invalid configuration before invoking the production host", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const hostAcquisitions = yield* Ref.make(0)
    const application = runProductionCli(() => Ref.update(hostAcquisitions, (count) => count + 1))

    yield* application(["run", "github:octo/dalph#42", "--production", "--config", "/tmp/production.json"]).pipe(
      Effect.provide(liveCliLayer(lines, chronology, '{"repository":"/srv/dalph"}')),
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      ),
      Effect.flip
    )

    expect(yield* Ref.get(hostAcquisitions)).toBe(0)
    expect(yield* Ref.get(chronology)).toEqual(["configuration-read", "output:Failure"])
    expect(JSON.parse((yield* Ref.get(lines))[0] ?? "{}").code).toBe("configuration.invalid")
  })
)

it.effect("combines only documented credential inputs with the non-secret production document", () =>
  Effect.gen(function* () {
    const loaded = yield* loadProductionConfiguration("/tmp/dalph-production.json", target, () =>
      Effect.succeed('{"repository":"/srv/dalph"}')
    ).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      )
    )

    expect(loaded).toMatchObject({ repository: "/srv/dalph", target: { _tag: "GithubIssue" } })
    expect(Redacted.value(loaded.githubToken)).toBe("github-secret")
    expect(Redacted.value(loaded.codexProviderCredential)).toBe("codex-secret")
  })
)

it.effect("rejects fixture targets and relative configuration paths before acquiring the production host", () =>
  Effect.gen(function* () {
    for (const input of [
      {
        config: "/tmp/dalph-production.json",
        dry: false,
        production: true,
        target: "packages/orchestrator/fixtures/empty.json"
      },
      { config: "relative-production.json", dry: false, production: true, target: "github:octo/dalph#42" }
    ]) {
      const failure = yield* decodeRunInvocation(input).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ProductionCliUsageError)
    }

    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const hostAcquisitions = yield* Ref.make(0)
    const application = runProductionCli(() =>
      Ref.update(hostAcquisitions, (count) => count + 1).pipe(
        Effect.andThen(Effect.die("invalid production input reached the host"))
      )
    )
    for (const args of [
      ["run", "packages/orchestrator/fixtures/empty.json", "--production", "--config", "/tmp/production.json"],
      ["run", "github:octo/dalph#42", "--production", "--config", "relative.json"]
    ]) {
      yield* application(args).pipe(
        Effect.provide(liveCliLayer(lines, chronology)),
        Effect.provide(NodeServices.layer),
        Effect.flip
      )
    }

    expect(yield* Ref.get(hostAcquisitions)).toBe(0)
    expect(yield* Ref.get(chronology)).toEqual(["output:Failure", "output:Failure"])
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line).code)).toEqual(["usage.invalid", "usage.invalid"])
  })
)

it.effect("cold public production command reports one allocated Run after its beginning and before status", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const hostEntries = yield* Ref.make(0)
    yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) => Ref.update(lines, (current) => [...current, line]),
      Ref.update(hostEntries, (count) => count + 1)
    )

    expect(yield* Ref.get(hostEntries)).toBe(1)
    const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(records.map(({ _tag }) => _tag)).toEqual(["RunSelected", "HistoricalSnapshot"])
    expect(records[0]).toEqual({ _tag: "RunSelected", runId, selection: "Allocated", version: 1 })
  })
)

it.effect("production presentation reports the host's exact recovered Run without allocating a replacement", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        selection: ProductionRunSelection.cases.Recovered.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) => Ref.update(lines, (current) => [...current, line])
    )

    expect(JSON.parse((yield* Ref.get(lines))[0] ?? "{}")).toEqual({
      _tag: "RunSelected",
      runId,
      selection: "Recovered",
      version: 1
    })
  })
)

it("each HistoricalSnapshot contains exactly one whole canonical TraceAtCursor and current status/disposition remain separate", () => {
  const records = [
    ProductionCliRecord.cases.HistoricalSnapshot.make({ snapshot, version: 1 }),
    ProductionCliRecord.cases.RunDisposition.make({
      disposition: RunTerminationDisposition.make("Completed"),
      runId,
      version: 1
    }),
    ProductionCliRecord.cases.ApplicationExitDisposition.make({
      disposition: ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }),
      runId,
      version: 1
    })
  ]
  const encoded = records.map(encodeProductionCliRecord).map((line) => JSON.parse(line))

  expect(encoded[0]).toEqual({
    _tag: "HistoricalSnapshot",
    snapshot: Schema.encodeUnknownSync(TraceAtCursor)(snapshot),
    version: 1
  })
  expect(encoded[0]).not.toHaveProperty("current")
  expect(encoded[0]).not.toHaveProperty("disposition")
  expect(encoded.slice(1).map(({ _tag }) => _tag)).toEqual(["RunDisposition", "ApplicationExitDisposition"])
})

const liveCliLayer = (
  lines: Ref.Ref<ReadonlyArray<string>>,
  chronology: Ref.Ref<ReadonlyArray<string>>,
  configuration = JSON.stringify(validProductionDocument)
) =>
  Layer.mergeAll(
    Layer.succeed(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        readFileString: () =>
          Ref.update(chronology, (current) => [...current, "configuration-read"]).pipe(Effect.as(configuration))
      })
    ),
    Layer.succeed(
      TraceOutput,
      TraceOutput.of({
        writeLine: (line) =>
          Ref.update(chronology, (current) => [...current, `output:${JSON.parse(line)._tag}`]).pipe(
            Effect.andThen(Ref.update(lines, (current) => [...current, line]))
          )
      })
    ),
    Layer.mock(TrackerGraphReader, {}),
    Layer.mock(WorkflowTrace, {}),
    deterministicOperationIdAllocatorLayer("production-cli-test")
  )

it.effect("invokes one production host only after configuration and reports its acknowledged selection", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const hostInputs = yield* Ref.make<ReadonlyArray<unknown>>([])
    const application = runProductionCli((input, use) =>
      Ref.update(chronology, (current) => [...current, "host-acquired", "beginning-acknowledged"]).pipe(
        Effect.andThen(Ref.update(hostInputs, (current) => [...current, input])),
        Effect.andThen(
          use({
            acceptedHistory: currentSignalOf(cursor),
            selection: ProductionRunSelection.cases.Allocated.make({ runId }),
            traceReader: { readAt: () => Effect.succeed(snapshot) }
          })
        )
      )
    )

    yield* application(["run", "github:octo/dalph#42", "--production", "--config", "/tmp/production.json"]).pipe(
      Effect.provide(liveCliLayer(lines, chronology)),
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      )
    )

    expect(yield* Ref.get(chronology)).toEqual([
      "configuration-read",
      "host-acquired",
      "beginning-acknowledged",
      "output:RunSelected",
      "output:HistoricalSnapshot"
    ])
    expect(yield* Ref.get(hostInputs)).toHaveLength(1)
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual(["RunSelected", "HistoricalSnapshot"])
  })
)

it.effect("production help names required configuration credentials recovery and live consequences", () =>
  Effect.gen(function* () {
    const output: Array<string> = []
    const testConsole: Console.Console = Object.assign(Object.create(console), {
      error: (...args: ReadonlyArray<unknown>) => output.push(args.map(String).join(" ")),
      log: (...args: ReadonlyArray<unknown>) => output.push(args.map(String).join(" "))
    })
    const application = runProductionCli(() => Effect.die("help must not acquire the production host"))

    yield* application(["run", "--help"]).pipe(
      Effect.provide(Layer.succeed(Console.Console, testConsole)),
      Effect.provide(Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({}))),
      Effect.provide(Layer.mock(TraceOutput, {})),
      Effect.provide(Layer.mock(TrackerGraphReader, {})),
      Effect.provide(Layer.mock(WorkflowTrace, {})),
      Effect.provide(deterministicOperationIdAllocatorLayer("production-cli-help")),
      Effect.provide(NodeServices.layer)
    )

    const help = output.join("\n")
    expect(help).toContain("GITHUB_TOKEN")
    expect(help).toContain("DALPH_CODEX_PROVIDER_CREDENTIAL")
    expect(help).toContain("recover one unfinished Run")
    expect(help).toContain("state-changing")
    expect(help).not.toContain("codex-secret")
  })
)
