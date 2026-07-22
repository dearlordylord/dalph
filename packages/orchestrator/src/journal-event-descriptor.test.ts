import { expect, it } from "vitest"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import type { WorkflowJournalEvent } from "./journal-store.js"

const runId = "descriptor-run"
const operationId = "descriptor-operation"
const observationId = "descriptor-observation"
const event = (input: unknown): WorkflowJournalEvent => input as WorkflowJournalEvent

it("defines canonical keys and predecessors for every journal event variant", () => {
  const cases: ReadonlyArray<readonly [WorkflowJournalEvent, string, string?]> = [
    [
      event({ _tag: "TrackerGraphObservationIntentRecorded", operation: { operationId } }),
      `operation:${operationId}:intent`
    ],
    [
      event({ _tag: "TaskWorktreeReconciliationIntended", operation: { operationId, plannedAttempt: { runId } } }),
      `operation:${operationId}:intent`
    ],
    [
      event({ _tag: "ImplementationEvidenceSealingIntended", operation: { operationId, plannedAttempt: { runId } } }),
      `operation:${operationId}:intent`
    ],
    [
      event({
        _tag: "ImplementationReviewIntended",
        operation: { request: { operationId, plannedAttempt: { runId } } }
      }),
      `operation:${operationId}:intent`
    ],
    [
      event({ _tag: "ImplementationReviewIntended", operation: { request: { operationId } } }),
      `operation:${operationId}:intent`
    ],
    [
      event({
        _tag: "ReviewFindingsHandbackIntended",
        operation: { request: { operationId, plannedAttempt: { runId } } }
      }),
      `operation:${operationId}:intent`
    ],
    [
      event({ _tag: "TaskClaimAcquisitionIntended", operation: { acquisition: { operationId } } }),
      `operation:${operationId}:intent`
    ],
    [
      event({
        _tag: "TaskWorkSessionEstablishmentIntentRecorded",
        operation: { request: { operationId, plannedAttempt: { runId } } }
      }),
      `operation:${operationId}:intent`
    ],
    [
      event({
        _tag: "TaskExecutionIntentRecorded",
        operation: { request: { operationId, plannedAttempt: { runId } } }
      }),
      `operation:${operationId}:intent`
    ],
    [event({ _tag: "TrackerGraphOutcomeObserved", operationId }), `operation:${operationId}:outcome`],
    [event({ _tag: "TaskWorktreeReady", operationId }), `operation:${operationId}:outcome`],
    [event({ _tag: "ImplementationEvidenceSealed", operationId }), `operation:${operationId}:outcome`],
    [event({ _tag: "TaskClaimAcquired", claim: { operationId } }), `operation:${operationId}:outcome`],
    [
      event({ _tag: "TaskWorkSessionEstablished", outcome: { operationId, sessionId: "descriptor-session" } }),
      `operation:${operationId}:outcome`
    ],
    [
      event({ _tag: "TaskExecutionOutcomeObserved", outcome: { outcome: { operationId } } }),
      `operation:${operationId}:outcome`
    ],
    [
      event({
        _tag: "ImplementationReviewCompleted",
        review: { manifest: { operationId, plannedAttempt: { runId } } }
      }),
      `operation:${operationId}:outcome`
    ],
    [
      event({ _tag: "ReviewFindingsHandbackCompleted", acknowledgement: { operationId } }),
      `operation:${operationId}:outcome`
    ],
    [
      event({
        _tag: "TaskAttemptPlanned",
        operation: { operationId, plannedAttempt: { attemptId: "attempt", runId } }
      }),
      "attempt:attempt:plan"
    ],
    [
      event({ _tag: "TaskWorkStartRequested", observationId, request: { operationId, plannedAttempt: { runId } } }),
      `provider-observation:${observationId}:request`
    ],
    [
      event({
        _tag: "TaskWorkSessionLookupRequested",
        lookup: { operationId, plannedAttempt: { runId } },
        observationId
      }),
      `provider-observation:${observationId}:request`
    ],
    [
      event({ _tag: "TaskWorkStartRequestAcknowledged", acknowledgement: { observationId }, operationId }),
      `operation:${operationId}:task-work-start-acknowledged:${observationId}`,
      `provider-observation:${observationId}:request`
    ],
    [
      event({
        _tag: "TaskWorkStartRequestFailed",
        failure: { observationId },
        request: { operationId, plannedAttempt: { runId } }
      }),
      `operation:${operationId}:task-work-start-failed:${observationId}`,
      `provider-observation:${observationId}:request`
    ],
    [
      event({ _tag: "TaskWorkSessionLookupFailed", failure: { observationId }, operationId }),
      `operation:${operationId}:task-work-session-reported:${observationId}`,
      `provider-observation:${observationId}:request`
    ],
    [
      event({ _tag: "TaskWorkSessionReported", operationId, report: { observationId } }),
      `operation:${operationId}:task-work-session-reported:${observationId}`,
      `provider-observation:${observationId}:request`
    ],
    [
      event({ _tag: "TaskWorkSessionResultReported", report: { observationId, sessionId: "descriptor-session" } }),
      `provider-observation:${observationId}:task-work-session-result`
    ],
    [
      event({ _tag: "TaskExecutionRequestAttemptRecorded", request: { operationId, plannedAttempt: { runId } } }),
      `operation:${operationId}:task-execution-request-attempt`
    ],
    [
      event({ _tag: "TaskExecutionRequestReturned", acknowledgement: { observationId }, operationId }),
      `operation:${operationId}:task-execution-request-returned:${observationId}`,
      `operation:${operationId}:task-execution-request-attempt`
    ],
    [
      event({
        _tag: "TaskExecutionRequestFailed",
        failure: { observationId },
        request: { operationId, plannedAttempt: { runId } }
      }),
      `operation:${operationId}:task-execution-request-failed:${observationId}`,
      `operation:${operationId}:task-execution-request-attempt`
    ],
    [
      event({ _tag: "TaskExecutionObservationFailed", failure: { observationId }, operationId }),
      `operation:${operationId}:task-execution-observation-failed:${observationId}`
    ],
    [
      event({ _tag: "TaskExecutionReported", operationId, report: { observationId } }),
      `operation:${operationId}:task-execution-reported:${observationId}`
    ],
    [
      event({ _tag: "TechnicalRetryPolicyCaptured", scope: { operationId } }),
      `operation:${operationId}:technical-retry-policy`
    ],
    [
      event({ _tag: "TechnicalRetryScheduled", retryOrdinal: 2, scope: { operationId } }),
      `operation:${operationId}:technical-retry:2`,
      `operation:${operationId}:technical-retry-policy`
    ]
  ]

  for (const [journalEvent, expectedKey, requiredPredecessorKey] of cases) {
    const descriptor = describeJournalEvent(journalEvent)
    expect(descriptor).toMatchObject({ expectedKey })
    expect(
      descriptor._tag === "OperationEventDescriptor"
        && descriptor.recordPredecessor._tag === "RequiredRecordPredecessor"
        ? descriptor.recordPredecessor.key
        : undefined
    ).toBe(requiredPredecessorKey)
  }
})
