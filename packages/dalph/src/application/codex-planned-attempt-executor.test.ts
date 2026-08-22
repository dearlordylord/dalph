import { it } from "@effect/vitest"
import {
  AttemptId,
  AcceptedResultEvidenceManifest,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutor,
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
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  EvidenceStore,
  EvidenceStoreFailure,
  GitCommand,
  GitCommandInvocationFailure,
  memoryEvidenceStoreLayer,
  type GitCommandService
} from "@dalph/orchestrator"
import { NodeServices } from "@effect/platform-node"
import { Crypto, Effect, Layer, Option, Ref } from "effect"
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
  CodexSealedTerminal,
  CodexServerIncarnation,
  CodexAttemptRecord,
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
  readonly setThread: (thread: CodexThreadSnapshot) => void
  readonly preserveResumeCwd: () => void
  readonly setRecord: (record: CodexAttemptRecord) => void
  readonly setReadOverride: (record: CodexAttemptRecord | undefined) => void
  readonly complete: (message: string) => void
  readonly completeWithItems: (items: ReadonlyArray<unknown>) => void
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
    readonly terminalTurnStatus?: "completed" | "failed"
    readonly omitOwnedTurnToken?: boolean
    readonly wrongOwnedTurnToken?: boolean
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
  let readOverride: CodexAttemptRecord | undefined
  let threadStartCount = 0
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
        if (
          ((options.loseFirstTurnResponse === true && !firstTurnResponseLost) ||
            options.loseTurnResponseAt === turnNumber) &&
          !firstTurnResponseLost
        ) {
          firstTurnResponseLost = true
          if (options.resumeUnavailableAfterLostTurn === true) resumeUnavailable = true
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
    readAttempt: (runId, attemptId) =>
      readFailure
        ? Effect.fail(new CodexAttemptStoreFailure({ detail: "read failed", operation: "readAttempt" }))
        : Effect.sync(() => {
            const record = readOverride ?? records.get(keyOf(runId, attemptId))
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
    setThread: (thread) => {
      currentThread = thread
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

const layerFor = (
  harness: Harness,
  gitCommand: GitCommandService = defaultGitCommand,
  evidenceStore: Layer.Layer<EvidenceStore> | null = memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))
) =>
  codexPlannedAttemptExecutorLayer.pipe(
    Layer.provide(
      evidenceStore === null
        ? Layer.mergeAll(
            controlledCodexAppServerLayer(harness.app),
            controlledCodexOwnedActivityCensusLayer({
              observe: (thread, backgroundTerminals) =>
                Effect.succeed(harness.observeActivityCensus(thread, backgroundTerminals)),
              terminateDescendants: (descendants) => Effect.sync(() => harness.terminateDescendants(descendants))
            }),
            Layer.succeed(CodexAttemptStore, harness.store),
            Layer.succeed(GitCommand, gitCommand)
          )
        : Layer.mergeAll(
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

it.effect("fails closed when accepted evidence changes its manifest, content address, or encoding", () =>
  Effect.forEach(["manifest", "reference", "malformed"] as const, (mode) => {
    const harness = makeHarness()
    return Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.startOrContinue(request)
      harness.complete(finalResponse(head))
      const result = yield* executor.startOrContinue(request).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
      expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
    }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, mutatedEvidenceStoreLayer(mode))))
  })
)

it.effect("keeps an accepted turn running when activity appears during evidence publication", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    harness.setActivityCensusSequence([
      { _tag: "Absent" },
      { _tag: "ExactLive", activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("late-active-58") }] }
    ])
    expect(yield* executor.startOrContinue(request)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
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
    yield* executor.startOrContinue(request)
    unavailableEvidenceHarness.complete(finalResponse(head))
    const unavailableEvidence = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(unavailableEvidence._tag).toBe("Failure")
    expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
  }).pipe(
    Effect.provide(layerFor(unavailableEvidenceHarness, defaultGitCommand, null)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        failedHeadHarness.complete(finalResponse(head))
        expect((yield* executor.startOrContinue(request).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(failedHeadHarness, failedHead)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        malformedHeadHarness.complete(finalResponse(head))
        expect((yield* executor.startOrContinue(request).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(malformedHeadHarness, malformedHead)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        movingHeadHarness.complete(finalResponse(head))
        expect((yield* executor.startOrContinue(request).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(movingHeadHarness, movingHead)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        rereadFailureHarness.complete(finalResponse(head))
        expect((yield* executor.startOrContinue(request).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(rereadFailureHarness, rereadFailure)))
    )
  )
})

it.effect("seals an immediate provider failure and rejects a turn that returns another owned token", () => {
  const failedHarness = makeHarness({ terminalTurnStatus: "failed" })
  const tokenHarness = makeHarness({ wrongOwnedTurnToken: true })
  return Effect.gen(function* () {
    const failedExecutor = yield* PlannedAttemptExecutor
    const failed = yield* failedExecutor.startOrContinue(request)
    expect(failed).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
    )
  }).pipe(
    Effect.provide(layerFor(failedHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const result = yield* executor.startOrContinue(request).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
      }).pipe(Effect.provide(layerFor(tokenHarness)))
    )
  )
})

it.effect("seals a recovered failed owned turn even when Codex marks its thread systemError", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect((yield* executor.startOrContinue(request))._tag).toBe("Running")
    const thread = harness.currentThread()
    harness.setThread({
      ...thread,
      status: "systemError",
      turns: thread.turns.map((turn) => ({ ...turn, status: "failed" as const }))
    })
    const failed = yield* executor.startOrContinue(request)
    expect(failed).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
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
        yield* executor.startOrContinue(request)
        harness.completeWithItems(items)
        const failed = yield* executor.startOrContinue(request)
        expect(failed).toEqual(
          PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
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
      yield* executor.startOrContinue(request)
      activityHarness.complete(finalResponse(head))
      const accepted = yield* executor.startOrContinue(request)
      expect(accepted._tag).toBe("Terminal")
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
      const activityDuringReread = yield* executor.project(correlation)
      expect(activityDuringReread._tag).toBe("Exact")
      if (activityDuringReread._tag === "Exact") expect(activityDuringReread.report._tag).toBe("Running")
      activityHarness.setActivityCensus({ _tag: "Absent" })
      expect((yield* executor.project(correlation))._tag).toBe("Exact")
    }).pipe(
      Effect.provide(layerFor(activityHarness)),
      Effect.andThen(
        Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.startOrContinue(request)
          turnHarness.complete(finalResponse(head))
          expect((yield* executor.startOrContinue(request))._tag).toBe("Terminal")
          turnHarness.complete(finalResponse(otherHead))
          expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
        }).pipe(Effect.provide(layerFor(turnHarness)))
      ),
      Effect.andThen(
        Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.startOrContinue(request)
          headHarness.complete(finalResponse(head))
          expect((yield* executor.startOrContinue(request))._tag).toBe("Terminal")
          headMismatch = true
          expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
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
      yield* executor.startOrContinue(request)
      harness.complete(finalResponse(head))
      expect((yield* executor.startOrContinue(request))._tag).toBe("Terminal")
    }).pipe(Effect.provide(layerFor(harness)))
    const restarted = Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
    }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, null)))
    return accepted.pipe(Effect.andThen(restarted))
  }
)

it.effect("rejects corrupted evidence when rereading an accepted terminal", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    expect((yield* executor.startOrContinue(request))._tag).toBe("Terminal")
    expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
  }).pipe(Effect.provide(layerFor(harness, defaultGitCommand, corruptOnRereadEvidenceStoreLayer)))
})

it.effect("serializes same-attempt parallel admission behind one gate", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const reports = yield* Effect.all(
      Array.from({ length: 12 }, () => executor.startOrContinue(request)),
      { concurrency: 12 }
    )
    expect(reports).toHaveLength(12)
    expect(reports.every((report) => report._tag === "Running")).toBe(true)
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

it.effect("matches an owned turn correlation when the app-server records it explicitly", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    const thread = harness.currentThread()
    const turn = thread.turns[0]
    expect(turn).toBeDefined()
    if (turn !== undefined) {
      harness.setThread({ ...thread, turns: [{ ...turn, correlation }] })
    }
    const projected = yield* executor.project(correlation)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") expect(projected.report._tag).toBe("Running")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("reconciles a lost response from a terminal turn without sending another turn", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true, terminalTurnStatus: "completed" })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const result = yield* executor.startOrContinue(request)
    expect(result).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
    )
    expect(harness.turnCount()).toBe(1)
    expect(harness.currentRecord()?._tag).toBe("Terminal")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("retains the original turn-start failure when recovery cannot resume the thread", () => {
  const harness = makeHarness({ loseFirstTurnResponse: true, resumeUnavailableAfterLostTurn: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const result = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("backfills an omitted owned token on the started turn", () => {
  const harness = makeHarness({ omitOwnedTurnToken: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect((yield* executor.startOrContinue(request))._tag).toBe("Running")
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
    harness.setActivityCensusSequence([{ _tag: "Absent" }, { _tag: "ExactLive", activities: [] }, { _tag: "Absent" }])
    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    const failed = yield* executor.startOrContinue(request)
    expect(failed).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
    )
    const again = yield* executor.startOrContinue(request)
    expect(again).toEqual(failed)
    expect(JSON.stringify(failed)).not.toContain("Completed")
    harness.setActivityCensus({ _tag: "ExactLive", activities: [] })
    const activeTerminal = yield* executor.project(correlation)
    expect(activeTerminal._tag).toBe("Exact")
    if (activeTerminal._tag === "Exact") expect(activeTerminal.report._tag).toBe("Running")
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

it.effect("keeps suspension unresolved for contradictory, active, surviving, and failed activity cleanup", () => {
  const contradictoryHarness = makeHarness()
  const activeHarness = makeHarness()
  const survivingHarness = makeHarness()
  const failedTerminationHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    contradictoryHarness.setActivityCensus({ _tag: "Contradictory", detail: "contradictory activity" })
    const contradictory = yield* executor.requestSuspension(attempt).pipe(Effect.exit)
    expect(contradictory._tag).toBe("Failure")
  }).pipe(
    Effect.provide(layerFor(contradictoryHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
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
        yield* executor.startOrContinue(request)
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
        yield* executor.startOrContinue(request)
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
    yield* executor.startOrContinue(request)
    harness.makeInterruptSettleBeforeFailure()
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("lets a terminal turn observed after interrupt failure win suspension", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.makeInterruptTerminalBeforeFailure()
    const report = yield* executor.requestSuspension(attempt)
    expect(report._tag).toBe("Terminal")
    if (report._tag === "Terminal") expect(report.result._tag).toBe("Accepted")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("fails closed when the persisted prior owned turn is self-referential or missing", () => {
  const selfReferentialHarness = makeHarness()
  const missingPriorHarness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    const current = selfReferentialHarness.currentRecord()
    expect(current?._tag).toBe("Running")
    if (current?._tag === "Running") {
      selfReferentialHarness.setRecord(
        CodexAttemptRecord.cases.Running.make({ ...current, priorObservedTurnId: current.observedTurnId })
      )
      expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
    }
  }).pipe(
    Effect.provide(layerFor(selfReferentialHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        const current = missingPriorHarness.currentRecord()
        expect(current?._tag).toBe("Running")
        if (current?._tag === "Running") {
          missingPriorHarness.setRecord(
            CodexAttemptRecord.cases.Running.make({
              ...current,
              priorObservedTurnId: CodexTurnId.make("missing-prior-58")
            })
          )
          expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
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
    yield* executor.startOrContinue(request)
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
      expect((yield* executor.startOrContinue(request))._tag).toBe("Running")
      expect(runningHarness.currentRecord()?._tag).toBe("Running")
    }
  }).pipe(
    Effect.provide(layerFor(runningHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
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
            PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
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
        yield* executor.startOrContinue(request)
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
        expect(foreign._tag).toBe("Running")
        expect(foreign.correlation.attemptId).toBe("foreign-suspension-attempt")
      }).pipe(Effect.provide(layerFor(foreignHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
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
    yield* executor.startOrContinue(request)
    notLoadedHarness.setThread({ ...notLoadedHarness.currentThread(), status: "notLoaded" })
    expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
    expect(yield* executor.startOrContinue(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
  }).pipe(
    Effect.provide(layerFor(notLoadedHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        systemErrorHarness.setThread({ ...systemErrorHarness.currentThread(), status: "systemError" })
        expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
      }).pipe(Effect.provide(layerFor(systemErrorHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        cwdMismatchHarness.setThread({ ...cwdMismatchHarness.currentThread(), cwd: "/tmp/foreign-worktree" })
        cwdMismatchHarness.preserveResumeCwd()
        expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
      }).pipe(Effect.provide(layerFor(cwdMismatchHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
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
          expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
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
        yield* executor.startOrContinue(request)
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
          expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
          expect(yield* executor.requestSuspension(attempt).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
          expect(yield* executor.startOrContinue(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
        }
      }).pipe(Effect.provide(layerFor(unresolvedHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
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
          expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
        }
      }).pipe(Effect.provide(layerFor(observedMissingHarness)))
    )
  )
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

it.effect("sends the first turn on a freshly associated thread without treating it as recovered state", () => {
  const harness = makeHarness({ missingEmptyThread: true })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    expect(harness.threadStarts()).toBe(1)
    expect(harness.resumeCwds).toHaveLength(0)
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("replaces only a conclusively absent empty pre-turn thread", () => {
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

it.effect("projects no report, safe suspension, and an idle running record through the normalized boundary", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect((yield* executor.project(correlation))._tag).toBe("NoReport")

    harness.setRecord(
      CodexAttemptRecord.cases.EmptyPreTurn.make({
        attemptId: attempt.attemptId,
        correlationAttemptId: attempt.attemptId,
        correlationRunId: attempt.runId,
        worktree
      })
    )
    expect((yield* executor.project(correlation))._tag).toBe("NoReport")

    const associatedRecord = CodexAttemptRecord.cases.AssociatedPreTurn.make({
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      threadId: CodexThreadId.make("codex-thread-issue-58"),
      worktree
    })
    harness.setRecord(associatedRecord)
    expect((yield* executor.project(correlation))._tag).toBe("NoReport")

    const running = yield* executor.startOrContinue(request)
    expect(running._tag).toBe("Running")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("SafelySuspended")
    const projectedSuspension = yield* executor.project(correlation)
    expect(projectedSuspension).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
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
      const exact = yield* executor.project(correlation)
      expect(exact._tag).toBe("Exact")
      if (exact._tag === "Exact") expect(exact.report._tag).toBe("Running")
      harness.setActivityCensus({ _tag: "Unreadable", detail: "idle activity census unavailable" })
      expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
      harness.setActivityCensus({ _tag: "Absent" })
      expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
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
    expect((yield* failureExecutor.project(correlation))._tag).toBe("Unreadable")
  }).pipe(
    Effect.provide(layerFor(failureHarness)),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
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
        expect((yield* executor.project(correlation))._tag).toBe("CorrelationContradiction")
        expect((yield* executor.startOrContinue(request))._tag).toBe("Running")
      }).pipe(Effect.provide(layerFor(foreignHarness)))
    ),
    Effect.andThen(
      Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.startOrContinue(request)
        protocolHarness.setResumeFailure(
          new CodexAppServerFailure({ detail: "protocol response", kind: "Protocol", operation: "thread/resume" })
        )
        expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
        protocolHarness.setResumeFailure(
          new CodexAppServerFailure({
            detail: "initialization identity conflict",
            kind: "CorrelationContradiction",
            operation: "initialize"
          })
        )
        expect((yield* executor.project(correlation))._tag).toBe("InitializationCorrelationContradiction")
      }).pipe(Effect.provide(layerFor(protocolHarness)))
    )
  )
})

it.effect("reconstructs a persisted failed terminal without sending another task turn", () => {
  const harness = makeHarness({ terminalTurnStatus: "failed" })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const started = yield* executor.startOrContinue(request)
    expect(started._tag).toBe("Terminal")
    expect(harness.turnCount()).toBe(1)

    const current = harness.currentRecord()
    expect(current?._tag).toBe("Terminal")
    const projected = yield* executor.project(correlation)
    expect(projected).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
      })
    )
    const retried = yield* executor.startOrContinue(request)
    expect(retried).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
    )
    expect(harness.turnCount()).toBe(1)
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect("fails closed when a persisted terminal is presented while its turn is still active during start", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
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
    expect(yield* executor.startOrContinue(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
  }).pipe(Effect.provide(layerFor(harness)))
})

it.effect(
  "fails closed when a persisted terminal is presented while its turn is still active during suspension",
  () => {
    const harness = makeHarness()
    return Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.startOrContinue(request)
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
    yield* executor.startOrContinue(request)
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
      expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
      expect(yield* executor.startOrContinue(request).pipe(Effect.exit)).toHaveProperty("_tag", "Failure")
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
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    expect((yield* executor.startOrContinue(request))._tag).toBe("Terminal")
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
    expect((yield* executor.project(correlation))._tag).toBe("Unreadable")
  }).pipe(
    Effect.provide(layerFor(harness, defaultGitCommand, manifestDriftEvidenceStoreLayer(replacementBytes))),
    Effect.provide(NodeServices.layer)
  )
})

it.effect("fails closed when a persisted terminal is followed by an interrupted turn", () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.startOrContinue(request)
    harness.complete(finalResponse(head))
    expect((yield* executor.startOrContinue(request))._tag).toBe("Terminal")
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
    const restarted = yield* executor.startOrContinue(request).pipe(Effect.exit)
    expect(restarted._tag).toBe("Failure")
  }).pipe(Effect.provide(layerFor(harness)))
})
