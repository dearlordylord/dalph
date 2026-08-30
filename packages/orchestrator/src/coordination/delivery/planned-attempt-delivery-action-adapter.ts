import { plannedAttemptExecutorCorrelation, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Effect } from "effect"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { authorizedClaimForAttempt } from "../run/recovery-authority.js"
import {
  CancelledAttemptClaimNoReleaseObservedEvent,
  CancelledAttemptImplementationResponsibilityRelinquishedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  cancelledAttemptClaimNoReleaseRecordKey,
  cancelledAttemptImplementationResponsibilityRelinquishedRecordKey
} from "../../workflow-journal/record-key.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import {
  latestPlannedAttemptExecutorEvidence,
  type PlannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import type { AttemptQuiescenceProof } from "../../workflow/protocols/attempt-choice/events.js"
import {
  observePlannedAttemptExecutorStateResultWithPermit,
  reconcileOrObservePlannedAttemptExecutorStateResultWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  beginPlannedAttemptExecutorWorkWithPermit,
  resumePlannedAttemptExecutorWorkWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/suspension-commands.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { authorizePlannedAttemptContinuationWithPermit } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import {
  advanceAttemptStoppageWithPermit,
  observeAttemptStoppageExecutorWithPermit,
  recordStoppedAttemptClaimNoRelease
} from "../../workflow/protocols/attempt-choice/stop.js"
import { advanceAttemptRestartWithPermit } from "../../workflow/protocols/attempt-choice/restart.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { IdentityFreeWorkflowRoute, IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type PlannedAttemptTransition = Extract<
  IdentityFreeWorkflowTransition,
  {
    readonly _tag:
      | "ObservePlannedAttemptExecutorWork"
      | "AdvanceAttemptRestart"
      | "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
      | "AdvanceAttemptStoppage"
      | "ObserveAttemptStoppageExecutor"
      | "ReconcilePlannedAttemptExecutorWork"
      | "RecordStoppedAttemptClaimNoRelease"
      | "RelinquishCancelledAttemptImplementation"
      | "RecordCancelledAttemptClaimNoRelease"
      | "SuspendPlannedAttemptExecutorWork"
  }
>

type AttemptStoppageTransition = Extract<
  PlannedAttemptTransition,
  { readonly _tag: "AdvanceAttemptStoppage" | "ObserveAttemptStoppageExecutor" }
>

type AttemptRestartTransition = Extract<PlannedAttemptTransition, { readonly _tag: "AdvanceAttemptRestart" }>
type NonRestartPlannedAttemptTransition = Exclude<PlannedAttemptTransition, AttemptRestartTransition>

const quiescenceProofMatchesEvidence = (
  proof: AttemptQuiescenceProof,
  evidence: PlannedAttemptExecutorEvidence
): boolean => {
  return evidence.source._tag === "AcceptedReport" && evidence.source.ordinal === proof.reportOrdinal
}

type CancelledAttemptRelinquishmentTransition = Extract<
  PlannedAttemptTransition,
  { readonly _tag: "RelinquishCancelledAttemptImplementation" }
>

const cancelledAttemptRelinquishmentIsQuiescent = (
  records: ReadonlyArray<JournalRecord>,
  transition: CancelledAttemptRelinquishmentTransition,
  evidence: PlannedAttemptExecutorEvidence | undefined
): boolean =>
  evidence !== undefined &&
  (evidence.report._tag === "ExecutorWorkSafelySuspended" || evidence.report._tag === "ExecutorWorkTerminal") &&
  !records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, transition.plannedAttempt)
  ) &&
  quiescenceProofMatchesEvidence(transition.proof, evidence)

const cancelledAttemptRelinquishmentContext = (
  records: ReadonlyArray<JournalRecord>,
  transition: CancelledAttemptRelinquishmentTransition
) => {
  if (
    records.some(
      ({ event }) =>
        event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, transition.plannedAttempt)
    )
  )
    return undefined
  const cancellation = records.findLast(({ event }) => event._tag === "RunCancellationApplied")
  const authorizedClaim = authorizedClaimForAttempt(records, transition.plannedAttempt)?.claim
  if (cancellation === undefined || authorizedClaim === undefined) return undefined
  const evidence = latestPlannedAttemptExecutorEvidence(records, transition.plannedAttempt)
  if (!cancelledAttemptRelinquishmentIsQuiescent(records, transition, evidence)) return undefined
  return { authorizedClaim, cancellation }
}

const executeCancelledAttemptRelinquishment = Effect.fn("DeliveryAction.executeCancelledAttemptRelinquishment")(
  function* (transition: CancelledAttemptRelinquishmentTransition) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(transition.plannedAttempt.runId)
    const context = cancelledAttemptRelinquishmentContext(records, transition)
    if (context === undefined) return
    yield* journal.append(
      transition.plannedAttempt.runId,
      cancelledAttemptImplementationResponsibilityRelinquishedRecordKey(transition.plannedAttempt.attemptId),
      CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
        authorizedClaim: context.authorizedClaim,
        cancellationAppliedAt: context.cancellation.position,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: transition.plannedAttempt,
        proof: transition.proof,
        version: workflowJournalEventVersion
      })
    )
  }
)

type FocusedClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
      { readonly _tag: "FocusedTaskClaimFacts" }
    >
  }
}

type CancelledAttemptRelinquishedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<
    JournalRecord["event"],
    { readonly _tag: "CancelledAttemptImplementationResponsibilityRelinquished" }
  >
}

type CancelledAttemptClaimNoReleaseTransition = Extract<
  PlannedAttemptTransition,
  { readonly _tag: "RecordCancelledAttemptClaimNoRelease" }
>

const hasMatchingCancelledAttemptClaimRead = (
  observation: FocusedClaimObservationRecord,
  readIntent: JournalRecord | undefined,
  transition: CancelledAttemptClaimNoReleaseTransition,
  relinquished: CancelledAttemptRelinquishedRecord
): boolean => {
  if (readIntent?.event._tag !== "TaskTrackerReadIntentRecorded") return false
  if (readIntent.event.operation._tag !== "ReadTaskClaim") return false
  return (
    readIntent.event.operation.taskId === transition.plannedAttempt.taskId &&
    readIntent.event.operation.predecessorOperationIds.includes(relinquished.event.authorizedClaim.operationId) &&
    taskTrackerObservationMatchesRead(observation.event.observation, readIntent.event.operation)
  )
}

const cancelledAttemptClaimNoReleaseFacts = (
  records: ReadonlyArray<JournalRecord>,
  transition: CancelledAttemptClaimNoReleaseTransition
) => {
  if (
    records.some(
      ({ event }) =>
        event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, transition.plannedAttempt)
    )
  )
    return undefined
  const relinquished = records.findLast(
    (record): record is CancelledAttemptRelinquishedRecord =>
      record.event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, transition.plannedAttempt)
  )
  if (relinquished === undefined) return undefined
  const observation = records.findLast(
    (record): record is FocusedClaimObservationRecord =>
      record.position > relinquished.position &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === transition.observationOperationId &&
      record.event.observation._tag === "FocusedTaskClaimFacts" &&
      record.event.observation.coverage.taskId === transition.plannedAttempt.taskId
  )
  if (observation === undefined) return undefined
  const readIntent = records.findLast(
    (record) =>
      record.position > relinquished.position &&
      record.position < observation.position &&
      record.event._tag === "TaskTrackerReadIntentRecorded" &&
      record.event.operation.operationId === observation.event.operationId
  )
  if (!hasMatchingCancelledAttemptClaimRead(observation, readIntent, transition, relinquished)) return undefined
  if (
    observation.event.observation.observation._tag === "ActiveTaskClaim" &&
    isExactTaskClaim(observation.event.observation.observation, relinquished.event.authorizedClaim)
  )
    return undefined
  return { observation, relinquished }
}

const executeCancelledAttemptClaimNoRelease = Effect.fn("DeliveryAction.executeCancelledAttemptClaimNoRelease")(
  function* (transition: CancelledAttemptClaimNoReleaseTransition) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(transition.plannedAttempt.runId)
    const facts = cancelledAttemptClaimNoReleaseFacts(records, transition)
    if (facts === undefined) return
    yield* journal.append(
      transition.plannedAttempt.runId,
      cancelledAttemptClaimNoReleaseRecordKey(transition.plannedAttempt.attemptId),
      CancelledAttemptClaimNoReleaseObservedEvent.make({
        cancellationAppliedAt: facts.relinquished.event.cancellationAppliedAt,
        expectedClaim: facts.relinquished.event.authorizedClaim,
        observation: facts.observation.event.observation.observation,
        observationOperationId: facts.observation.event.operationId,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt: transition.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  }
)

const executeAttemptStoppageTransition = Effect.fn("DeliveryAction.executeAttemptStoppageTransition")(function* (
  transition: AttemptStoppageTransition,
  lease: DeliveryActionExecutionLease
) {
  const correlation = plannedAttemptExecutorCorrelation(transition.subject.plannedAttempt)
  const result = yield* transition._tag === "AdvanceAttemptStoppage"
    ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
        advanceAttemptStoppageWithPermit(permit, transition.requestId, transition.subject)
      )
    : lease.withPlannedAttemptProtocol(correlation, (permit) =>
        observeAttemptStoppageExecutorWithPermit(permit, transition.requestId, transition.subject)
      )
  const taskWorkPositionWasRequired =
    transition._tag === "ObserveAttemptStoppageExecutor" || transition.taskWorkPosition === "ReserveOrReuse"
  if (taskWorkPositionWasRequired && result._tag === "AttemptImplementationAbandoned") {
    yield* lease.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(transition.subject.plannedAttempt))
  }
})

type ExecutorTransition = Exclude<
  NonRestartPlannedAttemptTransition,
  | AttemptStoppageTransition
  | Extract<NonRestartPlannedAttemptTransition, { readonly _tag: "RecordStoppedAttemptClaimNoRelease" }>
>

export const executeAttemptRestartTransition = Effect.fn("DeliveryAction.executeAttemptRestartTransition")(function* (
  action: IdentityFreeAction,
  transition: AttemptRestartTransition,
  lease: DeliveryActionExecutionLease
) {
  yield* lease.withPlannedAttemptProtocol(plannedAttemptExecutorCorrelation(transition.plannedAttempt), (permit) =>
    advanceAttemptRestartWithPermit(permit, transition.requestId, transition.subject, transition.integrationTarget)
  )
  return deliveryActionCompleted(action.proposal.id)
})

const executorReportFor = (
  transition: ExecutorTransition,
  correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>,
  lease: DeliveryActionExecutionLease
) =>
  transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
    ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
        authorizePlannedAttemptContinuationWithPermit(permit, transition.plannedAttempt, transition.witness).pipe(
          Effect.andThen(resumePlannedAttemptExecutorWorkWithPermit(permit, transition.plannedAttempt)),
          Effect.map((report) => ({ acceptedFacts: "Changed" as const, report }))
        )
      )
    : transition._tag === "ObservePlannedAttemptExecutorWork"
      ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
          observePlannedAttemptExecutorStateResultWithPermit(permit, transition.plannedAttempt)
        )
      : transition._tag === "ReconcilePlannedAttemptExecutorWork"
        ? lease.withPlannedAttemptProtocol(correlation, (permit) =>
            reconcileOrObservePlannedAttemptExecutorStateResultWithPermit(permit, transition.plannedAttempt)
          )
        : lease.withPlannedAttemptProtocol(correlation, (permit) =>
            requestPlannedAttemptExecutorSuspensionWithPermit(permit, transition.plannedAttempt).pipe(
              Effect.map((report) => ({ acceptedFacts: "Changed" as const, report }))
            )
          )

const executeExecutorTransition = Effect.fn("DeliveryAction.executeExecutorTransition")(function* (
  transition: ExecutorTransition,
  lease: DeliveryActionExecutionLease
) {
  const correlation = plannedAttemptExecutorCorrelation(transition.plannedAttempt)
  if (transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts") {
    yield* lease.bindPlannedAttemptPosition(correlation)
  }
  const result = yield* executorReportFor(transition, correlation, lease)
  const report = result.report
  if (report._tag === "ExecutorWorkSafelySuspended" || report._tag === "ExecutorWorkTerminal") {
    yield* lease.releasePlannedAttemptPosition(correlation)
  }
  return result
})

export const executeFreshPlannedAttempt = Effect.fn("DeliveryAction.executeFreshPlannedAttempt")(function* (
  action: IdentityFreeAction,
  route: Extract<IdentityFreeWorkflowRoute, { readonly _tag: "FreshExecutorWorkflowRoute" }>,
  lease: DeliveryActionExecutionLease
) {
  const plannedAttempt = route.step.plannedAttempt
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  yield* lease.bindPlannedAttemptPosition(correlation)
  const result = yield* lease.withPlannedAttemptProtocol(correlation, (permit) =>
    Effect.gen(function* () {
      return route.step._tag === "BeginPlannedAttemptExecutorWork"
        ? {
            acceptedFacts: "Changed" as const,
            report: yield* beginPlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt, route.step.specification)
          }
        : yield* observePlannedAttemptExecutorStateResultWithPermit(permit, plannedAttempt)
    })
  )
  const report = result.report
  if (report._tag === "ExecutorWorkSafelySuspended" || report._tag === "ExecutorWorkTerminal") {
    yield* lease.releasePlannedAttemptPosition(correlation)
  }
  return {
    _tag: "ExecutorReportPublished" as const,
    acceptedFacts: result.acceptedFacts,
    plannedAttempt,
    proposalId: action.proposal.id,
    report
  }
})

export const executePlannedAttemptTransition = Effect.fn("DeliveryAction.executePlannedAttemptTransition")(function* (
  action: IdentityFreeAction,
  transition: NonRestartPlannedAttemptTransition,
  lease: DeliveryActionExecutionLease
) {
  if (transition._tag === "AdvanceAttemptStoppage" || transition._tag === "ObserveAttemptStoppageExecutor") {
    yield* executeAttemptStoppageTransition(transition, lease)
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "RecordStoppedAttemptClaimNoRelease") {
    yield* recordStoppedAttemptClaimNoRelease(
      transition.requestId,
      transition.subject,
      transition.observationOperationId
    )
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "RelinquishCancelledAttemptImplementation") {
    yield* lease.withPlannedAttemptProtocol(plannedAttemptExecutorCorrelation(transition.plannedAttempt), () =>
      executeCancelledAttemptRelinquishment(transition)
    )
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "RecordCancelledAttemptClaimNoRelease") {
    yield* executeCancelledAttemptClaimNoRelease(transition)
    return deliveryActionCompleted(action.proposal.id)
  }
  const result = yield* executeExecutorTransition(transition, lease).pipe(
    Effect.map((result) => ({ _tag: "ExecutorReport" as const, result })),
    Effect.catchTag("PlannedAttemptContinuationAuthorizationRejected", (rejection) =>
      rejection.reason === "StaleWitness"
        ? Effect.succeed({ _tag: "ContinuationAuthorizationStale" as const })
        : Effect.fail(rejection)
    )
  )
  if (result._tag === "ContinuationAuthorizationStale") {
    return deliveryActionDeferred(action.proposal.id, "ContinuationAuthorizationStale")
  }
  return {
    _tag: "ExecutorReportPublished" as const,
    acceptedFacts: result.result.acceptedFacts,
    plannedAttempt: transition.plannedAttempt,
    proposalId: action.proposal.id,
    report: result.result.report
  }
})
