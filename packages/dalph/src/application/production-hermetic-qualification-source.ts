import type { EvidenceDigest, RunId } from "@dalph/contracts"
import {
  ApplicationExitResult,
  completionOriginalTaskClaimReleaseFor,
  completionTaskRequestFor,
  type CompletionTaskClaim,
  deliveryStatusOf,
  DeliveryStatusSubject,
  FocusedTaskCompletionFactsObserved,
  JournaledRunTermination,
  PlannedTaskAttemptOrdinal,
  ProductionRunSelection,
  QueuedIntegrationResponsibility,
  type TraceAtCursor,
  TrackerTarget,
  WorkflowResponsibilityEntry,
  type CurrentDeliveryStatus,
  type DeliveryActionProposal,
  type DeliveryRuntimeObservationState,
  type DeliveryStatusEntry
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { validateHermeticQualificationHistoricalSource } from "./production-hermetic-qualification-history.js"
import {
  applicationExitDispositionRecord,
  currentDeliveryStatusRecord,
  productionCliFailureRecord,
  ProductionCliDeliveryError,
  runDispositionRecord,
  type ProductionCliRecord
} from "./production-cli.js"
import { hermeticCanonicalRecordDigest } from "./production-hermetic-provider-bridge.js"
import type { HermeticFixtureManifest } from "./production-hermetic-contract.js"
import {
  deriveProductionPlannedAttemptLocations,
  type ProductionRepositoryHostConfiguration
} from "./production-configuration.js"

import {
  sourceRejected,
  strictSource,
  validateOperationId,
  validateWorkflowOperationId,
  validatePlannedAttempt,
  validateTarget,
  contextFor,
  type HermeticQualificationSourceRejected,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import {
  validateResponsibility,
  validateCompletionClaim,
  validateCompletionRequest,
  validateGraph
} from "./production-hermetic-qualification-fixture-source.js"

import { validateProposal } from "./production-hermetic-qualification-proposal-source.js"

const validatedRecordTypeId: unique symbol = Symbol("HermeticValidatedRecord")
/** One canonical record digest constructed only after this module checks its original source atoms. */
export interface ValidatedHermeticRecordToken {
  readonly [validatedRecordTypeId]: typeof validatedRecordTypeId
  readonly digest: EvidenceDigest
}
const validatedRecordToken = (
  record: ProductionCliRecord
): Effect.Effect<ValidatedHermeticRecordToken, HermeticQualificationSourceRejected> =>
  Effect.try({
    try: (): ValidatedHermeticRecordToken => ({
      [validatedRecordTypeId]: validatedRecordTypeId,
      digest: hermeticCanonicalRecordDigest(record)
    }),
    catch: sourceRejected
  })

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

const completionClaimOfProposal = (proposal: DeliveryActionProposal): CompletionTaskClaim | null => {
  if (proposal.route._tag !== "IdentityFreeWorkflowRoute") return null
  const transition = proposal.route.transition
  if (
    transition._tag === "ReplacePromotedTaskClaim" ||
    transition._tag === "CompletePromotedTask" ||
    transition._tag === "ObserveFocusedTaskCompletion" ||
    transition._tag === "DeleteCompletedTaskCompletionClaim"
  )
    return transition.request.claim
  return null
}

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
      if (!Schema.toEquivalence(TrackerTarget)(original.target, context.configuration.target))
        return yield* sourceRejected()
      return [original.operationId]
    })
  ).pipe(Effect.map((ids) => ids.flat()))
})

export const validateHermeticQualificationStatus = Effect.fn("HermeticQualification.validateStatus")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  state: DeliveryRuntimeObservationState,
  selectedRunId: RunId
): Effect.fn.Return<
  { readonly status: CurrentDeliveryStatus; readonly registration: ValidatedHermeticRecordToken },
  HermeticQualificationSourceRejected
> {
  const context = yield* contextFor(manifest, configuration, selectedRunId)
  const ready = state._tag === "Ready" ? state : state._tag === "Closed" ? state.final : null
  if (ready !== null && ready.evaluation.current.runId !== selectedRunId) return yield* sourceRejected()
  if (ready !== null && ready.evaluation.current.trackerGraph._tag === "GraphEstablished") {
    const observation = ready.evaluation.current.trackerGraph.observation
    yield* validateGraph(observation.snapshot.toWire(), context)
    yield* validateOperationId(observation.operationId)
    yield* validateOperationId(observation.freshness.operationId)
    if (observation.contentIdentity !== observation.snapshot.revision) return yield* sourceRejected()
  }
  const focusedOperationIds = ready === null ? [] : yield* focusedCompletionOperationIds(ready, context)
  const status = yield* Effect.try({
    try: () => deliveryStatusOf(DeliveryStatusSubject.cases.Run.make({ runId: selectedRunId }), state),
    catch: sourceRejected
  })
  if (
    status._tag !== "DeliveryStatusNotReady" &&
    status._tag !== "DeliveryStatusAvailable" &&
    status._tag !== "DeliveryStatusClosed" &&
    status._tag !== "TaskAbsentFromCurrentGraph"
  )
    return yield* sourceRejected()
  const snapshot = status._tag === "DeliveryStatusClosed" ? status.final : status
  if (snapshot?._tag === "DeliveryStatusAvailable") {
    const focusedContext = { ...context, derivedOperationIds: focusedOperationIds }
    const releaseIds = yield* completionReleaseOperationIds(snapshot.entries, focusedContext)
    yield* Effect.forEach(snapshot.entries, (entry) =>
      validateEntry(entry, { ...context, derivedOperationIds: [...focusedOperationIds, ...releaseIds] })
    )
  }
  if (snapshot?._tag === "TaskAbsentFromCurrentGraph") return yield* sourceRejected()
  return { status, registration: yield* validatedRecordToken(currentDeliveryStatusRecord(status)) }
})

/** Checks the original mapped throttle evidence before the ordinary CLI emits its literal failure record. */
export const validateHermeticQualificationDeliveryFailure = Effect.fn("HermeticQualification.validateDeliveryFailure")(
  function* (
    manifest: HermeticFixtureManifest,
    configuration: ProductionRepositoryHostConfiguration,
    failure: ProductionCliDeliveryError,
    selectedRunId: RunId,
    state: DeliveryRuntimeObservationState
  ): Effect.fn.Return<
    { readonly error: ProductionCliDeliveryError; readonly registration: ValidatedHermeticRecordToken },
    HermeticQualificationSourceRejected
  > {
    const context = yield* contextFor(manifest, configuration, selectedRunId)
    const publicFailure = yield* Schema.decodeUnknownEffect(
      Schema.Struct(ProductionCliDeliveryError.fields),
      strictSource
    )({ _tag: failure._tag, code: failure.code, detail: failure.detail, subject: failure.subject }).pipe(
      Effect.mapError(sourceRejected)
    )
    const subject = publicFailure.subject
    if (subject.runId !== selectedRunId || subject.operation !== "CompleteTask") return yield* sourceRejected()
    const ready = state._tag === "Ready" ? state : state._tag === "Closed" ? state.final : null
    if (ready === null || ready.evaluation.current.runId !== selectedRunId) return yield* sourceRejected()
    const proposed =
      ready.evaluation.proposedActions._tag === "DeliveryProposalsAvailable"
        ? ready.evaluation.proposedActions.proposals
        : []
    const proposals = [...proposed, ...ready.liveOwners.map((owner) => owner.proposal)]
    const requests = yield* Effect.forEach(proposals, (proposal) =>
      Effect.gen(function* () {
        const claim = completionClaimOfProposal(proposal)
        if (claim === null) return null
        return completionTaskRequestFor(yield* validateCompletionClaim(claim, context))
      })
    )
    if (!requests.some((request) => request?.operationId === subject.operationId)) return yield* sourceRejected()
    return { error: failure, registration: yield* validatedRecordToken(productionCliFailureRecord(failure)) }
  }
)

/** The actual host selection is checked before the ordinary presenter publishes its RunSelected record. */
export const validateHermeticQualificationSelection = Effect.fn("HermeticQualification.validateSelection")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  selection: ProductionRunSelection
) {
  const original = yield* Schema.decodeUnknownEffect(
    ProductionRunSelection,
    strictSource
  )(selection).pipe(Effect.mapError(sourceRejected))
  yield* contextFor(manifest, configuration, original.runId)
  return {
    selection,
    registration: yield* validatedRecordToken({
      _tag: "RunSelected",
      runId: original.runId,
      selection: original._tag,
      version: 1
    })
  }
})

/** One real acknowledged terminal cursor supplies the disposition; status closure cannot create it. */
export const validateHermeticQualificationRunDisposition = Effect.fn("HermeticQualification.validateRunDisposition")(
  function* (
    manifest: HermeticFixtureManifest,
    configuration: ProductionRepositoryHostConfiguration,
    selectedRunId: RunId,
    termination: JournaledRunTermination
  ) {
    yield* contextFor(manifest, configuration, selectedRunId)
    const original = yield* Schema.decodeUnknownEffect(
      JournaledRunTermination,
      strictSource
    )(termination).pipe(Effect.mapError(sourceRejected))
    if (original.terminatedAt.runId !== selectedRunId) return yield* sourceRejected()
    return {
      termination,
      registration: yield* validatedRecordToken(runDispositionRecord(selectedRunId, original.disposition))
    }
  }
)

/** The ordinary Exit projector drops its private diagnostics, retaining only the closed result and status. */
export const validateHermeticQualificationApplicationExit = Effect.fn("HermeticQualification.validateApplicationExit")(
  function* (
    manifest: HermeticFixtureManifest,
    configuration: ProductionRepositoryHostConfiguration,
    selectedRunId: RunId,
    disposition: ApplicationExitResult
  ) {
    yield* contextFor(manifest, configuration, selectedRunId)
    const original = yield* Schema.decodeUnknownEffect(
      ApplicationExitResult,
      strictSource
    )(disposition).pipe(Effect.mapError(sourceRejected))
    return {
      disposition,
      registration: yield* validatedRecordToken(applicationExitDispositionRecord(selectedRunId, original))
    }
  }
)

/** Returns the same original history view after fixture-bound checks and construction of its exact publication token. */
export const validateHermeticQualificationHistory = Effect.fn("HermeticQualification.validateHistory")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration,
  snapshot: TraceAtCursor,
  selectedRunId: RunId
): Effect.fn.Return<
  { readonly snapshot: TraceAtCursor; readonly registration: ValidatedHermeticRecordToken },
  HermeticQualificationSourceRejected
> {
  const context = yield* contextFor(manifest, configuration, selectedRunId)
  yield* validateHermeticQualificationHistoricalSource(snapshot, context)
  return { snapshot, registration: yield* validatedRecordToken({ _tag: "HistoricalSnapshot", snapshot, version: 1 }) }
})
