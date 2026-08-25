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
import { Effect, FileSystem, Option, Ref } from "effect"
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
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexIntegratorConfiguration,
  CodexIntegratorPrivateRecord,
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
  readonly threadTokenMode?: "exact" | "tokenless" | "foreign"
  readonly terminalTurnMode?: "exact" | "tokenless" | "foreign" | "active" | "missing" | "correlation"
  readonly worktreeMaterializationIntent?: boolean
  readonly appFailure?: boolean
  readonly backgroundFailure?: boolean
  readonly censusFailure?: boolean
  readonly ownershipFailure?: boolean
  readonly removeExitCode?: number
  readonly removeStderr?: string
  readonly applyRemoval?: boolean
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
              : CodexIntegratorPrivateRecord.make({ ...options.record, candidatePath })
        const current = yield* Ref.make<CodexIntegratorPrivateRecord | null>(initialRecord)
        const normalizeRecord = (record: CodexIntegratorPrivateRecord | null): CodexIntegratorPrivateRecord | null =>
          record === null || record.candidatePath.endsWith("/foreign-record")
            ? record
            : CodexIntegratorPrivateRecord.make({ ...record, candidatePath })
        const reads = yield* Ref.make(0)
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
                  id: CodexTurnId.make("cleanup-turn"),
                  status: terminalTurnMode === "active" ? "inProgress" : "completed",
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
          cwd: candidatePath,
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
            options.censusFailure
              ? Effect.fail(failure("thread/resume"))
              : Effect.succeed(options.projection ?? { _tag: "Absent" as const }),
          terminateDescendants: () => Effect.void
        })
        const porcelain =
          options.registration === "foreign"
            ? `worktree ${candidatePath}\nHEAD ${"c".repeat(40)}\nbranch refs/heads/foreign\n\n`
            : `worktree ${candidatePath}\nHEAD ${head}\ndetached\n\n`
        const commands: GitCommandService = {
          run: (_directory, args) =>
            Effect.gen(function* () {
              if (args[0] === "worktree" && args[1] === "list") {
                const value = yield* Ref.get(registration)
                return { exitCode: 0, stderr: "", stdout: value === "none" ? "" : porcelain }
              }
              if (args[0] === "worktree" && args[1] === "remove") {
                if (options.applyRemoval === true) {
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
  }> = {}
) => {
  const correlation = overrides.correlation ?? predecessor
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
  return CodexIntegratorPrivateRecord.make({
    appServerIncarnation: CodexServerIncarnation.make("cleanup-incarnation"),
    candidatePath: IntegratorCandidateWorktreePath.make(candidatePath),
    correlation,
    revision: revision(overrides.revision ?? 1),
    removed: overrides.removed ?? false,
    removalIntent: overrides.removalIntent ?? false,
    runs: [
      {
        correlation: run,
        phase: "Sealed",
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: run,
          detail: IntegratorNotPreparedDetail.make("cleanup test terminal result")
        }),
        token: CodexOwnedTurnToken.make("cleanup-turn-token"),
        turnId: CodexTurnId.make("cleanup-turn")
      }
    ],
    threadId: overrides.threadId === undefined ? CodexThreadId.make("cleanup-thread") : overrides.threadId,
    threadToken: CodexThreadOwnershipToken.make("cleanup-thread-token"),
    threadStartIntent: overrides.threadStartIntent ?? false,
    worktreeMaterializationIntent: overrides.worktreeMaterializationIntent ?? false,
    worktreeReady: overrides.worktreeReady ?? true
  })
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
      ["missing", "Unreadable"],
      ["correlation", "Foreign"]
    ] as const
    for (const [terminalTurnMode, expected] of cases) {
      const observed = await runCase(
        {
          record: recordFor("/tmp/unused", { removalIntent: true }),
          registration: "none",
          projection: { _tag: "Absent" },
          terminalTurnMode
        },
        (authority, authorization) => authority.observe(authorization)
      )
      expect(observed._tag, terminalTurnMode).toBe(expected)
    }
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
