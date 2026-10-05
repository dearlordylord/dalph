import { Effect } from "effect"
import { it as effectIt } from "@effect/vitest"
import { makeTraceReader, TraceCursor } from "../../../presentation/trace-reader.js"
import { it, expect } from "vitest"
import { GitCommitSha, WorktreeLocator, makeTaskWorkSpecification } from "@dalph/contracts"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { integratorCorrelationFor } from "../integrator/session.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TargetPromotionSafetyRefusedEvent,
  TargetPromotionSafetyObservationOrdinal,
  TargetPromotionAttemptOrdinal,
  targetPromotionCorrelationFor
} from "./events.js"
import { deriveTargetPromotionState } from "./state.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"

const source = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Validate safety observation chronology",
  taskId: source.taskId,
  title: "Safety chronology"
})
const accepted = makeAcceptedIntegrationHistory({
  acceptedResult: source.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: source.activeClaim,
  integrationTarget: source.integrationTarget,
  plannedAttempt: { ...source.plannedAttempt, taskRevision: specification.fingerprint },
  taskSpecification: specification,
  runId: source.runId,
  targetHeadSha: source.qualifiedCandidate.run.session.expectedTargetHead,
  trackerTarget: source.target
})
const promoted = makePromotedIntegrationHistory({
  candidateCommit: source.qualifiedCandidate.candidateCommit,
  candidateText: source.qualifiedCandidate.candidateText,
  originalClaim: accepted.activeClaim,
  records: accepted.records,
  session: integratorCorrelationFor(accepted)
})
const correlation = promoted.promotionCorrelation
const intentPosition = promoted.promotedRecords.findIndex(
  ({ event }) => event._tag === "TargetPromotionAttemptIntended"
)
const initial = promoted.promotedRecords.slice(0, intentPosition)
const refusal = TargetPromotionSafetyRefusedEvent.make({
  boundary: "ReconciliationRead",
  correlation,
  basis: { _tag: "BeforeFirstAttempt" },
  observationOrdinal: TargetPromotionSafetyObservationOrdinal.make(1),
  refusal: { _tag: "OccupiedWorktree", worktree: WorktreeLocator.make("/foreign/worktree") },
  version: workflowJournalEventVersion
})
const append = (
  records: ReadonlyArray<JournalRecord>,
  event: TargetPromotionSafetyRefusedEvent
): ReadonlyArray<JournalRecord> => [
  ...records,
  {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(records.length + 1),
    runId: source.runId
  }
]

it("rejects promotion refusals with foreign correlation, stale basis, skipped or duplicate ordinal, or terminal predecessor", () => {
  const valid = append(initial, refusal)
  expect(reduceWorkflowJournalHistory(source.runId, valid)._tag).toBe("ValidWorkflowJournalHistory")
  expect(deriveTargetPromotionState(valid, correlation)?._tag).toBe("PromotionSafetyRefused")
  const foreign = targetPromotionCorrelationFor({
    ...promoted.qualifiedCandidate,
    candidateCommit: GitCommitSha.make("f".repeat(40))
  })
  const controls = [
    append(initial, { ...refusal, correlation: foreign }),
    append(initial, {
      ...refusal,
      basis: { _tag: "AfterAttempt" as const, attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) }
    }),
    append(initial, { ...refusal, observationOrdinal: TargetPromotionSafetyObservationOrdinal.make(2) }),
    append(valid, refusal),
    append(promoted.promotedRecords, {
      ...refusal,
      basis: { _tag: "AfterAttempt" as const, attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) }
    })
  ]
  for (const records of controls) {
    const result = reduceWorkflowJournalHistory(source.runId, records)
    expect(result._tag).toBe("InvalidWorkflowJournalHistory")
  }
})

effectIt.effect("shows a known mutation-boundary refusal in trace without an ambiguous promotion-result gap", () =>
  Effect.gen(function* () {
    const beforeSuccess = promoted.promotedRecords.slice(
      0,
      promoted.promotedRecords.findIndex(({ event }) => event._tag === "TargetPromotionObservedSuccess")
    )
    for (const boundary of ["CompareAndSet", "ReconciliationRead"] as const) {
      const records = append(beforeSuccess, {
        ...refusal,
        boundary,
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) }
      })
      const reader = makeTraceReader({ read: () => Effect.succeed(records) })
      const view = yield* reader.readAt(
        TraceCursor.make({ position: JournalPosition.make(records.length), runId: source.runId })
      )
      expect(view.facets.integration.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _tag: "PromotionSafetyRefused", boundary, refusal: refusal.refusal })
        ])
      )
      expect(view.facets.recovery.observationGaps.some(({ _tag }) => _tag === "PromotionResult")).toBe(
        boundary === "ReconciliationRead"
      )
    }
  })
)
