import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref, Stream } from "effect"
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
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
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
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("active-work-refresh-plan-A"),
    plannedAttempt,
    predecessorOperationIds: [exactAcquisition.operationId]
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
  return { acquisition, claim, graph, lineage, plan, workSpecification, worktree } as const
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
    graph: graphOperation,
    lineage: lineageOperation,
    plan,
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
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    ),
    record(2, TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })),
    record(
      3,
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...exactAcquisition },
        version: workflowJournalEventVersion
      })
    ),
    record(4, TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })),
    record(
      5,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    ),
    record(
      6,
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
      7,
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
      8,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(9, taskTrackerReadIntent(graphOperation)),
    record(
      10,
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
    record(11, taskTrackerReadIntent(specificationOperation)),
    record(
      12,
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      )
    ),
    record(13, taskTrackerReadIntent(claimOperation)),
    record(
      14,
      taskTrackerFactsObservedEvent(
        claimOperation.operationId,
        makeFocusedTaskClaimFactsObserved(claimOperation, claimObservation)
      )
    ),
    record(
      15,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      16,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: worktreeObservation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    ),
    record(
      17,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      18,
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
    if (constraint === "UnreadableGraph") return candidate.position <= JournalPosition.make(10)
    if (constraint === "MissingClaim" || constraint === "ForeignClaim") {
      return candidate.position <= JournalPosition.make(14)
    }
    if (constraint === "LostWorktree") return candidate.position <= JournalPosition.make(16)
    return true
  })
}

/** Adds a second exact Running responsibility without adding a post-baseline graph. */
const buildTwoRunningPrefix = (): ReadonlyArray<JournalRecord> => {
  const records = buildPrefix("Healthy")
  const acquisition = makeTaskClaimAcquisitionOperation({
    acquisition: secondExactAcquisition,
    predecessorOperationIds: []
  })
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("active-work-refresh-specification-B"),
    target,
    independentTaskId,
    []
  )
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("active-work-refresh-plan-B"),
    plannedAttempt: secondPlannedAttempt,
    predecessorOperationIds: [secondExactAcquisition.operationId, specificationOperation.operationId]
  })
  return [
    ...records,
    record(
      19,
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })
    ),
    record(
      20,
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...secondExactAcquisition },
        version: workflowJournalEventVersion
      })
    ),
    record(21, taskTrackerReadIntent(specificationOperation)),
    record(
      22,
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, independentSpecification)
      )
    ),
    record(23, TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })),
    record(
      24,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: secondPlannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      25,
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
      26,
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
      27,
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
    let readCount = 0
    const journal = InRunJournal.of({
      append: () => Effect.die("acceptance projection must not append during restart"),
      read: () => {
        readCount += 1
        return Effect.succeed(readCount === 1 ? initialRecords : records)
      }
    })
    const recovery = yield* makeRunRecoveryProjection(
      runId,
      configuredIntegrationTarget,
      undefined,
      undefined,
      false,
      false,
      opportunity
    ).pipe(Effect.provideService(InRunJournal, journal))
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
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
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
    const acceptedPrefix = buildPrefix("Healthy").filter(({ position }) => position <= JournalPosition.make(8))
    const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const cases = [
      {
        expectedG1: false,
        name: "command response awaiting lifecycle acceptance",
        records: acceptedPrefix.filter(({ position }) => position <= JournalPosition.make(7))
      },
      { expectedG1: true, name: "accepted Executing lifecycle report", records: acceptedPrefix },
      {
        expectedG1: false,
        name: "distinct exact state projection awaiting lifecycle acceptance",
        records: [
          ...acceptedPrefix,
          record(
            9,
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
            9,
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
      { kind: "graph", operationId: operations.graph.operationId, prefixPosition: 8 },
      { kind: "specification", operationId: operations.workSpecification.operationId, prefixPosition: 10 },
      { kind: "claim", operationId: operations.claim.operationId, prefixPosition: 12 },
      { kind: "worktree", operationId: operations.worktree.operationId, prefixPosition: 14 },
      { kind: "lineage", operationId: operations.lineage.operationId, prefixPosition: 16 }
    ] as const
    const crashCuts = ["intent-before-call", "response-before-observation"] as const

    for (const ordinaryRead of ordinaryReads) {
      for (const crashCut of crashCuts) {
        const retainedRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(
          buildPrefix("Healthy").filter(({ position }) => position <= JournalPosition.make(ordinaryRead.prefixPosition))
        )
        const providerOperationIds = yield* Ref.make<ReadonlyArray<OperationId>>([])
        const failNextOutcome = yield* Ref.make(crashCut === "response-before-observation")
        const journal = InRunJournal.of({
          append: (appendedRunId, key, event) =>
            Effect.gen(function* () {
              const existing = (yield* Ref.get(retainedRecords)).find((candidate) => candidate.key === key)
              if (existing !== undefined) return existing
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
              return yield* Ref.modify(retainedRecords, (current) => {
                const appended: JournalRecord = {
                  event,
                  key,
                  position: JournalPosition.make(Number(current.at(-1)?.position ?? 0) + 1),
                  runId: appendedRunId
                }
                return [appended, [...current, appended]] as const
              })
            }),
          read: () => Ref.get(retainedRecords)
        })
        const counted = <A>(operationId: OperationId, value: A) =>
          Ref.update(providerOperationIds, (current) => [...current, operationId]).pipe(Effect.as(value))
        const unused = () => Effect.die("ordinary read recovery used an unrelated interpreter method")
        const provider = WorkflowInterpreter.of({
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
                Layer.provide(Layer.succeed(InRunJournal, journal))
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
        const targetRecords = (yield* Ref.get(retainedRecords)).filter(
          ({ event }) => eventOperationId(event) === ordinaryRead.operationId
        )
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
        expect(
          (yield* Ref.get(retainedRecords)).map(({ event }) => event._tag).filter((tag) => tag.includes("ActiveWork"))
        ).toEqual([])
      }
    }
  })
)

it.effect("production delivery composition settles the exact pending specification and claim identities", () =>
  Effect.gen(function* () {
    const ordinaryReads = [
      { kind: "specification", prefixPosition: 10 },
      { kind: "claim", prefixPosition: 10 }
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
      const retainedRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(initialRecords)
      const beforeCrash = yield* projectionFor(yield* Ref.get(retainedRecords), opportunity)
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
      const journal = InRunJournal.of({
        append: (appendedRunId, key, event) =>
          Ref.modify(retainedRecords, (current) => {
            const existing = current.find((candidate) => candidate.key === key)
            if (existing !== undefined) return [existing, current] as const
            const appended: JournalRecord = {
              event,
              key,
              position: JournalPosition.make(Number(current.at(-1)?.position ?? 0) + 1),
              runId: appendedRunId
            }
            return [appended, [...current, appended]] as const
          }),
        read: () => Ref.get(retainedRecords)
      })
      const unused = () => Effect.die("focused read recovery used an unrelated interpreter method")
      const provider = WorkflowInterpreter.of({
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
      ).pipe(Layer.provide(Layer.succeed(InRunJournal, journal)))
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

      const recordsAfterCrash = yield* Ref.get(retainedRecords)
      const projection = yield* projectionFor(recordsAfterCrash, opportunity)
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
        acceptedOperationIds: acceptedOperationIdsOf(recordsAfterCrash),
        fresh: [],
        pendingReadOperationIds: pendingReadOperationIdsOf(recordsAfterCrash),
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
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("ordinary read recovery must not plan a claim") })
        )
      )

      const targetRecords = (yield* Ref.get(retainedRecords)).filter(
        ({ event }) => eventOperationId(event) === operation.operationId
      )
      expect(targetRecords.map(({ event }) => event._tag)).toEqual([
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      expect(targetRecords.every(({ event }) => eventOperationId(event) === operation.operationId)).toBe(true)
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
      [...records, record(28, taskTrackerReadIntent(graphRead.operation)), record(29, graphObservation)],
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
    const graphOperation = makeTrackerGraphObservationOperation(
      { _tag: "ExecutingWorkAuthorityCheck" },
      OperationId.make("active-work-refresh-graph"),
      target,
      [],
      [taskId, independentTaskId]
    )
    const pendingG2Operation = makeTrackerGraphObservationOperation(
      { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: graphOperation.operationId },
      OperationId.make("opaque-g2-after-active-graph"),
      target,
      [graphOperation.operationId]
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
    const baseline = JournalPosition.make(27)
    const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const recordsBeforeReconciliation = [
      ...buildTwoRunningPrefix(),
      record(
        28,
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
        29,
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
          30,
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
          31,
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
                ? JournalPosition.make(5)
                : JournalPosition.make(24)
          },
          disposition: { _tag: "PlannedAttemptExecutorSuspensionRequested" }
        })
        expect(healthyFacts).toMatchObject({
          responsibility: {
            beganAt:
              healthyAttempt.attemptId === plannedAttempt.attemptId ? JournalPosition.make(5) : JournalPosition.make(24)
          },
          disposition: { _tag: "Ready" }
        })

        const freshFocusedFacts = records.flatMap(({ event, position }) => {
          if (position <= JournalPosition.make(27) || event._tag !== "TaskTrackerFactsObserved") return []
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
          position > JournalPosition.make(27) && event._tag === "GitReadIntentRecorded" ? [event] : []
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
              position > JournalPosition.make(27) &&
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
      responsibility: { beganAt: JournalPosition.make(5), plannedAttempt },
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
    const facts = deriveJournalResponsibilityFacts(reduction.runState, Option.some(JournalPosition.make(17)))
    expectSuspendAndIndependentProgress(records, facts)
    expect(reduction.runState.responsibility.entries).toContainEqual(
      expect.objectContaining({ plannedAttempt, _tag: "PlannedAttemptExecutorWorkResponsibility" })
    )

    const suspend = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    expect(
      continuationDecisionFor(suspend, records, undefined, Option.some(JournalPosition.make(17)), Option.none())
    ).toEqual({ transition: suspend })
  })
)
