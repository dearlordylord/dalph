import { Schema } from "effect"
import { GitCommitSha, RunId } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"

/** Retained detail for a provider run whose owned activity was proved absent. */
export const IntegrationQuarantineFailureDetail = Schema.NonEmptyString.pipe(
  Schema.brand("IntegrationQuarantineFailureDetail")
)
export type IntegrationQuarantineFailureDetail = typeof IntegrationQuarantineFailureDetail.Type

const integratorCorrelationEquivalence = Schema.toEquivalence(IntegratorSessionCorrelation)

/** Conclusive outer-Integrator facts that stop automatic work for one session. */
export const IntegrationQuarantineCause = Schema.TaggedUnion({
  InvalidCandidate: { candidateText: IntegratorCandidateText, observation: IntegratorGitObservation },
  NotPrepared: { detail: IntegratorNotPreparedDetail }
})
export type IntegrationQuarantineCause = typeof IntegrationQuarantineCause.Type

/** Journal positions that retain the exact result and, when applicable, Git evidence behind quarantine. */
export const IntegrationQuarantineResultEvidence = Schema.Struct({
  candidateObservationAt: Schema.optionalKey(JournalPosition),
  resultRecordedAt: JournalPosition
})
export type IntegrationQuarantineResultEvidence = typeof IntegrationQuarantineResultEvidence.Type

/** Either conclusive result evidence or a fresh target read that invalidated Retry. */
export const IntegrationQuarantineBasis = Schema.TaggedUnion({
  ConclusiveResult: { cause: IntegrationQuarantineCause, evidence: IntegrationQuarantineResultEvidence },
  ProviderRunFailure: { detail: IntegrationQuarantineFailureDetail, ownedActivityProvenAbsentAt: JournalPosition },
  RetryTargetHeadChanged: {
    direction: Schema.Literal("Retry"),
    directionAppliedAt: JournalPosition,
    observedTargetHead: GitCommitSha,
    priorQuarantineAt: JournalPosition,
    targetLineageObservedAt: JournalPosition
  }
})
export type IntegrationQuarantineBasis = typeof IntegrationQuarantineBasis.Type

/** Stable suffix for the Journal key of one quarantine occurrence. */
export const integrationQuarantineBasisKey = (basis: IntegrationQuarantineBasis): string =>
  basis._tag === "ConclusiveResult"
    ? `result:${basis.evidence.resultRecordedAt}`
    : basis._tag === "ProviderRunFailure"
      ? `provider-failure:${basis.ownedActivityProvenAbsentAt}`
      : `retry-head:${basis.priorQuarantineAt}:${basis.directionAppliedAt}:${basis.targetLineageObservedAt}`

/** Backwards-readable name for the result evidence carried by a conclusive basis. */
export const IntegrationQuarantineEvidence = IntegrationQuarantineResultEvidence
export type IntegrationQuarantineEvidence = IntegrationQuarantineResultEvidence

const exactCandidateParentCount = 2

/** Stops one exact integration session while preserving its responsibility and conclusive evidence. */
const conclusiveBasisIsValid = (event: {
  readonly basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>
  readonly correlation: IntegratorSessionCorrelation
}): string | undefined => {
  const requiresCandidateObservation = event.basis.cause._tag === "InvalidCandidate"
  const hasCandidateObservation = event.basis.evidence.candidateObservationAt !== undefined
  if (requiresCandidateObservation !== hasCandidateObservation) {
    return "invalid-candidate quarantine requires its exact Git observation position"
  }
  if (event.basis.cause._tag !== "InvalidCandidate") return undefined
  if (event.basis.cause.observation.candidateText !== event.basis.cause.candidateText) {
    return "invalid-candidate quarantine must bind the reported candidate text to the Git observation"
  }
  const observation = event.basis.cause.observation
  const isInvalid =
    observation._tag !== "Commit" ||
    observation.directParents.length !== exactCandidateParentCount ||
    observation.directParents[0] !== event.correlation.expectedTargetHead ||
    observation.directParents[1] !== event.correlation.acceptedResult.commit
  return isInvalid ? undefined : "a candidate with exact ordered parents [H, C] is not invalid"
}

const retryTargetHeadBasisIsValid = (
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>,
  correlation: IntegratorSessionCorrelation
): string | undefined =>
  basis.priorQuarantineAt < basis.directionAppliedAt &&
  basis.directionAppliedAt < basis.targetLineageObservedAt &&
  basis.observedTargetHead !== correlation.expectedTargetHead
    ? undefined
    : "Retry target-head quarantine requires a changed head after its applied Retry and predecessor quarantine"

const quarantineBasisIsValid = (event: {
  readonly basis: IntegrationQuarantineBasis
  readonly correlation: IntegratorSessionCorrelation
}): string | undefined => {
  const { basis, correlation } = event
  return basis._tag === "ProviderRunFailure"
    ? /* v8 ignore next -- @preserve JournalPosition is branded to be at least one, so the defensive non-positive provider position cannot be constructed. */
      basis.ownedActivityProvenAbsentAt >= 1
      ? undefined
      : /* v8 ignore next -- @preserve JournalPosition is branded to be at least one, so this defensive rejection is unreachable. */ "provider-run quarantine requires a positive owned-activity absence position"
    : basis._tag === "RetryTargetHeadChanged"
      ? retryTargetHeadBasisIsValid(basis, correlation)
      : conclusiveBasisIsValid({ basis, correlation })
}

export const IntegrationQuarantinedEvent = Schema.TaggedStruct("IntegrationQuarantined", {
  basis: IntegrationQuarantineBasis,
  correlation: IntegratorSessionCorrelation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  version: Schema.Literal(workflowJournalEventVersion)
}).check(Schema.makeFilter(quarantineBasisIsValid))
export type IntegrationQuarantinedEvent = typeof IntegrationQuarantinedEvent.Type

/** Exact non-action evidence that a provider run has no owned activity left. */
export const IntegrationProviderRunActivityAbsentEvent = Schema.TaggedStruct("IntegrationProviderRunActivityAbsent", {
  correlation: IntegratorSessionCorrelation,
  detail: IntegrationQuarantineFailureDetail,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) =>
    integratorCorrelationEquivalence(event.correlation, event.run.session)
      ? undefined
      : "provider-run absence must name the same exact session in its run and correlation"
  )
)
export type IntegrationProviderRunActivityAbsentEvent = typeof IntegrationProviderRunActivityAbsentEvent.Type

/** The only operator directions accepted for one exact quarantine occurrence. */
export const IntegrationQuarantineDirection = Schema.Literals(["Retry", "FullRerun"])
export type IntegrationQuarantineDirection = typeof IntegrationQuarantineDirection.Type

/** Stable choice subject independent of whether Retry or FullRerun wins. */
export const IntegrationQuarantineDirectionSubject = Schema.Struct({
  quarantineAt: JournalPosition,
  sessionId: IntegratorSessionId
}).pipe(Schema.brand("IntegrationQuarantineDirectionSubject"))
export type IntegrationQuarantineDirectionSubject = typeof IntegrationQuarantineDirectionSubject.Type

/** Stable choice fingerprint: exact session, quarantine Journal position, and direction. */
export const IntegrationQuarantineDirectionFingerprint = Schema.Struct({
  direction: IntegrationQuarantineDirection,
  quarantineAt: JournalPosition,
  sessionId: IntegratorSessionId
}).pipe(Schema.brand("IntegrationQuarantineDirectionFingerprint"))
export type IntegrationQuarantineDirectionFingerprint = typeof IntegrationQuarantineDirectionFingerprint.Type

/** Transport identity for one redeliverable operator request, bound to its workflow Run. */
export const IntegrationQuarantineDirectionRequestId = Schema.Struct({
  nonce: Schema.NonEmptyString,
  runId: RunId
}).pipe(Schema.brand("IntegrationQuarantineDirectionRequestId"))
export type IntegrationQuarantineDirectionRequestId = typeof IntegrationQuarantineDirectionRequestId.Type

/** Ephemeral input; only a successful application becomes a journal occurrence. */
export const ApplyIntegrationQuarantineDirectionRequest = Schema.Struct({
  fingerprint: IntegrationQuarantineDirectionFingerprint,
  requestId: IntegrationQuarantineDirectionRequestId
})
export type ApplyIntegrationQuarantineDirectionRequest = typeof ApplyIntegrationQuarantineDirectionRequest.Type

/** The first accepted Retry or FullRerun direction for one quarantine occurrence. */
export const IntegrationQuarantineDirectionAppliedEvent = Schema.TaggedStruct("IntegrationQuarantineDirectionApplied", {
  fingerprint: IntegrationQuarantineDirectionFingerprint,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  requestId: IntegrationQuarantineDirectionRequestId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type IntegrationQuarantineDirectionAppliedEvent = typeof IntegrationQuarantineDirectionAppliedEvent.Type

/** Closed Journal vocabulary for quarantine disposition and its first operator direction. */
export const IntegrationQuarantineJournalEvent = Schema.Union([
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantinedEvent,
  IntegrationQuarantineDirectionAppliedEvent
])
export type IntegrationQuarantineJournalEvent = typeof IntegrationQuarantineJournalEvent.Type

export const sameIntegrationQuarantineDirectionFingerprint = (
  left: IntegrationQuarantineDirectionFingerprint,
  right: IntegrationQuarantineDirectionFingerprint
): boolean =>
  left.direction === right.direction && left.quarantineAt === right.quarantineAt && left.sessionId === right.sessionId

export const integrationQuarantineDirectionSubject = (
  fingerprint: IntegrationQuarantineDirectionFingerprint
): IntegrationQuarantineDirectionSubject =>
  IntegrationQuarantineDirectionSubject.make({
    quarantineAt: fingerprint.quarantineAt,
    sessionId: fingerprint.sessionId
  })

export const sameIntegrationQuarantineDirectionSubject = (
  left: IntegrationQuarantineDirectionSubject,
  right: IntegrationQuarantineDirectionSubject
): boolean => left.quarantineAt === right.quarantineAt && left.sessionId === right.sessionId

export const sameIntegrationQuarantineDirectionRequestId = (
  left: IntegrationQuarantineDirectionRequestId,
  right: IntegrationQuarantineDirectionRequestId
): boolean => left.nonce === right.nonce && left.runId === right.runId

/** Derives the workflow Run from the responsibility bound to a quarantine. */
export const integrationQuarantineDirectionRunId = (correlation: IntegratorSessionCorrelation): RunId =>
  correlation.plannedAttempt.runId
