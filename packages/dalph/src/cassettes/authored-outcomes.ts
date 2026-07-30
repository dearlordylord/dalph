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

const protocolEvidenceFor = (
  event: JournalRecord["event"],
  worktreeAttemptByOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>
): ReadonlyArray<ProtocolEvidence> => {
  if (event._tag === "TaskClaimAcquired") return [{ _tag: "TaskClaimAcquired", taskId: event.claim.taskId }]
  if (event._tag === "TaskClaimReleased") return [{ _tag: "TaskClaimReleased", taskId: event.release.claim.taskId }]
  if (event._tag === "TaskAttemptPlanned") {
    return [
      {
        _tag: "TaskAttemptPlanned",
        attemptId: event.operation.plannedAttempt.attemptId,
        taskId: event.operation.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "TaskWorktreeReady") return [worktreeEvidence(event, worktreeAttemptByOperation)]
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
  const worktreeAttemptByOperation = new Map(
    records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended"
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
    protocolEvidence: records.flatMap(({ event }) => protocolEvidenceFor(event, worktreeAttemptByOperation)),
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
