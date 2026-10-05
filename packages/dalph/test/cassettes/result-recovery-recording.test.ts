import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  PlannedAttemptExecutorReport,
  makeTaskWorkSpecification,
  RunId,
  AttemptId,
  WorktreeLocator,
  TaskBranchRef,
  GitRepositoryLocator,
  IntegrationTargetRef
} from "@dalph/contracts"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { memoryJournalTestLayer } from "../../../orchestrator/src/workflow-journal/adapters/memory-store.js"
import { JournalStore, type JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import { appendReplacementProvenance } from "../../../orchestrator/src/workflow/protocols/disposition-cleanup/provenance-fixtures.js"
import { attempt, successor } from "../../../orchestrator/src/workflow/protocols/disposition-cleanup/fixtures.js"
import { remotePublicationTargetForTest } from "../../../orchestrator/test/support/direct-publication.js"
import {
  ResultRecoveryDirectedEvent,
  ResultRecoveryRequestId,
  ResultRecoverySubject
} from "../../../orchestrator/src/workflow/protocols/result-recovery/events.js"
import { ResultRecoveryAttemptReplacedEvent } from "../../../orchestrator/src/workflow/protocols/result-recovery/replacement-events.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../../src/cassettes/recorded.js"
import { renameRecordedCassette, invertCassetteIdentityRenaming } from "../../src/cassettes/recorded-renaming.js"
import { CassetteIdentityRenaming } from "../../src/cassettes/recorded-domain.js"

it.effect("preserves historical Restart custody through native cassette round trip and identity renaming", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      attempt.runId,
      FixtureTarget.make("result-recovery-recording"),
      RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      remotePublicationTargetForTest
    )
    const prior = {
      ...attempt,
      taskRevision: makeTaskWorkSpecification({
        body: "cleanup provenance predecessor",
        title: "cleanup provenance predecessor",
        taskId: attempt.taskId
      }).fingerprint
    }
    const next = {
      ...successor,
      taskRevision: makeTaskWorkSpecification({
        body: "cleanup provenance witness",
        title: "cleanup provenance witness",
        taskId: attempt.taskId
      }).fingerprint
    }
    yield* appendReplacementProvenance(prior, next, "StartupValid")
    const source = yield* journal.read(attempt.runId)
    const oldReplacement = source.findLast(({ event }) => event._tag === "PlannedAttemptReplaced")?.event
    const oldDirection = source.findLast(({ event }) => event._tag === "AttemptChoiceApplied")
    const oldReport = source.findLast(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")?.event
    const priorPlan = source.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    if (
      oldReplacement?._tag !== "PlannedAttemptReplaced" ||
      oldDirection === undefined ||
      oldReport?._tag !== "PlannedAttemptExecutorWorkReported" ||
      priorPlan?._tag !== "TaskAttemptPlanned"
    )
      return expect.fail("complete replacement fixture required")
    const requestId = ResultRecoveryRequestId.make({ nonce: "historical-cassette-restart", runId: attempt.runId })
    const subject = ResultRecoverySubject.cases.HistoricalUnknownFailure.make({
      plannedAttempt: prior,
      reportOrdinal: oldReport.ordinal
    })
    const failed = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation: { attemptId: prior.attemptId, runId: prior.runId },
      result: { _tag: "Failed" }
    })
    const replacement = ResultRecoveryAttemptReplacedEvent.make({
      requestId,
      subject,
      integrationTarget: {
        repository: GitRepositoryLocator.make("/repositories/result-recovery-recording"),
        ref: IntegrationTargetRef.make("refs/heads/main")
      },
      writerCustody: { _tag: "Stopped", plannedAttempt: prior },
      witness: {
        activeTaskContinuationRead: {
          graphObservationOperationId: oldReplacement.witness.graphObservationOperationId,
          taskWorkSpecificationObservationOperationId: oldReplacement.witness.specificationObservationOperationId,
          taskClaimObservationOperationId: oldReplacement.witness.claimObservationOperationId
        },
        worktreeObservationOperationId: oldReplacement.witness.oldWorktreeObservationOperationId,
        targetLineageObservationOperationId: oldReplacement.witness.targetLineageObservationOperationId
      },
      successorPlan: {
        ...oldReplacement.successorPlan,
        predecessorOperationIds: [
          ...new Set([...oldReplacement.successorPlan.predecessorOperationIds, priorPlan.operation.operationId])
        ]
      },
      initiatedBy: oldReplacement.initiatedBy,
      occurrenceClassification: oldReplacement.occurrenceClassification,
      version: oldReplacement.version
    })
    const records: ReadonlyArray<JournalRecord> = source.map((record) => {
      let event = record.event
      if (
        event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
      )
        event = { ...event, report: failed }
      if (event._tag === "PlannedAttemptExecutorWorkReported" && event.ordinal === oldReport.ordinal)
        event = { ...event, report: failed }
      if (event._tag === "AttemptChoiceApplied")
        event = ResultRecoveryDirectedEvent.make({
          requestId,
          subject,
          direction: "RestartTaskImplementation",
          initiatedBy: event.initiatedBy,
          occurrenceClassification: event.occurrenceClassification,
          version: event.version
        })
      if (record.position > oldDirection.position && event._tag === "TaskTrackerReadIntentRecorded") {
        const operation = event.operation
        if (operation._tag === "ReadTrackerGraph")
          event = {
            ...event,
            operation: {
              ...operation,
              cause: { _tag: "AttemptRestartAuthorityCheck" },
              predecessorOperationIds: [priorPlan.operation.operationId]
            }
          }
        else if (operation._tag === "ReadTaskWorkSpecification" || operation._tag === "ReadTaskClaim")
          event = {
            ...event,
            operation: {
              ...operation,
              predecessorOperationIds: [
                ...new Set([...operation.predecessorOperationIds, priorPlan.operation.operationId])
              ]
            }
          }
      }
      if (event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage")
        event = { ...event, operation: { ...event.operation, integrationTarget: replacement.integrationTarget } }
      if (event._tag === "PlannedAttemptReplaced") event = replacement
      return { ...record, event, key: describeJournalEvent(event).expectedKey }
    })
    const history = reduceWorkflowJournalHistory(attempt.runId, records)
    expect(
      history._tag,
      history._tag === "InvalidWorkflowJournalHistory" ? JSON.stringify(history.issues) : "accepted history"
    ).toBe("ValidWorkflowJournalHistory")
    const cassette = yield* projectRecordedCassette(records)
    const checkpoints = verifyRecordedCassetteRoundTrip(records, cassette)
    expect(checkpoints).toHaveLength(records.length)
    for (const checkpoint of checkpoints)
      expect(checkpoint).toMatchObject({
        appliedOccurrencePositionEquivalent: true,
        operationalStateEquivalent: true,
        pureSelectionEquivalent: true,
        workflowHistoryEquivalent: true
      })
    const renamedRun = RunId.make("renamed-historical-cassette-run")
    const renamedAttempt = AttemptId.make("renamed-retained-attempt")
    const renamedWorktree = WorktreeLocator.make("/renamed/retained-worktree")
    const renamedBranch = TaskBranchRef.make("refs/heads/renamed-retained-attempt")
    const renaming = CassetteIdentityRenaming.make({
      runIds: [{ from: attempt.runId, to: renamedRun }],
      attemptIds: [{ from: prior.attemptId, to: renamedAttempt }],
      claimTokens: [],
      operationIds: [],
      taskBranchRefs: [{ from: prior.branch, to: renamedBranch }],
      worktreeLocators: [{ from: prior.worktree, to: renamedWorktree }],
      integratorSessionIds: [],
      integratorCandidateResourceLocators: []
    })
    const renamed = yield* renameRecordedCassette(cassette, renaming)
    expect(renamed.entries.find(({ _tag }) => _tag === "ResultRecoveryAttemptReplaced")).toMatchObject({
      requestId: { runId: renamedRun },
      writerCustody: {
        _tag: "Stopped",
        plannedAttempt: {
          runId: renamedRun,
          attemptId: renamedAttempt,
          worktree: renamedWorktree,
          branch: renamedBranch
        }
      }
    })
    expect(yield* renameRecordedCassette(renamed, invertCassetteIdentityRenaming(renaming))).toEqual(cassette)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
