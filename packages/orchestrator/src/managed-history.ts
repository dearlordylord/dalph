/* eslint-disable functional/immutable-data, max-lines -- The total fold keeps the complete transition algebra together. */
import { Schema } from "effect"
import {
  type AttemptId,
  JournalPosition,
  type JournalRecordKey,
  type OperationId,
  PlannedTaskAttempt,
  RunId,
  type TaskWorkSessionId
} from "./domain.js"
import {
  claimForPlannedAttempt,
  convergenceDispositionPredecessorMatches,
  convergenceSubjectWorktreeMatches,
  implementationReviewCausalChainMatches,
  implementationReviewRequestCausalChainMatches,
  reviewFindingsHandbackCausalChainMatches,
  successfulConvergenceInvocationOutcomeExists,
  technicalRetryScopeForConvergenceExhaustion
} from "./implementation-convergence-history.js"
import type { ImplementationConvergenceDisposition } from "./implementation-convergence.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import { type JournalRecord, WorkflowJournalEvent } from "./journal-store.js"
import { analyzeTechnicalRetryTemporalFacts } from "./technical-retry-temporal.js"
import { analyzeTechnicalRetryFacts, type TechnicalRetryJournalEvent } from "./technical-retry.js"
import { isExactTaskClaim } from "./tracker-mutation.js"
import {
  claimAuthorityMatches,
  executionAuthorityMatches,
  sessionAuthorityMatches
} from "./workflow-authority-relations.js"

const ManagedHistoryIssueFields = {
  detail: Schema.String,
  position: JournalPosition,
  runId: RunId
}

/** A journal record's key, event identity, or planned-attempt owner disagree. */
export class ManagedHistoryIdentityIssue extends Schema.TaggedErrorClass<ManagedHistoryIdentityIssue>()(
  "ManagedHistoryIdentityIssue",
  ManagedHistoryIssueFields
) {}

/** Ordered decoded events violate the workflow's legal transition algebra. */
export class ManagedHistorySemanticIssue extends Schema.TaggedErrorClass<ManagedHistorySemanticIssue>()(
  "ManagedHistorySemanticIssue",
  ManagedHistoryIssueFields
) {}

/** Derived recovery input. It is rebuilt from immutable records and is never persisted. */
export interface ValidManagedHistory {
  readonly _tag: "ValidManagedHistory"
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

export interface InvalidManagedHistory {
  readonly _tag: "InvalidManagedHistory"
  readonly issues: ReadonlyArray<ManagedHistoryIdentityIssue | ManagedHistorySemanticIssue>
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

type JournalEventTag = WorkflowJournalEvent["_tag"]
type TransitionRule =
  | { readonly _tag: "Intent" }
  | { readonly _tag: "Observation"; readonly requiredIntent: JournalEventTag }
  | { readonly _tag: "Outcome"; readonly requiredIntent: JournalEventTag }
  | {
    readonly _tag: "ProviderOutcome"
    readonly requiredIntent: JournalEventTag
    readonly requiredProof: JournalEventTag
  }

const intent = { _tag: "Intent" } as const
const observation = (requiredIntent: JournalEventTag): TransitionRule => ({ _tag: "Observation", requiredIntent })
const outcome = (
  requiredIntent: JournalEventTag,
  requiredProof?: JournalEventTag
): TransitionRule =>
  requiredProof === undefined
    ? { _tag: "Outcome", requiredIntent }
    : { _tag: "ProviderOutcome", requiredIntent, requiredProof }

const TransitionRuleByEventKind: Partial<Record<JournalEventTag, TransitionRule>> = {
  ImplementationEvidenceSealed: outcome("ImplementationEvidenceSealingIntended"),
  ImplementationEvidenceSealingIntended: intent,
  ImplementationReviewCompleted: outcome("ImplementationReviewIntended"),
  ImplementationReviewIntended: intent,
  ReviewFindingsHandbackCompleted: outcome("ReviewFindingsHandbackIntended"),
  ReviewFindingsHandbackIntended: intent,
  TaskClaimAcquired: outcome("TaskClaimAcquisitionIntended"),
  TaskClaimAcquisitionIntended: intent,
  TaskExecutionIntentRecorded: intent,
  TaskExecutionObservationFailed: observation("TaskExecutionIntentRecorded"),
  TaskExecutionOutcomeObserved: outcome("TaskExecutionIntentRecorded", "TaskExecutionReported"),
  TaskExecutionReported: observation("TaskExecutionIntentRecorded"),
  TaskExecutionRequestAttemptRecorded: observation("TaskExecutionIntentRecorded"),
  TaskExecutionRequestFailed: observation("TaskExecutionIntentRecorded"),
  TaskExecutionRequestReturned: observation("TaskExecutionIntentRecorded"),
  TaskWorkSessionEstablished: outcome("TaskWorkSessionEstablishmentIntentRecorded", "TaskWorkSessionReported"),
  TaskWorkSessionEstablishmentIntentRecorded: intent,
  TaskWorkSessionLookupFailed: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkSessionLookupRequested: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkSessionReported: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkStartRequestAcknowledged: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkStartRequestFailed: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkStartRequested: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorktreeReady: outcome("TaskWorktreeReconciliationIntended"),
  TaskWorktreeReconciliationIntended: intent,
  TrackerGraphObservationIntentRecorded: intent,
  TrackerGraphOutcomeObserved: outcome("TrackerGraphObservationIntentRecorded")
}

const semanticEventJson = (event: WorkflowJournalEvent): string =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(event))

const semanticDuplicateDetail = (
  noun: string,
  identity: string,
  prior: WorkflowJournalEvent,
  current: WorkflowJournalEvent
): string =>
  semanticEventJson(prior) === semanticEventJson(current)
    ? `duplicate ${noun} for ${identity}`
    : `contradictory ${noun}s for ${identity}`

const samePlannedAttempt = (left: PlannedTaskAttempt, right: PlannedTaskAttempt): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(PlannedTaskAttempt)(left))
    === JSON.stringify(Schema.encodeUnknownSync(PlannedTaskAttempt)(right))

/**
 * Folds all ordered records without throwing or stopping at the first fault.
 * Invalid histories retain every immutable record and every independently
 * detectable issue, so startup cannot silently resume or discard them.
 */
export const reduceManagedHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidManagedHistory | InvalidManagedHistory => {
  const issues = new Array<ManagedHistoryIdentityIssue | ManagedHistorySemanticIssue>()
  const intents = new Map<OperationId, WorkflowJournalEvent>()
  const outcomes = new Map<OperationId, WorkflowJournalEvent>()
  const observations = new Map<OperationId, ReadonlySet<JournalEventTag>>()
  const plans = new Map<AttemptId, WorkflowJournalEvent>()
  const seenKeys = new Set<JournalRecordKey>()
  const establishedSessionIds = new Set<TaskWorkSessionId>()
  const sessionResults = new Map<TaskWorkSessionId, WorkflowJournalEvent>()
  const seenOperationIds = new Set<OperationId>()
  const eventKindsByOperation = new Map<OperationId, ReadonlySet<JournalEventTag>>()
  const plannedAttemptByOperation = new Map<OperationId, PlannedTaskAttempt>()
  const technicalRetryFacts = new Map<
    OperationId,
    Array<{ readonly event: TechnicalRetryJournalEvent; readonly position: JournalPosition }>
  >()
  const sessionAttempts = new Map<TaskWorkSessionId, PlannedTaskAttempt>()
  const sessionOperations = new Map<TaskWorkSessionId, OperationId>()
  const terminalAttempts = new Set<AttemptId>()
  const resourceEmergencyAttempts = new Set<AttemptId>()
  const technicalExhaustions = new Array<{
    readonly disposition: Extract<ImplementationConvergenceDisposition, {
      readonly _tag: "HandbackTechnicalRetryExhausted" | "ReviewTechnicalRetryExhausted"
    }>
    readonly position: JournalPosition
  }>()

  records.forEach((record, index) => {
    const expectedPosition = index + 1
    if (record.position !== expectedPosition) {
      issues.push(
        new ManagedHistorySemanticIssue({
          detail: `expected canonical position ${expectedPosition}, found ${record.position}`,
          position: record.position,
          runId
        })
      )
    }
    if (record.runId !== runId) {
      issues.push(
        new ManagedHistoryIdentityIssue({
          detail: `record belongs to run ${record.runId}`,
          position: record.position,
          runId
        })
      )
    }
    const descriptor = describeJournalEvent(record.event)
    if (record.key !== descriptor.expectedKey) {
      issues.push(
        new ManagedHistoryIdentityIssue({
          detail: `event ${record.event._tag} requires record key ${descriptor.expectedKey}, found ${record.key}`,
          position: record.position,
          runId
        })
      )
    }
    if (descriptor._tag === "SessionResultEventDescriptor") {
      if (!establishedSessionIds.has(descriptor.requiredSessionId)) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: `event ${record.event._tag} has no prior established session ${descriptor.requiredSessionId}`,
            position: record.position,
            runId
          })
        )
      }
      const prior = sessionResults.get(descriptor.requiredSessionId)
      if (prior === undefined) sessionResults.set(descriptor.requiredSessionId, record.event)
      else {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: semanticDuplicateDetail(
              "terminal session result",
              `session ${descriptor.requiredSessionId}`,
              prior,
              record.event
            ),
            position: record.position,
            runId
          })
        )
      }
      seenKeys.add(record.key)
      return
    }
    const plannedAttempt = descriptor.plannedAttempt._tag === "PlannedAttempt"
      ? descriptor.plannedAttempt.plannedAttempt
      : undefined
    if (plannedAttempt !== undefined && plannedAttempt.runId !== runId) {
      issues.push(
        new ManagedHistoryIdentityIssue({
          detail: `event ${record.event._tag} binds planned attempt run ${plannedAttempt.runId}`,
          position: record.position,
          runId
        })
      )
    }
    {
      const priorAttempt = plannedAttemptByOperation.get(descriptor.operationId)
      const ownedAttempt = plannedAttempt ?? priorAttempt
      if (
        ownedAttempt !== undefined
        && resourceEmergencyAttempts.has(ownedAttempt.attemptId)
        && record.event._tag === "TaskExecutionIntentRecorded"
      ) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: `execution intent follows a demonstrated resource emergency for attempt ${ownedAttempt.attemptId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        ownedAttempt !== undefined
        && terminalAttempts.has(ownedAttempt.attemptId)
        && record.event._tag !== "ImplementationConvergenceDispositionRecorded"
      ) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail:
              `event ${record.event._tag} follows the terminal implementation disposition for attempt ${ownedAttempt.attemptId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        plannedAttempt !== undefined
        && priorAttempt !== undefined
        && !samePlannedAttempt(priorAttempt, plannedAttempt)
      ) {
        issues.push(
          new ManagedHistoryIdentityIssue({
            detail:
              `event ${record.event._tag} contradicts the planned attempt for operation ${descriptor.operationId}`,
            position: record.position,
            runId
          })
        )
      }
      for (const relatedOperationId of descriptor.relatedOperationIds) {
        if (relatedOperationId !== descriptor.operationId) {
          issues.push(
            new ManagedHistoryIdentityIssue({
              detail:
                `event ${record.event._tag} operation ${descriptor.operationId} contradicts embedded operation ${relatedOperationId}`,
              position: record.position,
              runId
            })
          )
        }
      }
      for (const requiredOperationId of descriptor.requiredOperationIds) {
        if (!seenOperationIds.has(requiredOperationId)) {
          issues.push(
            new ManagedHistorySemanticIssue({
              detail: `event ${record.event._tag} has no prior predecessor operation ${requiredOperationId}`,
              position: record.position,
              runId
            })
          )
        }
        const predecessorAttempt = plannedAttemptByOperation.get(requiredOperationId)
        if (
          plannedAttempt !== undefined
          && predecessorAttempt !== undefined
          && !samePlannedAttempt(predecessorAttempt, plannedAttempt)
        ) {
          issues.push(
            new ManagedHistoryIdentityIssue({
              detail:
                `event ${record.event._tag} planned attempt contradicts predecessor operation ${requiredOperationId}`,
              position: record.position,
              runId
            })
          )
        }
      }
      for (const requiredKind of descriptor.requiredPredecessorKinds) {
        const hasRequiredKind = descriptor.requiredOperationIds.some((requiredOperationId) =>
          eventKindsByOperation.get(requiredOperationId)?.has(requiredKind) === true
        )
        if (!hasRequiredKind) {
          issues.push(
            new ManagedHistorySemanticIssue({
              detail: `event ${record.event._tag} has no direct predecessor event ${requiredKind}`,
              position: record.position,
              runId
            })
          )
        }
      }
      seenOperationIds.add(descriptor.operationId)
      if (plannedAttempt !== undefined) plannedAttemptByOperation.set(descriptor.operationId, plannedAttempt)
      eventKindsByOperation.set(
        descriptor.operationId,
        new Set([...(eventKindsByOperation.get(descriptor.operationId) ?? []), record.event._tag])
      )
      if (
        ownedAttempt !== undefined
        && record.event._tag === "TaskExecutionOutcomeObserved"
        && record.event.outcome.outcome._tag === "ResourceEmergency"
      ) resourceEmergencyAttempts.add(ownedAttempt.attemptId)
    }

    if (record.event._tag === "TaskAttemptPlanned") {
      const attemptId = record.event.operation.plannedAttempt.attemptId
      const prior = plans.get(attemptId)
      if (prior === undefined) plans.set(attemptId, record.event)
      else {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: semanticDuplicateDetail("plan", `attempt ${attemptId}`, prior, record.event),
            position: record.position,
            runId
          })
        )
      }
    }

    if (record.event._tag === "TaskWorkSessionEstablished") {
      const attempt = plannedAttemptByOperation.get(record.event.outcome.operationId)
      if (attempt !== undefined) sessionAttempts.set(record.event.outcome.sessionId, attempt)
      sessionOperations.set(record.event.outcome.sessionId, record.event.outcome.operationId)
    }
    if (record.event._tag === "ImplementationConvergenceDispositionRecorded") {
      const request = record.event.operation.request
      if (request._tag === "SimulatedImplementationConvergenceDisposition") {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: "simulated implementation convergence cannot be durable workflow history",
            position: record.position,
            runId
          })
        )
      } else {
        const disposition = request.disposition
        const subject = disposition.subject
        const claim = claimForPlannedAttempt(records.slice(0, index + 1), subject.plannedAttempt)
        if (claim === undefined || !isExactTaskClaim(claim, subject.claim)) {
          issues.push(
            new ManagedHistoryIdentityIssue({
              detail:
                `implementation disposition does not retain the exact acquired claim for task ${subject.claim.taskId}`,
              position: record.position,
              runId
            })
          )
        }
        const priorRecords = records.slice(0, index)
        if (!convergenceSubjectWorktreeMatches(priorRecords, subject)) {
          issues.push(
            new ManagedHistoryIdentityIssue({
              detail:
                `implementation disposition does not retain the exact ready worktree for attempt ${subject.plannedAttempt.attemptId}`,
              position: record.position,
              runId
            })
          )
        }
        if (!convergenceDispositionPredecessorMatches(priorRecords, record.event.operation)) {
          issues.push(
            new ManagedHistorySemanticIssue({
              detail: `implementation disposition predecessor does not match its embedded terminal evidence`,
              position: record.position,
              runId
            })
          )
        }
        const sessionAttempt = sessionAttempts.get(subject.sessionId)
        if (
          sessionAttempt === undefined
          || !samePlannedAttempt(sessionAttempt, subject.plannedAttempt)
          || sessionOperations.get(subject.sessionId) !== subject.sessionEstablishmentOperationId
        ) {
          issues.push(
            new ManagedHistoryIdentityIssue({
              detail: `implementation disposition session ${subject.sessionId} does not belong to its retained attempt`,
              position: record.position,
              runId
            })
          )
        }
        if (terminalAttempts.has(subject.plannedAttempt.attemptId)) {
          issues.push(
            new ManagedHistorySemanticIssue({
              detail: `attempt ${subject.plannedAttempt.attemptId} has multiple terminal implementation dispositions`,
              position: record.position,
              runId
            })
          )
        }
        terminalAttempts.add(subject.plannedAttempt.attemptId)
        if (
          disposition._tag === "ReviewTechnicalRetryExhausted"
          || disposition._tag === "HandbackTechnicalRetryExhausted"
        ) technicalExhaustions.push({ disposition, position: record.position })
      }
    }

    const operationId = descriptor.operationId
    if (
      descriptor.recordPredecessor._tag === "RequiredRecordPredecessor"
      && !seenKeys.has(descriptor.recordPredecessor.key)
    ) {
      issues.push(
        new ManagedHistorySemanticIssue({
          detail: `event ${record.event._tag} has no prior record ${descriptor.recordPredecessor.key}`,
          position: record.position,
          runId
        })
      )
    }
    seenKeys.add(record.key)
    if (
      record.event._tag === "TechnicalRetryPolicyCaptured"
      || record.event._tag === "TechnicalRetryScheduled"
      || record.event._tag === "TechnicalRetryDeferralSuperseded"
    ) {
      technicalRetryFacts.set(
        operationId,
        [...(technicalRetryFacts.get(operationId) ?? []), { event: record.event, position: record.position }]
      )
    }
    if (descriptor.session._tag === "ProducedSession") establishedSessionIds.add(descriptor.session.sessionId)
    const transition = TransitionRuleByEventKind[record.event._tag]
    if (transition?._tag === "Intent") {
      const prior = intents.get(operationId)
      if (prior === undefined) intents.set(operationId, record.event)
      else {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: semanticDuplicateDetail("intent", `operation ${operationId}`, prior, record.event),
            position: record.position,
            runId
          })
        )
      }
    }
    if (transition?._tag === "Observation") {
      if (intents.get(operationId)?._tag !== transition.requiredIntent) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: `observation ${record.event._tag} has no prior intent for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      observations.set(
        operationId,
        new Set([...(observations.get(operationId) ?? []), record.event._tag])
      )
    }
    if (transition?._tag === "Outcome" || transition?._tag === "ProviderOutcome") {
      const outcomeEvent = record.event
      const matchingIntent = intents.get(operationId)
      if (matchingIntent?._tag !== transition.requiredIntent) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: `outcome ${record.event._tag} has no prior intent for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        transition._tag === "ProviderOutcome"
        && !observations.get(operationId)?.has(transition.requiredProof)
      ) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: `outcome ${record.event._tag} has no prior provider observation for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        record.event._tag === "TaskClaimAcquired"
        && matchingIntent?._tag === "TaskClaimAcquisitionIntended"
        && !claimAuthorityMatches(record.event.claim, matchingIntent.operation.acquisition)
      ) {
        issues.push(
          new ManagedHistoryIdentityIssue({
            detail: `outcome TaskClaimAcquired contradicts the intended claim for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        outcomeEvent._tag === "TaskWorkSessionEstablished"
        && (
          matchingIntent?._tag !== "TaskWorkSessionEstablishmentIntentRecorded"
          || !records.slice(0, index).some(({ event }) =>
            event._tag === "TaskWorkSessionReported"
            && event.operationId === operationId
            && sessionAuthorityMatches(event.report, outcomeEvent.outcome.sessionId)
          )
        )
      ) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail:
              `outcome TaskWorkSessionEstablished has no prior matching session report for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        outcomeEvent._tag === "TaskExecutionOutcomeObserved"
        && !records.slice(0, index).some(({ event }) => {
          if (event._tag !== "TaskExecutionReported" || event.operationId !== operationId) return false
          return executionAuthorityMatches(event.report, outcomeEvent.outcome.outcome)
        })
      ) {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail:
              `outcome TaskExecutionOutcomeObserved has no matching prior execution report for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        record.event._tag === "TaskWorktreeReady"
        && matchingIntent?._tag === "TaskWorktreeReconciliationIntended"
        && (
          record.event.proof.baseSha !== matchingIntent.operation.plannedAttempt.baseSha
          || record.event.proof.branch !== matchingIntent.operation.plannedAttempt.branch
          || record.event.proof.worktree !== matchingIntent.operation.plannedAttempt.worktree
        )
      ) {
        issues.push(
          new ManagedHistoryIdentityIssue({
            detail: `outcome TaskWorktreeReady contradicts the planned attempt for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      if (
        record.event._tag === "ImplementationEvidenceSealed"
        && matchingIntent?._tag === "ImplementationEvidenceSealingIntended"
        && (
          record.event.sealed.manifest.runId !== matchingIntent.operation.plannedAttempt.runId
          || record.event.sealed.manifest.taskId !== matchingIntent.operation.plannedAttempt.taskId
          || record.event.sealed.manifest.plannedBaseSha !== matchingIntent.operation.plannedAttempt.baseSha
        )
      ) {
        issues.push(
          new ManagedHistoryIdentityIssue({
            detail: `outcome ImplementationEvidenceSealed contradicts the planned attempt for operation ${operationId}`,
            position: record.position,
            runId
          })
        )
      }
      const prior = outcomes.get(operationId)
      if (prior === undefined) outcomes.set(operationId, record.event)
      else {
        issues.push(
          new ManagedHistorySemanticIssue({
            detail: semanticDuplicateDetail("outcome", `operation ${operationId}`, prior, record.event),
            position: record.position,
            runId
          })
        )
      }
    }
    if (
      record.event._tag === "ImplementationReviewCompleted"
      && !implementationReviewCausalChainMatches(records.slice(0, index + 1), record.event.review)
    ) {
      issues.push(
        new ManagedHistorySemanticIssue({
          detail: `implementation review round ${record.event.review.manifest.round} lacks its exact causal chain`,
          position: record.position,
          runId
        })
      )
    }
  })

  for (const [operationId, positionedFacts] of technicalRetryFacts) {
    const analysis = analyzeTechnicalRetryFacts(positionedFacts.map(({ event }) => event))
    for (const [factIndex, positionedFact] of positionedFacts.entries()) {
      for (const issue of analysis.issues.filter((candidate) => candidate.factIndex === factIndex)) {
        issues.push(
          issue._tag === "Identity"
            ? new ManagedHistoryIdentityIssue({ detail: issue.detail, position: positionedFact.position, runId })
            : new ManagedHistorySemanticIssue({ detail: issue.detail, position: positionedFact.position, runId })
        )
      }
    }
    for (const issue of analyzeTechnicalRetryTemporalFacts(records, operationId)) {
      issues.push(
        issue._tag === "Identity"
          ? new ManagedHistoryIdentityIssue({ detail: issue.detail, position: issue.position, runId })
          : new ManagedHistorySemanticIssue({ detail: issue.detail, position: issue.position, runId })
      )
    }
  }

  for (const { disposition, position } of technicalExhaustions) {
    const scope = technicalRetryScopeForConvergenceExhaustion(disposition)
    const analysis = analyzeTechnicalRetryFacts(
      (technicalRetryFacts.get(scope.operationId) ?? []).map(({ event: fact }) => fact),
      scope
    )
    const successfulOutcomeExists = successfulConvergenceInvocationOutcomeExists(records, disposition)
    const causalChainMatches = disposition._tag === "ReviewTechnicalRetryExhausted"
      ? implementationReviewRequestCausalChainMatches(records, disposition.request)
      : reviewFindingsHandbackCausalChainMatches(records, disposition.request)
    if (
      successfulOutcomeExists
      || !causalChainMatches
      || analysis.policy === undefined
      || analysis.progress.pendingDeferral !== undefined
      || Number(analysis.progress.activeRetryOrdinal) !== Number(analysis.policy.limit)
    ) {
      issues.push(
        new ManagedHistorySemanticIssue({
          detail:
            `technical exhaustion for operation ${scope.operationId} was recorded before its captured retry limit`,
          position,
          runId
        })
      )
    }
  }

  return issues.length === 0
    ? { _tag: "ValidManagedHistory", records, runId }
    : { _tag: "InvalidManagedHistory", issues, records, runId }
}
