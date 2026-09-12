import type { GitCommitSha } from "@dalph/contracts"
import { Effect } from "effect"
import type { ActiveTaskClaim } from "../../src/authorities/task-tracker/claim-mutation.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import type { JournalRecord } from "../../src/workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../src/workflow/registry/event-descriptor.js"
import {
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimRequestOrdinal,
  CompletionTaskClaim,
  type CompletionTaskRequest,
  completionClaimReplacementOperationIdFor,
  completionTaskRequestFor
} from "../../src/workflow/protocols/integration-finality/events.js"
import {
  type IntegratorCandidateText,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  type IntegratorSessionCorrelation,
  IntegratorSessionFixedEvent
} from "../../src/workflow/protocols/integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionIntendedEvent,
  TargetPromotionObservedSuccessEvent,
  type TargetPromotionCorrelation,
  type TargetPromotionObservedSuccessEvent as TargetPromotionObservedSuccessEventType,
  targetPromotionCorrelationFor
} from "../../src/workflow/protocols/target-promotion/events.js"

interface PromotedIntegrationHistory {
  readonly claim: CompletionTaskClaim
  readonly completionRequest: CompletionTaskRequest
  readonly promotedRecords: ReadonlyArray<JournalRecord>
  readonly promotionCorrelation: TargetPromotionCorrelation
  readonly promotionRecord: JournalRecord
  readonly promotionSuccess: TargetPromotionObservedSuccessEventType
  readonly qualifiedCandidate: IntegratorRunQualifiedCandidate
  readonly qualifiedRecords: ReadonlyArray<JournalRecord>
  readonly replacedRecords: ReadonlyArray<JournalRecord>
  readonly replacementRecord: JournalRecord
}

/**
 * Test setup for real completion boundary scenarios. The supplied history must
 * already contain the exact started integration and target-lineage observation.
 * Each later position comes from the record just appended; this helper neither
 * repairs a partial history nor supplies an accepted-reader runtime adapter.
 */
export const makePromotedIntegrationHistory = (input: {
  readonly records: ReadonlyArray<JournalRecord>
  readonly session: IntegratorSessionCorrelation
  readonly candidateCommit: GitCommitSha
  readonly candidateText: IntegratorCandidateText
  readonly originalClaim: ActiveTaskClaim
}): PromotedIntegrationHistory => {
  const runId = input.session.plannedAttempt.runId
  const append = (records: ReadonlyArray<JournalRecord>, event: JournalRecord["event"]) => {
    const appended: JournalRecord = {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(records.length + 1),
      runId
    }
    const next = [...records, appended]
    const result = reduceWorkflowJournalHistory(runId, next)
    if (result._tag === "InvalidWorkflowJournalHistory") {
      return Effect.runSync(
        Effect.die(`invalid completion fixture after ${event._tag}: ${JSON.stringify(result.issues)}`)
      )
    }
    return { appended, records: next }
  }
  const version = workflowJournalEventVersion
  const fixed = append(input.records, IntegratorSessionFixedEvent.make({ correlation: input.session, version }))
  const run = { ordinal: IntegratorRunOrdinal.make(1), session: input.session }
  const started = append(fixed.records, IntegratorRunStartedEvent.make({ run, version }))
  const prepared = append(
    started.records,
    IntegratorRunResultRecordedEvent.make({
      result: { _tag: "PreparedCandidate", candidateText: input.candidateText, correlation: run },
      run,
      version
    })
  )
  const gitIntent = append(
    prepared.records,
    IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText: input.candidateText, run, version })
  )
  const directParents = [input.session.expectedTargetHead, input.session.acceptedResult.commit] as const
  const qualified = append(
    gitIntent.records,
    IntegratorRunCandidateGitObservedEvent.make({
      candidateText: input.candidateText,
      observation: { _tag: "Commit", candidateText: input.candidateText, commit: input.candidateCommit, directParents },
      run,
      version
    })
  )
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit: input.candidateCommit,
    candidateText: input.candidateText,
    directParents,
    qualifiedAt: qualified.appended.position,
    run
  })
  const promotionCorrelation = targetPromotionCorrelationFor(qualifiedCandidate)
  const promotionIntent = append(
    qualified.records,
    TargetPromotionIntendedEvent.make({ correlation: promotionCorrelation, version })
  )
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const promotionAttempt = append(
    promotionIntent.records,
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation: promotionCorrelation,
      reason: { _tag: "Initial", observedHeadSha: input.session.expectedTargetHead },
      version
    })
  )
  const promotionSuccess = TargetPromotionObservedSuccessEvent.make({
    basis: { _tag: "AfterAttempt", attemptOrdinal },
    correlation: promotionCorrelation,
    observation: { _tag: "CompareAndSetApplied", candidateAncestry: "Current", targetHeadSha: input.candidateCommit },
    version
  })
  const promoted = append(promotionAttempt.records, promotionSuccess)
  const claim = CompletionTaskClaim.make({
    originalClaim: input.originalClaim,
    plannedAttempt: input.session.plannedAttempt,
    promotionCorrelation
  })
  const operationId = completionClaimReplacementOperationIdFor(claim)
  const replacementIntent = append(
    promoted.records,
    CompletionClaimReplacementIntendedEvent.make({ claim, operationId, version })
  )
  const replacementAttempt = append(
    replacementIntent.records,
    CompletionClaimReplacementAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim,
      operationId,
      version
    })
  )
  const replaced = append(
    replacementAttempt.records,
    CompletionClaimReplacedEvent.make({ claim, operationId, version })
  )
  return {
    claim,
    completionRequest: completionTaskRequestFor(claim),
    promotedRecords: promoted.records,
    promotionCorrelation,
    promotionRecord: promoted.appended,
    promotionSuccess,
    qualifiedCandidate,
    qualifiedRecords: qualified.records,
    replacedRecords: replaced.records,
    replacementRecord: replaced.appended
  }
}
