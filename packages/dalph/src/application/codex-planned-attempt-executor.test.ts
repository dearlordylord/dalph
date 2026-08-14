import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  type EvidenceStore,
  GitCommand,
  GitCommandInvocationFailure,
  memoryEvidenceStoreLayer,
  type GitCommandService
} from "@dalph/orchestrator"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import {
  CodexAppServerFailure,
  controlledCodexAppServerLayer,
  type CodexAppServerService,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexServerIncarnation,
  type CodexAttemptRecord,
  type CodexAttemptStoreService,
  CodexThreadId,
  CodexTurnId
} from "./codex-attempt-store.js"
import { codexPlannedAttemptExecutorLayer } from "./codex-planned-attempt-executor.js"

const head = GitCommitSha.make("a".repeat(40))
const otherHead = GitCommitSha.make("b".repeat(40))
const worktree = WorktreeLocator.make("/tmp/dalph-issue-58-worktree")
const specification = makeTaskWorkSpecification({
  body: "Implement the bounded executor scenario.",
  taskId: TaskId.make("issue-58-task"),
  title: "Issue 58 executor"
})
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:issue-58:0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/issue-58"),
  executor: TaskExecutorLocator.make("executor:codex-app-server"),
  runId: RunId.make("run:issue-58"),
  taskId: TaskId.make("issue-58-task"),
  taskRevision: specification.fingerprint,
  worktree
})
const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
const correlation = plannedAttemptExecutorCorrelation(attempt)

// eslint-disable-next-line functional/no-mixed-types -- The controlled fixture intentionally groups immutable observations and test controls.
type Harness = {
  readonly app: CodexAppServerService
  readonly store: CodexAttemptStoreService
  readonly turnCwds: Array<string>
  readonly turnTexts: Array<string>
  readonly resumeCwds: Array<string>
  readonly threadStarts: () => number
  readonly turnCount: () => number
  readonly associationAtTurn: () => CodexAttemptRecord | undefined
  readonly complete: (message: string) => void
  readonly makeTerminalActivity: () => void
  readonly makeResumeUnavailable: () => void
  readonly makeForeignResume: () => void
}

const keyOf = (runId: RunId, attemptId: AttemptId): string => `${runId}\u0000${attemptId}`

const makeHarness = (
  options: {
    readonly loseFirstTurnResponse?: boolean
    readonly loseTurnResponseAt?: number
    readonly missingEmptyThread?: boolean
    readonly failAssociatedWriteOnce?: boolean
  } = {}
): Harness => {
  const threadId = CodexThreadId.make("codex-thread-issue-58")
  const turns: Array<CodexTurnSnapshot> = []
  const records = new Map<string, CodexAttemptRecord>()
  const turnCwds: Array<string> = []
  const turnTexts: Array<string> = []
  const resumeCwds: Array<string> = []
  let currentThread: CodexThreadSnapshot = { id: threadId, cwd: worktree, status: "idle", turns }
  let currentTurn: CodexTurnSnapshot | undefined
  let turnNumber = 0
  let associationAtTurn: CodexAttemptRecord | undefined
  let firstTurnResponseLost = false
  let terminalActivity = false
  let associatedRecord: CodexAttemptRecord | undefined
  let threadStartCount = 0
  let resumeUnavailable = false
  let foreignResume = false
  let associatedWriteFailure = false

  const unavailable = (operation: "turn/start" | "thread/resume"): CodexAppServerFailure =>
    new CodexAppServerFailure({ detail: "controlled response was lost", kind: "Unavailable", operation })

  const app: CodexAppServerService = {
    incarnation: CodexServerIncarnation.make("controlled-issue-58"),
    startThread: (cwd) =>
      Effect.sync(() => {
        threadStartCount += 1
        currentThread = { ...currentThread, cwd, status: "idle", turns: [] }
        return currentThread
      }),
    readThread: () => Effect.succeed(currentThread),
    resumeThread: (threadIdValue, cwd) => {
      resumeCwds.push(cwd)
      if (threadIdValue !== threadId || resumeUnavailable) return Effect.fail(unavailable("thread/resume"))
      if (options.missingEmptyThread === true && currentThread.turns.length === 0) {
        return Effect.fail(
          new CodexAppServerFailure({
            detail: "empty thread disappeared",
            kind: "NotFound",
            operation: "thread/resume"
          })
        )
      }
      return Effect.sync(() => {
        currentThread = {
          ...currentThread,
          cwd,
          ...(foreignResume
            ? { correlation: { runId: RunId.make("foreign-run"), attemptId: AttemptId.make("foreign-attempt") } }
            : {})
        }
        return currentThread
      })
    },
    startTurn: (threadIdValue, cwd, text) =>
      Effect.gen(function* () {
        if (threadIdValue !== threadId) return yield* Effect.fail(unavailable("turn/start"))
        turnCwds.push(cwd)
        turnTexts.push(text)
        associationAtTurn = associatedRecord
        turnNumber += 1
        currentTurn = { id: CodexTurnId.make(`codex-turn-${turnNumber}`), status: "inProgress", items: [] }
        turns.push(currentTurn)
        currentThread = { ...currentThread, cwd, status: "active", turns }
        if (
          ((options.loseFirstTurnResponse === true && !firstTurnResponseLost) ||
            options.loseTurnResponseAt === turnNumber) &&
          !firstTurnResponseLost
        ) {
          firstTurnResponseLost = true
          return yield* Effect.fail(unavailable("turn/start"))
        }
        return currentTurn
      }),
    interruptTurn: (threadIdValue, turnId) =>
      Effect.sync(() => {
        if (threadIdValue !== threadId || currentTurn?.id !== turnId) return
        currentTurn = { ...currentTurn, status: "interrupted" }
        turns[turns.length - 1] = currentTurn
        currentThread = { ...currentThread, status: "idle", turns }
      }),
    listBackgroundTerminals: () =>
      Effect.succeed(
        terminalActivity
          ? [{ processId: "process-58", itemId: "item-58", command: "npm test", cwd: worktree, osPid: null }]
          : []
      ),
    terminateBackgroundTerminal: () => Effect.succeed(false),
    close: Effect.void
  }

  const store: CodexAttemptStoreService = {
    readAttempt: (runId, attemptId) =>
      Effect.sync(() => {
        const record = records.get(keyOf(runId, attemptId))
        return record === undefined ? Option.none() : Option.some(record)
      }),
    writeAttempt: (record) => {
      if (record.phase === "AssociatedPreTurn" && options.failAssociatedWriteOnce === true && !associatedWriteFailure) {
        associatedWriteFailure = true
        return Effect.fail(
          new CodexAttemptStoreFailure({ detail: "controlled association write lost", operation: "writeAttempt" })
        )
      }
      return Effect.sync(() => {
        records.set(keyOf(record.correlationRunId, record.correlationAttemptId), record)
        if (record.phase === "AssociatedPreTurn") associatedRecord = record
      })
    },
    readServerLaunch: () => Effect.succeed(Option.none()),
    writeServerLaunch: () => Effect.void,
    clearServerLaunch: () => Effect.void
  }

  return {
    app,
    store,
    turnCwds,
    turnTexts,
    resumeCwds,
    threadStarts: () => threadStartCount,
    turnCount: () => turnNumber,
    associationAtTurn: () => associationAtTurn,
    complete: (message) => {
      if (currentTurn === undefined) return
      currentTurn = {
        ...currentTurn,
        status: "completed",
        items: [
          { type: "agentMessage", text: `Working from base ${attempt.baseSha}` },
          { type: "agentMessage", text: message }
        ]
      }
      turns[turns.length - 1] = currentTurn
      currentThread = { ...currentThread, status: "idle", turns }
    },
    makeTerminalActivity: () => {
      terminalActivity = true
    },
    makeResumeUnavailable: () => {
      resumeUnavailable = true
    },
    makeForeignResume: () => {
      foreignResume = true
    }
  }
}

const layerFor = (
  harness: Harness,
  gitCommand: GitCommandService = {
    run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
    runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: `${head}\n` }),
    runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
  },
  evidenceStore: Layer.Layer<EvidenceStore> = memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))
) =>
  codexPlannedAttemptExecutorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        controlledCodexAppServerLayer(harness.app),
        Layer.succeed(CodexAttemptStore, harness.store),
        Layer.succeed(GitCommand, gitCommand),
        evidenceStore
      )
    )
  )

it.effect("persists the exact association before the first turn and seals Accepted from reread evidence", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const first = yield* executor.startOrContinue(request)
    expect(first).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    expect(harness.associationAtTurn()?.phase).toBe("AssociatedPreTurn")
    expect(harness.associationAtTurn()?.worktree).toBe(worktree)
    expect(harness.turnCwds).toEqual([worktree])
    expect(harness.turnTexts[0]).toContain(`base_sha: ${attempt.baseSha}`)

    harness.complete(`Accepted commit ${head}`)
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    if (accepted._tag === "Terminal") {
      expect(accepted.result._tag).toBe("Accepted")
      if (accepted.result._tag === "Accepted") expect(accepted.result.acceptedResult.commit).toBe(head)
    }
    expect(harness.turnCount()).toBe(1)

    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact" && projected.report._tag === "Terminal") {
      expect(projected.report.result._tag).toBe("Accepted")
    }
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost turn response without sending a second turn", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    expect(harness.turnCount()).toBe(1)

    harness.complete(`Commit ${head}`)
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("seals Failed on commit mismatch and never reports Completed", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(`The proposed commit is ${otherHead}`)
    const failed = yield* executor.startOrContinue(request)
    expect(failed).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
    )
    const again = yield* executor.startOrContinue(request)
    expect(again).toEqual(failed)
    expect(JSON.stringify(failed)).not.toContain("Completed")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("does not seal Failed when Git head observation is unavailable", () => {
  const harness = makeHarness()
  const unavailableGit: GitCommandService = {
    run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
    runInWorktree: () => Effect.fail(new GitCommandInvocationFailure({ detail: "git unavailable" })),
    runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(`Commit ${head}`)
    const result = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Unreadable")
  }).pipe(Effect.provide(layerFor(harness, unavailableGit)))
})

it.effect("lets a terminal result win the suspension race and keeps owned activity running", () => {
  const terminalHarness = makeHarness()
  const activityHarness = makeHarness()
  return Effect.gen(function* () {
    const terminalExecutor = yield* PlannedAttemptExecutor
    yield* terminalExecutor.startOrContinue(request)
    terminalHarness.complete(`Commit ${head}`)
    const terminal = yield* terminalExecutor.requestSuspension(attempt)
    expect(terminal._tag).toBe("Terminal")
    if (terminal._tag === "Terminal") expect(terminal.result._tag).toBe("Accepted")
  }).pipe(
    Effect.provide(layerFor(terminalHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const activityExecutor = yield* PlannedAttemptExecutor
        yield* activityExecutor.startOrContinue(request)
        activityHarness.complete(`Commit ${head}`)
        activityHarness.makeTerminalActivity()
        const report = yield* activityExecutor.requestSuspension(attempt)
        expect(report._tag).toBe("Running")
      }).pipe(Effect.provide(layerFor(activityHarness)))
    )
  )
})

it.effect("retries a lost association write without sending two task turns", () => {
  const harness = makeHarness({ failAssociatedWriteOnce: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const first = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(first._tag).toBe("Failure")
    const second = yield* executor.startOrContinue(request)
    expect(second._tag).toBe("Running")
    expect(harness.threadStarts()).toBe(2)
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("replaces only a conclusively absent empty pre-turn thread", () => {
  const harness = makeHarness({ missingEmptyThread: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    expect(harness.threadStarts()).toBe(2)
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("normalizes unavailable and foreign resume observations without replacing the attempt", () => {
  const unavailableHarness = makeHarness()
  const foreignHarness = makeHarness()
  return Effect.gen(function* () {
    const unavailableExecutor = yield* PlannedAttemptExecutor
    yield* unavailableExecutor.startOrContinue(request)
    unavailableHarness.makeResumeUnavailable()
    const unavailable = yield* unavailableExecutor.project(correlation)
    expect(unavailable._tag).toBe("TemporarilyUnavailable")
    expect(unavailableHarness.threadStarts()).toBe(1)
  }).pipe(
    Effect.provide(layerFor(unavailableHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const foreignExecutor = yield* PlannedAttemptExecutor
        yield* foreignExecutor.startOrContinue(request)
        foreignHarness.makeForeignResume()
        const contradiction = yield* foreignExecutor.project(correlation)
        expect(contradiction._tag).toBe("CorrelationContradiction")
        expect(foreignHarness.threadStarts()).toBe(1)
      }).pipe(Effect.provide(layerFor(foreignHarness)))
    )
  )
})

it.effect("reports safe suspension after an interrupted turn and resumes the same thread", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(harness.threadStarts()).toBe(1)

    const resumed = yield* executor.startOrContinue(request)
    expect(resumed._tag).toBe("Running")
    expect(harness.threadStarts()).toBe(1)
    expect(harness.turnCount()).toBe(2)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost continuation response against the later turn without duplication", () => {
  const harness = makeHarness({ loseTurnResponseAt: 2 })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("SafelySuspended")

    const resumed = yield* executor.startOrContinue(request)
    expect(resumed._tag).toBe("Running")
    expect(harness.turnCount()).toBe(2)

    harness.complete(`Commit ${head}`)
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    expect(harness.turnCount()).toBe(2)
  }).pipe(Effect.provide(layerFor(harness)))
})
