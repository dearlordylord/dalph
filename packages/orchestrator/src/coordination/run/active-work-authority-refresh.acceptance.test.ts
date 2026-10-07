import { materializeJournalRecords } from "../../workflow-journal/record-sequence.js"
import { beginPlannedAttemptExecutorWork } from "../../workflow/protocols/planned-attempt-executor-work/guarded-protocol.js"
import { latestAcceptedPlannedAttemptExecutorEvidence } from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { deriveFreshWorkflowDecisions } from "./fresh-workflow.js"
import { reconstructedTaskGraphFor } from "../reconstruction/graph-knowledge.js"
import { replacementContinuationAuthorityFrom } from "../delivery/replacement-continuation-authority.js"
import { outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { recordedTaskAttemptPlanFor } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import { projectWorkflowOccurrences } from "../../workflow/registry/occurrence-projection.js"
import {
  ResultRecoveryAttemptReplacedEvent,
  allocateResultRecoveryReplacementWithPermit,
  recordResultRecoveryReplacementWithPermit,
  resultRecoveryReplacementProblem
} from "../../workflow/protocols/result-recovery/replacement.js"
import { evaluatePlannedAttemptCurrentFactsAuthorization } from "../../workflow/protocols/planned-attempt-continuation/authorization-evaluation.js"
import { evaluateResultRecoveryContinueFacts } from "../../workflow/protocols/result-recovery/authorization.js"
import { evaluateResultRecoveryRestartFacts } from "../../workflow/protocols/result-recovery/restart-authorization.js"
import {
  resultRecoveryRestartReadPlan,
  nextResultRecoveryRestartRead,
  resultRecoveryContinueReadPlan,
  nextResultRecoveryContinueRead
} from "../../workflow/protocols/result-recovery/current-facts.js"
import { deliverResultRecoveryContinue, deliverResultRecoveryRestart } from "../delivery/result-recovery-delivery.js"
import { isAcceptedExecutorCommandDelivery } from "../../workflow/protocols/planned-attempt-executor-work/command-delivery.js"
import { requiredPlannedAttemptPositionsOf } from "./required-planned-attempt-positions.js"
import { reconcileUnsettledPlannedAttemptExecutorCommand } from "../../workflow/protocols/planned-attempt-executor-work/command.js"
import { executeResultRecoveryContinue } from "../../workflow/protocols/result-recovery/execution.js"
import {
  authorizeResultRecoveryContinueWithPermit,
  makeResultRecoveryControl
} from "../../workflow/protocols/result-recovery/control.js"
import {
  plannedAttemptProtocolControllerLayer,
  PlannedAttemptProtocolController
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  ResultRecoveryDirectedEvent,
  ResultRecoveryContinueAuthorizedEvent,
  ResultRecoveryRequestId,
  ResultRecoverySubject
} from "../../workflow/protocols/result-recovery/events.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"
import { it } from "@effect/vitest"
import {
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutor,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedAttemptResultResponseCount,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Context, Effect, Layer, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { PlannedWorktreeReady, UntrackedWorktreePath } from "../../authorities/git/worktree.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { deriveRunnableFrontier, RunnableFrontierTransition } from "../frontier/frontier.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"
import {
  continuationDecisionFor,
  deriveJournalResponsibilityFacts,
  frontierForActivationOpportunity,
  makeRunRecoveryProjection
} from "./recovery-activation.js"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsFor,
  RunActivationOpportunity
} from "./run-activation-opportunity.js"
import { InRunJournal, JournalStorageUnavailable, type JournalRecord } from "../../workflow-journal/store.js"
import { liveJournalTestLayer } from "../delivery/live-journal-test-layer.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsReadFailed,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTaskClaimObserved,
  AuthoritativeTargetLineageObserved,
  WorkflowInterpreter,
  WorkflowTrace,
  type WorkflowInterpreterService
} from "../../workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import {
  journalRecordByKey,
  journalRecordsForOperationId,
  journalRecordsOfKind,
  journalRecordsAfter
} from "../../workflow-journal/record-evidence.js"
import { acceptedOperationIdsOf, pendingReadOperationIdsOf } from "../delivery/delivery-evidence.js"
import { deliveryProposalsOf } from "../delivery/delivery-proposal.js"
import { materializeDeliveryAction } from "../delivery/delivery-action-materialization.js"
import { executeNewRecoveredAction } from "../delivery/recovered-delivery-action-adapter.js"
import type { DeliveryActionExecutionLease } from "../delivery/delivery-action-executor.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"

const runId = RunId.make("active-work-refresh-acceptance-run")
const target = FixtureTarget.make("active-work-refresh-acceptance-target")
const taskId = TaskId.make("active-work-refresh-task-A")
const independentTaskId = TaskId.make("active-work-refresh-task-B")
const specification = makeTaskWorkSpecification({ body: "F1", taskId, title: "F1" })
const independentSpecification = makeTaskWorkSpecification({
  body: "Independent B",
  taskId: independentTaskId,
  title: "Independent B"
})

const secondPlannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("active-work-refresh-attempt-B"),
  baseSha: GitCommitSha.make("c".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/active-work-refresh-B"),
  executor: TaskExecutorLocator.make("executor:active-work-refresh-B"),
  runId,
  taskId: independentTaskId,
  taskRevision: independentSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/active-work-refresh-B")
})

const secondExactAcquisition = {
  operationId: OperationId.make("active-work-refresh-claim-B"),
  owner: ClaimOwner.make("dalph"),
  taskId: independentTaskId,
  token: ClaimToken.make("active-work-refresh-token-B")
} as const
const secondExactClaim = ActiveTaskClaim.make({ ...secondExactAcquisition })

const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/active-work-refresh.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("active-work-refresh-attempt-A"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/active-work-refresh-A"),
  executor: TaskExecutorLocator.make("executor:active-work-refresh"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/active-work-refresh-A")
})
const exactAcquisition = {
  operationId: OperationId.make("active-work-refresh-claim-A"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("active-work-refresh-token-A")
} as const
const exactClaim = ActiveTaskClaim.make({ ...exactAcquisition })

const healthyAuthorityOperations = () => {
  const acquisition = makeTaskClaimAcquisitionOperation({ acquisition: exactAcquisition, predecessorOperationIds: [] })
  const postClaimGraph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("active-work-refresh-post-claim-graph"),
    target,
    [acquisition.acquisition.operationId],
    [taskId]
  )
  const freshWorkSpecification = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("active-work-refresh-fresh-specification"),
    target,
    taskId,
    [postClaimGraph.operationId]
  )
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("active-work-refresh-plan-A"),
    plannedAttempt,
    predecessorOperationIds: [freshWorkSpecification.operationId]
  })
  const freshWorktree = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("active-work-refresh-fresh-worktree"),
    plannedAttempt,
    predecessorOperationIds: [plan.operationId]
  })
  const graph = makeTrackerGraphObservationOperation(
    { _tag: "ExecutingWorkAuthorityCheck" },
    OperationId.make("active-work-refresh-graph"),
    target,
    [plan.operationId],
    [taskId]
  )
  const workSpecification = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("active-work-refresh-specification"),
    target,
    taskId,
    [graph.operationId]
  )
  const claim = makeTaskClaimObservationOperation(
    OperationId.make("active-work-refresh-claim-observation"),
    target,
    taskId,
    [graph.operationId, workSpecification.operationId]
  )
  const worktree = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("active-work-refresh-worktree"),
    plannedAttempt,
    predecessorOperationIds: [claim.operationId]
  })
  const lineage = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("active-work-refresh-lineage"),
    plannedAttempt,
    predecessorOperationIds: [worktree.operationId]
  })
  return {
    acquisition,
    claim,
    freshWorkSpecification,
    freshWorktree,
    graph,
    lineage,
    plan,
    postClaimGraph,
    workSpecification,
    worktree
  } as const
}

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId
})

const snapshotFor = (revision: string) => {
  const projected = projectTrackerSnapshot({
    revision,
    tasks: [
      { id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: independentTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  if (projected._tag !== "Valid") return expect.fail("acceptance graph must be valid")
  return projected.snapshot
}

const buildPrefix = (
  constraint: "Healthy" | "MissingClaim" | "ForeignClaim" | "LostWorktree" | "TargetRewrite" | "UnreadableGraph"
) => {
  const {
    acquisition,
    claim: claimOperation,
    freshWorkSpecification: freshSpecificationOperation,
    freshWorktree: freshWorktreeOperation,
    graph: graphOperation,
    lineage: lineageOperation,
    plan,
    postClaimGraph: postClaimGraphOperation,
    workSpecification: specificationOperation,
    worktree: worktreeOperation
  } = healthyAuthorityOperations()
  const graph = snapshotFor(`active-work-refresh-graph-${constraint}`)
  const claimObservation =
    constraint === "MissingClaim"
      ? { _tag: "UnclaimedTask" as const, taskId }
      : constraint === "ForeignClaim"
        ? ActiveTaskClaim.make({
            ...exactAcquisition,
            operationId: OperationId.make("active-work-refresh-foreign-claim"),
            owner: ClaimOwner.make("another-dalph"),
            token: ClaimToken.make("active-work-refresh-foreign-token")
          })
        : exactClaim
  const worktreeObservation =
    constraint === "LostWorktree"
      ? UntrackedWorktreePath.make({ worktree: plannedAttempt.worktree })
      : {
          _tag: "PlannedWorktreeReady" as const,
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }
  const lineageObservation = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: constraint !== "TargetRewrite",
    plannedBaseSha: plannedAttempt.baseSha,
    targetHeadSha: GitCommitSha.make("b".repeat(40))
  })
  const records = [
    makeWorkflowRunBeganRecord(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }),
      remotePublicationTargetForTest
    ),
    record(2, TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })),
    record(
      3,
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...exactAcquisition },
        version: workflowJournalEventVersion
      })
    ),
    record(4, taskTrackerReadIntent(postClaimGraphOperation)),
    record(
      5,
      taskTrackerFactsObservedEvent(
        postClaimGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(postClaimGraphOperation, graph)
      )
    ),
    record(6, taskTrackerReadIntent(freshSpecificationOperation)),
    record(
      7,
      taskTrackerFactsObservedEvent(
        freshSpecificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(freshSpecificationOperation, specification)
      )
    ),
    record(8, TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })),
    record(
      9,
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: freshWorktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      10,
      TaskWorktreeReadyEvent.make({
        operationId: freshWorktreeOperation.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(
      11,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    ),
    record(
      12,
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      13,
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(
      14,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(15, taskTrackerReadIntent(graphOperation)),
    record(
      16,
      taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        constraint === "UnreadableGraph"
          ? TaskTrackerFactsReadFailed.make({
              completeness: "Unreadable",
              failure: { _tag: "FixtureReadError", detail: "controlled graph is unreadable" },
              operationId: graphOperation.operationId,
              target
            })
          : makeCompleteTaskTrackerFactsObserved(graphOperation, graph)
      )
    ),
    record(17, taskTrackerReadIntent(specificationOperation)),
    record(
      18,
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      )
    ),
    record(19, taskTrackerReadIntent(claimOperation)),
    record(
      20,
      taskTrackerFactsObservedEvent(
        claimOperation.operationId,
        makeFocusedTaskClaimFactsObserved(claimOperation, claimObservation)
      )
    ),
    record(
      21,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      22,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: worktreeObservation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    ),
    record(
      23,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      24,
      TargetLineageObservedEvent.make({
        observation: lineageObservation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  ]
  return records.filter((candidate) => {
    if (constraint === "UnreadableGraph") return candidate.position <= JournalPosition.make(16)
    if (constraint === "MissingClaim" || constraint === "ForeignClaim") {
      return candidate.position <= JournalPosition.make(20)
    }
    if (constraint === "LostWorktree") return candidate.position <= JournalPosition.make(22)
    return true
  })
}

/** Adds a second exact Running responsibility without adding its own active-refresh graph. */
const buildTwoRunningPrefix = (): ReadonlyArray<JournalRecord> => {
  const records = buildPrefix("Healthy")
  const acquisition = makeTaskClaimAcquisitionOperation({
    acquisition: secondExactAcquisition,
    predecessorOperationIds: []
  })
  const postClaimGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("active-work-refresh-post-claim-graph-B"),
    target,
    [secondExactAcquisition.operationId],
    [independentTaskId]
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("active-work-refresh-specification-B"),
    target,
    independentTaskId,
    [postClaimGraphOperation.operationId]
  )
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("active-work-refresh-plan-B"),
    plannedAttempt: secondPlannedAttempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("active-work-refresh-fresh-worktree-B"),
    plannedAttempt: secondPlannedAttempt,
    predecessorOperationIds: [plan.operationId]
  })
  const worktreeProof = PlannedWorktreeReady.make({
    baseSha: secondPlannedAttempt.baseSha,
    branch: secondPlannedAttempt.branch,
    headSha: secondPlannedAttempt.baseSha,
    worktree: secondPlannedAttempt.worktree
  })
  return [
    ...records,
    record(
      25,
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })
    ),
    record(
      26,
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...secondExactAcquisition },
        version: workflowJournalEventVersion
      })
    ),
    record(27, taskTrackerReadIntent(postClaimGraphOperation)),
    record(
      28,
      taskTrackerFactsObservedEvent(
        postClaimGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(
          postClaimGraphOperation,
          snapshotFor("active-work-refresh-post-claim-graph-B")
        )
      )
    ),
    record(29, taskTrackerReadIntent(specificationOperation)),
    record(
      30,
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, independentSpecification)
      )
    ),
    record(31, TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })),
    record(
      32,
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      33,
      TaskWorktreeReadyEvent.make({
        operationId: worktreeOperation.operationId,
        proof: worktreeProof,
        version: workflowJournalEventVersion
      })
    ),
    record(
      34,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: secondPlannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      35,
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        plannedAttempt: secondPlannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      36,
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt: secondPlannedAttempt,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(
      37,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
  ]
}

const appendRecord = (
  records: ReadonlyArray<JournalRecord>,
  event: JournalRecord["event"]
): ReadonlyArray<JournalRecord> => [...records, record(Number(records.at(-1)?.position ?? 0) + 1, event)]

const appendTaskTrackerObservation = <Operation extends Parameters<typeof taskTrackerReadIntent>[0]>(
  records: ReadonlyArray<JournalRecord>,
  operation: Operation,
  observation: Parameters<typeof taskTrackerFactsObservedEvent>[1]
): ReadonlyArray<JournalRecord> =>
  appendRecord(
    appendRecord(records, taskTrackerReadIntent(operation)),
    taskTrackerFactsObservedEvent(operation.operationId, observation)
  )

const appendActiveWorktreeObservation = (
  records: ReadonlyArray<JournalRecord>,
  operation: Extract<
    RunnableFrontierTransition,
    { readonly _tag: "ObservePlannedAttemptContinuationWorktree" }
  >["operation"]
): ReadonlyArray<JournalRecord> => {
  return appendRecord(
    appendRecord(
      records,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
    ),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: {
        _tag: "PlannedWorktreeReady",
        baseSha: operation.plannedAttempt.baseSha,
        branch: operation.plannedAttempt.branch,
        headSha: operation.plannedAttempt.baseSha,
        worktree: operation.plannedAttempt.worktree
      },
      occurrenceClassification: "NonActionOccurrence",
      operationId: operation.operationId,
      version: workflowJournalEventVersion
    })
  )
}

const appendActiveLineageObservation = (
  records: ReadonlyArray<JournalRecord>,
  operation: Extract<
    RunnableFrontierTransition,
    { readonly _tag: "ObservePlannedAttemptContinuationTargetLineage" }
  >["operation"],
  plannedBaseIsAncestorOfTargetHead: boolean
): ReadonlyArray<JournalRecord> => {
  return appendRecord(
    appendRecord(
      records,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
    ),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead,
        plannedBaseSha: operation.plannedAttempt.baseSha,
        targetHeadSha: GitCommitSha.make("b".repeat(40))
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: operation.operationId,
      plannedAttempt: operation.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
}

const projectionFor = (
  records: ReadonlyArray<JournalRecord>,
  opportunity: Parameters<typeof continuationDecisionFor>[5],
  configuredIntegrationTarget?: IntegrationTarget,
  activationBoundary?: JournalPosition
) =>
  Effect.gen(function* () {
    // The first journal read is the activation boundary. The recovery pass
    // then sees the provider facts appended after that boundary, matching the
    // production journal-first sequence instead of treating the completed
    // fixture as its own baseline.
    const runningBoundary =
      activationBoundary ??
      records.findLast(
        ({ event }) =>
          (event._tag === "PlannedAttemptExecutorWorkReported" ||
            event._tag === "PlannedAttemptExecutorCommandResponseObserved") &&
          event.report._tag === "ExecutorWorkExecuting"
      )?.position
    const initialRecords =
      runningBoundary === undefined ? records : records.filter(({ position }) => position <= runningBoundary)
    const context = yield* Layer.build(liveJournalTestLayer({ records: initialRecords, runId, target }))
    const journal = Context.get(context, InRunJournal)
    const recovery = yield* makeRunRecoveryProjection(
      runId,
      configuredIntegrationTarget,
      undefined,
      undefined,
      false,
      false,
      opportunity
    ).pipe(Effect.provide(context))
    for (const record of records.filter(
      ({ position }) => runningBoundary !== undefined && position > runningBoundary
    )) {
      if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
        return yield* Effect.die("active-refresh fixture successors must be ordinary in-Run events")
      }
      yield* journal.append(record.runId, record.key, record.event)
    }
    return yield* recovery.readDeliveryProjection
  })

const availableEvidenceFor = (projection: { readonly evidence: DeliveryProjectionEvidence }) => {
  if (projection.evidence._tag !== "AvailableDeliveryProjectionEvidence") {
    return expect.fail("active-work refresh acceptance projection must include readable evidence")
  }
  return projection.evidence
}

const eventOperationId = (event: JournalRecord["event"]): OperationId | undefined => {
  if (event._tag === "GitReadIntentRecorded" || event._tag === "TaskTrackerReadIntentRecorded") {
    return event.operation.operationId
  }
  if (
    event._tag === "PlannedAttemptWorktreeObserved" ||
    event._tag === "TargetLineageObserved" ||
    event._tag === "TaskTrackerFactsObserved"
  ) {
    return event.operationId
  }
  return undefined
}

const recoveredReadLease: DeliveryActionExecutionLease = {
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: {
    _tag: "InterruptibleBoundary",
    execution: { run: (_intent, effect, recordResult) => effect.pipe(Effect.flatMap(recordResult)) }
  },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    isActive: () => Effect.succeed(false),
    isHeld: () => Effect.succeed(false),
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilities: [], heldResponsibilities: [] }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("ordinary read recovery does not use the executor protocol")
}

it.effect("starts G1 only from a current accepted Executing lifecycle report", () =>
  Effect.gen(function* () {
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
    )
    const acceptedPrefix = buildPrefix("Healthy").filter(({ position }) => position <= JournalPosition.make(14))
    const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const cases = [
      {
        expectedG1: false,
        name: "command response awaiting lifecycle acceptance",
        records: acceptedPrefix.filter(({ position }) => position <= JournalPosition.make(13))
      },
      { expectedG1: true, name: "accepted Executing lifecycle report", records: acceptedPrefix },
      {
        expectedG1: false,
        name: "distinct exact state projection awaiting lifecycle acceptance",
        records: [
          ...acceptedPrefix,
          record(
            15,
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
                report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                  correlation: { attemptId: plannedAttempt.attemptId, runId },
                  result: { _tag: "Completed" }
                })
              }),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: observationOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
        ]
      },
      {
        expectedG1: false,
        name: "later non-exact state projection",
        records: [
          ...acceptedPrefix,
          record(
            15,
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: observationOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
        ]
      }
    ] as const

    for (const lifecycleCase of cases) {
      const projection = yield* projectionFor(lifecycleCase.records, opportunity)
      const graphReads = projection.frontier.transitions.filter(
        ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
      )
      expect(graphReads, lifecycleCase.name).toMatchObject(
        lifecycleCase.expectedG1
          ? [
              {
                operation: { cause: { _tag: "ExecutingWorkAuthorityCheck" } },
                plannedAttempt: { attemptId: plannedAttempt.attemptId, runId }
              }
            ]
          : []
      )
    }
  })
)

it.effect("active-work refresh recovers ordinary authority reads without a private refresh protocol", () =>
  Effect.gen(function* () {
    const operations = healthyAuthorityOperations()
    const ordinaryReads = [
      { kind: "graph", operationId: operations.graph.operationId, prefixPosition: 14 },
      { kind: "specification", operationId: operations.workSpecification.operationId, prefixPosition: 16 },
      { kind: "claim", operationId: operations.claim.operationId, prefixPosition: 18 },
      { kind: "worktree", operationId: operations.worktree.operationId, prefixPosition: 20 },
      { kind: "lineage", operationId: operations.lineage.operationId, prefixPosition: 22 }
    ] as const
    const crashCuts = ["intent-before-call", "response-before-observation"] as const

    for (const ordinaryRead of ordinaryReads) {
      for (const crashCut of crashCuts) {
        const initialRecords = buildPrefix("Healthy").filter(
          ({ position }) => position <= JournalPosition.make(ordinaryRead.prefixPosition)
        )
        const context = yield* Layer.build(liveJournalTestLayer({ records: initialRecords, runId, target }))
        const liveJournal = Context.get(context, InRunJournal)
        const acceptedReader = Context.get(context, AcceptedJournalReader)
        const providerOperationIds = yield* Ref.make<ReadonlyArray<OperationId>>([])
        const failNextOutcome = yield* Ref.make(crashCut === "response-before-observation")
        const journal = InRunJournal.of({
          append: (appendedRunId, key, event) =>
            Effect.gen(function* () {
              if (
                eventOperationId(event) === ordinaryRead.operationId &&
                (event._tag === "TaskTrackerFactsObserved" ||
                  event._tag === "PlannedAttemptWorktreeObserved" ||
                  event._tag === "TargetLineageObserved") &&
                (yield* Ref.getAndSet(failNextOutcome, false))
              ) {
                return yield* new JournalStorageUnavailable({
                  detail: `controlled process loss after ${ordinaryRead.kind} provider response`,
                  operation: "JournalStore.append"
                })
              }
              return yield* liveJournal.append(appendedRunId, key, event)
            }),
          read: liveJournal.read
        })
        const counted = <A>(operationId: OperationId, value: A) =>
          Ref.update(providerOperationIds, (current) => [...current, operationId]).pipe(Effect.as(value))
        const unused = () => Effect.die("ordinary read recovery used an unrelated interpreter method")
        const provider = WorkflowInterpreter.of({
          readTaskAttemptBase: () => Effect.die("this fixture does not select a task-attempt Base read"),
          acquireTaskClaim: unused,
          readTaskClaim: (operation) =>
            counted(operation.operationId, AuthoritativeTaskClaimObserved.make({ observation: exactClaim })),
          readTaskWorktree: (operation) =>
            counted(
              operation.operationId,
              AuthoritativePlannedAttemptWorktreeObserved.make({
                observation: PlannedWorktreeReady.make({
                  baseSha: plannedAttempt.baseSha,
                  branch: plannedAttempt.branch,
                  headSha: plannedAttempt.baseSha,
                  worktree: plannedAttempt.worktree
                })
              })
            ),
          readTargetLineage: (operation) =>
            counted(
              operation.operationId,
              AuthoritativeTargetLineageObserved.make({
                observation: TargetLineageObservation.make({
                  plannedBaseIsAncestorOfTargetHead: true,
                  plannedBaseSha: plannedAttempt.baseSha,
                  targetHeadSha: GitCommitSha.make("b".repeat(40))
                })
              })
            ),
          readTrackerGraph: (operation) =>
            counted(operation.operationId, snapshotFor("active-work-refresh-recovered-graph")),
          readTaskWorkSpecification: (operation) => counted(operation.operationId, specification),
          reconcileTaskWorktree: unused,
          recordTaskAttemptPlan: unused,
          releaseTaskClaim: unused
        })
        const invoke = (
          interpreter: WorkflowInterpreterService,
          onIntentRecorded: Effect.Effect<void> = Effect.void
        ) => {
          switch (ordinaryRead.kind) {
            case "graph":
              return interpreter.readTrackerGraph(operations.graph, onIntentRecorded)
            case "specification":
              return interpreter.readTaskWorkSpecification(operations.workSpecification, onIntentRecorded)
            case "claim":
              return interpreter.readTaskClaim(operations.claim, onIntentRecorded)
            case "worktree":
              return interpreter.readTaskWorktree(operations.worktree, onIntentRecorded)
            case "lineage":
              return interpreter.readTargetLineage(operations.lineage, onIntentRecorded)
          }
        }
        const runAttempt = (onIntentRecorded?: Effect.Effect<void>) =>
          Effect.gen(function* () {
            const interpreter = yield* WorkflowInterpreter
            return yield* invoke(interpreter, onIntentRecorded)
          }).pipe(
            Effect.provide(
              journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, provider)).pipe(
                Layer.provide(
                  Layer.merge(
                    Layer.succeed(InRunJournal, journal),
                    Layer.succeed(AcceptedJournalReader, acceptedReader)
                  )
                )
              )
            )
          )

        const first = yield* runAttempt(
          crashCut === "intent-before-call"
            ? Effect.die(`controlled process loss after ${ordinaryRead.kind} intent`)
            : Effect.void
        ).pipe(Effect.exit)
        expect(first._tag, `${ordinaryRead.kind} ${crashCut}`).toBe("Failure")
        expect(
          (yield* Ref.get(providerOperationIds)).length,
          `${ordinaryRead.kind} ${crashCut} first provider calls`
        ).toBe(crashCut === "intent-before-call" ? 0 : 1)

        yield* runAttempt()

        const recoveredProviderOperationIds = yield* Ref.get(providerOperationIds)
        expect(recoveredProviderOperationIds.length, `${ordinaryRead.kind} ${crashCut} recovered provider calls`).toBe(
          crashCut === "intent-before-call" ? 1 : 2
        )
        expect(recoveredProviderOperationIds.every((operationId) => operationId === ordinaryRead.operationId)).toBe(
          true
        )
        const accepted = yield* acceptedReader.readAccepted(runId)
        const targetRecords = Array.from(journalRecordsForOperationId(accepted, ordinaryRead.operationId))
        expect(
          targetRecords.map(({ event }) => event._tag),
          `${ordinaryRead.kind} ${crashCut} ordinary protocol`
        ).toEqual([
          ordinaryRead.kind === "worktree" || ordinaryRead.kind === "lineage"
            ? "GitReadIntentRecorded"
            : "TaskTrackerReadIntentRecorded",
          ordinaryRead.kind === "worktree"
            ? "PlannedAttemptWorktreeObserved"
            : ordinaryRead.kind === "lineage"
              ? "TargetLineageObserved"
              : "TaskTrackerFactsObserved"
        ])
        expect(targetRecords.every(({ event }) => eventOperationId(event) === ordinaryRead.operationId)).toBe(true)
      }
    }
  })
)

it.effect("production delivery composition settles the exact pending specification and claim identities", () =>
  Effect.gen(function* () {
    const ordinaryReads = [
      { kind: "specification", prefixPosition: 16 },
      { kind: "claim", prefixPosition: 16 }
    ] as const
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
    )

    for (const ordinaryRead of ordinaryReads) {
      let initialRecords: ReadonlyArray<JournalRecord> = buildPrefix("Healthy").filter(
        ({ position }) => position <= JournalPosition.make(ordinaryRead.prefixPosition)
      )
      if (ordinaryRead.kind === "claim") {
        const specificationProjection = yield* projectionFor(initialRecords, opportunity)
        const specificationTransition = specificationProjection.frontier.transitions.find(
          (candidate) => candidate._tag === "ObservePlannedAttemptContinuationSpecification"
        )
        if (specificationTransition?._tag !== "ObservePlannedAttemptContinuationSpecification") {
          return yield* Effect.die("missing production specification transition before claim")
        }
        initialRecords = appendRecord(
          appendRecord(initialRecords, taskTrackerReadIntent(specificationTransition.operation)),
          taskTrackerFactsObservedEvent(
            specificationTransition.operation.operationId,
            makeFocusedTaskWorkSpecificationFactsObserved(specificationTransition.operation, specification)
          )
        )
      }
      const beforeCrash = yield* projectionFor(initialRecords, opportunity)
      const selectedTransition =
        ordinaryRead.kind === "specification"
          ? beforeCrash.frontier.transitions.find(
              (
                candidate
              ): candidate is Extract<
                RunnableFrontierTransition,
                { readonly _tag: "ObservePlannedAttemptContinuationSpecification" }
              > => candidate._tag === "ObservePlannedAttemptContinuationSpecification"
            )
          : beforeCrash.frontier.transitions.find(
              (
                candidate
              ): candidate is Extract<
                RunnableFrontierTransition,
                { readonly _tag: "ObservePlannedAttemptContinuationClaim" }
              > => candidate._tag === "ObservePlannedAttemptContinuationClaim"
            )
      if (
        selectedTransition?._tag !== "ObservePlannedAttemptContinuationSpecification" &&
        selectedTransition?._tag !== "ObservePlannedAttemptContinuationClaim"
      ) {
        return yield* Effect.die(
          `missing initial ${ordinaryRead.kind} transition: ${beforeCrash.frontier.transitions
            .map(({ _tag }) => _tag)
            .join(", ")}`
        )
      }
      const operation = selectedTransition.operation
      const context = yield* Layer.build(liveJournalTestLayer({ records: initialRecords, runId, target }))
      const journal = Context.get(context, InRunJournal)
      const acceptedReader = Context.get(context, AcceptedJournalReader)
      const unused = () => Effect.die("focused read recovery used an unrelated interpreter method")
      const provider = WorkflowInterpreter.of({
        readTaskAttemptBase: () => Effect.die("this fixture does not select a task-attempt Base read"),
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.succeed(AuthoritativeTaskClaimObserved.make({ observation: exactClaim })),
        readTaskWorktree: unused,
        readTargetLineage: unused,
        readTrackerGraph: unused,
        readTaskWorkSpecification: () => Effect.succeed(specification),
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
      const interpreterLayer = journaledWorkflowInterpreterLayer(
        runId,
        Layer.succeed(WorkflowInterpreter, provider)
      ).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(InRunJournal, journal), Layer.succeed(AcceptedJournalReader, acceptedReader))
        )
      )
      const crashAfterIntent = Effect.gen(function* () {
        const interpreter = yield* WorkflowInterpreter
        if (ordinaryRead.kind === "specification") {
          if (operation._tag !== "ReadTaskWorkSpecification") {
            return yield* Effect.die("specification transition carried the wrong read family")
          }
          return yield* interpreter.readTaskWorkSpecification(
            operation,
            Effect.die("controlled process loss after specification intent")
          )
        }
        if (operation._tag !== "ReadTaskClaim") {
          return yield* Effect.die("claim transition carried the wrong read family")
        }
        return yield* interpreter.readTaskClaim(operation, Effect.die("controlled process loss after claim intent"))
      }).pipe(Effect.provide(interpreterLayer))
      expect((yield* Effect.exit(crashAfterIntent))._tag).toBe("Failure")

      const acceptedAfterCrash = yield* acceptedReader.readAccepted(runId)
      expect(Array.from(journalRecordsForOperationId(acceptedAfterCrash, operation.operationId))).toEqual([
        expect.objectContaining({ event: expect.objectContaining({ _tag: "TaskTrackerReadIntentRecorded" }) })
      ])
      const recovery = yield* makeRunRecoveryProjection(
        runId,
        undefined,
        undefined,
        undefined,
        false,
        false,
        opportunity
      ).pipe(Effect.provide(context))
      const projection = yield* recovery.readDeliveryProjection
      const recoveredTransition =
        ordinaryRead.kind === "specification"
          ? projection.frontier.transitions.find(
              (
                candidate
              ): candidate is Extract<
                RunnableFrontierTransition,
                { readonly _tag: "ObservePlannedAttemptContinuationSpecification" }
              > => candidate._tag === "ObservePlannedAttemptContinuationSpecification"
            )
          : projection.frontier.transitions.find(
              (
                candidate
              ): candidate is Extract<
                RunnableFrontierTransition,
                { readonly _tag: "ObservePlannedAttemptContinuationClaim" }
              > => candidate._tag === "ObservePlannedAttemptContinuationClaim"
            )
      if (recoveredTransition?.operation.operationId !== operation.operationId) {
        return yield* Effect.die(
          `missing recovered ${ordinaryRead.kind} transition: ${projection.frontier.transitions
            .map(({ _tag }) => _tag)
            .join(", ")}`
        )
      }
      const [proposal] = deliveryProposalsOf({
        acceptedOperationIds: acceptedOperationIdsOf(acceptedAfterCrash),
        fresh: [],
        pendingReadOperationIds: pendingReadOperationIdsOf(acceptedAfterCrash),
        runId,
        transitions: [recoveredTransition]
      }).ticketDelivery
      if (proposal === undefined) return yield* Effect.die(`missing recovered ${ordinaryRead.kind} proposal`)
      const materialized = yield* materializeDeliveryAction(proposal).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({ allocate: () => Effect.die("pending read must preserve its journal identity") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("pending read must not plan an attempt") })
        )
      )
      if (
        materialized._tag !== "FreshOperationAction" ||
        materialized.proposal.route._tag !== "RecoveredNewActionRoute"
      ) {
        return yield* Effect.die(`pending ${ordinaryRead.kind} did not materialize as a recovered action`)
      }
      expect(materialized.operationId).toBe(operation.operationId)
      yield* executeNewRecoveredAction(
        materialized.proposal.route.action,
        materialized.operationId,
        recoveredReadLease,
        runId
      ).pipe(
        Effect.provide(interpreterLayer),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(AcceptedJournalReader, acceptedReader),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("ordinary read recovery must not plan a claim") })
        )
      )

      const acceptedAfterExecution = yield* acceptedReader.readAccepted(runId)
      const targetRecords = Array.from(journalRecordsForOperationId(acceptedAfterExecution, operation.operationId))
      expect(targetRecords.map(({ event }) => event._tag)).toEqual([
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      expect(targetRecords.every(({ event }) => eventOperationId(event) === operation.operationId)).toBe(true)
      const nextActivation = yield* makeRunRecoveryProjection(
        runId,
        undefined,
        undefined,
        undefined,
        false,
        false,
        opportunity
      ).pipe(Effect.provide(context))
      expect((yield* nextActivation.readDeliveryProjection).frontier.transitions[0]?._tag).toBe(
        "ObservePlannedAttemptContinuationGraph"
      )
    }
  })
)

it.effect("shares one active graph read across Running attempts before their own focused reads", () =>
  Effect.gen(function* () {
    const records = buildTwoRunningPrefix()
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([
        { runId, attemptId: plannedAttempt.attemptId },
        { runId, attemptId: secondPlannedAttempt.attemptId }
      ])
    )
    const first = yield* projectionFor(records, opportunity)
    const graphReads = first.frontier.transitions.filter(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
    )
    expect(graphReads).toHaveLength(1)
    const graphRead = graphReads[0]
    if (graphRead?._tag !== "ObservePlannedAttemptContinuationGraph") {
      return yield* Effect.die("expected one shared active graph read")
    }
    expect(graphRead.operation.readShape.explicitlyCoveredTaskIds).toEqual(
      [independentTaskId, taskId].toSorted((left, right) => left.localeCompare(right))
    )
    expect(graphRead.operation.predecessorOperationIds).toEqual([
      OperationId.make("active-work-refresh-plan-A"),
      OperationId.make("active-work-refresh-plan-B")
    ])
    expect(
      first.frontier.transitions.filter(
        ({ _tag }) =>
          _tag === "ObservePlannedAttemptExecutorWork" ||
          _tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" ||
          _tag === "ReconcilePlannedAttemptExecutorWork"
      )
    ).toEqual([])

    const graphObservation = taskTrackerFactsObservedEvent(
      graphRead.operation.operationId,
      makeCompleteTaskTrackerFactsObserved(graphRead.operation, snapshotFor("active-work-refresh-shared-graph"))
    )
    const afterGraph = yield* projectionFor(
      [...records, record(38, taskTrackerReadIntent(graphRead.operation)), record(39, graphObservation)],
      opportunity
    )
    const specificationReads = afterGraph.frontier.transitions.filter(
      (
        transition
      ): transition is Extract<
        RunnableFrontierTransition,
        { readonly _tag: "ObservePlannedAttemptContinuationSpecification" }
      > => transition._tag === "ObservePlannedAttemptContinuationSpecification"
    )
    expect(specificationReads).toHaveLength(2)
    expect(
      specificationReads
        .map((transition) => transition.plannedAttempt.attemptId)
        .toSorted((left, right) => left.localeCompare(right))
    ).toEqual(
      [plannedAttempt.attemptId, secondPlannedAttempt.attemptId].toSorted((left, right) => left.localeCompare(right))
    )
    expect(
      afterGraph.frontier.transitions.filter(
        ({ _tag }) =>
          _tag === "ObservePlannedAttemptContinuationGraph" ||
          _tag === "ObservePlannedAttemptExecutorWork" ||
          _tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" ||
          _tag === "ReconcilePlannedAttemptExecutorWork"
      )
    ).toEqual([])
  })
)

it.effect("retains the active boundary while a pending G2 intent awaits replay", () =>
  Effect.gen(function* () {
    const activeGraphOperationId = OperationId.make("active-work-refresh-graph")
    const firstPostClaimGraphOperationId = OperationId.make("active-work-refresh-post-claim-graph")
    const currentGraphOperationId = OperationId.make("active-work-refresh-post-claim-graph-B")
    const pendingG2Operation = makeTrackerGraphObservationOperation(
      { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: currentGraphOperationId },
      OperationId.make("opaque-g2-after-active-graph"),
      target,
      [firstPostClaimGraphOperationId, activeGraphOperationId, currentGraphOperationId]
    )
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([
        { runId, attemptId: plannedAttempt.attemptId },
        { runId, attemptId: secondPlannedAttempt.attemptId }
      ])
    )
    const projection = yield* projectionFor(
      appendRecord(buildTwoRunningPrefix(), taskTrackerReadIntent(pendingG2Operation)),
      opportunity
    )

    expect(projection.activeRefreshBoundary).toEqual({
      _tag: "ActiveRefreshRuntimeBoundary",
      runId,
      reconciledAttempts: [
        { runId, attemptId: plannedAttempt.attemptId },
        { runId, attemptId: secondPlannedAttempt.attemptId }
      ]
    })
    expect(
      projection.frontier.transitions.filter(({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph")
    ).toEqual([])
  })
)

it.effect("keeps an exact reconciled subject behind G2 after later Safe or Terminal", () =>
  Effect.gen(function* () {
    const baseline = JournalPosition.make(37)
    const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const recordsBeforeReconciliation = [
      ...buildTwoRunningPrefix(),
      record(
        38,
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Suspend",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: suspendOrdinal,
          plannedAttempt: secondPlannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    ]
    const recordsThroughExecuting = [
      ...recordsBeforeReconciliation,
      record(
        39,
        PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal: suspendOrdinal,
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt: secondPlannedAttempt,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
          }),
          version: workflowJournalEventVersion
        })
      )
    ]
    const continuation = RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
      operation: makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        OperationId.make("active-work-refresh-B-after-lifecycle-change"),
        target,
        [],
        [secondPlannedAttempt.taskId]
      ),
      plannedAttempt: secondPlannedAttempt
    })
    const foreignAttempt = PlannedTaskAttempt.make({
      ...secondPlannedAttempt,
      attemptId: AttemptId.make("active-work-refresh-attempt-B-foreign")
    })
    const foreignContinuation = RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
      operation: makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        OperationId.make("active-work-refresh-B-foreign-after-lifecycle-change"),
        target,
        [],
        [foreignAttempt.taskId]
      ),
      plannedAttempt: foreignAttempt
    })
    const reconcileClaim = RunnableFrontierTransition.ReconcileTaskClaim({
      operationId: OperationId.make("active-work-refresh-B-reconcile-claim-after-lifecycle-change"),
      taskId: secondPlannedAttempt.taskId
    })
    const frontier = { explanations: [], transitions: [continuation, reconcileClaim, foreignContinuation] }
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([
        { runId, attemptId: plannedAttempt.attemptId },
        { runId, attemptId: secondPlannedAttempt.attemptId }
      ])
    )

    const beforeReconciliation = yield* projectionFor(
      recordsBeforeReconciliation,
      opportunity,
      integrationTarget,
      baseline
    )
    expect(beforeReconciliation.activeRefreshBoundary).toBeUndefined()
    expect(
      frontierForActivationOpportunity(
        frontier,
        recordsBeforeReconciliation,
        Option.some(baseline),
        opportunity,
        beforeReconciliation.activeRefreshBoundary
      ).transitions
    ).toEqual([continuation, reconcileClaim, foreignContinuation])

    const opportunityWithoutB = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
    )
    const foreignOpportunity = activeWorkAuthorityRefreshForOwner(
      "TrackerNotification",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: foreignAttempt.attemptId }])
    )
    expect(
      (yield* projectionFor(recordsThroughExecuting, opportunityWithoutB, integrationTarget, baseline))
        .activeRefreshBoundary
    ).toBeUndefined()
    expect(
      (yield* projectionFor(recordsThroughExecuting, foreignOpportunity, integrationTarget, baseline))
        .activeRefreshBoundary
    ).toBeUndefined()

    const throughExecuting = yield* projectionFor(recordsThroughExecuting, opportunity, integrationTarget, baseline)
    expect(throughExecuting.activeRefreshBoundary).toEqual({
      _tag: "ActiveRefreshRuntimeBoundary",
      runId,
      reconciledAttempts: [{ runId, attemptId: secondPlannedAttempt.attemptId }]
    })
    expect(
      frontierForActivationOpportunity(
        frontier,
        recordsThroughExecuting,
        Option.some(baseline),
        opportunity,
        throughExecuting.activeRefreshBoundary
      ).transitions
    ).toEqual([foreignContinuation])

    const lifecycleCases = [
      {
        name: "Safe",
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
          correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
        })
      },
      {
        name: "Terminal",
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: { attemptId: secondPlannedAttempt.attemptId, runId },
          result: { _tag: "Completed" }
        })
      }
    ] as const

    for (const lifecycleCase of lifecycleCases) {
      const records = [
        ...recordsThroughExecuting,
        record(
          40,
          PlannedAttemptExecutorStateObservedEvent.make({
            observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
              report: lifecycleCase.report
            }),
            occurrenceClassification: "NonActionOccurrence",
            ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
            plannedAttempt: secondPlannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          41,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report: lifecycleCase.report,
            version: workflowJournalEventVersion
          })
        )
      ]
      const projection = yield* projectionFor(records, opportunity, integrationTarget, baseline)
      const reduction = reduceWorkflowJournalHistory(runId, records)
      if (reduction._tag !== "ValidWorkflowJournalHistory") {
        return expect.fail(`${lifecycleCase.name} chronology must reduce`)
      }
      expect(
        reduction.runState.responsibility.entries.some(
          (entry) =>
            entry._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            entry.plannedAttempt.attemptId === secondPlannedAttempt.attemptId
        ),
        lifecycleCase.name
      ).toBe(true)
      expect(projection.activeRefreshBoundary, lifecycleCase.name).toEqual({
        _tag: "ActiveRefreshRuntimeBoundary",
        runId,
        reconciledAttempts: [{ runId, attemptId: secondPlannedAttempt.attemptId }]
      })
      expect(
        frontierForActivationOpportunity(
          frontier,
          records,
          Option.some(baseline),
          opportunity,
          projection.activeRefreshBoundary
        ).transitions,
        lifecycleCase.name
      ).toEqual([foreignContinuation])
      expect(
        frontierForActivationOpportunity(
          frontier,
          records,
          Option.some(baseline),
          RunActivationOpportunity.OrdinaryRunEntry(),
          projection.activeRefreshBoundary
        ).transitions,
        lifecycleCase.name
      ).toEqual([continuation, reconcileClaim, foreignContinuation])
    }
  })
)

it.effect("keeps a directly reconciled Safe or Terminal suspension behind G2", () =>
  Effect.gen(function* () {
    const baseline = JournalPosition.make(37)
    const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const opportunity = activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: secondPlannedAttempt.attemptId }])
    )
    const reports = [
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
      }),
      PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: { attemptId: secondPlannedAttempt.attemptId, runId },
        result: { _tag: "Completed" }
      })
    ] as const

    for (const report of reports) {
      const records = [
        ...buildTwoRunningPrefix(),
        record(
          38,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: suspendOrdinal,
            plannedAttempt: secondPlannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          39,
          PlannedAttemptExecutorCommandProjectionObservedEvent.make({
            commandOrdinal: suspendOrdinal,
            observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({ report }),
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: secondPlannedAttempt,
            projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
            version: workflowJournalEventVersion
          })
        ),
        record(
          40,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report,
            version: workflowJournalEventVersion
          })
        )
      ]

      const projection = yield* projectionFor(records, opportunity, integrationTarget, baseline)
      expect(projection.activeRefreshBoundary, report._tag).toEqual({
        _tag: "ActiveRefreshRuntimeBoundary",
        runId,
        reconciledAttempts: [{ runId, attemptId: secondPlannedAttempt.attemptId }]
      })
    }
  })
)

it.effect("rejects stale, passive, non-Suspend, and unrelated evidence as an active G2 boundary", () =>
  Effect.gen(function* () {
    const baseline = JournalPosition.make(37)
    const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
    })
    const exactSuspendProjection = [
      ...buildTwoRunningPrefix(),
      record(
        38,
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Suspend",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: suspendOrdinal,
          plannedAttempt: secondPlannedAttempt,
          version: workflowJournalEventVersion
        })
      ),
      record(
        39,
        PlannedAttemptExecutorCommandProjectionObservedEvent.make({
          commandOrdinal: suspendOrdinal,
          observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
            report: safe
          }),
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt: secondPlannedAttempt,
          projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
          version: workflowJournalEventVersion
        })
      ),
      record(
        40,
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
          report: safe,
          version: workflowJournalEventVersion
        })
      )
    ]
    const opportunityForB = activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: secondPlannedAttempt.attemptId }])
    )
    const opportunityForA = activeWorkAuthorityRefreshForOwner(
      "Timer",
      activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
    )

    expect(
      (yield* projectionFor(exactSuspendProjection, opportunityForB, integrationTarget, JournalPosition.make(39)))
        .activeRefreshBoundary,
      "pre-baseline projection"
    ).toBeUndefined()

    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: { attemptId: secondPlannedAttempt.attemptId, runId }
    })
    const passiveExecutingObservation = [
      ...buildTwoRunningPrefix(),
      record(
        38,
        PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: executing }),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
          plannedAttempt: secondPlannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    ]
    expect(
      (yield* projectionFor(passiveExecutingObservation, opportunityForB, integrationTarget, baseline))
        .activeRefreshBoundary,
      "ordinary executor observation"
    ).toBeUndefined()

    const resumeProjection = [
      ...exactSuspendProjection,
      record(
        41,
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Resume",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: PlannedAttemptExecutorCommandOrdinal.make(3),
          plannedAttempt: secondPlannedAttempt,
          version: workflowJournalEventVersion
        })
      ),
      record(
        42,
        PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(3),
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt: secondPlannedAttempt,
          report: executing,
          version: workflowJournalEventVersion
        })
      ),
      record(
        43,
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
          report: executing,
          version: workflowJournalEventVersion
        })
      )
    ]
    expect(
      (yield* projectionFor(resumeProjection, opportunityForB, integrationTarget, JournalPosition.make(40)))
        .activeRefreshBoundary,
      "non-Suspend command"
    ).toBeUndefined()
    expect(
      (yield* projectionFor(exactSuspendProjection, opportunityForA, integrationTarget, baseline))
        .activeRefreshBoundary,
      "unrelated attempt"
    ).toBeUndefined()
  })
)

it.effect(
  "refreshes two Running attempts through independent authority chains and suspends only the constrained subject",
  () =>
    Effect.gen(function* () {
      const scenarios = [
        { constraint: "MissingClaim", constrainedAttempt: plannedAttempt },
        { constraint: "ForeignClaim", constrainedAttempt: plannedAttempt },
        { constraint: "TargetRewrite", constrainedAttempt: plannedAttempt },
        { constraint: "TargetRewrite", constrainedAttempt: secondPlannedAttempt }
      ] as const

      for (const { constrainedAttempt, constraint } of scenarios) {
        const healthyAttempt =
          constrainedAttempt.attemptId === plannedAttempt.attemptId ? secondPlannedAttempt : plannedAttempt
        const opportunity = activeWorkAuthorityRefreshForOwner(
          "TrackerNotification",
          activeWorkAuthorityRefreshSubjectsFor([
            { runId, attemptId: plannedAttempt.attemptId },
            { runId, attemptId: secondPlannedAttempt.attemptId }
          ])
        )
        let records = buildTwoRunningPrefix()
        let projection = yield* projectionFor(records, opportunity, integrationTarget)
        const graphReads = projection.frontier.transitions.filter(
          ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
        )
        expect(graphReads).toHaveLength(1)
        const graphRead = graphReads[0]
        if (graphRead?._tag !== "ObservePlannedAttemptContinuationGraph") {
          return yield* Effect.die("expected one shared active graph read")
        }
        expect(graphRead.operation.readShape.explicitlyCoveredTaskIds).toEqual(
          [taskId, independentTaskId].toSorted((left, right) => left.localeCompare(right))
        )
        records = appendRecord(
          appendRecord(records, taskTrackerReadIntent(graphRead.operation)),
          taskTrackerFactsObservedEvent(
            graphRead.operation.operationId,
            makeCompleteTaskTrackerFactsObserved(graphRead.operation, snapshotFor(`two-running-${constraint}`))
          )
        )
        projection = yield* projectionFor(records, opportunity, integrationTarget)

        const specificationReads = projection.frontier.transitions.filter(
          (
            transition
          ): transition is Extract<
            RunnableFrontierTransition,
            { readonly _tag: "ObservePlannedAttemptContinuationSpecification" }
          > => transition._tag === "ObservePlannedAttemptContinuationSpecification"
        )
        expect(specificationReads).toHaveLength(2)
        expect(
          specificationReads
            .map(({ plannedAttempt }) => plannedAttempt.attemptId)
            .toSorted((left, right) => left.localeCompare(right))
        ).toEqual(
          [plannedAttempt.attemptId, secondPlannedAttempt.attemptId].toSorted((left, right) =>
            left.localeCompare(right)
          )
        )
        for (const transition of specificationReads.toSorted((left, right) =>
          left.plannedAttempt.attemptId.localeCompare(right.plannedAttempt.attemptId)
        )) {
          const specificationForAttempt =
            transition.plannedAttempt.attemptId === plannedAttempt.attemptId ? specification : independentSpecification
          records = appendTaskTrackerObservation(
            records,
            transition.operation,
            makeFocusedTaskWorkSpecificationFactsObserved(transition.operation, specificationForAttempt)
          )
        }
        projection = yield* projectionFor(records, opportunity, integrationTarget)

        const claimReads = projection.frontier.transitions.filter(
          (
            transition
          ): transition is Extract<
            RunnableFrontierTransition,
            { readonly _tag: "ObservePlannedAttemptContinuationClaim" }
          > => transition._tag === "ObservePlannedAttemptContinuationClaim"
        )
        expect(claimReads).toHaveLength(2)
        for (const transition of claimReads.toSorted((left, right) =>
          left.plannedAttempt.attemptId.localeCompare(right.plannedAttempt.attemptId)
        )) {
          const isConstrained = transition.plannedAttempt.attemptId === constrainedAttempt.attemptId
          const claimObservation =
            isConstrained && constraint === "MissingClaim"
              ? { _tag: "UnclaimedTask" as const, taskId: transition.plannedAttempt.taskId }
              : isConstrained && constraint === "ForeignClaim"
                ? ActiveTaskClaim.make({
                    operationId: OperationId.make(`two-running-foreign-${transition.plannedAttempt.attemptId}`),
                    owner: ClaimOwner.make("another-dalph"),
                    taskId: transition.plannedAttempt.taskId,
                    token: ClaimToken.make(`two-running-foreign-token-${transition.plannedAttempt.attemptId}`)
                  })
                : transition.plannedAttempt.attemptId === plannedAttempt.attemptId
                  ? exactClaim
                  : secondExactClaim
          records = appendTaskTrackerObservation(
            records,
            transition.operation,
            makeFocusedTaskClaimFactsObserved(transition.operation, claimObservation)
          )
        }
        projection = yield* projectionFor(records, opportunity, integrationTarget)

        const expectedGitSubjects = constraint === "TargetRewrite" ? 2 : 1
        const worktreeReads = projection.frontier.transitions.filter(
          (
            transition
          ): transition is Extract<
            RunnableFrontierTransition,
            { readonly _tag: "ObservePlannedAttemptContinuationWorktree" }
          > => transition._tag === "ObservePlannedAttemptContinuationWorktree"
        )
        expect(
          worktreeReads,
          `${constraint}: ${JSON.stringify({ transitions: projection.frontier.transitions, facts: availableEvidenceFor(projection).facts })}`
        ).toHaveLength(expectedGitSubjects)
        expect(worktreeReads.map(({ plannedAttempt }) => plannedAttempt.attemptId)).toEqual(
          (constraint === "TargetRewrite"
            ? [plannedAttempt.attemptId, secondPlannedAttempt.attemptId]
            : [healthyAttempt.attemptId]
          ).toSorted((left, right) => left.localeCompare(right))
        )
        for (const transition of worktreeReads.toSorted((left, right) =>
          left.plannedAttempt.attemptId.localeCompare(right.plannedAttempt.attemptId)
        )) {
          records = appendActiveWorktreeObservation(records, transition.operation)
        }
        projection = yield* projectionFor(records, opportunity, integrationTarget)

        const lineageReads = projection.frontier.transitions.filter(
          (
            transition
          ): transition is Extract<
            RunnableFrontierTransition,
            { readonly _tag: "ObservePlannedAttemptContinuationTargetLineage" }
          > => transition._tag === "ObservePlannedAttemptContinuationTargetLineage"
        )
        expect(lineageReads).toHaveLength(expectedGitSubjects)
        expect(lineageReads.map(({ plannedAttempt }) => plannedAttempt.attemptId)).toEqual(
          (constraint === "TargetRewrite"
            ? [plannedAttempt.attemptId, secondPlannedAttempt.attemptId]
            : [healthyAttempt.attemptId]
          ).toSorted((left, right) => left.localeCompare(right))
        )
        for (const transition of lineageReads.toSorted((left, right) =>
          left.plannedAttempt.attemptId.localeCompare(right.plannedAttempt.attemptId)
        )) {
          records = appendActiveLineageObservation(
            records,
            transition.operation,
            transition.plannedAttempt.attemptId !== constrainedAttempt.attemptId
          )
        }
        projection = yield* projectionFor(records, opportunity, integrationTarget)

        const executorTransitions = projection.frontier.transitions.filter(
          ({ _tag }) =>
            _tag === "ObservePlannedAttemptExecutorWork" ||
            _tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" ||
            _tag === "ReconcilePlannedAttemptExecutorWork" ||
            _tag === "SuspendPlannedAttemptExecutorWork"
        )
        expect(executorTransitions).toHaveLength(1)
        const [executorTransition] = executorTransitions
        expect(executorTransition).toEqual(
          RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: constrainedAttempt })
        )
        expect(
          projection.frontier.transitions.some(
            (transition) =>
              "plannedAttempt" in transition && transition.plannedAttempt.attemptId === healthyAttempt.attemptId
          )
        ).toBe(false)

        const facts = availableEvidenceFor(projection).facts.filter(
          ({ _tag, responsibility }) =>
            _tag === "PlannedAttemptExecutorFreshFacts" &&
            (responsibility.plannedAttempt.attemptId === constrainedAttempt.attemptId ||
              responsibility.plannedAttempt.attemptId === healthyAttempt.attemptId)
        )
        expect(facts).toHaveLength(2)
        const constrainedFacts = facts.find(
          ({ responsibility }) =>
            responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            responsibility.plannedAttempt.attemptId === constrainedAttempt.attemptId
        )
        const healthyFacts = facts.find(
          ({ responsibility }) =>
            responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            responsibility.plannedAttempt.attemptId === healthyAttempt.attemptId
        )
        expect(constrainedFacts).toMatchObject({
          responsibility: {
            beganAt:
              constrainedAttempt.attemptId === plannedAttempt.attemptId
                ? JournalPosition.make(11)
                : JournalPosition.make(34)
          },
          disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
        })
        expect(healthyFacts).toMatchObject({
          responsibility: {
            beganAt:
              healthyAttempt.attemptId === plannedAttempt.attemptId
                ? JournalPosition.make(11)
                : JournalPosition.make(34)
          },
          disposition: { _tag: "Ready" }
        })

        const freshFocusedFacts = records.flatMap(({ event, position }) => {
          if (position <= JournalPosition.make(37) || event._tag !== "TaskTrackerFactsObserved") return []
          return event.observation._tag === "FocusedTaskWorkSpecificationFacts" ||
            event.observation._tag === "FocusedTaskClaimFacts"
            ? [event.observation]
            : []
        })
        expect(
          freshFocusedFacts.filter(
            (observation) =>
              observation._tag === "FocusedTaskWorkSpecificationFacts" &&
              observation.factFamily.taskId === plannedAttempt.taskId
          )
        ).toHaveLength(1)
        expect(
          freshFocusedFacts.filter(
            (observation) =>
              observation._tag === "FocusedTaskWorkSpecificationFacts" &&
              observation.factFamily.taskId === secondPlannedAttempt.taskId
          )
        ).toHaveLength(1)
        expect(
          freshFocusedFacts.filter(
            (observation) =>
              observation._tag === "FocusedTaskClaimFacts" && observation.coverage.taskId === plannedAttempt.taskId
          )
        ).toHaveLength(1)
        expect(
          freshFocusedFacts.filter(
            (observation) =>
              observation._tag === "FocusedTaskClaimFacts" &&
              observation.coverage.taskId === secondPlannedAttempt.taskId
          )
        ).toHaveLength(1)

        const gitIntents = records.flatMap(({ event, position }) =>
          position > JournalPosition.make(37) && event._tag === "GitReadIntentRecorded" ? [event] : []
        )
        expect(new Set(gitIntents.map(({ operation }) => operation.plannedAttempt.attemptId))).toEqual(
          new Set(
            constraint === "TargetRewrite"
              ? [plannedAttempt.attemptId, secondPlannedAttempt.attemptId]
              : [healthyAttempt.attemptId]
          )
        )
        expect(
          records.filter(
            ({ event, position }) =>
              position > JournalPosition.make(37) &&
              (event._tag === "PlannedAttemptExecutorWorkReported" ||
                event._tag === "PlannedAttemptExecutorCommandIntended")
          )
        ).toEqual([])
      }
    })
)

type ControlledBoundaryReadCounts = {
  graph: number
  specification: number
  claim: number
  worktree: number
  lineage: number
  executor: number
}

const controlledBoundarySelectionCountKeys: Readonly<
  Partial<Record<RunnableFrontierTransition["_tag"], keyof ControlledBoundaryReadCounts>>
> = {
  ObservePlannedAttemptExecutorWork: "executor",
  ResumePlannedAttemptExecutorWorkAfterCurrentFacts: "executor",
  ObservePlannedAttemptContinuationClaim: "claim",
  ReconcilePlannedAttemptExecutorWork: "executor",
  ObservePlannedAttemptContinuationGraph: "graph",
  ObservePlannedAttemptContinuationSpecification: "specification",
  ObservePlannedAttemptContinuationTargetLineage: "lineage",
  ObservePlannedAttemptContinuationWorktree: "worktree",
  ObserveResponsibleTaskClaim: "claim",
  SuspendPlannedAttemptExecutorWork: "executor"
}

const countControlledBoundarySelections = (
  transitions: ReadonlyArray<RunnableFrontierTransition>,
  counts: ControlledBoundaryReadCounts
): void => {
  for (const transition of transitions) {
    const countKey = controlledBoundarySelectionCountKeys[transition._tag]
    if (countKey !== undefined) counts[countKey] += 1
  }
}

const expectSuspendAndIndependentProgress = (
  records: ReadonlyArray<JournalRecord>,
  facts: ReturnType<typeof deriveJournalResponsibilityFacts>
) => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag !== "ValidWorkflowJournalHistory") return expect.fail("acceptance prefix must reduce")
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [{ taskId: independentTaskId, taskRevision: independentSpecification.fingerprint }],
    responsibility: reduction.runState.responsibility,
    responsibilityFacts: facts
  })
  expect(frontier.transitions).toEqual([
    RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt }),
    RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: independentTaskId,
      taskRevision: independentSpecification.fingerprint
    })
  ])
  expect(reduction.runState.responsibility.entries).toContainEqual(
    expect.objectContaining({ _tag: "PlannedAttemptExecutorWorkResponsibility", plannedAttempt })
  )
}

it.effect(
  "AcceptedFact publication for a Running attempt uses the ordinary owner entry and performs no authority reads",
  () =>
    Effect.gen(function* () {
      // The owner maps AcceptedFactPublication to OrdinaryRunEntry; the
      // controlled boundary counters make the resulting shortcut observable.
      const records = buildPrefix("Healthy")
      const counts: ControlledBoundaryReadCounts = {
        graph: 0,
        specification: 0,
        claim: 0,
        worktree: 0,
        lineage: 0,
        executor: 0
      }
      const projection = yield* projectionFor(records, RunActivationOpportunity.OrdinaryRunEntry())
      countControlledBoundarySelections(projection.frontier.transitions, counts)

      expect(projection.frontier.transitions).toEqual([
        RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
          acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(1) },
          plannedAttempt
        })
      ])
      expect(counts).toEqual({ graph: 0, specification: 0, claim: 0, worktree: 0, lineage: 0, executor: 1 })
    })
)

it.effect("active refresh retains the exact Running responsibility without retrying an unreadable graph", () =>
  Effect.gen(function* () {
    const records = buildPrefix("UnreadableGraph")
    const projection = yield* projectionFor(
      records,
      activeWorkAuthorityRefreshForOwner(
        "TrackerNotification",
        activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
      )
    )
    const counts: ControlledBoundaryReadCounts = {
      graph: 0,
      specification: 0,
      claim: 0,
      worktree: 0,
      lineage: 0,
      executor: 0
    }
    countControlledBoundarySelections(projection.frontier.transitions, counts)

    const executorFacts = availableEvidenceFor(projection).facts.find(
      ({ _tag }) => _tag === "PlannedAttemptExecutorFreshFacts"
    )
    expect(executorFacts).toMatchObject({
      _tag: "PlannedAttemptExecutorFreshFacts",
      responsibility: { beganAt: JournalPosition.make(11), plannedAttempt },
      disposition: { _tag: "Ready", acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: 1 } }
    })
    expect(projection.frontier.transitions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _tag: "ObservePlannedAttemptExecutorWork" }),
        expect.objectContaining({ _tag: "ResumePlannedAttemptExecutorWorkAfterCurrentFacts" }),
        expect.objectContaining({ _tag: "SuspendPlannedAttemptExecutorWork" }),
        expect.objectContaining({ _tag: "ReconcilePlannedAttemptExecutorWork" })
      ])
    )
    expect(counts).toEqual({ graph: 0, specification: 0, claim: 0, worktree: 0, lineage: 0, executor: 0 })
  })
)

it.effect(
  "tracker notification refreshes a Running attempt and suspends it after an exact foreign claim while independent work continues",
  () =>
    Effect.gen(function* () {
      for (const constraint of ["MissingClaim", "ForeignClaim"] as const) {
        const records = buildPrefix(constraint)
        const projection = yield* projectionFor(
          records,
          activeWorkAuthorityRefreshForOwner(
            "TrackerNotification",
            activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
          )
        )
        const facts = availableEvidenceFor(projection).facts
        const executorFacts = facts.find(({ _tag }) => _tag === "PlannedAttemptExecutorFreshFacts")
        expect(executorFacts).toMatchObject({
          _tag: "PlannedAttemptExecutorFreshFacts",
          disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
        })
        expectSuspendAndIndependentProgress(records, facts)
      }
    })
)

it.effect("configured timer refreshes a Running attempt and suspends it after its exact worktree is lost", () =>
  Effect.gen(function* () {
    const records = buildPrefix("LostWorktree")
    const projection = yield* projectionFor(
      records,
      activeWorkAuthorityRefreshForOwner(
        "Timer",
        activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
      )
    )
    expect(projection.frontier.transitions).toEqual([
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    ])
    expectSuspendAndIndependentProgress(records, availableEvidenceFor(projection).facts)
  })
)

it.effect("recovers the exact active-work suspension after process loss without releasing its position early", () =>
  Effect.gen(function* () {
    const records = buildPrefix("ForeignClaim")
    const restart = yield* projectionFor(
      records,
      activeWorkAuthorityRefreshForOwner(
        "TrackerNotification",
        activeWorkAuthorityRefreshSubjectsFor([{ runId, attemptId: plannedAttempt.attemptId }])
      )
    )
    expect(restart.frontier.transitions).toEqual([
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    ])

    const reduction = reduceWorkflowJournalHistory(runId, records)
    if (reduction._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("acceptance prefix must reduce")
    }
    const facts = deriveJournalResponsibilityFacts(reduction.runState, Option.some(JournalPosition.make(23)))
    expectSuspendAndIndependentProgress(records, facts)
    expect(reduction.runState.responsibility.entries).toContainEqual(
      expect.objectContaining({ plannedAttempt, _tag: "PlannedAttemptExecutorWorkResponsibility" })
    )

    const suspend = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    expect(
      continuationDecisionFor(suspend, records, undefined, Option.some(JournalPosition.make(23)), Option.none())
    ).toEqual({ transition: suspend })
  })
)

it("reconstructs accepted rejection as retained recovery work and preserves newer unavailable authority", () => {
  const report = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    reason: "ResultEnvelopeInvalid",
    recoveryCause: "Deadline",
    responseCount: PlannedAttemptResultResponseCount.make(2),
    custody: { _tag: "Stopped" }
  })
  const records = [
    ...buildPrefix("Healthy"),
    record(
      25,
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      26,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
        report,
        version: workflowJournalEventVersion
      })
    )
  ]
  const direction = ResultRecoveryDirectedEvent.make({
    direction: "ContinueRetainedAttempt",
    requestId: ResultRecoveryRequestId.make({ nonce: "explicit-result-recovery", runId }),
    subject: ResultRecoverySubject.cases.RejectedResult.make({
      plannedAttempt,
      reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
    }),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    version: workflowJournalEventVersion
  })
  const directedHistory = [...records, record(27, direction)]
  expect(reduceWorkflowJournalHistory(runId, directedHistory)._tag).toBe("ValidWorkflowJournalHistory")
  const duplicateDirection = ResultRecoveryDirectedEvent.make({
    ...direction,
    requestId: ResultRecoveryRequestId.make({ nonce: "another-recovery", runId })
  })
  expect(reduceWorkflowJournalHistory(runId, [...directedHistory, record(28, duplicateDirection)])._tag).not.toBe(
    "ValidWorkflowJournalHistory"
  )
  const staleDirection = ResultRecoveryDirectedEvent.make({
    ...direction,
    subject: ResultRecoverySubject.cases.RejectedResult.make({
      plannedAttempt,
      reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1)
    })
  })
  expect(reduceWorkflowJournalHistory(runId, [...records, record(27, staleDirection)])._tag).not.toBe(
    "ValidWorkflowJournalHistory"
  )
  const foreignPlanDirection = ResultRecoveryDirectedEvent.make({
    ...direction,
    subject: ResultRecoverySubject.cases.RejectedResult.make({
      reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2),
      plannedAttempt: PlannedTaskAttempt.make({ ...plannedAttempt, baseSha: GitCommitSha.make("f".repeat(40)) })
    })
  })
  expect(reduceWorkflowJournalHistory(runId, [...records, record(27, foreignPlanDirection)])._tag).not.toBe(
    "ValidWorkflowJournalHistory"
  )
  const unresolvedReport = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
    ...report,
    custody: { _tag: "Unresolved" }
  })
  const unresolvedRecords = [
    ...buildPrefix("Healthy"),
    record(
      25,
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
          report: unresolvedReport
        }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      26,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
        report: unresolvedReport,
        version: workflowJournalEventVersion
      })
    ),
    record(27, direction)
  ]
  expect(reduceWorkflowJournalHistory(runId, unresolvedRecords.slice(0, -1))._tag).toBe("ValidWorkflowJournalHistory")
  expect(reduceWorkflowJournalHistory(runId, unresolvedRecords)._tag).not.toBe("ValidWorkflowJournalHistory")
  for (const unavailable of [false, true]) {
    const history = unavailable
      ? [
          ...records,
          record(
            27,
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(2),
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
        ]
      : records
    const reduction = reduceWorkflowJournalHistory(runId, history)
    if (reduction._tag !== "ValidWorkflowJournalHistory") return expect.fail("rejected-result history must reduce")
    const facts = deriveJournalResponsibilityFacts(reduction.runState)
    const exact = facts.find(
      (fact) =>
        fact._tag === "PlannedAttemptExecutorFreshFacts" &&
        fact.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId
    )
    expect(exact?.disposition).toMatchObject(
      unavailable
        ? { _tag: "PlannedAttemptExecutorProjectionWait" }
        : { _tag: "PlannedAttemptExecutorResultRejected", report }
    )
  }
})

it.effect("coalesces exact result recovery redelivery and refuses request identity reuse", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const report = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        reason: "ResultEnvelopeInvalid",
        recoveryCause: "Deadline",
        responseCount: PlannedAttemptResultResponseCount.make(2),
        custody: { _tag: "Stopped" }
      })
      const records = [
        ...buildPrefix("Healthy"),
        record(
          25,
          PlannedAttemptExecutorStateObservedEvent.make({
            observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
            occurrenceClassification: "NonActionOccurrence",
            ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          26,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report,
            version: workflowJournalEventVersion
          })
        )
      ]
      const context = yield* Layer.build(
        Layer.mergeAll(liveJournalTestLayer({ records, runId, target }), plannedAttemptProtocolControllerLayer)
      )
      const control = yield* makeResultRecoveryControl().pipe(Effect.provide(context))
      const request = {
        direction: "ContinueRetainedAttempt",
        requestId: ResultRecoveryRequestId.make({ nonce: "result-recovery-redelivery", runId }),
        subject: ResultRecoverySubject.cases.RejectedResult.make({
          plannedAttempt,
          reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
        })
      }
      const [first, duplicate] = yield* Effect.all([control.apply(request), control.apply(request)], {
        concurrency: "unbounded"
      })
      expect(duplicate.position).toBe(first.position)
      expect((yield* control.read(request.requestId)).position).toBe(first.position)
      const operations = healthyAuthorityOperations()
      const witness = {
        activeTaskContinuationRead: {
          graphObservationOperationId: operations.graph.operationId,
          taskClaimObservationOperationId: operations.claim.operationId,
          taskWorkSpecificationObservationOperationId: operations.workSpecification.operationId
        },
        targetLineageObservationOperationId: operations.lineage.operationId,
        worktreeObservationOperationId: operations.worktree.operationId
      }
      // Reads before the explicit direction cannot authorize a fresh correction cycle.
      expect(yield* control.inspectContinueFacts(request.requestId, witness)).toMatchObject({
        _tag: "Rejected",
        reason: "StaleWitness"
      })
      expect(
        yield* control.inspectContinueFacts({ ...request.requestId, nonce: "never-applied" }, witness)
      ).toMatchObject({ _tag: "DirectionRejected" })
      expect((yield* control.read(request.requestId)).position).toBe(first.position)
      const recovered = yield* makeResultRecoveryControl().pipe(Effect.provide(context))
      expect((yield* recovered.apply(request)).position).toBe(first.position)
      const reused = yield* recovered.apply({ ...request, direction: "RestartTaskImplementation" }).pipe(Effect.result)
      expect(reused).toMatchObject({ _tag: "Failure", failure: { _tag: "ResultRecoveryRequestIdentityContradiction" } })
    })
  )
)

it.effect("accepts only complete fresh Continue facts without appending execution authority", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const report = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        reason: "ResultEnvelopeInvalid",
        recoveryCause: "Deadline",
        responseCount: PlannedAttemptResultResponseCount.make(2),
        custody: { _tag: "Stopped" }
      })
      const records = [
        ...buildPrefix("Healthy").filter(({ position }) => position <= 14),
        record(
          15,
          PlannedAttemptExecutorStateObservedEvent.make({
            observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
            occurrenceClassification: "NonActionOccurrence",
            ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          16,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report,
            version: workflowJournalEventVersion
          })
        )
      ]
      const context = yield* Layer.build(
        Layer.mergeAll(liveJournalTestLayer({ records, runId, target }), plannedAttemptProtocolControllerLayer)
      )
      const control = yield* makeResultRecoveryControl().pipe(Effect.provide(context))
      const request = {
        direction: "ContinueRetainedAttempt",
        requestId: ResultRecoveryRequestId.make({ nonce: "result-recovery-redelivery", runId }),
        subject: ResultRecoverySubject.cases.RejectedResult.make({
          plannedAttempt,
          reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
        })
      }
      const first = yield* control.apply(request)
      const operations = healthyAuthorityOperations()
      const witness = {
        activeTaskContinuationRead: {
          graphObservationOperationId: operations.graph.operationId,
          taskClaimObservationOperationId: operations.claim.operationId,
          taskWorkSpecificationObservationOperationId: operations.workSpecification.operationId
        },
        targetLineageObservationOperationId: operations.lineage.operationId,
        worktreeObservationOperationId: operations.worktree.operationId
      }
      expect(yield* control.inspectContinueFacts(request.requestId, witness)).toMatchObject({
        _tag: "Rejected",
        reason: "MissingWitness"
      })
      const journal = Context.get(context, InRunJournal)
      for (const fresh of buildPrefix("Healthy").filter(({ position }) => position > 14)) {
        if (fresh.event._tag === "WorkflowRunBegan" || fresh.event._tag === "WorkflowRunTerminated")
          return yield* Effect.die("fresh recovery facts must be ordinary in-Run events")
        const event =
          fresh.event._tag === "TaskTrackerReadIntentRecorded" &&
          (fresh.event.operation._tag === "ReadTaskWorkSpecification" || fresh.event.operation._tag === "ReadTaskClaim")
            ? {
                ...fresh.event,
                operation: {
                  ...fresh.event.operation,
                  predecessorOperationIds: [
                    operations.plan.operationId,
                    ...fresh.event.operation.predecessorOperationIds
                  ].sort()
                }
              }
            : fresh.event
        const recoveryEvent =
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
            ? { ...event, operation: { ...event.operation, cause: { _tag: "AttemptContinuation" as const } } }
            : event
        yield* journal.append(runId, fresh.key, recoveryEvent)
        if (
          recoveryEvent._tag === "TaskTrackerReadIntentRecorded" &&
          recoveryEvent.operation._tag === "ReadTrackerGraph"
        ) {
          const pendingRecords = yield* Context.get(context, AcceptedJournalReader).readAccepted(runId)
          const pendingPlan = resultRecoveryContinueReadPlan(pendingRecords, request.requestId, integrationTarget)
          if (pendingPlan === undefined) return yield* Effect.die("pending graph intent lost its recovery plan")
          expect(nextResultRecoveryContinueRead(pendingRecords, pendingPlan)?.operationId).toBe(
            recoveryEvent.operation.operationId
          )
          const pendingHistory = reduceWorkflowJournalHistory(
            runId,
            Array.from(journalRecordsAfter(pendingRecords, null))
          )
          if (pendingHistory._tag !== "ValidWorkflowJournalHistory")
            return yield* Effect.die("pending recovery history must reduce")
          expect(
            deriveJournalResponsibilityFacts(
              pendingHistory.runState,
              Option.none(),
              Option.some(integrationTarget)
            ).find(
              (fact) =>
                fact._tag === "PlannedAttemptExecutorFreshFacts" &&
                fact.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId
            )?.disposition
          ).toMatchObject({
            _tag: "PlannedAttemptExecutorResultRejected",
            continueReadOperation: { operationId: recoveryEvent.operation.operationId }
          })
          const pendingFrontier = deriveRunnableFrontier({
            freshEligibleTasks: [],
            responsibility: pendingHistory.runState.responsibility,
            responsibilityFacts: deriveJournalResponsibilityFacts(
              pendingHistory.runState,
              Option.none(),
              Option.some(integrationTarget)
            )
          })
          expect(pendingFrontier.transitions).toContainEqual(
            RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
              plannedAttempt,
              operation: recoveryEvent.operation
            })
          )
          expect(pendingFrontier.transitions.some((transition) => transition._tag === "ContinueRejectedResult")).toBe(
            false
          )
        }
      }
      expect(yield* control.inspectContinueFacts(request.requestId, witness)).toEqual({ _tag: "Authorized" })
      expect(yield* control.inspectContinueFacts(request.requestId, witness)).toEqual({ _tag: "Authorized" })
      expect((yield* control.read(request.requestId)).position).toBe(first.position)
      const accepted = Context.get(context, AcceptedJournalReader)
      const finalRecords = yield* accepted.readAccepted(runId)
      const recoveredReadPlan = resultRecoveryContinueReadPlan(finalRecords, request.requestId, integrationTarget)
      expect(recoveredReadPlan?.witness).toEqual(witness)
      expect(recoveredReadPlan?.operations.map((operation) => operation.operationId)).toEqual([
        operations.graph.operationId,
        operations.workSpecification.operationId,
        operations.claim.operationId,
        operations.worktree.operationId,
        operations.lineage.operationId
      ])
      if (recoveredReadPlan === undefined) return yield* Effect.die("missing accepted recovery read plan")
      expect(nextResultRecoveryContinueRead(finalRecords, recoveredReadPlan)).toBeUndefined()
      const readyHistory = reduceWorkflowJournalHistory(runId, Array.from(journalRecordsAfter(finalRecords, null)))
      if (readyHistory._tag !== "ValidWorkflowJournalHistory")
        return yield* Effect.die("ready recovery history must reduce")
      const readyDisposition = deriveJournalResponsibilityFacts(
        readyHistory.runState,
        Option.none(),
        Option.some(integrationTarget)
      ).find(
        (fact) =>
          fact._tag === "PlannedAttemptExecutorFreshFacts" &&
          fact.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId
      )?.disposition
      expect(readyDisposition).toMatchObject({
        _tag: "PlannedAttemptExecutorResultRejected",
        continueReadPlan: { witness }
      })
      expect(readyDisposition).not.toHaveProperty("continueReadOperation")
      expect(readyDisposition).not.toHaveProperty("continueRequestId")
      const readyFrontier = deriveRunnableFrontier({
        freshEligibleTasks: [],
        responsibility: readyHistory.runState.responsibility,
        responsibilityFacts: deriveJournalResponsibilityFacts(
          readyHistory.runState,
          Option.none(),
          Option.some(integrationTarget)
        )
      })
      expect(readyFrontier.transitions).toContainEqual(
        RunnableFrontierTransition.AuthorizeResultRecoveryContinue({
          plannedAttempt,
          requestId: request.requestId,
          witness
        })
      )
      expect(readyFrontier.transitions.some((transition) => transition._tag === "ContinueRejectedResult")).toBe(false)
      expect(finalRecords.records).toHaveLength(27)
      expect(Array.from(journalRecordsOfKind(finalRecords, "PlannedAttemptContinuationAuthorized"))).toHaveLength(0)
      const prefix = Array.from(journalRecordsAfter(finalRecords, null))
      const permission = ResultRecoveryContinueAuthorizedEvent.make({
        requestId: request.requestId,
        plannedAttempt,
        witness,
        version: workflowJournalEventVersion
      })
      expect(reduceWorkflowJournalHistory(runId, [...prefix, record(28, permission)])._tag).toBe(
        "ValidWorkflowJournalHistory"
      )
      for (const invalid of [
        ResultRecoveryContinueAuthorizedEvent.make({
          ...permission,
          plannedAttempt: { ...plannedAttempt, baseSha: GitCommitSha.make("f".repeat(40)) }
        }),
        ResultRecoveryContinueAuthorizedEvent.make({
          ...permission,
          witness: { ...witness, worktreeObservationOperationId: OperationId.make("missing-recovery-read") }
        }),
        ResultRecoveryContinueAuthorizedEvent.make({
          ...permission,
          requestId: ResultRecoveryRequestId.make({ nonce: "unapplied-recovery", runId })
        })
      ]) {
        expect(reduceWorkflowJournalHistory(runId, [...prefix, record(28, invalid)])._tag).toBe(
          "InvalidWorkflowJournalHistory"
        )
      }
      const suppliedAuthorization = yield* Context.get(context, PlannedAttemptProtocolController).withPermit(
        plannedAttemptExecutorCorrelation(plannedAttempt),
        (permit) =>
          authorizeResultRecoveryContinueWithPermit(permit, request.requestId, witness).pipe(Effect.provide(context))
      )
      const [authorization, redelivery] = yield* Effect.all(
        [control.authorizeContinue(request.requestId, witness), control.authorizeContinue(request.requestId, witness)],
        { concurrency: "unbounded" }
      )
      expect(authorization.event._tag).toBe("ResultRecoveryContinueAuthorized")
      expect(authorization.position).toBe(suppliedAuthorization.position)
      expect(redelivery.position).toBe(authorization.position)
      const recovered = yield* makeResultRecoveryControl().pipe(Effect.provide(context))
      expect((yield* recovered.authorizeContinue(request.requestId, witness)).position).toBe(authorization.position)
      expect(
        yield* recovered
          .authorizeContinue(request.requestId, {
            ...witness,
            worktreeObservationOperationId: OperationId.make("changed-recovery-witness")
          })
          .pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "ResultRecoveryRequestIdentityContradiction" } })
      const authorizedHistory = yield* accepted.readAccepted(runId)
      const reducedPermission = reduceWorkflowJournalHistory(
        runId,
        Array.from(journalRecordsAfter(authorizedHistory, null))
      )
      if (reducedPermission._tag !== "ValidWorkflowJournalHistory")
        return yield* Effect.die("Continue permission prefix must reduce")
      const recoveryFacts = deriveJournalResponsibilityFacts(reducedPermission.runState)
      expect(
        recoveryFacts.find(
          (fact) =>
            fact._tag === "PlannedAttemptExecutorFreshFacts" &&
            fact.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId
        )?.disposition
      ).toMatchObject({ _tag: "PlannedAttemptExecutorResultRejected", continueRequestId: request.requestId })
      let providerCalls = 0
      let crashBeforePrivateIntent = true
      let positionBinds = 0
      const provider = PlannedAttemptExecutor.of({
        begin: () => Effect.die("recovery must not Begin"),
        resume: () => Effect.die("recovery must not Resume"),
        requestSuspension: () => Effect.die("recovery must not Suspend"),
        observe: () => Effect.die("settled recovery must not reconcile"),
        continueRejectedResult: (request, permission) =>
          Effect.gen(function* () {
            if (crashBeforePrivateIntent) {
              crashBeforePrivateIntent = false
              return yield* Effect.die("host lost after command intent before private successor intent")
            }
            providerCalls += 1
            expect(positionBinds).toBe(1)
            expect(request.plannedAttempt).toEqual(plannedAttempt)
            expect(permission.nonce).toBe(requestIdForProvider)
            const committed = yield* accepted.readAccepted(runId).pipe(Effect.orDie)
            expect(
              Array.from(journalRecordsOfKind(committed, "PlannedAttemptExecutorCommandIntended")).at(-1)?.event
            ).toMatchObject({ command: "ContinueRejectedResult", recoveryAuthorization: permission })
            return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: { runId, attemptId: plannedAttempt.attemptId }
            })
          })
      })
      const requestIdForProvider = request.requestId.nonce
      const dispatch = executeResultRecoveryContinue(request.requestId).pipe(
        Effect.provide(context),
        Effect.provideService(PlannedAttemptExecutor, provider)
      )
      const protocols = Context.get(context, PlannedAttemptProtocolController)
      const lease: Parameters<typeof deliverResultRecoveryContinue>[0] = {
        bindPlannedAttemptPosition: (attempt, _responsibility, receipt) =>
          Effect.sync(() => {
            expect(attempt).toEqual(plannedAttempt)
            positionBinds += 1
            expect(isAcceptedExecutorCommandDelivery(receipt)).toBe(true)
          }),
        withPlannedAttemptProtocol: protocols.withPermit
      }
      for (const foreignPlan of [
        { ...plannedAttempt, baseSha: GitCommitSha.make("f".repeat(40)) },
        { ...plannedAttempt, worktree: WorktreeLocator.make("/tmp/foreign-recovery-worktree") }
      ]) {
        expect(
          yield* deliverResultRecoveryContinue(lease, foreignPlan, request.requestId).pipe(
            Effect.provide(context),
            Effect.provideService(PlannedAttemptExecutor, provider),
            Effect.result
          )
        ).toMatchObject({ _tag: "Failure", failure: { _tag: "ResultRecoveryNotAvailable" } })
        expect(positionBinds).toBe(0)
        expect(providerCalls).toBe(0)
      }
      expect(
        yield* deliverResultRecoveryContinue(lease, plannedAttempt, request.requestId).pipe(
          Effect.provide(context),
          Effect.provideService(PlannedAttemptExecutor, provider),
          Effect.exit
        )
      ).toMatchObject({ _tag: "Failure" })
      expect(providerCalls).toBe(0)
      const pendingRecords = yield* accepted.readAccepted(runId)
      const pendingCommand = Array.from(
        journalRecordsOfKind(pendingRecords, "PlannedAttemptExecutorCommandIntended")
      ).at(-1)
      if (pendingCommand?.event._tag !== "PlannedAttemptExecutorCommandIntended")
        return yield* Effect.die("expected retained Continue command")
      const pendingIntent = pendingCommand.event
      const pendingHistory = reduceWorkflowJournalHistory(runId, Array.from(journalRecordsAfter(pendingRecords, null)))
      if (pendingHistory._tag !== "ValidWorkflowJournalHistory")
        return yield* Effect.die("pending recovery must reconstruct")
      expect(requiredPlannedAttemptPositionsOf(pendingHistory.runState)).toContainEqual({
        runId,
        attemptId: plannedAttempt.attemptId,
        taskId: plannedAttempt.taskId
      })
      const unavailableProvider = PlannedAttemptExecutor.of({
        begin: provider.begin,
        resume: provider.resume,
        requestSuspension: provider.requestSuspension,
        observe: provider.observe
      })
      expect(
        yield* protocols.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
          reconcileUnsettledPlannedAttemptExecutorCommand(permit, pendingRecords, plannedAttempt, pendingIntent).pipe(
            Effect.provide(context),
            Effect.provideService(PlannedAttemptExecutor, unavailableProvider),
            Effect.result
          )
        )
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "PlannedAttemptExecutorProjectionUnreadable" } })
      expect(providerCalls).toBe(0)
      expect(
        yield* protocols.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
          reconcileUnsettledPlannedAttemptExecutorCommand(permit, pendingRecords, plannedAttempt, pendingIntent).pipe(
            Effect.provide(context),
            Effect.provideService(PlannedAttemptExecutor, provider)
          )
        )
      ).toMatchObject({ _tag: "ExecutorWorkExecuting" })
      // The shared reconciliation path records the original ordinal's response;
      // repeating it returns that response without another private/provider call.
      const respondedRecords = yield* accepted.readAccepted(runId)
      expect(
        yield* protocols.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
          reconcileUnsettledPlannedAttemptExecutorCommand(permit, respondedRecords, plannedAttempt, pendingIntent).pipe(
            Effect.provide(context),
            Effect.provideService(PlannedAttemptExecutor, provider)
          )
        )
      ).toMatchObject({ _tag: "ExecutorWorkExecuting" })

      expect(yield* dispatch).toMatchObject({ _tag: "ExecutorWorkExecuting" })
      expect(providerCalls).toBe(1)
      const settled = yield* accepted.readAccepted(runId)
      const originalCommand = Array.from(journalRecordsOfKind(settled, "PlannedAttemptExecutorCommandIntended")).at(-1)
      if (originalCommand?.event._tag !== "PlannedAttemptExecutorCommandIntended")
        return yield* Effect.die("expected a committed result recovery command")
      const duplicateSemanticCommand = PlannedAttemptExecutorCommandIntendedEvent.make({
        ...originalCommand.event,
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(3)
      })
      expect(
        reduceWorkflowJournalHistory(runId, [
          ...Array.from(journalRecordsAfter(settled, null)),
          record(32, duplicateSemanticCommand)
        ])._tag
      ).toBe("InvalidWorkflowJournalHistory")

      const unavailable = record(
        29,
        PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(2),
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      if (unavailable.event._tag !== "PlannedAttemptExecutorStateObserved")
        return yield* Effect.die("recovery fixture requires an executor state observation")
      yield* journal.append(runId, unavailable.key, unavailable.event)
      expect(yield* control.inspectContinueFacts(request.requestId, witness)).toMatchObject({
        _tag: "DirectionRejected",
        detail: "the selected accepted report is no longer current"
      })
      expect((yield* control.apply(request)).position).toBe(first.position)
      expect((yield* recovered.authorizeContinue(request.requestId, witness)).position).toBe(authorization.position)
    })
  )
)

it.effect("rejects a pre-direction read whose outcome arrives after Continue", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const report = PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        reason: "ResultEnvelopeInvalid",
        recoveryCause: "Deadline",
        responseCount: PlannedAttemptResultResponseCount.make(2),
        custody: { _tag: "Stopped" }
      })
      const records = [
        ...buildPrefix("Healthy").filter(({ position }) => position <= 14),
        record(
          15,
          PlannedAttemptExecutorStateObservedEvent.make({
            observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
            occurrenceClassification: "NonActionOccurrence",
            ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(
          16,
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report,
            version: workflowJournalEventVersion
          })
        )
      ]
      const context = yield* Layer.build(
        Layer.mergeAll(liveJournalTestLayer({ records, runId, target }), plannedAttemptProtocolControllerLayer)
      )
      const control = yield* makeResultRecoveryControl().pipe(Effect.provide(context))
      const request = {
        direction: "ContinueRetainedAttempt",
        requestId: ResultRecoveryRequestId.make({ nonce: "result-recovery-redelivery", runId }),
        subject: ResultRecoverySubject.cases.RejectedResult.make({
          plannedAttempt,
          reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
        })
      }
      const operations = healthyAuthorityOperations()
      const journal = Context.get(context, InRunJournal)
      const earlyIntent = buildPrefix("Healthy").find(({ position }) => position === 15)
      if (earlyIntent?.event._tag !== "TaskTrackerReadIntentRecorded")
        return yield* Effect.die("recovery fixture requires a graph read intent")
      yield* journal.append(runId, earlyIntent.key, earlyIntent.event)
      const first = yield* control.apply(request)
      const witness = {
        activeTaskContinuationRead: {
          graphObservationOperationId: operations.graph.operationId,
          taskClaimObservationOperationId: operations.claim.operationId,
          taskWorkSpecificationObservationOperationId: operations.workSpecification.operationId
        },
        targetLineageObservationOperationId: operations.lineage.operationId,
        worktreeObservationOperationId: operations.worktree.operationId
      }
      for (const fresh of buildPrefix("Healthy").filter(({ position }) => position > 15)) {
        if (fresh.event._tag === "WorkflowRunBegan" || fresh.event._tag === "WorkflowRunTerminated")
          return yield* Effect.die("fresh recovery facts must be ordinary in-Run events")
        const event =
          fresh.event._tag === "TaskTrackerReadIntentRecorded" &&
          (fresh.event.operation._tag === "ReadTaskWorkSpecification" || fresh.event.operation._tag === "ReadTaskClaim")
            ? {
                ...fresh.event,
                operation: {
                  ...fresh.event.operation,
                  predecessorOperationIds: [
                    ...fresh.event.operation.predecessorOperationIds,
                    operations.plan.operationId
                  ]
                }
              }
            : fresh.event
        yield* journal.append(runId, fresh.key, event)
      }
      expect(yield* control.inspectContinueFacts(request.requestId, witness)).toMatchObject({
        _tag: "Rejected",
        reason: "StaleWitness",
        witness: "ActiveTaskContinuationGraph"
      })
      expect((yield* control.read(request.requestId)).position).toBe(first.position)
    })
  )
)

it.effect(
  "verifies Restart against fresh revision and target Base while preserving separate custody requirements",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const freshSpecification = makeTaskWorkSpecification({ taskId, body: "Fresh F2", title: "Fresh F2" })
        const operations = healthyAuthorityOperations()
        const witness = {
          activeTaskContinuationRead: {
            graphObservationOperationId: operations.graph.operationId,
            taskWorkSpecificationObservationOperationId: operations.workSpecification.operationId,
            taskClaimObservationOperationId: operations.claim.operationId
          },
          worktreeObservationOperationId: operations.worktree.operationId,
          targetLineageObservationOperationId: operations.lineage.operationId
        }
        for (const historical of [false, true]) {
          const report = historical
            ? PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                correlation: { attemptId: plannedAttempt.attemptId, runId },
                result: { _tag: "Failed" }
              })
            : PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
                correlation: { attemptId: plannedAttempt.attemptId, runId },
                reason: "ResultEnvelopeInvalid",
                recoveryCause: "Deadline",
                responseCount: PlannedAttemptResultResponseCount.make(2),
                custody: { _tag: "Stopped" }
              })
          const subject = historical
            ? ResultRecoverySubject.cases.HistoricalUnknownFailure.make({
                plannedAttempt,
                reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
              })
            : ResultRecoverySubject.cases.RejectedResult.make({
                plannedAttempt,
                reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2)
              })
          const requestId = ResultRecoveryRequestId.make({ nonce: `fresh-restart-${historical}`, runId })
          const direction = ResultRecoveryDirectedEvent.make({
            direction: "RestartTaskImplementation",
            requestId,
            subject,
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
          const start = [
            ...buildPrefix("Healthy").filter(({ position }) => position <= 14),
            record(
              15,
              PlannedAttemptExecutorStateObservedEvent.make({
                plannedAttempt,
                ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
                observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
                occurrenceClassification: "NonActionOccurrence",
                version: workflowJournalEventVersion
              })
            ),
            record(
              16,
              PlannedAttemptExecutorWorkReportedEvent.make({
                report,
                ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
                version: workflowJournalEventVersion
              })
            ),
            record(17, direction)
          ]
          expect(evaluateResultRecoveryRestartFacts(start, requestId, witness, integrationTarget)).toMatchObject({
            _tag: "Rejected",
            reason: "MissingWitness"
          })
          const fresh = buildPrefix("Healthy")
            .filter(({ position }) => position > 14)
            .map(({ event, position }) => {
              if (event._tag === "TaskTrackerReadIntentRecorded") {
                if (event.operation._tag === "ReadTrackerGraph")
                  return record(position + 3, {
                    ...event,
                    operation: { ...event.operation, cause: { _tag: "AttemptRestartAuthorityCheck" } }
                  })
                if (event.operation._tag === "ReadTaskWorkSpecification" || event.operation._tag === "ReadTaskClaim")
                  return record(position + 3, {
                    ...event,
                    operation: {
                      ...event.operation,
                      predecessorOperationIds: [
                        operations.plan.operationId,
                        ...event.operation.predecessorOperationIds
                      ].sort()
                    }
                  })
              }
              if (
                event._tag === "TaskTrackerFactsObserved" &&
                event.observation._tag === "FocusedTaskWorkSpecificationFacts"
              )
                return record(position + 3, {
                  ...event,
                  observation: makeFocusedTaskWorkSpecificationFactsObserved(
                    operations.workSpecification,
                    freshSpecification
                  )
                })
              if (event._tag === "TargetLineageObserved")
                return record(position + 3, {
                  ...event,
                  observation: {
                    ...event.observation,
                    targetHeadSha: GitCommitSha.make("b".repeat(40)),
                    plannedBaseIsAncestorOfTargetHead: false
                  }
                })
              return record(position + 3, event)
            })
          const complete = [...start, ...fresh]
          expect(reduceWorkflowJournalHistory(runId, complete)._tag).toBe("ValidWorkflowJournalHistory")
          expect(
            evaluatePlannedAttemptCurrentFactsAuthorization(
              complete,
              plannedAttempt,
              witness,
              JournalPosition.make(17),
              freshSpecification.fingerprint
            )
          ).toMatchObject({ _tag: "Rejected", reason: "WrongAttemptWitness", witness: "ActiveTaskContinuationGraph" })
          const verified = evaluateResultRecoveryRestartFacts(complete, requestId, witness, integrationTarget)
          expect(verified._tag, JSON.stringify(verified)).toBe("FreshRestartFactsVerified")
          expect(verified).toMatchObject({
            _tag: "FreshRestartFactsVerified",
            plannedAttempt,
            taskRevision: freshSpecification.fingerprint,
            baseSha: "b".repeat(40),
            custody: historical ? "RequiresExecutorReconciliation" : "AcceptedStoppedRejection"
          })
          expect(resultRecoveryRestartReadPlan(complete, requestId, integrationTarget)?.witness).toEqual(witness)
          const initialRestartReads = resultRecoveryRestartReadPlan(start, requestId, integrationTarget)
          expect(initialRestartReads).toBeDefined()
          if (initialRestartReads === undefined) return expect.fail("applied Restart must derive fresh reads")
          expect(nextResultRecoveryRestartRead(start, initialRestartReads, integrationTarget)?._tag).toBe(
            "ReadTrackerGraph"
          )
          const completedRestartReads = resultRecoveryRestartReadPlan(complete, requestId, integrationTarget)
          if (completedRestartReads === undefined)
            return expect.fail("fresh Restart reads must retain their actual identities")
          expect(nextResultRecoveryRestartRead(complete, completedRestartReads, integrationTarget)).toBeUndefined()
          for (const [completedBoundary, expectedNext] of [
            [operations.graph.operationId, "ReadTaskWorkSpecification"],
            [operations.workSpecification.operationId, "ReadTaskClaim"],
            [operations.claim.operationId, "ReadTaskWorktree"],
            [operations.worktree.operationId, "ReadTargetLineage"]
          ] as const) {
            const outcome = journalRecordByKey(complete, outcomeRecordKey(completedBoundary))
            if (outcome === undefined) return expect.fail("fresh boundary must have an outcome")
            const partial = complete.filter(({ position }) => position <= outcome.position)
            const partialPlan = resultRecoveryRestartReadPlan(partial, requestId, integrationTarget)
            if (partialPlan === undefined) return expect.fail("partial Restart must retain its read plan")
            expect(nextResultRecoveryRestartRead(partial, partialPlan, integrationTarget)?._tag).toBe(expectedNext)
          }

          const successor = PlannedTaskAttempt.make({
            ...plannedAttempt,
            attemptId: AttemptId.make("result-recovery-successor"),
            baseSha: GitCommitSha.make("b".repeat(40)),
            taskRevision: freshSpecification.fingerprint,
            branch: TaskBranchRef.make("refs/heads/dalph/result-recovery-successor"),
            worktree: WorktreeLocator.make("/worktrees/result-recovery-successor")
          })
          const successorPlan = makeTaskAttemptPlanOperation({
            operationId: OperationId.make("result-recovery-successor-plan"),
            plannedAttempt: successor,
            predecessorOperationIds: [
              operations.plan.operationId,
              exactAcquisition.operationId,
              operations.graph.operationId,
              operations.workSpecification.operationId,
              operations.claim.operationId,
              operations.worktree.operationId,
              operations.lineage.operationId
            ]
          })
          const replacement = ResultRecoveryAttemptReplacedEvent.make({
            requestId,
            subject,
            integrationTarget,
            witness,
            successorPlan,
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
          const replacementPosition = Math.max(...complete.map(({ position }) => position)) + 1
          const replaced = reduceWorkflowJournalHistory(runId, [...complete, record(replacementPosition, replacement)])
          if (historical) {
            const history = reduceWorkflowJournalHistory(runId, complete)
            if (history._tag !== "ValidWorkflowJournalHistory")
              return expect.fail("historical Restart must retain accepted history")
            const frontier = deriveRunnableFrontier({
              freshEligibleTasks: [],
              responsibility: history.runState.responsibility,
              responsibilityFacts: deriveJournalResponsibilityFacts(
                history.runState,
                Option.none(),
                Option.some(integrationTarget)
              )
            })
            expect(frontier.transitions).toContainEqual(
              RunnableFrontierTransition.ReplaceRejectedResult({
                plannedAttempt,
                requestId,
                witness,
                integrationTarget,
                specification: freshSpecification
              })
            )
            expect(
              frontier.transitions.some(
                ({ _tag }) => _tag === "ContinueRejectedResult" || _tag === "AuthorizeResultRecoveryContinue"
              )
            ).toBe(false)

            expect(resultRecoveryReplacementProblem(complete, replacement)).toContain("writer custody")
            expect(replaced._tag).toBe("InvalidWorkflowJournalHistory")
            for (const stopped of [false, true]) {
              const context = yield* Layer.build(
                Layer.mergeAll(
                  liveJournalTestLayer({ records: complete, runId, target }),
                  plannedAttemptProtocolControllerLayer
                )
              )
              const protocols = Context.get(context, PlannedAttemptProtocolController)
              let allocations = 0
              let observations = 0
              const outcome = yield* protocols.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
                allocateResultRecoveryReplacementWithPermit(
                  permit,
                  requestId,
                  witness,
                  integrationTarget,
                  freshSpecification,
                  plannedAttempt
                ).pipe(
                  Effect.provide(context),
                  Effect.provideService(PlannedAttemptExecutor, {
                    observe: () => Effect.die("custody must not rewrite or reobserve terminal reports"),
                    begin: () => Effect.die("custody must not begin work"),
                    resume: () => Effect.die("custody must not resume work"),
                    requestSuspension: () => Effect.die("custody must not send stop"),
                    observeWriterCustody: (attempt) =>
                      Effect.sync(() => {
                        observations += 1
                        expect(attempt).toEqual(plannedAttempt)
                        return stopped
                          ? { _tag: "Stopped" as const, plannedAttempt: attempt }
                          : {
                              _tag: "Unresolved" as const,
                              plannedAttempt: attempt,
                              detail: "retained writers remain unproved"
                            }
                      })
                  }),
                  Effect.provideService(PlannedTaskAttemptPlanner, {
                    plan: () =>
                      Effect.sync(() => {
                        allocations += 1
                        return successor
                      })
                  }),
                  Effect.provideService(OperationIdAllocator, {
                    allocate: () => Effect.succeed(successorPlan.operationId)
                  }),
                  Effect.result
                )
              )
              expect(observations).toBe(1)
              expect(allocations).toBe(stopped ? 1 : 0)
              if (!stopped)
                expect(outcome).toMatchObject({ _tag: "Failure", failure: { _tag: "ResultRecoveryNotAvailable" } })
              else {
                expect(outcome).toMatchObject({
                  _tag: "Success",
                  success: { event: { writerCustody: { _tag: "Stopped", plannedAttempt } } }
                })
                const accepted = yield* Context.get(context, AcceptedJournalReader).readAccepted(runId)
                expect(Array.from(journalRecordsOfKind(accepted, "ResultRecoveryAttemptReplaced"))).toHaveLength(1)
                expect(latestAcceptedPlannedAttemptExecutorEvidence(accepted, plannedAttempt)?.report).toEqual(report)
                expect(
                  replacementContinuationAuthorityFrom(accepted, runId, successor, successorPlan.operationId)
                ).toMatchObject({ plannedAttempt: successor, specification: freshSpecification })
                const projected = yield* projectWorkflowOccurrences(Array.from(journalRecordsAfter(accepted, null)))
                expect(
                  projected.occurrences.find(({ _tag }) => _tag === "ResultRecoveryAttemptReplaced")
                ).toMatchObject({ writerCustody: { _tag: "Stopped", plannedAttempt } })
              }
            }
          } else {
            expect(resultRecoveryReplacementProblem(complete, replacement)).toBeUndefined()
            const foreignRunId = RunId.make("foreign-result-recovery-run")
            const foreignReplacement = ResultRecoveryAttemptReplacedEvent.make({
              ...replacement,
              requestId: ResultRecoveryRequestId.make({ nonce: requestId.nonce, runId: foreignRunId }),
              subject: { ...subject, plannedAttempt: { ...plannedAttempt, runId: foreignRunId } },
              successorPlan: { ...successorPlan, plannedAttempt: { ...successor, runId: foreignRunId } }
            })
            expect(
              reduceWorkflowJournalHistory(runId, [...complete, record(replacementPosition, foreignReplacement)])._tag
            ).toBe("InvalidWorkflowJournalHistory")

            const readyState = reduceWorkflowJournalHistory(runId, complete)
            if (readyState._tag !== "ValidWorkflowJournalHistory")
              return expect.fail("ready Restart history must reduce")
            const readyFrontier = deriveRunnableFrontier({
              freshEligibleTasks: [],
              responsibility: readyState.runState.responsibility,
              responsibilityFacts: deriveJournalResponsibilityFacts(
                readyState.runState,
                Option.none(),
                Option.some(integrationTarget)
              )
            })
            expect(readyFrontier.transitions).toContainEqual(
              RunnableFrontierTransition.ReplaceRejectedResult({
                plannedAttempt,
                requestId,
                witness,
                integrationTarget,
                specification: freshSpecification
              })
            )
            expect(
              readyFrontier.transitions.some(
                ({ _tag }) => _tag === "ContinueRejectedResult" || _tag === "AuthorizeResultRecoveryContinue"
              )
            ).toBe(false)

            const replacementTransition = readyFrontier.transitions.find(
              (transition) => transition._tag === "ReplaceRejectedResult"
            )
            if (replacementTransition === undefined) return expect.fail("Restart must select replacement delivery")
            const proposal = deliveryProposalsOf({
              acceptedOperationIds: acceptedOperationIdsOf(complete),
              fresh: [],
              runId,
              transitions: [replacementTransition]
            }).ticketDelivery[0]
            if (proposal === undefined) return expect.fail("replacement must produce one delivery proposal")
            const action = yield* materializeDeliveryAction(proposal).pipe(
              Effect.provideService(OperationIdAllocator, {
                allocate: () => Effect.die("replacement routing must not allocate an operation")
              }),
              Effect.provideService(PlannedTaskAttemptPlanner, {
                plan: () => Effect.die("replacement routing must not allocate an attempt")
              })
            )
            expect(action._tag).toBe("IdentityFreeAction")
            expect(action.proposal.route).toMatchObject({
              _tag: "IdentityFreeWorkflowRoute",
              transition: replacementTransition
            })
            expect(replaced._tag).toBe("ValidWorkflowJournalHistory")
            if (replaced._tag !== "ValidWorkflowJournalHistory")
              return expect.fail("exact result replacement must reduce")
            expect(
              replaced.runState.responsibility.entries.some(
                (entry) =>
                  entry._tag === "PlannedAttemptExecutorWorkResponsibility" &&
                  entry.plannedAttempt.attemptId === plannedAttempt.attemptId
              )
            ).toBe(false)
            const replacedRecords = [...complete, record(replacementPosition, replacement)]
            const occurrences = yield* projectWorkflowOccurrences(replacedRecords)
            expect(
              occurrences.occurrences.find((occurrence) => occurrence._tag === "ResultRecoveryAttemptReplaced")
            ).toMatchObject({ requestId, subject, successorPlan, recordedAt: replacementPosition })
            expect(recordedTaskAttemptPlanFor(replacedRecords, plannedAttempt)).toEqual(operations.plan)
            expect(recordedTaskAttemptPlanFor(replacedRecords, successor)).toEqual(successorPlan)
            expect(
              replacementContinuationAuthorityFrom(replacedRecords, runId, successor, successorPlan.operationId)
            ).toMatchObject({
              claim: exactAcquisition,
              plannedAttempt: successor,
              specification: freshSpecification,
              successorPlanOperationId: successorPlan.operationId,
              specificationObservationOperationId: operations.workSpecification.operationId
            })
            const successorDecisions = deriveFreshWorkflowDecisions(
              {
                acceptedAt: Option.getOrThrow(Option.fromNullishOr(replaced.runState.appliedThrough)),
                currentGraph: Option.getOrThrow(reconstructedTaskGraphFor(replaced.runState.graphKnowledge, target)),
                currentGraphOperationId: operations.graph.operationId,
                pause: replaced.runState.pause,
                responsibility: replaced.runState.responsibility,
                runControlPolicy: Option.getOrThrow(replaced.runState.controlPolicy),
                runId,
                workflowHistory: replaced.runState.workflowHistory
              },
              new Set(),
              target
            )
            expect(successorDecisions).toContainEqual(
              expect.objectContaining({
                step: expect.objectContaining({
                  _tag: "ReconcileTaskWorktree",
                  plannedAttempt: successor,
                  predecessorOperationId: successorPlan.operationId
                })
              })
            )
            const successorWorktree = makeTaskWorktreeReconciliationOperation({
              operationId: OperationId.make("result-recovery-successor-worktree"),
              plannedAttempt: successor,
              predecessorOperationIds: [successorPlan.operationId]
            })
            const readySuccessorRecords = [
              ...replacedRecords,
              record(
                replacementPosition + 1,
                TaskWorktreeReconciliationIntendedEvent.make({
                  operation: successorWorktree,
                  version: workflowJournalEventVersion
                })
              ),
              record(
                replacementPosition + 2,
                TaskWorktreeReadyEvent.make({
                  operationId: successorWorktree.operationId,
                  proof: PlannedWorktreeReady.make({
                    baseSha: successor.baseSha,
                    headSha: successor.baseSha,
                    branch: successor.branch,
                    worktree: successor.worktree
                  }),
                  version: workflowJournalEventVersion
                })
              )
            ]
            const readySuccessor = reduceWorkflowJournalHistory(runId, readySuccessorRecords)
            expect(readySuccessor._tag).toBe("ValidWorkflowJournalHistory")
            if (readySuccessor._tag !== "ValidWorkflowJournalHistory")
              return expect.fail("exact successor worktree must reduce")
            const beginDecisions = deriveFreshWorkflowDecisions(
              {
                acceptedAt: JournalPosition.make(replacementPosition + 2),
                currentGraph: Option.getOrThrow(
                  reconstructedTaskGraphFor(readySuccessor.runState.graphKnowledge, target)
                ),
                currentGraphOperationId: operations.graph.operationId,
                pause: readySuccessor.runState.pause,
                responsibility: readySuccessor.runState.responsibility,
                runControlPolicy: Option.getOrThrow(readySuccessor.runState.controlPolicy),
                runId,
                workflowHistory: readySuccessor.runState.workflowHistory
              },
              new Set(),
              target
            )
            expect(beginDecisions).toContainEqual(
              expect.objectContaining({
                step: expect.objectContaining({
                  _tag: "BeginPlannedAttemptExecutorWork",
                  plannedAttempt: successor,
                  specification: freshSpecification
                })
              })
            )
            let successorBegins = 0
            const successorContext = yield* Layer.build(
              Layer.mergeAll(
                liveJournalTestLayer({ records: readySuccessorRecords, runId, target }),
                plannedAttemptProtocolControllerLayer,
                Layer.succeed(PlannedAttemptExecutor, {
                  observe: () => Effect.die("settled successor Begin must not reconcile"),
                  begin: (request) =>
                    Effect.sync(() => {
                      successorBegins += 1
                      expect(request.plannedAttempt).toEqual(successor)
                      expect(request.specification).toEqual(freshSpecification)
                      return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                        correlation: plannedAttemptExecutorCorrelation(successor)
                      })
                    }),
                  requestSuspension: () => Effect.die("Restart must not suspend the successor"),
                  resume: () => Effect.die("Restart must Begin the successor")
                })
              )
            )
            const started = yield* beginPlannedAttemptExecutorWork(successor, freshSpecification).pipe(
              Effect.provide(successorContext)
            )
            expect(started).toEqual(
              PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                correlation: plannedAttemptExecutorCorrelation(successor)
              })
            )
            expect(
              yield* beginPlannedAttemptExecutorWork(successor, freshSpecification).pipe(
                Effect.provide(successorContext),
                Effect.result
              )
            ).toMatchObject({ _tag: "Failure", failure: { _tag: "PlannedAttemptExecutorAlreadyBegan" } })
            expect(successorBegins).toBe(1)
            const afterBegin = yield* Context.get(successorContext, AcceptedJournalReader).readAccepted(runId)
            expect(reduceWorkflowJournalHistory(runId, materializeJournalRecords(afterBegin.records))._tag).toBe(
              "ValidWorkflowJournalHistory"
            )
            expect(latestAcceptedPlannedAttemptExecutorEvidence(afterBegin, plannedAttempt)).toEqual(
              latestAcceptedPlannedAttemptExecutorEvidence(readySuccessorRecords, plannedAttempt)
            )
            expect(
              replacementContinuationAuthorityFrom(complete, runId, successor, successorPlan.operationId)
            ).toBeUndefined()
            expect(
              replacementContinuationAuthorityFrom(replacedRecords, runId, plannedAttempt, successorPlan.operationId)
            ).toBeUndefined()

            const context = yield* Layer.build(
              Layer.mergeAll(
                liveJournalTestLayer({ records: complete, runId, target }),
                plannedAttemptProtocolControllerLayer
              )
            )
            const protocols = Context.get(context, PlannedAttemptProtocolController)
            for (const foreignPlan of [
              { ...plannedAttempt, baseSha: GitCommitSha.make("f".repeat(40)) },
              { ...plannedAttempt, worktree: WorktreeLocator.make("/worktrees/foreign-retained-plan") }
            ]) {
              const refused = yield* protocols.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
                allocateResultRecoveryReplacementWithPermit(
                  permit,
                  requestId,
                  witness,
                  integrationTarget,
                  freshSpecification,
                  foreignPlan
                ).pipe(
                  Effect.provide(context),
                  Effect.provideService(PlannedTaskAttemptPlanner, {
                    plan: () => Effect.die("foreign plan must not allocate")
                  }),
                  Effect.provideService(OperationIdAllocator, {
                    allocate: () => Effect.die("foreign plan must not allocate identities")
                  }),
                  Effect.result
                )
              )
              expect(refused).toMatchObject({ _tag: "Failure", failure: { _tag: "ResultRecoveryNotAvailable" } })
            }
            let allocationCount = 0
            let operationAllocationCount = 0
            const allocate = () =>
              deliverResultRecoveryRestart(
                { withPlannedAttemptProtocol: protocols.withPermit },
                replacementTransition
              ).pipe(
                Effect.provide(context),
                Effect.provideService(PlannedTaskAttemptPlanner, {
                  plan: (request) =>
                    Effect.sync(() => {
                      allocationCount += 1
                      expect(request).toMatchObject({
                        _tag: "ExactReplacement",
                        baseSha: successor.baseSha,
                        specification: freshSpecification,
                        ordinal: 1
                      })
                      return successor
                    })
                }),
                Effect.provideService(OperationIdAllocator, {
                  allocate: () =>
                    Effect.sync(() => {
                      operationAllocationCount += 1
                      return successorPlan.operationId
                    })
                })
              )

            const allocated = yield* allocate()
            expect(allocated.event.successorPlan).toEqual(successorPlan)
            expect((yield* allocate()).position).toBe(allocated.position)
            expect(allocationCount).toBe(1)
            expect(operationAllocationCount).toBe(1)

            const commit = (candidate: ResultRecoveryAttemptReplacedEvent) =>
              protocols.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
                recordResultRecoveryReplacementWithPermit(permit, candidate).pipe(Effect.provide(context))
              )
            const lostResponse = yield* commit(replacement).pipe(
              Effect.andThen(Effect.fail("ReplacementResponseLost")),
              Effect.result
            )
            expect(lostResponse).toMatchObject({ _tag: "Failure", failure: "ReplacementResponseLost" })
            const first = yield* commit(replacement)
            expect(first.event._tag).toBe("ResultRecoveryAttemptReplaced")
            expect((yield* commit(replacement)).position).toBe(first.position)
            const replayedAllocation = yield* protocols.withPermit(
              plannedAttemptExecutorCorrelation(plannedAttempt),
              (permit) =>
                allocateResultRecoveryReplacementWithPermit(
                  permit,
                  requestId,
                  witness,
                  integrationTarget,
                  specification
                ).pipe(
                  Effect.provide(context),
                  Effect.provideService(PlannedTaskAttemptPlanner, {
                    plan: () => Effect.die("replay must not allocate another attempt")
                  }),
                  Effect.provideService(OperationIdAllocator, {
                    allocate: () => Effect.die("replay must not allocate another operation")
                  })
                )
            )
            expect(replayedAllocation.position).toBe(first.position)
            const changed = ResultRecoveryAttemptReplacedEvent.make({
              ...replacement,
              successorPlan: {
                ...successorPlan,
                plannedAttempt: { ...successor, worktree: WorktreeLocator.make("/worktrees/another-successor") }
              }
            })
            expect(yield* commit(changed).pipe(Effect.result)).toMatchObject({
              _tag: "Failure",
              failure: { _tag: "ResultRecoveryRequestIdentityContradiction" }
            })
            const committed = yield* Context.get(context, AcceptedJournalReader).readAccepted(runId)
            expect(Array.from(journalRecordsOfKind(committed, "ResultRecoveryAttemptReplaced"))).toHaveLength(1)
            expect(resultRecoveryReplacementProblem(replacedRecords, replacement)).toContain("already replaced")
            for (const successorMismatch of [
              { ...successor, baseSha: plannedAttempt.baseSha },
              { ...successor, taskRevision: plannedAttempt.taskRevision }
            ])
              expect(
                reduceWorkflowJournalHistory(runId, [
                  ...complete,
                  record(
                    replacementPosition,
                    ResultRecoveryAttemptReplacedEvent.make({
                      ...replacement,
                      successorPlan: { ...successorPlan, plannedAttempt: successorMismatch }
                    })
                  )
                ])._tag
              ).toBe("InvalidWorkflowJournalHistory")
          }

          expect(
            evaluateResultRecoveryRestartFacts(
              complete,
              requestId,
              witness,
              IntegrationTarget.make({ ...integrationTarget, ref: IntegrationTargetRef.make("refs/heads/foreign") })
            )
          ).toMatchObject({ _tag: "Rejected", reason: "WrongAttemptWitness", witness: "PlannedAttemptTargetLineage" })
          expect(evaluateResultRecoveryContinueFacts(complete, requestId, witness)).toMatchObject({
            _tag: "DirectionRejected"
          })
          const early = fresh.map((entry) =>
            entry.event._tag === "TaskTrackerReadIntentRecorded" && entry.event.operation._tag === "ReadTrackerGraph"
              ? record(16, entry.event)
              : entry
          )
          expect(
            evaluateResultRecoveryRestartFacts([...start, ...early], requestId, witness, integrationTarget)
          ).toMatchObject({ _tag: "Rejected", reason: "StaleWitness" })
        }
      })
    )
)
