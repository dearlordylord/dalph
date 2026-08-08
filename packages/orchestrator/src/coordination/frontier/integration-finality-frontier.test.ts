import { describe, expect, it } from "vitest"
import { Option } from "effect"
import { AcceptedResult, AttemptId, TaskId } from "@dalph/contracts"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  deriveIntegrationAdmission,
  StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import {
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimRequestOrdinal,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementIntendedEvent,
  IntegrationFinalitySettledEvent,
  completionClaimDeletionOperationIdFor,
  completionClaimReplacementOperationIdFor
} from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import { integrationFinalityTransitionsFor } from "./integration-frontier.js"
import { integrationFinalityExplanationFor } from "./integration-finality-frontier.js"

const fixture = integrationFinalityFixture
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: AcceptedResult.make({
    commit: fixture.promotionCorrelation.candidateCorrelation.acceptedResultCommit
  }),
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: fixture.plannedAttempt,
  queuedAt: JournalPosition.make(4),
  startedAt: JournalPosition.make(5)
})
const promotion = TargetPromotionState.cases.PromotionSucceeded.make({
  basis: fixture.promotionSuccess.basis,
  correlation: fixture.promotionCorrelation,
  observation: fixture.promotionSuccess.observation
})
const replacementOperationId = completionClaimReplacementOperationIdFor(fixture.claim)
const deletionOperationId = completionClaimDeletionOperationIdFor(fixture.claim)
const runtimeFacts = {
  activeClaimByAttemptId: new Map([[fixture.plannedAttempt.attemptId, fixture.activeClaim]]),
  currentTrackerTaskIds: new Set([fixture.taskId]),
  heldResponsibilityPositions: new Set<JournalPosition>(),
  integrationFinalityConfigured: true,
  integrationTarget: Option.none(),
  taskClaimAuthorityByAttemptId: new Map()
}

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`integration-finality-frontier:${position}`),
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const replacementRecords = [
  record(
    6,
    CompletionClaimReplacementIntendedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  ),
  record(
    7,
    CompletionClaimReplacedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  )
]

describe("#141 integration-finality frontier", () => {
  it("replaces the exact active claim with a promotion-bound completion claim", () => {
    expect(integrationFinalityTransitionsFor([], responsibility, promotion, runtimeFacts)).toMatchObject([
      { _tag: "ReplacePromotedTaskClaim", request: { claim: fixture.claim, operationId: replacementOperationId } }
    ])
  })

  it("waits for fresh tracker success after replacement without reintegration", () => {
    expect(integrationFinalityTransitionsFor(replacementRecords, responsibility, promotion, runtimeFacts)).toEqual([])
  })

  it("keeps only read-only replacement reconciliation available after bounded mutation", () => {
    const records = [
      record(
        6,
        CompletionClaimReplacementIntendedEvent.make({
          claim: fixture.claim,
          operationId: replacementOperationId,
          version: workflowJournalEventVersion
        })
      ),
      ...[1, 2, 3].map((attemptOrdinal, offset) =>
        record(
          7 + offset,
          CompletionClaimReplacementAttemptIntendedEvent.make({
            attemptOrdinal: CompletionClaimRequestOrdinal.make(attemptOrdinal),
            claim: fixture.claim,
            operationId: replacementOperationId,
            version: workflowJournalEventVersion
          })
        )
      )
    ]

    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toMatchObject([
      { _tag: "ReplacePromotedTaskClaim", request: { operationId: replacementOperationId } }
    ])
    expect(integrationFinalityExplanationFor(records, responsibility, promotion, runtimeFacts)).toMatchObject({
      _tag: "IntegrationFinalityNonConvergence",
      operationId: replacementOperationId,
      phase: "Replacement"
    })
  })

  it("keeps only read-only deletion reconciliation available after bounded mutation", () => {
    const successObservation = { ...fixture.successObservation, observedAt: JournalPosition.make(8) }
    const records = [
      ...replacementRecords,
      record(8, fixture.graphRecordEvent),
      record(
        9,
        CompletionClaimDeletionIntendedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation,
          version: workflowJournalEventVersion
        })
      ),
      ...[1, 2, 3].map((attemptOrdinal, offset) =>
        record(
          10 + offset,
          CompletionClaimDeletionAttemptIntendedEvent.make({
            attemptOrdinal: CompletionClaimRequestOrdinal.make(attemptOrdinal),
            claim: fixture.claim,
            operationId: deletionOperationId,
            successObservation,
            version: workflowJournalEventVersion
          })
        )
      )
    ]

    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toMatchObject([
      { _tag: "DeleteCompletedTaskCompletionClaim", request: { operationId: deletionOperationId } }
    ])
    expect(integrationFinalityExplanationFor(records, responsibility, promotion, runtimeFacts)).toMatchObject({
      _tag: "IntegrationFinalityNonConvergence",
      operationId: deletionOperationId,
      phase: "Deletion"
    })
  })

  it("waits on exact configuration and fresh tracker-success boundaries", () => {
    expect(
      integrationFinalityExplanationFor([], responsibility, promotion, {
        ...runtimeFacts,
        integrationFinalityConfigured: false
      })
    ).toMatchObject({ _tag: "IntegrationFinalityConfigurationWait" })
    expect(
      integrationFinalityExplanationFor(replacementRecords, responsibility, promotion, runtimeFacts)
    ).toMatchObject({ _tag: "IntegrationFinalityTrackerSuccessWait" })
    expect(
      integrationFinalityExplanationFor([], responsibility, promotion, {
        ...runtimeFacts,
        activeClaimByAttemptId: new Map()
      })
    ).toMatchObject({ _tag: "IntegrationInProgress" })
  })

  it("does not derive finality work without configured runtime or the exact active claim", () => {
    expect(
      integrationFinalityTransitionsFor([], responsibility, promotion, {
        ...runtimeFacts,
        integrationFinalityConfigured: false
      })
    ).toEqual([])
    expect(
      integrationFinalityTransitionsFor([], responsibility, promotion, {
        ...runtimeFacts,
        activeClaimByAttemptId: new Map()
      })
    ).toEqual([])
  })

  it("deletes only the exact completion claim after fresh tracker success", () => {
    const records = [...replacementRecords, record(8, fixture.graphRecordEvent)]
    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toMatchObject([
      {
        _tag: "DeleteCompletedTaskCompletionClaim",
        replacementOperationId,
        request: { claim: fixture.claim, operationId: deletionOperationId }
      }
    ])
  })

  it("proposes no work after the exact task settlement becomes final", () => {
    const deletionIntent = CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: { ...fixture.successObservation, observedAt: JournalPosition.make(8) },
      version: workflowJournalEventVersion
    })
    const deletion = CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: deletionIntent.successObservation,
      version: workflowJournalEventVersion
    })
    const settlement = IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation: deletion.successObservation,
      version: workflowJournalEventVersion
    })
    const records = [
      ...replacementRecords,
      record(8, fixture.graphRecordEvent),
      record(9, deletionIntent),
      record(10, deletion),
      record(11, settlement)
    ]
    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toEqual([])
  })

  it("resumes settlement after deletion was recorded but before task finality was recorded", () => {
    const deletionIntent = CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: { ...fixture.successObservation, observedAt: JournalPosition.make(8) },
      version: workflowJournalEventVersion
    })
    const deletion = CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: deletionIntent.successObservation,
      version: workflowJournalEventVersion
    })
    expect(
      integrationFinalityTransitionsFor(
        [...replacementRecords, record(8, fixture.graphRecordEvent), record(9, deletionIntent), record(10, deletion)],
        responsibility,
        promotion,
        runtimeFacts
      )
    ).toMatchObject([{ _tag: "DeleteCompletedTaskCompletionClaim" }])
  })

  it("settles only the promoted task and preserves unrelated responsibilities", () => {
    const taskB = TaskId.make("integration-finality-task-b")
    const attemptB = {
      ...fixture.plannedAttempt,
      attemptId: AttemptId.make("integration-finality-attempt-b"),
      taskId: taskB
    }
    const acceptedA = responsibility.acceptedResult
    const acceptedB = AcceptedResult.make({ commit: fixture.promotionCorrelation.expectedTargetHead })
    const queueA = IntegrationResponsibilityBeganEvent.make({
      acceptedResult: acceptedA,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: fixture.plannedAttempt,
      version: workflowJournalEventVersion
    })
    const queueB = IntegrationResponsibilityBeganEvent.make({
      acceptedResult: acceptedB,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: attemptB,
      version: workflowJournalEventVersion
    })
    const startA = IntegrationStartedEvent.make({
      acceptedResult: acceptedA,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: fixture.plannedAttempt,
      responsibilityBeganAt: JournalPosition.make(1),
      version: workflowJournalEventVersion
    })
    const startB = IntegrationStartedEvent.make({
      acceptedResult: acceptedB,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: attemptB,
      responsibilityBeganAt: JournalPosition.make(3),
      version: workflowJournalEventVersion
    })
    const settlement = IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation: { ...fixture.successObservation, observedAt: JournalPosition.make(8) },
      version: workflowJournalEventVersion
    })
    const admission = deriveIntegrationAdmission([
      record(1, queueA),
      record(2, startA),
      record(3, queueB),
      record(4, startB),
      ...replacementRecords,
      record(8, fixture.graphRecordEvent),
      record(
        9,
        CompletionClaimDeletionIntendedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation: settlement.successObservation,
          version: workflowJournalEventVersion
        })
      ),
      record(
        10,
        CompletionClaimDeletedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation: settlement.successObservation,
          version: workflowJournalEventVersion
        })
      ),
      record(11, settlement)
    ])

    expect(admission.responsibilities.map(({ plannedAttempt }) => plannedAttempt.taskId)).toEqual([taskB])
  })
})
