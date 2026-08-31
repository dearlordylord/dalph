import { NodeFileSystem } from "@effect/platform-node"
import {
  AcceptedResult,
  AttemptId,
  EvidenceReference,
  EvidenceDigest,
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
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"
import { codexIntegratorLayer, nodeCodexIntegratorLayer } from "./codex-integrator.js"
import {
  CodexIntegratorConfiguration,
  CodexIntegratorPrivateRecord,
  CodexIntegratorPrivateRun,
  CodexIntegratorPrivateStore,
  IntegratorCandidateWorktreePath,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  candidateWorktreePathFor,
  memoryCodexIntegratorPrivateStoreLayer,
  preservedPrivateRecordFields,
  privateRuns,
  removedRecordFor,
  revision,
  updateRun
} from "./codex-integrator-private-store.js"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  CodexThreadWorkingDirectory,
  controlledCodexOwnedActivityCensusLayer,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection
} from "./codex-app-server.js"
import {
  CodexServerIncarnation,
  CodexThreadId,
  CodexThreadOwnershipToken,
  CodexTurnId,
  CodexOwnedTurnToken
} from "./codex-attempt-store.js"
import {
  CleanupMutationOrdinal,
  CoordinatorOwnership,
  GitCommand,
  GitCommandInvocationFailure,
  GitCommonDirectoryLocator,
  Integrator,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateProviderAuthority,
  IntegratorCandidateResourceLocator,
  IntegratorRequest,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  OperationId,
  type GitCommandService
} from "@dalph/orchestrator"

const sha = (letter: string): GitCommitSha => GitCommitSha.make(letter.repeat(40))
const repository = GitRepositoryLocator.make("/repositories/integrator-test.git")
const commonDirectory = GitCommonDirectoryLocator.make("/repositories/integrator-test.git")
const targetHead = sha("a")
const acceptedCommit = sha("b")
const resource = IntegratorCandidateResourceLocator.make("candidate:test")
const target = IntegrationTarget.make({ repository, ref: IntegrationTargetRef.make("refs/heads/main") })
const candidatePath = candidateWorktreePathFor(
  CodexIntegratorConfiguration.make({
    candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
    commonDirectory,
    privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/store.json"),
    repository
  }),
  resource
)
const session = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: acceptedCommit,
    evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
  }),
  candidateResource: resource,
  expectedTargetHead: targetHead,
  integrationTarget: target,
  plannedAttempt: PlannedTaskAttempt.make({
    attemptId: AttemptId.make("attempt"),
    baseSha: targetHead,
    branch: TaskBranchRef.make("refs/heads/task"),
    executor: TaskExecutorLocator.make("executor"),
    runId: RunId.make("run"),
    taskId: TaskId.make("task"),
    taskRevision: TaskRevision.make("revision"),
    worktree: WorktreeLocator.make("/planned/worktree")
  }),
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("session"),
  startedAt: JournalPosition.make(2),
  targetLineageObservedAt: JournalPosition.make(3)
})
const requestFor = (ordinal: number): IntegratorRequest => requestForSession(session, ordinal)

const requestForSession = (sessionCorrelation: IntegratorSessionCorrelation, ordinal: number): IntegratorRequest =>
  IntegratorRequest.make({
    correlation: IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(ordinal),
      session: sessionCorrelation
    })
  })

const successorSession = IntegratorSessionCorrelation.make({
  ...session,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:successor"),
  sessionId: IntegratorSessionId.make("successor-session"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const foreignSession = IntegratorSessionCorrelation.make({
  ...session,
  sessionId: IntegratorSessionId.make("foreign-session"),
  targetLineageObservedAt: JournalPosition.make(13)
})
const cleanupAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: session,
    successor: successorSession
  }),
  // The provider record reaches revision 9 after recording candidate intent,
  // worktree/thread ownership, the turn token, and its sealed terminal result.
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(9),
  locator: resource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make("candidate-cleanup-observation"),
  operationId: OperationId.make("candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: session.sessionId }),
  writerQuiescent: true
})

type FixtureOptions = {
  readonly activity?: CodexOwnedActivityCensusProjection
  readonly activitySequence?: ReadonlyArray<CodexOwnedActivityCensusProjection>
  readonly envelopes?: ReadonlyArray<string>
  readonly duplicateThreads?: boolean
  readonly duplicateTurnToken?: boolean
  readonly threadListingUnavailable?: boolean
  readonly listThreadsHidePersisted?: boolean
  readonly listedThreadTokenMode?: "exact" | "tokenless" | "foreign"
  readonly preexistingThread?: boolean
  readonly preRegisteredWorktree?: boolean
  readonly preRegisteredWorktreePathExists?: boolean
  readonly prunableWorktree?: boolean
  readonly foreignThread?: boolean
  readonly foreignWorktree?: boolean
  readonly foreignWorktreeState?: { value: boolean }
  readonly worktreeRegistrationState?: { value: "exact" | "foreign" | "missing" }
  readonly loseFirstThreadResponse?: boolean
  readonly loseFirstWorktreeAddResponse?: boolean
  readonly loseFirstWorktreeRemoveResponse?: boolean
  readonly failFirstWorktreeRemoveWithoutApplying?: boolean
  readonly worktreePath?: string
  readonly failBeforeRecordingFirstTurn?: boolean
  readonly failAfterRecordingFirstTurn?: boolean
  readonly failAfterRecordingSecondTurn?: boolean
  readonly turnTokenMode?: "exact" | "tokenless" | "foreign"
  readonly resumeThreadTokenMode?: "exact" | "tokenless" | "foreign"
  readonly resumeThreadTokenSequence?: ReadonlyArray<"exact" | "tokenless" | "foreign">
  readonly resumeThreadState?:
    | "exact"
    | "active"
    | "foreign"
    | "tokenless"
    | "missing"
    | "wrongId"
    | "completed"
    | "failed"
  readonly persistedTurnCorrelation?: boolean
  readonly hideTurnsOnRead?: boolean
  readonly activeTurn?: boolean
  readonly failedTerminalTurn?: boolean
  readonly precedingItems?: ReadonlyArray<unknown>
  readonly gitCalls?: Array<ReadonlyArray<string>>
  readonly threadStarts?: { value: number }
  readonly turnTokens?: Array<CodexOwnedTurnToken>
  readonly turnStarts?: { value: number }
  readonly worktreeAdds?: { value: number }
  readonly worktreeRemoves?: { value: number }
  readonly ownershipCalls?: Array<"enter" | "exit">
  readonly appIncarnation?: { value: CodexServerIncarnation }
  readonly initialRecords?: ReadonlyArray<CodexIntegratorPrivateRecord>
  readonly privateWrites?: Array<CodexIntegratorPrivateRecord>
  readonly boundaryEvents?: Array<string>
}

const fixtureLayer = (
  options: FixtureOptions = {}
): Layer.Layer<CodexAppServer | GitCommand | CoordinatorOwnership, never, FileSystem.FileSystem> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const registered = yield* Ref.make(options.foreignWorktree === true || options.preRegisteredWorktree === true)
      const fileSystem = yield* FileSystem.FileSystem
      const fixtureWorktreePath = options.worktreePath ?? candidatePath
      if (options.preRegisteredWorktreePathExists === true) {
        yield* fileSystem.makeDirectory(fixtureWorktreePath, { recursive: true }).pipe(Effect.orDie)
      }
      const persistentThreads = yield* Ref.make<
        ReadonlyArray<{ readonly id: CodexThreadId; readonly ownedThreadToken?: CodexThreadOwnershipToken }>
      >(options.preexistingThread === true ? [{ id: CodexThreadId.make("fixture-thread") }] : [])
      const threadStartCalls = yield* Ref.make(0)
      const resumeThreadCalls = yield* Ref.make(0)
      const turns = yield* Ref.make<
        ReadonlyArray<{
          readonly id: CodexTurnId
          readonly status: "completed" | "failed" | "inProgress"
          readonly items: ReadonlyArray<unknown>
          readonly ownedTurnToken?: CodexOwnedTurnToken
        }>
      >([])
      const fixtureIncarnation = CodexServerIncarnation.make("fixture-incarnation")
      const listThreads = () =>
        Ref.get(persistentThreads).pipe(
          Effect.map((threads) =>
            (options.listThreadsHidePersisted === true
              ? []
              : options.duplicateThreads === true
                ? [...threads, ...threads]
                : threads
            ).map((thread) => ({
              id: thread.id,
              cwd: CodexThreadWorkingDirectory.make(fixtureWorktreePath),
              status: "idle" as const,
              turns: [],
              ...(options.listedThreadTokenMode === "tokenless"
                ? {}
                : {
                    ownedThreadToken:
                      options.listedThreadTokenMode === "foreign"
                        ? CodexThreadOwnershipToken.make("foreign-listed-thread-token")
                        : thread.ownedThreadToken
                  })
            }))
          )
        )
      const app: CodexAppServerService = {
        get incarnation() {
          return options.appIncarnation?.value ?? fixtureIncarnation
        },
        startThread: (cwd, ownedThreadToken) =>
          Effect.gen(function* () {
            const threadStartCall = yield* Ref.modify(threadStartCalls, (value) => [value + 1, value + 1] as const)
            if (options.threadStarts !== undefined) options.threadStarts.value += 1
            const thread = {
              id: CodexThreadId.make("fixture-thread"),
              cwd: CodexThreadWorkingDirectory.make(cwd),
              status: "idle" as const,
              turns: [],
              ...(ownedThreadToken === undefined ? {} : { ownedThreadToken }),
              ...(options.foreignThread === true
                ? {
                    correlation: PlannedAttemptExecutorCorrelation.make({
                      attemptId: AttemptId.make("foreign-attempt"),
                      runId: RunId.make("foreign-run")
                    })
                  }
                : {})
            }
            yield* Ref.update(persistentThreads, (current) => [
              ...current,
              { id: thread.id, ...(ownedThreadToken === undefined ? {} : { ownedThreadToken }) }
            ])
            if (options.loseFirstThreadResponse === true && threadStartCall === 1) {
              return yield* Effect.fail(
                CodexAppServerFailure.make({
                  operation: "thread/start",
                  kind: "Unavailable",
                  detail: "thread/start response was lost after the server recorded the thread"
                })
              )
            }
            return thread
          }),
        ...(options.threadListingUnavailable === true
          ? {}
          : { listThreads, listThreadsComplete: options.listThreadsHidePersisted !== true }),
        readThread: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(turns)
            const persisted = yield* Ref.get(persistentThreads)
            const persistedThreadToken = persisted.find(
              (item) => item.id === CodexThreadId.make("fixture-thread")
            )?.ownedThreadToken
            const ownedThreadToken =
              options.resumeThreadTokenMode === "tokenless"
                ? undefined
                : options.resumeThreadTokenMode === "foreign"
                  ? CodexThreadOwnershipToken.make("foreign-resumed-thread-token")
                  : persistedThreadToken
            return {
              id: CodexThreadId.make("fixture-thread"),
              cwd: CodexThreadWorkingDirectory.make(fixtureWorktreePath),
              status: "idle" as const,
              turns:
                options.hideTurnsOnRead === true
                  ? []
                  : current.map((turn) =>
                      options.persistedTurnCorrelation === true
                        ? {
                            ...turn,
                            correlation: PlannedAttemptExecutorCorrelation.make({
                              attemptId: AttemptId.make("persisted-foreign-attempt"),
                              runId: RunId.make("persisted-foreign-run")
                            })
                          }
                        : turn
                    ),
              ...(ownedThreadToken === undefined ? {} : { ownedThreadToken })
            }
          }),
        resumeThread: (_threadId, cwd) =>
          Effect.gen(function* () {
            const resumeOrdinal = yield* Ref.getAndUpdate(resumeThreadCalls, (value) => value + 1)
            const current = yield* Ref.get(turns)
            const persisted = yield* Ref.get(persistentThreads)
            const persistedThreadToken = persisted.find(
              (item) => item.id === CodexThreadId.make("fixture-thread")
            )?.ownedThreadToken
            const resumeThreadTokenMode =
              options.resumeThreadTokenSequence?.[resumeOrdinal] ?? options.resumeThreadTokenMode
            const ownedThreadToken =
              resumeThreadTokenMode === "tokenless"
                ? undefined
                : resumeThreadTokenMode === "foreign"
                  ? CodexThreadOwnershipToken.make("foreign-resumed-thread-token")
                  : persistedThreadToken
            const resumedTurns =
              options.resumeThreadState === "missing"
                ? []
                : options.resumeThreadState === "foreign"
                  ? [
                      ...current,
                      {
                        id: CodexTurnId.make("foreign-replay-turn"),
                        status: "inProgress" as const,
                        items: [],
                        ownedTurnToken: CodexOwnedTurnToken.make("foreign-replay-token")
                      }
                    ]
                  : options.resumeThreadState === "tokenless"
                    ? [
                        ...current,
                        { id: CodexTurnId.make("tokenless-replay-turn"), status: "completed" as const, items: [] }
                      ]
                    : current.map((turn) =>
                        options.resumeThreadState === "completed"
                          ? { ...turn, status: "completed" as const }
                          : options.resumeThreadState === "failed"
                            ? { ...turn, status: "failed" as const }
                            : options.resumeThreadState === "active"
                              ? { ...turn, status: "inProgress" as const }
                              : options.resumeThreadState === "wrongId"
                                ? { ...turn, id: CodexTurnId.make("foreign-replay-turn-id") }
                                : turn
                      )
            const visibleTurns =
              options.hideTurnsOnRead === true
                ? []
                : resumedTurns.map((turn) =>
                    options.persistedTurnCorrelation === true
                      ? {
                          ...turn,
                          correlation: PlannedAttemptExecutorCorrelation.make({
                            attemptId: AttemptId.make("persisted-foreign-attempt"),
                            runId: RunId.make("persisted-foreign-run")
                          })
                        }
                      : turn
                  )
            return {
              id: CodexThreadId.make("fixture-thread"),
              cwd: CodexThreadWorkingDirectory.make(cwd),
              status: options.resumeThreadState === "active" ? ("active" as const) : ("idle" as const),
              turns: visibleTurns,
              ...(ownedThreadToken === undefined ? {} : { ownedThreadToken })
            }
          }),
        startTurn: (_threadId, _cwd, _prompt, token) =>
          Effect.gen(function* () {
            if (token === undefined) return yield* Effect.die("missing provider token")
            if (options.turnStarts !== undefined) options.turnStarts.value += 1
            if (options.turnTokens !== undefined) options.turnTokens.push(token)
            const priorTurns = yield* Ref.get(turns)
            const returnedToken =
              options.turnTokenMode === "tokenless"
                ? undefined
                : options.turnTokenMode === "foreign"
                  ? CodexOwnedTurnToken.make("foreign-provider-token")
                  : token
            const status: "completed" | "failed" | "inProgress" = options.activeTurn
              ? "inProgress"
              : options.failedTerminalTurn === true
                ? "failed"
                : "completed"
            const turn = {
              id: CodexTurnId.make(`fixture-turn-${token}`),
              status,
              ...(returnedToken === undefined ? {} : { ownedTurnToken: returnedToken }),
              items: [
                ...(options.precedingItems ?? []),
                {
                  type: "agentMessage",
                  text:
                    options.envelopes?.[priorTurns.length] ??
                    '{"version":1,"outcome":"PreparedCandidate","candidate":"M"}'
                }
              ]
            }
            const firstTurnCall = options.turnStarts?.value === 1 || options.turnTokens?.length === 1
            if (options.failBeforeRecordingFirstTurn === true && firstTurnCall && priorTurns.length === 0) {
              return yield* Effect.fail(
                CodexAppServerFailure.make({
                  operation: "turn/start",
                  kind: "Unavailable",
                  detail: "turn/start response was lost before the server recorded the turn"
                })
              )
            }
            yield* Ref.update(turns, (current) =>
              options.duplicateTurnToken === true && priorTurns.length === 0
                ? [...current, turn, turn]
                : [...current, turn]
            )
            const loseAfterRecording =
              (options.failAfterRecordingFirstTurn === true && priorTurns.length === 0) ||
              (options.failAfterRecordingSecondTurn === true && priorTurns.length === 1)
            if (loseAfterRecording) {
              return yield* Effect.fail(
                CodexAppServerFailure.make({
                  operation: "turn/start",
                  kind: "Unavailable",
                  detail: "turn/start response was lost after the server recorded the turn"
                })
              )
            }
            return {
              ...turn,
              id: turn.id,
              status: turn.status,
              items: turn.items,
              ...(returnedToken === undefined ? {} : { ownedTurnToken: returnedToken })
            }
          }),
        interruptTurn: () => Effect.void,
        listBackgroundTerminals: () => Effect.succeed([]),
        terminateBackgroundTerminal: () => Effect.succeed(true),
        close: Effect.void
      }
      const ownership = CoordinatorOwnership.of({
        release: Effect.void,
        runMutation: (mutation) =>
          Effect.sync(() => options.ownershipCalls?.push("enter")).pipe(
            Effect.andThen(mutation),
            Effect.tap(() => Effect.sync(() => options.ownershipCalls?.push("exit")))
          )
      })
      const git: GitCommandService = {
        run: (_directory, args) =>
          Effect.gen(function* () {
            options.gitCalls?.push(args)
            options.boundaryEvents?.push(`git:${args.join(" ")}`)
            if (args[0] === "worktree" && args[1] === "list") {
              const present = yield* Ref.get(registered)
              const state = options.worktreeRegistrationState?.value
              const visible = state === "missing" ? false : present
              const foreign =
                state === "foreign" || options.foreignWorktree === true || options.foreignWorktreeState?.value === true
              return visible
                ? foreign
                  ? {
                      exitCode: 0,
                      stderr: "",
                      stdout: `worktree ${fixtureWorktreePath}\0HEAD ${sha("c")}\0branch refs/heads/foreign\0\0`
                    }
                  : {
                      exitCode: 0,
                      stderr: "",
                      stdout: `worktree ${fixtureWorktreePath}\0HEAD ${targetHead}\0detached\0${
                        options.prunableWorktree === true ? "prunable stale\0" : ""
                      }\0`
                    }
                : { exitCode: 0, stderr: "", stdout: "" }
            }
            if (args[0] === "worktree" && args[1] === "add") {
              if (options.worktreeAdds !== undefined) options.worktreeAdds.value += 1
              yield* Ref.set(registered, true)
              yield* fileSystem
                .makeDirectory(fixtureWorktreePath, { recursive: true })
                .pipe(Effect.mapError((error) => new GitCommandInvocationFailure({ detail: String(error) })))
              if (options.loseFirstWorktreeAddResponse === true && options.worktreeAdds?.value === 1) {
                return {
                  exitCode: 1,
                  stderr: "worktree add response was lost after Git registered the worktree",
                  stdout: ""
                }
              }
            }
            if (args[0] === "worktree" && args[1] === "remove") {
              if (options.worktreeRemoves !== undefined) options.worktreeRemoves.value += 1
              if (options.failFirstWorktreeRemoveWithoutApplying === true && options.worktreeRemoves?.value === 1) {
                return {
                  exitCode: 1,
                  stderr: "worktree remove failed before applying to the exact registration",
                  stdout: ""
                }
              }
              yield* Ref.set(registered, false)
              yield* fileSystem
                .remove(fixtureWorktreePath, { recursive: true })
                .pipe(Effect.mapError((error) => new GitCommandInvocationFailure({ detail: String(error) })))
              if (options.loseFirstWorktreeRemoveResponse === true) {
                return {
                  exitCode: 1,
                  stderr: "worktree remove response was lost after Git removed the worktree",
                  stdout: ""
                }
              }
            }
            return { exitCode: 0, stderr: "", stdout: "" }
          }),
        runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
        runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
      }
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (yield* fileSystem.exists(fixtureWorktreePath)) {
            yield* fileSystem.remove(fixtureWorktreePath, { recursive: true })
          }
        }).pipe(Effect.orDie)
      )
      const context = Context.empty().pipe(Context.add(CodexAppServer, app), Context.add(GitCommand, git))
      return Context.add(context, CoordinatorOwnership, ownership)
    })
  )

const fixtureLayerWithoutOwnership = (): Layer.Layer<CodexAppServer | GitCommand, never, FileSystem.FileSystem> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const context = yield* Layer.build(fixtureLayer())
      return Context.omit(CoordinatorOwnership)(context)
    })
  )

const providerLayer = (config: CodexIntegratorConfiguration, options: FixtureOptions = {}) =>
  codexIntegratorLayer(config).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeFileSystem.layer,
        memoryCodexIntegratorPrivateStoreLayer(options.initialRecords, (record) => {
          options.privateWrites?.push(record)
          options.boundaryEvents?.push(`store:${record._tag}`)
        }),
        fixtureLayer(options).pipe(Layer.provide(NodeFileSystem.layer)),
        options.activitySequence === undefined
          ? controlledCodexOwnedActivityCensusLayer({
              observe: () => Effect.succeed(options.activity ?? { _tag: "Absent" as const }),
              terminateDescendants: () => Effect.void
            })
          : Layer.effect(
              CodexOwnedActivityCensus,
              Effect.gen(function* () {
                const activityReads = yield* Ref.make(0)
                return CodexOwnedActivityCensus.of({
                  observe: () =>
                    Ref.modify(activityReads, (index) => {
                      const sequence = options.activitySequence as ReadonlyArray<CodexOwnedActivityCensusProjection>
                      const selected = sequence[Math.min(index, sequence.length - 1)] ?? { _tag: "Absent" as const }
                      return [selected, index + 1] as const
                    }),
                  terminateDescendants: () => Effect.void
                })
              })
            )
      )
    )
  )

describe("Codex Integrator", () => {
  it("composes the node-backed private store behind the integrator boundary", () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-layer-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-layer-test/store.json"),
      repository
    })
    expect(nodeCodexIntegratorLayer(config)).toBeDefined()
  })

  it("creates one candidate and returns the exact prepared envelope", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(Effect.provide(providerLayer(config)))
    )
    expect(result._tag).toBe("PreparedCandidate")
    expect(result.correlation.ordinal).toBe(1)
    expect(result._tag === "PreparedCandidate" ? result.candidateText : "").toBe("M")
  })

  it("records exact run one before asking Git to materialize the candidate", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/run-binding-store.json"),
      repository
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const privateWrites: Array<CodexIntegratorPrivateRecord> = []
    const boundaryEvents: Array<string> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(Effect.provide(providerLayer(config, { boundaryEvents, gitCalls, privateWrites })))
    )
    const first = privateWrites[0]
    expect(result._tag).toBe("PreparedCandidate")
    expect(first?._tag).toBe("CandidateUnmaterialized")
    expect(first?.initialRun).toEqual(requestFor(1).correlation)
    expect(first === undefined ? [] : privateRuns(first)).toEqual([])
    expect(boundaryEvents[0]).toBe("store:CandidateUnmaterialized")
    expect(boundaryEvents.findIndex((event) => event.startsWith("git:"))).toBeGreaterThan(0)
    expect(gitCalls.length).toBeGreaterThan(0)
  })

  it("rejects overlapping candidate and planned-attempt worktrees before any mutable boundary", async () => {
    const plannedContainsCandidate = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(session.plannedAttempt.worktree),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/overlap-store.json"),
      repository
    })
    const candidateContainsPlanned = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-overlap"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-overlap/store.json"),
      repository
    })
    const nestedPlannedSession = IntegratorSessionCorrelation.make({
      ...session,
      plannedAttempt: PlannedTaskAttempt.make({
        ...session.plannedAttempt,
        worktree: WorktreeLocator.make(
          `${candidateWorktreePathFor(candidateContainsPlanned, session.candidateResource)}/planned-attempt`
        )
      })
    })

    for (const [config, request] of [
      [plannedContainsCandidate, requestFor(1)],
      [candidateContainsPlanned, requestForSession(nestedPlannedSession, 1)]
    ] as const) {
      const gitCalls: Array<ReadonlyArray<string>> = []
      const privateWrites: Array<CodexIntegratorPrivateRecord> = []
      const threadStarts = { value: 0 }
      const turnStarts = { value: 0 }
      const failure = await Effect.runPromise(
        Effect.gen(function* () {
          const integrator = yield* Integrator
          return yield* Effect.flip(integrator.prepare(request))
        }).pipe(Effect.provide(providerLayer(config, { gitCalls, privateWrites, threadStarts, turnStarts })))
      )

      expect(failure._tag).toBe("IntegratorCallFailure")
      expect(failure.detail).toBe("candidate worktree must be disjoint from the planned-attempt worktree")
      expect(gitCalls).toEqual([])
      expect(privateWrites).toEqual([])
      expect(threadStarts.value).toBe(0)
      expect(turnStarts.value).toBe(0)
    }
  })

  it("rejects a mismatched recovery run before another provider or Git boundary call", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/mismatched-run-store.json"),
      repository
    })
    const initial = CodexIntegratorPrivateRecord.cases.CandidateUnmaterialized.make({
      appServerIncarnation: CodexServerIncarnation.make("fixture-incarnation"),
      candidatePath,
      correlation: session,
      initialRun: requestFor(1).correlation,
      revision: revision(1),
      threadToken: CodexThreadOwnershipToken.make("mismatched-run-thread")
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const privateWrites: Array<CodexIntegratorPrivateRecord> = []
    const threadStarts = { value: 0 }
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const failure = yield* Effect.flip(integrator.prepare(requestFor(2)))
        const store = yield* CodexIntegratorPrivateStore
        return { failure, stored: yield* store.read(session.sessionId) }
      }).pipe(
        Effect.provide(
          providerLayer(config, { gitCalls, initialRecords: [initial], privateWrites, threadStarts, turnStarts })
        )
      )
    )
    expect(result.failure.detail).toContain("durably bound")
    expect(gitCalls).toEqual([])
    expect(threadStarts.value).toBe(0)
    expect(turnStarts.value).toBe(0)
    expect(privateWrites).toEqual([])
    expect(Option.isSome(result.stored) ? result.stored.value : undefined).toEqual(initial)
  })

  it("preserves cleanup disposition and performs no provider or Git mutation during prepare", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/removal-intent-store.json"),
      repository
    })
    const run = requestFor(1).correlation
    const sealedResult = IntegratorResult.cases.NotPrepared.make({
      correlation: run,
      detail: IntegratorNotPreparedDetail.make("cleanup disposition is already selected")
    })
    const removal = CodexIntegratorPrivateRecord.cases.RemovalIntentRecorded.make({
      appServerIncarnation: CodexServerIncarnation.make("fixture-incarnation"),
      candidatePath,
      correlation: session,
      initialRun: run,
      revision: revision(8),
      runs: [
        CodexIntegratorPrivateRun.cases.CompletedTurnSealed.make({
          correlation: run,
          result: sealedResult,
          token: CodexOwnedTurnToken.make("removal-intent-turn"),
          turnId: CodexTurnId.make("removal-intent-turn-id")
        })
      ],
      threadId: CodexThreadId.make("removal-intent-thread"),
      threadToken: CodexThreadOwnershipToken.make("removal-intent-thread-token")
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const privateWrites: Array<CodexIntegratorPrivateRecord> = []
    const threadStarts = { value: 0 }
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const failure = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const store = yield* CodexIntegratorPrivateStore
        return { failure, stored: yield* store.read(session.sessionId) }
      }).pipe(
        Effect.provide(
          providerLayer(config, { gitCalls, initialRecords: [removal], privateWrites, threadStarts, turnStarts })
        )
      )
    )
    expect(result.failure.detail).toContain("cleanup disposition")
    expect(gitCalls).toEqual([])
    expect(threadStarts.value).toBe(0)
    expect(turnStarts.value).toBe(0)
    expect(privateWrites).toEqual([])
    expect(Option.isSome(result.stored) ? result.stored.value : undefined).toEqual(removal)
  })

  it("keeps thread, turn, prompt, and private phases out of the public result", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/public-result-store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(Effect.provide(providerLayer(config)))
    )
    expect(Object.keys(result).sort()).toEqual(["_tag", "candidateText", "correlation"].sort())
    expect(result).not.toHaveProperty("threadId")
    expect(result).not.toHaveProperty("turnId")
    expect(result).not.toHaveProperty("prompt")
    expect(result).not.toHaveProperty("phase")
  })

  it("reads only the final agent message after commentary and tool output", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/final-envelope-store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            precedingItems: [
              { type: "agentMessage", text: '{"version":1,"outcome":"PreparedCandidate","candidate":"WRONG"}' },
              { type: "toolResult", text: '{"version":1,"outcome":"PreparedCandidate","candidate":"WRONG"}' }
            ]
          })
        )
      )
    )
    expect(result._tag).toBe("PreparedCandidate")
    expect(result._tag === "PreparedCandidate" ? result.candidateText : "").toBe("M")
  })

  it("does not search an earlier agent message when the final envelope is malformed", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/earlier-envelope-store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            precedingItems: [
              { type: "agentMessage", text: '{"version":1,"outcome":"PreparedCandidate","candidate":"WRONG"}' },
              { type: "toolResult", text: "tool output" }
            ],
            envelopes: ["not-json"]
          })
        )
      )
    )
    expect(result._tag).toBe("NotPrepared")
  })

  it("replays a sealed NotPrepared result without starting another turn", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/sealed-not-prepared-store.json"
      ),
      repository
    })
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const replay = yield* integrator.prepare(requestFor(1))
        return { first, replay }
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            envelopes: ['{"version":1,"outcome":"NotPrepared","detail":"checks failed safely"}'],
            turnStarts
          })
        )
      )
    )
    expect(result.first._tag).toBe("NotPrepared")
    expect(result.replay._tag).toBe("NotPrepared")
    expect(result.replay.correlation.ordinal).toBe(1)
    expect(result.replay._tag === "NotPrepared" ? result.replay.detail : "").toBe("checks failed safely")
    expect(turnStarts.value).toBe(1)
  })

  it("fails sealed-result replay when ownership changes between thread reads", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/replay-between-reads-store.json"
      ),
      repository
    })
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const replay = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, replay }
      }).pipe(Effect.provide(providerLayer(config, { resumeThreadTokenSequence: ["exact", "foreign"], turnStarts })))
    )
    expect(result.first._tag).toBe("PreparedCandidate")
    expect(result.replay._tag).toBe("IntegratorCallFailure")
    expect(result.replay.detail).toContain("thread ownership changed")
    expect(turnStarts.value).toBe(1)
  })

  it.each([
    ["active", "still active"],
    ["foreign", "tokenless or foreign"],
    ["tokenless", "tokenless or foreign"],
    ["missing", "not readable after a sealed turn"],
    ["wrongId", "exact durable turn"]
  ] as const)("revalidates sealed-result replay when the fresh thread is %s", async (resumeThreadState, detail) => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        `/tmp/dalph-integrator-test/replay-${resumeThreadState}-store.json`
      ),
      repository
    })
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const replay = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, replay }
      }).pipe(Effect.provide(providerLayer(config, { resumeThreadState, turnStarts })))
    )
    expect(result.first._tag).toBe("PreparedCandidate")
    expect(result.replay._tag).toBe("IntegratorCallFailure")
    expect(result.replay.detail).toContain(detail)
    expect(turnStarts.value).toBe(1)
  })

  it.each([
    ["completed result with a fresh failed turn", false, "failed"],
    ["failed result with a fresh completed turn", true, "completed"]
  ] as const)("fails sealed replay when there is a %s", async (_description, failedFirstTurn, freshStatus) => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        `/tmp/dalph-integrator-test/replay-terminal-status-${failedFirstTurn ? "failed" : "completed"}.json`
      ),
      repository
    })
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const replay = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, replay }
      }).pipe(
        Effect.provide(
          providerLayer(config, { failedTerminalTurn: failedFirstTurn, resumeThreadState: freshStatus, turnStarts })
        )
      )
    )
    expect(result.first._tag).toBe(failedFirstTurn ? "NotPrepared" : "PreparedCandidate")
    expect(result.replay._tag).toBe("IntegratorCallFailure")
    expect(result.replay.detail).toContain("terminal turn status")
    expect(turnStarts.value).toBe(1)
  })

  it("fails closed on a registered candidate whose path is missing or prunable", async () => {
    for (const [name, options] of [
      ["missing", { preRegisteredWorktree: true }],
      ["prunable", { preRegisteredWorktree: true, preRegisteredWorktreePathExists: true, prunableWorktree: true }]
    ] as const) {
      const config = CodexIntegratorConfiguration.make({
        candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
        commonDirectory,
        privateStoreLocator: IntegratorPrivateStoreLocator.make(
          `/tmp/dalph-integrator-test/${name}-worktree-store.json`
        ),
        repository
      })
      const turnStarts = { value: 0 }
      const failure = await Effect.runPromise(
        Effect.gen(function* () {
          const integrator = yield* Integrator
          return yield* Effect.flip(integrator.prepare(requestFor(1)))
        }).pipe(Effect.provide(providerLayer(config, { ...options, turnStarts })))
      )
      expect(failure._tag).toBe("IntegratorCallFailure")
      expect(turnStarts.value).toBe(0)
    }
  })

  it("rereads an exact registration after a lost candidate-worktree response", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/lost-worktree-store.json"),
      repository
    })
    const worktreeAdds = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(Effect.provide(providerLayer(config, { loseFirstWorktreeAddResponse: true, worktreeAdds })))
    )
    expect(result._tag).toBe("PreparedCandidate")
    expect(worktreeAdds.value).toBe(1)
  })

  it("crosses candidate Git mutations only inside coordinator ownership", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/ownership-store.json"),
      repository
    })
    const ownershipCalls: Array<"enter" | "exit"> = []
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const authority = yield* IntegratorCandidateProviderAuthority
        return yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
      }).pipe(Effect.provide(providerLayer(config, { gitCalls, ownershipCalls })))
    )
    expect(result._tag).toBe("Removed")
    expect(ownershipCalls).toEqual(["enter", "exit", "enter", "exit"])
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "add")).toHaveLength(1)
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(1)
  })

  it("cannot construct the provider service when coordinator ownership is absent", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/missing-ownership-store.json"
      ),
      repository
    })
    const dependencies = Layer.mergeAll(
      NodeFileSystem.layer,
      memoryCodexIntegratorPrivateStoreLayer(),
      fixtureLayerWithoutOwnership().pipe(Layer.provide(NodeFileSystem.layer)),
      controlledCodexOwnedActivityCensusLayer({
        observe: () => Effect.succeed({ _tag: "Absent" as const }),
        terminateDescendants: () => Effect.void
      })
    )
    const missingOwnership = codexIntegratorLayer(config).pipe(Layer.provideMerge(dependencies))
    expectTypeOf(missingOwnership).toMatchTypeOf<
      Layer.Layer<Integrator | IntegratorCandidateProviderAuthority, never, CoordinatorOwnership>
    >()
  })

  it("starts exactly one fresh run-two turn on the retained session resources", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/retry-store.json"),
      repository
    })
    const threadStarts = { value: 0 }
    const turnStarts = { value: 0 }
    const turnTokens: Array<CodexOwnedTurnToken> = []
    const worktreeAdds = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const second = yield* integrator.prepare(requestFor(2))
        return { first, second }
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            envelopes: [
              '{"version":1,"outcome":"PreparedCandidate","candidate":"M1"}',
              '{"version":1,"outcome":"PreparedCandidate","candidate":"M2"}'
            ],
            threadStarts,
            turnStarts,
            turnTokens,
            worktreeAdds
          })
        )
      )
    )
    expect(result.first._tag).toBe("PreparedCandidate")
    expect(result.second._tag).toBe("PreparedCandidate")
    expect(result.second.correlation.ordinal).toBe(2)
    expect(result.first._tag === "PreparedCandidate" ? result.first.candidateText : "").toBe("M1")
    expect(result.second._tag === "PreparedCandidate" ? result.second.candidateText : "").toBe("M2")
    expect(worktreeAdds.value).toBe(1)
    expect(threadStarts.value).toBe(1)
    expect(turnStarts.value).toBe(2)
    expect(turnTokens).toHaveLength(2)
    expect(turnTokens[1]).not.toBe(turnTokens[0])
  })

  it("checks retained thread activity before recording a fresh run-two token", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/retry-live-writer-store.json"
      ),
      repository
    })
    const privateWrites: Array<CodexIntegratorPrivateRecord> = []
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const writesAfterRunOne = privateWrites.length
        const retryFailure = yield* Effect.flip(integrator.prepare(requestFor(2)))
        const store = yield* CodexIntegratorPrivateStore
        return { first, retryFailure, stored: yield* store.read(session.sessionId), writesAfterRunOne }
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            activitySequence: [
              { _tag: "Absent" },
              { _tag: "Absent" },
              {
                _tag: "ExactLive",
                activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("foreign-retry-writer") }]
              }
            ],
            privateWrites,
            turnStarts
          })
        )
      )
    )
    expect(result.first._tag).toBe("PreparedCandidate")
    expect(result.retryFailure.detail).toContain("still live")
    expect(privateWrites).toHaveLength(result.writesAfterRunOne)
    expect(Option.isSome(result.stored) ? privateRuns(result.stored.value) : []).toHaveLength(1)
    expect(turnStarts.value).toBe(1)
  })

  it("restarts an unfinished run two with its same durable token", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/retry-recovery-store.json"),
      repository
    })
    const turnStarts = { value: 0 }
    const turnTokens: Array<CodexOwnedTurnToken> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        const lost = yield* Effect.flip(integrator.prepare(requestFor(2)))
        const recovered = yield* integrator.prepare(requestFor(2))
        const store = yield* CodexIntegratorPrivateStore
        const stored = yield* store.read(session.sessionId)
        if (Option.isNone(stored)) return yield* Effect.fail("run-two private record was lost")
        const runTwo = privateRuns(stored.value).find(
          (item) => item.correlation.ordinal === IntegratorRunOrdinal.make(2)
        )
        if (runTwo === undefined) return yield* Effect.fail("run-two private token was lost")
        return { first, lost, recovered, runTwoToken: runTwo.token }
      }).pipe(Effect.provide(providerLayer(config, { turnStarts, turnTokens, failAfterRecordingSecondTurn: true })))
    )
    expect(result.first._tag).toBe("PreparedCandidate")
    expect(result.lost._tag).toBe("IntegratorCallFailure")
    expect(result.recovered._tag).toBe("PreparedCandidate")
    expect(result.recovered.correlation.ordinal).toBe(2)
    expect(turnStarts.value).toBe(2)
    expect(turnTokens).toHaveLength(2)
    expect(result.runTwoToken).toBe(turnTokens[1])
  })

  it("materializes a FullRerun successor with distinct provider resources", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/successor-store.json"),
      repository
    })
    const predecessorPath = candidateWorktreePathFor(config, session.candidateResource)
    const successorPath = candidateWorktreePathFor(config, successorSession.candidateResource)
    const predecessorRun = requestFor(1).correlation
    const predecessorResult = IntegratorResult.cases.NotPrepared.make({
      correlation: predecessorRun,
      detail: IntegratorNotPreparedDetail.make("retained predecessor result")
    })
    const predecessorRecord = CodexIntegratorPrivateRecord.cases.ThreadWithRuns.make({
      appServerIncarnation: CodexServerIncarnation.make("predecessor-incarnation"),
      candidatePath: predecessorPath,
      correlation: session,
      initialRun: predecessorRun,
      revision: revision(9),
      runs: [
        CodexIntegratorPrivateRun.cases.CompletedTurnSealed.make({
          correlation: predecessorRun,
          result: predecessorResult,
          token: CodexOwnedTurnToken.make("predecessor-turn-token"),
          turnId: CodexTurnId.make("predecessor-turn")
        })
      ],
      threadId: CodexThreadId.make("predecessor-thread"),
      threadToken: CodexThreadOwnershipToken.make("predecessor-thread-token")
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const privateWrites: Array<CodexIntegratorPrivateRecord> = []
    const threadStarts = { value: 0 }
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const prepared = yield* integrator.prepare(requestForSession(successorSession, 1))
        const replayed = yield* integrator.prepare(requestForSession(successorSession, 1))
        const store = yield* CodexIntegratorPrivateStore
        return {
          predecessor: yield* store.read(session.sessionId),
          prepared,
          replayed,
          successor: yield* store.read(successorSession.sessionId)
        }
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            gitCalls,
            initialRecords: [predecessorRecord],
            privateWrites,
            threadStarts,
            turnStarts,
            worktreePath: successorPath
          })
        )
      )
    )
    expect(result.prepared._tag).toBe("PreparedCandidate")
    expect(result.prepared.correlation.session.sessionId).toBe(successorSession.sessionId)
    expect(result.replayed).toEqual(result.prepared)
    expect(successorPath).not.toBe(predecessorPath)
    expect(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add" && args.includes(successorPath))).toBe(
      true
    )
    expect(gitCalls.some((args) => args.includes(predecessorPath))).toBe(false)
    expect(result.predecessor).toEqual(Option.some(predecessorRecord))
    expect(Option.isSome(result.successor)).toBe(true)
    if (Option.isSome(result.successor)) {
      const successorRecord = result.successor.value
      const successorRun = privateRuns(successorRecord)[0]
      expect(successorRecord.correlation.candidateResource).not.toBe(predecessorRecord.correlation.candidateResource)
      expect(successorRecord.threadToken).not.toBe(predecessorRecord.threadToken)
      expect(successorRecord._tag).toBe("ThreadWithRuns")
      if (successorRecord._tag === "ThreadWithRuns") {
        expect(successorRecord.threadId).not.toBe(predecessorRecord.threadId)
      }
      expect(successorRun?.token).not.toBe(privateRuns(predecessorRecord)[0]?.token)
      expect(successorRun?.correlation).toEqual(result.prepared.correlation)
    }
    expect(privateWrites.every((record) => record.correlation.sessionId === successorSession.sessionId)).toBe(true)
    expect(threadStarts.value).toBe(1)
    expect(turnStarts.value).toBe(1)
  })

  it("rejects a foreign Git registration before starting a provider turn", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/foreign-git-store.json"),
      repository
    })
    const turnStarts = { value: 0 }
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(Effect.provide(providerLayer(config, { foreignWorktree: true, turnStarts })))
    )
    expect(failure._tag).toBe("IntegratorCallFailure")
    expect(failure.detail).toContain("foreign")
    expect(turnStarts.value).toBe(0)
  })

  it("rejects a second session that tries to adopt the predecessor candidate path", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/foreign-session-store.json"),
      repository
    })
    const turnStarts = { value: 0 }
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        return yield* Effect.flip(integrator.prepare(requestForSession(foreignSession, 1)))
      }).pipe(Effect.provide(providerLayer(config, { turnStarts })))
    )
    expect(failure._tag).toBe("IntegratorCallFailure")
    expect(failure.detail).toContain("already owned")
    expect(turnStarts.value).toBe(1)
  })

  it("rejects a foreign persistent thread before starting a provider turn", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/foreign-thread-store.json"),
      repository
    })
    const turnStarts = { value: 0 }
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(Effect.provide(providerLayer(config, { foreignThread: true, turnStarts })))
    )
    expect(failure._tag).toBe("IntegratorCallFailure")
    expect(failure.detail).toContain("foreign")
    expect(turnStarts.value).toBe(0)
  })

  it("rejects a pre-existing sole candidate thread without a durable start intent", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/preexisting-thread-store.json"
      ),
      repository
    })
    const threadStarts = { value: 0 }
    const turnStarts = { value: 0 }
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(Effect.provide(providerLayer(config, { preexistingThread: true, threadStarts, turnStarts })))
    )
    expect(failure._tag).toBe("IntegratorCallFailure")
    expect(failure.detail).toContain("unowned")
    expect(threadStarts.value).toBe(0)
    expect(turnStarts.value).toBe(0)
  })

  it("sanitizes malformed output only after the writer census is absent", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/malformed-store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestFor(1))
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            envelopes: ['{"version":1,"outcome":"PreparedCandidate","candidate":"M","extra":true}']
          })
        )
      )
    )
    expect(result._tag).toBe("NotPrepared")
    expect(result._tag === "NotPrepared" ? result.detail : "").toContain("malformed")
    expect(result._tag === "NotPrepared" ? result.detail : "").not.toContain("extra")
  })

  it("recovers a lost turn response without allocating a second token", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/lost-response-store.json"),
      repository
    })
    const turnStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const recovered = yield* integrator.prepare(requestFor(1))
        return { first, recovered }
      }).pipe(Effect.provide(providerLayer(config, { failAfterRecordingFirstTurn: true, turnStarts })))
    )
    expect(result.first._tag).toBe("IntegratorCallFailure")
    expect(result.recovered._tag).toBe("PreparedCandidate")
    expect(result.recovered.correlation.ordinal).toBe(1)
    expect(turnStarts.value).toBe(1)
  })

  it.each(["tokenless", "foreign"] as const)(
    "fails closed on a %s terminal turn without starting a replacement",
    async (turnTokenMode) => {
      const config = CodexIntegratorConfiguration.make({
        candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
        commonDirectory,
        privateStoreLocator: IntegratorPrivateStoreLocator.make(
          `/tmp/dalph-integrator-test/${turnTokenMode}-terminal-store.json`
        ),
        repository
      })
      const turnStarts = { value: 0 }
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const integrator = yield* Integrator
          const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
          const second = yield* Effect.flip(integrator.prepare(requestFor(1)))
          return { first, second }
        }).pipe(Effect.provide(providerLayer(config, { turnStarts, turnTokenMode })))
      )
      expect(result.first._tag).toBe("IntegratorCallFailure")
      expect(result.second._tag).toBe("IntegratorCallFailure")
      expect(result.second.detail).toContain("token")
      expect(turnStarts.value).toBe(1)
    }
  )

  it("seals a failed provider turn only as sanitized NotPrepared", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/failed-turn-store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const prepared = yield* integrator.prepare(requestFor(1))
        const store = yield* CodexIntegratorPrivateStore
        const stored = yield* store.read(session.sessionId)
        return { prepared, stored }
      }).pipe(Effect.provide(providerLayer(config, { failedTerminalTurn: true })))
    )
    expect(result.prepared._tag).toBe("NotPrepared")
    expect(result.prepared._tag === "NotPrepared" ? result.prepared.detail : "").toBe(
      "Codex provider turn failed before producing a candidate"
    )
    expect(Option.isSome(result.stored)).toBe(true)
    if (Option.isSome(result.stored)) {
      expect(privateRuns(result.stored.value)[0]?._tag).toBe("FailedTurnSealed")
      const sealed = privateRuns(result.stored.value)[0]
      expect(sealed?._tag === "FailedTurnSealed" ? sealed.result._tag : undefined).toBe("NotPrepared")
    }
  })

  it("reconciles a lost thread-start response through the complete thread list", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/lost-thread-store.json"),
      repository
    })
    const threadStarts = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const recovered = yield* integrator.prepare(requestFor(1))
        return { first, recovered }
      }).pipe(Effect.provide(providerLayer(config, { loseFirstThreadResponse: true, threadStarts })))
    )
    expect(result.first._tag).toBe("IntegratorCallFailure")
    expect(result.recovered._tag).toBe("PreparedCandidate")
    expect(threadStarts.value).toBe(1)
  })

  it("reissues the same turn token after a proved complete absence", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/lost-turn-store.json"),
      repository
    })
    const turnTokens: Array<CodexOwnedTurnToken> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const recovered = yield* integrator.prepare(requestFor(1))
        return { first, recovered }
      }).pipe(Effect.provide(providerLayer(config, { failBeforeRecordingFirstTurn: true, turnTokens })))
    )
    expect(result.first._tag).toBe("IntegratorCallFailure")
    expect(result.recovered._tag).toBe("PreparedCandidate")
    expect(turnTokens).toHaveLength(2)
    expect(turnTokens[0]).toBe(turnTokens[1])
  })

  it("fails closed on duplicate persistent threads", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/duplicate-thread-store.json"),
      repository
    })
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const second = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, second }
      }).pipe(Effect.provide(providerLayer(config, { duplicateThreads: true, loseFirstThreadResponse: true })))
    )
    expect(failure.first._tag).toBe("IntegratorCallFailure")
    expect(failure.second._tag).toBe("IntegratorCallFailure")
    expect(failure.second.detail).toContain("duplicate")
  })

  it("fails closed on duplicate exact turn tokens", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/duplicate-turn-store.json"),
      repository
    })
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const second = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, second }
      }).pipe(Effect.provide(providerLayer(config, { duplicateTurnToken: true, failAfterRecordingFirstTurn: true })))
    )
    expect(failure.first._tag).toBe("IntegratorCallFailure")
    expect(failure.second._tag).toBe("IntegratorCallFailure")
    expect(failure.second.detail).toContain("duplicated")
  })

  it("fails closed while an owned writer remains live", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/live-store.json"),
      repository
    })
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            activity: { _tag: "ExactLive", activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("live-turn") }] }
          })
        )
      )
    )
    expect(failure._tag).toBe("IntegratorCallFailure")
    expect(failure.correlation.ordinal).toBe(1)
    expect(failure.detail).toContain("still live")
  })

  it("removes only the authorized predecessor and preserves every successor resource", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/cleanup-store.json"),
      repository
    })
    const successorPath = candidateWorktreePathFor(config, successorSession.candidateResource)
    const successorRun = requestForSession(successorSession, 1).correlation
    const successorResult = IntegratorResult.cases.NotPrepared.make({
      correlation: successorRun,
      detail: IntegratorNotPreparedDetail.make("retained successor result")
    })
    const successorRecord = CodexIntegratorPrivateRecord.cases.ThreadWithRuns.make({
      appServerIncarnation: CodexServerIncarnation.make("successor-incarnation"),
      candidatePath: successorPath,
      correlation: successorSession,
      initialRun: successorRun,
      revision: revision(9),
      runs: [
        CodexIntegratorPrivateRun.cases.CompletedTurnSealed.make({
          correlation: successorRun,
          result: successorResult,
          token: CodexOwnedTurnToken.make("successor-turn-token"),
          turnId: CodexTurnId.make("successor-turn")
        })
      ],
      threadId: CodexThreadId.make("successor-thread"),
      threadToken: CodexThreadOwnershipToken.make("successor-thread-token")
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const store = yield* CodexIntegratorPrivateStore
        const successorBefore = yield* store.read(successorSession.sessionId)
        const authority = yield* IntegratorCandidateProviderAuthority
        const observed = yield* authority.observe(cleanupAuthorization)
        const removed = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
        const after = yield* authority.observe(cleanupAuthorization)
        const successorAfter = yield* store.read(successorSession.sessionId)
        return { after, observed, removed, successorAfter, successorBefore }
      }).pipe(Effect.provide(providerLayer(config, { gitCalls, initialRecords: [successorRecord] })))
    )
    expect(result.observed._tag).toBe("Present")
    expect(result.removed._tag).toBe("Removed")
    expect(result.after._tag).toBe("Absent")
    expect(result.successorBefore).toEqual(Option.some(successorRecord))
    expect(result.successorAfter).toEqual(result.successorBefore)
    const removals = gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")
    expect(removals).toEqual([["worktree", "remove", "--force", "--", candidatePath]])
    expect(gitCalls.some((args) => args.includes(successorPath))).toBe(false)
    expect(gitCalls.some((args) => args.includes(session.integrationTarget.ref))).toBe(false)
    expect(gitCalls.some((args) => args.includes(session.acceptedResult.commit))).toBe(false)
    expect(gitCalls.some((args) => args.includes(session.plannedAttempt.worktree))).toBe(false)
  })

  it("returns foreign live-writer evidence and performs zero removal requests", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/cleanup-live-store.json"),
      repository
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const authority = yield* IntegratorCandidateProviderAuthority
        const observed = yield* authority.observe(cleanupAuthorization)
        const removed = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
        return { observed, removed }
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            activitySequence: [
              { _tag: "Absent" },
              { _tag: "Absent" },
              { _tag: "ExactLive", activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("cleanup-live-turn") }] }
            ],
            gitCalls
          })
        )
      )
    )
    expect(result.observed._tag).toBe("Foreign")
    expect(result.removed._tag).toBe("DefinitelyNotApplied")
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(0)
  })

  it("returns foreign other-session evidence and performs zero removal requests", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/cleanup-other-session-store.json"
      ),
      repository
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestForSession(foreignSession, 1))
        const authority = yield* IntegratorCandidateProviderAuthority
        const observed = yield* authority.observe(cleanupAuthorization)
        const removed = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
        return { observed, removed }
      }).pipe(Effect.provide(providerLayer(config, { gitCalls })))
    )
    expect(result.observed._tag).toBe("Foreign")
    expect(result.observed._tag === "Foreign" ? result.observed.reason : "").toBe("OtherSession")
    expect(result.removed._tag).toBe("DefinitelyNotApplied")
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(0)
  })

  it("returns transferred-registration evidence and performs zero removal requests", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/cleanup-transferred-store.json"
      ),
      repository
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const registration = { value: false }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        registration.value = true
        const authority = yield* IntegratorCandidateProviderAuthority
        const observed = yield* authority.observe(cleanupAuthorization)
        const removed = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
        return { observed, removed }
      }).pipe(Effect.provide(providerLayer(config, { foreignWorktreeState: registration, gitCalls })))
    )
    expect(result.observed._tag).toBe("Foreign")
    expect(result.observed._tag === "Foreign" ? result.observed.reason : "").toBe("Transferred")
    expect(result.removed._tag).toBe("DefinitelyNotApplied")
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(0)
  })

  it("returns unreadable activity evidence and performs zero removal requests", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/cleanup-unreadable-store.json"
      ),
      repository
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const authority = yield* IntegratorCandidateProviderAuthority
        const observed = yield* authority.observe(cleanupAuthorization)
        const removed = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
        return { observed, removed }
      }).pipe(
        Effect.provide(
          providerLayer(config, {
            activitySequence: [
              { _tag: "Absent" },
              { _tag: "Absent" },
              { _tag: "Unreadable", detail: "activity census unavailable" }
            ],
            gitCalls
          })
        )
      )
    )
    expect(result.observed._tag).toBe("Unreadable")
    expect(result.removed._tag).toBe("DefinitelyNotApplied")
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(0)
  })

  it("fails closed when cleanup authorization carries a stale private revision", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/stale-cleanup-store.json"),
      repository
    })
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const authority = yield* IntegratorCandidateProviderAuthority
        const stale = IntegratorCandidateCleanupAuthorization.make({
          ...cleanupAuthorization,
          evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(8)
        })
        const observed = yield* authority.observe(stale)
        const removed = yield* authority.remove(stale, CleanupMutationOrdinal.make(1))
        return { observed, removed }
      }).pipe(Effect.provide(providerLayer(config, { gitCalls })))
    )
    expect(result.observed._tag).toBe("Unreadable")
    expect(result.removed._tag).toBe("DefinitelyNotApplied")
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(0)
  })

  it("does not infer absence while an unresolved thread intent remains", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/unresolved-cleanup-store.json"
      ),
      repository
    })
    const registration: { value: "exact" | "foreign" | "missing" } = { value: "exact" }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const store = yield* CodexIntegratorPrivateStore
        const current = yield* store.read(session.sessionId)
        if (Option.isNone(current)) return yield* Effect.fail("private record was not written")
        yield* store.write(
          CodexIntegratorPrivateRecord.cases.ThreadStartIntentRecorded.make(preservedPrivateRecordFields(current.value))
        )
        const fileSystem = yield* FileSystem.FileSystem
        yield* fileSystem.remove(candidatePath, { recursive: true })
        registration.value = "missing"
        const authority = yield* IntegratorCandidateProviderAuthority
        return yield* authority.observe(cleanupAuthorization)
      }).pipe(Effect.provide(providerLayer(config, { worktreeRegistrationState: registration })))
    )
    expect(result._tag).toBe("Unreadable")
  })

  it("reconciles a failed exact removal before retrying the same resource", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/retry-removal-store.json"),
      repository
    })
    const worktreeRemoves = { value: 0 }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const authority = yield* IntegratorCandidateProviderAuthority
        const first = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
        const second = yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(2))
        return { first, second }
      }).pipe(Effect.provide(providerLayer(config, { failFirstWorktreeRemoveWithoutApplying: true, worktreeRemoves })))
    )
    expect(result.first._tag).toBe("Unknown")
    expect(result.second._tag).toBe("Removed")
    expect(worktreeRemoves.value).toBe(2)
  })

  it("rereads exact absence after a lost candidate-removal response", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/lost-removal-store.json"),
      repository
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const authority = yield* IntegratorCandidateProviderAuthority
        return yield* authority.remove(cleanupAuthorization, CleanupMutationOrdinal.make(1))
      }).pipe(Effect.provide(providerLayer(config, { loseFirstWorktreeRemoveResponse: true })))
    )
    expect(result._tag).toBe("AlreadyAbsent")
  })

  it("fails closed on unreadable activity and listed threads without the exact token", async () => {
    const activityConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/unreadable-activity-store.json"
      ),
      repository
    })
    const activityFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(
        Effect.provide(
          providerLayer(activityConfig, {
            activity: { _tag: "Contradictory", detail: "activity census contradiction" }
          })
        )
      )
    )
    expect(activityFailure._tag).toBe("IntegratorCallFailure")
    expect(activityFailure.detail).toContain("contradictory")

    const listedConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/foreign-listed-store.json"),
      repository
    })
    const listedFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* Effect.flip(integrator.prepare(requestFor(1)))
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(
        Effect.provide(
          providerLayer(listedConfig, {
            loseFirstThreadResponse: true,
            listedThreadTokenMode: "foreign",
            resumeThreadTokenMode: "foreign"
          })
        )
      )
    )
    expect(listedFailure._tag).toBe("IntegratorCallFailure")
    expect(listedFailure.detail).toContain("token")
  })

  it("distinguishes unresolved thread-start recovery from a retry with the same intent", async () => {
    const retryConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/thread-intent-retry-store.json"
      ),
      repository
    })
    const partialThreadStarts = { value: 0 }
    const partialTurnStarts = { value: 0 }
    const retry = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const second = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, second }
      }).pipe(
        Effect.provide(
          providerLayer(retryConfig, {
            loseFirstThreadResponse: true,
            listThreadsHidePersisted: true,
            threadStarts: partialThreadStarts,
            turnStarts: partialTurnStarts
          })
        )
      )
    )
    expect(retry.first._tag).toBe("IntegratorCallFailure")
    expect(retry.second._tag).toBe("IntegratorCallFailure")
    expect(retry.second.detail).toContain("incomplete")
    expect(partialThreadStarts.value).toBe(0)
    expect(partialTurnStarts.value).toBe(0)

    const unresolvedConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/unresolved-thread-store.json"
      ),
      repository
    })
    const unavailableThreadStarts = { value: 0 }
    const unavailableTurnStarts = { value: 0 }
    const unresolved = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* Effect.flip(integrator.prepare(requestFor(1)))
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(
        Effect.provide(
          providerLayer(unresolvedConfig, {
            loseFirstThreadResponse: true,
            threadListingUnavailable: true,
            threadStarts: unavailableThreadStarts,
            turnStarts: unavailableTurnStarts
          })
        )
      )
    )
    expect(unresolved._tag).toBe("IntegratorCallFailure")
    expect(unresolved.detail).toContain("unavailable")
    expect(unavailableThreadStarts.value).toBe(0)
    expect(unavailableTurnStarts.value).toBe(0)
  })

  it("rejects retry ordinals without a sealed predecessor and above the retry limit", async () => {
    const retryConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/invalid-retry-store.json"),
      repository
    })
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const runTwo = yield* Effect.flip(integrator.prepare(requestFor(2)))
        const runThree = yield* Effect.flip(integrator.prepare(requestFor(3)))
        return { runThree, runTwo }
      }).pipe(Effect.provide(providerLayer(retryConfig)))
    )
    expect(failure.runTwo.detail).toContain("sealed run-one")
    expect(failure.runThree.detail).toContain("exceeds Retry")
  })

  it("rejects foreign resumed-thread tokens, correlated turns, and active turns", async () => {
    const resumedConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/foreign-resumed-store.json"),
      repository
    })
    const resumedFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(Effect.provide(providerLayer(resumedConfig, { resumeThreadTokenMode: "foreign" })))
    )
    expect(resumedFailure.detail).toContain("ownership token")

    const correlatedConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/correlated-turn-store.json"),
      repository
    })
    const correlatedFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const second = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, second }
      }).pipe(
        Effect.provide(
          providerLayer(correlatedConfig, { failAfterRecordingFirstTurn: true, persistedTurnCorrelation: true })
        )
      )
    )
    expect(correlatedFailure.first._tag).toBe("IntegratorCallFailure")
    expect(correlatedFailure.second.detail).toContain("correlation")

    const activeConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/active-turn-store.json"),
      repository
    })
    const activeFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(Effect.provide(providerLayer(activeConfig, { activeTurn: true })))
    )
    expect(activeFailure.detail).toContain("remains active")
  })

  it("fails closed on a turn observed without a matching token and reconciles app incarnation", async () => {
    const hiddenConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/hidden-turn-store.json"),
      repository
    })
    const hiddenFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* Effect.flip(integrator.prepare(requestFor(1)))
        const store = yield* CodexIntegratorPrivateStore
        const stored = yield* store.read(session.sessionId)
        if (Option.isNone(stored)) return yield* Effect.fail("private record was not written")
        const run = privateRuns(stored.value)[0]
        if (run === undefined) return yield* Effect.fail("provider run was not written")
        yield* store.write(
          updateRun(
            stored.value,
            run,
            CodexIntegratorPrivateRun.cases.TurnObserved.make({
              correlation: run.correlation,
              token: run.token,
              turnId: CodexTurnId.make("hidden-turn")
            })
          )
        )
        return yield* Effect.flip(integrator.prepare(requestFor(1)))
      }).pipe(Effect.provide(providerLayer(hiddenConfig, { failAfterRecordingFirstTurn: true, hideTurnsOnRead: true })))
    )
    expect(hiddenFailure.detail).toContain("not readable")

    const incarnation = { value: CodexServerIncarnation.make("first-incarnation") }
    const incarnationConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/incarnation-store.json"),
      repository
    })
    const reconciled = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* integrator.prepare(requestFor(1))
        incarnation.value = CodexServerIncarnation.make("second-incarnation")
        const second = yield* integrator.prepare(requestFor(1))
        return { first, second }
      }).pipe(Effect.provide(providerLayer(incarnationConfig, { appIncarnation: incarnation })))
    )
    expect(reconciled.first._tag).toBe("PreparedCandidate")
    expect(reconciled.second._tag).toBe("PreparedCandidate")
  })

  it("rejects a tombstoned or path-mismatched private record and a foreign repository request", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/reconcile-record-store.json"),
      repository
    })
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        yield* integrator.prepare(requestFor(1))
        const store = yield* CodexIntegratorPrivateStore
        const stored = yield* store.read(session.sessionId)
        if (Option.isNone(stored)) return yield* Effect.fail("private record was not written")
        yield* store.write(
          Schema.decodeUnknownSync(CodexIntegratorPrivateRecord)({
            ...stored.value,
            candidatePath: IntegratorCandidateWorktreePath.make("/tmp/foreign-private-candidate")
          })
        )
        const pathFailure = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const tombstone = removedRecordFor(stored.value)
        if (tombstone === undefined) return yield* Effect.fail("sealed private result was not written")
        yield* store.write(tombstone)
        const tombstoneFailure = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { pathFailure, tombstoneFailure }
      }).pipe(Effect.provide(providerLayer(config)))
    )
    expect(failure.pathFailure.detail).toContain("candidate path")
    expect(failure.tombstoneFailure.detail).toContain("tombstoned")

    const foreignRepositorySession = IntegratorSessionCorrelation.make({
      ...session,
      integrationTarget: IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/tmp/foreign-target.git"),
        ref: IntegrationTargetRef.make("refs/heads/main")
      }),
      sessionId: IntegratorSessionId.make("foreign-repository-session")
    })
    const foreignConfig = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory,
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/foreign-repository-store.json"
      ),
      repository
    })
    const repositoryFailure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* Effect.flip(integrator.prepare(requestForSession(foreignRepositorySession, 1)))
      }).pipe(Effect.provide(providerLayer(foreignConfig)))
    )
    expect(repositoryFailure.detail).toContain("configured canonical repository")
  })
})
