import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { dispositionCleanupLiveJournalTestLayer } from "./live-journal-test.js"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { journalEvidenceFrom } from "../../../workflow-journal/record-evidence.js"
import { JournalRecord } from "../../../workflow-journal/store.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import {
  branchCleanupObservationIntendedRecordKey,
  plannedAttemptReplacedRecordKey,
  worktreeCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { candidateCleanupEvidenceSubjects, deriveCleanupAuthorizations } from "./activation.js"
import { appendDerivedCleanupAuthorizations } from "./loop.js"
import { attempt, authorization, runId, successor } from "./fixtures.js"
import {
  appendAbandonedProvenance,
  appendReplacementProvenance,
  replacementProvenanceFor
} from "./provenance-fixtures.js"
import {
  runWorktreeCleanup,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupSettledEvent,
  worktreeCleanupTestLayer
} from "./worktree.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  CleanupObservationOrdinal,
  IntegratorCandidateCleanupEvidenceRevision,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"
import { BranchCleanupObservationIntendedEvent } from "./branch.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../registry/event.js"
import { WorkflowOperation } from "../../registry/operation.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementIntendedEvent,
  IntegrationFinalitySettledEvent,
  completionClaimDeletionOperationIdFor,
  completionClaimReplacementOperationIdFor
} from "../integration-finality/events.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { integratorCorrelationFor } from "../integrator/session.js"

const begin = Effect.fn("DispositionCleanupActivationTest.begin")(function* () {
  const journal = yield* InRunJournal
  return journal
})

const settledCleanupRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const observationOperation = WorkflowOperation.cases.ReadTaskWorktree.make({
    operationId: OperationId.make("settled-cleanup:worktree-observation"),
    plannedAttempt: fixture.plannedAttempt,
    predecessorOperationIds: [fixture.activeClaim.operationId]
  })
  const replacementOperationId = completionClaimReplacementOperationIdFor(fixture.claim)
  const deletionOperationId = completionClaimDeletionOperationIdFor(fixture.claim)
  const events: ReadonlyArray<JournalRecord["event"]> = [
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation: observationOperation,
      version: workflowJournalEventVersion
    }),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha: fixture.plannedAttempt.baseSha,
        branch: fixture.plannedAttempt.branch,
        headSha: fixture.plannedAttempt.baseSha,
        worktree: fixture.plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: observationOperation.operationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacementIntendedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacedEvent.make({
      claim: fixture.claim,
      operationId: replacementOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletionIntendedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: fixture.successObservation,
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletedEvent.make({
      claim: fixture.claim,
      operationId: deletionOperationId,
      successObservation: fixture.successObservation,
      version: workflowJournalEventVersion
    }),
    IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation: fixture.successObservation,
      version: workflowJournalEventVersion
    })
  ]
  return events.map((event, index) =>
    JournalRecord.make({
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(index + 1),
      runId: fixture.runId
    })
  )
}

const settledCandidateCleanupRecords = () => {
  const fixture = integrationFinalityFixture
  const specification = makeTaskWorkSpecification({
    body: "Prove normal-finality candidate cleanup activation.",
    taskId: fixture.taskId,
    title: "Normal-finality candidate cleanup"
  })
  const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
  const accepted = makeAcceptedIntegrationHistory({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    activeClaim: fixture.activeClaim,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt,
    runId: fixture.runId,
    targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
    taskSpecification: specification,
    trackerTarget: fixture.target
  })
  const promoted = makePromotedIntegrationHistory({
    candidateCommit: fixture.qualifiedCandidate.candidateCommit,
    candidateText: fixture.qualifiedCandidate.candidateText,
    originalClaim: fixture.activeClaim,
    records: accepted.records,
    session: integratorCorrelationFor(accepted)
  })
  const successObservation = {
    ...fixture.successObservation,
    claim: promoted.claim,
    taskRevision: plannedAttempt.taskRevision
  }
  const deletionOperationId = completionClaimDeletionOperationIdFor(promoted.claim)
  const replacementOperationId = completionClaimReplacementOperationIdFor(promoted.claim)
  const terminalEvents: ReadonlyArray<JournalRecord["event"]> = [
    CompletionClaimDeletionIntendedEvent.make({
      claim: promoted.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    }),
    CompletionClaimDeletedEvent.make({
      claim: promoted.claim,
      operationId: deletionOperationId,
      successObservation,
      version: workflowJournalEventVersion
    }),
    IntegrationFinalitySettledEvent.make({
      claim: promoted.claim,
      deletionOperationId,
      replacementOperationId,
      successObservation,
      version: workflowJournalEventVersion
    })
  ]
  const records = terminalEvents.reduce<ReadonlyArray<JournalRecord>>(
    (current, event) => [
      ...current,
      JournalRecord.make({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(current.length + 1),
        runId: fixture.runId
      })
    ],
    promoted.replacedRecords
  )
  return { promoted, records }
}

it.effect("fails closed when replacement authority has no exact ready-worktree witness", () =>
  Effect.sync(() => {
    const replacement = JournalRecord.make({
      event: replacementProvenanceFor(attempt, successor),
      key: plannedAttemptReplacedRecordKey(attempt.attemptId),
      position: JournalPosition.make(1),
      runId
    })
    const derived = deriveCleanupAuthorizations([replacement])
    expect(derived.worktree).toEqual([])
  })
)

it.effect("fails closed when abandonment authority has no exact ready-worktree witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendAbandonedProvenance(attempt)
    const records = (yield* journal.read(runId)).filter(({ event }) => event._tag !== "PlannedAttemptWorktreeObserved")
    expect(deriveCleanupAuthorizations(records).worktree).toEqual([])
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("derives one abandonment authorization from the latest exact ready-worktree witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendAbandonedProvenance(attempt)
    const derived = deriveCleanupAuthorizations(yield* journal.read(runId)).worktree
    expect(derived).toHaveLength(1)
    expect(derived[0]?.disposition._tag).toBe("Abandoned")
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("derives the same cleanup authorization from cold records and indexed accepted evidence", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendAbandonedProvenance(attempt)
    const records = yield* journal.read(runId)
    expect(deriveCleanupAuthorizations(journalEvidenceFrom(records))).toEqual(deriveCleanupAuthorizations(records))
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("derives settled worktree cleanup from exact integration finality and its planned-worktree observation", () =>
  Effect.sync(() => {
    const records = settledCleanupRecords()
    const cold = deriveCleanupAuthorizations(records).worktree
    const indexed = deriveCleanupAuthorizations(journalEvidenceFrom(records)).worktree

    expect(cold).toEqual(indexed)
    expect(cold).toHaveLength(1)
    expect(cold[0]?.disposition._tag).toBe("Settled")
    expect(cold[0]?.disposition.plannedAttempt).toEqual(integrationFinalityFixture.plannedAttempt)
    expect(cold[0]?.causalPredecessors).toEqual([
      completionClaimDeletionOperationIdFor(integrationFinalityFixture.claim)
    ])
    expect(cold[0]?.expectedHead).toBe(integrationFinalityFixture.qualifiedCandidate.run.session.acceptedResult.commit)
  })
)

it.effect("derives settled worktree cleanup from a fresh attempt's exact ready-worktree witness", () =>
  Effect.sync(() => {
    const records = settledCleanupRecords()
    const fixture = integrationFinalityFixture
    const operation = WorkflowOperation.cases.ReconcileTaskWorktree.make({
      operationId: OperationId.make("settled-cleanup:fresh-worktree"),
      plannedAttempt: fixture.plannedAttempt,
      predecessorOperationIds: [fixture.activeClaim.operationId]
    })
    const freshEvents: ReadonlyArray<JournalRecord["event"]> = [
      TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      TaskWorktreeReadyEvent.make({
        operationId: operation.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: fixture.plannedAttempt.baseSha,
          branch: fixture.plannedAttempt.branch,
          headSha: fixture.plannedAttempt.baseSha,
          worktree: fixture.plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      })
    ]
    const terminalEvents = records.slice(2).map(({ event }) => event)
    const freshRecords = [...freshEvents, ...terminalEvents].map((event, index) =>
      JournalRecord.make({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(index + 1),
        runId: fixture.runId
      })
    )

    expect(deriveCleanupAuthorizations(freshRecords).worktree).toHaveLength(1)
    expect(deriveCleanupAuthorizations(journalEvidenceFrom(freshRecords)).worktree).toHaveLength(1)
  })
)

it.effect("rejects finality settlement without its exact canonical prefix", () =>
  Effect.sync(() => {
    const records = settledCleanupRecords().filter(({ event }) => event._tag !== "CompletionClaimDeleted")
    expect(deriveCleanupAuthorizations(records).worktree).toEqual([])
  })
)

it.effect("rejects finality settlement recorded under a foreign key", () =>
  Effect.sync(() => {
    const records = settledCleanupRecords()
    const settlement = records.at(-1)
    expect(settlement?.event._tag).toBe("IntegrationFinalitySettled")
    if (settlement?.event._tag !== "IntegrationFinalitySettled") return
    const forged = JournalRecord.make({
      ...settlement,
      key: plannedAttemptReplacedRecordKey(integrationFinalityFixture.plannedAttempt.attemptId)
    })
    expect(deriveCleanupAuthorizations([...records.slice(0, -1), forged]).worktree).toEqual([])
  })
)

it.effect("rejects a planned-worktree observation recorded after finality settlement", () =>
  Effect.sync(() => {
    const records = settledCleanupRecords()
    const reordered = records.map((record, index) =>
      JournalRecord.make({
        ...record,
        position:
          record.event._tag === "PlannedAttemptWorktreeObserved"
            ? JournalPosition.make(records.length + 1)
            : JournalPosition.make(index + 1)
      })
    )
    expect(deriveCleanupAuthorizations(reordered).worktree).toEqual([])
  })
)

it.effect("derives settled candidate cleanup from finality's exact fixed session and candidate observation", () =>
  Effect.sync(() => {
    const { promoted, records } = settledCandidateCleanupRecords()
    const revision = IntegratorCandidateCleanupEvidenceRevision.make(1)
    const subjects = candidateCleanupEvidenceSubjects(records)
    const derived = deriveCleanupAuthorizations(records, () => revision).candidate

    expect(subjects).toEqual([
      {
        locator: promoted.qualifiedCandidate.run.session.candidateResource,
        predecessor: promoted.qualifiedCandidate.run.session
      }
    ])
    expect(derived).toHaveLength(1)
    expect(derived[0]?.disposition._tag).toBe("Settled")
    expect(derived[0]?.locator).toBe(promoted.qualifiedCandidate.run.session.candidateResource)
    expect(derived[0]?.owner.sessionId).toBe(promoted.qualifiedCandidate.run.session.sessionId)
  })
)

it.effect("rejects settled candidate cleanup without the exact fixed session or candidate observation", () =>
  Effect.sync(() => {
    const { records } = settledCandidateCleanupRecords()
    const revision = IntegratorCandidateCleanupEvidenceRevision.make(1)
    for (const missing of ["IntegratorSessionFixed", "IntegratorRunCandidateGitObserved"] as const) {
      const incomplete = records.filter(({ event }) => event._tag !== missing)
      expect(candidateCleanupEvidenceSubjects(incomplete)).toEqual([])
      expect(deriveCleanupAuthorizations(incomplete, () => revision).candidate).toEqual([])
    }
  })
)

it.effect("keeps an existing exact cleanup authorization when activation derives it again", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendAbandonedProvenance(attempt)

    yield* appendDerivedCleanupAuthorizations(runId, ["worktree"])
    yield* appendDerivedCleanupAuthorizations(runId, ["worktree"])

    const authorizations = (yield* journal.read(runId)).filter(
      ({ event }) => event._tag === "WorktreeCleanupAuthorized"
    )
    expect(authorizations).toHaveLength(1)
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("rejects a derived replacement authorization when its provenance prefix is incomplete", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendReplacementProvenance(attempt, successor, "StartupValid")
    const records = (yield* journal.read(runId)).filter(({ event }) => event._tag !== "TaskClaimAcquired")
    expect(deriveCleanupAuthorizations(records).worktree).toEqual([])
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("deduplicates repeated typed terminal evidence for one cleanup operation", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendAbandonedProvenance(attempt, OperationId.make("activation-duplicate-abandonment"))
    const records = yield* journal.read(runId)
    const abandonment = records.find(({ event }) => event._tag === "AttemptImplementationAbandoned")
    expect(abandonment).toBeDefined()
    if (abandonment === undefined) return
    const derived = deriveCleanupAuthorizations([...records, abandonment])
    expect(derived.worktree).toHaveLength(1)
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("rejects a branch authorization when its settled worktree history is incomplete", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendReplacementProvenance(attempt, successor, "StartupValid")
    yield* journal.append(
      runId,
      worktreeCleanupSettledRecordKey(authorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result: WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
          branch: attempt.branch,
          locator: attempt.worktree,
          revision: WorktreeCleanupEvidenceRevision.make(1)
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(deriveCleanupAuthorizations(yield* journal.read(runId)).branch).toEqual([])
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("rejects a branch authorization when its own history begins after worktree settlement", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendReplacementProvenance(attempt, successor, "StartupValid")
    yield* runWorktreeCleanup(authorization)
    const beforeBranchEvent = deriveCleanupAuthorizations(yield* journal.read(runId)).branch[0]
    expect(beforeBranchEvent).toBeDefined()
    if (beforeBranchEvent === undefined) return
    const ordinal = CleanupObservationOrdinal.make(1)
    const branchAuthorization = BranchCleanupAuthorization.make({
      ...beforeBranchEvent,
      evidenceRevision: BranchCleanupEvidenceRevision.make(1)
    })
    yield* journal.append(
      runId,
      branchCleanupObservationIntendedRecordKey(branchAuthorization.operationId, ordinal),
      BranchCleanupObservationIntendedEvent.make({
        authorization: branchAuthorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operationId: OperationId.make("activation-branch-history-after-settlement:observe"),
        ordinal,
        version: workflowJournalEventVersion
      })
    )
    expect(deriveCleanupAuthorizations(yield* journal.read(runId)).branch).toEqual([])
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          WorktreeCleanupObservation.cases.Present.make({
            attemptId: attempt.attemptId,
            branch: attempt.branch,
            headSha: attempt.baseSha,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(1),
            writerQuiescent: true
          }),
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(dispositionCleanupLiveJournalTestLayer())
  )
)

it.effect("rejects a replacement with a settled worktree record before its authority witness", () =>
  Effect.sync(() => {
    const replacement = replacementProvenanceFor(attempt, successor)
    const settlement = JournalRecord.make({
      event: WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result: WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
          branch: attempt.branch,
          locator: attempt.worktree,
          revision: WorktreeCleanupEvidenceRevision.make(1)
        }),
        version: workflowJournalEventVersion
      }),
      key: worktreeCleanupSettledRecordKey(authorization.operationId),
      position: JournalPosition.make(1),
      runId
    })
    const replacementRecord = JournalRecord.make({
      event: replacement,
      key: plannedAttemptReplacedRecordKey(attempt.attemptId),
      position: JournalPosition.make(2),
      runId
    })
    expect(deriveCleanupAuthorizations([settlement, replacementRecord]).worktree).toEqual([])
  })
)
