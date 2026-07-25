/* eslint-disable functional/immutable-data, no-magic-numbers */
import { Cause, Effect, Exit, Fiber, Layer, Match, Queue } from "effect"
import {
  AttemptId,
  GitCommitSha,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { type JournalRecord, JournalStore, type WorkflowJournalEvent } from "./journal-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import { taskRevisionFor } from "./task-dag.js"
import { taskExecutorTestLayer } from "./task-execution.js"
import { makeTaskWorkSessionRecoveryModelJournal } from "./task-work-session-recovery-model-journal.js"
import {
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  TaskRunner,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest
} from "./task-work-start.js"
import { recordReadyWorktreeEvidence } from "./task-worktree-evidence.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { deterministicTestWorkflowInterpreterLayer } from "./workflow-interpreters.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

type Evidence = "Absent" | "Conflict" | "Matching" | "Unreadable"
type PendingEvidence = Evidence | "NoEvidence"
const lookupBound = 3n
const taskId = TaskId.make("mbt-task")
const runId = RunId.make("mbt-run")
const planOperationId = OperationId.make("mbt-predecessor")
const worktreeOperationId = OperationId.make("mbt-worktree")

/**
 * @experimental Executable Quint conformance infrastructure, not a supported
 * production reducer, scheduler, or package API. Its placement and shape remain
 * under consideration. Do not derive runtime architecture from its queues,
 * projections, or deterministic authority scripts.
 *
 * The controls invoke the real journaled WorkflowInterpreter protocol.
 * Local fields only project test observations; all requests, retries, durable
 * records, failures, and recovery decisions are produced by production code.
 */
export const makeTaskWorkSessionRecoveryModelControls = () => {
  let authorization = "NoAuthorization"
  let candidateSelected = false
  let coordinatorRunning = true
  let everCrashed = false
  let intentCommitted = false
  let lookupAttempts = 0n
  let matchingReportRecorded = false
  let operationId = 0n
  let pendingEvidence: PendingEvidence = "NoEvidence"
  let providerHasSession = false
  let providerObservationOrdinal = 0n
  let recordedEvidence = "NoEvidence"
  let requestCount = 0n
  let status = "Active"
  let operation: ReturnType<typeof makeTaskWorkSessionEstablishmentOperation> | undefined
  let interruptWorkflow: Effect.Effect<void> = Effect.void

  const predecessorOperationIds = new Set([-1n])
  const requestOperationIds = new Set<bigint>()
  const requestPayloads = new Set<bigint>()
  const records = new Array<JournalRecord>()

  let intentCommittedSignal: Queue.Queue<void>
  let releaseIntent: Queue.Queue<void>
  let requestCrossedSignal: Queue.Queue<void>
  let requestPlans: Queue.Queue<boolean>
  let lookupRecordedSignal: Queue.Queue<Evidence>
  let lookupPlans: Queue.Queue<Evidence>
  let releaseLookupRecord: Queue.Queue<void>
  let outcomePendingSignal: Queue.Queue<void>
  let releaseOutcome: Queue.Queue<void>
  let workflowExitSignal: Queue.Queue<Exit.Exit<unknown, unknown>>

  const requireOperation = () => {
    if (operation === undefined) return Effect.die(new Error("identity must be selected"))
    return Effect.succeed(operation)
  }

  const beforeJournalAppend = (event: WorkflowJournalEvent) =>
    event._tag === "TaskWorkSessionEstablished"
      ? Queue.offer(outcomePendingSignal, undefined).pipe(Effect.andThen(Queue.take(releaseOutcome)))
      : Effect.void

  const observedLookupEvidence = (event: WorkflowJournalEvent): Evidence | undefined =>
    event._tag === "TaskWorkSessionLookupFailed"
      ? "Unreadable"
      : event._tag !== "TaskWorkSessionReported"
      ? undefined
      : event.report._tag === "MatchingTaskWorkSessionReported"
      ? "Matching"
      : event.report._tag === "NoMatchingTaskWorkSessionReported"
      ? "Absent"
      : "Conflict"

  const afterJournalAppend = (
    event: WorkflowJournalEvent,
    existed: boolean
  ) =>
    Effect.gen(function*() {
      if (event._tag === "TaskWorkSessionEstablishmentIntentRecorded" && !existed) {
        yield* Queue.offer(intentCommittedSignal, undefined)
        yield* Queue.take(releaseIntent)
      }
      const evidence = observedLookupEvidence(event)
      if (evidence !== undefined) {
        yield* Queue.offer(lookupRecordedSignal, evidence)
        yield* Queue.take(releaseLookupRecord)
      }
    })

  const journal = makeTaskWorkSessionRecoveryModelJournal(
    records,
    runId,
    beforeJournalAppend,
    afterJournalAppend
  )

  const runner = TaskRunner.of({
    lookupTaskWorkSession: () =>
      Effect.gen(function*() {
        const evidence = yield* Queue.take(lookupPlans)
        lookupAttempts += 1n
        providerObservationOrdinal += 1n
        const ordinal = providerObservationOrdinal
        if (evidence === "Unreadable") {
          return yield* new TaskWorkSessionLookupFailure({
            detail: "mbt unreadable provider registry",
            observationId: ProviderObservationId.make(`mbt-unreadable-${ordinal}`)
          })
        }
        if (evidence === "Conflict") {
          return TaskWorkSessionCorrelationConflict.make({
            conflicts: [{
              detail: "mbt provider conflict",
              sessionId: TaskWorkSessionId.make("mbt-conflict")
            }],
            observationId: ProviderObservationId.make(`mbt-conflict-${ordinal}`)
          })
        }
        return evidence === "Matching"
          ? MatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make(`mbt-matching-${ordinal}`),
            sessionId: TaskWorkSessionId.make("mbt-session"),
            work: { _tag: "NoProviderWorkReported" }
          })
          : NoMatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make(`mbt-absent-${ordinal}`)
          })
      }),
    requestTaskWorkStart: (request) =>
      Effect.gen(function*() {
        const createsSession = yield* Queue.take(requestPlans)
        requestCount += 1n
        requestOperationIds.add(operationId)
        requestPayloads.add(41n)
        providerHasSession ||= createsSession
        yield* Queue.offer(requestCrossedSignal, undefined)
        return {
          observationId: ProviderObservationId.make(`mbt-request-observation-${requestCount}`),
          providerRequestId: ProviderRequestId.make(`mbt-request-${request.operationId}-${requestCount}`)
        }
      })
  })

  const interpreterLayer = journaledWorkflowInterpreterLayer(
    runId,
    deterministicTestWorkflowInterpreterLayer,
    taskExecutorTestLayer
  ).pipe(
    Layer.provide(Layer.succeed(TaskRunner, runner)),
    Layer.provide(Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        /* v8 ignore start -- prerequisite tracker evidence makes this defensive provider unreachable -- @preserve */
        read: () => Effect.die("unused tracker read")
        /* v8 ignore stop -- @preserve */
      })
    )),
    Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
  )

  const startWorkflow = Effect.gen(function*() {
    const selected = yield* requireOperation()
    const fiber = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      yield* interpreter.recordTaskAttemptPlan(makeTaskAttemptPlanOperation({
        operationId: planOperationId,
        plannedAttempt: selected.request.plannedAttempt,
        predecessorOperationIds: []
      }))
      const worktreeOperation = makeTaskWorktreeReconciliationOperation({
        operationId: worktreeOperationId,
        plannedAttempt: selected.request.plannedAttempt,
        predecessorOperationIds: [planOperationId]
      })
      yield* recordReadyWorktreeEvidence(worktreeOperation)
      return yield* interpreter.establishTaskWorkSession(selected)
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) && exit.cause.reasons.every(Cause.isInterruptReason)
          ? Effect.void
          : Queue.offer(workflowExitSignal, exit)
      ),
      Effect.provide(interpreterLayer),
      Effect.provide(Layer.succeed(JournalStore, journal)),
      Effect.forkDetach
    )
    interruptWorkflow = Fiber.interrupt(fiber).pipe(Effect.asVoid)
  })

  const lookup = (evidence: Evidence) =>
    Effect.gen(function*() {
      yield* Queue.offer(lookupPlans, evidence)
      pendingEvidence = yield* Queue.take(lookupRecordedSignal)
    })

  const applyWorkflowExit = (exit: Exit.Exit<unknown, unknown>) => {
    if (Exit.isSuccess(exit)) {
      return Effect.sync(() => {
        status = "Established"
      })
    }
    const failure = Cause.squash(exit.cause)
    /* v8 ignore start -- WorkflowInterpreter failures are typed tagged errors -- @preserve */
    if (typeof failure !== "object" || failure === null || !("_tag" in failure)) {
      return Effect.die(failure)
    }
    /* v8 ignore stop -- @preserve */
    const recordStatus = (next: string) =>
      Effect.sync(() => {
        status = next
      })
    return Match.value(failure._tag).pipe(
      Match.when("TaskWorkSessionLookupDidNotConverge", () => recordStatus("LookupDidNotConverge")),
      Match.when("TaskWorkSessionEstablishmentDidNotConverge", () => recordStatus("EstablishmentDidNotConverge")),
      Match.when("TaskWorkSessionCorrelationConflict", () => recordStatus("CorrelationConflict")),
      /* v8 ignore start -- M1 authority actions cannot construct contradictory durable evidence -- @preserve */
      Match.when("TaskWorkSessionEvidenceContradiction", () => recordStatus("CorrelationConflict")),
      Match.orElse(() => Effect.die(failure))
      /* v8 ignore stop -- @preserve */
    )
  }

  const recordLookup = (evidence: Evidence) =>
    Effect.gen(function*() {
      yield* Queue.offer(releaseLookupRecord, undefined)
      recordedEvidence = evidence
      pendingEvidence = "NoEvidence"
      yield* Match.value(evidence).pipe(
        Match.when("Matching", () =>
          Effect.sync(() => {
            matchingReportRecorded = true
          }).pipe(Effect.andThen(Queue.take(outcomePendingSignal)))),
        Match.when("Absent", () =>
          matchingReportRecorded || lookupAttempts === lookupBound
            ? Queue.take(workflowExitSignal).pipe(Effect.flatMap(applyWorkflowExit))
            : Effect.sync(() => {
              authorization = "FreshAbsence"
            })),
        Match.when("Conflict", () => Queue.take(workflowExitSignal).pipe(Effect.flatMap(applyWorkflowExit))),
        Match.when("Unreadable", () =>
          lookupAttempts === lookupBound
            ? Queue.take(workflowExitSignal).pipe(Effect.flatMap(applyWorkflowExit))
            : Effect.void),
        Match.exhaustive
      )
    })

  const recordPendingLookup = (evidence: PendingEvidence) =>
    Match.value(evidence).pipe(
      Match.when("NoEvidence", () => Effect.die("no provider lookup is pending")),
      Match.when("Absent", () => recordLookup("Absent")),
      Match.when("Conflict", () => recordLookup("Conflict")),
      Match.when("Matching", () => recordLookup("Matching")),
      Match.when("Unreadable", () => recordLookup("Unreadable")),
      Match.exhaustive
    )

  return {
    init: () =>
      Effect.gen(function*() {
        yield* interruptWorkflow
        interruptWorkflow = Effect.void
        authorization = "NoAuthorization"
        candidateSelected = false
        coordinatorRunning = true
        everCrashed = false
        intentCommitted = false
        lookupAttempts = 0n
        matchingReportRecorded = false
        operationId = 0n
        pendingEvidence = "NoEvidence"
        providerHasSession = false
        providerObservationOrdinal = 0n
        recordedEvidence = "NoEvidence"
        requestCount = 0n
        status = "Active"
        operation = undefined
        records.length = 0
        requestOperationIds.clear()
        requestPayloads.clear()
        intentCommittedSignal = yield* Queue.unbounded<void>()
        releaseIntent = yield* Queue.unbounded<void>()
        requestCrossedSignal = yield* Queue.unbounded<void>()
        requestPlans = yield* Queue.unbounded<boolean>()
        lookupRecordedSignal = yield* Queue.unbounded<Evidence>()
        lookupPlans = yield* Queue.unbounded<Evidence>()
        releaseLookupRecord = yield* Queue.unbounded<void>()
        outcomePendingSignal = yield* Queue.unbounded<void>()
        releaseOutcome = yield* Queue.unbounded<void>()
        workflowExitSignal = yield* Queue.unbounded<Exit.Exit<unknown, unknown>>()
      }),
    selectIdentity: () =>
      Effect.sync(() => {
        candidateSelected = true
        operationId += 1n
        const task = {
          id: taskId,
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
        const request = TaskWorkStartRequest.make({
          operationId: OperationId.make(`mbt-operation-${operationId}`),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: AttemptId.make("mbt-attempt"),
            baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
            branch: TaskBranchRef.make("refs/heads/mbt-task"),
            executor: TaskExecutorLocator.make("executor:mbt"),
            runId,
            session: TaskWorkSessionLocator.make("session:mbt"),
            taskId,
            taskRevision: taskRevisionFor(task),
            worktree: WorktreeLocator.make("/tmp/mbt-task")
          }),
          task
        })
        operation = makeTaskWorkSessionEstablishmentOperation({
          predecessorOperationIds: [
            planOperationId,
            worktreeOperationId
          ],
          request
        })
      }),
    commitIntent: () =>
      Effect.gen(function*() {
        yield* startWorkflow
        yield* Queue.take(intentCommittedSignal)
        intentCommitted = true
        authorization = "InitialRequest"
      }),
    requestCreatesNothing: () =>
      Effect.gen(function*() {
        yield* Queue.offer(requestPlans, false)
        if (requestCount === 0n) yield* Queue.offer(releaseIntent, undefined)
        yield* Queue.take(requestCrossedSignal)
        authorization = "NoAuthorization"
        recordedEvidence = "NoEvidence"
      }),
    requestCreatesSession: () =>
      Effect.gen(function*() {
        yield* Queue.offer(requestPlans, true)
        if (requestCount === 0n) yield* Queue.offer(releaseIntent, undefined)
        yield* Queue.take(requestCrossedSignal)
        authorization = "NoAuthorization"
        recordedEvidence = "NoEvidence"
      }),
    lookupAbsent: () => lookup("Absent"),
    lookupConflict: () => lookup("Conflict"),
    lookupContradictoryAbsence: () => lookup("Absent"),
    lookupMatching: () => lookup("Matching"),
    lookupUnreadable: () => lookup("Unreadable"),
    recordLookup: () => recordPendingLookup(pendingEvidence),
    recordOutcome: () =>
      Queue.offer(releaseOutcome, undefined).pipe(
        Effect.andThen(Queue.take(workflowExitSignal)),
        Effect.flatMap(applyWorkflowExit),
        Effect.asVoid
      ),
    crash: () =>
      interruptWorkflow.pipe(Effect.andThen(Effect.sync(() => {
        coordinatorRunning = false
        lookupAttempts = 0n
        pendingEvidence = "NoEvidence"
        authorization = "NoAuthorization"
        matchingReportRecorded = status === "Established"
        everCrashed = true
      }))),
    restart: () =>
      Effect.gen(function*() {
        coordinatorRunning = true
        candidateSelected = intentCommitted
        if (intentCommitted && status !== "Established") yield* startWorkflow
      }),
    getState: () =>
      Effect.succeed({
        authorization,
        candidateSelected,
        coordinatorRunning,
        everCrashed,
        intentCommitted,
        lookupAttempts,
        matchingReportRecorded,
        operationId,
        predecessorOperationIds: operationId > 0n ? predecessorOperationIds : new Set<bigint>(),
        pendingEvidence,
        providerHasSession,
        recordedEvidence,
        requestCount,
        requestOperationIds,
        requestPayloads,
        status
      })
  }
}
