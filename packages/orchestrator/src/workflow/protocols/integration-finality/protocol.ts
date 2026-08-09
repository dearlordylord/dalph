/* eslint-disable max-lines -- The complete claim replacement/deletion protocol stays adjacent for auditability. */
import { Effect, Schema } from "effect"
import {
  InRunJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import {
  completionClaimDeletionAttemptIntentRecordKey,
  completionClaimDeletionIntentRecordKey,
  completionClaimDeletedRecordKey,
  completionClaimReplacementAttemptIntentRecordKey,
  completionClaimReplacementIntentRecordKey,
  completionClaimReplacedRecordKey,
  integrationFinalitySettledRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimOwnershipConflict,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  type CompletionClaimReplacementFailure,
  type CompletionClaimDeletionFailure,
  CompletionClaimRequestLimit,
  CompletionClaimRequestOrdinal,
  completionClaimRequestLimit,
  CompletionTaskClaim,
  completionTaskClaimEquals,
  FreshCompletedTaskObservation,
  freshCompletedTaskObservationEquals,
  IntegrationFinalitySettledEvent,
  type CompletionClaimDeletionRequest,
  type CompletionClaimReplacementRequest,
  type CompletionClaimObservation,
  type CompletionClaimBoundaryService
} from "./events.js"
import { targetPromotionCorrelationEquals } from "../target-promotion/events.js"
import { OperationId } from "../../identity.js"
import { latestFreshCompletedTaskObservationFor } from "./state.js"

/** The offered claim is not the exact claim authorized by promotion history. */
export class CompletionClaimPremiseContradiction extends Schema.TaggedError<CompletionClaimPremiseContradiction>()(
  "IntegrationFinality.CompletionClaimPremiseContradiction",
  { claim: CompletionTaskClaim, detail: Schema.String }
) {}

/** Replacement requires durable proof that the exact candidate was promoted. */
export class CompletionClaimPromotionRequired extends Schema.TaggedError<CompletionClaimPromotionRequired>()(
  "IntegrationFinality.CompletionClaimPromotionRequired",
  { claim: CompletionTaskClaim }
) {}

/** Deletion requires a prior replacement outcome for this exact completion claim. */
export class CompletionClaimReplacementRequired extends Schema.TaggedError<CompletionClaimReplacementRequired>()(
  "IntegrationFinality.CompletionClaimReplacementRequired",
  { claim: CompletionTaskClaim }
) {}

/** Deletion requires the fresh tracker observation to be durably present. */
export class FreshTrackerSuccessRequired extends Schema.TaggedError<FreshTrackerSuccessRequired>()(
  "IntegrationFinality.FreshTrackerSuccessRequired",
  { claim: CompletionTaskClaim, observation: FreshCompletedTaskObservation }
) {}

/** Three exact requests did not establish the requested claim disposition. */
export class CompletionClaimDidNotConverge extends Schema.TaggedError<CompletionClaimDidNotConverge>()(
  "IntegrationFinality.CompletionClaimDidNotConverge",
  {
    attempts: Schema.Int,
    claim: CompletionTaskClaim,
    operationId: OperationId,
    phase: Schema.Literals(["Replacement", "Deletion"])
  }
) {}

/** The replacement result is a durable current exact completion claim. */
export const CompletionClaimReplacementResult = CompletionClaimReplacedEvent
export type CompletionClaimReplacementResult = typeof CompletionClaimReplacementResult.Type

/** The deletion result is a durable task-scoped integration settlement. */
export const IntegrationFinalityResult = IntegrationFinalitySettledEvent
export type IntegrationFinalityResult = typeof IntegrationFinalityResult.Type

const ordinalFor = (value: number): CompletionClaimRequestOrdinal => CompletionClaimRequestOrdinal.make(value)

const latestAttemptOrdinal = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  tag: "CompletionClaimReplacementAttemptIntended" | "CompletionClaimDeletionAttemptIntended"
): number =>
  records.reduce(
    (latest, record) =>
      record.event._tag === tag && record.event.operationId === operationId
        ? Math.max(latest, Number(record.event.attemptOrdinal))
        : latest,
    0
  )

const replacementIntent = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplacementIntended" }> | undefined =>
  records.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplacementIntended" }>
    } => record.event._tag === "CompletionClaimReplacementIntended" && record.event.operationId === operationId
  )?.event

const replacementOutcomeRecord = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
):
  | (JournalRecord & { readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplaced" }> })
  | undefined =>
  records.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplaced" }>
    } => record.event._tag === "CompletionClaimReplaced" && record.event.operationId === operationId
  )

const replacementOutcome = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplaced" }> | undefined =>
  replacementOutcomeRecord(records, operationId)?.event

const deletionIntent = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimDeletionIntended" }> | undefined =>
  records.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimDeletionIntended" }>
    } => record.event._tag === "CompletionClaimDeletionIntended" && record.event.operationId === operationId
  )?.event

const deletionOutcome = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimDeleted" }> | undefined =>
  records.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimDeleted" }>
    } => record.event._tag === "CompletionClaimDeleted" && record.event.operationId === operationId
  )?.event

const settlementOutcome = (
  records: ReadonlyArray<JournalRecord>,
  deletionOperationId: OperationId
): Extract<JournalRecord["event"], { readonly _tag: "IntegrationFinalitySettled" }> | undefined =>
  records.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationFinalitySettled" }>
    } => record.event._tag === "IntegrationFinalitySettled" && record.event.deletionOperationId === deletionOperationId
  )?.event

const append = Effect.fn("IntegrationFinality.appendEvent")(function* (
  runId: CompletionTaskClaim["plannedAttempt"]["runId"],
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: AppendableWorkflowJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(runId, key, event)
})

const exactPromotionWasObserved = (records: ReadonlyArray<JournalRecord>, claim: CompletionTaskClaim): boolean =>
  records.some(
    ({ event }) =>
      event._tag === "TargetPromotionObservedSuccess" &&
      targetPromotionCorrelationEquals(event.correlation, claim.promotionCorrelation)
  )

const freshSuccessWasObserved = (
  records: ReadonlyArray<JournalRecord>,
  observation: FreshCompletedTaskObservation,
  claim: CompletionTaskClaim,
  replacementOperationId: OperationId
): boolean => {
  /* v8 ignore next -- @preserve The request Schema already binds the success observation to this claim; retained for hostile decoded input. */
  if (observation.taskId !== claim.plannedAttempt.taskId) return false
  const replacement = replacementOutcomeRecord(records, replacementOperationId)
  /* v8 ignore next -- @preserve Delivery proposes deletion only from the exact reconstructed replacement outcome. */
  if (replacement === undefined || !completionTaskClaimEquals(replacement.event.claim, claim)) return false
  const candidate = latestFreshCompletedTaskObservationFor(
    records.filter((record) => record.position <= observation.observedAt),
    observation.taskId,
    replacement.position
  )
  return candidate !== undefined && freshCompletedTaskObservationEquals(candidate, observation)
}

const ensureReplacementIntent = Effect.fn("IntegrationFinality.ensureReplacementIntent")(function* (
  request: CompletionClaimReplacementRequest,
  records: ReadonlyArray<JournalRecord>
) {
  const existing = replacementIntent(records, request.operationId)
  /* v8 ignore start -- @preserve Accepted history binds a stable operation id to one immutable claim; this defends direct protocol replay over a hostile journal. */
  if (existing !== undefined) {
    if (!completionTaskClaimEquals(existing.claim, request.claim)) {
      return yield* new CompletionClaimPremiseContradiction({
        claim: request.claim,
        detail: "replacement operation was already bound to a different completion claim"
      })
    }
    return
  }
  /* v8 ignore stop */
  yield* append(
    request.claim.plannedAttempt.runId,
    completionClaimReplacementIntentRecordKey(request.operationId),
    CompletionClaimReplacementIntendedEvent.make({
      claim: request.claim,
      operationId: request.operationId,
      version: workflowJournalEventVersion
    })
  )
})

const isExactClaimForReplacement = (
  observed: Extract<CompletionClaimObservation, { readonly _tag: "ActiveTaskClaim" }>,
  claim: CompletionTaskClaim
): boolean =>
  [
    observed.taskId === claim.originalClaim.taskId,
    observed.operationId === claim.originalClaim.operationId,
    observed.owner === claim.originalClaim.owner,
    observed.token === claim.originalClaim.token
  ].every(Boolean)

const existingReplacementOutcome = Effect.fn("IntegrationFinality.existingReplacementOutcome")(function* (
  request: CompletionClaimReplacementRequest,
  records: ReadonlyArray<JournalRecord>
) {
  const existing = replacementOutcome(records, request.operationId)
  if (existing === undefined) return undefined
  /* v8 ignore start -- @preserve Accepted history makes a mismatched outcome for the same stable operation id unreachable from delivery. */
  if (completionTaskClaimEquals(existing.claim, request.claim)) return existing
  return yield* new CompletionClaimPremiseContradiction({
    claim: request.claim,
    detail: "replacement outcome was recorded for a different completion claim"
  })
  /* v8 ignore stop */
})

const appendReplacementOutcome = Effect.fn("IntegrationFinality.appendReplacementOutcome")(function* (
  request: CompletionClaimReplacementRequest,
  response: CompletionTaskClaim
) {
  /* v8 ignore start -- @preserve A configured boundary is required to return the exact claim it was asked to install; the branch fails closed on a provider contract violation. */
  if (!completionTaskClaimEquals(response, request.claim)) {
    return yield* new CompletionClaimPremiseContradiction({
      claim: request.claim,
      detail: "replacement boundary returned a different completion claim"
    })
  }
  /* v8 ignore stop */
  yield* append(
    request.claim.plannedAttempt.runId,
    completionClaimReplacedRecordKey(request.operationId),
    CompletionClaimReplacedEvent.make({
      claim: request.claim,
      operationId: request.operationId,
      version: workflowJournalEventVersion
    })
  )
  return CompletionClaimReplacementResult.make({
    claim: request.claim,
    operationId: request.operationId,
    version: workflowJournalEventVersion
  })
})

const replacementFailureResult = Effect.fn("IntegrationFinality.replacementFailureResult")(function* (
  failure: CompletionClaimReplacementFailure
) {
  /* v8 ignore next -- @preserve Maintained cassettes cover ambiguous loss; this exact typed provider rejection is terminal and performs no retry. */
  if (failure.outcome === "DefinitelyNotApplied") return yield* failure
  return undefined
})

const runReplacementAttempt = Effect.fn("IntegrationFinality.runReplacementAttempt")(function* (
  tracker: CompletionClaimBoundaryService,
  request: CompletionClaimReplacementRequest,
  attemptOrdinal: CompletionClaimRequestOrdinal
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(request.claim.plannedAttempt.runId)
  const priorOutcome = yield* existingReplacementOutcome(request, records)
  /* v8 ignore next -- @preserve The serialized action owner cannot publish an outcome concurrently with its own attempt; restart returns before entering this helper. */
  if (priorOutcome !== undefined) return priorOutcome
  const observed = yield* tracker.readTaskClaim(request.claim.plannedAttempt.taskId)
  if (observed._tag === "CompletionTaskClaim") {
    if (!completionTaskClaimEquals(observed, request.claim)) {
      return yield* new CompletionClaimOwnershipConflict({ attempted: request.claim, observed })
    }
    yield* append(
      request.claim.plannedAttempt.runId,
      completionClaimReplacedRecordKey(request.operationId),
      CompletionClaimReplacedEvent.make({
        claim: request.claim,
        operationId: request.operationId,
        version: workflowJournalEventVersion
      })
    )
    return CompletionClaimReplacementResult.make({
      claim: request.claim,
      operationId: request.operationId,
      version: workflowJournalEventVersion
    })
  }
  if (observed._tag !== "ActiveTaskClaim" || !isExactClaimForReplacement(observed, request.claim)) {
    return yield* new CompletionClaimOwnershipConflict({ attempted: request.claim, observed })
  }
  yield* append(
    request.claim.plannedAttempt.runId,
    completionClaimReplacementAttemptIntentRecordKey(request.operationId, attemptOrdinal),
    CompletionClaimReplacementAttemptIntendedEvent.make({
      attemptOrdinal,
      claim: request.claim,
      operationId: request.operationId,
      version: workflowJournalEventVersion
    })
  )
  const result = yield* tracker.replaceTaskClaim(request).pipe(Effect.result)
  if (result._tag === "Success") return yield* appendReplacementOutcome(request, result.success)
  return yield* replacementFailureResult(result.failure)
})

const reconcileExhaustedReplacement = Effect.fn("IntegrationFinality.reconcileExhaustedReplacement")(function* (
  tracker: CompletionClaimBoundaryService,
  request: CompletionClaimReplacementRequest
) {
  const observed = yield* tracker.readTaskClaim(request.claim.plannedAttempt.taskId)
  if (observed._tag === "CompletionTaskClaim") {
    if (!completionTaskClaimEquals(observed, request.claim)) {
      return yield* new CompletionClaimOwnershipConflict({ attempted: request.claim, observed })
    }
    return yield* appendReplacementOutcome(request, observed)
  }
  if (observed._tag !== "ActiveTaskClaim" || !isExactClaimForReplacement(observed, request.claim)) {
    return yield* new CompletionClaimOwnershipConflict({ attempted: request.claim, observed })
  }
  return yield* new CompletionClaimDidNotConverge({
    attempts: completionClaimRequestLimit,
    claim: request.claim,
    operationId: request.operationId,
    phase: "Replacement"
  })
})

/** Replaces one exact active claim with its promotion-bound completion claim. */
export const runCompletionClaimReplacementProtocol = Effect.fn(
  "IntegrationFinality.runCompletionClaimReplacementProtocol"
)(function* (tracker: CompletionClaimBoundaryService, request: CompletionClaimReplacementRequest) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(request.claim.plannedAttempt.runId)
  if (!exactPromotionWasObserved(records, request.claim)) {
    return yield* new CompletionClaimPromotionRequired({ claim: request.claim })
  }
  const knownOutcome = yield* existingReplacementOutcome(request, records)
  /* v8 ignore next -- @preserve Frontier reconstruction suppresses an already-settled replacement action; direct idempotent replay remains supported. */
  if (knownOutcome !== undefined) return knownOutcome
  yield* ensureReplacementIntent(request, records)
  let nextOrdinal = latestAttemptOrdinal(records, request.operationId, "CompletionClaimReplacementAttemptIntended") + 1
  for (; nextOrdinal <= completionClaimRequestLimit; nextOrdinal += 1) {
    const result = yield* runReplacementAttempt(tracker, request, ordinalFor(nextOrdinal))
    if (result !== undefined) return result
  }
  return yield* reconcileExhaustedReplacement(tracker, request)
})

const ensureDeletionIntent = Effect.fn("IntegrationFinality.ensureDeletionIntent")(function* (
  request: CompletionClaimDeletionRequest,
  records: ReadonlyArray<JournalRecord>,
  replacementOperationId: OperationId
) {
  const existing = deletionIntent(records, request.operationId)
  /* v8 ignore start -- @preserve Accepted history binds one deletion operation to one exact claim and success proof; this guards hostile direct replay. */
  if (existing !== undefined) {
    if (
      !completionTaskClaimEquals(existing.claim, request.claim) ||
      !freshCompletedTaskObservationEquals(existing.successObservation, request.successObservation)
    ) {
      return yield* new CompletionClaimPremiseContradiction({
        claim: request.claim,
        detail: "deletion operation was already bound to a different completion claim or success observation"
      })
    }
    return
  }
  /* v8 ignore stop */
  if (!freshSuccessWasObserved(records, request.successObservation, request.claim, replacementOperationId)) {
    return yield* new FreshTrackerSuccessRequired({ claim: request.claim, observation: request.successObservation })
  }
  yield* append(
    request.claim.plannedAttempt.runId,
    completionClaimDeletionIntentRecordKey(request.operationId),
    CompletionClaimDeletionIntendedEvent.make({
      claim: request.claim,
      operationId: request.operationId,
      successObservation: request.successObservation,
      version: workflowJournalEventVersion
    })
  )
})

const appendDeletionOutcomeAndSettlement = Effect.fn("IntegrationFinality.appendDeletionOutcomeAndSettlement")(
  function* (request: CompletionClaimDeletionRequest, replacementOperationId: OperationId) {
    const deletion = yield* append(
      request.claim.plannedAttempt.runId,
      completionClaimDeletedRecordKey(request.operationId),
      CompletionClaimDeletedEvent.make({
        claim: request.claim,
        operationId: request.operationId,
        successObservation: request.successObservation,
        version: workflowJournalEventVersion
      })
    )
    const settled = yield* append(
      request.claim.plannedAttempt.runId,
      integrationFinalitySettledRecordKey(request.claim.promotionCorrelation.requestId),
      IntegrationFinalitySettledEvent.make({
        claim: request.claim,
        deletionOperationId: request.operationId,
        replacementOperationId,
        successObservation: request.successObservation,
        version: workflowJournalEventVersion
      })
    )
    return { deletion, settled }
  }
)

const deletionFailureResult = Effect.fn("IntegrationFinality.deletionFailureResult")(function* (
  failure: CompletionClaimDeletionFailure
) {
  /* v8 ignore next -- @preserve Maintained cassettes cover ambiguous loss; definite rejection is a terminal typed boundary result. */
  if (failure.outcome === "DefinitelyNotApplied") return yield* failure
  return undefined
})

type DeletionOutcomeEvent = Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimDeleted" }>

/* v8 ignore start -- @preserve Accepted history validates these exact premises before delivery; the comparisons defend direct replay over a hostile journal. */
const settlementMatchesRequest = (
  records: ReadonlyArray<JournalRecord>,
  settled: IntegrationFinalityResult,
  request: CompletionClaimDeletionRequest,
  replacementOperationId: OperationId
): boolean =>
  [
    completionTaskClaimEquals(settled.claim, request.claim),
    settled.replacementOperationId === replacementOperationId,
    freshCompletedTaskObservationEquals(settled.successObservation, request.successObservation),
    freshSuccessWasObserved(records, settled.successObservation, settled.claim, replacementOperationId)
  ].every(Boolean)

const deletionOutcomeMatchesRequest = (
  records: ReadonlyArray<JournalRecord>,
  deleted: DeletionOutcomeEvent,
  request: CompletionClaimDeletionRequest,
  replacementOperationId: OperationId
): boolean =>
  [
    completionTaskClaimEquals(deleted.claim, request.claim),
    freshCompletedTaskObservationEquals(deleted.successObservation, request.successObservation),
    freshSuccessWasObserved(records, deleted.successObservation, deleted.claim, replacementOperationId)
  ].every(Boolean)
/* v8 ignore stop */

const appendSettlementAndResult = Effect.fn("IntegrationFinality.appendSettlementAndResult")(function* (
  request: CompletionClaimDeletionRequest,
  deleted: DeletionOutcomeEvent,
  replacementOperationId: OperationId
) {
  yield* append(
    request.claim.plannedAttempt.runId,
    integrationFinalitySettledRecordKey(request.claim.promotionCorrelation.requestId),
    IntegrationFinalitySettledEvent.make({
      claim: deleted.claim,
      deletionOperationId: deleted.operationId,
      replacementOperationId,
      successObservation: deleted.successObservation,
      version: workflowJournalEventVersion
    })
  )
  return IntegrationFinalityResult.make({
    claim: deleted.claim,
    deletionOperationId: deleted.operationId,
    replacementOperationId,
    successObservation: deleted.successObservation,
    version: workflowJournalEventVersion
  })
})

const validateDeletionPremise = Effect.fn("IntegrationFinality.validateDeletionPremise")(function* (
  request: CompletionClaimDeletionRequest,
  replacementOperationId: OperationId,
  records: ReadonlyArray<JournalRecord>
) {
  const priorReplacement = replacementOutcome(records, replacementOperationId)
  /* v8 ignore start -- @preserve Delivery derives deletion only after the exact accepted replacement; these branches fail closed for hostile direct calls. */
  if (priorReplacement === undefined) return yield* new CompletionClaimReplacementRequired({ claim: request.claim })
  if (!completionTaskClaimEquals(priorReplacement.claim, request.claim)) {
    return yield* new CompletionClaimPremiseContradiction({
      claim: request.claim,
      detail: "replacement outcome does not name the requested completion claim"
    })
  }
  const settled = settlementOutcome(records, request.operationId)
  if (settled !== undefined) {
    if (settlementMatchesRequest(records, settled, request, replacementOperationId)) return settled
    return yield* new CompletionClaimPremiseContradiction({
      claim: request.claim,
      detail: "integration settlement was recorded for different completion premises"
    })
  }
  const priorDeleted = deletionOutcome(records, request.operationId)
  if (priorDeleted !== undefined) {
    if (!deletionOutcomeMatchesRequest(records, priorDeleted, request, replacementOperationId)) {
      return yield* new CompletionClaimPremiseContradiction({
        claim: request.claim,
        detail: "deletion outcome was recorded for different completion premises"
      })
    }
    return yield* appendSettlementAndResult(request, priorDeleted, replacementOperationId)
  }
  /* v8 ignore stop */
  return undefined
})

const runDeletionAttempt = Effect.fn("IntegrationFinality.runDeletionAttempt")(function* (
  tracker: CompletionClaimBoundaryService,
  request: CompletionClaimDeletionRequest,
  replacementOperationId: OperationId,
  attemptOrdinal: CompletionClaimRequestOrdinal
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(request.claim.plannedAttempt.runId)
  const currentDeleted = deletionOutcome(records, request.operationId)
  /* v8 ignore start -- @preserve The serialized action cannot publish deletion concurrently with itself; restart is handled before this attempt helper. */
  if (currentDeleted !== undefined) {
    if (!deletionOutcomeMatchesRequest(records, currentDeleted, request, replacementOperationId)) {
      return yield* new CompletionClaimPremiseContradiction({
        claim: request.claim,
        detail: "deletion outcome was recorded for different completion premises"
      })
    }
    return yield* appendSettlementAndResult(request, currentDeleted, replacementOperationId)
  }
  /* v8 ignore stop */
  const observed = yield* tracker.readTaskClaim(request.claim.plannedAttempt.taskId)
  if (observed._tag === "UnclaimedTask") {
    yield* appendDeletionOutcomeAndSettlement(request, replacementOperationId)
    return IntegrationFinalityResult.make({
      claim: request.claim,
      deletionOperationId: request.operationId,
      replacementOperationId,
      successObservation: request.successObservation,
      version: workflowJournalEventVersion
    })
  }
  if (observed._tag !== "CompletionTaskClaim" || !completionTaskClaimEquals(observed, request.claim)) {
    return yield* new CompletionClaimOwnershipConflict({ attempted: request.claim, observed })
  }
  yield* append(
    request.claim.plannedAttempt.runId,
    completionClaimDeletionAttemptIntentRecordKey(request.operationId, attemptOrdinal),
    CompletionClaimDeletionAttemptIntendedEvent.make({
      attemptOrdinal,
      claim: request.claim,
      operationId: request.operationId,
      successObservation: request.successObservation,
      version: workflowJournalEventVersion
    })
  )
  const result = yield* tracker.deleteTaskClaim(request).pipe(Effect.result)
  if (result._tag === "Success") {
    yield* appendDeletionOutcomeAndSettlement(request, replacementOperationId)
    return IntegrationFinalityResult.make({
      claim: request.claim,
      deletionOperationId: request.operationId,
      replacementOperationId,
      successObservation: request.successObservation,
      version: workflowJournalEventVersion
    })
  }
  return yield* deletionFailureResult(result.failure)
})

const reconcileExhaustedDeletion = Effect.fn("IntegrationFinality.reconcileExhaustedDeletion")(function* (
  tracker: CompletionClaimBoundaryService,
  request: CompletionClaimDeletionRequest,
  replacementOperationId: OperationId
) {
  const observed = yield* tracker.readTaskClaim(request.claim.plannedAttempt.taskId)
  if (observed._tag === "UnclaimedTask") {
    yield* appendDeletionOutcomeAndSettlement(request, replacementOperationId)
    return IntegrationFinalityResult.make({
      claim: request.claim,
      deletionOperationId: request.operationId,
      replacementOperationId,
      successObservation: request.successObservation,
      version: workflowJournalEventVersion
    })
  }
  if (observed._tag !== "CompletionTaskClaim" || !completionTaskClaimEquals(observed, request.claim)) {
    return yield* new CompletionClaimOwnershipConflict({ attempted: request.claim, observed })
  }
  return yield* new CompletionClaimDidNotConverge({
    attempts: completionClaimRequestLimit,
    claim: request.claim,
    operationId: request.operationId,
    phase: "Deletion"
  })
})

/** Deletes only the exact completion claim after fresh successful tracker evidence, then settles that task. */
export const runCompletionClaimDeletionProtocol = Effect.fn("IntegrationFinality.runCompletionClaimDeletionProtocol")(
  function* (
    tracker: CompletionClaimBoundaryService,
    request: CompletionClaimDeletionRequest,
    replacementOperationId: OperationId
  ) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(request.claim.plannedAttempt.runId)
    const priorResult = yield* validateDeletionPremise(request, replacementOperationId, records)
    if (priorResult !== undefined) return priorResult
    yield* ensureDeletionIntent(request, records, replacementOperationId)
    let nextOrdinal = latestAttemptOrdinal(records, request.operationId, "CompletionClaimDeletionAttemptIntended") + 1
    for (; nextOrdinal <= completionClaimRequestLimit; nextOrdinal += 1) {
      const result = yield* runDeletionAttempt(tracker, request, replacementOperationId, ordinalFor(nextOrdinal))
      if (result !== undefined) return result
    }
    return yield* reconcileExhaustedDeletion(tracker, request, replacementOperationId)
  }
)

export { CompletionClaimRequestLimit }
