import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { expect as vitestExpect } from "vitest"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TargetLineageObservation } from "../authorities/git/target-lineage.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { WorkflowActor } from "../workflow/registry/actor.js"
import {
  TaskClaimAcquisitionIntendedEvent,
  TaskAttemptPlannedEvent,
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  taskTrackerReadIntent,
  TargetLineageObservedEvent,
  WorkflowRunBeganEvent
} from "../workflow/registry/event.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../workflow/protocols/integration-admission/events.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  AttemptRestartAuthorityReadFailedEvent,
  AttemptRestartTaskFactsReadFailure
} from "../workflow/protocols/attempt-choice/replacement-events.js"
import { AttemptWorktreeLost } from "../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../workflow/registry/operation.js"
import { OperationId } from "../workflow/identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey } from "../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../workflow-journal/adapters/sqlite-store.js"
import { JournalStore } from "../workflow-journal/store.js"
import type { JournalRecord } from "../workflow-journal/store.js"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import {
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionFixedEvent
} from "../workflow/protocols/integrator/events.js"
import {
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptLimit,
  TargetPromotionSuccessObservation,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionIntendedEvent,
  TargetPromotionStaleEvent,
  TargetPromotionObservedSuccessEvent
} from "../workflow/protocols/target-promotion/events.js"
import {
  CompletionClaimRequestOrdinal,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestOrdinal,
  IntegrationFinalitySettledEvent
} from "../workflow/protocols/integration-finality/events.js"
import { TraceAtCursor, TraceCursor, TraceProjectionInvalid, makeTraceReader } from "./trace-reader.js"

const runId = RunId.make("historical-81-82-run")
const trackerTarget = FixtureTarget.make("historical-81-82-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const record = (position: number, event: JournalRecord["event"], recordRunId: RunId = runId): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`historical-81-82:${position}`),
  position: JournalPosition.make(position),
  runId: recordRunId
})

const runBeginning = WorkflowRunBeganEvent.make({
  initialControlPolicy: initialPolicy,
  initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
  occurrenceClassification: "InitiatedAction",
  target: trackerTarget,
  version: workflowJournalEventVersion
})

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("historical-81-82-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/historical-81-82"),
  executor: TaskExecutorLocator.make("executor:historical-81-82"),
  runId,
  taskId: TaskId.make("historical-81-82-task"),
  taskRevision: TaskRevision.make("historical-81-82-revision"),
  worktree: WorktreeLocator.make("/worktrees/historical-81-82")
})

const independentAttempt = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("historical-81-82-independent-attempt"),
  branch: TaskBranchRef.make("refs/heads/dalph/historical-81-82-independent"),
  taskId: TaskId.make("historical-81-82-independent-task"),
  taskRevision: TaskRevision.make("historical-81-82-independent-revision"),
  worktree: WorktreeLocator.make("/worktrees/historical-81-82-independent")
})

const recoveryRecords = (): ReadonlyArray<JournalRecord> => {
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("historical-81-82-claim"),
      owner: ClaimOwner.make("dalph:historical-81-82"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("historical-81-82-token")
    },
    predecessorOperationIds: []
  })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("historical-81-82-plan"),
    plannedAttempt,
    predecessorOperationIds: [claimOperation.acquisition.operationId]
  })
  return [
    record(1, runBeginning),
    record(
      2,
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
    ),
    record(3, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })),
    record(
      4,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
  ]
}

const preservationRecords = (): ReadonlyArray<JournalRecord> => {
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("historical-81-82-worktree-loss-read"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const restartRead = makeTrackerGraphObservationOperation(
    OperationId.make("historical-81-82-task-conflict-read"),
    trackerTarget,
    [],
    [plannedAttempt.taskId]
  )
  const requestId = AttemptChoiceRequestId.make({ nonce: "historical-81-82-restart", runId })
  const subject = { observedTaskRevision: TaskRevision.make("historical-81-82-observed-conflict"), plannedAttempt }
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("historical-81-82-independent-plan"),
    plannedAttempt: independentAttempt,
    predecessorOperationIds: []
  })
  return [
    record(
      1,
      WorkflowRunBeganEvent.make({
        initialControlPolicy: initialPolicy,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        target: trackerTarget,
        version: workflowJournalEventVersion
      })
    ),
    record(
      2,
      GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      3,
      PlannedAttemptWorktreeObservedEvent.make({
        occurrenceClassification: "NonActionOccurrence",
        observation: AttemptWorktreeLost.make({ plannedAttempt }),
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    ),
    record(
      4,
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    ),
    record(
      5,
      TaskClaimAcquisitionIntendedEvent.make({
        operation: makeTaskClaimAcquisitionOperation({
          acquisition: {
            operationId: OperationId.make("historical-81-82-conflict-claim"),
            owner: ClaimOwner.make("dalph:historical-81-82"),
            taskId: plannedAttempt.taskId,
            token: ClaimToken.make("historical-81-82-conflict-token")
          },
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(6, taskTrackerReadIntent(restartRead)),
    record(
      7,
      AttemptRestartAuthorityReadFailedEvent.make({
        failure: AttemptRestartTaskFactsReadFailure.make({
          detail: "task facts changed while the attempt was retained",
          source: "FixtureReader.FixtureReadError",
          target: trackerTarget
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: restartRead.operationId,
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    ),
    record(8, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }))
  ]
}

const integrationRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const candidateText = fixture.qualifiedCandidate.candidateText
  const session = IntegratorSessionCorrelation.make({
    ...fixture.qualifiedCandidate.run.session,
    queuedAt: JournalPosition.make(4),
    startedAt: JournalPosition.make(5),
    targetLineageObservedAt: JournalPosition.make(7)
  })
  const run = IntegratorRunCorrelation.make({ ordinal: fixture.qualifiedCandidate.run.ordinal, session })
  const qualifiedCandidate = { ...fixture.qualifiedCandidate, qualifiedAt: JournalPosition.make(12), run }
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: fixture.integrationTarget,
    operationId: OperationId.make("historical-81-82-lineage"),
    plannedAttempt: fixture.plannedAttempt,
    predecessorOperationIds: []
  })
  const correlation = { ...fixture.promotionCorrelation, qualifiedCandidate }
  const candidateObservation = IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: fixture.qualifiedCandidate.candidateCommit,
    directParents: fixture.qualifiedCandidate.directParents
  })
  return [
    record(
      1,
      WorkflowRunBeganEvent.make({
        initialControlPolicy: initialPolicy,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        target: fixture.target,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      2,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      3,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
          result: { _tag: "Accepted", acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult }
        }),
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      4,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      5,
      IntegrationStartedEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        responsibilityBeganAt: JournalPosition.make(4),
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      6,
      GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      7,
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: fixture.plannedAttempt.baseSha,
          targetHeadSha: run.session.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      8,
      IntegratorSessionFixedEvent.make({ correlation: run.session, version: workflowJournalEventVersion }),
      fixture.runId
    ),
    record(9, IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }), fixture.runId),
    record(
      10,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: run.session }),
        run,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      11,
      IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion }),
      fixture.runId
    ),
    record(
      12,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: candidateObservation,
        run,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(13, TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion }), fixture.runId),
    record(
      14,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
        correlation,
        reason: { _tag: "Initial", observedHeadSha: run.session.expectedTargetHead },
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      15,
      TargetPromotionObservedSuccessEvent.make({
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
        correlation,
        observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
          candidateAncestry: "Current",
          targetHeadSha: correlation.qualifiedCandidate.candidateCommit
        }),
        version: workflowJournalEventVersion
      }),
      fixture.runId
    )
  ]
}

const promotionCorrelationFrom = (
  records: ReadonlyArray<JournalRecord>
): Extract<JournalRecord["event"], { readonly _tag: "TargetPromotionIntended" }>["correlation"] => {
  const promotion = records.find(({ event }) => event._tag === "TargetPromotionIntended")?.event
  return Option.getOrThrow(
    Option.fromUndefinedOr(promotion?._tag === "TargetPromotionIntended" ? promotion.correlation : undefined)
  )
}

const stalePromotionRecords = (): ReadonlyArray<JournalRecord> => {
  const prefix = integrationRecords().slice(0, 14)
  const correlation = promotionCorrelationFrom(prefix)
  return [
    ...prefix,
    record(
      15,
      TargetPromotionStaleEvent.make({
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
        correlation,
        observation: { _tag: "CompareAndSetRejected", observedHeadSha: GitCommitSha.make("4".repeat(40)) },
        version: workflowJournalEventVersion
      }),
      correlation.qualifiedCandidate.run.session.plannedAttempt.runId
    )
  ]
}

const nonConvergentPromotionRecords = (): ReadonlyArray<JournalRecord> => {
  const prefix = integrationRecords().slice(0, 13)
  const correlation = promotionCorrelationFrom(prefix)
  const runId = correlation.qualifiedCandidate.run.session.plannedAttempt.runId
  const attempts = [1, 2, 3].map((ordinal) =>
    record(
      13 + ordinal,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
        correlation,
        reason:
          ordinal === 1
            ? { _tag: "Initial", observedHeadSha: correlation.qualifiedCandidate.run.session.expectedTargetHead }
            : {
                _tag: "ReconciledExpectedHead",
                observedHeadSha: correlation.qualifiedCandidate.run.session.expectedTargetHead,
                previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
              },
        version: workflowJournalEventVersion
      }),
      runId
    )
  )
  return [
    ...prefix,
    ...attempts,
    record(
      17,
      TargetPromotionNonConvergenceEvent.make({
        attemptLimit: TargetPromotionAttemptLimit.make(3),
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
        correlation,
        lastObservation: {
          _tag: "ExpectedHeadStillObserved",
          observedHeadSha: correlation.qualifiedCandidate.run.session.expectedTargetHead
        },
        version: workflowJournalEventVersion
      }),
      runId
    )
  ]
}

const finalityRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const runId = fixture.runId
  const replacementOperationId = OperationId.make("historical-81-82-finality-replacement")
  const deletionOperationId = OperationId.make("historical-81-82-finality-deletion")
  const successObservation = { ...fixture.successObservation, observedAt: JournalPosition.make(22) }
  return [
    ...integrationRecords(),
    record(
      16,
      CompletionClaimReplacementIntendedEvent.make({
        claim: fixture.claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      17,
      CompletionClaimReplacementAttemptIntendedEvent.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        claim: fixture.claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      18,
      CompletionClaimReplacedEvent.make({
        claim: fixture.claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      19,
      CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion }),
      runId
    ),
    record(
      20,
      CompletionTaskAttemptIntendedEvent.make({
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        focusedFactsOperationId: fixture.focusedSuccessFactsEvent.operationId,
        gitReadOperationId: OperationId.make("historical-81-82-finality-git-read"),
        request: fixture.completionRequest,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(21, fixture.focusedSuccessFactsReadIntentEvent, runId),
    record(22, fixture.focusedSuccessFactsEvent, runId),
    record(
      23,
      CompletionTaskAcknowledgedEvent.make({
        acknowledgement: { operationId: fixture.completionRequest.operationId, taskId: fixture.taskId },
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        request: fixture.completionRequest,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      24,
      CompletionClaimDeletionIntendedEvent.make({
        claim: fixture.claim,
        operationId: deletionOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      25,
      CompletionClaimDeletionAttemptIntendedEvent.make({
        attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
        claim: fixture.claim,
        operationId: deletionOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      26,
      CompletionClaimDeletedEvent.make({
        claim: fixture.claim,
        operationId: deletionOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      27,
      IntegrationFinalitySettledEvent.make({
        claim: fixture.claim,
        deletionOperationId,
        replacementOperationId,
        successObservation,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(28, taskTrackerReadIntent(fixture.graphOperation), runId),
    record(29, fixture.graphRecordEvent, runId)
  ]
}

const responsibilityOrderRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const otherTarget = IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/other-target"),
    repository: fixture.integrationTarget.repository
  })
  return [
    ...integrationRecords(),
    record(
      16,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    ),
    record(
      17,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
        integrationTarget: otherTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      }),
      fixture.runId
    )
  ]
}

const nodeFileSystemAndPath = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const appendRecordsToStore = Effect.fn("TraceReaderHistorical81And82.appendRecordsToStore")(function* (
  journal: JournalStore["Service"],
  records: ReadonlyArray<JournalRecord>
) {
  const beginning = records[0]
  if (beginning === undefined || beginning.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("historical fixture must begin with WorkflowRunBegan")
  }
  yield* journal.beginRun(beginning.runId, beginning.event.target, beginning.event.initialControlPolicy)
  for (const item of records.slice(1)) {
    if (item.event._tag === "WorkflowRunBegan" || item.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("historical fixture contains an unexpected lifecycle event")
    }
    yield* journal.append(item.runId, item.key, item.event)
  }
})

it.effect("#81 projects durable intents as observation gaps and retains exact unfinished responsibility", () =>
  Effect.gen(function* () {
    const view = yield* makeTraceReader({ read: () => Effect.succeed(recoveryRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(4), runId })
    )
    const gaps = view.facets.recovery.observationGaps
    vitestExpect(gaps.map(({ _tag }) => _tag)).toEqual(
      vitestExpect.arrayContaining(["TrackerObservation", "ExecutorReport"])
    )
    vitestExpect(view.facets.recovery.retainedResponsibilities.map(({ _tag }) => _tag)).toEqual(
      vitestExpect.arrayContaining(["TaskAttempt", "ExecutorWork"])
    )
    vitestExpect(view.items.map(({ occurrence }) => String(occurrence._tag))).not.toContain("CoordinatorCrashed")
    vitestExpect(Schema.is(TraceAtCursor)(view)).toBe(true)
  })
)

it.effect(
  "#81 reopens the same recovery explanation and trace identities without a crash occurrence or replacement attempt in memory and SQLite",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const records = recoveryRecords()
        const cursor = TraceCursor.make({ position: JournalPosition.make(4), runId })
        const memory = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            const read = (requestedRunId: RunId) => journal.read(requestedRunId)
            const first = yield* makeTraceReader({ read }).readAt(cursor)
            const reopened = yield* makeTraceReader({ read }).readAt(cursor)
            return { first, reopened }
          }).pipe(Effect.provide(memoryJournalStoreLayer))
        )
        vitestExpect(memory.reopened).toEqual(memory.first)
        vitestExpect(memory.reopened.facets.recovery).toEqual(memory.first.facets.recovery)
        vitestExpect(memory.reopened.items.map(({ identity }) => identity)).toEqual(
          memory.first.items.map(({ identity }) => identity)
        )

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-historical-81-82-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const sqliteLayer = sqliteJournalStoreLayer({ filename })
        const firstSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        const reopenedSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        vitestExpect(reopenedSqlite).toEqual(firstSqlite)
        vitestExpect(reopenedSqlite.facets.recovery.observationGaps).toEqual(
          firstSqlite.facets.recovery.observationGaps
        )
        vitestExpect(reopenedSqlite.items.map(({ identity }) => identity)).toEqual(
          firstSqlite.items.map(({ identity }) => identity)
        )
        const reopenedTags = reopenedSqlite.items.map(({ occurrence }) => String(occurrence._tag))
        vitestExpect(reopenedTags).not.toContain("CoordinatorCrashed")
        vitestExpect(reopenedTags).not.toContain("PlannedAttemptReplaced")
        const gap = reopenedSqlite.facets.recovery.observationGaps.find(({ _tag }) => _tag === "ExecutorReport")
        if (gap?._tag !== "ExecutorReport") return yield* Effect.die("executor gap was not retained across restart")
        vitestExpect(gap.action).toEqual({ runId, position: JournalPosition.make(4) })
        vitestExpect(gap.attemptId).toBe(plannedAttempt.attemptId)
      }).pipe(Effect.provide(nodeFileSystemAndPath))
    )
)

it.effect(
  "#81 distinguishes worktree loss task-authority conflict and replacement wait without a generic archive state",
  () =>
    Effect.gen(function* () {
      const records = preservationRecords()
      const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(8), runId })
      )
      const dispositions = view.facets.recovery.preservationDispositions
      vitestExpect(dispositions.map(({ _tag }) => _tag)).toEqual([
        "WorktreeLost",
        "ReplacementPending",
        "TaskAuthorityConflict"
      ])
      vitestExpect(dispositions.map(({ _tag }) => String(_tag))).not.toContain("Archive")
      for (const disposition of dispositions) {
        vitestExpect(disposition.source.runId).toBe(runId)
      }
      const worktreeLoss = dispositions.find(({ _tag }) => _tag === "WorktreeLost")
      if (worktreeLoss?._tag !== "WorktreeLost") return yield* Effect.die("worktree-loss disposition missing")
      vitestExpect(worktreeLoss.plannedAttempt.taskId).toBe(plannedAttempt.taskId)
      const taskConflict = dispositions.find(({ _tag }) => _tag === "TaskAuthorityConflict")
      if (taskConflict?._tag !== "TaskAuthorityConflict") return yield* Effect.die("task-authority disposition missing")
      vitestExpect(taskConflict.subject.plannedAttempt.taskId).toBe(plannedAttempt.taskId)
      const replacementWait = dispositions.find(({ _tag }) => _tag === "ReplacementPending")
      if (replacementWait?._tag !== "ReplacementPending") return yield* Effect.die("replacement disposition missing")
      vitestExpect(replacementWait.choice.plannedAttempt.taskId).toBe(plannedAttempt.taskId)
      const independent = view.facets.recovery.retainedResponsibilities.find(
        (responsibility) =>
          responsibility._tag === "TaskAttempt" && responsibility.plannedAttempt.taskId === independentAttempt.taskId
      )
      if (independent?._tag !== "TaskAttempt") return yield* Effect.die("independent task was not retained")
      vitestExpect(independent.source).toEqual({ runId, position: JournalPosition.make(8) })
      vitestExpect(
        dispositions.every(
          (disposition) =>
            disposition._tag !== "WorktreeLost" || disposition.plannedAttempt.taskId !== independentAttempt.taskId
        )
      ).toBe(true)
    })
)

it.effect("#82 projects one shared ordered integration envelope and rejects a result without its intent", () =>
  Effect.gen(function* () {
    const records = integrationRecords()
    const reader = makeTraceReader({ read: () => Effect.succeed(records) })
    const firstRecord = records[0]
    if (firstRecord === undefined) return yield* Effect.die("integration fixture is empty")
    const view = yield* reader.readAt(
      TraceCursor.make({ position: JournalPosition.make(15), runId: firstRecord.runId })
    )
    const tags = view.facets.integration.facts.map(({ _tag }) => _tag)
    vitestExpect(tags).toEqual(
      vitestExpect.arrayContaining([
        "Responsibility",
        "SessionStarted",
        "Session",
        "IntegratorResult",
        "CandidateObserved",
        "CandidateQualification",
        "Promotion"
      ])
    )
    vitestExpect(view.facets.integration.facts.map(({ source }) => Number(source.position))).toEqual(
      [...view.facets.integration.facts.map(({ source }) => Number(source.position))].sort(
        (left, right) => left - right
      )
    )

    const runResultRecord = records.find(({ position }) => position === JournalPosition.make(10))
    if (runResultRecord === undefined) return yield* Effect.die("integration fixture missing run result")
    const malformed = records.map((item) =>
      item.position === JournalPosition.make(9) ? { ...item, event: runResultRecord.event } : item
    )
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).read(firstRecord.runId)
    )
    vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
  })
)

it.effect(
  "#82 reopens the same unfinished Integrator session explanation without a successor or fabricated crash occurrence in memory and SQLite",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const records = integrationRecords().slice(0, 9)
        const beginning = records[0]
        if (beginning === undefined) return yield* Effect.die("unfinished Integrator fixture is empty")
        const cursor = TraceCursor.make({ position: JournalPosition.make(9), runId: beginning.runId })
        const memory = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            const read = (requestedRunId: RunId) => journal.read(requestedRunId)
            const first = yield* makeTraceReader({ read }).readAt(cursor)
            const reopened = yield* makeTraceReader({ read }).readAt(cursor)
            return { first, reopened }
          }).pipe(Effect.provide(memoryJournalStoreLayer))
        )
        vitestExpect(memory.reopened).toEqual(memory.first)
        const memoryGap = memory.reopened.facets.recovery.observationGaps.find(
          ({ _tag }) => _tag === "IntegratorResult"
        )
        if (memoryGap?._tag !== "IntegratorResult") return yield* Effect.die("memory Integrator result gap missing")
        vitestExpect(memoryGap.action).toEqual({ runId: beginning.runId, position: JournalPosition.make(9) })
        vitestExpect(memoryGap.run.session.sessionId).toBe("integration-finality-session")

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-integrator-81-82-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const sqliteLayer = sqliteJournalStoreLayer({ filename })
        const firstSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* appendRecordsToStore(journal, records)
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        const reopenedSqlite = yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          }).pipe(Effect.provide(sqliteLayer))
        )
        vitestExpect(reopenedSqlite).toEqual(firstSqlite)
        vitestExpect(reopenedSqlite.facets.recovery.observationGaps).toEqual(
          firstSqlite.facets.recovery.observationGaps
        )
        vitestExpect(
          reopenedSqlite.items.some(({ occurrence }) => occurrence._tag === "IntegratorSuccessorSessionFixed")
        ).toBe(false)
        vitestExpect(reopenedSqlite.items.map(({ occurrence }) => String(occurrence._tag))).not.toContain(
          "CoordinatorCrashed"
        )
        const session = reopenedSqlite.facets.integration.facts.find(({ _tag }) => _tag === "Session")
        if (session?._tag !== "Session") return yield* Effect.die("fixed Integrator session was not retained")
        vitestExpect(session.correlation.sessionId).toBe("integration-finality-session")
        vitestExpect(session.source).toEqual({ runId: beginning.runId, position: JournalPosition.make(8) })
      }).pipe(Effect.provide(nodeFileSystemAndPath))
    )
)

it.effect(
  "#82 shows the promotion-through-finality cursor matrix for pending-read success stale non-convergence completion cleanup settlement and dependant release",
  () =>
    Effect.gen(function* () {
      const promotionCases = [
        { records: integrationRecords(), terminal: "Succeeded" as const, terminalPosition: 15 },
        { records: stalePromotionRecords(), terminal: "Stale" as const, terminalPosition: 15 },
        { records: nonConvergentPromotionRecords(), terminal: "NonConvergent" as const, terminalPosition: 17 }
      ]
      for (const promotionCase of promotionCases) {
        const first = promotionCase.records[0]
        if (first === undefined) return yield* Effect.die("promotion matrix fixture is empty")
        const reader = makeTraceReader({ read: () => Effect.succeed(promotionCase.records) })
        for (let position = 1; position <= promotionCase.records.length; position += 1) {
          const view = yield* reader.readAt(
            TraceCursor.make({ position: JournalPosition.make(position), runId: first.runId })
          )
          vitestExpect(view.facets.integration.facts.every(({ source }) => source.position <= position)).toBe(true)
          if (position === 14) {
            vitestExpect(view.facets.recovery.observationGaps.map(({ _tag }) => _tag)).toContain("PromotionResult")
          }
          if (position < 12) {
            vitestExpect(view.facets.integration.facts.some(({ _tag }) => _tag === "CandidateQualification")).toBe(
              false
            )
          }
          if (position >= promotionCase.terminalPosition) {
            const terminal = view.facets.integration.facts.find(
              (fact) => fact._tag === "Promotion" && fact.kind === promotionCase.terminal
            )
            if (terminal?._tag !== "Promotion") return yield* Effect.die("promotion terminal fact missing")
            vitestExpect(terminal.source.position).toBe(promotionCase.terminalPosition)
          }
        }
      }

      const finality = finalityRecords()
      const finalityReader = makeTraceReader({ read: () => Effect.succeed(finality) })
      for (const position of [15, 16, 18, 19, 22, 23, 26, 27, 29]) {
        const view = yield* finalityReader.readAt(
          TraceCursor.make({ position: JournalPosition.make(position), runId: integrationFinalityFixture.runId })
        )
        vitestExpect(view.items.every(({ identity }) => identity.position <= position)).toBe(true)
        vitestExpect(view.facets.integration.facts.every(({ source }) => source.position <= position)).toBe(true)
      }
      const settled = yield* finalityReader.readAt(
        TraceCursor.make({ position: JournalPosition.make(29), runId: integrationFinalityFixture.runId })
      )
      const finalityTags = settled.facets.integration.facts.flatMap((fact) =>
        fact._tag === "Completion" ? [fact.event._tag] : []
      )
      vitestExpect(finalityTags).toEqual(
        vitestExpect.arrayContaining([
          "CompletionClaimReplacementIntended",
          "CompletionClaimReplacementAttemptIntended",
          "CompletionClaimReplaced",
          "CompletionTaskIntended",
          "CompletionTaskAttemptIntended",
          "CompletionTaskAcknowledged",
          "CompletionClaimDeletionIntended",
          "CompletionClaimDeletionAttemptIntended",
          "CompletionClaimDeleted",
          "IntegrationFinalitySettled"
        ])
      )
      const matrixPromotion = settled.facets.integration.facts.filter(
        (fact) => fact._tag === "Promotion" && fact.kind !== "Requested"
      )
      vitestExpect(matrixPromotion.map((fact) => String(fact._tag))).not.toContain("Archive")
      vitestExpect(settled.items.map(({ occurrence }) => String(occurrence._tag))).not.toContain("CoordinatorCrashed")

      const orderView = yield* makeTraceReader({ read: () => Effect.succeed(responsibilityOrderRecords()) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(17), runId: integrationFinalityFixture.runId })
      )
      const responsibilities = orderView.facets.integration.facts.filter((fact) => fact._tag === "Responsibility")
      if (responsibilities.length !== 3) return yield* Effect.die("responsibility order fixture is incomplete")
      const firstResponsibility = responsibilities[0]
      const secondResponsibility = responsibilities[1]
      const independentResponsibility = responsibilities[2]
      if (
        firstResponsibility?._tag !== "Responsibility" ||
        secondResponsibility?._tag !== "Responsibility" ||
        independentResponsibility?._tag !== "Responsibility"
      ) {
        return yield* Effect.die("responsibility order facts are not typed")
      }
      vitestExpect(firstResponsibility.sameTargetPredecessor).toBeNull()
      vitestExpect(secondResponsibility.sameTargetPredecessor?.position).toBe(JournalPosition.make(4))
      vitestExpect(independentResponsibility.sameTargetPredecessor).toBeNull()
      vitestExpect(secondResponsibility.target.ref).toBe(firstResponsibility.target.ref)
      vitestExpect(independentResponsibility.target.ref).not.toBe(firstResponsibility.target.ref)
    })
)

it.effect("#81/#82 reject invalid historical relationship tables and property mutations without a partial facet", () =>
  Effect.gen(function* () {
    const records = finalityRecords()
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(29), runId: integrationFinalityFixture.runId })
    )
    const sessionStarted = view.facets.integration.facts.find(({ _tag }) => _tag === "SessionStarted")
    const responsibility = view.facets.integration.facts.find(({ _tag }) => _tag === "Responsibility")
    const candidateQualification = view.facets.integration.facts.find(({ _tag }) => _tag === "CandidateQualification")
    const integratorResult = view.facets.integration.facts.find(({ _tag }) => _tag === "IntegratorResult")
    const promotion = view.facets.integration.facts.find((fact) =>
      fact._tag === "Promotion" ? fact.kind === "Succeeded" : false
    )
    const completion = view.facets.integration.facts.find(({ _tag }) => _tag === "Completion")
    const beginning = view.items[0]
    if (
      sessionStarted?._tag !== "SessionStarted" ||
      responsibility?._tag !== "Responsibility" ||
      candidateQualification?._tag !== "CandidateQualification" ||
      integratorResult?._tag !== "IntegratorResult" ||
      promotion?._tag !== "Promotion" ||
      completion?._tag !== "Completion" ||
      beginning === undefined
    ) {
      return yield* Effect.die("invalid-history fixture did not produce every integration fact")
    }
    const facts = view.facets.integration.facts
    const replace = (target: (typeof facts)[number], replacement: (typeof facts)[number]) =>
      facts.map((fact) => (fact === target ? replacement : fact))
    const invalidViews = [
      {
        ...view,
        facets: {
          ...view.facets,
          integration: { facts: replace(sessionStarted, { ...sessionStarted, responsibility: beginning.identity }) }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(responsibility, { ...responsibility, sameTargetPredecessor: sessionStarted.source })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(candidateQualification, {
              ...candidateQualification,
              directParents: [GitCommitSha.make("9".repeat(40)), candidateQualification.directParents[1]]
            })
          }
        }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(integratorResult, {
              ...integratorResult,
              run: {
                ...integratorResult.run,
                session: { ...integratorResult.run.session, expectedTargetHead: GitCommitSha.make("8".repeat(40)) }
              }
            })
          }
        }
      },
      {
        ...view,
        facets: { ...view.facets, integration: { facts: replace(promotion, { ...promotion, kind: "Stale" }) } }
      },
      {
        ...view,
        facets: {
          ...view.facets,
          integration: {
            facts: replace(completion, {
              ...completion,
              source: { ...completion.source, position: JournalPosition.make(1) }
            })
          }
        }
      }
    ]
    for (const invalid of invalidViews) {
      vitestExpect(() => Schema.decodeUnknownSync(TraceAtCursor)(invalid)).toThrow()
    }
  })
)

it.effect(
  "#82 rejects contradictory integration prefixes for missing boundaries and wrong run/session/candidate correlations",
  () =>
    Effect.gen(function* () {
      const records = integrationRecords()
      const eventAt = (position: number): JournalRecord["event"] => {
        const item = records.find(({ position: current }) => current === JournalPosition.make(position))
        return Option.getOrThrow(Option.fromUndefinedOr(item?.event))
      }
      const sessionFixed = eventAt(8)
      const runStarted = eventAt(9)
      const resultRecorded = eventAt(10)
      const candidateIntent = eventAt(11)
      const candidateObserved = eventAt(12)
      if (
        sessionFixed._tag !== "IntegratorSessionFixed" ||
        runStarted._tag !== "IntegratorRunStarted" ||
        resultRecorded._tag !== "IntegratorRunResultRecorded" ||
        candidateIntent._tag !== "IntegratorRunCandidateGitReadIntended" ||
        candidateObserved._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("contradictory integration fixture is incomplete")
      }
      const notPrepared = IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: resultRecorded.run.session,
          detail: IntegratorNotPreparedDetail.make("provider did not prepare a candidate")
        }),
        run: resultRecorded.run,
        version: workflowJournalEventVersion
      })
      const wrongCandidateRun = IntegratorRunCorrelation.make({
        ...candidateObserved.run,
        session: { ...candidateObserved.run.session, expectedTargetHead: GitCommitSha.make("7".repeat(40)) }
      })
      const wrongCandidateObservation = IntegratorRunCandidateGitObservedEvent.make({
        candidateText: candidateObserved.candidateText,
        observation: candidateObserved.observation,
        run: wrongCandidateRun,
        version: workflowJournalEventVersion
      })
      const noThirdPromotionAttempt = TargetPromotionNonConvergenceEvent.make({
        attemptLimit: TargetPromotionAttemptLimit.make(3),
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
        correlation: promotionCorrelationFrom(records),
        lastObservation: {
          _tag: "ExpectedHeadStillObserved",
          observedHeadSha: resultRecorded.run.session.expectedTargetHead
        },
        version: workflowJournalEventVersion
      })
      const invalidRecords = [
        records.map((item) => (item.position === JournalPosition.make(8) ? { ...item, event: runStarted } : item)),
        records.map((item) => (item.position === JournalPosition.make(9) ? { ...item, event: resultRecorded } : item)),
        records.map((item) => (item.position === JournalPosition.make(11) ? { ...item, event: resultRecorded } : item)),
        records.map((item) => (item.position === JournalPosition.make(10) ? { ...item, event: notPrepared } : item)),
        records.map((item) =>
          item.position === JournalPosition.make(12) ? { ...item, event: wrongCandidateObservation } : item
        ),
        records.map((item) =>
          item.position === JournalPosition.make(15) ? { ...item, event: noThirdPromotionAttempt } : item
        )
      ]
      const first = records[0]
      if (first === undefined) return yield* Effect.die("contradictory integration fixture is empty")
      for (const malformed of invalidRecords) {
        const failure = yield* Effect.flip(makeTraceReader({ read: () => Effect.succeed(malformed) }).read(first.runId))
        vitestExpect(failure).toBeInstanceOf(TraceProjectionInvalid)
      }
    })
)

it.effect("#81/#82 materialize one prefix view at every cursor without future facet leakage", () =>
  Effect.gen(function* () {
    const records = integrationRecords()
    const reader = makeTraceReader({ read: () => Effect.succeed(records) })
    const firstRecord = records[0]
    if (firstRecord === undefined) return yield* Effect.die("integration fixture is empty")
    for (let position = 1; position <= records.length; position += 1) {
      const cursor = TraceCursor.make({ position: JournalPosition.make(position), runId: firstRecord.runId })
      const view = yield* reader.readAt(cursor)
      vitestExpect(view.items.every(({ identity }) => identity.position <= cursor.position)).toBe(true)
      vitestExpect(view.facets.recovery.observationGaps.every(({ action }) => action.position <= cursor.position)).toBe(
        true
      )
      vitestExpect(view.facets.integration.facts.every(({ source }) => source.position <= cursor.position)).toBe(true)
      if (position < 13) {
        vitestExpect(view.facets.integration.facts.some(({ _tag }) => _tag === "Promotion")).toBe(false)
      }
    }

    const recoveryView = yield* makeTraceReader({ read: () => Effect.succeed(recoveryRecords()) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(4), runId })
    )
    const gap = recoveryView.facets.recovery.observationGaps[0]
    if (gap === undefined) return yield* Effect.die("cursor matrix fixture did not retain an unfinished boundary")
    vitestExpect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...recoveryView,
        facets: {
          ...recoveryView.facets,
          recovery: {
            ...recoveryView.facets.recovery,
            observationGaps: [{ ...gap, action: { ...gap.action, position: JournalPosition.make(0) } }]
          }
        }
      })
    ).toThrow()
  })
)
