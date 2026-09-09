import { it } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import { RunId, TaskId } from "@dalph/contracts"
import {
  ApplicationExitResult,
  AllocatedWorkflowRunId,
  CoordinatorLockHeld,
  CoordinatorLockObservationContradiction,
  CoordinatorLockUnavailable,
  CoordinatorOwnershipLost,
  currentSignalFromCurrentFirstStream,
  currentSignalOf,
  type CurrentDeliveryStatus,
  DeliveryStatusProjectionConflict,
  DeliveryStatusRunIdentityUnavailable,
  DeliveryStatusRunMismatch,
  deterministicOperationIdAllocatorLayer,
  fixtureReaderFileLayer,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  GitCommonDirectoryLocator,
  GitCommonDirectoryTarget,
  JournalPosition,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  JournalSchemaIncompatible,
  JournalSchemaVersion,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  OperationId,
  ProductionRunSelection,
  ProductionRunSelectionConflict,
  RunTerminationDisposition,
  StartupRecoveryBlocked,
  TraceAtCursor,
  TraceCausalPredecessorContradiction,
  TraceCausalPredecessorMissing,
  TraceCausalPredecessorNotProjected,
  TraceCursor,
  TraceCursorNotCommitted,
  TraceJournalPrefixInvalid,
  TraceProjectionInvalid,
  TraceOutput,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  TrackerRevision,
  WorkflowTrace,
  traceControlDispositionFacetVersion,
  traceReaderSchemaVersion
} from "@dalph/orchestrator"
import {
  ConfigProvider,
  Console,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Stream
} from "effect"
import { expect } from "vitest"
import {
  applicationExitDispositionRecord,
  currentDeliveryStatusRecord,
  decodeRunInvocation,
  decodeProductionConfigurationLocator,
  encodeProductionCliRecord,
  knownProductionCliFailure,
  loadProductionConfiguration,
  presentSelectedProductionRun,
  ProductionConfigurationLocator,
  ProductionCliConfigurationError,
  ProductionCliRecord,
  ProductionCliUsageError
} from "./production-cli.js"
import { decodeCliTarget, executeDryRun } from "./cli.js"
import { productionCliHostObservationOf, runProductionCli } from "./live-cli.js"
import type { ProductionHostObservation } from "./production-host.js"
import { makeDryRunTrackerGraphReaderLayer } from "./dry-run.js"
import { ProductionRepositoryHostConfiguration } from "./production-configuration.js"

const runId = AllocatedWorkflowRunId.make(RunId.make("production-cli-run"))
const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(42),
  owner: GithubRepositoryOwner.make("octo"),
  repository: GithubRepositoryName.make("dalph")
})
const configurationLocator = ProductionConfigurationLocator.make("/tmp/dalph-production.json")
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

const completedRunTermination = (terminatedAt = cursor) => {
  const termination = { disposition: RunTerminationDisposition.make("Completed"), terminatedAt }
  return { await: Effect.succeed(termination), poll: Effect.succeed(Option.some(termination)) }
}

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

it.effect("rejects every incomplete or malformed command selection before acquiring a production host", () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<{ readonly args: ReadonlyArray<string>; readonly detail: string }> = [
      { args: ["run", "github:octo/dalph#42"], detail: "exactly one of --dry or --production is required" },
      {
        args: ["run", "github:octo/dalph#42", "--dry", "--production", "--config", "/tmp/dalph-production.json"],
        detail: "exactly one of --dry or --production is required"
      },
      {
        args: ["run", "packages/orchestrator/fixtures/empty.json", "--dry", "--config", "/tmp/dalph-production.json"],
        detail: "--config is available only with --production"
      },
      {
        args: ["run", "github:octo/dalph#42", "--production"],
        detail: "--production requires --config <absolute-json-path>"
      },
      {
        args: ["run", "github:octo/dalph/not-an-issue", "--production", "--config", "/tmp/dalph-production.json"],
        detail: "the target is invalid for the selected command mode"
      },
      { args: ["run", "", "--dry"], detail: "the target is invalid for the selected command mode" }
    ]

    for (const testCase of cases) {
      const lines = yield* Ref.make<ReadonlyArray<string>>([])
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])
      const hostAcquisitions = yield* Ref.make(0)
      const application = runProductionCli(() => Ref.update(hostAcquisitions, (count) => count + 1))
      const failure = yield* application(testCase.args).pipe(
        Effect.provide(liveCliLayer(lines, chronology)),
        Effect.provide(NodeServices.layer),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(ProductionCliUsageError)
      expect(yield* Ref.get(hostAcquisitions)).toBe(0)
      expect(yield* Ref.get(chronology)).toEqual(["output:Failure"])
      expect((yield* Ref.get(lines)).map((line) => JSON.parse(line))).toEqual([
        { _tag: "Failure", code: "usage.invalid", detail: testCase.detail, subject: "dalph run", version: 1 }
      ])
    }

    // Keep the decoder assertion beside the public command proof so the
    // malformed fixture-locator boundary remains independently diagnosed.
    const fixtureFailure = yield* decodeCliTarget("").pipe(Effect.flip)
    expect(fixtureFailure._tag).toBe("Cli.CliUsageError")
  })
)

it.effect("brands only normalized absolute production configuration locators at the command boundary", () =>
  Effect.gen(function* () {
    const locator = yield* decodeProductionConfigurationLocator("/tmp/dalph-production.json")
    expect(locator).toBe("/tmp/dalph-production.json")
    expect(Schema.is(ProductionConfigurationLocator)(locator)).toBe(true)

    for (const invalid of ["relative.json", "/tmp/../tmp/dalph-production.json"]) {
      const failure = yield* decodeProductionConfigurationLocator(invalid).pipe(Effect.flip)
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
    const failure = yield* loadProductionConfiguration(configurationLocator, target, () =>
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

it.effect("redacts every configuration read, document, and credential failure", () =>
  Effect.gen(function* () {
    const cases = [
      {
        expectedSubject: "production configuration file",
        provider: ConfigProvider.fromUnknown({
          DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
          GITHUB_TOKEN: "github-secret"
        }),
        readFile: () => Effect.fail("private read failure")
      },
      {
        expectedSubject: "production configuration file",
        provider: ConfigProvider.fromUnknown({
          DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
          GITHUB_TOKEN: "github-secret"
        }),
        readFile: () => Effect.succeed("[]")
      },
      {
        expectedSubject: "GITHUB_TOKEN",
        provider: ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret" }),
        readFile: () => Effect.succeed(JSON.stringify(validProductionDocument))
      },
      {
        expectedSubject: "DALPH_CODEX_PROVIDER_CREDENTIAL",
        provider: ConfigProvider.fromUnknown({ GITHUB_TOKEN: "github-secret" }),
        readFile: () => Effect.succeed(JSON.stringify(validProductionDocument))
      }
    ] as const

    for (const testCase of cases) {
      const failure = yield* loadProductionConfiguration(configurationLocator, target, testCase.readFile).pipe(
        Effect.provide(ConfigProvider.layer(testCase.provider)),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(ProductionCliConfigurationError)
      expect(failure.subject).toBe(testCase.expectedSubject)
      expect(JSON.stringify(failure)).not.toContain("secret")
      expect(JSON.stringify(failure)).not.toContain("private read failure")
    }
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

it.effect("maps a startup ownership conflict to one stable redacted public code", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const failure = new CoordinatorLockHeld({
      gitCommonDirectory: GitCommonDirectoryLocator.make("/srv/dalph/repository.git")
    })
    const application = runProductionCli(() => Effect.fail(failure))

    const observed = yield* application([
      "run",
      "github:octo/dalph#42",
      "--production",
      "--config",
      "/tmp/production.json"
    ]).pipe(
      Effect.provide(liveCliLayer(lines, chronology)),
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      ),
      Effect.flip
    )

    expect(observed).toBe(failure)
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line))).toEqual([
      {
        _tag: "Failure",
        code: "startup.ownership_conflict",
        detail: "another coordinator already owns the production repository",
        subject: "production repository",
        version: 1
      }
    ])
  })
)

it("maps every typed startup boundary failure without retaining private diagnostic fields", () => {
  const privateLocator = "/private/alice/repository.git"
  const privateDetail = "EACCES for alice@example.test"
  const failures = [
    new CoordinatorLockUnavailable({
      detail: privateDetail,
      operation: "CoordinatorLock.acquire",
      target: GitCommonDirectoryTarget.make(privateLocator)
    }),
    new StartupRecoveryBlocked({ issues: [] }),
    new ProductionRunSelectionConflict({ conflicts: [{ runId, target }], requestedTarget: target })
  ]

  const records = failures.map(knownProductionCliFailure)
  expect(records.map((failure) => failure?.code)).toEqual([
    "startup.ownership_unavailable",
    "startup.recovery_blocked",
    "startup.run_selection_conflict"
  ])
  expect(JSON.stringify(records)).not.toContain(privateLocator)
  expect(JSON.stringify(records)).not.toContain(privateDetail)
})

it("maps every Journal storage failure through one exhaustive redacted public algebra", () => {
  const privateDetail = "sqlite /private/alice/journal.sqlite token=secret"
  const failures = [
    new JournalDataCorruption({ detail: privateDetail, operation: "JournalStore.read" }),
    new JournalHistoryCorruption({ detail: privateDetail, operation: "JournalStore.read", partition: "Hot", runId }),
    new JournalSchemaIncompatible({ found: JournalSchemaVersion.make(2), supported: JournalSchemaVersion.make(1) }),
    new JournalStorageAccessDenied({ detail: privateDetail, operation: "JournalStore.open" }),
    new JournalStorageCapacityExhausted({ detail: privateDetail, operation: "JournalStore.append" }),
    new JournalStorageLocked({ detail: privateDetail, operation: "JournalStore.open" }),
    new JournalStorageUnavailable({ detail: privateDetail, operation: "JournalStore.read" }),
    new JournalPartitionContradiction({ runId })
  ]

  const records = failures.map(knownProductionCliFailure)
  expect(records.map((failure) => failure?.code)).toEqual([
    "journal.data_corruption",
    "journal.history_corruption",
    "journal.schema_incompatible",
    "journal.storage_access_denied",
    "journal.storage_capacity_exhausted",
    "journal.storage_locked",
    "journal.storage_unavailable",
    "journal.partition_contradiction"
  ])
  expect(
    records.map((failure) => (failure !== undefined && "subject" in failure ? failure.subject : undefined))
  ).toEqual(Array.from({ length: failures.length }, () => "production Journal"))
  expect(JSON.stringify(records)).not.toContain(privateDetail)
  expect(JSON.stringify(records)).not.toContain("/private/alice/journal.sqlite")
})

it("maps every causal trace failure to the selected Run without retaining causal identities", () => {
  const predecessorOperationId = OperationId.make("private-predecessor-operation")
  const successorOperationId = OperationId.make("private-successor-operation")
  const failures = [
    new TraceCausalPredecessorContradiction({
      predecessorOperationId,
      reason: "NotEarlier",
      runId,
      successorOperationId
    }),
    new TraceCausalPredecessorMissing({ predecessorOperationId, runId, successorOperationId }),
    new TraceCausalPredecessorNotProjected({ predecessorOperationId, runId, successorOperationId }),
    new TraceJournalPrefixInvalid({ issues: [], runId }),
    new TraceCursorNotCommitted({ cursor })
  ]

  const records = failures.map(knownProductionCliFailure)
  expect(records.map((failure) => failure?.code)).toEqual(
    Array.from({ length: failures.length }, () => "status.projection_invalid")
  )
  expect(records.map((failure) => failure !== undefined && "subject" in failure && failure.subject)).toEqual(
    Array.from({ length: failures.length }, () => runId)
  )
  expect(JSON.stringify(records)).not.toContain(predecessorOperationId)
  expect(JSON.stringify(records)).not.toContain(successorOperationId)
})

it("maps each passive status projection failure to a stable redacted status code", () => {
  const requestedRunId = RunId.make("requested-status-run")
  const privateDetail = "private status evidence /tmp/alice token=secret"
  const subject = { _tag: "Task" as const, runId: requestedRunId, taskId: TaskId.make("status-task") }
  const failures = [
    new DeliveryStatusRunMismatch({ expectedRunId: runId, requestedRunId }),
    new DeliveryStatusRunIdentityUnavailable({ subject }),
    Schema.decodeUnknownSync(DeliveryStatusProjectionConflict)({
      _tag: "DeliveryStatusProjectionConflict",
      detail: privateDetail,
      entryIdentity: "private-entry",
      subject
    })
  ]

  const mapped = failures.map(knownProductionCliFailure)
  expect(mapped.map((failure) => failure?.code)).toEqual([
    "status.run_mismatch",
    "status.run_identity_unavailable",
    "status.projection_conflict"
  ])
  expect(mapped.map((failure) => failure !== undefined && "subject" in failure && failure.subject)).toEqual([
    requestedRunId,
    requestedRunId,
    requestedRunId
  ])
  expect(JSON.stringify(mapped)).not.toContain(privateDetail)
  expect(JSON.stringify(mapped)).not.toContain("private-entry")
  expect(mapped.map((failure) => knownProductionCliFailure(failure)?.code)).toEqual(
    mapped.map((failure) => failure?.code)
  )
})

it("leaves an unknown defect outside the public Failure algebra", () => {
  const defect = new Error("private Cause.pretty detail /private/alice/journal.sqlite token=secret")

  expect(knownProductionCliFailure(defect)).toBeUndefined()
})

it.effect("does not misreport an unknown production-host failure as a public known failure", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const defect = new Error("private host failure")
    const application = runProductionCli(() => Effect.fail(defect))

    const observed = yield* application([
      "run",
      "github:octo/dalph#42",
      "--production",
      "--config",
      "/tmp/production.json"
    ]).pipe(
      Effect.provide(liveCliLayer(lines, chronology)),
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      ),
      Effect.flip
    )

    expect(observed).toBe(defect)
    expect(yield* Ref.get(lines)).toEqual([])
  })
)

it.effect("preserves a non-credential tracker read failure from an explicit GitHub dry run", () =>
  Effect.gen(function* () {
    const failure = new TrackerAdapterReadError({
      context: TrackerAdapterReadContext.cases.Github.make({ operation: "GithubTrackerGraphReader.readIssue" }),
      detail: "the tracker response was unavailable",
      reason: TrackerAdapterReadFailureReason.cases.Transport.make({})
    })
    const reader = Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: () => Effect.fail(failure),
        readTaskWorkSpecification: () => Effect.die("the dry-run graph read must fail first")
      })
    )
    const observed = yield* executeDryRun(target).pipe(
      Effect.provide(reader),
      Effect.provide(deterministicOperationIdAllocatorLayer("production-cli-generic-read-failure")),
      Effect.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))),
      Effect.flip
    )

    expect(observed).toBe(failure)
  })
)

it.effect("startup Journal and ownership failures each emit one stable redacted Failure record", () =>
  Effect.gen(function* () {
    const privateLocator = "/private/alice/repository.git"
    const privateDetail = "sqlite /private/alice/journal.sqlite token=secret"
    const cases = [
      {
        code: "journal.storage_unavailable",
        detail: "the production Journal is unavailable",
        failure: new JournalStorageUnavailable({ detail: privateDetail, operation: "JournalStore.open" }),
        subject: "production Journal"
      },
      {
        code: "startup.ownership_lost",
        detail: "coordinator ownership ended before the production operation completed",
        failure: new CoordinatorOwnershipLost({ gitCommonDirectory: GitCommonDirectoryLocator.make(privateLocator) }),
        subject: "production repository"
      },
      {
        code: "startup.ownership_contradiction",
        detail: "coordinator ownership no longer matches the production repository",
        failure: new CoordinatorLockObservationContradiction({
          gitCommonDirectory: GitCommonDirectoryLocator.make(privateLocator)
        }),
        subject: "production repository"
      }
    ] as const

    for (const testCase of cases) {
      const lines = yield* Ref.make<ReadonlyArray<string>>([])
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])
      const application = runProductionCli(() => Effect.fail(testCase.failure))

      yield* application(["run", "github:octo/dalph#42", "--production", "--config", "/tmp/production.json"]).pipe(
        Effect.provide(liveCliLayer(lines, chronology)),
        Effect.provide(NodeServices.layer),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
              GITHUB_TOKEN: "github-secret"
            })
          )
        ),
        Effect.flip
      )

      const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
      expect(records).toEqual([
        { _tag: "Failure", code: testCase.code, detail: testCase.detail, subject: testCase.subject, version: 1 }
      ])
      expect(JSON.stringify(records)).not.toContain(privateLocator)
      expect(JSON.stringify(records)).not.toContain(privateDetail)
    }
  })
)

it.effect("a TraceReader Journal failure emits one stable redacted Failure after selection", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const chronology = yield* Ref.make<ReadonlyArray<string>>([])
    const privateDetail = "sqlite /private/alice/journal.sqlite token=secret"
    const failure = new JournalStorageUnavailable({ detail: privateDetail, operation: "JournalStore.read" })
    const application = runProductionCli((_input, use) =>
      use({
        acceptedHistory: currentSignalOf(cursor),
        current: currentSignalOf({ _tag: "NotReady" as const }),
        runTermination: completedRunTermination(),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.fail(failure) }
      })
    )

    yield* application(["run", "github:octo/dalph#42", "--production", "--config", "/tmp/production.json"]).pipe(
      Effect.provide(liveCliLayer(lines, chronology)),
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      ),
      Effect.flip
    )

    const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(records.filter(({ _tag }) => _tag === "Failure")).toEqual([
      {
        _tag: "Failure",
        code: "journal.storage_unavailable",
        detail: "the production Journal is unavailable",
        subject: "production Journal",
        version: 1
      }
    ])
    expect(JSON.stringify(records)).not.toContain(privateDetail)
    expect(JSON.stringify(records)).not.toContain("/private/alice/journal.sqlite")
  })
)

it.effect(
  "typed status or TraceAtCursor projection failure fails fast without calling ApplicationExitRequestBoundary.requestExit or mutating a workflow boundary",
  () =>
    Effect.gen(function* () {
      const lines = yield* Ref.make<ReadonlyArray<string>>([])
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])
      const exitRequests = yield* Ref.make(0)
      const failure = new TraceProjectionInvalid({ detail: "private projection detail", runId })
      const application = runProductionCli((_input, use) => {
        const observation: ProductionHostObservation = {
          acceptedHistory: currentSignalOf(cursor),
          applicationExitRequestBoundary: {
            requestExit: Ref.update(exitRequests, (count) => count + 1).pipe(
              Effect.as(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
            )
          },
          current: currentSignalOf({ _tag: "NotReady" as const }),
          runTermination: completedRunTermination(),
          selection: ProductionRunSelection.cases.Allocated.make({ runId }),
          traceReader: { readAt: () => Effect.fail(failure) }
        }
        return use(observation)
      })

      const observed = yield* application([
        "run",
        "github:octo/dalph#42",
        "--production",
        "--config",
        "/tmp/production.json"
      ]).pipe(
        Effect.provide(liveCliLayer(lines, chronology)),
        Effect.provide(NodeServices.layer),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
              GITHUB_TOKEN: "github-secret"
            })
          )
        ),
        Effect.flip
      )

      expect(observed).toBe(failure)
      expect(yield* Ref.get(exitRequests)).toBe(0)
      expect((yield* Ref.get(lines)).map((line) => JSON.parse(line))).toEqual([
        { _tag: "RunSelected", runId, selection: "Allocated", version: 1 },
        {
          _tag: "CurrentStatus",
          status: { _tag: "DeliveryStatusNotReady", subject: { _tag: "Run", runId } },
          version: 1
        },
        {
          _tag: "Failure",
          code: "status.projection_invalid",
          detail: "the selected Run's historical projection is invalid",
          subject: runId,
          version: 1
        }
      ])
    })
)

it.effect("combines only documented credential inputs with the non-secret production document", () =>
  Effect.gen(function* () {
    const loaded = yield* loadProductionConfiguration(configurationLocator, target, () =>
      Effect.succeed(JSON.stringify(validProductionDocument))
    ).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret", GITHUB_TOKEN: "github-secret" })
        )
      )
    )

    expect(loaded).toMatchObject({ repository: "/srv/dalph/repository.git", target: { _tag: "GithubIssue" } })
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
        current: currentSignalOf({ _tag: "NotReady" as const }),
        runTermination: completedRunTermination(),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) => Ref.update(lines, (current) => [...current, line]),
      Ref.update(hostEntries, (count) => count + 1)
    )

    expect(yield* Ref.get(hostEntries)).toBe(1)
    const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(records.map(({ _tag }) => _tag)).toEqual([
      "RunSelected",
      "CurrentStatus",
      "HistoricalSnapshot",
      "RunDisposition"
    ])
    expect(records[0]).toEqual({ _tag: "RunSelected", runId, selection: "Allocated", version: 1 })
  })
)

it.effect("normal Run termination closes an open history attachment after its final snapshot and returns", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalFromCurrentFirstStream(Stream.concat(Stream.make(cursor), Stream.never)),
        current: currentSignalOf({ _tag: "NotReady" as const }),
        runTermination: completedRunTermination(),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) => Ref.update(lines, (current) => [...current, line])
    )

    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "RunSelected",
      "CurrentStatus",
      "HistoricalSnapshot",
      "RunDisposition"
    ])
  })
)

it.effect("production presentation reports the host's exact recovered Run without allocating a replacement", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        current: currentSignalOf({ _tag: "NotReady" as const }),
        runTermination: completedRunTermination(),
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

it.effect("attaches current-first without missing a delivery publication racing with CLI attachment", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const current = currentSignalFromCurrentFirstStream(
      Stream.make({ _tag: "NotReady" as const }, { _tag: "Closed" as const, final: null })
    )

    yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        current,
        runTermination: completedRunTermination(),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) => Ref.update(lines, (current) => [...current, line])
    )

    const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(records.map(({ _tag }) => _tag)).toEqual([
      "RunSelected",
      "CurrentStatus",
      "CurrentStatus",
      "HistoricalSnapshot",
      "RunDisposition"
    ])
    expect(records[1]?.status._tag).toBe("DeliveryStatusNotReady")
    expect(records[2]?.status).toEqual({ _tag: "DeliveryStatusClosed", final: null, subject: { _tag: "Run", runId } })
  })
)

it.effect("renders not-ready and waits without invoking a workflow boundary", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const statusWritten = yield* Deferred.make<void>()
    const termination = yield* Deferred.make<{
      readonly disposition: RunTerminationDisposition
      readonly terminatedAt: TraceCursor
    }>()
    const runTermination = { await: Deferred.await(termination), poll: Effect.succeed(Option.none()) }
    const presentation = yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        current: currentSignalOf({ _tag: "NotReady" as const }),
        runTermination,
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) =>
        Ref.update(lines, (current) => [...current, line]).pipe(
          Effect.andThen(
            JSON.parse(line)._tag === "CurrentStatus" ? Deferred.succeed(statusWritten, undefined) : Effect.void
          )
        )
    ).pipe(Effect.forkChild)

    yield* Deferred.await(statusWritten)
    const beforeTermination = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(beforeTermination.some(({ _tag }) => _tag === "RunDisposition")).toBe(false)
    expect(beforeTermination.find(({ _tag }) => _tag === "CurrentStatus")?.status).toEqual({
      _tag: "DeliveryStatusNotReady",
      subject: { _tag: "Run", runId }
    })

    yield* Deferred.succeed(termination, {
      disposition: RunTerminationDisposition.make("Completed"),
      terminatedAt: cursor
    })
    yield* Fiber.join(presentation)
  })
)

it.effect("closed status without a final value cannot report Run completion", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const closedWritten = yield* Deferred.make<void>()
    const runTermination = { await: Effect.never, poll: Effect.succeed(Option.none()) }
    const presentation = yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        current: currentSignalOf({ _tag: "Closed" as const, final: null }),
        runTermination,
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) =>
        Ref.update(lines, (current) => [...current, line]).pipe(
          Effect.andThen(
            JSON.parse(line)._tag === "CurrentStatus" ? Deferred.succeed(closedWritten, undefined) : Effect.void
          )
        )
    ).pipe(Effect.forkChild)

    yield* Deferred.await(closedWritten)
    const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(records.find(({ _tag }) => _tag === "CurrentStatus")?.status).toEqual({
      _tag: "DeliveryStatusClosed",
      final: null,
      subject: { _tag: "Run", runId }
    })
    expect(records.some(({ _tag }) => _tag === "RunDisposition")).toBe(false)
    yield* Fiber.interrupt(presentation)
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
    }),
    applicationExitDispositionRecord(runId, ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
  ]
  const encoded = records.map(encodeProductionCliRecord).map((line) => JSON.parse(line))

  expect(encoded[0]).toEqual({
    _tag: "HistoricalSnapshot",
    snapshot: Schema.encodeUnknownSync(TraceAtCursor)(snapshot),
    version: 1
  })
  expect(encoded[0]).not.toHaveProperty("current")
  expect(encoded[0]).not.toHaveProperty("disposition")
  expect(encoded.slice(1).map(({ _tag }) => _tag)).toEqual([
    "RunDisposition",
    "ApplicationExitDisposition",
    "ApplicationExitDisposition"
  ])
})

it("encodes the exact passive not-ready value as a separate current-status record", () => {
  const status: CurrentDeliveryStatus = { _tag: "DeliveryStatusNotReady", subject: { _tag: "Run", runId } }

  expect(JSON.parse(encodeProductionCliRecord(currentDeliveryStatusRecord(status)))).toEqual({
    _tag: "CurrentStatus",
    status,
    version: 1
  })
})

it("preserves current status subjects evidence classifications and structural order", () => {
  const taskA = { _tag: "Task" as const, runId, taskId: TaskId.make("A") }
  const taskB = { _tag: "Task" as const, runId, taskId: TaskId.make("B") }
  const trackerWait = (subject: typeof taskA | typeof taskB) => ({
    _tag: "TrackerFactWait" as const,
    classification: "Waiting" as const,
    fact: { _tag: "Unobserved" as const, boundary: "TaskTracker" as const },
    responsibility: null,
    standing: { _tag: "GraphNotEstablished" as const },
    subject,
    wakeCondition: "TaskTrackerFactsObserved" as const
  })
  const available: CurrentDeliveryStatus = {
    _tag: "DeliveryStatusAvailable",
    acceptedAt: JournalPosition.make(9),
    entries: [trackerWait(taskB), trackerWait(taskA)],
    subject: { _tag: "Run", runId }
  }
  const absent: CurrentDeliveryStatus = {
    _tag: "TaskAbsentFromCurrentGraph",
    graphSource: {
      _tag: "EstablishedGraph",
      contentIdentity: TrackerRevision.make("graph-revision"),
      freshnessOperationId: OperationId.make("freshness-operation"),
      operationId: OperationId.make("graph-operation"),
      recordedAt: JournalPosition.make(8),
      revision: TrackerRevision.make("graph-revision")
    },
    subject: taskA
  }
  const closed: CurrentDeliveryStatus = {
    _tag: "DeliveryStatusClosed",
    final: available,
    subject: { _tag: "Run", runId }
  }

  for (const status of [available, absent, closed] as const) {
    const encoded = JSON.parse(encodeProductionCliRecord(currentDeliveryStatusRecord(status)))
    expect(encoded).toEqual({ _tag: "CurrentStatus", status, version: 1 })
  }
  expect(JSON.parse(encodeProductionCliRecord(currentDeliveryStatusRecord(available))).status.entries).toEqual([
    trackerWait(taskB),
    trackerWait(taskA)
  ])
})

it("production status rendering has no tracker Git executor Integrator Journal mutation admission retry cleanup control or Exit capability", () => {
  const observation: ProductionHostObservation = {
    acceptedHistory: currentSignalOf(cursor),
    applicationExitRequestBoundary: {
      requestExit: Effect.succeed(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
    },
    current: currentSignalOf({ _tag: "NotReady" }),
    runTermination: completedRunTermination(),
    selection: ProductionRunSelection.cases.Allocated.make({ runId }),
    traceReader: { readAt: () => Effect.succeed(snapshot) }
  }

  const presented = productionCliHostObservationOf(observation)
  expect(Object.keys(presented).toSorted()).toEqual([
    "acceptedHistory",
    "current",
    "runTermination",
    "selection",
    "traceReader"
  ])
  expect("applicationExitRequestBoundary" in presented).toBe(false)
})

it.effect("reports the selected Run when termination races with current-first status attachment", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    yield* presentSelectedProductionRun(
      {
        acceptedHistory: currentSignalOf(cursor),
        current: currentSignalOf({ _tag: "Closed" as const, final: null }),
        runTermination: completedRunTermination(),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        traceReader: { readAt: () => Effect.succeed(snapshot) }
      },
      (line) => Ref.update(lines, (current) => [...current, line])
    )

    const records = (yield* Ref.get(lines)).map((line) => JSON.parse(line))
    expect(records[0]).toEqual({ _tag: "RunSelected", runId, selection: "Allocated", version: 1 })
    expect(records.find(({ _tag }) => _tag === "CurrentStatus")?.status).toEqual({
      _tag: "DeliveryStatusClosed",
      final: null,
      subject: { _tag: "Run", runId }
    })
    expect(records.at(-1)).toEqual({ _tag: "RunDisposition", disposition: "Completed", runId, version: 1 })
  })
)

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
            current: currentSignalOf({ _tag: "NotReady" as const }),
            runTermination: completedRunTermination(),
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
      "output:CurrentStatus",
      "output:HistoricalSnapshot",
      "output:RunDisposition"
    ])
    expect(yield* Ref.get(hostInputs)).toHaveLength(1)
    expect(Schema.is(ProductionRepositoryHostConfiguration)((yield* Ref.get(hostInputs))[0])).toBe(true)
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "RunSelected",
      "CurrentStatus",
      "HistoricalSnapshot",
      "RunDisposition"
    ])
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

it("exports only the canonical production CLI seam and omits the unreleased historical alias", async () => {
  const publicApi = await import("../index.js")

  expect(publicApi).toHaveProperty("productionCliFromStdio")
  expect(publicApi).not.toHaveProperty("makeConfiguredProductionCliApplication")
})
