import type { JournalPosition, OperationId } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import type { TechnicalRetryJournalEvent } from "./technical-retry.js"

type TechnicalRetryAdmissionContradiction =
  | "RetryFactsAfterOutcome"
  | "RetryFactsBeforeIntent"
  | "RetryFactsWithoutIntent"

interface TechnicalRetryTemporalIssue {
  readonly _tag: "Identity" | "Semantic"
  readonly admissionContradiction?: TechnicalRetryAdmissionContradiction | undefined
  readonly detail: string
  readonly position: JournalPosition
}

type PositionedTechnicalRetryFact = Omit<JournalRecord, "event"> & { readonly event: TechnicalRetryJournalEvent }

const isPositionedTechnicalRetryFact = (record: JournalRecord): record is PositionedTechnicalRetryFact =>
  record.event._tag === "TechnicalRetryPolicyCaptured"
  || record.event._tag === "TechnicalRetryScheduled"
  || record.event._tag === "TechnicalRetryDeferralSuperseded"

/** Totally validates one operation's positioned retry facts against its exact invocation interval. */
export const analyzeTechnicalRetryTemporalFacts = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): ReadonlyArray<TechnicalRetryTemporalIssue> => {
  const facts = records.filter(isPositionedTechnicalRetryFact)
    .filter(({ event }) => event.scope.operationId === operationId)
  const scopeFact = facts.find(({ event }) => event._tag === "TechnicalRetryPolicyCaptured") ?? facts[0]
  if (scopeFact === undefined) return []
  const scope = scopeFact.event.scope
  const intent = records.find(({ event }) =>
    (event._tag === "ImplementationReviewIntended" || event._tag === "ReviewFindingsHandbackIntended")
    && event.operation.request.operationId === operationId
  )
  const matchesIntent = scope._tag === "ImplementationReviewInvocation"
    ? intent?.event._tag === "ImplementationReviewIntended"
      && intent.event.operation.request._tag === "AuthorizedImplementationReview"
      && intent.event.operation.request.reviewerSessionId === scope.reviewerSessionId
      && intent.event.operation.request.round === scope.semanticRound
    : intent?.event._tag === "ReviewFindingsHandbackIntended"
      && intent.event.operation.request.reviewOperationId === scope.reviewOperationId
      && intent.event.operation.request.review.manifest.round === scope.semanticRound
  const invocationFacts = facts.filter(({ event }) => event._tag !== "TechnicalRetryPolicyCaptured")
  let issues: ReadonlyArray<TechnicalRetryTemporalIssue> = []
  if ((intent !== undefined || invocationFacts.length > 0) && !matchesIntent) {
    issues = [...issues, {
      _tag: "Identity",
      detail: `technical retry scope contradicts the invocation intent for operation ${operationId}`,
      position: scopeFact.position
    }]
  }
  const outcomePosition = records.find(({ event }) =>
    (event._tag === "ImplementationReviewCompleted" && event.review.manifest.operationId === operationId)
    || (event._tag === "ReviewFindingsHandbackCompleted" && event.acknowledgement.operationId === operationId)
  )?.position
  for (const fact of invocationFacts) {
    if (!matchesIntent || intent === undefined || fact.position <= intent.position) {
      issues = [...issues, {
        _tag: "Semantic",
        admissionContradiction: intent === undefined ? "RetryFactsWithoutIntent" : "RetryFactsBeforeIntent",
        detail: `technical retry ${fact.event._tag} has no prior exact invocation intent for operation ${operationId}`,
        position: fact.position
      }]
    }
    if (outcomePosition !== undefined && fact.position >= outcomePosition) {
      issues = [...issues, {
        _tag: "Semantic",
        admissionContradiction: "RetryFactsAfterOutcome",
        detail: `technical retry ${fact.event._tag} follows the durable outcome for operation ${operationId}`,
        position: fact.position
      }]
    }
  }
  return issues
}

/** Selects live admission's first contradiction while the total analyzer remains accumulating. */
export const firstTechnicalRetryAdmissionContradiction = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): TechnicalRetryAdmissionContradiction | undefined =>
  analyzeTechnicalRetryTemporalFacts(records, operationId)
    .find(({ admissionContradiction }) => admissionContradiction !== undefined)
    ?.admissionContradiction
