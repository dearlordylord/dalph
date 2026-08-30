import { NodeFileSystem } from "@effect/platform-node"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  CleanupMutationOrdinal,
  CoordinatorOwnership,
  GitCommonDirectoryLocator,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  type IntegratorCandidateCleanupEvidenceSubject,
  type IntegratorCandidateProviderAuthority,
  IntegratorCandidateResourceLocator,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  OperationId,
  CoordinatorOwnershipLost,
  GitCommandInvocationFailure,
  type GitCommandService
} from "@dalph/orchestrator"
import { Effect, FileSystem, Option, Ref, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  CodexOwnedTurnToken,
  CodexServerIncarnation,
  CodexThreadId,
  CodexThreadOwnershipToken,
  CodexTurnId
} from "./codex-attempt-store.js"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  CodexThreadWorkingDirectory,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexIntegratorConfiguration,
  CodexIntegratorPrivateRecord,
  CodexIntegratorPrivateRun,
  type CodexIntegratorPrivateStoreService,
  candidateWorktreePathFor,
  IntegratorCandidateWorktreePath,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  revision
} from "./codex-integrator-private-store.js"
import { providerAuthorityFor } from "./codex-integrator-cleanup.js"

const head = GitCommitSha.make("a".repeat(40))
const acceptedCommit = GitCommitSha.make("b".repeat(40))

const sessionFor = (id: string, resource: string, lineage = 3): IntegratorSessionCorrelation =>
  IntegratorSessionCorrelation.make({
    acceptedResult: AcceptedResult.make({
      commit: acceptedCommit,
      evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
    }),
    candidateResource: IntegratorCandidateResourceLocator.make(resource),
    expectedTargetHead: head,
    integrationTarget: IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/tmp/cleanup-boundary.git"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    }),
    plannedAttempt: PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`${id}-attempt`),
      baseSha: head,
      branch: TaskBranchRef.make(`refs/heads/${id}`),
      executor: TaskExecutorLocator.make(`${id}-executor`),
      runId: RunId.make(`${id}-run`),
      taskId: TaskId.make(`${id}-task`),
      taskRevision: TaskRevision.make(`${id}-revision`),
      worktree: WorktreeLocator.make(`/tmp/${id}-planned`)
    }),
    queuedAt: JournalPosition.make(1),
    sessionId: IntegratorSessionId.make(`${id}-session`),
    startedAt: JournalPosition.make(2),
    targetLineageObservedAt: JournalPosition.make(lineage)
  })

const predecessor = sessionFor("predecessor", "candidate:cleanup-predecessor")
const successor = IntegratorSessionCorrelation.make({
  ...predecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:cleanup-successor"),
  sessionId: IntegratorSessionId.make("successor-session"),
  targetLineageObservedAt: JournalPosition.make(7)
})
const authorizationFor = (
  locator: IntegratorCandidateResourceLocator = predecessor.candidateResource,
  evidenceRevision = 1
) =>
  IntegratorCandidateCleanupAuthorization.make({
    causalPredecessors: [OperationId.make("cleanup-predecessor")],
    disposition: IntegratorCandidateCleanupDisposition.make({
      directionAppliedAt: JournalPosition.make(6),
      dispositionAt: JournalPosition.make(5),
      predecessor,
      successor
    }),
    evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(evidenceRevision),
    locator,
    observationAt: JournalPosition.make(4),
    observationOperationId: OperationId.make("cleanup-observation"),
    operationId: OperationId.make("cleanup-operation"),
    owner: IntegratorCandidateCleanupOwner.make({ sessionId: predecessor.sessionId }),
    writerQuiescent: true
  })

type Registration = "exact" | "none" | "foreign"
type CleanupCase = {
  readonly record?: CodexIntegratorPrivateRecord | null
  readonly occupied?: CodexIntegratorPrivateRecord
  readonly registration?: Registration
  readonly pathExists?: boolean
  readonly projection?: CodexOwnedActivityCensusProjection
  readonly projectionSequence?: ReadonlyArray<CodexOwnedActivityCensusProjection>
  readonly threadTokenMode?: "exact" | "tokenless" | "foreign"
  readonly terminalTurnMode?:
    | "exact"
    | "tokenless"
    | "foreign"
    | "active"
    | "inProgress"
    | "failed"
    | "interrupted"
    | "missing"
    | "wrongId"
    | "correlation"
  readonly worktreeMaterializationIntent?: boolean
  readonly appFailure?: boolean
  readonly backgroundFailure?: boolean
  readonly censusFailure?: boolean
  readonly ownershipFailure?: boolean
  readonly removeExitCode?: number
  readonly removeStderr?: string
  readonly applyRemoval?: boolean
  readonly registrationAfterRemoval?: Registration
  readonly readSequence?: ReadonlyArray<CodexIntegratorPrivateRecord | null>
}

const runCase = <A>(
  options: CleanupCase,
  operation: (
    authority: IntegratorCandidateProviderAuthority["Service"],
    authorization: IntegratorCandidateCleanupAuthorization
  ) => Effect.Effect<A>
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-cleanup-boundary-" })
        const config = CodexIntegratorConfiguration.make({
          candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(`${root}/candidates`),
          commonDirectory: GitCommonDirectoryLocator.make(`${root}/repository.git`),
          privateStoreLocator: IntegratorPrivateStoreLocator.make(`${root}/private.json`),
          repository: GitRepositoryLocator.make(`${root}/repository.git`)
        })
        const candidatePath = candidateWorktreePathFor(config, predecessor.candidateResource)
        if (options.pathExists === true) yield* fileSystem.makeDirectory(candidatePath, { recursive: true })
        const initialRecord =
          options.record === undefined || options.record === null
            ? null
            : options.record.candidatePath.endsWith("/foreign-record")
              ? options.record
              : Schema.decodeUnknownSync(CodexIntegratorPrivateRecord)({ ...options.record, candidatePath })
        const current = yield* Ref.make<CodexIntegratorPrivateRecord | null>(initialRecord)
        const normalizeRecord = (record: CodexIntegratorPrivateRecord | null): CodexIntegratorPrivateRecord | null =>
          record === null || record.candidatePath.endsWith("/foreign-record")
            ? record
            : Schema.decodeUnknownSync(CodexIntegratorPrivateRecord)({ ...record, candidatePath })
        const reads = yield* Ref.make(0)
        const censusReads = yield* Ref.make(0)
        const registration = yield* Ref.make<Registration>(options.registration ?? "exact")
        const store: CodexIntegratorPrivateStoreService = {
          read: () =>
            Effect.gen(function* () {
              const ordinal = yield* Ref.getAndUpdate(reads, (value) => value + 1)
              const selected = options.readSequence?.[ordinal]
              const value = normalizeRecord(selected === undefined ? yield* Ref.get(current) : selected)
              return value === null ? Option.none() : Option.some(value)
            }),
          findByCandidatePath: () =>
            Effect.succeed(options.occupied === undefined ? Option.none() : Option.some(options.occupied)),
          write: (record) => Ref.set(current, record)
        }
        const terminalTurnMode = options.terminalTurnMode ?? "exact"
        const turns: ReadonlyArray<CodexTurnSnapshot> =
          terminalTurnMode === "missing"
            ? []
            : [
                {
                  id: CodexTurnId.make(terminalTurnMode === "wrongId" ? "foreign-cleanup-turn-id" : "cleanup-turn"),
                  status:
                    terminalTurnMode === "active" || terminalTurnMode === "inProgress"
                      ? "inProgress"
                      : terminalTurnMode === "failed"
                        ? "failed"
                        : terminalTurnMode === "interrupted"
                          ? "interrupted"
                          : "completed",
                  items: [],
                  ...(terminalTurnMode === "tokenless"
                    ? {}
                    : {
                        ownedTurnToken:
                          terminalTurnMode === "foreign"
                            ? CodexOwnedTurnToken.make("foreign-cleanup-turn-token")
                            : CodexOwnedTurnToken.make("cleanup-turn-token")
                      }),
                  ...(terminalTurnMode === "correlation"
                    ? {
                        correlation: PlannedAttemptExecutorCorrelation.make({
                          attemptId: AttemptId.make("foreign-cleanup-attempt"),
                          runId: RunId.make("foreign-cleanup-run")
                        })
                      }
                    : {})
                }
              ]
        const thread = {
          id: CodexThreadId.make("cleanup-thread"),
          cwd: CodexThreadWorkingDirectory.make(candidatePath),
          status: terminalTurnMode === "active" ? ("active" as const) : ("idle" as const),
          turns,
          ...(options.threadTokenMode === "tokenless"
            ? {}
            : {
                ownedThreadToken:
                  options.threadTokenMode === "foreign"
                    ? CodexThreadOwnershipToken.make("foreign-cleanup-thread-token")
                    : CodexThreadOwnershipToken.make("cleanup-thread-token")
              })
        }
        const failure = (operation: "thread/resume" | "thread/backgroundTerminals/list") =>
          new CodexAppServerFailure({ operation, kind: "Unavailable", detail: "cleanup boundary unavailable" })
        const app: CodexAppServerService = CodexAppServer.of({
          incarnation: CodexServerIncarnation.make("cleanup-incarnation"),
          startThread: () => Effect.succeed(thread),
          readThread: () => Effect.succeed(thread),
          resumeThread: () => (options.appFailure ? Effect.fail(failure("thread/resume")) : Effect.succeed(thread)),
          startTurn: () => Effect.die("unused"),
          interruptTurn: () => Effect.void,
          listBackgroundTerminals: () =>
            options.backgroundFailure ? Effect.fail(failure("thread/backgroundTerminals/list")) : Effect.succeed([]),
          terminateBackgroundTerminal: () => Effect.succeed(true),
          close: Effect.void
        })
        const census = CodexOwnedActivityCensus.of({
          observe: () =>
            Effect.gen(function* () {
              if (options.censusFailure) return yield* Effect.fail(failure("thread/resume"))
              const ordinal = yield* Ref.getAndUpdate(censusReads, (value) => value + 1)
              return options.projectionSequence?.[ordinal] ?? options.projection ?? { _tag: "Absent" as const }
            }),
          terminateDescendants: () => Effect.void
        })
        const commands: GitCommandService = {
          run: (_directory, args) =>
            Effect.gen(function* () {
              if (args[0] === "worktree" && args[1] === "list") {
                const value = yield* Ref.get(registration)
                const stdout =
                  value === "none"
                    ? ""
                    : value === "foreign"
                      ? `worktree ${candidatePath}\0HEAD ${"c".repeat(40)}\0branch refs/heads/foreign\0\0`
                      : `worktree ${candidatePath}\0HEAD ${head}\0detached\0\0`
                return { exitCode: 0, stderr: "", stdout }
              }
              if (args[0] === "worktree" && args[1] === "remove") {
                if (options.registrationAfterRemoval !== undefined) {
                  yield* Ref.set(registration, options.registrationAfterRemoval)
                } else if (options.applyRemoval === true) {
                  yield* Ref.set(registration, "none")
                  if (
                    yield* fileSystem
                      .exists(candidatePath)
                      .pipe(Effect.mapError((error) => new GitCommandInvocationFailure({ detail: String(error) })))
                  ) {
                    yield* fileSystem
                      .remove(candidatePath, { recursive: true })
                      .pipe(Effect.mapError((error) => new GitCommandInvocationFailure({ detail: String(error) })))
                  }
                }
                return { exitCode: options.removeExitCode ?? 0, stderr: options.removeStderr ?? "", stdout: "" }
              }
              return { exitCode: 0, stderr: "", stdout: "" }
            }),
          runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
          runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
        }
        const ownership = CoordinatorOwnership.of({
          release: Effect.void,
          runMutation: <B, E, R>(mutation: Effect.Effect<B, E, R>) =>
            options.ownershipFailure
              ? Effect.fail(new CoordinatorOwnershipLost({ gitCommonDirectory: config.commonDirectory }))
              : mutation
        })
        const authority = providerAuthorityFor(config, app, census, commands, fileSystem, store, ownership)
        return yield* operation(authority, authorizationFor())
      }).pipe(Effect.provide(NodeFileSystem.layer))
    )
  )

type RevisionReadOutcome =
  | { readonly _tag: "Left"; readonly error: unknown }
  | { readonly _tag: "Right"; readonly value: IntegratorCandidateCleanupEvidenceRevision | undefined }

const revisionReadOutcome = (
  authority: IntegratorCandidateProviderAuthority["Service"],
  subject: IntegratorCandidateCleanupEvidenceSubject
): Effect.Effect<RevisionReadOutcome> =>
  authority.readEvidenceRevision === undefined
    ? Effect.succeed({ _tag: "Left", error: "missing provider reader" })
    : authority
        .readEvidenceRevision(subject)
        .pipe(
          Effect.match({
            onFailure: (error): RevisionReadOutcome => ({ _tag: "Left", error }),
            onSuccess: (value): RevisionReadOutcome => ({ _tag: "Right", value })
          })
        )

const recordFor = (
  candidatePath: string,
  overrides: Partial<{
    correlation: IntegratorSessionCorrelation
    revision: number
    removed: boolean
    removalIntent: boolean
    threadId: CodexThreadId | null
    threadStartIntent: boolean
    worktreeMaterializationIntent: boolean
    worktreeReady: boolean
    terminalStatus: "completed" | "failed"
  }> = {}
) => {
  const correlation = overrides.correlation ?? predecessor
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
  const threadId = overrides.threadId === undefined ? CodexThreadId.make("cleanup-thread") : overrides.threadId
  const result = IntegratorResult.cases.NotPrepared.make({
    correlation: run,
    detail: IntegratorNotPreparedDetail.make("cleanup test terminal result")
  })
  const sealedRun =
    overrides.terminalStatus === "failed"
      ? CodexIntegratorPrivateRun.cases.FailedTurnSealed.make({
          correlation: run,
          result,
          token: CodexOwnedTurnToken.make("cleanup-turn-token"),
          turnId: CodexTurnId.make("cleanup-turn")
        })
      : CodexIntegratorPrivateRun.cases.CompletedTurnSealed.make({
          correlation: run,
          result,
          token: CodexOwnedTurnToken.make("cleanup-turn-token"),
          turnId: CodexTurnId.make("cleanup-turn")
        })
  const common = {
    appServerIncarnation: CodexServerIncarnation.make("cleanup-incarnation"),
    candidatePath: IntegratorCandidateWorktreePath.make(candidatePath),
    correlation,
    revision: revision(overrides.revision ?? 1),
    threadToken: CodexThreadOwnershipToken.make("cleanup-thread-token")
  }
  if (overrides.removed) return CodexIntegratorPrivateRecord.cases.Removed.make({ ...common, runs: [sealedRun] })
  if (overrides.worktreeMaterializationIntent) {
    return CodexIntegratorPrivateRecord.cases.WorktreeMaterializationIntentRecorded.make(common)
  }
  if (overrides.worktreeReady === false) {
    return CodexIntegratorPrivateRecord.cases.CandidateUnmaterialized.make(common)
  }
  if (overrides.threadStartIntent) return CodexIntegratorPrivateRecord.cases.ThreadStartIntentRecorded.make(common)
  if (threadId === null) return CodexIntegratorPrivateRecord.cases.CandidateReady.make(common)
  return overrides.removalIntent
    ? CodexIntegratorPrivateRecord.cases.RemovalIntentRecorded.make({ ...common, runs: [sealedRun], threadId })
    : CodexIntegratorPrivateRecord.cases.ThreadWithRuns.make({ ...common, runs: [sealedRun], threadId })
}

describe("Codex Integrator cleanup boundary", () => {
  it("reads the exact private revision for authorization and rejects foreign evidence", async () => {
    const observed = await runCase(
      { record: recordFor("/tmp/unused", { revision: 9 }), registration: "none" },
      (authority) => revisionReadOutcome(authority, { locator: predecessor.candidateResource, predecessor })
    )
    expect(observed._tag === "Right" ? observed.value : undefined).toBe(
      IntegratorCandidateCleanupEvidenceRevision.make(9)
    )

    const foreign = await runCase(
      {
        record: recordFor("/tmp/foreign-record", {
          correlation: sessionFor("foreign", "candidate:foreign"),
          revision: 9
        }),
        registration: "none"
      },
      (authority) => revisionReadOutcome(authority, { locator: predecessor.candidateResource, predecessor })
    )
    expect(foreign._tag).toBe("Left")

    const missing = await runCase({ record: null, registration: "none" }, (authority) =>
      revisionReadOutcome(authority, { locator: predecessor.candidateResource, predecessor })
    )
    expect(missing._tag).toBe("Left")
  })

  it("fails closed for missing, foreign, unresolved, transferred, and settled ownership", async () => {
    const absent = await runCase({ record: null, registration: "none" }, (authority, authorization) =>
      authority.observe(authorization)
    )
    expect(absent._tag).toBe("Unreadable")

    const occupied = await runCase(
      {
        record: null,
        registration: "none",
        occupied: recordFor("/tmp/occupied", { correlation: sessionFor("occupied", "candidate:occupied") })
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(occupied._tag).toBe("Foreign")

    const foreignRecord = await runCase(
      {
        record: recordFor("/tmp/foreign-record", { correlation: sessionFor("foreign", "candidate:foreign") }),
        registration: "none"
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(foreignRecord._tag).toBe("Foreign")

    const transferred = await runCase(
      { record: recordFor("/tmp/unused"), registration: "none", pathExists: true },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(transferred._tag).toBe("Foreign")

    const removed = await runCase(
      {
        record: recordFor("/tmp/unused", { removed: true, threadId: null, worktreeReady: false }),
        registration: "none"
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(removed._tag).toBe("Absent")

    const unresolved = await runCase(
      { record: recordFor("/tmp/unused", { threadId: null, threadStartIntent: true }), registration: "none" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(unresolved._tag).toBe("Unreadable")

    const removalIntent = await runCase(
      { record: recordFor("/tmp/unused", { removalIntent: true }), registration: "none" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(removalIntent._tag).toBe("Absent")

    const materializingWithoutRegistration = await runCase(
      {
        record: recordFor("/tmp/unused", { worktreeMaterializationIntent: true, worktreeReady: false }),
        registration: "none"
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(materializingWithoutRegistration._tag).toBe("Unreadable")

    const unreadableRemovalProjection = await runCase(
      {
        record: recordFor("/tmp/unused", { removalIntent: true }),
        registration: "none",
        projection: { _tag: "Unreadable", detail: "census unavailable" }
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(unreadableRemovalProjection._tag).toBe("Unreadable")

    const contradictoryRemovalProjection = await runCase(
      {
        record: recordFor("/tmp/unused", { removalIntent: true }),
        registration: "none",
        projection: { _tag: "Contradictory", detail: "census contradicted itself" }
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(contradictoryRemovalProjection._tag).toBe("Unreadable")

    const liveRemovalIntent = await runCase(
      {
        record: recordFor("/tmp/unused", { removalIntent: true }),
        registration: "none",
        projection: { _tag: "ExactLive", activities: [] }
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(liveRemovalIntent._tag).toBe("Foreign")

    const foreignThreadRemovalIntent = await runCase(
      { record: recordFor("/tmp/unused", { removalIntent: true }), registration: "none", threadTokenMode: "foreign" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(foreignThreadRemovalIntent._tag).toBe("Foreign")

    const noIntent = await runCase(
      { record: recordFor("/tmp/unused"), registration: "none" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(noIntent._tag).toBe("Foreign")
  })

  it("requires exact thread, terminal, and process absence before settling a removal intent", async () => {
    const liveThread = await runCase(
      {
        record: recordFor("/tmp/unused", { removalIntent: true }),
        registration: "none",
        projection: { _tag: "ExactLive", activities: [] }
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(liveThread._tag).toBe("Foreign")

    const terminalCensusFailure = await runCase(
      { record: recordFor("/tmp/unused", { removalIntent: true }), registration: "none", backgroundFailure: true },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(terminalCensusFailure._tag).toBe("Unreadable")

    const processCensusFailure = await runCase(
      { record: recordFor("/tmp/unused", { removalIntent: true }), registration: "none", censusFailure: true },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(processCensusFailure._tag).toBe("Unreadable")

    const tokenlessThread = await runCase(
      { record: recordFor("/tmp/unused", { removalIntent: true }), registration: "none", threadTokenMode: "tokenless" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(tokenlessThread._tag).toBe("Foreign")
  })

  it("keeps an unresolved worktree materialization unreadable and non-removable", async () => {
    const observed = await runCase(
      {
        record: recordFor("/tmp/unused", { worktreeMaterializationIntent: true, worktreeReady: false }),
        registration: "exact",
        pathExists: true
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(observed._tag).toBe("Unreadable")

    const removed = await runCase(
      {
        record: recordFor("/tmp/unused", { worktreeMaterializationIntent: true, worktreeReady: false }),
        registration: "exact",
        pathExists: true
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(removed._tag).toBe("DefinitelyNotApplied")
  })

  it("rejects tokenless, foreign, active, missing, and correlated terminal evidence", async () => {
    const cases = [
      ["tokenless", "Unreadable"],
      ["foreign", "Foreign"],
      ["active", "Foreign"],
      ["inProgress", "Foreign"],
      ["interrupted", "Unreadable"],
      ["failed", "Absent"],
      ["missing", "Unreadable"],
      ["wrongId", "Unreadable"],
      ["correlation", "Foreign"]
    ] as const
    for (const [terminalTurnMode, expected] of cases) {
      const observed = await runCase(
        {
          record: recordFor("/tmp/unused", {
            removalIntent: true,
            terminalStatus: terminalTurnMode === "failed" ? "failed" : "completed"
          }),
          registration: "none",
          projection: { _tag: "Absent" },
          terminalTurnMode
        },
        (authority, authorization) => authority.observe(authorization)
      )
      expect(observed._tag, terminalTurnMode).toBe(expected)
    }
  })

  it("fails closed when the fresh terminal status contradicts the sealed private result", async () => {
    const failedInsteadOfCompleted = await runCase(
      {
        record: recordFor("/tmp/unused", { removalIntent: true, terminalStatus: "completed" }),
        registration: "none",
        projection: { _tag: "Absent" },
        terminalTurnMode: "failed"
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(failedInsteadOfCompleted._tag).toBe("Unreadable")

    const completedInsteadOfFailed = await runCase(
      {
        record: recordFor("/tmp/unused", { removalIntent: true, terminalStatus: "failed" }),
        registration: "none",
        projection: { _tag: "Absent" },
        terminalTurnMode: "exact"
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(completedInsteadOfFailed._tag).toBe("Unreadable")
  })

  it("classifies exact registrations and all activity outcomes", async () => {
    const removed = await runCase(
      {
        record: recordFor("/tmp/unused", { removed: true, threadId: null, worktreeReady: false }),
        registration: "exact",
        pathExists: true
      },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(removed._tag).toBe("Foreign")

    const foreignRegistration = await runCase(
      { record: recordFor("/tmp/unused"), registration: "foreign", pathExists: true },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(foreignRegistration._tag).toBe("Foreign")

    const missingPath = await runCase(
      { record: recordFor("/tmp/unused"), registration: "exact", pathExists: false },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(missingPath._tag).toBe("Unreadable")

    const unresolved = await runCase(
      { record: recordFor("/tmp/unused", { threadId: null }), registration: "exact", pathExists: true },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(unresolved._tag).toBe("Unreadable")

    const tokenMismatch = await runCase(
      { record: recordFor("/tmp/unused"), registration: "exact", pathExists: true, threadTokenMode: "foreign" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(tokenMismatch._tag).toBe("Foreign")

    const registeredTerminalEvidence = await runCase(
      { record: recordFor("/tmp/unused"), registration: "exact", pathExists: true, terminalTurnMode: "wrongId" },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(registeredTerminalEvidence._tag).toBe("Unreadable")

    const activityCases = [
      [{ _tag: "ExactLive", activities: [] } as const, "Foreign"],
      [{ _tag: "Unreadable", detail: "census unavailable" } as const, "Unreadable"],
      [{ _tag: "Contradictory", detail: "census contradiction" } as const, "Unreadable"],
      [{ _tag: "Absent" } as const, "Present"]
    ] as const
    for (const [projection, tag] of activityCases) {
      const result = await runCase(
        { record: recordFor("/tmp/unused"), registration: "exact", pathExists: true, projection },
        (authority, authorization) => authority.observe(authorization)
      )
      expect(result._tag).toBe(tag)
    }
    const backgroundFailure = await runCase(
      { record: recordFor("/tmp/unused"), registration: "exact", pathExists: true, backgroundFailure: true },
      (authority, authorization) => authority.observe(authorization)
    )
    expect(backgroundFailure._tag).toBe("Unreadable")
  })

  it("reconciles removal responses and catches disappearing authority", async () => {
    const definitelyNotApplied = await runCase(
      { record: recordFor("/tmp/unused"), registration: "none" },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(definitelyNotApplied._tag).toBe("DefinitelyNotApplied")

    const removedAlreadyAbsent = await runCase(
      {
        record: recordFor("/tmp/unused", { removed: true, threadId: null, worktreeReady: false }),
        registration: "none"
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(removedAlreadyAbsent._tag).toBe("AlreadyAbsent")

    const absentAfterObservation = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        readSequence: [recordFor("/tmp/unused"), null]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(absentAfterObservation._tag).toBe("Unknown")

    const staleBeforeMutation = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        readSequence: [recordFor("/tmp/unused"), recordFor("/tmp/unused", { revision: 2 })]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(staleBeforeMutation._tag).toBe("Unknown")

    const changedPathBeforeMutation = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        readSequence: [recordFor("/tmp/unused"), recordFor("/tmp/foreign-record")]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(changedPathBeforeMutation._tag).toBe("Unknown")

    const intentDisappears = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        readSequence: [recordFor("/tmp/unused"), recordFor("/tmp/unused"), null]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(intentDisappears._tag).toBe("Unknown")

    const revalidationFindsLiveActivity = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        projectionSequence: [{ _tag: "Absent" }, { _tag: "ExactLive", activities: [] }]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(revalidationFindsLiveActivity._tag).toBe("DefinitelyNotApplied")

    const alreadyAbsent = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        removeExitCode: 1,
        removeStderr: "remove failed",
        applyRemoval: true
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(alreadyAbsent._tag).toBe("AlreadyAbsent")

    const unknownWithoutStderr = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        removeExitCode: 1,
        applyRemoval: false
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(unknownWithoutStderr._tag).toBe("Unknown")

    const remainsRegistered = await runCase(
      { record: recordFor("/tmp/unused"), registration: "exact", pathExists: true, applyRemoval: false },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(remainsRegistered._tag).toBe("Unknown")

    const disappearsAfterRemoval = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        applyRemoval: true,
        readSequence: [
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused", { removalIntent: true }),
          null
        ]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(disappearsAfterRemoval._tag).toBe("Unknown")

    const foreignAfterRemoval = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        applyRemoval: true,
        readSequence: [
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused", { removalIntent: true }),
          recordFor("/tmp/unused", { removalIntent: true }),
          recordFor("/tmp/unused", { removalIntent: true }),
          recordFor("/tmp/foreign-record", { correlation: sessionFor("foreign", "candidate:foreign") })
        ]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(foreignAfterRemoval._tag).toBe("Unknown")

    const tombstoneDisappears = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        applyRemoval: true,
        readSequence: [
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused", { removalIntent: true }),
          recordFor("/tmp/unused", { removalIntent: true }),
          recordFor("/tmp/unused", { removalIntent: true }),
          recordFor("/tmp/unused"),
          null
        ]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(tombstoneDisappears._tag).toBe("Unknown")

    const ownershipFailure = await runCase(
      { record: recordFor("/tmp/unused"), registration: "exact", pathExists: true, ownershipFailure: true },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(ownershipFailure._tag).toBe("Unknown")
  })

  it("refuses a same-revision private predecessor replacement before Git removal", async () => {
    const result = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        readSequence: [
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused", { correlation: sessionFor("replacement", predecessor.candidateResource) })
        ]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(result._tag).toBe("Unknown")
  })

  it("maps a failed removal race to DefinitelyNotApplied when registration transfers", async () => {
    const result = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        removeExitCode: 1,
        removeStderr: "remove response failed",
        registrationAfterRemoval: "foreign"
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(result._tag).toBe("DefinitelyNotApplied")
  })

  it("maps a successful removal race to DefinitelyNotApplied when registration transfers", async () => {
    const result = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        applyRemoval: true,
        registrationAfterRemoval: "foreign"
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(result._tag).toBe("DefinitelyNotApplied")
  })

  it("keeps cleanup retryable when the post-removal private tombstone disappears", async () => {
    const result = await runCase(
      {
        record: recordFor("/tmp/unused"),
        registration: "exact",
        pathExists: true,
        applyRemoval: true,
        readSequence: [
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused"),
          recordFor("/tmp/unused", { removalIntent: true }),
          null
        ]
      },
      (authority, authorization) => authority.remove(authorization, CleanupMutationOrdinal.make(1))
    )
    expect(result._tag).toBe("Unknown")
  })
})
