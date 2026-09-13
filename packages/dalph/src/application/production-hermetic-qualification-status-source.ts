import {
  type OperationId,
  type CurrentDeliveryStatus,
  type DeliveryRuntimeObservationState,
  type DeliveryStatusEntry,
  completionOriginalTaskClaimReleaseFor,
  deliveryStatusOf,
  DeliveryStatusSubject,
  FocusedTaskCompletionFactsObserved,
  PlannedTaskAttemptOrdinal,
  QueuedIntegrationResponsibility,
  TrackerTarget,
  WorkflowResponsibilityEntry
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { deriveProductionPlannedAttemptLocations } from "./production-configuration.js"
import {
  sourceRejected,
  strictSource,
  validateOperationId,
  validateWorkflowOperationId,
  validatePlannedAttempt,
  validateTarget,
  type HermeticQualificationSourceRejected,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import {
  validateResponsibility,
  validateCompletionClaim,
  validateCompletionRequest,
  validateCompletionFacts,
  validateGraph,
  completionClaimOfProposal
} from "./production-hermetic-qualification-fixture-source.js"
import { validateProposal } from "./production-hermetic-qualification-proposal-source.js"

/** The original final observation remains readable after closure; absence never supplies a replacement Ready value. */
export const readyObservationOf = (
  state: DeliveryRuntimeObservationState
): NonNullable<Extract<DeliveryRuntimeObservationState, { readonly _tag: "Closed" }>["final"]> | null =>
  state._tag === "Ready" ? state : state._tag === "Closed" ? state.final : null

const validateEntry = Effect.fn("HermeticQualification.validateEntry")(function* (
  entry: DeliveryStatusEntry,
  context: QualificationContext
) {
  yield* validateEntrySubject(entry, context)
  if (!isControlledEntry(entry)) return yield* sourceRejected()
  return yield* validateControlledEntry(entry, context)
})

type ControlledEntry = Extract<
  DeliveryStatusEntry,
  {
    readonly _tag:
      | "ProposedDeliveryAction"
      | "LiveDeliveryAction"
      | "AcceptedFactPublicationWait"
      | "TrackerFactWait"
      | "IntegrationTargetWait"
      | "EvidenceUnavailable"
      | "Settlement"
  }
>
const isControlledEntry = (entry: DeliveryStatusEntry): entry is ControlledEntry =>
  entry._tag === "ProposedDeliveryAction" ||
  entry._tag === "LiveDeliveryAction" ||
  entry._tag === "AcceptedFactPublicationWait" ||
  entry._tag === "TrackerFactWait" ||
  entry._tag === "IntegrationTargetWait" ||
  entry._tag === "EvidenceUnavailable" ||
  entry._tag === "Settlement"

const validateControlledEntry = Effect.fn("HermeticQualification.validateControlledEntry")(function* (
  entry: ControlledEntry,
  context: QualificationContext
) {
  switch (entry._tag) {
    case "ProposedDeliveryAction":
      return yield* validateProposal(entry.proposal, context)
    case "LiveDeliveryAction":
    case "AcceptedFactPublicationWait":
      return yield* validateOwnedEntry(entry, context)
    case "TrackerFactWait":
      return yield* validateTrackerWaitEntry(entry, context)
    case "IntegrationTargetWait":
      yield* validatePlannedAttempt(entry.plannedAttempt, context)
      yield* validateTarget(entry.integrationTarget, context)
      return yield* validateObligation(entry.responsibility, context)
    case "EvidenceUnavailable":
      return yield* validateUnavailableEntry(entry, context)
    case "Settlement":
      return yield* validateSettlementEntry(entry, context)
    default:
      return yield* sourceRejected()
  }
})

const validateEntrySubject = Effect.fn("HermeticQualification.validateEntrySubject")(function* (
  entry: DeliveryStatusEntry,
  context: QualificationContext
) {
  if (
    entry.subject.runId !== context.runId ||
    (entry.subject._tag === "Task" && entry.subject.taskId !== context.taskId)
  )
    return yield* sourceRejected()
})

const validateOwnedEntry = Effect.fn("HermeticQualification.validateOwnedEntry")(function* (
  entry: Extract<DeliveryStatusEntry, { readonly _tag: "LiveDeliveryAction" | "AcceptedFactPublicationWait" }>,
  context: QualificationContext
) {
  yield* validateProposal(entry.owner.proposal, context)
  if (entry.owner._tag === "MaterializedDeliveryAction" || entry.owner._tag === "SettledMaterializedDeliveryAction")
    yield* validateWorkflowOperationId(entry.owner.operationId, context)
})

const validateTrackerWaitEntry = Effect.fn("HermeticQualification.validateTrackerWaitEntry")(function* (
  entry: Extract<DeliveryStatusEntry, { readonly _tag: "TrackerFactWait" }>,
  context: QualificationContext
) {
  if (entry.responsibility !== null) yield* validateObligation(entry.responsibility, context)
})

const validateUnavailableEntry = Effect.fn("HermeticQualification.validateUnavailableEntry")(function* (
  entry: Extract<DeliveryStatusEntry, { readonly _tag: "EvidenceUnavailable" }>,
  context: QualificationContext
) {
  if (entry.responsibility !== null) yield* validateObligation(entry.responsibility, context)
  if (entry.evidence._tag === "ResponsibilityFacts")
    yield* validateWorkflowResponsibility(entry.evidence.facts.responsibility, context)
  else if (entry.evidence._tag === "ProposalDerivationIssue") {
    if (entry.evidence.issue.taskId !== context.taskId) return yield* sourceRejected()
    if (entry.evidence.issue._tag === "AcceptedOperationEvidenceMissing")
      yield* validateWorkflowOperationId(entry.evidence.issue.operationId, context)
  } else yield* validatePlannedAttempt(entry.evidence.wait.plannedAttempt, context)
})

const validateSettlementEntry = Effect.fn("HermeticQualification.validateSettlementEntry")(function* (
  entry: Extract<DeliveryStatusEntry, { readonly _tag: "Settlement" }>,
  context: QualificationContext
) {
  if (entry.settlement._tag !== "DeliverySettlement" || entry.settlement.taskId !== context.taskId)
    return yield* sourceRejected()
  const expected = deriveProductionPlannedAttemptLocations(
    context.configuration.plannedAttemptWorktreeRoot,
    context.runId,
    context.taskId,
    PlannedTaskAttemptOrdinal.make(0)
  )
  if (entry.settlement.attemptId !== expected.attemptId) return yield* sourceRejected()
})

const validateWorkflowResponsibility = Effect.fn("HermeticQualification.validateWorkflowResponsibility")(function* (
  responsibility: WorkflowResponsibilityEntry,
  context: QualificationContext
) {
  const decoded = yield* Schema.decodeUnknownEffect(
    WorkflowResponsibilityEntry,
    strictSource
  )(responsibility).pipe(Effect.mapError(sourceRejected))
  if (decoded._tag === "PlannedAttemptExecutorWorkResponsibility") {
    yield* validatePlannedAttempt(decoded.plannedAttempt, context)
    return
  }
  if (decoded.taskId !== context.taskId) return yield* sourceRejected()
  const operationId =
    decoded._tag === "TaskClaimResponsibility"
      ? decoded.acquisition.operationId
      : decoded._tag === "TaskClaimReleaseResponsibility"
        ? decoded.operation.release.operationId
        : decoded.operation.operationId
  yield* validateWorkflowOperationId(operationId, context)
})

type ExactObligation = NonNullable<Extract<DeliveryStatusEntry, { readonly _tag: "TrackerFactWait" }>["responsibility"]>
const validateObligation = Effect.fn("HermeticQualification.validateObligation")(function* (
  obligation: ExactObligation,
  context: QualificationContext
) {
  switch (obligation._tag) {
    case "WorkflowResponsibility":
      return yield* validateWorkflowResponsibility(obligation.responsibility, context)
    case "AcceptedAwaitingIntegration":
      yield* validatePlannedAttempt(obligation.accepted.plannedAttempt, context)
      return
    case "QueuedIntegration":
      yield* Schema.decodeUnknownEffect(
        QueuedIntegrationResponsibility,
        strictSource
      )(obligation.responsibility).pipe(Effect.mapError(sourceRejected))
      yield* validatePlannedAttempt(obligation.responsibility.plannedAttempt, context)
      return
    case "StartedIntegration":
      yield* validateResponsibility(obligation.responsibility, context)
      return
  }
})

const completionReleaseOperationIds = Effect.fn("HermeticQualification.completionReleaseOperationIds")(function* (
  entries: ReadonlyArray<DeliveryStatusEntry>,
  context: QualificationContext
) {
  return yield* Effect.forEach(entries, (entry) =>
    Effect.gen(function* () {
      const proposal =
        entry._tag === "ProposedDeliveryAction"
          ? entry.proposal
          : entry._tag === "LiveDeliveryAction" || entry._tag === "AcceptedFactPublicationWait"
            ? entry.owner.proposal
            : null
      const claim = proposal === null ? null : completionClaimOfProposal(proposal)
      if (claim === null) return []
      const validated = yield* validateCompletionClaim(claim, context)
      return [completionOriginalTaskClaimReleaseFor(validated).operationId]
    })
  ).pipe(Effect.map((ids) => ids.flat()))
})

const focusedCompletionOperationIds = Effect.fn("HermeticQualification.focusedCompletionOperationIds")(function* (
  ready: NonNullable<Extract<DeliveryRuntimeObservationState, { readonly _tag: "Closed" }>["final"]>,
  context: QualificationContext
) {
  const evidence = ready.evaluation.current.ticketDeliveries.deliveries.flatMap((delivery) => delivery.evidence)
  return yield* Effect.forEach(evidence, (item) =>
    Effect.gen(function* () {
      if (item._tag !== "FocusedTaskCompletionSuccess") return []
      // The existing compound invariant reconstructs the read ID from this actual request and typed purpose.
      const original = yield* Schema.decodeUnknownEffect(
        FocusedTaskCompletionFactsObserved,
        strictSource
      )(item.observed.observation).pipe(Effect.mapError(sourceRejected))
      yield* validateCompletionRequest(original.request, context)
      yield* validateCompletionFacts(original.facts, context)
      if (!Schema.toEquivalence(TrackerTarget)(original.target, context.configuration.target))
        return yield* sourceRejected()
      return [original.operationId]
    })
  ).pipe(Effect.map((ids) => ids.flat()))
})

const validateReadyGraph = Effect.fn("HermeticQualification.validateReadyGraph")(function* (
  ready: ReturnType<typeof readyObservationOf>,
  context: QualificationContext
) {
  if (ready !== null && ready.evaluation.current.runId !== context.runId) return yield* sourceRejected()
  if (ready !== null && ready.evaluation.current.trackerGraph._tag === "GraphEstablished") {
    const observation = ready.evaluation.current.trackerGraph.observation
    yield* validateGraph(observation.snapshot.toWire(), context)
    yield* validateOperationId(observation.operationId)
    yield* validateOperationId(observation.freshness.operationId)
    if (observation.contentIdentity !== observation.snapshot.revision) return yield* sourceRejected()
  }
})

const validateStatusTag = (
  status: ReturnType<typeof deliveryStatusOf>
): Effect.Effect<CurrentDeliveryStatus, HermeticQualificationSourceRejected> => {
  if (
    status._tag !== "DeliveryStatusNotReady" &&
    status._tag !== "DeliveryStatusAvailable" &&
    status._tag !== "DeliveryStatusClosed" &&
    status._tag !== "TaskAbsentFromCurrentGraph"
  )
    return Effect.fail(sourceRejected())
  return Effect.succeed(status)
}

const validateStatusSnapshot = Effect.fn("HermeticQualification.validateStatusSnapshot")(function* (
  status: CurrentDeliveryStatus,
  context: QualificationContext,
  focusedOperationIds: ReadonlyArray<OperationId>
) {
  const snapshot = status._tag === "DeliveryStatusClosed" ? status.final : status
  if (snapshot?._tag === "DeliveryStatusAvailable") {
    const focusedContext = { ...context, derivedOperationIds: focusedOperationIds }
    const releaseIds = yield* completionReleaseOperationIds(snapshot.entries, focusedContext)
    yield* Effect.forEach(snapshot.entries, (entry) =>
      validateEntry(entry, { ...context, derivedOperationIds: [...focusedOperationIds, ...releaseIds] })
    )
  }
  if (snapshot?._tag === "TaskAbsentFromCurrentGraph") return yield* sourceRejected()
})

/** Checks the original current source and projects it once, without granting publication registration. */
export const validateHermeticQualificationCurrentSource: (
  state: DeliveryRuntimeObservationState,
  context: QualificationContext
) => Effect.Effect<CurrentDeliveryStatus, HermeticQualificationSourceRejected> = Effect.fn(
  "HermeticQualification.validateCurrentSource"
)(function* (
  state: DeliveryRuntimeObservationState,
  context: QualificationContext
): Effect.fn.Return<CurrentDeliveryStatus, HermeticQualificationSourceRejected> {
  const ready = readyObservationOf(state)
  yield* validateReadyGraph(ready, context)
  const focusedOperationIds = ready === null ? [] : yield* focusedCompletionOperationIds(ready, context)
  const status = yield* Effect.try({
    try: () => deliveryStatusOf(DeliveryStatusSubject.cases.Run.make({ runId: context.runId }), state),
    catch: sourceRejected
  })
  const validatedStatus = yield* validateStatusTag(status)
  yield* validateStatusSnapshot(validatedStatus, context, focusedOperationIds)
  return validatedStatus
})
