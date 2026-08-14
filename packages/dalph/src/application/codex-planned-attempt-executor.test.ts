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
import { Effect, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { definePlannedAttemptExecutorConformanceSuite } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/conformance.test.js"
import {
  CodexAppServerFailure,
  controlledCodexOwnedActivityCensusLayer,
  controlledCodexAppServerLayer,
  type CodexBackgroundTerminal,
  type CodexOwnedActivity,
  type CodexOwnedActivityCensusProjection,
  type CodexOwnedProcessIdentity,
  CodexProcessStartIdentity,
  type CodexAppServerService,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexOwnedTurnToken,
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
const finalResponse = (commit: GitCommitSha): string => JSON.stringify({ commit, correlation })

const conformanceSpecification = makeTaskWorkSpecification({
  body: "Opaque conformance body",
  taskId: TaskId.make("opaque-conformance-task"),
  title: "Opaque conformance task"
})
const conformanceAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:opaque-conformance:0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/opaque-conformance"),
  executor: TaskExecutorLocator.make("executor:opaque-conformance"),
  runId: RunId.make("opaque-conformance-run"),
  taskId: TaskId.make("opaque-conformance-task"),
  taskRevision: conformanceSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/opaque-conformance")
})
const conformanceRequest = PlannedAttemptExecutorRequest.make({
  plannedAttempt: conformanceAttempt,
  specification: conformanceSpecification
})
const conformanceCorrelation = plannedAttemptExecutorCorrelation(conformanceAttempt)
const conformanceFinalResponse = JSON.stringify({ commit: head, correlation: conformanceCorrelation })

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
  readonly currentThread: () => CodexThreadSnapshot
  readonly currentRecord: () => CodexAttemptRecord | undefined
  readonly complete: (message: string) => void
  readonly makeTerminalActivity: () => void
  readonly setActivityCensus: (projection: CodexOwnedActivityCensusProjection | undefined) => void
  readonly setActivityCensusSequence: (projections: ReadonlyArray<CodexOwnedActivityCensusProjection>) => void
  readonly observeActivityCensus: (
    thread: CodexThreadSnapshot,
    backgroundTerminals: ReadonlyArray<CodexBackgroundTerminal>
  ) => CodexOwnedActivityCensusProjection
  readonly terminateDescendants: (descendants: ReadonlyArray<CodexOwnedProcessIdentity>) => void
  readonly backgroundTerminationCount: () => number
  readonly descendantTerminationCount: () => number
  readonly makeResumeUnavailable: () => void
  readonly makeForeignResume: () => void
  readonly makeInterruptUnavailable: () => void
  readonly addManualTurn: (position: "before" | "after") => void
  readonly reorderTurns: () => void
  readonly duplicateOwnedTurn: () => void
  readonly contradictOwnedTurnId: () => void
  readonly addForeignOwnedTurn: () => void
  readonly makeForeignTurnCorrelation: () => void
}

const keyOf = (runId: RunId, attemptId: AttemptId): string => `${runId}\u0000${attemptId}`

const makeHarness = (
  options: {
    readonly loseFirstTurnResponse?: boolean
    readonly loseTurnResponseAt?: number
    readonly missingEmptyThread?: boolean
    readonly failAssociatedWriteOnce?: boolean
    readonly manualBeforeFirstTurn?: boolean
    readonly manualAfterFirstTurn?: boolean
    readonly reorderTurnsOnResume?: boolean
    readonly foreignTurnCorrelation?: boolean
    readonly keepTurnRunningOnInterruptCount?: number
    readonly interruptUnavailable?: boolean
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
  let activityCensusOverride: CodexOwnedActivityCensusProjection | undefined
  let activityCensusSequence: Array<CodexOwnedActivityCensusProjection> = []
  let backgroundTerminationCount = 0
  let descendantTerminationCount = 0
  let associatedRecord: CodexAttemptRecord | undefined
  let threadStartCount = 0
  let resumeUnavailable = false
  let foreignResume = false
  let interruptUnavailable = options.interruptUnavailable === true
  let keepTurnRunningOnInterruptCount = options.keepTurnRunningOnInterruptCount ?? 0
  let associatedWriteFailure = false

  const manualTurn = (id: string): CodexTurnSnapshot => ({
    id: CodexTurnId.make(id),
    status: "completed",
    items: [{ type: "agentMessage", text: "manual activity" }]
  })

  const unavailable = (operation: "turn/start" | "thread/resume" | "turn/interrupt"): CodexAppServerFailure =>
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
        if (options.reorderTurnsOnResume === true) {
          currentThread = { ...currentThread, turns: [...currentThread.turns].reverse() }
        }
        return currentThread
      })
    },
    startTurn: (threadIdValue, cwd, text, ownedTurnToken) =>
      Effect.gen(function* () {
        if (threadIdValue !== threadId) return yield* Effect.fail(unavailable("turn/start"))
        turnCwds.push(cwd)
        turnTexts.push(text)
        associationAtTurn = associatedRecord
        turnNumber += 1
        if (turnNumber === 1 && options.manualBeforeFirstTurn === true) turns.push(manualTurn("manual-before"))
        currentTurn = {
          id: CodexTurnId.make(`codex-turn-${turnNumber}`),
          status: "inProgress",
          items: [],
          ...(ownedTurnToken === undefined ? {} : { ownedTurnToken }),
          ...(options.foreignTurnCorrelation === true
            ? { correlation: { runId: RunId.make("foreign-run"), attemptId: AttemptId.make("foreign-attempt") } }
            : {})
        }
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
    interruptTurn: (threadIdValue, turnId) => {
      if (interruptUnavailable) {
        return Effect.fail(unavailable("turn/interrupt"))
      }
      return Effect.sync(() => {
        if (threadIdValue !== threadId || currentTurn?.id !== turnId) return
        if (keepTurnRunningOnInterruptCount > 0) {
          keepTurnRunningOnInterruptCount -= 1
          return
        }
        currentTurn = { ...currentTurn, status: "interrupted" }
        const currentIndex = turns.findIndex((turn) => turn.id === currentTurn?.id)
        if (currentIndex >= 0) turns[currentIndex] = currentTurn
        currentThread = { ...currentThread, status: "idle", turns }
      })
    },
    listBackgroundTerminals: () =>
      Effect.succeed(
        terminalActivity
          ? [{ processId: "process-58", itemId: "item-58", command: "npm test", cwd: worktree, osPid: null }]
          : []
      ),
    terminateBackgroundTerminal: () =>
      Effect.sync(() => {
        backgroundTerminationCount += 1
        const wasActive = terminalActivity
        terminalActivity = false
        return wasActive
      }),
    close: Effect.void
  }

  const store: CodexAttemptStoreService = {
    readAttempt: (runId, attemptId) =>
      Effect.sync(() => {
        const record = records.get(keyOf(runId, attemptId))
        return record === undefined ? Option.none() : Option.some(record)
      }),
    writeAttempt: (record) => {
      if (record._tag === "AssociatedPreTurn" && options.failAssociatedWriteOnce === true && !associatedWriteFailure) {
        associatedWriteFailure = true
        return Effect.fail(
          new CodexAttemptStoreFailure({ detail: "controlled association write lost", operation: "writeAttempt" })
        )
      }
      return Effect.sync(() => {
        records.set(keyOf(record.correlationRunId, record.correlationAttemptId), record)
        if (record._tag === "AssociatedPreTurn") associatedRecord = record
      })
    },
    readServerLaunch: () => Effect.succeed(Option.none()),
    writeServerLaunch: () => Effect.void,
    clearServerLaunch: () => Effect.void,
    acquireServerLease: (_owner, _observe) => Effect.void,
    releaseServerLease: (_owner) => Effect.void
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
    currentThread: () => currentThread,
    currentRecord: () => records.get(keyOf(attempt.runId, attempt.attemptId)),
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
      const currentIndex = turns.findIndex((turn) => turn.id === currentTurn?.id)
      if (currentIndex >= 0) turns[currentIndex] = currentTurn
      currentThread = { ...currentThread, status: "idle", turns }
      if (options.manualAfterFirstTurn === true && turnNumber === 1) turns.push(manualTurn("manual-after"))
    },
    makeTerminalActivity: () => {
      terminalActivity = true
    },
    setActivityCensus: (projection) => {
      activityCensusOverride = projection
      activityCensusSequence = []
    },
    setActivityCensusSequence: (projections) => {
      activityCensusOverride = undefined
      activityCensusSequence = [...projections]
    },
    observeActivityCensus: (thread, backgroundTerminals) => {
      const next = activityCensusSequence[0]
      if (next !== undefined) {
        activityCensusSequence = activityCensusSequence.slice(1)
        return next
      }
      if (activityCensusOverride !== undefined) return activityCensusOverride
      const activities: Array<CodexOwnedActivity> = [
        ...thread.turns
          .filter((turn) => turn.status === "inProgress")
          .map((turn) => ({ _tag: "ActiveTurn" as const, turnId: turn.id })),
        ...backgroundTerminals.map((terminal) => ({ _tag: "BackgroundTerminal" as const, terminal }))
      ]
      return activities.length === 0 ? { _tag: "Absent" } : { _tag: "ExactLive", activities }
    },
    terminateDescendants: (descendants) => {
      descendantTerminationCount += descendants.length
    },
    backgroundTerminationCount: () => backgroundTerminationCount,
    descendantTerminationCount: () => descendantTerminationCount,
    makeResumeUnavailable: () => {
      resumeUnavailable = true
    },
    makeForeignResume: () => {
      foreignResume = true
    },
    makeInterruptUnavailable: () => {
      interruptUnavailable = true
    },
    addManualTurn: (position) => {
      const manual = manualTurn(`manual-${position}-${turns.length}`)
      if (position === "before") turns.unshift(manual)
      else turns.push(manual)
      currentThread = { ...currentThread, turns }
    },
    reorderTurns: () => {
      currentThread = { ...currentThread, turns: [...currentThread.turns].reverse() }
    },
    duplicateOwnedTurn: () => {
      if (currentTurn === undefined || currentTurn.ownedTurnToken === undefined) return
      turns.push({ ...currentTurn, id: CodexTurnId.make("duplicate-owned-turn") })
      currentThread = { ...currentThread, turns }
    },
    contradictOwnedTurnId: () => {
      if (currentTurn === undefined) return
      const previousId = currentTurn.id
      currentTurn = { ...currentTurn, id: CodexTurnId.make("contradictory-owned-turn") }
      const currentIndex = turns.findIndex((turn) => turn.id === previousId)
      if (currentIndex >= 0) turns[currentIndex] = currentTurn
      currentThread = { ...currentThread, turns }
    },
    addForeignOwnedTurn: () => {
      turns.push({
        id: CodexTurnId.make("foreign-owned-turn"),
        status: "completed",
        items: [{ type: "agentMessage", text: "foreign activity" }],
        ownedTurnToken: CodexOwnedTurnToken.make("foreign-owned-token")
      })
      currentThread = { ...currentThread, turns }
    },
    makeForeignTurnCorrelation: () => {
      if (currentTurn === undefined) return
      currentTurn = {
        ...currentTurn,
        correlation: { runId: RunId.make("foreign-turn-run"), attemptId: AttemptId.make("foreign-turn-attempt") }
      }
      const currentIndex = turns.findIndex((turn) => turn.id === currentTurn?.id)
      if (currentIndex >= 0) turns[currentIndex] = currentTurn
      currentThread = { ...currentThread, turns }
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
        controlledCodexOwnedActivityCensusLayer({
          observe: (thread, backgroundTerminals) =>
            Effect.succeed(harness.observeActivityCensus(thread, backgroundTerminals)),
          terminateDescendants: (descendants) => Effect.sync(() => harness.terminateDescendants(descendants))
        }),
        Layer.succeed(CodexAttemptStore, harness.store),
        Layer.succeed(GitCommand, gitCommand),
        evidenceStore
      )
    ),
    Layer.provide(NodeServices.layer)
  )

type ConformanceBoundaryCall =
  | { readonly _tag: "Project"; readonly correlation: typeof conformanceCorrelation }
  | { readonly _tag: "StartOrContinue"; readonly correlation: typeof conformanceCorrelation }
  | { readonly _tag: "Suspend"; readonly correlation: typeof conformanceCorrelation }

/**
 * #168's generic suite is intentionally run against the real Codex layer
 * with controlled app-server, Git, and evidence boundaries. The scenario
 * setup changes only those controls; all journal ordering and correlation
 * assertions remain owned by the generic black-box protocol suite.
 */
const codexConformanceImplementation = {
  name: "Codex planned-attempt executor layer",
  terminalResultTag: "Accepted" as const,
  make: (scenario: string, onBoundary: (call: ConformanceBoundaryCall) => Effect.Effect<void>) =>
    Effect.gen(function* () {
      const options =
        scenario === "ForeignStart"
          ? { foreignTurnCorrelation: true }
          : scenario === "RunningThenSafeSuspension"
            ? { keepTurnRunningOnInterruptCount: 1 }
            : scenario === "UnavailableSuspension"
              ? { interruptUnavailable: true }
              : {}
      const harness = makeHarness(options)
      const concrete = yield* Effect.gen(function* () {
        return yield* PlannedAttemptExecutor
      }).pipe(Effect.provide(layerFor(harness)))

      if (
        scenario === "RunningThenSafeSuspension" ||
        scenario === "ForeignSuspension" ||
        scenario === "UnavailableSuspension" ||
        scenario === "TerminalSuspension" ||
        scenario === "ExactProjection" ||
        scenario === "ForeignProjection"
      ) {
        yield* concrete.startOrContinue(conformanceRequest).pipe(Effect.orDie)
      }
      if (scenario === "ForeignSuspension" || scenario === "ForeignProjection") harness.makeForeignResume()
      if (scenario === "UnavailableSuspension") harness.makeInterruptUnavailable()
      if (scenario === "TerminalSuspension") harness.complete(conformanceFinalResponse)

      const calls = yield* Ref.make<ReadonlyArray<ConformanceBoundaryCall>>([])
      const record = (call: ConformanceBoundaryCall) =>
        Ref.update(calls, (current) => [...current, call]).pipe(Effect.andThen(onBoundary(call)))
      const executor = PlannedAttemptExecutor.of({
        project: (requested) =>
          record({ _tag: "Project", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.project(requested))
          ),
        requestSuspension: (requested) =>
          record({ _tag: "Suspend", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.requestSuspension(requested))
          ),
        startOrContinue: (requested) =>
          record({ _tag: "StartOrContinue", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.startOrContinue(requested))
          )
      })
      return { calls: Ref.get(calls), executor }
    })
}

definePlannedAttemptExecutorConformanceSuite(codexConformanceImplementation)

it.effect("persists the exact association before the first turn and seals Accepted from reread evidence", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const first = yield* executor.startOrContinue(request)
    expect(first).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    expect(harness.associationAtTurn()?._tag).toBe("AssociatedPreTurn")
    expect(harness.associationAtTurn()?.worktree).toBe(worktree)
    expect(harness.turnCwds).toEqual([worktree])
    expect(harness.turnTexts[0]).toContain(`base_sha: ${attempt.baseSha}`)
    const runningRecord = harness.currentRecord()
    expect(runningRecord?._tag).toBe("Running")
    if (runningRecord?._tag === "Running") {
      const ownedTurns = harness
        .currentThread()
        .turns.filter((turn) => turn.ownedTurnToken === runningRecord.currentToken)
      expect(ownedTurns).toHaveLength(1)
      expect(ownedTurns[0]?.id).toBe(runningRecord.observedTurnId)
    }

    harness.complete(finalResponse(head))
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    if (accepted._tag === "Terminal") {
      expect(accepted.result._tag).toBe("Accepted")
      if (accepted.result._tag === "Accepted") expect(accepted.result.acceptedResult.commit).toBe(head)
    }
    const terminalRecord = harness.currentRecord()
    expect(terminalRecord?._tag).toBe("Terminal")
    if (terminalRecord?._tag === "Terminal") {
      const ownedTurns = harness
        .currentThread()
        .turns.filter((turn) => turn.ownedTurnToken === terminalRecord.currentToken)
      expect(ownedTurns).toHaveLength(1)
      expect(ownedTurns[0]?.id).toBe(terminalRecord.observedTurnId)
    }
    expect(harness.turnCount()).toBe(1)

    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact" && projected.report._tag === "Terminal") {
      expect(projected.report.result._tag).toBe("Accepted")
    }

    const resumeCountBeforeRestart = harness.resumeCwds.length
    const restarted = yield* Effect.gen(function* () {
      const restartedExecutor = yield* PlannedAttemptExecutor
      return yield* restartedExecutor.startOrContinue(request)
    }).pipe(Effect.provide(layerFor(harness)))
    expect(restarted._tag).toBe("Terminal")
    expect(harness.resumeCwds.length).toBeGreaterThan(resumeCountBeforeRestart)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("serializes same-attempt parallel admission behind one gate", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const reports = yield* Effect.all([executor.startOrContinue(request), executor.startOrContinue(request)], {
      concurrency: 2
    })
    expect(reports).toEqual([
      PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    ])
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("does not accept a commit without the exact final response correlation", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(JSON.stringify({ commit: head }))
    const result = yield* executor.startOrContinue(request)
    expect(result).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
    )
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost turn response without sending a second turn", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    expect(harness.turnCount()).toBe(1)

    harness.complete(finalResponse(head))
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    expect(harness.turnCount()).toBe(1)
    const terminalRecord = harness.currentRecord()
    expect(terminalRecord?._tag).toBe("Terminal")
    if (terminalRecord?._tag === "Terminal") {
      const ownedTurns = harness
        .currentThread()
        .turns.filter((turn) => turn.ownedTurnToken === terminalRecord.currentToken)
      expect(ownedTurns).toHaveLength(1)
      expect(ownedTurns[0]?.id).toBe(terminalRecord.observedTurnId)
    }
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("seals Failed on commit mismatch and never reports Completed", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(otherHead))
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
    harness.complete(finalResponse(head))
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
    terminalHarness.complete(finalResponse(head))
    const terminal = yield* terminalExecutor.requestSuspension(attempt)
    expect(terminal._tag).toBe("Terminal")
    if (terminal._tag === "Terminal") expect(terminal.result._tag).toBe("Accepted")
  }).pipe(
    Effect.provide(layerFor(terminalHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const activityExecutor = yield* PlannedAttemptExecutor
        yield* activityExecutor.startOrContinue(request)
        activityHarness.complete(finalResponse(head))
        activityHarness.makeTerminalActivity()
        const report = yield* activityExecutor.requestSuspension(attempt)
        expect(report._tag).toBe("Running")
      }).pipe(Effect.provide(layerFor(activityHarness)))
    )
  )
})

it.effect("terminates a reported background activity before reporting safe suspension", () => {
  const harness = makeHarness()
  harness.makeTerminalActivity()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(harness.backgroundTerminationCount()).toBe(1)
    expect(harness.descendantTerminationCount()).toBe(0)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("keeps capacity when the census finds a hidden tool absent from the terminal list", () => {
  const harness = makeHarness()
  const hiddenTool = {
    processId: "hidden-tool-58",
    itemId: "hidden-item-58",
    command: "npm test",
    cwd: worktree,
    osPid: null
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensus({ _tag: "ExactLive", activities: [{ _tag: "BackgroundTerminal", terminal: hiddenTool }] })
    const running = yield* executor.startOrContinue(request)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    harness.setActivityCensus({ _tag: "Absent" })
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("does not report safe suspension while a process-group descendant survives", () => {
  const harness = makeHarness()
  const descendant = {
    pid: 5801,
    parentPid: 5800,
    processGroupId: 5800,
    startIdentity: CodexProcessStartIdentity.make("linux:issue-58-descendant")
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.setActivityCensus({
      _tag: "ExactLive",
      activities: [{ _tag: "ProcessGroupDescendant", identity: descendant }]
    })
    const failed = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
    expect(failed._tag).toBe("Failure")
    expect(harness.descendantTerminationCount()).toBeGreaterThan(0)
    harness.setActivityCensus({ _tag: "Absent" })
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("SafelySuspended")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("keeps a terminal attempt running when its activity census is unreadable", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensus({ _tag: "Unreadable", detail: "controlled process observation" })
    const running = yield* executor.startOrContinue(request)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") expect(projected.report._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("keeps terminal capacity while an owned descendant survives, then accepts after exact absence", () => {
  const harness = makeHarness()
  const descendant = {
    pid: 5811,
    parentPid: 5810,
    processGroupId: 5810,
    startIdentity: CodexProcessStartIdentity.make("linux:issue-58-terminal-descendant")
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensus({
      _tag: "ExactLive",
      activities: [{ _tag: "ProcessGroupDescendant", identity: descendant }]
    })
    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    harness.setActivityCensus({ _tag: "Absent" })
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    if (accepted._tag === "Terminal") expect(accepted.result._tag).toBe("Accepted")
  }).pipe(Effect.provide(layerFor(harness)))
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
    const firstTurnRecord = harness.currentRecord()
    expect(firstTurnRecord?._tag).toBe("Running")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(harness.threadStarts()).toBe(1)

    const resumed = yield* executor.startOrContinue(request)
    expect(resumed._tag).toBe("Running")
    expect(harness.threadStarts()).toBe(1)
    expect(harness.turnCount()).toBe(2)
    const continuationRecord = harness.currentRecord()
    expect(continuationRecord?._tag).toBe("Running")
    if (firstTurnRecord?._tag === "Running" && continuationRecord?._tag === "Running") {
      expect(continuationRecord.priorObservedTurnId).toBe(firstTurnRecord.observedTurnId)
      const ownedTurns = harness
        .currentThread()
        .turns.filter((turn) => turn.ownedTurnToken === continuationRecord.currentToken)
      expect(ownedTurns).toHaveLength(1)
      expect(ownedTurns[0]?.id).toBe(continuationRecord.observedTurnId)
    }
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost continuation response against the later turn without duplication", () => {
  const harness = makeHarness({ loseTurnResponseAt: 2 })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    const firstTurnRecord = harness.currentRecord()
    expect(firstTurnRecord?._tag).toBe("Running")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("SafelySuspended")

    const resumed = yield* executor.startOrContinue(request)
    expect(resumed._tag).toBe("Running")
    expect(harness.turnCount()).toBe(2)
    const continuationRecord = harness.currentRecord()
    expect(continuationRecord?._tag).toBe("Running")
    if (continuationRecord?._tag === "Running") {
      expect(continuationRecord.priorObservedTurnId).toBe(
        firstTurnRecord?._tag === "Running" ? firstTurnRecord.observedTurnId : null
      )
      const ownedTurns = harness
        .currentThread()
        .turns.filter((turn) => turn.ownedTurnToken === continuationRecord.currentToken)
      expect(ownedTurns).toHaveLength(1)
      expect(ownedTurns[0]?.id).toBe(continuationRecord.observedTurnId)
    }

    harness.complete(finalResponse(head))
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    expect(harness.turnCount()).toBe(2)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("matches the owned turn by token across manual turns and reordered snapshots", () => {
  const harness = makeHarness({ manualBeforeFirstTurn: true, manualAfterFirstTurn: true, reorderTurnsOnResume: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    const accepted = yield* executor.startOrContinue(request)
    expect(accepted._tag).toBe("Terminal")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("preserves foreign-token turns while reporting the exact owned turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.addForeignOwnedTurn()
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") expect(projected.report._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("maps duplicate owned tokens to an unreadable projection without choosing a turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.duplicateOwnedTurn()
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Unreadable")
    const retried = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(retried._tag).toBe("Failure")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("maps an owned token to a contradictory turn id without choosing a turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.contradictOwnedTurnId()
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Unreadable")
    const retried = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(retried._tag).toBe("Failure")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("maps a foreign correlation on the owned token to a contradiction", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.makeForeignTurnCorrelation()
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("CorrelationContradiction")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})
