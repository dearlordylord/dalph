import { it as effectIt } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  AttemptId,
  FixtureTarget,
  GitCommitSha,
  JournalEventKind,
  JournalEventVersion,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal,
  TrackerRevision,
  WorktreeLocator
} from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { decodeAndUpcastJournalEvent, encodeJournalEvent } from "./journal-event-codec.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  type JournalRecord,
  outcomeRecordKey,
  TaskAttemptPlannedEvent,
  TaskExecutionObservationFailed,
  TaskWorkSessionEstablishedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved,
  type WorkflowJournalEvent
} from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { TaskExecutionObservationFailure } from "./task-execution.js"
import { technicalRetryEventKinds } from "./technical-retry-event-kind.js"
import { analyzeTechnicalRetryTemporalFacts } from "./technical-retry-temporal.js"
import {
  TechnicalRetryPolicy,
  TechnicalRetryPolicyCapturedEvent,
  technicalRetryPolicyRecordKey,
  TechnicalRetryScheduledEvent,
  technicalRetryScheduledRecordKey,
  TechnicalRetryScope
} from "./technical-retry.js"
import { makeTrackerGraphObservationOperation, WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

const runId = RunId.make("managed-history-property-run")
const event = (input: unknown): WorkflowJournalEvent => input as WorkflowJournalEvent

const pair = (identity: string, position: number) => {
  const operationId = OperationId.make(identity)
  const operation = makeTrackerGraphObservationOperation(operationId, FixtureTarget.make(`target-${identity}`))
  const intent = trackerGraphObservationIntent(operation)
  const outcome = trackerGraphOutcomeObserved(operationId, {
    _tag: "TrackerGraphObserved",
    revision: TrackerRevision.make(`revision-${identity}`),
    taskIds: [TaskId.make(`task-${identity}`)]
  })
  return [
    { event: intent, key: intentRecordKey(operationId), position: JournalPosition.make(position), runId },
    { event: outcome, key: outcomeRecordKey(operationId), position: JournalPosition.make(position + 1), runId }
  ] as const
}

effectIt.effect(
  "roundtrips normalized current payloads and makes version-1 upcast idempotent",
  () =>
    Effect.tryPromise(() =>
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 24 }),
          async (identity) => {
            const event = pair(identity, 1)[0].event
            const encoded = encodeJournalEvent(event)
            const decoded = await Effect.runPromise(decodeAndUpcastJournalEvent(encoded))
            expect(decoded).toEqual(event)
            const legacy = {
              kind: JournalEventKind.make(encoded.kind),
              payloadJson: encoded.payloadJson,
              version: JournalEventVersion.make(1)
            }
            const upcast = await Effect.runPromise(decodeAndUpcastJournalEvent(legacy))
            const repeated = await Effect.runPromise(decodeAndUpcastJournalEvent(encodeJournalEvent(upcast)))
            expect(repeated).toEqual(upcast)
          }
        ),
        { numRuns: 100 }
      )
    )
)

effectIt.effect("rejects an unsupported immutable event version", () =>
  Effect.gen(function*() {
    const encoded = encodeJournalEvent(pair("future", 1)[0].event)
    const failure = yield* Effect.flip(
      decodeAndUpcastJournalEvent({
        ...encoded,
        version: JournalEventVersion.make(5)
      })
    )
    expect(failure._tag).toBe("JournalEventDecodeIssue")
  }))

effectIt.effect("rejects pre-v3 technical retry envelopes instead of guessing progress", () =>
  Effect.gen(function*() {
    yield* Effect.forEach(technicalRetryEventKinds, (kind) =>
      Effect.gen(function*() {
        const failure = yield* Effect.flip(
          decodeAndUpcastJournalEvent({
            kind: JournalEventKind.make(kind),
            payloadJson: "{}",
            version: JournalEventVersion.make(2)
          })
        )
        expect(failure).toBeInstanceOf(Error)
        expect(failure).toMatchObject({ _tag: "JournalEventDecodeIssue", kind, version: 2 })
      }))
  }))

effectIt.effect("rejects valid JSON whose payload is not an event object", () =>
  Effect.gen(function*() {
    const encoded = encodeJournalEvent(pair("wrong-shape", 1)[0].event)
    const failure = yield* Effect.flip(
      decodeAndUpcastJournalEvent({
        ...encoded,
        payloadJson: "[]"
      })
    )
    expect(failure._tag).toBe("JournalEventDecodeIssue")
  }))

it("accepts arbitrary legal operation interleavings while preserving canonical journal order", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 16 }), { minLength: 1, maxLength: 20 }),
      (identities) => {
        const pending = identities.map((identity) => pair(identity, 1))
        const intents: Array<JournalRecord> = pending.map(([intent]) => intent)
        const outcomes: Array<JournalRecord> = pending.map(([, outcome]) => outcome)
        const records = [...intents, ...outcomes]
          .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
        expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
      }
    ),
    { numRuns: 100 }
  )
})

it("accumulates independent position, run, key, and transition issues", () => {
  const outcome = pair("broken", 1)[1]
  const reduction = reduceManagedHistory(runId, [{
    ...outcome,
    key: JournalRecordKey.make("wrong-key"),
    position: JournalPosition.make(2),
    runId: RunId.make("foreign-run")
  }])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues).toHaveLength(4)
    expect(new Set(reduction.issues.map(({ _tag }) => _tag))).toEqual(
      new Set([
        "ManagedHistoryIdentityIssue",
        "ManagedHistorySemanticIssue"
      ])
    )
  }
})

it("reports duplicate and contradictory intents and outcomes without short-circuiting", () => {
  const [intent, outcome] = pair("duplicate", 1)
  const replacementOperation = makeTrackerGraphObservationOperation(
    OperationId.make("duplicate"),
    FixtureTarget.make("replacement-target")
  )
  const replacementIntent = trackerGraphObservationIntent(replacementOperation)
  const replacementOutcome = trackerGraphOutcomeObserved(OperationId.make("duplicate"), {
    _tag: "TrackerGraphObserved",
    revision: TrackerRevision.make("replacement-revision"),
    taskIds: []
  })
  const records: ReadonlyArray<JournalRecord> = [
    intent,
    { ...intent, key: JournalRecordKey.make("operation:duplicate:intent-copy"), position: JournalPosition.make(2) },
    {
      ...intent,
      event: replacementIntent,
      key: JournalRecordKey.make("operation:duplicate:intent-replacement"),
      position: JournalPosition.make(3)
    },
    { ...outcome, position: JournalPosition.make(4) },
    { ...outcome, key: JournalRecordKey.make("operation:duplicate:outcome-copy"), position: JournalPosition.make(5) },
    {
      ...outcome,
      event: replacementOutcome,
      key: JournalRecordKey.make("operation:duplicate:outcome-replacement"),
      position: JournalPosition.make(6)
    }
  ]
  const reduction = reduceManagedHistory(runId, records)
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      "duplicate intent for operation duplicate",
      "contradictory intents for operation duplicate",
      "duplicate outcome for operation duplicate",
      "contradictory outcomes for operation duplicate"
    ]))
  }
})

it("reports duplicate, contradictory, and foreign-run planned task attempts", () => {
  const plan = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("planned-attempt"),
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    branch: TaskBranchRef.make("refs/heads/dalph/planned-attempt"),
    executor: TaskExecutorLocator.make("executor:planned-attempt"),
    runId,
    session: TaskWorkSessionLocator.make("session:planned-attempt"),
    taskId: TaskId.make("planned-task"),
    taskRevision: TaskRevision.make("planned-revision"),
    worktree: WorktreeLocator.make("/tmp/planned-attempt")
  })
  const operation = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: OperationId.make("plan-operation"),
    plannedAttempt: plan,
    predecessorOperationIds: []
  })
  const replacement = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    ...operation,
    plannedAttempt: PlannedTaskAttempt.make({
      ...plan,
      executor: TaskExecutorLocator.make("executor:replacement"),
      runId: RunId.make("foreign-plan-run")
    })
  })
  const event = TaskAttemptPlannedEvent.make({ operation, version: 4 })
  const replacementEvent = TaskAttemptPlannedEvent.make({ operation: replacement, version: 4 })
  const reduction = reduceManagedHistory(runId, [
    { event, key: attemptPlanRecordKey(plan.attemptId), position: JournalPosition.make(1), runId },
    {
      event,
      key: JournalRecordKey.make("attempt:planned-attempt:plan-copy"),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: replacementEvent,
      key: JournalRecordKey.make("attempt:planned-attempt:plan-replacement"),
      position: JournalPosition.make(3),
      runId
    }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      "duplicate planned task attempt for attempt planned-attempt",
      "contradictory planned task attempts for attempt planned-attempt"
    ]))
  }
})

it("rejects a technical retry scope that changes the durable semantic review round", () => {
  const operationId = OperationId.make("crossed-semantic-round")
  const reviewerSessionId = ReviewerSessionId.make("crossed-semantic-reviewer")
  const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId,
    reviewerSessionId,
    semanticRound: SemanticReviewRound.make(2)
  })
  const captured = TechnicalRetryPolicyCapturedEvent.make({
    policy: TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(100),
      limit: TechnicalRetryLimit.make(2),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(200)
    }),
    scope,
    version: 4
  })
  const intent = event({
    _tag: "ImplementationReviewIntended",
    operation: {
      predecessorOperationIds: [],
      request: {
        _tag: "AuthorizedImplementationReview",
        operationId,
        plannedAttempt: { runId },
        reviewerSessionId,
        round: 1
      }
    }
  })
  const reduction = reduceManagedHistory(runId, [
    { event: captured, key: technicalRetryPolicyRecordKey(scope), position: JournalPosition.make(1), runId },
    { event: intent, key: intentRecordKey(operationId), position: JournalPosition.make(2), runId }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "technical retry scope contradicts the invocation intent for operation crossed-semantic-round"
    )
  }
})

it("rejects a later technical retry schedule before the exact prior deferral is superseded", () => {
  const operationId = OperationId.make("unsuperseded-deferral")
  const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId,
    reviewerSessionId: ReviewerSessionId.make("unsuperseded-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const policy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(100),
    limit: TechnicalRetryLimit.make(2),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(200)
  })
  const retryOne = TechnicalRetryScheduledEvent.make({
    delayMillis: TechnicalRetryDelayMillis.make(100),
    notBefore: TechnicalRetryNotBefore.make(100),
    retryOrdinal: TechnicalRetryOrdinal.make(1),
    scope,
    version: 4
  })
  const retryTwo = TechnicalRetryScheduledEvent.make({
    delayMillis: TechnicalRetryDelayMillis.make(200),
    notBefore: TechnicalRetryNotBefore.make(300),
    retryOrdinal: TechnicalRetryOrdinal.make(2),
    scope,
    version: 4
  })
  const reduction = reduceManagedHistory(runId, [
    {
      event: TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 4 }),
      key: technicalRetryPolicyRecordKey(scope),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: retryOne,
      key: technicalRetryScheduledRecordKey(scope, retryOne.retryOrdinal),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: retryTwo,
      key: technicalRetryScheduledRecordKey(scope, retryTwo.retryOrdinal),
      position: JournalPosition.make(3),
      runId
    }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "a later deferral precedes supersession of the active deferral"
    )
  }
})

it("rejects a retry schedule that physically precedes its exact review intent", () => {
  const operationId = OperationId.make("retry-before-review-intent")
  const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId,
    reviewerSessionId: ReviewerSessionId.make("retry-before-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const policy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(100),
    limit: TechnicalRetryLimit.make(1),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(100)
  })
  const scheduled = TechnicalRetryScheduledEvent.make({
    delayMillis: TechnicalRetryDelayMillis.make(100),
    notBefore: TechnicalRetryNotBefore.make(100),
    retryOrdinal: TechnicalRetryOrdinal.make(1),
    scope,
    version: 4
  })
  const intent = event({
    _tag: "ImplementationReviewIntended",
    operation: {
      predecessorOperationIds: [],
      request: {
        _tag: "AuthorizedImplementationReview",
        operationId,
        reviewerSessionId: scope.reviewerSessionId,
        round: scope.semanticRound
      }
    },
    version: 4
  })
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 4 }),
      key: technicalRetryPolicyRecordKey(scope),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: scheduled,
      key: technicalRetryScheduledRecordKey(scope, scheduled.retryOrdinal),
      position: JournalPosition.make(2),
      runId
    },
    { event: intent, key: intentRecordKey(operationId), position: JournalPosition.make(3), runId }
  ]

  const reduction = reduceManagedHistory(runId, records)
  const temporalIssues = analyzeTechnicalRetryTemporalFacts(records, operationId)
  expect(temporalIssues).toContainEqual(expect.objectContaining({
    _tag: "Semantic",
    position: JournalPosition.make(2)
  }))
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    for (const temporalIssue of temporalIssues) {
      expect(reduction.issues).toContainEqual(expect.objectContaining({
        _tag: `ManagedHistory${temporalIssue._tag}Issue`,
        detail: temporalIssue.detail,
        position: temporalIssue.position
      }))
    }
  }
})

it("rejects a retry schedule that physically follows its durable review outcome", () => {
  const operationId = OperationId.make("retry-after-review-outcome")
  const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId,
    reviewerSessionId: ReviewerSessionId.make("retry-after-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const policy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(100),
    limit: TechnicalRetryLimit.make(1),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(100)
  })
  const scheduled = TechnicalRetryScheduledEvent.make({
    delayMillis: TechnicalRetryDelayMillis.make(100),
    notBefore: TechnicalRetryNotBefore.make(100),
    retryOrdinal: TechnicalRetryOrdinal.make(1),
    scope,
    version: 4
  })
  const intent = event({
    _tag: "ImplementationReviewIntended",
    operation: {
      predecessorOperationIds: [],
      request: {
        _tag: "AuthorizedImplementationReview",
        operationId,
        reviewerSessionId: scope.reviewerSessionId,
        round: scope.semanticRound
      }
    },
    version: 4
  })
  const outcome = event({
    _tag: "ImplementationReviewCompleted",
    review: { manifest: { operationId } },
    version: 4
  })
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 4 }),
      key: technicalRetryPolicyRecordKey(scope),
      position: JournalPosition.make(1),
      runId
    },
    { event: intent, key: intentRecordKey(operationId), position: JournalPosition.make(2), runId },
    { event: outcome, key: outcomeRecordKey(operationId), position: JournalPosition.make(3), runId },
    {
      event: scheduled,
      key: technicalRetryScheduledRecordKey(scope, scheduled.retryOrdinal),
      position: JournalPosition.make(4),
      runId
    }
  ]

  const reduction = reduceManagedHistory(runId, records)
  const temporalIssues = analyzeTechnicalRetryTemporalFacts(records, operationId)
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    for (const temporalIssue of temporalIssues) {
      expect(reduction.issues).toContainEqual(expect.objectContaining({
        _tag: `ManagedHistory${temporalIssue._tag}Issue`,
        detail: temporalIssue.detail,
        position: temporalIssue.position
      }))
    }
  }
})

it("classifies orphan and crossed-scope retry facts while accepting exact review and handback bindings", () => {
  const reviewOperationId = OperationId.make("matching-review-retry")
  const reviewScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId: reviewOperationId,
    reviewerSessionId: ReviewerSessionId.make("matching-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const handbackOperationId = OperationId.make("matching-handback-retry")
  const reviewedOperationId = OperationId.make("matching-reviewed-operation")
  const handbackScope = TechnicalRetryScope.cases.ReviewFindingsHandbackInvocation.make({
    operationId: handbackOperationId,
    reviewOperationId: reviewedOperationId,
    semanticRound: SemanticReviewRound.make(1)
  })
  const orphanOperationId = OperationId.make("orphan-retry-fact")
  const orphanScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId: orphanOperationId,
    reviewerSessionId: ReviewerSessionId.make("orphan-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const foreignOrphanScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    ...orphanScope,
    reviewerSessionId: ReviewerSessionId.make("foreign-orphan-reviewer")
  })
  const policylessScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId: OperationId.make("policyless-retry-fact"),
    reviewerSessionId: ReviewerSessionId.make("policyless-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const retryPolicy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(100),
    limit: TechnicalRetryLimit.make(1),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(100)
  })
  const records = [
    {
      event: TechnicalRetryPolicyCapturedEvent.make({ policy: retryPolicy, scope: reviewScope, version: 4 }),
      key: technicalRetryPolicyRecordKey(reviewScope)
    },
    {
      event: event({
        _tag: "ImplementationReviewIntended",
        operation: {
          predecessorOperationIds: [],
          request: {
            _tag: "AuthorizedImplementationReview",
            operationId: reviewOperationId,
            plannedAttempt: { runId },
            reviewerSessionId: reviewScope.reviewerSessionId,
            round: reviewScope.semanticRound
          }
        }
      }),
      key: intentRecordKey(reviewOperationId)
    },
    {
      event: TechnicalRetryPolicyCapturedEvent.make({ policy: retryPolicy, scope: handbackScope, version: 4 }),
      key: technicalRetryPolicyRecordKey(handbackScope)
    },
    {
      event: event({
        _tag: "ReviewFindingsHandbackIntended",
        operation: {
          predecessorOperationIds: [],
          request: {
            operationId: handbackOperationId,
            plannedAttempt: { runId },
            review: { manifest: { round: handbackScope.semanticRound } },
            reviewOperationId: reviewedOperationId
          }
        }
      }),
      key: intentRecordKey(handbackOperationId)
    },
    {
      event: TechnicalRetryScheduledEvent.make({
        delayMillis: TechnicalRetryDelayMillis.make(100),
        notBefore: TechnicalRetryNotBefore.make(100),
        retryOrdinal: TechnicalRetryOrdinal.make(1),
        scope: orphanScope,
        version: 4
      }),
      key: technicalRetryScheduledRecordKey(orphanScope, TechnicalRetryOrdinal.make(1))
    },
    {
      event: TechnicalRetryPolicyCapturedEvent.make({ policy: retryPolicy, scope: orphanScope, version: 4 }),
      key: technicalRetryPolicyRecordKey(orphanScope)
    },
    {
      event: TechnicalRetryScheduledEvent.make({
        delayMillis: TechnicalRetryDelayMillis.make(100),
        notBefore: TechnicalRetryNotBefore.make(100),
        retryOrdinal: TechnicalRetryOrdinal.make(2),
        scope: foreignOrphanScope,
        version: 4
      }),
      key: technicalRetryScheduledRecordKey(foreignOrphanScope, TechnicalRetryOrdinal.make(2))
    },
    {
      event: TechnicalRetryScheduledEvent.make({
        delayMillis: TechnicalRetryDelayMillis.make(100),
        notBefore: TechnicalRetryNotBefore.make(100),
        retryOrdinal: TechnicalRetryOrdinal.make(1),
        scope: policylessScope,
        version: 4
      }),
      key: technicalRetryScheduledRecordKey(policylessScope, TechnicalRetryOrdinal.make(1))
    }
  ].map((record, index): JournalRecord => ({
    ...record,
    position: JournalPosition.make(index + 1),
    runId
  }))

  const reduction = reduceManagedHistory(runId, records)
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    const details = reduction.issues.map(({ detail }) => detail)
    expect(details).toContain("technical retry deferral precedes its captured policy")
    expect(details).toContain("technical retry facts cross active scopes")
    expect(details).not.toContain(
      "technical retry scope contradicts the invocation intent for operation matching-review-retry"
    )
    expect(details).not.toContain(
      "technical retry scope contradicts the invocation intent for operation matching-handback-retry"
    )
  }
})

it("reports provider observations and provider outcomes without their required predecessors", () => {
  const operationId = OperationId.make("orphan-provider-operation")
  const outcomeOperationId = OperationId.make("orphan-provider-outcome")
  const observation = TaskExecutionObservationFailed.make({
    failure: new TaskExecutionObservationFailure({
      detail: "unreadable",
      observationId: ProviderObservationId.make("orphan-observation"),
      operationId
    }),
    operationId,
    version: 4
  })
  const outcome = TaskWorkSessionEstablishedEvent.make({
    outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
      operationId: outcomeOperationId,
      sessionId: TaskWorkSessionId.make("orphan-session")
    }),
    version: 4
  })
  const reduction = reduceManagedHistory(runId, [
    {
      event: observation,
      key: JournalRecordKey.make("operation:orphan-provider-operation:observation"),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: outcome,
      key: outcomeRecordKey(outcomeOperationId),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") expect(reduction.issues).toHaveLength(5)
})

it("reports request returns and session results without their exact predecessors", () => {
  const requestReturn = event({
    _tag: "TaskExecutionRequestReturned",
    acknowledgement: { observationId: "request-return-observation" },
    operationId: "request-return-operation"
  })
  const sessionResult = event({
    _tag: "TaskWorkSessionResultReported",
    report: { observationId: "session-result-observation", sessionId: "unestablished-session" }
  })
  const reduction = reduceManagedHistory(runId, [
    {
      event: requestReturn,
      key: JournalRecordKey.make(
        "operation:request-return-operation:task-execution-request-returned:request-return-observation"
      ),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: sessionResult,
      key: JournalRecordKey.make("provider-observation:session-result-observation:task-work-session-result"),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      "event TaskExecutionRequestReturned has no prior record operation:request-return-operation:task-execution-request-attempt",
      "event TaskWorkSessionResultReported has no prior established session unestablished-session"
    ]))
  }
})

it("rejects an attempt intent whose declared causal graph omits its required plan", () => {
  const operationId = OperationId.make("orphan-worktree-operation")
  const orphanWorktreeIntent = event({
    _tag: "TaskWorktreeReconciliationIntended",
    operation: {
      operationId,
      plannedAttempt: { runId },
      predecessorOperationIds: [OperationId.make("missing-plan-operation")]
    }
  })
  const reduction = reduceManagedHistory(runId, [{
    event: orphanWorktreeIntent,
    key: intentRecordKey(operationId),
    position: JournalPosition.make(1),
    runId
  }])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "event TaskWorktreeReconciliationIntended has no direct predecessor event TaskAttemptPlanned"
    )
  }
})

it("rejects contradictory outer and provider-reported operation identities", () => {
  const operationId = OperationId.make("outer-execution-operation")
  const contradictory = event({
    _tag: "TaskExecutionObservationFailed",
    failure: {
      observationId: "contradictory-observation",
      operationId: "embedded-execution-operation"
    },
    operationId
  })
  const reduction = reduceManagedHistory(runId, [{
    event: contradictory,
    key: JournalRecordKey.make(
      "operation:outer-execution-operation:task-execution-observation-failed:contradictory-observation"
    ),
    position: JournalPosition.make(1),
    runId
  }])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "event TaskExecutionObservationFailed operation outer-execution-operation contradicts embedded operation embedded-execution-operation"
    )
  }
})

it("rejects a causal predecessor belonging to a different planned task attempt", () => {
  const first = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("causal-attempt-a"),
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    branch: TaskBranchRef.make("refs/heads/causal-attempt-a"),
    executor: TaskExecutorLocator.make("executor:causal-attempt-a"),
    runId,
    session: TaskWorkSessionLocator.make("session:causal-attempt-a"),
    taskId: TaskId.make("causal-task"),
    taskRevision: TaskRevision.make("causal-revision"),
    worktree: WorktreeLocator.make("/tmp/causal-attempt-a")
  })
  const second = PlannedTaskAttempt.make({
    ...first,
    attemptId: AttemptId.make("causal-attempt-b"),
    branch: TaskBranchRef.make("refs/heads/causal-attempt-b"),
    worktree: WorktreeLocator.make("/tmp/causal-attempt-b")
  })
  const planOperation = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: OperationId.make("causal-plan-a"),
    plannedAttempt: first,
    predecessorOperationIds: []
  })
  const worktreeOperation = WorkflowOperation.cases.ReconcileTaskWorktree.make({
    operationId: OperationId.make("causal-worktree-b"),
    plannedAttempt: second,
    predecessorOperationIds: [planOperation.operationId]
  })
  const reduction = reduceManagedHistory(runId, [
    {
      event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 }),
      key: attemptPlanRecordKey(first.attemptId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: 4 }),
      key: intentRecordKey(worktreeOperation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: TaskWorktreeReadyEvent.make({
        operationId: worktreeOperation.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: second.baseSha,
          branch: first.branch,
          headSha: second.baseSha,
          worktree: second.worktree
        }),
        version: 4
      }),
      key: outcomeRecordKey(worktreeOperation.operationId),
      position: JournalPosition.make(3),
      runId
    }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "event TaskWorktreeReconciliationIntended planned task attempt contradicts predecessor operation causal-plan-a"
    )
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "outcome TaskWorktreeReady contradicts the planned task attempt for operation causal-worktree-b"
    )
  }
})

it("rejects sealed evidence whose manifest contradicts its planned task attempt", () => {
  const operationId = OperationId.make("contradictory-evidence-operation")
  const plannedAttempt = {
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    runId,
    taskId: TaskId.make("evidence-task")
  }
  const reduction = reduceManagedHistory(runId, [
    {
      event: event({
        _tag: "ImplementationEvidenceSealingIntended",
        operation: { operationId, plannedAttempt, predecessorOperationIds: [] }
      }),
      key: intentRecordKey(operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: event({
        _tag: "ImplementationEvidenceSealed",
        operationId,
        sealed: {
          manifest: {
            plannedBaseSha: GitCommitSha.make("1111111111111111111111111111111111111111"),
            runId,
            taskId: plannedAttempt.taskId
          }
        }
      }),
      key: outcomeRecordKey(operationId),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "outcome ImplementationEvidenceSealed contradicts the planned task attempt for operation contradictory-evidence-operation"
    )
  }
})

it("rejects claim, session, and execution outcomes that contradict their provider evidence", () => {
  const claimOperationId = OperationId.make("relational-claim")
  const sessionOperationId = OperationId.make("relational-session")
  const executionOperationId = OperationId.make("relational-execution")
  const sessionId = TaskWorkSessionId.make("relational-session-id")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("relational-attempt"),
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    branch: TaskBranchRef.make("refs/heads/relational-attempt"),
    executor: TaskExecutorLocator.make("executor:relational-attempt"),
    runId,
    session: TaskWorkSessionLocator.make("session:relational-attempt"),
    taskId: TaskId.make("relational-task"),
    taskRevision: TaskRevision.make("relational-revision"),
    worktree: WorktreeLocator.make("/tmp/relational-attempt")
  })
  const records = [
    {
      event: event({
        _tag: "TaskClaimAcquisitionIntended",
        operation: {
          acquisition: { operationId: claimOperationId, owner: "owner-a", taskId: "task-a", token: "token-a" },
          predecessorOperationIds: []
        }
      }),
      key: intentRecordKey(claimOperationId)
    },
    {
      event: event({
        _tag: "TaskClaimAcquired",
        claim: { operationId: claimOperationId, owner: "owner-b", taskId: "task-a", token: "token-a" }
      }),
      key: outcomeRecordKey(claimOperationId)
    },
    {
      event: event({
        _tag: "TaskWorkSessionEstablishmentIntentRecorded",
        operation: { predecessorOperationIds: [], request: { operationId: sessionOperationId, plannedAttempt } }
      }),
      key: intentRecordKey(sessionOperationId)
    },
    {
      event: event({
        _tag: "TaskWorkSessionLookupRequested",
        lookup: { operationId: sessionOperationId, plannedAttempt },
        observationId: "no-session"
      }),
      key: JournalRecordKey.make("provider-observation:no-session:request")
    },
    {
      event: event({
        _tag: "TaskWorkSessionReported",
        operationId: sessionOperationId,
        report: { _tag: "NoMatchingTaskWorkSessionReported", observationId: "no-session" }
      }),
      key: JournalRecordKey.make(`operation:${sessionOperationId}:task-work-session-reported:no-session`)
    },
    {
      event: event({
        _tag: "TaskWorkSessionEstablished",
        outcome: { operationId: sessionOperationId, sessionId }
      }),
      key: outcomeRecordKey(sessionOperationId)
    },
    {
      event: event({
        _tag: "TaskExecutionIntentRecorded",
        operation: { predecessorOperationIds: [], request: { operationId: executionOperationId, plannedAttempt } }
      }),
      key: intentRecordKey(executionOperationId)
    },
    {
      event: event({
        _tag: "TaskExecutionReported",
        operationId: executionOperationId,
        report: {
          _tag: "NoTaskExecutionReported",
          observationId: "no-execution",
          operationId: executionOperationId,
          sessionId
        }
      }),
      key: JournalRecordKey.make(`operation:${executionOperationId}:task-execution-reported:no-execution`)
    },
    {
      event: event({
        _tag: "TaskExecutionOutcomeObserved",
        outcome: {
          outcome: {
            _tag: "Succeeded",
            observationId: "success",
            operationId: executionOperationId,
            output: "impossible",
            processId: "process",
            sessionId
          }
        }
      }),
      key: outcomeRecordKey(executionOperationId)
    }
  ].map((record, index): JournalRecord => ({
    ...record,
    position: JournalPosition.make(index + 1),
    runId
  }))
  const reduction = reduceManagedHistory(runId, records)
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      "outcome TaskClaimAcquired contradicts the intended claim for operation relational-claim",
      "outcome TaskWorkSessionEstablished has no prior matching session report for operation relational-session",
      "outcome TaskExecutionOutcomeObserved has no matching prior execution report for operation relational-execution"
    ]))
  }
})

it("rejects contradictory terminal reports for one established session", () => {
  const operationId = OperationId.make("terminal-session-operation")
  const sessionId = TaskWorkSessionId.make("terminal-session")
  const records = [
    event({ _tag: "TaskWorkSessionEstablished", outcome: { operationId, sessionId } }),
    event({
      _tag: "TaskWorkSessionResultReported",
      report: {
        _tag: "TaskWorkSessionResultReported",
        observationId: "terminal-one",
        result: { _tag: "Completed", evidence: "done" },
        sessionId
      },
      version: 4
    }),
    event({
      _tag: "TaskWorkSessionResultReported",
      report: {
        _tag: "TaskWorkSessionResultReported",
        observationId: "terminal-two",
        result: { _tag: "Failed", evidence: "failed" },
        sessionId
      },
      version: 4
    })
  ].map((journalEvent, index): JournalRecord => ({
    event: journalEvent,
    key: index === 0
      ? outcomeRecordKey(operationId)
      : JournalRecordKey.make(`provider-observation:terminal-${index === 1 ? "one" : "two"}:task-work-session-result`),
    position: JournalPosition.make(index + 1),
    runId
  }))
  const reduction = reduceManagedHistory(runId, records)
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toContain(
      "contradictory terminal session results for session terminal-session"
    )
  }
})

it("validates attempt-plan causal predecessors for order and full-attempt identity", () => {
  const base = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("plan-causal-a"),
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    branch: TaskBranchRef.make("refs/heads/plan-causal-a"),
    executor: TaskExecutorLocator.make("executor:plan-causal-a"),
    runId,
    session: TaskWorkSessionLocator.make("session:plan-causal-a"),
    taskId: TaskId.make("plan-causal-task"),
    taskRevision: TaskRevision.make("plan-causal-revision"),
    worktree: WorktreeLocator.make("/tmp/plan-causal-a")
  })
  const priorOperation = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: OperationId.make("plan-causal-prior"),
    plannedAttempt: base,
    predecessorOperationIds: []
  })
  const foreign = PlannedTaskAttempt.make({
    ...base,
    attemptId: AttemptId.make("plan-causal-b"),
    branch: TaskBranchRef.make("refs/heads/plan-causal-b"),
    worktree: WorktreeLocator.make("/tmp/plan-causal-b")
  })
  const dependentOperation = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: OperationId.make("plan-causal-dependent"),
    plannedAttempt: foreign,
    predecessorOperationIds: [priorOperation.operationId, OperationId.make("plan-causal-later")]
  })
  const laterOperation = WorkflowOperation.cases.RecordTaskAttemptPlan.make({
    operationId: OperationId.make("plan-causal-later"),
    plannedAttempt: foreign,
    predecessorOperationIds: []
  })
  const operations = [priorOperation, dependentOperation, laterOperation]
  const reduction = reduceManagedHistory(
    runId,
    operations.map((operation, index) => ({
      event: TaskAttemptPlannedEvent.make({ operation, version: 4 }),
      key: attemptPlanRecordKey(operation.plannedAttempt.attemptId),
      position: JournalPosition.make(index + 1),
      runId
    }))
  )
  expect(reduction._tag).toBe("InvalidManagedHistory")
  if (reduction._tag === "InvalidManagedHistory") {
    expect(reduction.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
      "event TaskAttemptPlanned planned task attempt contradicts predecessor operation plan-causal-prior",
      "event TaskAttemptPlanned has no prior predecessor operation plan-causal-later"
    ]))
  }
})
