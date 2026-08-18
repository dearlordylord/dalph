import { describe, expect, it } from "vitest"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { Option } from "effect"
import { AttemptId, TaskId } from "@dalph/contracts"
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
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAcknowledgement,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal,
  IntegrationFinalitySettledEvent,
  completionClaimDeletionOperationIdFor,
  completionClaimReplacementOperationIdFor
} from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeCompletionTaskFactsObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import { integrationFinalityTransitionsFor } from "./integration-frontier.js"
import { integrationFinalityExplanationFor } from "./integration-finality-frontier.js"

const fixture = integrationFinalityFixture
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
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
const completionRuntimeFacts = { ...runtimeFacts, completionTaskConfigured: true }
const completionIntent = CompletionTaskIntendedEvent.make({
  request: fixture.completionRequest,
  version: workflowJournalEventVersion
})

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`integration-finality-frontier:${position}`),
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const replacementRecords = [
  record(
    5,
    CompletionClaimReplacementIntendedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  ),
  record(
    6,
    CompletionClaimReplacedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    })
  )
]

const focusedSuccessAt = (position: number) => {
  const observation = { ...fixture.successObservation, observedAt: JournalPosition.make(position) }
  return {
    observation,
    records: [
      record(position - 2, completionIntent),
      record(position - 1, fixture.focusedSuccessFactsReadIntentEvent),
      record(position, fixture.focusedSuccessFactsEvent)
    ]
  } as const
}

describe("#141 integration-finality frontier", () => {
  it("replaces the exact active claim with a promotion-bound completion claim", () => {
    expect(integrationFinalityTransitionsFor([], responsibility, promotion, runtimeFacts)).toMatchObject([
      { _tag: "ReplacePromotedTaskClaim", request: { claim: fixture.claim, operationId: replacementOperationId } }
    ])
  })

  it("waits for focused task-completion success after replacement without reintegration", () => {
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
    const focusedSuccess = focusedSuccessAt(9)
    const successObservation = focusedSuccess.observation
    const records = [
      ...replacementRecords,
      ...focusedSuccess.records,
      record(
        10,
        CompletionClaimDeletionIntendedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation,
          version: workflowJournalEventVersion
        })
      ),
      ...[1, 2, 3].map((attemptOrdinal, offset) =>
        record(
          11 + offset,
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

  it("waits on exact configuration and focused task-success boundaries", () => {
    expect(
      integrationFinalityExplanationFor([], responsibility, promotion, {
        ...runtimeFacts,
        integrationFinalityConfigured: false
      })
    ).toMatchObject({ _tag: "IntegrationFinalityConfigurationWait" })
    expect(integrationFinalityExplanationFor(replacementRecords, responsibility, promotion, runtimeFacts)).toEqual({
      _tag: "IntegrationFinalityTrackerSuccessWait",
      plannedAttempt: fixture.plannedAttempt,
      reason: { _tag: "FocusedConfirmationNotObserved" },
      wakeCondition: "TaskTrackerFactsObserved"
    })
    expect(
      integrationFinalityExplanationFor([], responsibility, promotion, {
        ...runtimeFacts,
        activeClaimByAttemptId: new Map()
      })
    ).toMatchObject({ _tag: "IntegrationInProgress" })
  })

  it("shows the exact focused task conflict while keeping the promoted task local", () => {
    const focusedOperation = makeCompletionTaskFactsObservationOperation(
      fixture.completionRequest,
      fixture.target,
      CompletionTaskFocusedReadPurpose.cases.Authorization.make({
        authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1),
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1)
      })
    )
    const focusedObservation = makeFocusedTaskCompletionFactsObserved(focusedOperation, {
      ...fixture.focusedSuccessFactsEvent.observation.facts,
      lifecycle: "TerminalWithoutSuccess" as const,
      operationId: focusedOperation.operationId
    })
    const focusedFacts = taskTrackerFactsObservedEvent(focusedOperation.operationId, focusedObservation)
    const focusedIntent = taskTrackerReadIntent(focusedOperation)

    expect(
      integrationFinalityExplanationFor(
        [...replacementRecords, record(7, completionIntent), record(8, focusedIntent), record(9, focusedFacts)],
        responsibility,
        promotion,
        runtimeFacts
      )
    ).toMatchObject({
      _tag: "IntegrationFinalityTrackerSuccessWait",
      plannedAttempt: fixture.plannedAttempt,
      reason: {
        _tag: "FocusedCompletionConflict",
        operationId: focusedFacts.operationId,
        reason: "TaskLifecycleConflict"
      }
    })
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

  it("deletes only the exact completion claim after focused task-local success", () => {
    const records = [...replacementRecords, ...focusedSuccessAt(9).records]
    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toMatchObject([
      {
        _tag: "DeleteCompletedTaskCompletionClaim",
        replacementOperationId,
        request: { claim: fixture.claim, operationId: deletionOperationId }
      }
    ])
  })

  it("does not use a later complete graph as completion-claim cleanup authority", () => {
    const records = [...replacementRecords, record(8, fixture.graphRecordEvent)]
    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toEqual([])
  })

  it("retries the exact completion request only after the tracker positively reports NotApplied", () => {
    const request = fixture.completionRequest
    const lookup = CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      lookup: CompletionTaskRequestLookup.cases.NotApplied.make({ request }),
      operationId: request.operationId,
      request,
      version: workflowJournalEventVersion
    })

    expect(
      integrationFinalityTransitionsFor(
        [...replacementRecords, record(8, lookup)],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject([{ _tag: "CompletePromotedTask", request }])
  })

  it("keeps an unreadable exact-request lookup waiting until a newer complete graph permits a focused reread", () => {
    const request = fixture.completionRequest
    const unreadable = CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      lookup: CompletionTaskRequestLookup.cases.Unreadable.make({ detail: "tracker lookup unavailable", request }),
      operationId: request.operationId,
      request,
      version: workflowJournalEventVersion
    })
    const waiting = [...replacementRecords, record(8, unreadable)]

    expect(integrationFinalityTransitionsFor(waiting, responsibility, promotion, completionRuntimeFacts)).toEqual([])
    expect(
      integrationFinalityTransitionsFor(
        [...waiting, record(9, fixture.graphRecordEvent)],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject([{ _tag: "ObserveFocusedTaskCompletion", request }])
  })

  it("uses a newer unchanged complete-graph reconfirmation to wake an unreadable exact-request lookup", () => {
    const request = fixture.completionRequest
    const unreadable = CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      lookup: CompletionTaskRequestLookup.cases.Unreadable.make({ detail: "tracker lookup unavailable", request }),
      operationId: request.operationId,
      request,
      version: workflowJournalEventVersion
    })
    const priorGraph = record(7, fixture.graphRecordEvent)
    const waiting = [...replacementRecords, priorGraph, record(8, unreadable)]
    const reconfirmationOperation = makeTrackerGraphObservationOperation(
      OperationId.make("integration-finality-unchanged-graph-reconfirmation"),
      fixture.target,
      [fixture.graphOperation.operationId],
      [fixture.taskId]
    )
    const reconfirmation = makeTaskTrackerFactsObservedFromRead(
      [priorGraph],
      reconfirmationOperation,
      fixture.graphSnapshot
    )
    expect(reconfirmation.observation._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")

    expect(
      integrationFinalityTransitionsFor(
        [...waiting, record(9, reconfirmation)],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject([{ _tag: "ObserveFocusedTaskCompletion", request }])
  })

  it("requires focused confirmation after a durable Applied exact-request lookup", () => {
    const request = fixture.completionRequest
    const applied = CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      lookup: CompletionTaskRequestLookup.cases.Applied.make({ request }),
      operationId: request.operationId,
      request,
      version: workflowJournalEventVersion
    })
    expect(
      integrationFinalityTransitionsFor(
        [...replacementRecords, record(8, applied)],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject([{ _tag: "ObserveFocusedTaskCompletion", request }])
  })

  it("selects exact cleanup directly from durable focused success after acknowledgement", () => {
    const request = fixture.completionRequest
    const acknowledgement = CompletionTaskAcknowledgedEvent.make({
      acknowledgement: CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId }),
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      request,
      version: workflowJournalEventVersion
    })

    expect(
      integrationFinalityTransitionsFor(
        [
          ...replacementRecords,
          record(7, completionIntent),
          record(8, acknowledgement),
          record(9, fixture.focusedSuccessFactsReadIntentEvent),
          record(10, fixture.focusedSuccessFactsEvent)
        ],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject([
      {
        _tag: "DeleteCompletedTaskCompletionClaim",
        request: {
          claim: fixture.claim,
          successObservation: { ...fixture.successObservation, observedAt: JournalPosition.make(10) }
        }
      }
    ])
  })

  it("reports pending confirmation without inventing a normalization wait after durable success", () => {
    const pendingFacts = {
      ...fixture.focusedSuccessFactsEvent,
      observation: {
        ...fixture.focusedSuccessFactsEvent.observation,
        facts: {
          ...fixture.focusedSuccessFactsEvent.observation.facts,
          currentClaim: fixture.claim,
          lifecycle: "Open" as const
        }
      }
    }

    expect(
      integrationFinalityExplanationFor(
        [
          ...replacementRecords,
          record(7, completionIntent),
          record(8, fixture.focusedSuccessFactsReadIntentEvent),
          record(9, pendingFacts)
        ],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject({
      _tag: "IntegrationFinalityTrackerSuccessWait",
      reason: { _tag: "FocusedCompletionPending", operationId: pendingFacts.operationId }
    })
    expect(
      integrationFinalityExplanationFor(
        [
          ...replacementRecords,
          record(7, completionIntent),
          record(8, fixture.focusedSuccessFactsReadIntentEvent),
          record(9, fixture.focusedSuccessFactsEvent)
        ],
        responsibility,
        promotion,
        completionRuntimeFacts
      )
    ).toMatchObject({ _tag: "IntegrationInProgress" })
  })

  it("proposes no work after the exact task settlement becomes final", () => {
    const focusedSuccess = focusedSuccessAt(9)
    const deletionIntent = CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: focusedSuccess.observation,
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
      ...focusedSuccess.records,
      record(10, deletionIntent),
      record(11, deletion),
      record(12, settlement)
    ]
    expect(integrationFinalityTransitionsFor(records, responsibility, promotion, runtimeFacts)).toEqual([])
  })

  it("resumes settlement after deletion was recorded but before task finality was recorded", () => {
    const focusedSuccess = focusedSuccessAt(9)
    const deletionIntent = CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: focusedSuccess.observation,
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
        [...replacementRecords, ...focusedSuccess.records, record(10, deletionIntent), record(11, deletion)],
        responsibility,
        promotion,
        runtimeFacts
      )
    ).toMatchObject([{ _tag: "DeleteCompletedTaskCompletionClaim" }])
  })

  it("settles only the promoted task and preserves unrelated responsibilities", () => {
    const focusedSuccess = focusedSuccessAt(9)
    const taskB = TaskId.make("integration-finality-task-b")
    const attemptB = {
      ...fixture.plannedAttempt,
      attemptId: AttemptId.make("integration-finality-attempt-b"),
      taskId: taskB
    }
    const acceptedA = responsibility.acceptedResult
    const acceptedB = acceptedResultFixture(
      fixture.promotionCorrelation.qualifiedCandidate.run.session.expectedTargetHead
    )
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
      successObservation: focusedSuccess.observation,
      version: workflowJournalEventVersion
    })
    const admission = deriveIntegrationAdmission([
      record(1, queueA),
      record(2, startA),
      record(3, queueB),
      record(4, startB),
      ...replacementRecords,
      ...focusedSuccess.records,
      record(
        10,
        CompletionClaimDeletionIntendedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation: settlement.successObservation,
          version: workflowJournalEventVersion
        })
      ),
      record(
        11,
        CompletionClaimDeletedEvent.make({
          claim: fixture.claim,
          operationId: deletionOperationId,
          successObservation: settlement.successObservation,
          version: workflowJournalEventVersion
        })
      ),
      record(12, settlement)
    ])

    expect(admission.responsibilities.map(({ plannedAttempt }) => plannedAttempt.taskId)).toEqual([taskB])
  })
})
