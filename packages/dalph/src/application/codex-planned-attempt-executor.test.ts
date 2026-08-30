import { it } from "@effect/vitest"
import {
  AttemptId,
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  type PlannedAttemptExecutorService,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  EvidenceStore,
  EvidenceStoreFailure,
  GitCommand,
  GitCommandInvocationFailure,
  makePassivePlannedAttemptObserver,
  memoryEvidenceStoreLayer,
  OperationId,
  type GitCommandService
} from "@dalph/orchestrator"
import { NodeServices } from "@effect/platform-node"
import { Crypto, Deferred, Effect, FileSystem, Layer, Option, PlatformError, PubSub, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { definePlannedAttemptExecutorConformanceSuite } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/conformance.test.js"
import { plannedAttemptExecutorContract } from "../../../orchestrator/test/contracts/planned-attempt-executor-contract.js"
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
  CodexPurgedWorkUnitEvidence,
  CodexPurgedWorkUnitReplacementLedger,
  CodexReplacementHistoryEntry,
  mergeCodexReplacementLedger,
  CodexSealedTerminal,
  CodexServerIncarnation,
  CodexAttemptRecord,
  CodexReplacementRequestId,
  nodeCodexAttemptStoreLayer,
  type CodexAttemptStoreService,
  CodexThreadId,
  CodexTurnId
} from "./codex-attempt-store.js"
import {
  CodexProviderWorkUnitReplacement,
  CodexProviderWorkUnitReplacementRequest,
  type CodexProviderWorkUnitReplacementResult,
  type CodexReplacementAuthority,
  CodexReplacementAuthorityFailure,
  CodexReplacementAuthorityProof,
  controlledCodexReplacementAuthorityLayer,
  codexPlannedAttemptExecutorLayer
} from "./codex-planned-attempt-executor.js"

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
  readonly attemptReadCount: () => number
  readonly turnCount: () => number
  readonly associationAtTurn: () => CodexAttemptRecord | undefined
  readonly currentThread: () => CodexThreadSnapshot
  readonly currentRecord: () => CodexAttemptRecord | undefined
  readonly replacementLedger: () => CodexPurgedWorkUnitReplacementLedger | undefined
  readonly setThread: (thread: CodexThreadSnapshot) => void
  readonly restoreProviderThread: (thread: CodexThreadSnapshot) => void
  readonly preserveResumeCwd: () => void
  readonly setRecord: (record: CodexAttemptRecord) => void
  readonly setReadOverride: (record: CodexAttemptRecord | undefined) => void
  readonly complete: (message: string) => void
  readonly completeWithItems: (items: ReadonlyArray<unknown>) => void
  readonly makeTerminalActivity: () => void
  readonly finishTerminalActivity: () => void
  readonly setActivityCensus: (projection: CodexOwnedActivityCensusProjection | undefined) => void
  readonly setActivityCensusSequence: (projections: ReadonlyArray<CodexOwnedActivityCensusProjection>) => void
  readonly observeActivityCensus: (
    thread: CodexThreadSnapshot,
    backgroundTerminals: ReadonlyArray<CodexBackgroundTerminal>
  ) => CodexOwnedActivityCensusProjection
  readonly afterActivityCensus: () => Effect.Effect<void>
  readonly terminateDescendants: (descendants: ReadonlyArray<CodexOwnedProcessIdentity>) => void
  readonly backgroundTerminationCount: () => number
  readonly descendantTerminationCount: () => number
  readonly makeResumeUnavailable: () => void
  readonly setResumeFailure: (failure: CodexAppServerFailure | undefined) => void
  readonly makeReadFailure: () => void
  readonly makeForeignResume: () => void
  readonly makeInterruptUnavailable: () => void
  readonly makeInterruptSettleBeforeFailure: () => void
  readonly makeInterruptTerminalBeforeFailure: () => void
  readonly makeBackgroundTerminationFail: () => void
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
    readonly resumeUnavailableAfterLostTurn?: boolean
    readonly missingEmptyThread?: boolean
    readonly failAssociatedWriteOnce?: boolean
    readonly manualBeforeFirstTurn?: boolean
    readonly manualAfterFirstTurn?: boolean
    readonly reorderTurnsOnResume?: boolean
    readonly foreignTurnCorrelation?: boolean
    readonly terminalTurnStatus?: "completed" | "failed" | "interrupted"
    readonly loseResponseThreadStatus?: "active" | "idle"
    readonly omitOwnedTurnToken?: boolean
    readonly wrongOwnedTurnToken?: boolean
    readonly keepTurnRunningOnInterruptCount?: number
    readonly interruptUnavailable?: boolean
    readonly failAfterReplacementIntentOnce?: boolean
    readonly failAfterReplacementTurnIntentOnce?: boolean
    readonly failAfterReplacementCalledOnce?: boolean
    readonly failAfterReplacementObservedOnce?: boolean
    readonly failAfterReplacementSealOnce?: boolean
    readonly dieAfterReplacementTurnStartOnce?: boolean
    readonly dieAfterFirstTurnStartOnce?: boolean
    readonly lifecycleHintCount?: number
    readonly lifecycleHints?: CodexAppServerService["attachTurnCompletedHints"]
    readonly activityHints?: CodexAppServerService["attachOwnedActivityHints"]
    readonly beforeAttemptRead?: () => Effect.Effect<void>
    readonly afterActivityCensus?: () => Effect.Effect<void>
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
  let readOverride: CodexAttemptRecord | undefined
  let threadStartCount = 0
  let attemptReadCount = 0
  let resumeUnavailable = false
  let resumeFailure: CodexAppServerFailure | undefined
  let readFailure = false
  let preserveResumeCwdOnResume = false
  let foreignResume = false
  let interruptUnavailable = options.interruptUnavailable === true
  let interruptSettlesBeforeFailure = false
  let interruptSettlesTerminalBeforeFailure = false
  let backgroundTerminationFailure = false
  let keepTurnRunningOnInterruptCount = options.keepTurnRunningOnInterruptCount ?? 0
  let associatedWriteFailure = false
  const replacementLedgers = new Map<string, CodexPurgedWorkUnitReplacementLedger>()
  let replacementIntentFailure = false
  let replacementTurnIntentFailure = false
  let replacementCalledFailure = false
  let replacementObservedFailure = false
  let replacementSealFailure = false
  let replacementTurnStartDeath = false
  let firstTurnStartDeath = false

  const manualTurn = (id: string): CodexTurnSnapshot => ({
    id: CodexTurnId.make(id),
    status: "completed",
    items: [{ type: "agentMessage", text: "manual activity" }]
  })

  const unavailable = (operation: "turn/start" | "thread/resume" | "turn/interrupt"): CodexAppServerFailure =>
    new CodexAppServerFailure({ detail: "controlled response was lost", kind: "Unavailable", operation })

  const app: CodexAppServerService = {
    incarnation: CodexServerIncarnation.make("controlled-issue-58"),
    attachTurnCompletedHints:
      options.lifecycleHints ??
      Effect.succeed(Stream.fromIterable(Array.from({ length: options.lifecycleHintCount ?? 0 }, () => undefined))),
    attachOwnedActivityHints: options.activityHints ?? Effect.succeed(Stream.empty),
    startThread: (cwd) =>
      Effect.sync(() => {
        threadStartCount += 1
        currentThread = { ...currentThread, cwd, status: "idle", turns: [] }
        return currentThread
      }),
    readThread: () => Effect.succeed(currentThread),
    resumeThread: (threadIdValue, cwd) => {
      resumeCwds.push(cwd)
      if (resumeFailure !== undefined) return Effect.fail(resumeFailure)
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
          cwd: preserveResumeCwdOnResume ? currentThread.cwd : cwd,
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
          status: options.terminalTurnStatus ?? "inProgress",
          items: [],
          ...(options.omitOwnedTurnToken || ownedTurnToken === undefined
            ? {}
            : {
                ownedTurnToken: options.wrongOwnedTurnToken
                  ? CodexOwnedTurnToken.make("wrong-owned-token")
                  : ownedTurnToken
              }),
          ...(options.foreignTurnCorrelation === true
            ? { correlation: { runId: RunId.make("foreign-run"), attemptId: AttemptId.make("foreign-attempt") } }
            : {})
        }
        turns.push(currentTurn)
        currentThread = { ...currentThread, cwd, status: "active", turns }
        if (options.dieAfterReplacementTurnStartOnce === true && !replacementTurnStartDeath) {
          replacementTurnStartDeath = true
          return yield* Effect.die("controlled process loss after replacement turn/start")
        }
        if (options.dieAfterFirstTurnStartOnce === true && !firstTurnStartDeath) {
          firstTurnStartDeath = true
          return yield* Effect.die("controlled process loss after first turn/start")
        }
        if (
          ((options.loseFirstTurnResponse === true && !firstTurnResponseLost) ||
            options.loseTurnResponseAt === turnNumber) &&
          !firstTurnResponseLost
        ) {
          firstTurnResponseLost = true
          if (options.resumeUnavailableAfterLostTurn === true) resumeUnavailable = true
          currentThread = { ...currentThread, status: options.loseResponseThreadStatus ?? "active" }
          return yield* Effect.fail(unavailable("turn/start"))
        }
        return currentTurn
      }),
    interruptTurn: (threadIdValue, turnId) => {
      if (interruptUnavailable) {
        if (interruptSettlesBeforeFailure && threadIdValue === threadId && currentTurn?.id === turnId) {
          currentTurn = {
            ...currentTurn,
            status: interruptSettlesTerminalBeforeFailure ? "completed" : "interrupted",
            ...(interruptSettlesTerminalBeforeFailure
              ? { items: [{ type: "agentMessage", text: finalResponse(head) }] }
              : {})
          }
          const currentIndex = turns.findIndex((turn) => turn.id === currentTurn?.id)
          if (currentIndex >= 0) turns[currentIndex] = currentTurn
          currentThread = { ...currentThread, status: "idle", turns }
        }
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
        return backgroundTerminationFailure ? false : wasActive
      }),
    close: Effect.void
  }

  const store: CodexAttemptStoreService = {
    readAttempt: (runId, attemptId) => {
      attemptReadCount += 1
      return (options.beforeAttemptRead?.() ?? Effect.void).pipe(
        Effect.andThen(
          readFailure
            ? Effect.fail(new CodexAttemptStoreFailure({ detail: "read failed", operation: "readAttempt" }))
            : Effect.sync(() => {
                const record = readOverride ?? records.get(keyOf(runId, attemptId))
                return record === undefined ? Option.none() : Option.some(record)
              })
        )
      )
    },
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
    readReplacementLedger: (requestId) =>
      Effect.sync(() => {
        const ledger = replacementLedgers.get(requestId)
        return ledger === undefined ? Option.none() : Option.some(ledger)
      }),
    appendReplacementLedger: (ledger) => {
      const merged = mergeCodexReplacementLedger(replacementLedgers.get(ledger.requestId), ledger)
      if (merged._tag === "Contradiction") {
        return Effect.fail(
          new CodexAttemptStoreFailure({ detail: merged.detail, operation: "appendReplacementLedger" })
        )
      }
      const phase = ledger.history.at(-1)?._tag
      const shouldFail =
        (phase === "IntentRecorded" && options.failAfterReplacementIntentOnce === true && !replacementIntentFailure) ||
        (phase === "TurnIntentRecorded" &&
          options.failAfterReplacementTurnIntentOnce === true &&
          !replacementTurnIntentFailure) ||
        (phase === "TurnBoundaryCrossingBegan" &&
          options.failAfterReplacementCalledOnce === true &&
          !replacementCalledFailure) ||
        (phase === "TurnObserved" &&
          options.failAfterReplacementObservedOnce === true &&
          !replacementObservedFailure) ||
        (phase === "Sealed" && options.failAfterReplacementSealOnce === true && !replacementSealFailure)
      if (!shouldFail) {
        replacementLedgers.set(ledger.requestId, merged.ledger)
        return Effect.void
      }
      if (phase === "IntentRecorded") replacementIntentFailure = true
      if (phase === "TurnIntentRecorded") replacementTurnIntentFailure = true
      if (phase === "TurnBoundaryCrossingBegan") replacementCalledFailure = true
      if (phase === "TurnObserved") replacementObservedFailure = true
      if (phase === "Sealed") replacementSealFailure = true
      if (phase !== "Sealed") replacementLedgers.set(ledger.requestId, merged.ledger)
      if (phase === "Sealed") {
        return Effect.fail(
          new CodexAttemptStoreFailure({
            detail: `controlled crash before ${phase}`,
            operation: "appendReplacementLedger"
          })
        )
      }
      return Effect.fail(
        new CodexAttemptStoreFailure({
          detail: `controlled crash after ${phase}`,
          operation: "appendReplacementLedger"
        })
      )
    },
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
    attemptReadCount: () => attemptReadCount,
    turnCount: () => turnNumber,
    associationAtTurn: () => associationAtTurn,
    currentThread: () => currentThread,
    currentRecord: () => records.get(keyOf(attempt.runId, attempt.attemptId)),
    replacementLedger: () => [...replacementLedgers.values()].at(-1),
    setThread: (thread) => {
      currentThread = thread
    },
    restoreProviderThread: (thread) => {
      turns.splice(0, turns.length, ...thread.turns)
      currentThread = { ...thread, turns }
      currentTurn = turns.findLast((turn) => turn.ownedTurnToken !== undefined)
      turnNumber = turns.length
    },
    preserveResumeCwd: () => {
      preserveResumeCwdOnResume = true
    },
    setRecord: (record) => {
      records.set(keyOf(record.correlationRunId, record.correlationAttemptId), record)
      if (record._tag === "AssociatedPreTurn") associatedRecord = record
    },
    setReadOverride: (record) => {
      readOverride = record
    },
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
    completeWithItems: (items) => {
      if (currentTurn === undefined) return
      currentTurn = { ...currentTurn, status: "completed", items }
      const currentIndex = turns.findIndex((turn) => turn.id === currentTurn?.id)
      if (currentIndex >= 0) turns[currentIndex] = currentTurn
      currentThread = { ...currentThread, status: "idle", turns }
    },
    makeTerminalActivity: () => {
      terminalActivity = true
    },
    finishTerminalActivity: () => {
      terminalActivity = false
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
    afterActivityCensus: () => options.afterActivityCensus?.() ?? Effect.void,
    terminateDescendants: (descendants) => {
      descendantTerminationCount += descendants.length
    },
    backgroundTerminationCount: () => backgroundTerminationCount,
    descendantTerminationCount: () => descendantTerminationCount,
    makeResumeUnavailable: () => {
      resumeUnavailable = true
    },
    setResumeFailure: (failure) => {
      resumeFailure = failure
    },
    makeReadFailure: () => {
      readFailure = true
    },
    makeForeignResume: () => {
      foreignResume = true
    },
    makeInterruptUnavailable: () => {
      interruptUnavailable = true
    },
    makeInterruptSettleBeforeFailure: () => {
      interruptUnavailable = true
      interruptSettlesBeforeFailure = true
    },
    makeInterruptTerminalBeforeFailure: () => {
      interruptUnavailable = true
      interruptSettlesBeforeFailure = true
      interruptSettlesTerminalBeforeFailure = true
    },
    makeBackgroundTerminationFail: () => {
      backgroundTerminationFailure = true
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

const defaultGitCommand: GitCommandService = {
  run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
  runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: `${head}\n` }),
  runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
}

const layerForImplementation =
  (implementationLayer: typeof codexPlannedAttemptExecutorLayer) =>
  (
    harness: Harness,
    gitCommand: GitCommandService = defaultGitCommand,
    evidenceStore: Layer.Layer<EvidenceStore> | null = memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer)),
    authority?: Layer.Layer<CodexReplacementAuthority>,
    store: CodexAttemptStoreService = harness.store,
    crypto?: Crypto.Crypto
  ) => {
    const dependencies =
      evidenceStore === null
        ? Layer.mergeAll(
            controlledCodexAppServerLayer(harness.app),
            controlledCodexOwnedActivityCensusLayer({
              observe: (thread, backgroundTerminals) =>
                Effect.succeed(harness.observeActivityCensus(thread, backgroundTerminals)).pipe(
                  Effect.tap(() => harness.afterActivityCensus())
                ),
              terminateDescendants: (descendants) => Effect.sync(() => harness.terminateDescendants(descendants))
            }),
            Layer.succeed(CodexAttemptStore, store),
            Layer.succeed(GitCommand, gitCommand)
          )
        : Layer.mergeAll(
            controlledCodexAppServerLayer(harness.app),
            controlledCodexOwnedActivityCensusLayer({
              observe: (thread, backgroundTerminals) =>
                Effect.succeed(harness.observeActivityCensus(thread, backgroundTerminals)).pipe(
                  Effect.tap(() => harness.afterActivityCensus())
                ),
              terminateDescendants: (descendants) => Effect.sync(() => harness.terminateDescendants(descendants))
            }),
            Layer.succeed(CodexAttemptStore, store),
            Layer.succeed(GitCommand, gitCommand),
            evidenceStore
          )
    const executorWithDependencies = implementationLayer.pipe(Layer.provide(dependencies))
    const executorLayer =
      crypto === undefined
        ? executorWithDependencies.pipe(Layer.provide(NodeServices.layer))
        : executorWithDependencies.pipe(Layer.provide(Layer.succeed(Crypto.Crypto, crypto)))
    return authority === undefined ? executorLayer : executorLayer.pipe(Layer.provide(authority))
  }

const layerFor = layerForImplementation(codexPlannedAttemptExecutorLayer)

const mutatedEvidenceStoreLayer = (mode: "manifest" | "reference" | "malformed"): Layer.Layer<EvidenceStore> =>
  Layer.effect(
    EvidenceStore,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      let stored = new Uint8Array()
      const digestFor = (bytes: Uint8Array) =>
        crypto.digest("SHA-256", bytes).pipe(
          Effect.mapError(
            (error) => new EvidenceStoreFailure({ detail: String(error), operation: "EvidenceStore.put" })
          ),
          Effect.map((digest) =>
            EvidenceDigest.make(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""))
          )
        )
      const put = (bytes: Uint8Array) =>
        Effect.gen(function* () {
          const submitted = bytes.slice()
          const mutated =
            mode === "manifest"
              ? new TextEncoder().encode(new TextDecoder().decode(submitted).replace(head, otherHead))
              : mode === "malformed"
                ? new TextEncoder().encode("not-json")
                : submitted
          stored = mutated
          const digest = yield* digestFor(mutated)
          return EvidenceReference.make({
            byteLength: mutated.byteLength,
            digest: mode === "reference" ? EvidenceDigest.make("f".repeat(64)) : digest
          })
        })
      return EvidenceStore.of({ put, read: () => Effect.succeed(stored.slice()) })
    })
  ).pipe(Layer.provide(NodeServices.layer))

const corruptOnRereadEvidenceStoreLayer: Layer.Layer<EvidenceStore> = Layer.effect(
  EvidenceStore,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    let stored = new Uint8Array()
    let reads = 0
    const digestFor = (bytes: Uint8Array) =>
      crypto.digest("SHA-256", bytes).pipe(
        Effect.mapError((error) => new EvidenceStoreFailure({ detail: String(error), operation: "EvidenceStore.put" })),
        Effect.map((digest) =>
          EvidenceDigest.make(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""))
        )
      )
    return EvidenceStore.of({
      put: (bytes) =>
        Effect.gen(function* () {
          stored = bytes.slice()
          const digest = yield* digestFor(stored)
          return EvidenceReference.make({ byteLength: stored.byteLength, digest })
        }),
      read: () =>
        Effect.sync(() => {
          reads += 1
          return reads === 1 ? stored.slice() : new TextEncoder().encode("corrupt evidence")
        })
    })
  })
).pipe(Layer.provide(NodeServices.layer))

const manifestDriftEvidenceStoreLayer = (replacement: Uint8Array): Layer.Layer<EvidenceStore> =>
  Layer.effect(
    EvidenceStore,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      let stored = new Uint8Array()
      let reads = 0
      const digestFor = (bytes: Uint8Array) =>
        crypto.digest("SHA-256", bytes).pipe(
          Effect.mapError(
            (error) => new EvidenceStoreFailure({ detail: String(error), operation: "EvidenceStore.put" })
          ),
          Effect.map((digest) =>
            EvidenceDigest.make(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""))
          )
        )
      return EvidenceStore.of({
        put: (bytes) =>
          Effect.gen(function* () {
            stored = bytes.slice()
            return EvidenceReference.make({ byteLength: bytes.byteLength, digest: yield* digestFor(bytes) })
          }),
        read: () =>
          Effect.sync(() => {
            reads += 1
            return reads === 1 ? stored.slice() : replacement.slice()
          })
      })
    })
  ).pipe(Layer.provide(NodeServices.layer))

type ConformanceBoundaryCall =
  | { readonly _tag: "Observe"; readonly correlation: typeof conformanceCorrelation }
  | { readonly _tag: "Begin" | "Resume"; readonly correlation: typeof conformanceCorrelation }
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
        scenario === "ForeignBegin"
          ? { foreignTurnCorrelation: true }
          : scenario === "ExecutingThenSafeSuspension"
            ? { keepTurnRunningOnInterruptCount: 1 }
            : scenario === "UnavailableSuspension"
              ? { interruptUnavailable: true }
              : {}
      const harness = makeHarness(options)
      const concrete = yield* Effect.gen(function* () {
        return yield* PlannedAttemptExecutor
      }).pipe(Effect.provide(layerFor(harness)))

      if (scenario === "ExactProjection" || scenario === "ForeignProjection") {
        yield* concrete.begin(conformanceRequest).pipe(Effect.orDie)
      }
      if (scenario === "ForeignSuspension" || scenario === "ForeignProjection") harness.makeForeignResume()
      if (scenario === "UnavailableSuspension") harness.makeInterruptUnavailable()

      const calls = yield* Ref.make<ReadonlyArray<ConformanceBoundaryCall>>([])
      const record = (call: ConformanceBoundaryCall) =>
        Ref.update(calls, (current) => [...current, call]).pipe(Effect.andThen(onBoundary(call)))
      const executor = PlannedAttemptExecutor.of({
        observe: (requested) =>
          record({ _tag: "Observe", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.observe(requested, passiveLifecycleObservationPurpose))
          ),
        requestSuspension: (requested) =>
          record({ _tag: "Suspend", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.requestSuspension(requested))
          ),
        begin: (requested) =>
          record({ _tag: "Begin", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.begin(requested)),
            Effect.tap(() =>
              scenario === "TerminalSuspension"
                ? Effect.sync(() => harness.complete(conformanceFinalResponse))
                : Effect.void
            )
          ),
        resume: (requested) =>
          record({ _tag: "Resume", correlation: conformanceCorrelation }).pipe(
            Effect.andThen(concrete.resume(requested))
          )
      })
      return { calls: Ref.get(calls), executor }
    })
}

definePlannedAttemptExecutorConformanceSuite(codexConformanceImplementation)
plannedAttemptExecutorContract({
  layer: layerForImplementation(codexPlannedAttemptExecutorLayer)(makeHarness()),
  name: "Codex app-server"
})

const observeExactReport = Effect.fn("CodexPlannedAttemptExecutorTest.observeExactReport")(function* (
  executor: PlannedAttemptExecutorService
) {
  const projection = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
  if (projection._tag === "Exact") return projection.report
  return yield* Effect.die(`expected exact executor report, received ${projection._tag}`)
})

it.effect("uses one coalesced provider wake to reproject a later terminal state without command progress", () => {
  const harness = makeHarness({ lifecycleHintCount: 1 })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
    yield* executor.begin(request)
    const readsBeforeAttachment = harness.attemptReadCount()

    const attachment = yield* lifecycle.attach(correlation)
    harness.complete(finalResponse(head))
    const changed = yield* Stream.runCollect(attachment.changes)

    expect(attachment.current).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
    expect(Array.from(changed)).toMatchObject([
      { _tag: "Exact", report: { _tag: "ExecutorWorkTerminal", correlation, result: { _tag: "Accepted" } } }
    ])
    expect(harness.attemptReadCount() - readsBeforeAttachment).toBe(2)
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("keeps equal executing provider wakes inside one passive owner without Journal or command progress", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const providerHints = yield* PubSub.unbounded<void>()
      const barrierProjectionEntered = yield* Deferred.make<void>()
      const releaseBarrierProjection = yield* Deferred.make<void>()
      const terminalPublished = yield* Deferred.make<void>()
      let observerReadCount = 0
      let observerActive = false
      const harness = makeHarness({
        beforeAttemptRead: () =>
          Effect.sync(() => {
            if (!observerActive) return observerReadCount
            observerReadCount += 1
            return observerReadCount
          }).pipe(
            Effect.flatMap((readCount) =>
              readCount === 3
                ? Deferred.succeed(barrierProjectionEntered, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseBarrierProjection))
                  )
                : Effect.void
            )
          ),
        lifecycleHints: PubSub.subscribe(providerHints).pipe(
          Effect.map((subscription) =>
            Stream.unfold(undefined, () =>
              PubSub.take(subscription).pipe(Effect.map((hint) => [hint, undefined] as const))
            )
          )
        )
      })

      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const observer = yield* makePassivePlannedAttemptObserver()
        yield* executor.begin(request)
        const currentPublications = yield* Ref.make(0)
        const changedPublications = yield* Ref.make(0)
        const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        const input = {
          plannedAttempt: attempt,
          publishCurrent: (projection: PlannedAttemptExecutorProjection) => {
            if (projection._tag !== "Exact") return Effect.die("the controlled current projection must be exact")
            return Ref.update(currentPublications, (count) => count + 1).pipe(
              Effect.as({ acceptedFacts: "UnchangedPassiveObservation" as const, report: projection.report })
            )
          },
          publishChange: (projection: PlannedAttemptExecutorProjection) =>
            Ref.update(changedPublications, (count) => count + 1).pipe(
              Effect.andThen(
                projection._tag === "Exact" && projection.report._tag === "ExecutorWorkTerminal"
                  ? Deferred.succeed(terminalPublished, undefined)
                  : Effect.die("only the later Terminal projection may leave the passive owner")
              ),
              Effect.asVoid
            )
        }

        observerActive = true
        const observed = yield* observer.attach(input)
        yield* PubSub.publish(providerHints, undefined)
        yield* PubSub.publish(providerHints, undefined)
        yield* Deferred.await(barrierProjectionEntered)
        const duplicate = yield* observer.attach(input)
        expect(duplicate).toEqual(observed)
        expect({
          changedPublications: yield* Ref.get(changedPublications),
          currentPublications: yield* Ref.get(currentPublications),
          observerReadCount
        }).toEqual({ changedPublications: 0, currentPublications: 1, observerReadCount: 3 })

        harness.complete(finalResponse(head))
        yield* Deferred.succeed(releaseBarrierProjection, undefined)
        yield* Deferred.await(terminalPublished)
        expect(yield* Ref.get(changedPublications)).toBe(1)
        expect(observerReadCount).toBe(3)
        expect(observed).toMatchObject({ acceptedFacts: "UnchangedPassiveObservation", report: executing })
        expect(harness.turnCount()).toBe(1)
      }).pipe(Effect.provide(layerFor(harness)))
    })
  )
)

it.effect("observes activity exit after an equal turn-completed wake without another turn hint", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const turnHints = yield* PubSub.unbounded<void>()
      const activityHints = yield* PubSub.unbounded<void>()
      const equalProjectionObserved = yield* Deferred.make<void>()
      const terminalPublished = yield* Deferred.make<void>()
      let observerObservationCount = 0
      let observerActive = false
      const harness = makeHarness({
        afterActivityCensus: () =>
          Effect.sync(() => {
            if (!observerActive) return observerObservationCount
            observerObservationCount += 1
            return observerObservationCount
          }).pipe(
            Effect.flatMap((observationCount) =>
              observationCount === 2 ? Deferred.succeed(equalProjectionObserved, undefined) : Effect.void
            )
          ),
        lifecycleHints: PubSub.subscribe(turnHints).pipe(
          Effect.map((subscription) =>
            Stream.unfold(undefined, () =>
              PubSub.take(subscription).pipe(Effect.map((hint) => [hint, undefined] as const))
            )
          )
        ),
        activityHints: PubSub.subscribe(activityHints).pipe(
          Effect.map((subscription) =>
            Stream.unfold(undefined, () =>
              PubSub.take(subscription).pipe(Effect.map((hint) => [hint, undefined] as const))
            )
          )
        )
      })

      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const observer = yield* makePassivePlannedAttemptObserver()
        yield* executor.begin(request)
        harness.makeTerminalActivity()
        harness.complete(finalResponse(head))
        const changedPublications = yield* Ref.make(0)
        observerActive = true
        const observed = yield* observer.attach({
          plannedAttempt: attempt,
          publishCurrent: (projection) => {
            if (projection._tag !== "Exact") {
              return Effect.die("owned activity must keep the exact attempt Executing")
            }
            return Effect.succeed({ acceptedFacts: "UnchangedPassiveObservation" as const, report: projection.report })
          },
          publishChange: (projection) =>
            projection._tag === "Exact" && projection.report._tag === "ExecutorWorkTerminal"
              ? Ref.update(changedPublications, (count) => count + 1).pipe(
                  Effect.andThen(Deferred.succeed(terminalPublished, undefined)),
                  Effect.asVoid
                )
              : Effect.die("owned-activity exit must publish the retained terminal projection")
        })

        expect(observed).toMatchObject({
          acceptedFacts: "UnchangedPassiveObservation",
          report: { _tag: "ExecutorWorkExecuting", correlation }
        })
        yield* PubSub.publish(turnHints, undefined)
        yield* Deferred.await(equalProjectionObserved)
        expect(yield* Ref.get(changedPublications)).toBe(0)

        harness.finishTerminalActivity()
        yield* PubSub.publish(activityHints, undefined)
        yield* Deferred.await(terminalPublished)
        expect(yield* Ref.get(changedPublications)).toBe(1)
        // Terminal sealing deliberately performs a second census after the
        // accepted-result evidence read, so the three projections make four
        // authoritative activity observations in total.
        expect(observerObservationCount).toBe(4)
      }).pipe(Effect.provide(layerFor(harness)))
    })
  )
)

it.effect("current-first attachment cannot miss a terminal change between projection and await", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const providerHints = yield* PubSub.unbounded<void>()
      const subscriptionAttached = yield* Deferred.make<void>()
      const harness = makeHarness({
        lifecycleHints: PubSub.subscribe(providerHints).pipe(
          Effect.tap(() => Deferred.succeed(subscriptionAttached, undefined)),
          Effect.map((subscription) =>
            Stream.unfold(undefined, () =>
              PubSub.take(subscription).pipe(Effect.map((hint) => [hint, undefined] as const))
            )
          )
        )
      })

      const attachment = yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
        yield* executor.begin(request)
        const attached = yield* lifecycle.attach(correlation)
        yield* Deferred.await(subscriptionAttached)
        expect(attached.current).toMatchObject({
          _tag: "Exact",
          report: { _tag: "ExecutorWorkExecuting", correlation }
        })
        harness.complete(finalResponse(head))
        yield* PubSub.publish(providerHints, undefined)
        const changed = yield* Stream.runHead(attached.changes)
        return { attached, changed }
      }).pipe(Effect.provide(layerFor(harness)))

      expect(attachment.changed).toMatchObject({
        _tag: "Some",
        value: { _tag: "Exact", report: { _tag: "ExecutorWorkTerminal", correlation, result: { _tag: "Accepted" } } }
      })
      expect(harness.turnCount()).toBe(1)
      yield* attachment.attached.close
    })
  )
)

it.effect("rebuilds Codex lifecycle attachment from durable association across scoped restart", () =>
  Effect.forEach(
    ["Terminal", "Safe"] as const,
    (outcome) =>
      Effect.scoped(
        Effect.gen(function* () {
          const firstHarness = makeHarness()
          const sharedStore = firstHarness.store
          const firstCurrent = yield* Effect.gen(function* () {
            const executor = yield* PlannedAttemptExecutor
            const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
            yield* executor.begin(request)
            return (yield* lifecycle.attach(correlation)).current
          }).pipe(Effect.provide(layerFor(firstHarness, defaultGitCommand, undefined, undefined, sharedStore)))

          expect(firstCurrent).toMatchObject({ _tag: "Exact", report: { _tag: "ExecutorWorkExecuting", correlation } })
          expect(firstHarness.currentRecord()).toMatchObject({
            _tag: "Running",
            correlationRunId: correlation.runId,
            correlationAttemptId: correlation.attemptId,
            threadId: firstHarness.currentThread().id
          })

          const lifecycleHints = yield* PubSub.unbounded<void>()
          const secondHarness = makeHarness({
            lifecycleHints: PubSub.subscribe(lifecycleHints).pipe(
              Effect.map((subscription) =>
                Stream.unfold(undefined, () =>
                  PubSub.take(subscription).pipe(Effect.map((hint) => [hint, undefined] as const))
                )
              )
            )
          })
          secondHarness.restoreProviderThread(firstHarness.currentThread())

          const changed = yield* Effect.gen(function* () {
            const executor = yield* PlannedAttemptExecutor
            const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
            const attachment = yield* lifecycle.attach(correlation)
            expect(attachment.current).toMatchObject({
              _tag: "Exact",
              report: { _tag: "ExecutorWorkExecuting", correlation }
            })

            if (outcome === "Terminal") {
              const thread = secondHarness.currentThread()
              const retainedTurn = thread.turns.findLast((turn) => turn.ownedTurnToken !== undefined)
              if (retainedTurn === undefined) return yield* Effect.die("restart fixture lost the durable owned turn")
              secondHarness.restoreProviderThread({
                ...thread,
                status: "idle",
                turns: [
                  ...thread.turns.filter((turn) => turn.id !== retainedTurn.id),
                  { ...retainedTurn, status: "completed", items: [{ type: "agentMessage", text: finalResponse(head) }] }
                ]
              })
            } else {
              expect(yield* executor.requestSuspension(attempt)).toEqual(
                PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
              )
            }
            yield* PubSub.publish(lifecycleHints, undefined)
            return yield* attachment.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          }).pipe(Effect.provide(layerFor(secondHarness, defaultGitCommand, undefined, undefined, sharedStore)))

          expect(changed).toMatchObject({
            _tag: "Exact",
            report: {
              _tag: outcome === "Terminal" ? "ExecutorWorkTerminal" : "ExecutorWorkSafelySuspended",
              correlation
            }
          })
          expect(firstHarness.turnCount()).toBe(1)
          expect(secondHarness.turnCwds).toHaveLength(0)
        })
      ),
    { discard: true }
  )
)

it.effect("persists the exact association before the first turn and seals Accepted from reread evidence", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const first = yield* executor.begin(request)
    expect(first).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
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
    const accepted = yield* observeExactReport(executor)
    expect(accepted._tag).toBe("ExecutorWorkTerminal")
    if (accepted._tag === "ExecutorWorkTerminal") {
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

    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact" && projected.report._tag === "ExecutorWorkTerminal") {
      expect(projected.report.result._tag).toBe("Accepted")
    }

    const resumeCountBeforeRestart = harness.resumeCwds.length
    const restarted = yield* Effect.gen(function* () {
      const restartedExecutor = yield* PlannedAttemptExecutor
      return yield* observeExactReport(restartedExecutor)
    }).pipe(Effect.provide(layerFor(harness)))
    expect(restarted._tag).toBe("ExecutorWorkTerminal")
    expect(harness.resumeCwds.length).toBeGreaterThan(resumeCountBeforeRestart)
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("fails closed when accepted evidence changes its manifest, content address, or encoding", () =>
  Effect.forEach(["manifest", "reference", "malformed"] as const, (mode) => {
    const harness = makeHarness()
    return Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request)
      harness.complete(finalResponse(head))
      const result = yield* observeExactReport(executor).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
    }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, mutatedEvidenceStoreLayer(mode))))
  })
)

it.effect("keeps an accepted turn running when activity appears during evidence publication", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensusSequence([
      { _tag: "Absent" },
      { _tag: "ExactLive", activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("late-active-58") }] }
    ])
    expect(yield* observeExactReport(executor)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(harness.currentRecord()?._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("fails closed when evidence is unavailable or Git cannot prove the accepted head", () => {
  const unavailableEvidenceHarness = makeHarness()
  const failedHeadHarness = makeHarness()
  const malformedHeadHarness = makeHarness()
  const movingHeadHarness = makeHarness()
  const rereadFailureHarness = makeHarness()
  const failedHead: GitCommandService = {
    ...defaultGitCommand,
    runInWorktree: () => Effect.succeed({ exitCode: 1, stderr: "rev-parse failed", stdout: "" })
  }
  const malformedHead: GitCommandService = {
    ...defaultGitCommand,
    runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "not-a-commit\n" })
  }
  let headReads = 0
  const movingHead: GitCommandService = {
    ...defaultGitCommand,
    runInWorktree: () =>
      Effect.sync(() => ({ exitCode: 0, stderr: "", stdout: `${headReads++ === 0 ? head : otherHead}\n` }))
  }
  let rereadHeadReads = 0
  const rereadFailure: GitCommandService = {
    ...defaultGitCommand,
    runInWorktree: () =>
      Effect.sync(() =>
        rereadHeadReads++ === 0
          ? { exitCode: 0, stderr: "", stdout: `${head}\n` }
          : { exitCode: 1, stderr: "rev-parse failed during reread", stdout: "" }
      )
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    unavailableEvidenceHarness.complete(finalResponse(head))
    const unavailableEvidence = yield* observeExactReport(executor).pipe(Effect.exit)
    expect(unavailableEvidence._tag).toBe("Failure")
    expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
  }).pipe(
    Effect.provide(layerFor(unavailableEvidenceHarness, defaultGitCommand, null)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        failedHeadHarness.complete(finalResponse(head))
        expect((yield* observeExactReport(executor).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(failedHeadHarness, failedHead)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        malformedHeadHarness.complete(finalResponse(head))
        expect((yield* observeExactReport(executor).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(malformedHeadHarness, malformedHead)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        movingHeadHarness.complete(finalResponse(head))
        expect((yield* observeExactReport(executor).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(movingHeadHarness, movingHead)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        rereadFailureHarness.complete(finalResponse(head))
        expect((yield* observeExactReport(executor).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(rereadFailureHarness, rereadFailure)))
    )
  )
})

it.effect("normalizes an immediate provider failure to Begin Executing and exposes Terminal passively", () => {
  const failedHarness = makeHarness({ terminalTurnStatus: "failed" })
  const tokenHarness = makeHarness({ wrongOwnedTurnToken: true })
  return Effect.gen(function* () {
    const failedExecutor = yield* PlannedAttemptExecutor
    const began = yield* failedExecutor.begin(request)
    expect(began).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    expect(failedHarness.currentRecord()?._tag).toBe("Terminal")
    expect(yield* failedExecutor.observe(correlation, { _tag: "ReconcileCommand", command: "Begin" })).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
    expect(yield* observeExactReport(failedExecutor)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    )
  }).pipe(
    Effect.provide(layerFor(failedHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const result = yield* executor.begin(request).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(tokenHarness)))
    )
  )
})

it.effect("seals a recovered failed owned turn even when Codex marks its thread systemError", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect((yield* executor.begin(request))._tag).toBe("ExecutorWorkExecuting")
    const thread = harness.currentThread()
    harness.setThread({
      ...thread,
      status: "systemError",
      turns: thread.turns.map((turn) => ({ ...turn, status: "failed" as const }))
    })
    const failed = yield* observeExactReport(executor)
    expect(failed).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    )
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("rejects malformed, foreign, ambiguous, and non-JSON terminal messages without accepting a commit", () =>
  Effect.forEach(
    [
      [null, { type: "agentMessage", text: "{not-json" }],
      [{ type: "agentMessage", text: 42 }],
      [{ type: "agentMessage", text: "null" }],
      [{ type: "agentMessage", text: "{}" }],
      [{ type: "agentMessage", text: JSON.stringify({ correlation: { runId: "", attemptId: "" }, commit: head }) }],
      [
        {
          type: "agentMessage",
          text: JSON.stringify({ correlation: { runId: "foreign-run", attemptId: "foreign-attempt" }, commit: head })
        }
      ],
      [{ type: "agentMessage", text: JSON.stringify({ correlation, commit: "not-a-commit" }) }],
      [{ type: "agentMessage", text: JSON.stringify({ correlation, commit: head }) + ` ${"b".repeat(40)}` }],
      [{ type: "agentMessage", text: JSON.stringify({ correlation }) }],
      [{ type: "other", text: "no terminal response" }],
      [
        { type: "other", text: finalResponse(head) },
        { type: "agentMessage", text: "plain text" }
      ]
    ] as ReadonlyArray<ReadonlyArray<unknown>>,
    (items) => {
      const harness = makeHarness()
      return Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        harness.completeWithItems(items)
        const failed = yield* observeExactReport(executor)
        expect(failed).toEqual(
          PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
        )
      }).pipe(Effect.provide(layerFor(harness)))
    }
  )
)

it.effect(
  "rereads accepted terminal evidence and keeps it unresolved when the turn, Git head, or activity changes",
  () => {
    const activityHarness = makeHarness()
    const turnHarness = makeHarness()
    const headHarness = makeHarness()
    let headMismatch = false
    const rereadHead: GitCommandService = {
      ...defaultGitCommand,
      runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: `${headMismatch ? otherHead : head}\n` })
    }
    return Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request)
      activityHarness.complete(finalResponse(head))
      const accepted = yield* observeExactReport(executor)
      expect(accepted._tag).toBe("ExecutorWorkTerminal")
      activityHarness.setActivityCensusSequence([
        { _tag: "Absent" },
        {
          _tag: "ExactLive",
          activities: [
            {
              _tag: "BackgroundTerminal",
              terminal: {
                processId: "accepted-background-58",
                itemId: "accepted-item-58",
                command: "npm test",
                cwd: worktree
              }
            }
          ]
        }
      ])
      const activityDuringReread = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
      expect(activityDuringReread._tag).toBe("Exact")
      if (activityDuringReread._tag === "Exact") expect(activityDuringReread.report._tag).toBe("ExecutorWorkExecuting")
      activityHarness.setActivityCensus({ _tag: "Absent" })
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Exact")
    }).pipe(
      Effect.provide(layerFor(activityHarness)),
      Effect.andThen(
        Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.begin(request)
          turnHarness.complete(finalResponse(head))
          expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkTerminal")
          turnHarness.complete(finalResponse(otherHead))
          expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
        }).pipe(Effect.provide(layerFor(turnHarness)))
      ),
      Effect.andThen(
        Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.begin(request)
          headHarness.complete(finalResponse(head))
          expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkTerminal")
          headMismatch = true
          expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
        }).pipe(Effect.provide(layerFor(headHarness, rereadHead)))
      )
    )
  }
)

it.effect(
  "reprojects a retained accepted terminal as unreadable when evidence service is unavailable after restart",
  () => {
    const harness = makeHarness()
    const accepted = Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request)
      harness.complete(finalResponse(head))
      expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkTerminal")
    }).pipe(Effect.provide(layerFor(harness)))
    const restarted = Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
    }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, null)))
    return accepted.pipe(Effect.andThen(restarted))
  }
)

it.effect("rejects corrupted evidence when rereading an accepted terminal", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkTerminal")
    expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
  }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, corruptOnRereadEvidenceStoreLayer)))
})

it.effect("admits only one same-attempt Begin behind the executor gate", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const exits = yield* Effect.all(
      Array.from({ length: 12 }, () => executor.begin(request).pipe(Effect.exit)),
      { concurrency: 12 }
    )
    expect(exits.filter(({ _tag }) => _tag === "Success")).toHaveLength(1)
    expect(exits.filter(({ _tag }) => _tag === "Failure")).toHaveLength(11)
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("does not accept a commit without the exact final response correlation", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(JSON.stringify({ commit: head }))
    const result = yield* observeExactReport(executor)
    expect(result).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    )
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("matches an owned turn correlation when the app-server records it explicitly", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const thread = harness.currentThread()
    const turn = thread.turns[0]
    expect(turn).toBeDefined()
    if (turn !== undefined) {
      harness.setThread({ ...thread, turns: [{ ...turn, correlation }] })
    }
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") expect(projected.report._tag).toBe("ExecutorWorkExecuting")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost provider response and keeps lost public Begin reconciliation executing", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true, terminalTurnStatus: "completed" })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const began = yield* executor.begin(request)
    expect(began).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    expect(yield* executor.observe(correlation, { _tag: "ReconcileCommand", command: "Begin" })).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
    expect(yield* observeExactReport(executor)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    )
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Terminal")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost Begin terminal after restart before exposing it passively", () => {
  const harness = makeHarness({ terminalTurnStatus: "completed", dieAfterFirstTurnStartOnce: true })
  const firstProcess = Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const lost = yield* executor.begin(request).pipe(Effect.exit)
    expect(lost._tag).toBe("Failure")
    expect(harness.currentRecord()?._tag).toBe("TurnIntentRecorded")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))

  return firstProcess.pipe(
    // The provider completed the exact turn during the process loss; only
    // the private local result persistence was skipped.
    Effect.andThen(Effect.sync(() => harness.complete(finalResponse(head)))),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const reconciled = yield* executor.observe(correlation, { _tag: "ReconcileCommand", command: "Begin" })
        expect(reconciled).toEqual(
          PlannedAttemptExecutorProjection.cases.Exact.make({
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          })
        )
        expect(harness.currentRecord()?._tag).toBe("Terminal")
        expect(harness.turnCount()).toBe(1)
        expect(harness.turnCwds).toHaveLength(1)
        const resumeCallsAfterReconciliation = harness.resumeCwds.length
        expect(yield* executor.observe(correlation, { _tag: "ReconcileCommand", command: "Begin" })).toEqual(reconciled)
        expect(harness.resumeCwds.length).toBe(resumeCallsAfterReconciliation)

        const passive = yield* observeExactReport(executor)
        expect(passive._tag).toBe("ExecutorWorkTerminal")
        if (passive._tag === "ExecutorWorkTerminal") {
          expect(passive.result._tag).toBe("Accepted")
          if (passive.result._tag === "Accepted") expect(passive.result.acceptedResult.commit).toBe(head)
        }
        expect(harness.turnCount()).toBe(1)
        expect(yield* observeExactReport(executor)).toEqual(passive)
      }).pipe(Effect.provide(layerFor(harness)))
    )
  )
})

it.effect("retains the original turn-start failure when recovery cannot resume the thread", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true, resumeUnavailableAfterLostTurn: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const result = yield* executor.begin(request).pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("backfills an omitted owned token on the started turn", () => {
  const harness = makeHarness({ omitOwnedTurnToken: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect((yield* executor.begin(request))._tag).toBe("ExecutorWorkExecuting")
    const record = harness.currentRecord()
    expect(record?._tag).toBe("Running")
    if (record?._tag === "Running") {
      expect(harness.currentThread().turns[0]?.ownedTurnToken).toBeUndefined()
      expect(record.currentToken).toBeDefined()
    }
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost turn response without sending a second turn", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const running = yield* executor.begin(request)
    expect(running._tag).toBe("ExecutorWorkExecuting")
    expect(harness.turnCount()).toBe(1)

    harness.complete(finalResponse(head))
    const accepted = yield* observeExactReport(executor)
    expect(accepted._tag).toBe("ExecutorWorkTerminal")
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

it.effect("fails closed when a lost turn response leaves an interrupted turn idle", () => {
  const harness = makeHarness({
    loseFirstTurnResponse: true,
    loseResponseThreadStatus: "idle",
    terminalTurnStatus: "interrupted"
  })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const failure = yield* executor.begin(request).pipe(Effect.flip)
    expect(failure.command).toBe("Begin")
    expect(failure.correlation).toEqual(correlation)
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentThread().status).toBe("idle")
    expect(harness.currentThread().turns[0]?.status).toBe("interrupted")
    expect(harness.currentRecord()?._tag).toBe("TurnIntentRecorded")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("seals Failed on commit mismatch and never reports Completed", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(otherHead))
    harness.setActivityCensusSequence([{ _tag: "Absent" }, { _tag: "ExactLive", activities: [] }, { _tag: "Absent" }])
    const running = yield* observeExactReport(executor)
    expect(running._tag).toBe("ExecutorWorkExecuting")
    const failed = yield* observeExactReport(executor)
    expect(failed).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    )
    const again = yield* observeExactReport(executor)
    expect(again).toEqual(failed)
    expect(JSON.stringify(failed)).not.toContain("Completed")
    harness.setActivityCensus({ _tag: "ExactLive", activities: [] })
    const activeTerminal = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(activeTerminal._tag).toBe("Exact")
    if (activeTerminal._tag === "Exact") expect(activeTerminal.report._tag).toBe("ExecutorWorkExecuting")
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
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    const result = yield* observeExactReport(executor).pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Unreadable")
  }).pipe(Effect.provide(layerFor(harness, unavailableGit)))
})

it.effect("lets a terminal result win the suspension race and keeps owned activity running", () => {
  const terminalHarness = makeHarness()
  const activityHarness = makeHarness()
  return Effect.gen(function* () {
    const terminalExecutor = yield* PlannedAttemptExecutor
    yield* terminalExecutor.begin(request)
    terminalHarness.complete(finalResponse(head))
    const terminal = yield* terminalExecutor.requestSuspension(attempt)
    expect(terminal._tag).toBe("ExecutorWorkTerminal")
    if (terminal._tag === "ExecutorWorkTerminal") expect(terminal.result._tag).toBe("Accepted")
  }).pipe(
    Effect.provide(layerFor(terminalHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const activityExecutor = yield* PlannedAttemptExecutor
        yield* activityExecutor.begin(request)
        activityHarness.complete(finalResponse(head))
        activityHarness.makeTerminalActivity()
        const report = yield* activityExecutor.requestSuspension(attempt)
        expect(report._tag).toBe("ExecutorWorkExecuting")
      }).pipe(Effect.provide(layerFor(activityHarness)))
    )
  )
})

it.effect("terminates a reported background activity before reporting safe suspension", () => {
  const harness = makeHarness()
  harness.makeTerminalActivity()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }))
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
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensus({ _tag: "ExactLive", activities: [{ _tag: "BackgroundTerminal", terminal: hiddenTool }] })
    const running = yield* observeExactReport(executor)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    harness.setActivityCensus({ _tag: "Absent" })
    const accepted = yield* observeExactReport(executor)
    expect(accepted._tag).toBe("ExecutorWorkTerminal")
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
    yield* executor.begin(request)
    harness.setActivityCensus({
      _tag: "ExactLive",
      activities: [{ _tag: "ProcessGroupDescendant", identity: descendant }]
    })
    const failed = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
    expect(failed._tag).toBe("Failure")
    expect(harness.descendantTerminationCount()).toBeGreaterThan(0)
    harness.setActivityCensus({ _tag: "Absent" })
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("ExecutorWorkSafelySuspended")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("keeps suspension unresolved for contradictory, active, surviving, and failed activity cleanup", () => {
  const contradictoryHarness = makeHarness()
  const activeHarness = makeHarness()
  const survivingHarness = makeHarness()
  const failedTerminationHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    contradictoryHarness.setActivityCensus({ _tag: "Contradictory", detail: "contradictory activity" })
    const contradictory = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
    expect(contradictory._tag).toBe("Failure")
  }).pipe(
    Effect.provide(layerFor(contradictoryHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        activeHarness.setActivityCensus({
          _tag: "ExactLive",
          activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("active-turn-58") }]
        })
        const active = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
        expect(active._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(activeHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        survivingHarness.makeTerminalActivity()
        survivingHarness.setActivityCensus({
          _tag: "ExactLive",
          activities: [
            {
              _tag: "BackgroundTerminal",
              terminal: {
                processId: "surviving-terminal-58",
                itemId: "surviving-item-58",
                command: "npm test",
                cwd: worktree,
                osPid: null
              }
            }
          ]
        })
        const surviving = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
        expect(surviving._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(survivingHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        failedTerminationHarness.makeTerminalActivity()
        failedTerminationHarness.makeBackgroundTerminationFail()
        const failedTermination = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
        expect(failedTermination._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(failedTerminationHarness)))
    )
  )
})

it.effect("reconciles an interrupted response that settled before its error and retains no duplicate interrupt", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.makeInterruptSettleBeforeFailure()
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }))
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("lets a terminal turn observed after interrupt failure win suspension", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.makeInterruptTerminalBeforeFailure()
    const report = yield* executor.requestSuspension(attempt)
    expect(report._tag).toBe("ExecutorWorkTerminal")
    if (report._tag === "ExecutorWorkTerminal") expect(report.result._tag).toBe("Accepted")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("fails closed when the persisted prior owned turn is self-referential or missing", () => {
  const selfReferentialHarness = makeHarness()
  const missingPriorHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const current = selfReferentialHarness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag === "Running") {
      selfReferentialHarness.setRecord(
        CodexAttemptRecord.cases.Running.make({ ...current, priorObservedTurnId: current.observedTurnId })
      )
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
    }
  }).pipe(
    Effect.provide(layerFor(selfReferentialHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = missingPriorHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          missingPriorHarness.setRecord(
            CodexAttemptRecord.cases.Running.make({
              ...current,
              priorObservedTurnId: CodexTurnId.make("missing-prior-58")
            })
          )
          expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
        }
      }).pipe(Effect.provide(layerFor(missingPriorHarness)))
    )
  )
})

it.effect("reconciles a persisted turn intent through running and safe suspension", () => {
  const runningHarness = makeHarness()
  const suspensionHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const current = runningHarness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag === "Running") {
      runningHarness.setRecord(
        CodexAttemptRecord.cases.TurnIntentRecorded.make({
          attemptId: current.attemptId,
          correlationAttemptId: current.correlationAttemptId,
          correlationRunId: current.correlationRunId,
          currentToken: current.currentToken,
          priorObservedTurnId: current.priorObservedTurnId,
          threadId: current.threadId,
          worktree: current.worktree
        })
      )
      expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkExecuting")
      expect(runningHarness.currentRecord()?._tag).toBe("TurnIntentRecorded")
    }
  }).pipe(
    Effect.provide(layerFor(runningHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = suspensionHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          suspensionHarness.setRecord(
            CodexAttemptRecord.cases.TurnIntentRecorded.make({
              attemptId: current.attemptId,
              correlationAttemptId: current.correlationAttemptId,
              correlationRunId: current.correlationRunId,
              currentToken: current.currentToken,
              priorObservedTurnId: current.priorObservedTurnId,
              threadId: current.threadId,
              worktree: current.worktree
            })
          )
          expect(yield* executor.requestSuspension(attempt)).toEqual(
            PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
          )
          expect(suspensionHarness.currentRecord()?._tag).toBe("SafelySuspended")
        }
      }).pipe(Effect.provide(layerFor(suspensionHarness)))
    )
  )
})

it.effect("normalizes suspension requests with absent, foreign, and empty-pre-turn records", () => {
  const absentHarness = makeHarness()
  const foreignHarness = makeHarness()
  const emptyHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const absent = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
    expect(absent._tag).toBe("Failure")
  }).pipe(
    Effect.provide(layerFor(absentHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = foreignHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          foreignHarness.setReadOverride(
            CodexAttemptRecord.cases.Running.make({
              ...current,
              correlationAttemptId: AttemptId.make("foreign-suspension-attempt"),
              correlationRunId: RunId.make("foreign-suspension-run")
            })
          )
        }
        const foreign = yield* executor.requestSuspension(attempt)
        expect(foreign._tag).toBe("ExecutorWorkExecuting")
        expect(foreign.correlation.attemptId).toBe("foreign-suspension-attempt")
      }).pipe(Effect.provide(layerFor(foreignHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = emptyHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        emptyHarness.setRecord(
          CodexAttemptRecord.cases.EmptyPreTurn.make({
            attemptId: attempt.attemptId,
            correlationAttemptId: attempt.attemptId,
            correlationRunId: attempt.runId,
            worktree
          })
        )
        const empty = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
        expect(empty._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(emptyHarness)))
    )
  )
})

it.effect("fails closed for malformed thread states and unresolved turn intents", () => {
  const notLoadedHarness = makeHarness()
  const systemErrorHarness = makeHarness()
  const cwdMismatchHarness = makeHarness()
  const associatedActivityHarness = makeHarness()
  const unresolvedHarness = makeHarness()
  const observedMissingHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    notLoadedHarness.setThread({ ...notLoadedHarness.currentThread(), status: "notLoaded" })
    expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
    expect(yield* executor.begin(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
  }).pipe(
    Effect.provide(layerFor(notLoadedHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        systemErrorHarness.setThread({ ...systemErrorHarness.currentThread(), status: "systemError" })
        expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
      }).pipe(Effect.provide(layerFor(systemErrorHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        cwdMismatchHarness.setThread({ ...cwdMismatchHarness.currentThread(), cwd: "/tmp/foreign-worktree" })
        cwdMismatchHarness.preserveResumeCwd()
        expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
      }).pipe(Effect.provide(layerFor(cwdMismatchHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = associatedActivityHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          associatedActivityHarness.setRecord(
            CodexAttemptRecord.cases.AssociatedPreTurn.make({
              attemptId: current.attemptId,
              correlationAttemptId: current.correlationAttemptId,
              correlationRunId: current.correlationRunId,
              threadId: current.threadId,
              worktree: current.worktree
            })
          )
          expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
          associatedActivityHarness.setThread({
            id: current.threadId,
            cwd: current.worktree,
            status: "idle",
            turns: []
          })
          expect(yield* executor.requestSuspension(attempt).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
        }
      }).pipe(Effect.provide(layerFor(associatedActivityHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = unresolvedHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          const intent = CodexAttemptRecord.cases.TurnIntentRecorded.make({
            attemptId: current.attemptId,
            correlationAttemptId: current.correlationAttemptId,
            correlationRunId: current.correlationRunId,
            currentToken: CodexOwnedTurnToken.make("missing-intent-token"),
            priorObservedTurnId: current.priorObservedTurnId,
            threadId: current.threadId,
            worktree: current.worktree
          })
          unresolvedHarness.setRecord(intent)
          unresolvedHarness.setThread({ id: current.threadId, cwd: current.worktree, status: "idle", turns: [] })
          expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
          expect(yield* executor.requestSuspension(attempt).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
          expect(yield* executor.begin(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
        }
      }).pipe(Effect.provide(layerFor(unresolvedHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const current = observedMissingHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          observedMissingHarness.setRecord(
            CodexAttemptRecord.cases.TurnObserved.make({
              attemptId: current.attemptId,
              correlationAttemptId: current.correlationAttemptId,
              correlationRunId: current.correlationRunId,
              currentToken: current.currentToken,
              observedTurnId: current.observedTurnId,
              priorObservedTurnId: current.priorObservedTurnId,
              threadId: current.threadId,
              worktree: current.worktree
            })
          )
          observedMissingHarness.setThread({ id: current.threadId, cwd: current.worktree, status: "idle", turns: [] })
          expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
        }
      }).pipe(Effect.provide(layerFor(observedMissingHarness)))
    )
  )
})

it.effect("keeps a terminal attempt running when its activity census is unreadable", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensus({ _tag: "Unreadable", detail: "controlled process observation" })
    const running = yield* observeExactReport(executor)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") expect(projected.report._tag).toBe("ExecutorWorkExecuting")
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
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensus({
      _tag: "ExactLive",
      activities: [{ _tag: "ProcessGroupDescendant", identity: descendant }]
    })
    const running = yield* observeExactReport(executor)
    expect(running._tag).toBe("ExecutorWorkExecuting")
    harness.setActivityCensus({ _tag: "Absent" })
    const accepted = yield* observeExactReport(executor)
    expect(accepted._tag).toBe("ExecutorWorkTerminal")
    if (accepted._tag === "ExecutorWorkTerminal") expect(accepted.result._tag).toBe("Accepted")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("does not issue a second Begin after an association write failure", () => {
  const harness = makeHarness({ failAssociatedWriteOnce: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const first = yield* executor.begin(request).pipe(Effect.exit)
    expect(first._tag).toBe("Failure")
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
    )
    expect(harness.threadStarts()).toBe(1)
    expect(harness.turnCount()).toBe(0)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("sends the first turn on a freshly associated thread without treating it as recovered state", () => {
  const harness = makeHarness({ missingEmptyThread: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const running = yield* executor.begin(request)
    expect(running._tag).toBe("ExecutorWorkExecuting")
    expect(harness.threadStarts()).toBe(1)
    expect(harness.resumeCwds).toHaveLength(0)
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("does not replace a conclusively absent recovered pre-turn thread", () => {
  const harness = makeHarness({ missingEmptyThread: true })
  return Effect.gen(function* () {
    const lostEmptyThread = yield* harness.app.startThread(worktree)
    harness.setRecord(
      CodexAttemptRecord.cases.AssociatedPreTurn.make({
        attemptId: attempt.attemptId,
        correlationAttemptId: attempt.attemptId,
        correlationRunId: attempt.runId,
        threadId: lostEmptyThread.id,
        worktree
      })
    )
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.begin(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
    expect(harness.threadStarts()).toBe(1)
    expect(harness.turnCount()).toBe(0)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("normalizes unavailable and foreign resume observations without replacing the attempt", () => {
  const unavailableHarness = makeHarness()
  const foreignHarness = makeHarness()
  return Effect.gen(function* () {
    const unavailableExecutor = yield* PlannedAttemptExecutor
    yield* unavailableExecutor.begin(request)
    unavailableHarness.makeResumeUnavailable()
    const unavailable = yield* unavailableExecutor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(unavailable._tag).toBe("TemporarilyUnavailable")
    expect(unavailableHarness.threadStarts()).toBe(1)
  }).pipe(
    Effect.provide(layerFor(unavailableHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const foreignExecutor = yield* PlannedAttemptExecutor
        yield* foreignExecutor.begin(request)
        foreignHarness.makeForeignResume()
        const contradiction = yield* foreignExecutor.observe(correlation, passiveLifecycleObservationPurpose)
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
    yield* executor.begin(request)
    const firstTurnRecord = harness.currentRecord()
    expect(firstTurnRecord?._tag).toBe("Running")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }))
    expect(harness.threadStarts()).toBe(1)

    const resumed = yield* executor.resume(request)
    expect(resumed._tag).toBe("ExecutorWorkExecuting")
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

it.effect("reconciles a lost Resume response against the later turn without duplication", () => {
  const harness = makeHarness({ loseTurnResponseAt: 2 })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const firstTurnRecord = harness.currentRecord()
    expect(firstTurnRecord?._tag).toBe("Running")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("ExecutorWorkSafelySuspended")

    const resumed = yield* executor.resume(request)
    expect(resumed._tag).toBe("ExecutorWorkExecuting")
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
    const accepted = yield* observeExactReport(executor)
    expect(accepted._tag).toBe("ExecutorWorkTerminal")
    expect(harness.turnCount()).toBe(2)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("matches the owned turn by token across manual turns and reordered snapshots", () => {
  const harness = makeHarness({ manualBeforeFirstTurn: true, manualAfterFirstTurn: true, reorderTurnsOnResume: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    const accepted = yield* observeExactReport(executor)
    expect(accepted._tag).toBe("ExecutorWorkTerminal")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("preserves foreign-token turns while reporting the exact owned turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.addForeignOwnedTurn()
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") expect(projected.report._tag).toBe("ExecutorWorkExecuting")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("maps duplicate owned tokens to an unreadable projection without choosing a turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.duplicateOwnedTurn()
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Unreadable")
    const retried = yield* executor.begin(request).pipe(Effect.exit)
    expect(retried._tag).toBe("Failure")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("maps an owned token to a contradictory turn id without choosing a turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.contradictOwnedTurnId()
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Unreadable")
    const retried = yield* executor.begin(request).pipe(Effect.exit)
    expect(retried._tag).toBe("Failure")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("maps a foreign correlation on the owned token to a contradiction", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.makeForeignTurnCorrelation()
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("CorrelationContradiction")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("projects no report, safe suspension, and an idle running record through the normalized boundary", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("NoReport")

    const running = yield* executor.begin(request)
    expect(running._tag).toBe("ExecutorWorkExecuting")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("ExecutorWorkSafelySuspended")
    const projectedSuspension = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projectedSuspension).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
    )

    const current = harness.currentRecord()
    expect(current?._tag).toBe("SafelySuspended")
    if (current?._tag === "SafelySuspended") {
      harness.setRecord(
        CodexAttemptRecord.cases.Running.make({
          attemptId: current.attemptId,
          correlationAttemptId: current.correlationAttemptId,
          correlationRunId: current.correlationRunId,
          currentToken: current.currentToken,
          observedTurnId: current.observedTurnId,
          priorObservedTurnId: current.priorObservedTurnId,
          threadId: current.threadId,
          worktree: current.worktree
        })
      )
      harness.setThread({
        id: current.threadId,
        cwd: current.worktree,
        status: "idle",
        turns: [{ id: current.observedTurnId, status: "interrupted", items: [], ownedTurnToken: current.currentToken }]
      })
      harness.setActivityCensus({
        _tag: "ExactLive",
        activities: [{ _tag: "ActiveTurn", turnId: current.observedTurnId }]
      })
      const exact = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
      expect(exact._tag).toBe("Exact")
      if (exact._tag === "Exact") expect(exact.report._tag).toBe("ExecutorWorkExecuting")
      harness.setActivityCensus({ _tag: "Unreadable", detail: "idle activity census unavailable" })
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
      harness.setActivityCensus({ _tag: "Absent" })
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
    }
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("normalizes stored failures, foreign records, and unusable app-server observations", () => {
  const failureHarness = makeHarness()
  const foreignHarness = makeHarness()
  const protocolHarness = makeHarness()
  return Effect.gen(function* () {
    const failureExecutor = yield* PlannedAttemptExecutor
    failureHarness.makeReadFailure()
    expect((yield* failureExecutor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
  }).pipe(
    Effect.provide(layerFor(failureHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        const record = foreignHarness.currentRecord()
        expect(record).toBeDefined()
        if (record?._tag === "Running") {
          foreignHarness.setReadOverride(
            CodexAttemptRecord.cases.Running.make({
              ...record,
              correlationAttemptId: AttemptId.make("foreign-attempt"),
              correlationRunId: RunId.make("foreign-run")
            })
          )
        }
        expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe(
          "CorrelationContradiction"
        )
        const foreign = yield* executor.begin(request)
        expect(foreign._tag).toBe("ExecutorWorkExecuting")
        expect(foreign.correlation).toEqual({ attemptId: "foreign-attempt", runId: "foreign-run" })
        expect(foreignHarness.turnCount()).toBe(1)
      }).pipe(Effect.provide(layerFor(foreignHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request)
        protocolHarness.setResumeFailure(
          new CodexAppServerFailure({ detail: "protocol response", kind: "Protocol", operation: "thread/resume" })
        )
        expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
        protocolHarness.setResumeFailure(
          new CodexAppServerFailure({
            detail: "initialization identity conflict",
            kind: "CorrelationContradiction",
            operation: "initialize"
          })
        )
        expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe(
          "InitializationCorrelationContradiction"
        )
      }).pipe(Effect.provide(layerFor(protocolHarness)))
    )
  )
})

it.effect("reconstructs a persisted failed terminal without sending another task turn", () => {
  const harness = makeHarness({ terminalTurnStatus: "failed" })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const started = yield* executor.begin(request)
    expect(started._tag).toBe("ExecutorWorkExecuting")
    expect(harness.turnCount()).toBe(1)

    const current = harness.currentRecord()
    expect(current?._tag).toBe("Terminal")
    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: { _tag: "Failed" }
        })
      })
    )
    expect(yield* observeExactReport(executor)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    )
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("passively observes executing when a persisted terminal turn is still active", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag !== "Running") return
    harness.setRecord(
      CodexAttemptRecord.cases.Terminal.make({
        ...current,
        _tag: "Terminal",
        evidenceManifest: null,
        terminal: CodexSealedTerminal.cases.Failed.make({})
      })
    )
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect(
  "fails closed when a persisted terminal is presented while its turn is still active during suspension",
  () => {
    const harness = makeHarness()
    return Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request)
      const current = harness.currentRecord()
      expect(current?._tag).toBe("Running")
      if (current?._tag !== "Running") return
      harness.setRecord(
        CodexAttemptRecord.cases.Terminal.make({
          ...current,
          _tag: "Terminal",
          evidenceManifest: null,
          terminal: CodexSealedTerminal.cases.Failed.make({})
        })
      )
      expect(yield* executor.requestSuspension(attempt).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
    }).pipe(Effect.provide(layerFor(harness)))
  }
)

it.effect("fails closed when an associated thread already contains owned activity", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag === "Running") {
      harness.setRecord(
        CodexAttemptRecord.cases.AssociatedPreTurn.make({
          attemptId: current.attemptId,
          correlationAttemptId: current.correlationAttemptId,
          correlationRunId: current.correlationRunId,
          threadId: current.threadId,
          worktree: current.worktree
        })
      )
      harness.setThread({
        id: current.threadId,
        cwd: current.worktree,
        status: "active",
        turns: [{ id: current.observedTurnId, status: "inProgress", items: [], ownedTurnToken: current.currentToken }]
      })
      expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
      expect(yield* executor.begin(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
    }
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("rejects a retained accepted terminal when its reread manifest no longer matches", () => {
  const harness = makeHarness()
  const replacementManifest = AcceptedResultEvidenceManifest.make({
    commit: otherHead,
    correlation,
    formatVersion: 1,
    outcome: "Accepted",
    predecessor: null
  })
  const replacementBytes = new TextEncoder().encode(JSON.stringify(replacementManifest))
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const replacementDigest = yield* crypto.digest("SHA-256", replacementBytes)
    const replacementReference = EvidenceReference.make({
      byteLength: replacementBytes.byteLength,
      digest: EvidenceDigest.make(Array.from(replacementDigest, (byte) => byte.toString(16).padStart(2, "0")).join(""))
    })
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkTerminal")
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Terminal")
    if (current?._tag === "Terminal") {
      harness.setRecord(
        CodexAttemptRecord.cases.Terminal.make({
          ...current,
          evidenceManifest: replacementReference,
          terminal: CodexSealedTerminal.cases.Accepted.make({ commit: head, evidenceManifest: replacementReference })
        })
      )
    }
    expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
  }).pipe(
    Effect.provide(layerFor(harness, defaultGitCommand, manifestDriftEvidenceStoreLayer(replacementBytes))),
    Effect.provide(NodeServices.layer)
  )
})

it.effect("fails closed when a persisted terminal is followed by an interrupted turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    expect((yield* observeExactReport(executor))._tag).toBe("ExecutorWorkTerminal")
    const terminalRecord = harness.currentRecord()
    const terminalTurnId = terminalRecord?._tag === "Terminal" ? terminalRecord.observedTurnId : undefined
    expect(terminalTurnId).toBeDefined()
    if (terminalTurnId === undefined) return
    const thread = harness.currentThread()
    harness.setThread({
      ...thread,
      status: "idle",
      turns: thread.turns.map((turn) => (turn.id === terminalTurnId ? { ...turn, status: "interrupted" } : turn))
    })
    expect((yield* executor.observe(correlation, passiveLifecycleObservationPurpose))._tag).toBe("Unreadable")
  }).pipe(Effect.provide(layerFor(harness)))
})

const replacementClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("issue-111-replacement-authority"),
  owner: ClaimOwner.make("alice"),
  taskId: attempt.taskId,
  token: ClaimToken.make("issue-111-claim-token")
})

const replacementRequestFor = (suffix: string): CodexProviderWorkUnitReplacementRequest =>
  CodexProviderWorkUnitReplacementRequest.make({
    claim: replacementClaim,
    plannedAttempt: attempt,
    requestId: CodexReplacementRequestId.make(`issue-111-replacement-${suffix}`),
    specification
  })

const replacementProof = CodexReplacementAuthorityProof.make({
  baseSha: attempt.baseSha,
  changedPaths: ["src/retained-work.ts"],
  claim: replacementClaim,
  gitStatus: " M src/retained-work.ts",
  headDescendsFromBase: true,
  headSha: head,
  plannedAttempt: attempt,
  taskRevision: attempt.taskRevision,
  worktree: attempt.worktree
})

const seedReplacementHarness = (options: Parameters<typeof makeHarness>[0] = {}): Harness => {
  const harness = makeHarness(options)
  const threadId = CodexThreadId.make("codex-thread-issue-58")
  const predecessorToken = CodexOwnedTurnToken.make("issue-111-u1-token")
  const predecessorTurnId = CodexTurnId.make("issue-111-u1-turn")
  harness.setThread({ id: threadId, cwd: worktree, status: "idle", turns: [] })
  harness.setRecord(
    CodexAttemptRecord.cases.Running.make({
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      currentToken: predecessorToken,
      observedTurnId: predecessorTurnId,
      priorObservedTurnId: null,
      threadId,
      worktree
    })
  )
  return harness
}

const replacementAuthorityLayer = (
  failures: ReadonlySet<number> = new Set()
): Layer.Layer<CodexReplacementAuthority> => {
  let calls = 0
  return controlledCodexReplacementAuthorityLayer({
    observe: () => {
      const call = calls
      calls += 1
      return failures.has(call)
        ? Effect.fail(
            new CodexReplacementAuthorityFailure({
              detail: `controlled authority failure at observation ${call}`,
              kind: "ExclusiveRetainedOwnershipUnproved"
            })
          )
        : Effect.succeed(replacementProof)
    }
  })
}

const runReplacement = (
  harness: Harness,
  request: CodexProviderWorkUnitReplacementRequest,
  authority: Layer.Layer<CodexReplacementAuthority>,
  store: CodexAttemptStoreService = harness.store
) =>
  Effect.gen(function* () {
    const replacement = yield* CodexProviderWorkUnitReplacement
    return yield* replacement.replacePurgedProviderWorkUnit(request)
  }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, null, authority, store)))

it("rejects malformed replacement requests and authority proofs at their typed boundaries", () => {
  const foreignTaskId = TaskId.make("issue-111-foreign-task")
  const foreignSpecification = makeTaskWorkSpecification({
    body: "Foreign replacement work",
    taskId: foreignTaskId,
    title: "Foreign replacement"
  })
  const foreignClaim = ActiveTaskClaim.make({ ...replacementClaim, taskId: foreignTaskId })
  const decodeRequest = (value: unknown) => Schema.decodeUnknownSync(CodexProviderWorkUnitReplacementRequest)(value)
  expect(() => decodeRequest({ ...replacementRequestFor("foreign-claim"), claim: foreignClaim })).toThrow()
  expect(() =>
    decodeRequest({ ...replacementRequestFor("foreign-specification"), specification: foreignSpecification })
  ).toThrow()
  expect(() =>
    decodeRequest({
      ...replacementRequestFor("foreign-fingerprint"),
      specification: { ...specification, fingerprint: foreignSpecification.fingerprint }
    })
  ).toThrow()

  const decodeProof = (value: unknown) => Schema.decodeUnknownSync(CodexReplacementAuthorityProof)(value)
  expect(() => decodeProof({ ...replacementProof, gitStatus: "" })).toThrow()
  expect(() => decodeProof({ ...replacementProof, changedPaths: [] })).toThrow()
  expect(() => decodeProof({ ...replacementProof, claim: foreignClaim })).toThrow()
  expect(() => decodeProof({ ...replacementProof, plannedAttempt: { ...attempt, taskId: foreignTaskId } })).toThrow()
  expect(() => decodeProof({ ...replacementProof, taskRevision: foreignSpecification.fingerprint })).toThrow()
  expect(() => decodeProof({ ...replacementProof, baseSha: otherHead })).toThrow()
  expect(() => decodeProof({ ...replacementProof, worktree: WorktreeLocator.make("/tmp/foreign-worktree") })).toThrow()
})

it.effect("maps every fresh authority and retained-session failure before starting replacement work", () =>
  Effect.gen(function* () {
    const authorityKinds = [
      "ProviderTemporarilyUnreadable",
      "TaskWorkSessionAbsent",
      "CorrelationConflict",
      "ExclusiveRetainedOwnershipUnproved"
    ] as const
    for (const kind of authorityKinds) {
      const harness = seedReplacementHarness()
      const authority = controlledCodexReplacementAuthorityLayer({
        observe: () => Effect.fail(new CodexReplacementAuthorityFailure({ detail: `controlled ${kind}`, kind }))
      })
      expect((yield* runReplacement(harness, replacementRequestFor(`authority-${kind}`), authority))._tag).toBe(kind)
      expect(harness.turnCount()).toBe(0)
    }

    const appFailures = [
      ["NotFound", "TaskWorkSessionAbsent"],
      ["CorrelationContradiction", "CorrelationConflict"],
      ["Unavailable", "ProviderTemporarilyUnreadable"]
    ] as const
    for (const [kind, expected] of appFailures) {
      const harness = seedReplacementHarness()
      harness.setResumeFailure(
        new CodexAppServerFailure({ detail: `controlled ${kind}`, kind, operation: "thread/resume" })
      )
      expect(
        (yield* runReplacement(harness, replacementRequestFor(`resume-${kind}`), replacementAuthorityLayer()))._tag
      ).toBe(expected)
      expect(harness.turnCount()).toBe(0)
    }

    const absentHarness = seedReplacementHarness()
    const absentStore: CodexAttemptStoreService = {
      ...absentHarness.store,
      readAttempt: () => Effect.succeed(Option.none())
    }
    expect(
      (yield* runReplacement(
        absentHarness,
        replacementRequestFor("absent-private-session"),
        replacementAuthorityLayer(),
        absentStore
      ))._tag
    ).toBe("TaskWorkSessionAbsent")

    const unconfiguredHarness = seedReplacementHarness()
    const replacement = yield* Effect.gen(function* () {
      return yield* CodexProviderWorkUnitReplacement
    }).pipe(Effect.provide(layerFor(unconfiguredHarness, defaultGitCommand, null)))
    expect((yield* replacement.replacePurgedProviderWorkUnit(replacementRequestFor("no-authority")))._tag).toBe(
      "ExclusiveRetainedOwnershipUnproved"
    )
  })
)

it.effect("fails before private reads or provider work when request hashing is unavailable", () => {
  const harness = seedReplacementHarness()
  const digestFailure = PlatformError.systemError({ _tag: "Unknown", method: "digest", module: "CodexReplacementTest" })
  const crypto = Crypto.make({ digest: () => Effect.fail(digestFailure), randomBytes: (size) => new Uint8Array(size) })
  return Effect.gen(function* () {
    const replacement = yield* CodexProviderWorkUnitReplacement
    const failure = yield* replacement
      .replacePurgedProviderWorkUnit(replacementRequestFor("digest-unavailable"))
      .pipe(Effect.flip)
    expect(failure._tag).toBe("CodexReplacementLedgerFailure")
    expect(harness.turnCount()).toBe(0)
    expect(harness.resumeCwds).toHaveLength(0)
  }).pipe(
    Effect.provide(layerFor(harness, defaultGitCommand, null, replacementAuthorityLayer(), harness.store, crypto))
  )
})

it.effect("fails closed for changed retained-thread, activity, and second authority observations", () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<{
      readonly expected: CodexProviderWorkUnitReplacementResult["_tag"]
      readonly mutate: (harness: Harness) => void
      readonly name: string
    }> = [
      {
        expected: "CorrelationConflict",
        mutate: (harness) => {
          harness.preserveResumeCwd()
          harness.setThread({ ...harness.currentThread(), cwd: WorktreeLocator.make("/tmp/foreign-worktree") })
        },
        name: "changed-worktree"
      },
      {
        expected: "CorrelationConflict",
        mutate: (harness) => harness.makeForeignResume(),
        name: "foreign-correlation"
      },
      {
        expected: "ProviderTemporarilyUnreadable",
        mutate: (harness) => harness.setThread({ ...harness.currentThread(), status: "systemError" }),
        name: "unreadable-thread"
      },
      {
        expected: "PurgeUnconfirmed",
        mutate: (harness) => {
          const record = harness.currentRecord()
          if (record?._tag === "Running") {
            harness.setThread({
              ...harness.currentThread(),
              turns: [
                { id: record.observedTurnId, items: [], ownedTurnToken: record.currentToken, status: "completed" }
              ]
            })
          }
        },
        name: "visible-predecessor"
      },
      {
        expected: "ExclusiveRetainedOwnershipUnproved",
        mutate: (harness) =>
          harness.setActivityCensus({
            _tag: "ExactLive",
            activities: [
              {
                _tag: "BackgroundTerminal",
                terminal: { command: "writer", cwd: worktree, itemId: "writer", osPid: null, processId: "writer" }
              }
            ]
          }),
        name: "live-writer"
      },
      {
        expected: "ExclusiveRetainedOwnershipUnproved",
        mutate: (harness) =>
          harness.setActivityCensus({ _tag: "Unreadable", detail: "controlled unreadable activity" }),
        name: "unreadable-activity"
      }
    ]
    for (const scenario of cases) {
      const harness = seedReplacementHarness()
      scenario.mutate(harness)
      expect(
        (yield* runReplacement(harness, replacementRequestFor(scenario.name), replacementAuthorityLayer()))._tag
      ).toBe(scenario.expected)
      expect(harness.turnCount()).toBe(0)
    }

    const changedAuthorityHarness = seedReplacementHarness()
    let changedAuthorityCalls = 0
    const changedAuthority = controlledCodexReplacementAuthorityLayer({
      observe: () => {
        changedAuthorityCalls += 1
        return Effect.succeed(
          changedAuthorityCalls === 1 ? replacementProof : { ...replacementProof, headSha: otherHead }
        )
      }
    })
    expect(
      (yield* runReplacement(changedAuthorityHarness, replacementRequestFor("changed-authority"), changedAuthority))
        ._tag
    ).toBe("ExclusiveRetainedOwnershipUnproved")
    expect(changedAuthorityHarness.turnCount()).toBe(0)

    const failedRereadHarness = seedReplacementHarness()
    expect(
      (yield* runReplacement(
        failedRereadHarness,
        replacementRequestFor("failed-authority-reread"),
        replacementAuthorityLayer(new Set([1]))
      ))._tag
    ).toBe("ExclusiveRetainedOwnershipUnproved")
    expect(failedRereadHarness.turnCount()).toBe(0)
  })
)

it.effect("rejects replacement U2 token and predecessor-identity reuse", () =>
  Effect.gen(function* () {
    const omittedTokenHarness = seedReplacementHarness({ omitOwnedTurnToken: true })
    expect(
      (yield* runReplacement(
        omittedTokenHarness,
        replacementRequestFor("omitted-u2-token"),
        replacementAuthorityLayer()
      ))._tag
    ).toBe("Replaced")

    const wrongTokenHarness = seedReplacementHarness({ wrongOwnedTurnToken: true })
    expect(
      (yield* runReplacement(wrongTokenHarness, replacementRequestFor("wrong-u2-token"), replacementAuthorityLayer()))
        ._tag
    ).toBe("CorrelationConflict")

    const reusedIdentityHarness = seedReplacementHarness()
    const originalStartTurn = reusedIdentityHarness.app.startTurn
    const reusedIdentityApp: CodexAppServerService = {
      ...reusedIdentityHarness.app,
      startTurn: (...args) =>
        originalStartTurn(...args).pipe(Effect.map((turn) => ({ ...turn, id: CodexTurnId.make("issue-111-u1-turn") })))
    }
    const replacement = yield* Effect.gen(function* () {
      return yield* CodexProviderWorkUnitReplacement
    }).pipe(
      Effect.provide(
        codexPlannedAttemptExecutorLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              controlledCodexAppServerLayer(reusedIdentityApp),
              controlledCodexOwnedActivityCensusLayer({
                observe: (thread, terminals) =>
                  Effect.succeed(reusedIdentityHarness.observeActivityCensus(thread, terminals)),
                terminateDescendants: () => Effect.void
              }),
              Layer.succeed(CodexAttemptStore, reusedIdentityHarness.store),
              Layer.succeed(GitCommand, defaultGitCommand)
            )
          ),
          Layer.provide(replacementAuthorityLayer()),
          Layer.provide(NodeServices.layer)
        )
      )
    )
    expect((yield* replacement.replacePurgedProviderWorkUnit(replacementRequestFor("reused-u1-id")))._tag).toBe(
      "CorrelationConflict"
    )
  })
)

it.effect("fails each runtime authority-proof invariant before the U2 provider boundary", () =>
  Effect.gen(function* () {
    const proofMutations: ReadonlyArray<readonly [string, CodexReplacementAuthorityProof]> = [
      [
        "claim",
        {
          ...replacementProof,
          claim: { ...replacementProof.claim, token: ClaimToken.make("foreign-claim-token") }
        } as CodexReplacementAuthorityProof
      ],
      [
        "plan",
        {
          ...replacementProof,
          plannedAttempt: { ...replacementProof.plannedAttempt, runId: RunId.make("foreign-run") }
        } as CodexReplacementAuthorityProof
      ],
      [
        "facts",
        {
          ...replacementProof,
          worktree: WorktreeLocator.make("/tmp/foreign-worktree")
        } as CodexReplacementAuthorityProof
      ],
      ["ancestry", { ...replacementProof, headDescendsFromBase: false }]
    ]
    for (const [name, proof] of proofMutations) {
      const harness = seedReplacementHarness()
      const authority = controlledCodexReplacementAuthorityLayer({ observe: () => Effect.succeed(proof) })
      expect((yield* runReplacement(harness, replacementRequestFor(`proof-${name}`), authority))._tag).toBe(
        "ExclusiveRetainedOwnershipUnproved"
      )
      expect(harness.turnCount()).toBe(0)
    }
  })
)

it.effect("rejects changed D1 content and an unreadable previously observed U2", () =>
  Effect.gen(function* () {
    const changedRequestHarness = seedReplacementHarness({ failAfterReplacementIntentOnce: true })
    const original = replacementRequestFor("changed-content")
    expect(
      (yield* runReplacement(changedRequestHarness, original, replacementAuthorityLayer()).pipe(Effect.exit))._tag
    ).toBe("Failure")
    const changed = CodexProviderWorkUnitReplacementRequest.make({
      ...original,
      claim: { ...original.claim, token: ClaimToken.make("changed-content-token") }
    })
    expect((yield* runReplacement(changedRequestHarness, changed, replacementAuthorityLayer()))._tag).toBe(
      "RequestIdentityReuseContradiction"
    )
    expect(changedRequestHarness.turnCount()).toBe(0)

    const observedHarness = seedReplacementHarness({ failAfterReplacementSealOnce: true })
    const observedRequest = replacementRequestFor("missing-observed-u2")
    expect(
      (yield* runReplacement(observedHarness, observedRequest, replacementAuthorityLayer()).pipe(Effect.exit))._tag
    ).toBe("Failure")
    observedHarness.setThread({ ...observedHarness.currentThread(), status: "idle", turns: [] })
    expect((yield* runReplacement(observedHarness, observedRequest, replacementAuthorityLayer()))._tag).toBe(
      "ProviderTemporarilyUnreadable"
    )
    expect(observedHarness.turnCount()).toBe(1)
  })
)

it.effect("rejects a changed private record, durable subject reuse, and an unreadable census", () =>
  Effect.gen(function* () {
    const changedRecordHarness = seedReplacementHarness()
    const current = changedRecordHarness.currentRecord()
    if (current?._tag === "Running") {
      const changedRecord = CodexAttemptRecord.cases.Running.make({
        ...current,
        worktree: WorktreeLocator.make("/tmp/changed-private-worktree")
      })
      const changedRecordStore: CodexAttemptStoreService = {
        ...changedRecordHarness.store,
        readAttempt: () => Effect.succeed(Option.some(changedRecord))
      }
      expect(
        (yield* runReplacement(
          changedRecordHarness,
          replacementRequestFor("changed-private-record"),
          replacementAuthorityLayer(),
          changedRecordStore
        ))._tag
      ).toBe("CorrelationConflict")
    }

    const reusedSubjectHarness = seedReplacementHarness({ failAfterReplacementIntentOnce: true })
    const reusedSubjectRequest = replacementRequestFor("reused-ledger-subject")
    expect(
      (yield* runReplacement(reusedSubjectHarness, reusedSubjectRequest, replacementAuthorityLayer()).pipe(Effect.exit))
        ._tag
    ).toBe("Failure")
    const existing = reusedSubjectHarness.replacementLedger()
    if (existing !== undefined) {
      const foreignLedger = CodexPurgedWorkUnitReplacementLedger.make({
        ...existing,
        plannedAttempt: { ...existing.plannedAttempt, runId: RunId.make("foreign-ledger-run") }
      })
      const foreignLedgerStore: CodexAttemptStoreService = {
        ...reusedSubjectHarness.store,
        readReplacementLedger: () => Effect.succeed(Option.some(foreignLedger))
      }
      expect(
        (yield* runReplacement(
          reusedSubjectHarness,
          reusedSubjectRequest,
          replacementAuthorityLayer(),
          foreignLedgerStore
        ))._tag
      ).toBe("RequestIdentityReuseContradiction")
    }

    const censusHarness = seedReplacementHarness()
    const replacement = yield* Effect.gen(function* () {
      return yield* CodexProviderWorkUnitReplacement
    }).pipe(
      Effect.provide(
        codexPlannedAttemptExecutorLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              controlledCodexAppServerLayer(censusHarness.app),
              controlledCodexOwnedActivityCensusLayer({
                observe: () =>
                  Effect.fail(
                    new CodexAppServerFailure({
                      detail: "controlled census failure",
                      kind: "Unavailable",
                      operation: "thread/ownedActivity/census"
                    })
                  ),
                terminateDescendants: () => Effect.void
              }),
              Layer.succeed(CodexAttemptStore, censusHarness.store),
              Layer.succeed(GitCommand, defaultGitCommand)
            )
          ),
          Layer.provide(replacementAuthorityLayer()),
          Layer.provide(NodeServices.layer)
        )
      )
    )
    expect((yield* replacement.replacePurgedProviderWorkUnit(replacementRequestFor("census-failure")))._tag).toBe(
      "ExclusiveRetainedOwnershipUnproved"
    )
    expect(censusHarness.turnCount()).toBe(0)
  })
)

it.effect("replaces from every observed private record and fails closed after an unobserved turn/start loss", () =>
  Effect.gen(function* () {
    for (const tag of ["TurnObserved", "SafelySuspended"] as const) {
      const harness = seedReplacementHarness()
      const current = harness.currentRecord()
      if (current?._tag === "Running") {
        const { _tag: _currentTag, ...recordFields } = current
        harness.setRecord(
          tag === "TurnObserved"
            ? CodexAttemptRecord.cases.TurnObserved.make(recordFields)
            : CodexAttemptRecord.cases.SafelySuspended.make(recordFields)
        )
      }
      expect(
        (yield* runReplacement(harness, replacementRequestFor(`record-${tag}`), replacementAuthorityLayer()))._tag
      ).toBe("Replaced")
    }

    const runLostStart = Effect.fn("CodexReplacementTest.runLostStart")(function* (resumeAlsoFails: boolean) {
      const harness = seedReplacementHarness()
      const lostStart = new CodexAppServerFailure({
        detail: "controlled replacement turn/start loss",
        kind: "Unavailable",
        operation: "turn/start"
      })
      const app: CodexAppServerService = {
        ...harness.app,
        startTurn: () => {
          if (resumeAlsoFails) {
            harness.setResumeFailure(
              new CodexAppServerFailure({
                detail: "controlled post-start resume loss",
                kind: "Unavailable",
                operation: "thread/resume"
              })
            )
          }
          return Effect.fail(lostStart)
        }
      }
      const replacement = yield* Effect.gen(function* () {
        return yield* CodexProviderWorkUnitReplacement
      }).pipe(
        Effect.provide(
          codexPlannedAttemptExecutorLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                controlledCodexAppServerLayer(app),
                controlledCodexOwnedActivityCensusLayer({
                  observe: (thread, terminals) => Effect.succeed(harness.observeActivityCensus(thread, terminals)),
                  terminateDescendants: () => Effect.void
                }),
                Layer.succeed(CodexAttemptStore, harness.store),
                Layer.succeed(GitCommand, defaultGitCommand)
              )
            ),
            Layer.provide(replacementAuthorityLayer()),
            Layer.provide(NodeServices.layer)
          )
        )
      )
      return yield* replacement.replacePurgedProviderWorkUnit(
        replacementRequestFor(resumeAlsoFails ? "lost-start-and-resume" : "lost-start")
      )
    })

    expect((yield* runLostStart(false))._tag).toBe("ProviderTemporarilyUnreadable")
    expect((yield* runLostStart(true))._tag).toBe("ProviderTemporarilyUnreadable")
  })
)

type ReplacementCrashWrite = {
  readonly phase: "IntentRecorded" | "TurnIntentRecorded" | "TurnBoundaryCrossingBegan" | "TurnObserved" | "Sealed"
  readonly persist: "BeforeCrash" | "AfterCrash"
}

const crashAtReplacementWrite = (
  store: CodexAttemptStoreService,
  cut: ReplacementCrashWrite
): CodexAttemptStoreService => {
  let crossed = false
  return {
    ...store,
    appendReplacementLedger: (ledger) => {
      const phase = ledger.history.at(-1)?._tag
      if (crossed || phase !== cut.phase) return store.appendReplacementLedger(ledger)
      crossed = true
      const failure = new CodexAttemptStoreFailure({
        detail: `controlled process loss ${cut.persist.toLowerCase()} ${cut.phase}`,
        operation: "appendReplacementLedger"
      })
      return cut.persist === "BeforeCrash"
        ? store.appendReplacementLedger(ledger).pipe(Effect.andThen(Effect.fail(failure)))
        : Effect.fail(failure)
    }
  }
}

const withReopenedReplacementStore = <A, E, R>(
  stateDirectory: string,
  use: (store: CodexAttemptStoreService) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* CodexAttemptStore
      return yield* use(store)
    }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory })))
  )

it.effect("covers the replacement cut before durable intent", () => {
  const harness = seedReplacementHarness()
  const request = replacementRequestFor("before-intent")
  return Effect.gen(function* () {
    const result = yield* runReplacement(harness, request, replacementAuthorityLayer(new Set([0])))
    expect(result._tag).toBe("ExclusiveRetainedOwnershipUnproved")
    expect(harness.replacementLedger()).toBeUndefined()
    expect(harness.turnCount()).toBe(0)
  })
})

it.effect("recovers after intent is durable but before the fresh authority reread", () => {
  const harness = seedReplacementHarness({ failAfterReplacementIntentOnce: true })
  const request = replacementRequestFor("after-intent")
  return Effect.gen(function* () {
    const crashed = yield* runReplacement(harness, request, replacementAuthorityLayer()).pipe(Effect.exit)
    expect(crashed._tag).toBe("Failure")
    expect(harness.replacementLedger()?.history.map(({ _tag }) => _tag)).toEqual(["Purged", "IntentRecorded"])
    const recovered = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(recovered._tag).toBe("Replaced")
    expect(harness.turnCount()).toBe(1)
  })
})

it.effect("rejects durable purge evidence for another private thread before resuming it", () => {
  const harness = seedReplacementHarness({ failAfterReplacementIntentOnce: true })
  const request = replacementRequestFor("foreign-durable-purge")
  return Effect.gen(function* () {
    const firstExit = yield* runReplacement(harness, request, replacementAuthorityLayer()).pipe(Effect.exit)
    expect(firstExit._tag).toBe("Failure")
    const ledger = harness.replacementLedger()
    if (ledger === undefined) return yield* Effect.die("missing controlled durable replacement intent")
    const purge = ledger.history[0]
    if (purge._tag !== "Purged") return yield* Effect.die("missing controlled purge evidence")
    const foreignLedger = CodexPurgedWorkUnitReplacementLedger.make({
      ...ledger,
      history: [
        CodexReplacementHistoryEntry.cases.Purged.make({
          evidence: CodexPurgedWorkUnitEvidence.make({
            ...purge.evidence,
            threadId: CodexThreadId.make("issue-111-foreign-thread")
          })
        }),
        ...ledger.history.slice(1)
      ]
    })
    const foreignStore: CodexAttemptStoreService = {
      ...harness.store,
      readReplacementLedger: () => Effect.succeed(Option.some(foreignLedger))
    }
    const resumeCountBeforeForeignLedger = harness.resumeCwds.length

    const result = yield* runReplacement(harness, request, replacementAuthorityLayer(), foreignStore)
    expect(result._tag).toBe("CorrelationConflict")
    expect(harness.resumeCwds).toHaveLength(resumeCountBeforeForeignLedger)
    expect(harness.turnCount()).toBe(0)
  })
})

it.effect("recovers after the replacement turn intent is durable", () => {
  const harness = seedReplacementHarness({ failAfterReplacementTurnIntentOnce: true })
  const request = replacementRequestFor("after-turn-intent")
  return Effect.gen(function* () {
    const crashed = yield* runReplacement(harness, request, replacementAuthorityLayer()).pipe(Effect.exit)
    expect(crashed._tag).toBe("Failure")
    expect(harness.replacementLedger()?.history.map(({ _tag }) => _tag)).toEqual([
      "Purged",
      "IntentRecorded",
      "TurnIntentRecorded"
    ])
    const recovered = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(recovered._tag).toBe("Replaced")
    expect(harness.turnCount()).toBe(1)
  })
})

it.effect("reconciles a crossing marker without blindly retrying turn/start", () => {
  const harness = seedReplacementHarness({ failAfterReplacementCalledOnce: true })
  const request = replacementRequestFor("after-crossing-marker")
  return Effect.gen(function* () {
    const crashed = yield* runReplacement(harness, request, replacementAuthorityLayer()).pipe(Effect.exit)
    expect(crashed._tag).toBe("Failure")
    expect(harness.replacementLedger()?.history.map(({ _tag }) => _tag)).toEqual([
      "Purged",
      "IntentRecorded",
      "TurnIntentRecorded",
      "TurnBoundaryCrossingBegan"
    ])
    const noBlindRetry = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(noBlindRetry._tag).toBe("ProviderTemporarilyUnreadable")
    expect(harness.turnCount()).toBe(0)
  })
})

it.effect("reconciles a lost turn/start response and seals one U2", () => {
  const harness = seedReplacementHarness({ loseFirstTurnResponse: true })
  const request = replacementRequestFor("lost-response")
  return Effect.gen(function* () {
    const result = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(result._tag).toBe("Replaced")
    expect(harness.turnCount()).toBe(1)
    expect(harness.replacementLedger()?.history.map(({ _tag }) => _tag)).toEqual([
      "Purged",
      "IntentRecorded",
      "TurnIntentRecorded",
      "TurnBoundaryCrossingBegan",
      "TurnObserved",
      "Sealed"
    ])
    expect(harness.turnTexts).toHaveLength(1)
    expect(harness.turnTexts[0]).toContain("The preceding provider work unit was confirmed purged")
    expect(harness.turnTexts[0]).toContain("do not describe this turn as a resumption of the purged unit")
    expect(harness.turnTexts[0]).toContain(`retained_worktree: ${attempt.worktree}`)
    expect(harness.turnTexts[0]).toContain("purged_predecessor_turn_id: issue-111-u1-turn")
  })
})

it.effect("rejects a foreign U2 correlation without making it current", () => {
  const harness = seedReplacementHarness({ foreignTurnCorrelation: true })
  const request = replacementRequestFor("foreign-u2")
  return Effect.gen(function* () {
    const result = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(result._tag).toBe("CorrelationConflict")
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Running")
    expect(harness.replacementLedger()?.history.at(-1)?._tag).toBe("TurnBoundaryCrossingBegan")
  })
})

it.effect("recovers after U2 history is durable but before the current private record", () => {
  const harness = seedReplacementHarness({ failAfterReplacementObservedOnce: true })
  const request = replacementRequestFor("after-observed-before-record")
  return Effect.gen(function* () {
    const crashed = yield* runReplacement(harness, request, replacementAuthorityLayer()).pipe(Effect.exit)
    expect(crashed._tag).toBe("Failure")
    expect(harness.replacementLedger()?.history.map(({ _tag }) => _tag)).toEqual([
      "Purged",
      "IntentRecorded",
      "TurnIntentRecorded",
      "TurnBoundaryCrossingBegan",
      "TurnObserved"
    ])
    const beforeRecovery = harness.currentRecord()
    expect(beforeRecovery?._tag).toBe("Running")
    expect(beforeRecovery?._tag === "Running" ? beforeRecovery.priorObservedTurnId : undefined).toBe(null)
    const recovered = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(recovered._tag).toBe("Replaced")
    const afterRecovery = harness.currentRecord()
    expect(afterRecovery?._tag).toBe("TurnObserved")
    expect(afterRecovery?._tag === "TurnObserved" ? afterRecovery.priorObservedTurnId : undefined).toBe(null)
  })
})

it.effect("recovers after U2 observation before the private history seal", () => {
  const harness = seedReplacementHarness({ failAfterReplacementSealOnce: true })
  const request = replacementRequestFor("after-observed")
  return Effect.gen(function* () {
    const crashed = yield* runReplacement(harness, request, replacementAuthorityLayer()).pipe(Effect.exit)
    expect(crashed._tag).toBe("Failure")
    expect(harness.replacementLedger()?.history.map(({ _tag }) => _tag)).toEqual([
      "Purged",
      "IntentRecorded",
      "TurnIntentRecorded",
      "TurnBoundaryCrossingBegan",
      "TurnObserved"
    ])
    const recovered = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(recovered._tag).toBe("Replaced")
    expect(harness.replacementLedger()?.history.at(-1)?._tag).toBe("Sealed")
    expect(JSON.stringify(recovered)).not.toContain("issue-111-u1-turn")
    expect(JSON.stringify(recovered)).not.toContain("codex-thread-issue-58")
  })
})

it.effect("returns the same sealed D1 result on exact redelivery without starting U3", () => {
  const harness = seedReplacementHarness()
  const request = replacementRequestFor("sealed-redelivery")
  return Effect.gen(function* () {
    const first = yield* runReplacement(harness, request, replacementAuthorityLayer())
    const sealed = harness.replacementLedger()
    const redelivered = yield* runReplacement(harness, request, replacementAuthorityLayer())

    expect(first._tag).toBe("Replaced")
    expect(redelivered).toEqual(first)
    expect(harness.turnCount()).toBe(1)
    expect(harness.replacementLedger()).toEqual(sealed)
    expect(sealed?.history.at(-1)?._tag).toBe("Sealed")
  })
})

const reopenedReplacementCuts: ReadonlyArray<{
  readonly name: string
  readonly write: ReplacementCrashWrite
  readonly durableHistory: ReadonlyArray<string> | undefined
  readonly recoveredResult: "ProviderTemporarilyUnreadable" | "Replaced"
  readonly turnCount: number
}> = [
  {
    name: "fresh proof before intent",
    write: { phase: "IntentRecorded", persist: "AfterCrash" },
    durableHistory: undefined,
    recoveredResult: "Replaced",
    turnCount: 1
  },
  {
    name: "intent before the fresh reread",
    write: { phase: "IntentRecorded", persist: "BeforeCrash" },
    durableHistory: ["Purged", "IntentRecorded"],
    recoveredResult: "Replaced",
    turnCount: 1
  },
  {
    name: "owned-turn intent before the provider boundary",
    write: { phase: "TurnIntentRecorded", persist: "BeforeCrash" },
    durableHistory: ["Purged", "IntentRecorded", "TurnIntentRecorded"],
    recoveredResult: "Replaced",
    turnCount: 1
  },
  {
    name: "provider boundary may have crossed without an observed U2",
    write: { phase: "TurnBoundaryCrossingBegan", persist: "BeforeCrash" },
    durableHistory: ["Purged", "IntentRecorded", "TurnIntentRecorded", "TurnBoundaryCrossingBegan"],
    recoveredResult: "ProviderTemporarilyUnreadable",
    turnCount: 0
  },
  {
    name: "U2 is durable before the current attempt record",
    write: { phase: "TurnObserved", persist: "BeforeCrash" },
    durableHistory: ["Purged", "IntentRecorded", "TurnIntentRecorded", "TurnBoundaryCrossingBegan", "TurnObserved"],
    recoveredResult: "Replaced",
    turnCount: 1
  },
  {
    name: "U2 is current before U1 history is sealed",
    write: { phase: "Sealed", persist: "AfterCrash" },
    durableHistory: ["Purged", "IntentRecorded", "TurnIntentRecorded", "TurnBoundaryCrossingBegan", "TurnObserved"],
    recoveredResult: "Replaced",
    turnCount: 1
  }
]

it.effect("reopens the node private store at every replacement crash cut without starting U3", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      for (const [cutIndex, cut] of reopenedReplacementCuts.entries()) {
        const temporaryStateDirectory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: `dalph-issue-111-cut-${cutIndex}-`
        })
        const stateDirectory = yield* fileSystem.realPath(temporaryStateDirectory)
        const harness = seedReplacementHarness()
        const request = replacementRequestFor(`reopened-cut-${cutIndex}`)
        const predecessor = harness.currentRecord()
        if (predecessor === undefined) return yield* Effect.die("missing controlled predecessor record")

        const firstExit = yield* withReopenedReplacementStore(stateDirectory, (store) =>
          store
            .writeAttempt(predecessor)
            .pipe(
              Effect.andThen(
                runReplacement(harness, request, replacementAuthorityLayer(), crashAtReplacementWrite(store, cut.write))
              ),
              Effect.exit
            )
        )
        expect(firstExit._tag, cut.name).toBe("Failure")

        const afterCrash = yield* withReopenedReplacementStore(stateDirectory, (store) =>
          store.readReplacementLedger(request.requestId)
        )
        expect(
          Option.isSome(afterCrash) ? afterCrash.value.history.map(({ _tag }) => _tag) : undefined,
          cut.name
        ).toEqual(cut.durableHistory)

        const recovered = yield* withReopenedReplacementStore(stateDirectory, (store) =>
          runReplacement(harness, request, replacementAuthorityLayer(), store)
        )
        expect(recovered._tag, cut.name).toBe(cut.recoveredResult)
        expect(harness.turnCount(), cut.name).toBe(cut.turnCount)

        const finalLedger = yield* withReopenedReplacementStore(stateDirectory, (store) =>
          store.readReplacementLedger(request.requestId)
        )
        if (cut.recoveredResult === "Replaced") {
          expect(Option.isSome(finalLedger) && finalLedger.value.history.at(-1)?._tag, cut.name).toBe("Sealed")
        } else {
          expect(Option.isSome(finalLedger) && finalLedger.value.history.map(({ _tag }) => _tag), cut.name).toEqual(
            cut.durableHistory
          )
        }
      }
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("reopens after U2 crossed turn/start and reconciles it without starting U3", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const temporaryStateDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "dalph-issue-111-crossed-u2-"
      })
      const stateDirectory = yield* fileSystem.realPath(temporaryStateDirectory)
      const harness = seedReplacementHarness({ dieAfterReplacementTurnStartOnce: true })
      const request = replacementRequestFor("reopened-after-u2-crossed")
      const predecessor = harness.currentRecord()
      if (predecessor === undefined) return yield* Effect.die("missing controlled predecessor record")

      const firstExit = yield* withReopenedReplacementStore(stateDirectory, (store) =>
        store
          .writeAttempt(predecessor)
          .pipe(Effect.andThen(runReplacement(harness, request, replacementAuthorityLayer(), store)), Effect.exit)
      )
      expect(firstExit._tag).toBe("Failure")
      expect(harness.turnCount()).toBe(1)
      expect(harness.currentThread().turns).toHaveLength(1)

      const afterCrash = yield* withReopenedReplacementStore(stateDirectory, (store) =>
        store.readReplacementLedger(request.requestId)
      )
      expect(Option.isSome(afterCrash) && afterCrash.value.history.map(({ _tag }) => _tag)).toEqual([
        "Purged",
        "IntentRecorded",
        "TurnIntentRecorded",
        "TurnBoundaryCrossingBegan"
      ])

      const recovered = yield* withReopenedReplacementStore(stateDirectory, (store) =>
        runReplacement(harness, request, replacementAuthorityLayer(), store)
      )
      expect(recovered._tag).toBe("Replaced")
      expect(harness.turnCount()).toBe(1)
      const sealed = yield* withReopenedReplacementStore(stateDirectory, (store) =>
        store.readReplacementLedger(request.requestId)
      )
      expect(Option.isSome(sealed) && sealed.value.history.at(-1)?._tag).toBe("Sealed")
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("allocates a replacement thread for an unfinished EmptyPreTurn before Begin contacts Codex", () => {
  const harness = makeHarness()
  harness.setRecord(
    CodexAttemptRecord.cases.EmptyPreTurn.make({
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      worktree
    })
  )
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const began = yield* executor.begin(request)
    expect(began).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    expect(harness.threadStarts()).toBe(1)
    expect(harness.turnCount()).toBe(1)
    expect(harness.associationAtTurn()?._tag).toBe("AssociatedPreTurn")
    expect(harness.currentRecord()?._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles an admitted Resume whose private Safe record meets an already-running turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag !== "Running") return

    // The process may have persisted Safe before the provider's Resume response
    // was observed. Re-reading the exact provider turn must settle as Running,
    // without issuing a second turn.
    const { _tag: _currentTag, ...safeFields } = current
    harness.setRecord(CodexAttemptRecord.cases.SafelySuspended.make(safeFields))
    const resumed = yield* executor.resume(request)
    expect(resumed).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    expect(harness.turnCount()).toBe(1)
    expect(harness.resumeCwds).toEqual([worktree])
    expect(harness.currentRecord()?._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("returns an already-terminal result when Resume reconciles a Safe private record", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    harness.complete(finalResponse(head))
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag !== "Running") return

    const { _tag: _currentTag, ...safeFields } = current
    harness.setRecord(CodexAttemptRecord.cases.SafelySuspended.make(safeFields))
    const resumed = yield* executor.resume(request)
    expect(resumed._tag).toBe("ExecutorWorkTerminal")
    if (resumed._tag === "ExecutorWorkTerminal") {
      expect(resumed.correlation).toEqual(correlation)
      expect(resumed.result._tag).toBe("Accepted")
      if (resumed.result._tag === "Accepted") expect(resumed.result.acceptedResult.commit).toBe(head)
    }
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Terminal")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("keeps a Safe Resume ambiguous when the exact provider turn is missing", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag !== "Running") return

    const { _tag: _currentTag, ...safeFields } = current
    harness.setRecord(CodexAttemptRecord.cases.SafelySuspended.make(safeFields))
    harness.setThread({ id: current.threadId, cwd: current.worktree, status: "idle", turns: [] })
    const failure = yield* executor.resume(request).pipe(Effect.flip)
    expect(failure.command).toBe("Resume")
    expect(failure.correlation).toEqual(correlation)
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("SafelySuspended")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("rejects Resume before a Safe private record and reports the exact command correlation", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    const failure = yield* executor.resume(request).pipe(Effect.flip)
    expect(failure.command).toBe("Resume")
    expect(failure.correlation).toEqual(correlation)
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("passively reports no lifecycle state for an idle AssociatedPreTurn record", () => {
  const harness = makeHarness()
  harness.setRecord(
    CodexAttemptRecord.cases.AssociatedPreTurn.make({
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      threadId: CodexThreadId.make("codex-thread-issue-58"),
      worktree
    })
  )
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const projection = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projection).toEqual(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
    expect(harness.turnCount()).toBe(0)
    expect(harness.currentRecord()?._tag).toBe("AssociatedPreTurn")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("returns a foreign executing report when Resume rereads a foreign thread correlation", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)
    yield* executor.requestSuspension(attempt)
    const safe = harness.currentRecord()
    expect(safe?._tag).toBe("SafelySuspended")
    harness.makeForeignResume()
    const foreign = yield* executor.resume(request)
    expect(foreign).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: { attemptId: AttemptId.make("foreign-attempt"), runId: RunId.make("foreign-run") }
      })
    )
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("SafelySuspended")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("rejects replacement when a sealed ledger meets an unowned TurnIntent private record", () =>
  Effect.gen(function* () {
    const harness = seedReplacementHarness()
    const request = replacementRequestFor("foreign-private-intent")
    expect((yield* runReplacement(harness, request, replacementAuthorityLayer()))._tag).toBe("Replaced")
    const current = harness.currentRecord()
    expect(current?._tag).toBe("TurnObserved")
    if (current?._tag !== "TurnObserved") return

    const { _tag: _currentTag, observedTurnId, ...intentFields } = current
    harness.setRecord(
      CodexAttemptRecord.cases.TurnIntentRecorded.make({
        ...intentFields,
        currentToken: current.currentToken,
        priorObservedTurnId: current.priorObservedTurnId
      })
    )
    const result = yield* runReplacement(harness, request, replacementAuthorityLayer())
    expect(result._tag).toBe("CorrelationConflict")
    expect(harness.turnCount()).toBe(1)
    expect(harness.replacementLedger()?.history.at(-1)?._tag).toBe("Sealed")
    expect(observedTurnId).toBeDefined()
  })
)

it.effect("rejects replacement when a sealed ledger meets either unowned pre-turn private record", () =>
  Effect.gen(function* () {
    for (const tag of ["AssociatedPreTurn", "EmptyPreTurn"] as const) {
      const harness = seedReplacementHarness()
      const request = replacementRequestFor(`foreign-private-${tag}`)
      expect((yield* runReplacement(harness, request, replacementAuthorityLayer()))._tag).toBe("Replaced")
      const current = harness.currentRecord()
      expect(current?._tag).toBe("TurnObserved")
      if (current?._tag !== "TurnObserved") continue

      harness.setRecord(
        tag === "AssociatedPreTurn"
          ? CodexAttemptRecord.cases.AssociatedPreTurn.make({
              attemptId: current.attemptId,
              correlationAttemptId: current.correlationAttemptId,
              correlationRunId: current.correlationRunId,
              threadId: current.threadId,
              worktree: current.worktree
            })
          : CodexAttemptRecord.cases.EmptyPreTurn.make({
              attemptId: current.attemptId,
              correlationAttemptId: current.correlationAttemptId,
              correlationRunId: current.correlationRunId,
              worktree: current.worktree
            })
      )

      const result = yield* runReplacement(harness, request, replacementAuthorityLayer())
      expect(result._tag).toBe("CorrelationConflict")
      expect(harness.turnCount()).toBe(1)
      expect(harness.replacementLedger()?.history.at(-1)?._tag).toBe("Sealed")
    }
  })
)

it.effect("refuses replacement when no observed private turn can prove a purged predecessor", () =>
  Effect.gen(function* () {
    const harness = seedReplacementHarness()
    const current = harness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag !== "Running") return

    const { _tag: _currentTag, observedTurnId, ...intentFields } = current
    harness.setRecord(
      CodexAttemptRecord.cases.TurnIntentRecorded.make({
        ...intentFields,
        currentToken: current.currentToken,
        priorObservedTurnId: current.priorObservedTurnId
      })
    )
    const result = yield* runReplacement(
      harness,
      replacementRequestFor("unobserved-private-turn"),
      replacementAuthorityLayer()
    )
    expect(result._tag).toBe("PurgeUnconfirmed")
    expect(harness.turnCount()).toBe(0)
    expect(harness.replacementLedger()).toBeUndefined()
    expect(observedTurnId).toBeDefined()
  })
)
