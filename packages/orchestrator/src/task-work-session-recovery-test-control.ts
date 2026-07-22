import { Effect } from "effect"
import {
  AttemptId,
  GitCommitSha,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  WorktreeLocator
} from "./domain.js"
import {
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest
} from "./task-work-start.js"
import { decideTaskWorkSessionRecovery, makeTaskWorkSessionEstablishmentOperation } from "./workflow.js"

const conformanceTaskId = TaskId.make("mbt-task")
const initialOrdinal = 0n
const nextOrdinal = 1n
const plannedAttemptPayload = 41n
const plannedPredecessorOperationId = -1n
const lookupAttemptBound = 3n
const conformanceOperation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [OperationId.make("mbt-predecessor")],
  request: TaskWorkStartRequest.make({
    operationId: OperationId.make("mbt-operation"),
    plannedAttempt: PlannedTaskAttempt.make({
      attemptId: AttemptId.make("mbt-attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/mbt-task"),
      runId: RunId.make("mbt-run"),
      taskId: conformanceTaskId,
      worktree: WorktreeLocator.make("/tmp/mbt-task")
    }),
    task: {
      id: conformanceTaskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
  })
})

const recoveryObservation = (evidence: string) => {
  switch (evidence) {
    case "Matching":
      return MatchingTaskWorkSessionReported.make({
        observationId: ProviderObservationId.make("mbt-matching"),
        sessionId: TaskWorkSessionId.make("mbt-session"),
        work: { _tag: "NoProviderWorkReported" }
      })
    case "Absent":
      return NoMatchingTaskWorkSessionReported.make({
        observationId: ProviderObservationId.make("mbt-absent")
      })
    case "Unreadable":
      return new TaskWorkSessionLookupFailure({
        detail: "mbt unreadable provider registry",
        observationId: ProviderObservationId.make("mbt-unreadable")
      })
    case "Conflict":
      return TaskWorkSessionCorrelationConflict.make({
        conflicts: [{
          detail: "mbt provider conflict",
          sessionId: TaskWorkSessionId.make("mbt-conflict")
        }],
        observationId: ProviderObservationId.make("mbt-conflict")
      })
    default:
      return undefined
  }
}

const requireCondition = (condition: boolean, detail: string): void => {
  if (!condition) Effect.runSync(Effect.die(new Error(detail)))
}

/**
 * Public deterministic controls used by quint-connect. Durable/provider fields
 * survive `crash`; only activation-local controls reset. Provider decisions
 * delegate to the same total reducer as the production Effect protocol.
 */
export const makeTaskWorkSessionRecoveryTestControl = () => {
  let authorization = "NoAuthorization"
  let candidateSelected = false
  let coordinatorRunning = true
  let everCrashed = false
  let intentCommitted = false
  let lookupAttempts = initialOrdinal
  let matchingReportRecorded = false
  let operationId = initialOrdinal
  let predecessorOperationIds = new Set<bigint>()
  let pendingEvidence = "NoEvidence"
  let providerHasSession = false
  let recordedEvidence = "NoEvidence"
  let requestCount = initialOrdinal
  let requestOperationIds = new Set<bigint>()
  let requestPayloads = new Set<bigint>()
  let status = "Active"

  const requireRunning = () => requireCondition(coordinatorRunning, "the coordinator must be running")
  const lookup = (evidence: string) =>
    Effect.sync(() => {
      requireRunning()
      lookupAttempts += nextOrdinal
      pendingEvidence = evidence
    })
  const request = (createsSession: boolean) =>
    Effect.sync(() => {
      requireRunning()
      requireCondition(intentCommitted, "intent must precede the request")
      requestCount += nextOrdinal
      requestOperationIds = new Set([...requestOperationIds, operationId])
      requestPayloads = new Set([...requestPayloads, plannedAttemptPayload])
      providerHasSession = providerHasSession || createsSession
      authorization = "NoAuthorization"
      recordedEvidence = "NoEvidence"
    })

  return {
    commitIntent: () =>
      Effect.sync(() => {
        requireRunning()
        requireCondition(candidateSelected, "identity must be selected before intent")
        intentCommitted = true
        authorization = "InitialRequest"
      }),
    crash: () =>
      Effect.sync(() => {
        requireRunning()
        coordinatorRunning = false
        lookupAttempts = initialOrdinal
        pendingEvidence = "NoEvidence"
        authorization = "NoAuthorization"
        matchingReportRecorded = status === "Established"
        everCrashed = true
      }),
    init: () =>
      Effect.sync(() => {
        authorization = "NoAuthorization"
        candidateSelected = false
        coordinatorRunning = true
        everCrashed = false
        intentCommitted = false
        lookupAttempts = initialOrdinal
        matchingReportRecorded = false
        operationId = initialOrdinal
        predecessorOperationIds = new Set()
        pendingEvidence = "NoEvidence"
        providerHasSession = false
        recordedEvidence = "NoEvidence"
        requestCount = initialOrdinal
        requestOperationIds = new Set()
        requestPayloads = new Set()
        status = "Active"
      }),
    lookupAbsent: () => lookup("Absent"),
    lookupConflict: () => lookup("Conflict"),
    lookupContradictoryAbsence: () => lookup("Absent"),
    lookupMatching: () => lookup("Matching"),
    lookupUnreadable: () => lookup("Unreadable"),
    recordLookup: () =>
      Effect.sync(() => {
        requireRunning()
        const observation = recoveryObservation(pendingEvidence)
        const decision = observation === undefined
          ? undefined
          : decideTaskWorkSessionRecovery(
            conformanceOperation,
            observation,
            lookupAttempts === lookupAttemptBound
          )
        if (recordedEvidence === "Matching" && pendingEvidence === "Absent") {
          recordedEvidence = "Absent"
          status = "CorrelationConflict"
        } else if (decision?._tag === "Established") {
          recordedEvidence = "Matching"
          matchingReportRecorded = true
        } else if (decision?._tag === "RepeatRequest") {
          recordedEvidence = "Absent"
          authorization = "FreshAbsence"
        } else if (decision?._tag === "RetryLookup") {
          recordedEvidence = "Unreadable"
        } else if (decision?._tag === "Failed") {
          if (pendingEvidence === "Absent") {
            recordedEvidence = "Absent"
            status = "EstablishmentDidNotConverge"
          } else if (pendingEvidence === "Unreadable") {
            recordedEvidence = "Unreadable"
            status = "LookupDidNotConverge"
          } else {
            recordedEvidence = "Conflict"
            status = "CorrelationConflict"
          }
        }
        pendingEvidence = "NoEvidence"
      }),
    recordOutcome: () =>
      Effect.sync(() => {
        requireRunning()
        requireCondition(matchingReportRecorded, "a matching report must precede outcome")
        status = "Established"
      }),
    requestCreatesNothing: () => request(false),
    requestCreatesSession: () => request(true),
    restart: () =>
      Effect.sync(() => {
        requireCondition(!coordinatorRunning, "the coordinator must be stopped")
        coordinatorRunning = true
        candidateSelected = intentCommitted
      }),
    selectIdentity: () =>
      Effect.sync(() => {
        requireRunning()
        candidateSelected = true
        operationId += nextOrdinal
        predecessorOperationIds = new Set([plannedPredecessorOperationId])
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
        predecessorOperationIds,
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
