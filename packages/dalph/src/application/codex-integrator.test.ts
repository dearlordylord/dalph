import { NodeFileSystem } from "@effect/platform-node"
import {
  AcceptedResult,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Ref } from "effect"
import { describe, expect, it } from "vitest"
import {
  CodexIntegratorConfiguration,
  CodexIntegratorPrivateStore,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  candidateWorktreePathFor,
  codexIntegratorLayer,
  memoryCodexIntegratorPrivateStoreLayer
} from "./codex-integrator.js"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexOwnedActivityCensus,
  controlledCodexOwnedActivityCensusLayer,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection
} from "./codex-app-server.js"
import { CodexServerIncarnation, CodexThreadId, CodexTurnId, type CodexOwnedTurnToken } from "./codex-attempt-store.js"
import {
  CleanupMutationOrdinal,
  CoordinatorOwnership,
  GitCommand,
  Integrator,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateProviderAuthority,
  IntegratorCandidateResourceLocator,
  IntegratorRequest,
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
const targetHead = sha("a")
const acceptedCommit = sha("b")
const resource = IntegratorCandidateResourceLocator.make("candidate:test")
const target = IntegrationTarget.make({ repository, ref: IntegrationTargetRef.make("refs/heads/main") })
const candidatePath = candidateWorktreePathFor(
  CodexIntegratorConfiguration.make({
    candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
    commonDirectory: "/repositories/integrator-test.git",
    privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/store.json"),
    repository
  }),
  resource
)
const session = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: acceptedCommit,
    evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: "0".repeat(64) })
  }),
  candidateResource: resource,
  expectedTargetHead: targetHead,
  integrationTarget: target,
  plannedAttempt: PlannedTaskAttempt.make({
    attemptId: "attempt",
    baseSha: targetHead,
    branch: TaskBranchRef.make("refs/heads/task"),
    executor: TaskExecutorLocator.make("executor"),
    runId: "run",
    taskId: TaskId.make("task"),
    taskRevision: TaskRevision.make("revision"),
    worktree: WorktreeLocator.make("/planned/worktree")
  }),
  queuedAt: JournalPosition.make(1),
  sessionId: "session",
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
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
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
  readonly enableThreadListing?: boolean
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
  readonly worktreePath?: string
  readonly failBeforeRecordingFirstTurn?: boolean
  readonly failAfterRecordingFirstTurn?: boolean
  readonly failAfterRecordingSecondTurn?: boolean
  readonly precedingItems?: ReadonlyArray<unknown>
  readonly gitCalls?: Array<ReadonlyArray<string>>
  readonly threadStarts?: { value: number }
  readonly turnTokens?: Array<CodexOwnedTurnToken>
  readonly turnStarts?: { value: number }
  readonly worktreeAdds?: { value: number }
  readonly ownershipCalls?: Array<"enter" | "exit">
  readonly includeOwnership?: boolean
}

const fixtureLayer = (options: FixtureOptions = {}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const registered = yield* Ref.make(options.foreignWorktree === true || options.preRegisteredWorktree === true)
      const fileSystem = yield* FileSystem.FileSystem
      const fixtureWorktreePath = options.worktreePath ?? candidatePath
      if (options.preRegisteredWorktreePathExists === true) {
        yield* fileSystem.makeDirectory(fixtureWorktreePath, { recursive: true })
      }
      const persistentThreads = yield* Ref.make<ReadonlyArray<CodexThreadId>>(
        options.preexistingThread === true ? [CodexThreadId.make("fixture-thread")] : []
      )
      const turns = yield* Ref.make<
        ReadonlyArray<{
          readonly id: CodexTurnId
          readonly status: "completed"
          readonly items: ReadonlyArray<unknown>
          readonly ownedTurnToken: CodexOwnedTurnToken
        }>
      >([])
      const app: CodexAppServerService = {
        incarnation: CodexServerIncarnation.make("fixture-incarnation"),
        startThread: (cwd) =>
          Effect.gen(function* () {
            if (options.threadStarts !== undefined) options.threadStarts.value += 1
            const thread = {
              id: CodexThreadId.make("fixture-thread"),
              cwd,
              status: "idle" as const,
              turns: [],
              ...(options.foreignThread === true
                ? {
                    correlation: PlannedAttemptExecutorCorrelation.make({
                      attemptId: "foreign-attempt",
                      runId: "foreign-run"
                    })
                  }
                : {})
            }
            yield* Ref.update(persistentThreads, (current) => [...current, thread.id])
            if (options.enableThreadListing === true && options.loseFirstThreadResponse === true) {
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
        listThreads:
          options.enableThreadListing === true
            ? () =>
                Ref.get(persistentThreads).pipe(
                  Effect.map((threads) =>
                    (options.duplicateThreads === true ? [...threads, ...threads] : threads).map((id) => ({
                      id,
                      cwd: fixtureWorktreePath,
                      status: "idle" as const,
                      turns: []
                    }))
                  )
                )
            : undefined,
        readThread: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(turns)
            return {
              id: CodexThreadId.make("fixture-thread"),
              cwd: fixtureWorktreePath,
              status: "idle" as const,
              turns: current
            }
          }),
        resumeThread: (_threadId, cwd) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(turns)
            return { id: CodexThreadId.make("fixture-thread"), cwd, status: "idle" as const, turns: current }
          }),
        startTurn: (_threadId, cwd, _prompt, token) =>
          Effect.gen(function* () {
            if (token === undefined) return yield* Effect.die("missing provider token")
            if (options.turnStarts !== undefined) options.turnStarts.value += 1
            if (options.turnTokens !== undefined) options.turnTokens.push(token)
            const priorTurns = yield* Ref.get(turns)
            const turn = {
              id: CodexTurnId.make(`fixture-turn-${token}`),
              status: "completed" as const,
              ownedTurnToken: token,
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
            return { ...turn, id: turn.id, status: turn.status, items: turn.items, ownedTurnToken: token }
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
                      stdout: `worktree ${fixtureWorktreePath}\nHEAD ${sha("c")}\nbranch refs/heads/foreign\n\n`
                    }
                  : {
                      exitCode: 0,
                      stderr: "",
                      stdout: `worktree ${fixtureWorktreePath}\nHEAD ${targetHead}\ndetached\n${
                        options.prunableWorktree === true ? "prunable stale\n" : ""
                      }\n`
                    }
                : { exitCode: 0, stderr: "", stdout: "" }
            }
            if (args[0] === "worktree" && args[1] === "add") {
              if (options.worktreeAdds !== undefined) options.worktreeAdds.value += 1
              yield* Ref.set(registered, true)
              yield* fileSystem.makeDirectory(fixtureWorktreePath, { recursive: true })
              if (options.loseFirstWorktreeAddResponse === true && options.worktreeAdds?.value === 1) {
                return {
                  exitCode: 1,
                  stderr: "worktree add response was lost after Git registered the worktree",
                  stdout: ""
                }
              }
            }
            if (args[0] === "worktree" && args[1] === "remove") {
              yield* Ref.set(registered, false)
              yield* fileSystem.remove(fixtureWorktreePath, { recursive: true })
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
      return options.includeOwnership === false ? context : Context.add(context, CoordinatorOwnership, ownership)
    })
  )

const providerLayer = (config: CodexIntegratorConfiguration, options: FixtureOptions = {}) =>
  codexIntegratorLayer(config).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeFileSystem.layer,
        memoryCodexIntegratorPrivateStoreLayer(),
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
  it("creates one candidate and returns the exact prepared envelope", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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

  it("keeps thread, turn, prompt, and private phases out of the public result", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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

  it("fails closed on a registered candidate whose path is missing or prunable", async () => {
    for (const [name, options] of [
      ["missing", { preRegisteredWorktree: true }],
      ["prunable", { preRegisteredWorktree: true, preRegisteredWorktreePathExists: true, prunableWorktree: true }]
    ] as const) {
      const config = CodexIntegratorConfiguration.make({
        candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
        commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
      privateStoreLocator: IntegratorPrivateStoreLocator.make(
        "/tmp/dalph-integrator-test/missing-ownership-store.json"
      ),
      repository
    })
    const dependencies = Layer.mergeAll(
      NodeFileSystem.layer,
      memoryCodexIntegratorPrivateStoreLayer(),
      fixtureLayer({ includeOwnership: false }).pipe(Layer.provide(NodeFileSystem.layer)),
      controlledCodexOwnedActivityCensusLayer({
        observe: () => Effect.succeed({ _tag: "Absent" as const }),
        terminateDescendants: () => Effect.void
      })
    )
    const missingOwnership = codexIntegratorLayer(config).pipe(Layer.provideMerge(dependencies))
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          yield* Integrator
        }).pipe(Effect.provide(missingOwnership as never))
      )
    )
    expect(exit._tag).toBe("Failure")
  })

  it("keeps run two distinct from the sealed run-one result", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/retry-store.json"),
      repository
    })
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
            ]
          })
        )
      )
    )
    expect(result.first._tag).toBe("PreparedCandidate")
    expect(result.second._tag).toBe("PreparedCandidate")
    expect(result.second.correlation.ordinal).toBe(2)
    expect(result.first._tag === "PreparedCandidate" ? result.first.candidateText : "").toBe("M1")
    expect(result.second._tag === "PreparedCandidate" ? result.second.candidateText : "").toBe("M2")
  })

  it("restarts an unfinished run two with its same durable token", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
        const runTwo = stored.value.runs.find((item) => item.correlation.ordinal === IntegratorRunOrdinal.make(2))
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

  it("materializes a FullRerun successor beneath a distinct candidate path", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/successor-store.json"),
      repository
    })
    const predecessorPath = candidateWorktreePathFor(config, session.candidateResource)
    const successorPath = candidateWorktreePathFor(config, successorSession.candidateResource)
    const gitCalls: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        return yield* integrator.prepare(requestForSession(successorSession, 1))
      }).pipe(Effect.provide(providerLayer(config, { gitCalls, worktreePath: successorPath })))
    )
    expect(result._tag).toBe("PreparedCandidate")
    expect(result.correlation.session.sessionId).toBe(successorSession.sessionId)
    expect(successorPath).not.toBe(predecessorPath)
    expect(gitCalls.some((args) => args[0] === "worktree" && args[1] === "add" && args.includes(successorPath))).toBe(
      true
    )
    expect(gitCalls.some((args) => args.includes(predecessorPath))).toBe(false)
  })

  it("rejects a foreign Git registration before starting a provider turn", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      }).pipe(
        Effect.provide(
          providerLayer(config, { enableThreadListing: true, preexistingThread: true, threadStarts, turnStarts })
        )
      )
    )
    expect(failure._tag).toBe("IntegratorCallFailure")
    expect(failure.detail).toContain("unowned")
    expect(threadStarts.value).toBe(0)
    expect(turnStarts.value).toBe(0)
  })

  it("sanitizes malformed output only after the writer census is absent", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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

  it("reconciles a lost thread-start response through the complete thread list", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      }).pipe(
        Effect.provide(
          providerLayer(config, { enableThreadListing: true, loseFirstThreadResponse: true, threadStarts })
        )
      )
    )
    expect(result.first._tag).toBe("IntegratorCallFailure")
    expect(result.recovered._tag).toBe("PreparedCandidate")
    expect(threadStarts.value).toBe(1)
  })

  it("reissues the same turn token after a proved complete absence", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/duplicate-thread-store.json"),
      repository
    })
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const integrator = yield* Integrator
        const first = yield* Effect.flip(integrator.prepare(requestFor(1)))
        const second = yield* Effect.flip(integrator.prepare(requestFor(1)))
        return { first, second }
      }).pipe(
        Effect.provide(
          providerLayer(config, { duplicateThreads: true, enableThreadListing: true, loseFirstThreadResponse: true })
        )
      )
    )
    expect(failure.first._tag).toBe("IntegratorCallFailure")
    expect(failure.second._tag).toBe("IntegratorCallFailure")
    expect(failure.second.detail).toContain("duplicate")
  })

  it("fails closed on duplicate exact turn tokens", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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

  it("observes and removes only the authorized predecessor resource", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
      privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-integrator-test/cleanup-store.json"),
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
        const after = yield* authority.observe(cleanupAuthorization)
        return { after, observed, removed }
      }).pipe(Effect.provide(providerLayer(config, { gitCalls })))
    )
    expect(result.observed._tag).toBe("Present")
    expect(result.removed._tag).toBe("Removed")
    expect(result.after._tag).toBe("Absent")
    expect(gitCalls.filter((args) => args[0] === "worktree" && args[1] === "remove")).toHaveLength(1)
    expect(gitCalls.some((args) => args.includes(candidatePath))).toBe(true)
  })

  it("returns foreign live-writer evidence and performs zero removal requests", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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
      commonDirectory: "/repositories/integrator-test.git",
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

  it("rereads exact absence after a lost candidate-removal response", async () => {
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-integrator-test"),
      commonDirectory: "/repositories/integrator-test.git",
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
})
