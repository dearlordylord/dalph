import { Effect, Option, Schema } from "effect"
import { type AttemptId, type PlannedAttemptExecutorReport, type TaskId } from "@dalph/contracts"
import { type JournalRecord } from "@dalph/orchestrator"
import {
  AuthoredExpectedBehavior,
  AuthoredObservedBehavior,
  AuthoredOrchestrationEvidence,
  type AuthoredOrchestrationEvidence as OrchestrationEvidence,
  AuthoredProtocolEvidence,
  type AuthoredProtocolEvidence as ProtocolEvidence,
  type AuthoredCassetteStoryItem,
  AuthoredTaskWorkResult,
  type AuthoredTaskWorkResult as TaskWorkResult
} from "./authored-domain.js"

export class AuthoredCassetteBehaviorMismatch extends Schema.TaggedErrorClass<AuthoredCassetteBehaviorMismatch>()(
  "AuthoredCassetteBehaviorMismatch",
  { actual: AuthoredObservedBehavior, expected: AuthoredExpectedBehavior }
) {}

interface CompleteAuthoredObservedBehavior {
  readonly orchestrationEvidence: ReadonlyArray<OrchestrationEvidence>
  readonly plannedWorkUndertakenFor: ReadonlyArray<TaskId>
  readonly protocolEvidence: ReadonlyArray<ProtocolEvidence>
  readonly taskWorkResults: ReadonlyArray<TaskWorkResult>
}

const orchestrationReportEvidence = (
  report: PlannedAttemptExecutorReport
): Extract<OrchestrationEvidence, { readonly _tag: "PlannedAttemptExecutorWorkReported" }> => ({
  _tag: "PlannedAttemptExecutorWorkReported",
  attemptId: report.correlation.attemptId,
  report:
    report._tag === "Terminal"
      ? report.result._tag === "Accepted"
        ? "TerminalAccepted"
        : report.result._tag === "Completed"
          ? "TerminalCompleted"
          : "TerminalFailed"
      : report._tag
})

const worktreeEvidence = (
  event: Extract<JournalRecord["event"], { readonly _tag: "TaskWorktreeReady" }>,
  worktreeAttemptByOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>
): ProtocolEvidence => {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(worktreeAttemptByOperation.get(event.operationId)))
  return { _tag: "TaskWorktreeReady", attemptId: plannedAttempt.attemptId, taskId: plannedAttempt.taskId }
}

const claimObservationEvidence = (
  event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>,
  priorAcquiredClaimByTask: ReadonlyMap<
    TaskId,
    Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
  >
): ReadonlyArray<ProtocolEvidence> => {
  if (event.observation._tag === "FocusedTaskClaimFactsUnreadable") {
    return [{ _tag: "TaskClaimReadExhausted", taskId: event.observation.coverage.taskId }]
  }
  if (event.observation._tag !== "FocusedTaskClaimFacts") return []
  const observation = event.observation.observation
  if (observation._tag === "UnclaimedTask") {
    return [{ _tag: "TaskClaimObserved", claimState: "Missing", taskId: observation.taskId }]
  }
  const expected = priorAcquiredClaimByTask.get(observation.taskId)
  const exact =
    expected !== undefined &&
    expected.operationId === observation.operationId &&
    expected.owner === observation.owner &&
    expected.token === observation.token
  return [{ _tag: "TaskClaimObserved", claimState: exact ? "Exact" : "Foreign", taskId: observation.taskId }]
}

// eslint-disable-next-line complexity -- One closed event vocabulary is projected exhaustively into exact cassette evidence.
const protocolEvidenceFor = (
  event: JournalRecord["event"],
  plannedAttemptByGitOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>,
  priorAcquiredClaimByTask: ReadonlyMap<
    TaskId,
    Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
  >
): ReadonlyArray<ProtocolEvidence> => {
  if (event._tag === "ControlDirectionApplied") {
    return [
      {
        _tag: "ControlDirectionApplied",
        direction: event.direction,
        subject: event.subject._tag === "Run" ? { _tag: "Run" } : { _tag: "Task", taskId: event.subject.taskId }
      }
    ]
  }
  if (event._tag === "TaskClaimReacquisitionDirected") {
    return [{ _tag: "TaskClaimReacquisitionDirected", requestId: event.requestId, taskId: event.subject.taskId }]
  }
  if (event._tag === "TaskClaimAcquired") return [{ _tag: "TaskClaimAcquired", taskId: event.claim.taskId }]
  if (event._tag === "TaskClaimReleased") return [{ _tag: "TaskClaimReleased", taskId: event.release.claim.taskId }]
  if (event._tag === "PlannedAttemptWorktreeObserved" && event.observation._tag === "AttemptWorktreeLost") {
    return [
      {
        _tag: "AttemptWorktreeLost",
        attemptId: event.observation.plannedAttempt.attemptId,
        taskId: event.observation.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "TargetLineageObserved") {
    if (
      event.observation.plannedBaseIsAncestorOfTargetHead &&
      event.observation.plannedBaseSha === event.observation.targetHeadSha
    ) {
      return []
    }
    return [
      {
        _tag: event.observation.plannedBaseIsAncestorOfTargetHead
          ? "CompatibleTargetAdvance"
          : "IncompatibleTargetRewrite",
        plannedBaseSha: event.observation.plannedBaseSha,
        targetHeadSha: event.observation.targetHeadSha,
        taskId: event.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "TaskTrackerFactsObserved") return claimObservationEvidence(event, priorAcquiredClaimByTask)
  if (event._tag === "TaskAttemptPlanned") {
    return [
      {
        _tag: "TaskAttemptPlanned",
        attemptId: event.operation.plannedAttempt.attemptId,
        taskId: event.operation.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "TaskWorktreeReady") return [worktreeEvidence(event, plannedAttemptByGitOperation)]
  return []
}

const orchestrationEvidenceFor = (event: JournalRecord["event"]): ReadonlyArray<OrchestrationEvidence> => {
  if (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") {
    return [
      {
        _tag:
          event._tag === "IntegrationResponsibilityBegan"
            ? "AcceptedResultIntegrationResponsibilityBegan"
            : "AcceptedResultIntegrationStarted",
        attemptId: event.plannedAttempt.attemptId,
        commit: event.acceptedResult.commit,
        integrationTarget: event.integrationTarget,
        taskId: event.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return [
      {
        _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
        attemptId: event.plannedAttempt.attemptId,
        taskId: event.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "PlannedAttemptExecutorWorkReported") {
    return [orchestrationReportEvidence(event.report)]
  }
  return []
}

const taskWorkResultFor = (
  event: JournalRecord["event"],
  taskByAttempt: ReadonlyMap<AttemptId, TaskId>
): ReadonlyArray<TaskWorkResult> => {
  if (event._tag !== "PlannedAttemptExecutorWorkReported" || event.report._tag !== "Terminal") return []
  const taskId = Option.getOrThrow(Option.fromUndefinedOr(taskByAttempt.get(event.report.correlation.attemptId)))
  return [
    event.report.result._tag === "Accepted"
      ? { _tag: "PlannedWorkForTaskAccepted", commit: event.report.result.acceptedResult.commit, taskId }
      : event.report.result._tag === "Completed"
        ? { _tag: "PlannedWorkForTaskCompleted", taskId }
        : { _tag: "PlannedWorkForTaskFailed", taskId }
  ]
}

const completeObservedBehavior = (records: ReadonlyArray<JournalRecord>): CompleteAuthoredObservedBehavior => {
  const plannedAttemptByGitOperation = new Map(
    records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended"
        ? [[event.operation.operationId, event.operation.plannedAttempt] as const]
        : event._tag === "GitReadIntentRecorded"
          ? [[event.operation.operationId, event.operation.plannedAttempt] as const]
          : []
    )
  )
  const taskByAttempt = new Map(
    records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned"
        ? [[event.operation.plannedAttempt.attemptId, event.operation.plannedAttempt.taskId] as const]
        : []
    )
  )
  const plannedWorkUndertakenFor = [
    ...new Set(
      records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt.taskId] : []
      )
    )
  ]
  return {
    orchestrationEvidence: records.flatMap(({ event }) => orchestrationEvidenceFor(event)),
    plannedWorkUndertakenFor,
    protocolEvidence: records.flatMap(({ event }, index) => {
      const priorAcquiredClaimByTask = new Map(
        records
          .slice(0, index)
          .flatMap(({ event: prior }) =>
            prior._tag === "TaskClaimAcquired" ? [[prior.claim.taskId, prior.claim] as const] : []
          )
      )
      return protocolEvidenceFor(event, plannedAttemptByGitOperation, priorAcquiredClaimByTask)
    }),
    taskWorkResults: records.flatMap(({ event }) => taskWorkResultFor(event, taskByAttempt))
  }
}

const encodedArray = <A>(schema: Schema.Codec<A, unknown, never, never>, values: ReadonlyArray<A>): string =>
  JSON.stringify(Schema.encodeUnknownSync(Schema.Array(schema))(values))

const behaviorMatches = (expected: AuthoredExpectedBehavior, actual: AuthoredObservedBehavior): boolean =>
  encodedArray(AuthoredTaskWorkResult, expected.taskWork.results) ===
    encodedArray(AuthoredTaskWorkResult, actual.taskWorkResults) &&
  expected.taskWork.absences.every(({ taskId }) => !actual.plannedWorkUndertakenFor.includes(taskId)) &&
  (expected.orchestration === null ||
    (actual.orchestrationEvidence !== null &&
      encodedArray(AuthoredOrchestrationEvidence, expected.orchestration) ===
        encodedArray(AuthoredOrchestrationEvidence, actual.orchestrationEvidence))) &&
  (expected.protocol === null ||
    (actual.protocolEvidence !== null &&
      encodedArray(AuthoredProtocolEvidence, expected.protocol) ===
        encodedArray(AuthoredProtocolEvidence, actual.protocolEvidence)))

const selectObservedBehavior = (
  expected: AuthoredExpectedBehavior,
  complete: CompleteAuthoredObservedBehavior
): AuthoredObservedBehavior => ({
  orchestrationEvidence: expected.orchestration === null ? null : complete.orchestrationEvidence,
  plannedWorkUndertakenFor: complete.plannedWorkUndertakenFor,
  protocolEvidence: expected.protocol === null ? null : complete.protocolEvidence,
  taskWorkResults: complete.taskWorkResults
})

export const assertAuthoredExpectedBehavior = Effect.fn("AuthoredCassette.assertExpectedBehavior")(function* (
  records: ReadonlyArray<JournalRecord>,
  assertions: Extract<AuthoredCassetteStoryItem, { readonly _tag: "ExpectedBehavior" }>
) {
  const expected = AuthoredExpectedBehavior.make({
    orchestration: assertions.orchestration,
    protocol: assertions.protocol,
    taskWork: assertions.taskWork
  })
  const actual = selectObservedBehavior(expected, completeObservedBehavior(records))
  if (!behaviorMatches(expected, actual)) {
    return yield* new AuthoredCassetteBehaviorMismatch({ actual, expected })
  }
  return actual
})
