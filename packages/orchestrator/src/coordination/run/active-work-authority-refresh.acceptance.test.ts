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
import { Effect, Option } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { GitWorktreeReadFailure, UntrackedWorktreePath } from "../../authorities/git/worktree.js"
import { GitTargetLineageReadFailure, TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { deriveRunnableFrontier, RunnableFrontierTransition } from "../frontier/frontier.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"
import {
  continuationDecisionFor,
  deriveJournalResponsibilityFacts,
  makeRunRecoveryProjection
} from "./recovery-activation.js"
import { activeWorkAuthorityRefreshForOwner, RunActivationOpportunity } from "./run-activation-opportunity.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
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
  makeTrackerGraphObservationOperation,
  WorkflowOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsReadFailed,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshGitReadFailedEvent,
  ActiveWorkAuthorityRefreshGitReadPurpose,
  ActiveWorkAuthorityRefreshOrdinal,
  makeActiveWorkAuthorityRefreshGitReadOperation
} from "../../workflow/protocols/active-work-authority-refresh/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"

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
  const acquisition = makeTaskClaimAcquisitionOperation({ acquisition: exactAcquisition, predecessorOperationIds: [] })
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("active-work-refresh-plan-A"),
    plannedAttempt,
    predecessorOperationIds: [exactAcquisition.operationId]
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("active-work-refresh-graph"),
    target,
    [],
    [taskId, independentTaskId]
  )
  const graph = snapshotFor(`active-work-refresh-graph-${constraint}`)
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("active-work-refresh-specification"),
    target,
    taskId,
    [graphOperation.operationId]
  )
  const claimOperation = makeTaskClaimObservationOperation(
    OperationId.make("active-work-refresh-claim-observation"),
    target,
    taskId,
    [graphOperation.operationId, specificationOperation.operationId]
  )
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("active-work-refresh-worktree"),
    plannedAttempt,
    predecessorOperationIds: [claimOperation.operationId]
  })
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("active-work-refresh-lineage"),
    plannedAttempt,
    predecessorOperationIds: [worktreeOperation.operationId]
  })
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
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      7,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(8, taskTrackerReadIntent(graphOperation)),
    record(
      9,
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
    record(10, taskTrackerReadIntent(specificationOperation)),
    record(
      11,
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      )
    ),
    record(12, taskTrackerReadIntent(claimOperation)),
    record(
      13,
      taskTrackerFactsObservedEvent(
        claimOperation.operationId,
        makeFocusedTaskClaimFactsObserved(claimOperation, claimObservation)
      )
    ),
    record(
      14,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      15,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: worktreeObservation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    ),
    record(
      16,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      17,
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
    if (constraint === "UnreadableGraph") return candidate.position <= JournalPosition.make(9)
    if (constraint === "MissingClaim" || constraint === "ForeignClaim") {
      return candidate.position <= JournalPosition.make(13)
    }
    if (constraint === "LostWorktree") return candidate.position <= JournalPosition.make(15)
    return true
  })
}

const activeGitFailureRecords = (
  kind: "worktree" | "lineage",
  position = 18,
  ordinal = 1,
  priorRecords: ReadonlyArray<JournalRecord> = buildPrefix("Healthy"),
  source: "TrackerNotification" | "Timer" = "TrackerNotification"
): ReadonlyArray<JournalRecord> => {
  const rawOperation =
    kind === "worktree"
      ? makeTaskWorktreeObservationOperation({
          operationId: OperationId.make(`active-work-refresh-failed-${kind}-${ordinal}`),
          plannedAttempt,
          predecessorOperationIds: []
        })
      : makeTargetLineageObservationOperation({
          integrationTarget,
          operationId: OperationId.make(`active-work-refresh-failed-${kind}-${ordinal}`),
          plannedAttempt,
          predecessorOperationIds: []
        })
  const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: plannedAttempt.attemptId, runId, source })
  const ordinalValue = ActiveWorkAuthorityRefreshOrdinal.make(ordinal)
  const activePurpose = ActiveWorkAuthorityRefreshGitReadPurpose.make({ authority, ordinal: ordinalValue })
  const activeIntentOperation =
    rawOperation._tag === "ReadTaskWorktree"
      ? WorkflowOperation.cases.ReadTaskWorktree.make({ ...rawOperation, purpose: activePurpose })
      : WorkflowOperation.cases.ReadTargetLineage.make({ ...rawOperation, purpose: activePurpose })
  const operation = makeActiveWorkAuthorityRefreshGitReadOperation(rawOperation, authority, ordinalValue)
  const failure =
    kind === "worktree"
      ? new GitWorktreeReadFailure({
          detail: "controlled worktree read is unavailable",
          worktree: plannedAttempt.worktree
        })
      : new GitTargetLineageReadFailure({
          detail: "controlled target lineage read is unavailable",
          plannedBaseSha: plannedAttempt.baseSha,
          target: integrationTarget
        })
  return [
    ...priorRecords,
    record(
      position,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: activeIntentOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      position + 1,
      ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
        authority,
        failure,
        occurrenceClassification: "NonActionOccurrence",
        operation,
        ordinal: ordinalValue,
        version: workflowJournalEventVersion
      })
    )
  ]
}

const projectionFor = (
  records: ReadonlyArray<JournalRecord>,
  opportunity: Parameters<typeof continuationDecisionFor>[5]
) =>
  Effect.gen(function* () {
    // The first journal read is the activation boundary. The recovery pass
    // then sees the provider facts appended after that boundary, matching the
    // production journal-first sequence instead of treating the completed
    // fixture as its own baseline.
    const runningBoundary = records.findLast(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Running"
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
      undefined,
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
  ContinuePlannedAttemptExecutorWork: "executor",
  ContinuePlannedAttemptExecutorWorkAfterCurrentFacts: "executor",
  ObservePlannedAttemptContinuationClaim: "claim",
  ObservePlannedAttemptContinuationExecutor: "executor",
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

const expectUnreadableWaitAndIndependentProgress = (
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
    RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: independentTaskId,
      taskRevision: independentSpecification.fingerprint
    })
  ])
  expect(frontier.explanations).toContainEqual({
    _tag: "PlannedAttemptUnreadableFactWait",
    boundary: "Git",
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    taskId,
    wakeCondition: "BoundaryRereadSucceeded"
  })
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
        RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
          acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(1) },
          plannedAttempt
        })
      ])
      expect(counts).toEqual({ graph: 0, specification: 0, claim: 0, worktree: 0, lineage: 0, executor: 1 })
    })
)

it.effect("active refresh retains the exact Running responsibility when tracker or Git authority is unreadable", () =>
  Effect.gen(function* () {
    const records = buildPrefix("UnreadableGraph")
    const projection = yield* projectionFor(records, activeWorkAuthorityRefreshForOwner("TrackerNotification"))
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
        expect.objectContaining({ _tag: "ContinuePlannedAttemptExecutorWork" }),
        expect.objectContaining({ _tag: "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts" }),
        expect.objectContaining({ _tag: "SuspendPlannedAttemptExecutorWork" }),
        expect.objectContaining({ _tag: "ObservePlannedAttemptContinuationExecutor" })
      ])
    )
    expect(counts).toEqual({ graph: 1, specification: 0, claim: 0, worktree: 0, lineage: 0, executor: 0 })
  })
)

it.effect(
  "tracker notification refreshes a Running attempt and suspends it after an exact foreign claim while independent work continues",
  () =>
    Effect.gen(function* () {
      for (const constraint of ["MissingClaim", "ForeignClaim"] as const) {
        const records = buildPrefix(constraint)
        const projection = yield* projectionFor(records, activeWorkAuthorityRefreshForOwner("TrackerNotification"))
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
    const projection = yield* projectionFor(records, activeWorkAuthorityRefreshForOwner("Timer"))
    expect(projection.frontier.transitions).toEqual([
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    ])
    expectSuspendAndIndependentProgress(records, availableEvidenceFor(projection).facts)
  })
)

it.effect("recovers the exact active-work suspension after process loss without releasing its position early", () =>
  Effect.gen(function* () {
    const records = buildPrefix("ForeignClaim")
    const restart = yield* projectionFor(records, activeWorkAuthorityRefreshForOwner("TrackerNotification"))
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

it.effect(
  "post-Running active worktree and target-lineage Git failures wait without suspending while independent work remains runnable",
  () =>
    Effect.gen(function* () {
      for (const kind of ["worktree", "lineage"] as const) {
        const records = activeGitFailureRecords(kind)
        const projection = yield* projectionFor(records, activeWorkAuthorityRefreshForOwner("TrackerNotification"))
        const executorFacts = availableEvidenceFor(projection).facts.find(
          ({ _tag }) => _tag === "PlannedAttemptExecutorFreshFacts"
        )
        expect(executorFacts).toMatchObject({
          _tag: "PlannedAttemptExecutorFreshFacts",
          responsibility: { beganAt: JournalPosition.make(5), plannedAttempt },
          disposition: { _tag: "UnreadableFactWait", boundary: "Git" }
        })
        expect(projection.frontier.transitions).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ _tag: "ContinuePlannedAttemptExecutorWork" }),
            expect.objectContaining({ _tag: "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts" }),
            expect.objectContaining({ _tag: "SuspendPlannedAttemptExecutorWork" }),
            expect.objectContaining({ _tag: "ObservePlannedAttemptContinuationExecutor" })
          ])
        )
        expectUnreadableWaitAndIndependentProgress(records, availableEvidenceFor(projection).facts)
      }
    })
)

it("does not treat an active-refresh Git failure at or before Running as current unreadable authority", () => {
  const preRunningPrefix = buildPrefix("Healthy").filter(({ position }) => position <= JournalPosition.make(4))
  const staleRecords = [
    ...activeGitFailureRecords("worktree", 5, 1, preRunningPrefix),
    record(
      7,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
  ]
  const reduction = reduceWorkflowJournalHistory(runId, buildPrefix("Healthy"))
  if (reduction._tag !== "ValidWorkflowJournalHistory") return expect.fail("acceptance prefix must reduce")
  const facts = deriveJournalResponsibilityFacts({
    ...reduction.runState,
    appliedThrough: staleRecords.at(-1)?.position ?? null,
    responsibility: reduction.runState.responsibility,
    workflowHistory: { records: staleRecords }
  })
  const executorFacts = facts.find(({ _tag }) => _tag === "PlannedAttemptExecutorFreshFacts")
  expect(executorFacts).toMatchObject({ disposition: { _tag: "Ready" } })
})

it.effect(
  "a later tracker or timer refresh uses a fresh Git operation and ordinal after the prior unreadable wait",
  () =>
    Effect.gen(function* () {
      const first = activeGitFailureRecords("worktree", 18, 1)
      const second = activeGitFailureRecords("worktree", 20, 2, first, "Timer")
      const activeFailures = second.flatMap(({ event }) =>
        event._tag === "ActiveWorkAuthorityRefreshGitReadFailed" ? [event] : []
      )
      expect(activeFailures.map(({ ordinal }) => ordinal)).toEqual([
        ActiveWorkAuthorityRefreshOrdinal.make(1),
        ActiveWorkAuthorityRefreshOrdinal.make(2)
      ])
      expect(activeFailures.map(({ operation }) => operation.operationId)).toEqual([
        OperationId.make("active-work-refresh-failed-worktree-1"),
        OperationId.make("active-work-refresh-failed-worktree-2")
      ])
      expect(activeFailures.map(({ authority }) => authority.source)).toEqual(["TrackerNotification", "Timer"])

      const projection = yield* projectionFor(second, activeWorkAuthorityRefreshForOwner("Timer"))
      expect(projection.frontier.transitions).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _tag: "ContinuePlannedAttemptExecutorWork" }),
          expect.objectContaining({ _tag: "SuspendPlannedAttemptExecutorWork" })
        ])
      )
      expectUnreadableWaitAndIndependentProgress(second, availableEvidenceFor(projection).facts)
    })
)
