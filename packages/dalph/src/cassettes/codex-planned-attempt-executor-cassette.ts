import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorReport,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { GitCommand, memoryEvidenceStoreLayer, type GitCommandService } from "@dalph/orchestrator"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import {
  CodexAppServerFailure,
  controlledCodexAppServerLayer,
  controlledCodexOwnedActivityCensusLayer,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "../application/codex-app-server.js"
import {
  CodexAttemptStore,
  type CodexAttemptRecord,
  type CodexAttemptStoreService,
  CodexOwnedTurnToken,
  CodexServerIncarnation,
  CodexThreadId,
  CodexTurnId
} from "../application/codex-attempt-store.js"
import { codexPlannedAttemptExecutorLayer } from "../application/codex-planned-attempt-executor.js"
import {
  CodexPlannedAttemptExecutorCassette,
  type CodexPlannedAttemptExecutorCassette as CodexPlannedAttemptExecutorCassetteType
} from "./codex-planned-attempt-executor-cassette-domain.js"

const gitShaHexLength = 40
const acceptedCommit = GitCommitSha.make("a".repeat(gitShaHexLength))
const worktree = WorktreeLocator.make("/dalph/cassettes/codex-executor")
const specification = makeTaskWorkSpecification({
  body: "Run the maintained concrete Codex executor chronology.",
  taskId: TaskId.make("codex-cassette-task"),
  title: "Exercise the concrete Codex executor"
})
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:codex-cassette:0"),
  baseSha: GitCommitSha.make("1".repeat(gitShaHexLength)),
  branch: TaskBranchRef.make("refs/heads/dalph/codex-cassette"),
  executor: TaskExecutorLocator.make("executor:codex-app-server"),
  runId: RunId.make("run:codex-cassette"),
  taskId: specification.taskId,
  taskRevision: specification.fingerprint,
  worktree
})
const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
const recordKey = `${attempt.runId}\u0000${attempt.attemptId}`
const defaultOwnedTurnToken = CodexOwnedTurnToken.make("codex-cassette-owned-turn")
const unusedBoundary = Effect.die.bind(undefined, "the maintained Codex executor cassette must not cross this boundary")

const git: GitCommandService = {
  run: unusedBoundary,
  runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: `${acceptedCommit}\n` }),
  runBytesInWorktree: unusedBoundary
}

const unavailableTurnStart = new CodexAppServerFailure({
  detail: "the controlled turn/start response was lost",
  kind: "Unavailable",
  operation: "turn/start"
})

const makeHarness = Effect.fn("CodexExecutorCassette.makeHarness")(function* (loseTurnResponse: boolean) {
  const threadId = CodexThreadId.make("codex-cassette-thread")
  const threadStartCount = yield* Ref.make(0)
  const turnStartCount = yield* Ref.make(0)
  const records = yield* Ref.make<ReadonlyMap<string, CodexAttemptRecord>>(new Map())
  const thread = yield* Ref.make<CodexThreadSnapshot>({ id: threadId, cwd: worktree, status: "idle", turns: [] })
  const responseWasLost = yield* Ref.make(false)

  const updateTurn = (update: (turn: CodexTurnSnapshot) => CodexTurnSnapshot) =>
    Ref.update(
      thread,
      (current): CodexThreadSnapshot => ({ ...current, status: "idle", turns: current.turns.map(update) })
    )

  const observeOwnedActivity = (current: CodexThreadSnapshot): Effect.Effect<CodexOwnedActivityCensusProjection> =>
    Effect.succeed(
      current.turns.some((turn) => turn.status === "inProgress")
        ? {
            _tag: "ExactLive" as const,
            activities: current.turns
              .filter((turn) => turn.status === "inProgress")
              .map((turn) => ({ _tag: "ActiveTurn" as const, turnId: turn.id }))
          }
        : { _tag: "Absent" as const }
    )

  const app: CodexAppServerService = {
    incarnation: CodexServerIncarnation.make("codex-cassette-incarnation"),
    startThread: (cwd) =>
      Ref.updateAndGet(thread, (current) => ({ ...current, cwd })).pipe(
        Effect.tap(() => Ref.update(threadStartCount, (count) => count + 1))
      ),
    readThread: () => Ref.get(thread),
    resumeThread: (_threadId, cwd) => Ref.updateAndGet(thread, (current) => ({ ...current, cwd })),
    startTurn: (_threadId, cwd, _text, ownedTurnToken = defaultOwnedTurnToken) =>
      Effect.gen(function* () {
        const ordinal = yield* Ref.updateAndGet(turnStartCount, (count) => count + 1)
        const turn: CodexTurnSnapshot = {
          id: CodexTurnId.make(`codex-cassette-turn-${ordinal}`),
          status: "inProgress",
          items: [],
          ownedTurnToken
        }
        yield* Ref.update(
          thread,
          (current): CodexThreadSnapshot => ({ ...current, cwd, status: "active", turns: [...current.turns, turn] })
        )
        if (loseTurnResponse && !(yield* Ref.get(responseWasLost))) {
          yield* Ref.set(responseWasLost, true)
          return yield* unavailableTurnStart
        }
        return turn
      }),
    interruptTurn: (_threadId, turnId) =>
      updateTurn((turn) => (turn.id === turnId ? { ...turn, status: "interrupted" } : turn)),
    listBackgroundTerminals: () => Effect.succeed([]),
    terminateBackgroundTerminal: unusedBoundary,
    close: Effect.void
  }
  const store: CodexAttemptStoreService = {
    readAttempt: (runId, attemptId) => {
      return Ref.get(records).pipe(
        Effect.map((current) => {
          const found = current.get(`${runId}\u0000${attemptId}`)
          return found === undefined ? Option.none() : Option.some(found)
        })
      )
    },
    writeAttempt: (record) =>
      Ref.update(records, (current) =>
        new Map(current).set(`${record.correlationRunId}\u0000${record.correlationAttemptId}`, record)
      ),
    readServerLaunch: unusedBoundary,
    writeServerLaunch: unusedBoundary,
    clearServerLaunch: unusedBoundary,
    acquireServerLease: unusedBoundary,
    releaseServerLease: unusedBoundary
  }
  return {
    app,
    completeTurn: updateTurn((turn) => ({
      ...turn,
      status: "completed",
      items: [
        {
          type: "agentMessage",
          text: JSON.stringify({
            commit: acceptedCommit,
            correlation: { runId: attempt.runId, attemptId: attempt.attemptId }
          })
        }
      ]
    })),
    interruptForeignTurn: app.interruptTurn(threadId, CodexTurnId.make("codex-cassette-foreign-turn")),
    observeOwnedActivity,
    observeCurrentActivity: Ref.get(thread).pipe(Effect.flatMap(observeOwnedActivity)),
    currentRecord: Ref.get(records).pipe(Effect.map((current) => current.get(recordKey))),
    store,
    threadStartCount,
    turnStartCount
  }
})

export interface CodexPlannedAttemptExecutorCassetteRun {
  readonly cassette: CodexPlannedAttemptExecutorCassetteType
  readonly activeActivity: CodexOwnedActivityCensusProjection
  readonly privateRecord: CodexAttemptRecord | null
  readonly reports: ReadonlyArray<PlannedAttemptExecutorReport>
  readonly threadStartCount: number
  readonly turnStartCount: number
}

/** Preserves the cassette result's nullable diagnostic shape when no private record is available. */
export const codexAttemptRecordOrNull = (record: CodexAttemptRecord | undefined): CodexAttemptRecord | null =>
  record ?? null

/** Runs one maintained story through the concrete Codex planned-attempt executor layer. */
export const runCodexPlannedAttemptExecutorCassette = Effect.fn("CodexPlannedAttemptExecutorCassette.run")(function* (
  input: unknown
) {
  const cassette = yield* Schema.decodeUnknownEffect(CodexPlannedAttemptExecutorCassette)(input)
  const harness = yield* makeHarness(cassette.scenario === "LostTurnResponse")
  const dependencies = Layer.mergeAll(
    controlledCodexAppServerLayer(harness.app),
    controlledCodexOwnedActivityCensusLayer({
      observe: harness.observeOwnedActivity,
      terminateDescendants: unusedBoundary
    }),
    Layer.succeed(CodexAttemptStore, harness.store),
    Layer.succeed(GitCommand, git),
    memoryEvidenceStoreLayer
  )
  const executorLayer = codexPlannedAttemptExecutorLayer.pipe(Layer.provide(dependencies))
  const execution = yield* Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const first = yield* executor.startOrContinue(request)
    const activeActivity = yield* harness.observeCurrentActivity
    if (cassette.scenario === "FirstTurnRunning" || cassette.scenario === "LostTurnResponse") {
      return { activeActivity, reports: [first] }
    }
    if (cassette.scenario === "AcceptedTerminal") {
      yield* harness.completeTurn
      return { activeActivity, reports: [first, yield* executor.startOrContinue(request)] }
    }
    yield* harness.interruptForeignTurn
    return { activeActivity, reports: [first, yield* executor.requestSuspension(attempt)] }
  }).pipe(Effect.provide(executorLayer))

  return {
    cassette,
    activeActivity: execution.activeActivity,
    privateRecord: codexAttemptRecordOrNull(yield* harness.currentRecord),
    reports: execution.reports,
    threadStartCount: yield* Ref.get(harness.threadStartCount),
    turnStartCount: yield* Ref.get(harness.turnStartCount)
  } satisfies CodexPlannedAttemptExecutorCassetteRun
})
