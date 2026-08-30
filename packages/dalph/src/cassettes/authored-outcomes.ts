import { Effect, Match, Option, Schema } from "effect"
import { type AttemptId, type PlannedAttemptExecutorReport, type TaskId } from "@dalph/contracts"
import { type JournalRecord, targetPromotionExpectedHeadOf, targetPromotionPlannedAttemptOf } from "@dalph/orchestrator"
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
import { taskWorkResultFor } from "./authored-task-work-result.js"

export class AuthoredCassetteBehaviorMismatch extends Schema.TaggedError<AuthoredCassetteBehaviorMismatch>()(
  "AuthoredCassetteBehaviorMismatch",
  { actual: AuthoredObservedBehavior, expected: AuthoredExpectedBehavior }
) {}

interface CompleteAuthoredObservedBehavior {
  readonly orchestrationEvidence: ReadonlyArray<OrchestrationEvidence>
  readonly plannedWorkUndertakenFor: ReadonlyArray<TaskId>
  readonly protocolEvidence: ReadonlyArray<ProtocolEvidence>
  readonly taskWorkResults: ReadonlyArray<TaskWorkResult>
}

const authoredExecutorReportKind = (
  report: PlannedAttemptExecutorReport
):
  | "ExecutorWorkExecuting"
  | "ExecutorWorkSafelySuspended"
  | "ExecutorWorkTerminalAccepted"
  | "ExecutorWorkTerminalCompleted"
  | "ExecutorWorkTerminalFailed" =>
  report._tag === "ExecutorWorkTerminal"
    ? report.result._tag === "Accepted"
      ? "ExecutorWorkTerminalAccepted"
      : report.result._tag === "Completed"
        ? "ExecutorWorkTerminalCompleted"
        : "ExecutorWorkTerminalFailed"
    : report._tag === "ExecutorWorkExecuting"
      ? "ExecutorWorkExecuting"
      : "ExecutorWorkSafelySuspended"

const orchestrationReportEvidence = (
  report: PlannedAttemptExecutorReport
): Extract<OrchestrationEvidence, { readonly _tag: "PlannedAttemptExecutorWorkReported" }> => ({
  _tag: "PlannedAttemptExecutorWorkReported",
  attemptId: report.correlation.attemptId,
  report: authoredExecutorReportKind(report)
})

const orchestrationProjectionEvidence = (
  report: PlannedAttemptExecutorReport
): Extract<OrchestrationEvidence, { readonly _tag: "PlannedAttemptExecutorCommandProjectionObserved" }> => ({
  _tag: "PlannedAttemptExecutorCommandProjectionObserved",
  attemptId: report.correlation.attemptId,
  report: authoredExecutorReportKind(report)
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
  if (event._tag === "RunCancellationApplied") return [{ _tag: "RunCancellationApplied" }]
  if (event._tag === "AttemptChoiceApplied") {
    return [
      {
        _tag: "AttemptChoiceApplied",
        attemptId: event.subject.plannedAttempt.attemptId,
        choice: event.choice,
        observedTaskRevision: event.subject.observedTaskRevision,
        taskId: event.subject.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "AttemptImplementationAbandoned") {
    return [
      {
        _tag: "AttemptImplementationAbandoned",
        attemptId: event.subject.plannedAttempt.attemptId,
        taskId: event.subject.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "PlannedAttemptReplaced") {
    return [
      {
        _tag: "PlannedAttemptReplaced",
        priorAttemptId: event.subject.plannedAttempt.attemptId,
        successorAttemptId: event.successorPlan.plannedAttempt.attemptId,
        taskId: event.subject.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "StoppedAttemptClaimNoReleaseObserved") {
    return [
      {
        _tag: "StoppedAttemptClaimNoReleaseObserved",
        claimState: event.observation._tag === "UnclaimedTask" ? "Missing" : "Foreign",
        taskId: event.subject.plannedAttempt.taskId
      }
    ]
  }
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

type AuthoredExecutorEvidenceEvent = Extract<
  JournalRecord["event"],
  {
    readonly _tag:
      | "PlannedAttemptExecutorCommandProjectionObserved"
      | "PlannedAttemptExecutorWorkReported"
      | "PlannedAttemptExecutorWorkResponsibilityBegan"
  }
>

const isAuthoredExecutorEvidenceEvent = (event: JournalRecord["event"]): event is AuthoredExecutorEvidenceEvent =>
  event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
  event._tag === "PlannedAttemptExecutorWorkReported" ||
  event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"

const executorOrchestrationEvidenceFor = (event: AuthoredExecutorEvidenceEvent): ReadonlyArray<OrchestrationEvidence> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      PlannedAttemptExecutorWorkResponsibilityBegan: (event): ReadonlyArray<OrchestrationEvidence> => [
        {
          _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
          attemptId: event.plannedAttempt.attemptId,
          taskId: event.plannedAttempt.taskId
        }
      ],
      PlannedAttemptExecutorWorkReported: (event): ReadonlyArray<OrchestrationEvidence> => [
        orchestrationReportEvidence(event.report)
      ],
      PlannedAttemptExecutorCommandProjectionObserved: (event): ReadonlyArray<OrchestrationEvidence> =>
        event.observation._tag === "ExactExecutorReport"
          ? [orchestrationProjectionEvidence(event.observation.report)]
          : []
    })
  )

const orchestrationEvidenceFor = (
  event: JournalRecord["event"],
  taskByAttempt: ReadonlyMap<AttemptId, TaskId>
): ReadonlyArray<OrchestrationEvidence> => {
  if (isIntegrationLifecycleEvidenceEvent(event)) return [integrationLifecycleEvidenceFor(event)]
  if (isTargetPromotionEvidenceEvent(event)) return targetPromotionEvidenceFor(event, taskByAttempt)
  if (isAuthoredExecutorEvidenceEvent(event)) return executorOrchestrationEvidenceFor(event)
  return []
}

type IntegrationLifecycleEvidenceEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }
>

const isIntegrationLifecycleEvidenceEvent = (
  event: JournalRecord["event"]
): event is IntegrationLifecycleEvidenceEvent =>
  event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted"

const integrationLifecycleEvidenceFor = (event: IntegrationLifecycleEvidenceEvent): OrchestrationEvidence => ({
  _tag:
    event._tag === "IntegrationResponsibilityBegan"
      ? "AcceptedResultIntegrationResponsibilityBegan"
      : "AcceptedResultIntegrationStarted",
  attemptId: event.plannedAttempt.attemptId,
  commit: event.acceptedResult.commit,
  integrationTarget: event.integrationTarget,
  taskId: event.plannedAttempt.taskId
})

type TargetPromotionEvidenceEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "TargetPromotionObservedSuccess" | "TargetPromotionNonConvergence" | "TargetPromotionStale" }
>

const isTargetPromotionEvidenceEvent = (event: JournalRecord["event"]): event is TargetPromotionEvidenceEvent =>
  event._tag === "TargetPromotionObservedSuccess" ||
  event._tag === "TargetPromotionNonConvergence" ||
  event._tag === "TargetPromotionStale"

const targetPromotionEvidenceFor = (
  event: TargetPromotionEvidenceEvent,
  taskByAttempt: ReadonlyMap<AttemptId, TaskId>
): ReadonlyArray<OrchestrationEvidence> => {
  const plannedAttempt = targetPromotionPlannedAttemptOf(event.correlation)
  const taskId = Option.getOrThrow(Option.fromUndefinedOr(taskByAttempt.get(plannedAttempt.attemptId)))
  return Match.value(event).pipe(
    Match.tagsExhaustive({
      TargetPromotionObservedSuccess: (event): ReadonlyArray<OrchestrationEvidence> => [
        {
          _tag: "TargetPromotionSucceeded",
          basis: event.basis,
          candidateCommit: event.correlation.qualifiedCandidate.candidateCommit,
          expectedTargetHead: targetPromotionExpectedHeadOf(event.correlation),
          observedTargetHead: event.observation.targetHeadSha,
          observation: event.observation._tag,
          taskId
        }
      ],
      TargetPromotionNonConvergence: (event): ReadonlyArray<OrchestrationEvidence> => [
        {
          _tag: "TargetPromotionNonConvergent",
          attemptOrdinal: event.attemptOrdinal,
          candidateCommit: event.correlation.qualifiedCandidate.candidateCommit,
          lastObservation: event.lastObservation._tag,
          taskId
        }
      ],
      TargetPromotionStale: (event): ReadonlyArray<OrchestrationEvidence> => [
        {
          _tag: "TargetPromotionStale",
          basis: event.basis,
          candidateCommit: event.correlation.qualifiedCandidate.candidateCommit,
          expectedTargetHead: targetPromotionExpectedHeadOf(event.correlation),
          observedTargetHead: event.observation.observedHeadSha,
          observation: event.observation._tag,
          taskId
        }
      ]
    })
  )
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
        : event._tag === "PlannedAttemptReplaced"
          ? [[event.successorPlan.plannedAttempt.attemptId, event.successorPlan.plannedAttempt.taskId] as const]
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
    orchestrationEvidence: records.flatMap(({ event }) => orchestrationEvidenceFor(event, taskByAttempt)),
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
