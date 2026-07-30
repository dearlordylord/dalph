import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../test/controlled-planned-attempt-executor.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ControlCommand, ControlCommandRecordedEvent } from "../../control/command.js"
import { AuthenticatedOperatorIdentity, ControlCommandId } from "../../control/identity.js"
import { UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeRunRecoveryActivation } from "./recovery-activation.js"
import { makeOwnedTransitionExecutionFixture } from "../activation/coordinator.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  controlCommandRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation
} from "../../workflow/registry/operation.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { deterministicTaskClaimAcquisitionPlannerLayer } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { deriveRunnableFrontier, ResponsibilityDisposition } from "../frontier/frontier.js"
import { AttemptWorktreeLost } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"

const unused = () => Effect.die("frontier derivation must not invoke the interpreter")

it("keeps A's worktree responsibility constrained while independent C remains selectable", () => {
  const taskId = TaskId.make("claim-constrained-A")
  const independentTaskId = TaskId.make("independent-C")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("claim-constrained-attempt"),
    baseSha: GitCommitSha.make("6".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/claim-constrained-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: RunId.make("claim-constrained-run"),
    taskId,
    taskRevision: TaskRevision.make("claim-constrained-revision"),
    worktree: WorktreeLocator.make("/worktrees/claim-constrained-attempt")
  })
  const operation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("claim-constrained-worktree"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const responsibility = {
    _tag: "TaskWorktreeResponsibility" as const,
    beganAt: JournalPosition.make(1),
    operation,
    taskId
  }
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [{ taskId: independentTaskId, taskRevision: TaskRevision.make("independent-revision") }],
    responsibility: { entries: [responsibility] },
    responsibilityFacts: [
      {
        _tag: "WorkflowOperationFreshFacts",
        disposition: ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState: "Foreign" }),
        responsibility
      }
    ]
  })

  expect(frontier.transitions).toEqual([
    {
      _tag: "CommitFreshTaskClaimIntent",
      taskId: independentTaskId,
      taskRevision: TaskRevision.make("independent-revision")
    }
  ])
  expect(frontier.explanations).toContainEqual({
    _tag: "WorkflowOperationTaskClaimConstraint",
    claimState: "Foreign",
    operationId: operation.operationId,
    taskId,
    wakeCondition: "ExplicitTaskClaimReacquisitionRequested"
  })
})

it("keeps A's lost worktree responsibility constrained while independent C remains selectable", () => {
  const taskId = TaskId.make("git-constrained-A")
  const independentTaskId = TaskId.make("git-independent-C")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("git-constrained-attempt"),
    baseSha: GitCommitSha.make("5".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/git-constrained-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: RunId.make("git-constrained-run"),
    taskId,
    taskRevision: TaskRevision.make("git-constrained-revision"),
    worktree: WorktreeLocator.make("/worktrees/git-constrained-attempt")
  })
  const operation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("git-constrained-worktree"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const responsibility = {
    _tag: "TaskWorktreeResponsibility" as const,
    beganAt: JournalPosition.make(1),
    operation,
    taskId
  }
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [{ taskId: independentTaskId, taskRevision: TaskRevision.make("independent-revision") }],
    responsibility: { entries: [responsibility] },
    responsibilityFacts: [
      {
        _tag: "WorkflowOperationFreshFacts",
        disposition: ResponsibilityDisposition.WorkflowOperationGitConstraint({ gitState: "WorktreeLost" }),
        responsibility
      }
    ]
  })

  expect(frontier.transitions).toEqual([
    {
      _tag: "CommitFreshTaskClaimIntent",
      taskId: independentTaskId,
      taskRevision: TaskRevision.make("independent-revision")
    }
  ])
  expect(frontier.explanations).toContainEqual({
    _tag: "WorkflowOperationGitConstraint",
    gitState: "WorktreeLost",
    operationId: operation.operationId,
    taskId,
    wakeCondition: "GitFactsObserved"
  })
})

it.effect("records the exact planned worktree as lost and preserves its responsibilities", () =>
  Effect.gen(function* () {
    const runId = RunId.make("lost-worktree-recovery-run")
    const taskId = TaskId.make("lost-worktree-task-A")
    const target = FixtureTarget.make("lost-worktree-target")
    const specification = makeTaskWorkSpecification({ body: "Body", taskId, title: "Title" })
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("lost-worktree-attempt"),
      baseSha: GitCommitSha.make("8".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/lost-worktree-attempt"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: specification.fingerprint,
      worktree: WorktreeLocator.make("/worktrees/lost-worktree-attempt")
    })
    const acquisition = {
      operationId: OperationId.make("lost-worktree-acquisition"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("lost-worktree-token")
    }
    const acquire = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("lost-worktree-plan"),
      plannedAttempt,
      predecessorOperationIds: [acquisition.operationId]
    })
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* journal.append(
      runId,
      intentRecordKey(acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquire, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(acquisition.operationId),
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...acquisition },
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    const runningOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, runningOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: runningOrdinal,
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    const graphRead = (yield* recovery.readFrontier).transitions[0]
    if (graphRead?._tag !== "ObservePlannedAttemptContinuationGraph") {
      return yield* Effect.die("expected current graph read")
    }
    const graph = projectTrackerSnapshot({
      revision: "lost-worktree-current-graph",
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (graph._tag !== "Valid") return yield* Effect.die("expected valid graph")
    yield* journal.append(
      runId,
      intentRecordKey(graphRead.operation.operationId),
      taskTrackerReadIntent(graphRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        graphRead.operation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead.operation, graph.snapshot)
      )
    )

    const specificationRead = (yield* recovery.readFrontier).transitions[0]
    if (specificationRead?._tag !== "ObservePlannedAttemptContinuationSpecification") {
      return yield* Effect.die("expected current specification read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(specificationRead.operation.operationId),
      taskTrackerReadIntent(specificationRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(specificationRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        specificationRead.operation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationRead.operation, specification)
      )
    )

    const claimRead = (yield* recovery.readFrontier).transitions[0]
    if (claimRead?._tag !== "ObservePlannedAttemptContinuationClaim") {
      return yield* Effect.die("expected current claim read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(claimRead.operation.operationId),
      taskTrackerReadIntent(claimRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(claimRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        claimRead.operation.operationId,
        makeFocusedTaskClaimFactsObserved(claimRead.operation, { _tag: "ActiveTaskClaim", ...acquisition })
      )
    )

    const worktreeRead = (yield* recovery.readFrontier).transitions[0]
    if (worktreeRead?._tag !== "ObservePlannedAttemptContinuationWorktree") {
      return yield* Effect.die("expected current worktree read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(worktreeRead.operation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeRead.operation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(worktreeRead.operation.operationId),
      PlannedAttemptWorktreeObservedEvent.make({
        observation: AttemptWorktreeLost.make({ plannedAttempt }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeRead.operation.operationId,
        version: workflowJournalEventVersion
      })
    )

    expect((yield* recovery.readFrontier).transitions).toEqual([
      { _tag: "SuspendPlannedAttemptExecutorWork", plannedAttempt }
    ])
    const suspendedOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, suspendedOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: suspendedOrdinal,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        { _tag: "Settlement", operationId: acquisition.operationId, outcome: "ResponsibilityCompleted", taskId },
        {
          _tag: "PlannedAttemptGitConstraint",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          gitState: "WorktreeLost",
          taskId,
          wakeCondition: "GitFactsObserved"
        }
      ],
      transitions: []
    })
    const secondRestart = yield* makeRunRecoveryActivation(runId)
    expect((yield* secondRestart.readFrontier).explanations).toContainEqual({
      _tag: "PlannedAttemptGitConstraint",
      correlation: { attemptId: plannedAttempt.attemptId, runId },
      gitState: "WorktreeLost",
      taskId,
      wakeCondition: "GitFactsObserved"
    })
    const events = (yield* journal.read(runId)).map(({ event }) => event)
    expect(events).toContainEqual(
      expect.objectContaining({
        _tag: "PlannedAttemptWorktreeObserved",
        observation: AttemptWorktreeLost.make({ plannedAttempt })
      })
    )
    expect(events).toContainEqual(expect.objectContaining({ _tag: "TaskClaimAcquired" }))
    expect(events).toContainEqual(expect.objectContaining({ _tag: "TaskAttemptPlanned" }))
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: unused,
        readTaskWorktree: unused,
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("reads current claim facts, safely suspends A, and then exposes its missing-claim constraint", () =>
  Effect.gen(function* () {
    const runId = RunId.make("missing-claim-reconciliation-run")
    const taskId = TaskId.make("missing-claim-task-A")
    const target = FixtureTarget.make("missing-claim-target")
    const specification = makeTaskWorkSpecification({ body: "Body", taskId, title: "Title" })
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("missing-claim-attempt"),
      baseSha: GitCommitSha.make("7".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/missing-claim-attempt"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: specification.fingerprint,
      worktree: WorktreeLocator.make("/worktrees/missing-claim-attempt")
    })
    const acquisition = {
      operationId: OperationId.make("missing-claim-acquisition"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("missing-claim-token")
    }
    const acquire = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("missing-claim-plan"),
      plannedAttempt,
      predecessorOperationIds: [acquisition.operationId]
    })
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* journal.append(
      runId,
      intentRecordKey(acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquire, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(acquisition.operationId),
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...acquisition },
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    const runningOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, runningOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: runningOrdinal,
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    const graphTransition = (yield* recovery.readFrontier).transitions[0]
    if (graphTransition?._tag !== "ObservePlannedAttemptContinuationGraph") {
      return yield* Effect.die("expected current graph read")
    }
    const graph = projectTrackerSnapshot({
      revision: "missing-claim-graph",
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (graph._tag !== "Valid") return yield* Effect.die("expected valid graph")
    yield* journal.append(
      runId,
      intentRecordKey(graphTransition.operation.operationId),
      taskTrackerReadIntent(graphTransition.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(graphTransition.operation.operationId),
      taskTrackerFactsObservedEvent(
        graphTransition.operation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphTransition.operation, graph.snapshot)
      )
    )

    const specificationTransition = (yield* recovery.readFrontier).transitions[0]
    if (specificationTransition?._tag !== "ObservePlannedAttemptContinuationSpecification") {
      return yield* Effect.die("expected current specification read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(specificationTransition.operation.operationId),
      taskTrackerReadIntent(specificationTransition.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(specificationTransition.operation.operationId),
      taskTrackerFactsObservedEvent(
        specificationTransition.operation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationTransition.operation, specification)
      )
    )

    const claimTransition = (yield* recovery.readFrontier).transitions[0]
    if (claimTransition?._tag !== "ObservePlannedAttemptContinuationClaim") {
      return yield* Effect.die("expected current claim read")
    }
    yield* journal.append(
      runId,
      intentRecordKey(claimTransition.operation.operationId),
      taskTrackerReadIntent(claimTransition.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(claimTransition.operation.operationId),
      taskTrackerFactsObservedEvent(
        claimTransition.operation.operationId,
        makeFocusedTaskClaimFactsObserved(claimTransition.operation, UnclaimedTask.make({ taskId }))
      )
    )
    expect((yield* recovery.readFrontier).transitions).toEqual([
      { _tag: "SuspendPlannedAttemptExecutorWork", plannedAttempt }
    ])

    const suspendedOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, suspendedOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: suspendedOrdinal,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        { _tag: "Settlement", operationId: acquisition.operationId, outcome: "ResponsibilityCompleted", taskId },
        {
          _tag: "PlannedAttemptTaskClaimConstraint",
          claimState: "Missing",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          taskId,
          wakeCondition: "ExplicitTaskClaimReacquisitionRequested"
        }
      ],
      transitions: []
    })

    const command = ControlCommand.cases.RequestTaskClaimReacquisition.make({
      commandId: ControlCommandId.make("missing-claim-reacquire"),
      operatorId: AuthenticatedOperatorIdentity.make("authenticated-operator"),
      runId,
      taskId
    })
    yield* journal.append(
      runId,
      controlCommandRecordKey(command.commandId),
      ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
    )
    const reacquisitionTransition = (yield* recovery.readFrontier).transitions[0]
    expect(reacquisitionTransition).toEqual({
      _tag: "CommitTaskClaimReacquisitionIntent",
      commandId: command.commandId,
      taskId
    })
    if (reacquisitionTransition?._tag !== "CommitTaskClaimReacquisitionIntent") {
      return yield* Effect.die("expected explicit claim reacquisition")
    }
    const unavailablePlanner = yield* recovery
      .runTransition(
        reacquisitionTransition,
        makeOwnedTransitionExecutionFixture({
          bindPlannedAttemptExecutorPosition: () => Effect.void,
          recordIntent: () => Effect.die("an unavailable planner must not bind intent"),
          releasePlannedAttemptExecutorWorkPosition: () => Effect.void
        })
      )
      .pipe(Effect.flip)
    expect(unavailablePlanner).toMatchObject({ _tag: "TaskClaimReacquisitionPlannerUnavailable", taskId })

    const replacement = {
      operationId: taskClaimReacquisitionOperationId(command.commandId),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make(`replacement-claim:${taskId}:${taskClaimReacquisitionOperationId(command.commandId)}`)
    }
    const boundIntentIds = yield* Ref.make<ReadonlyArray<OperationId>>([])
    const reacquisitionInterpreter = WorkflowInterpreter.of({
      acquireTaskClaim: (operation, onIntentRecorded = Effect.void) =>
        Effect.gen(function* () {
          yield* journal.append(
            runId,
            intentRecordKey(operation.acquisition.operationId),
            TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion })
          )
          yield* onIntentRecorded
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.acquisition.operationId),
            TaskClaimAcquiredEvent.make({
              claim: { _tag: "ActiveTaskClaim", ...operation.acquisition },
              version: workflowJournalEventVersion
            })
          )
          return AuthoritativeTaskClaimAcquired.make({ claim: { _tag: "ActiveTaskClaim", ...operation.acquisition } })
        }),
      readTaskClaim: unused,
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: unused
    })
    const reacquisitionRuntime = yield* makeRunRecoveryActivation(runId).pipe(
      Effect.provideService(WorkflowInterpreter, reacquisitionInterpreter),
      Effect.provide(
        deterministicTaskClaimAcquisitionPlannerLayer({
          owner: ClaimOwner.make("dalph"),
          tokenPrefix: "replacement-claim"
        })
      )
    )
    const restartedGraphRead = (yield* reacquisitionRuntime.readFrontier).transitions[0]
    if (restartedGraphRead?._tag !== "ObservePlannedAttemptContinuationGraph") {
      return yield* Effect.die("restart must first reread the graph")
    }
    yield* journal.append(
      runId,
      intentRecordKey(restartedGraphRead.operation.operationId),
      taskTrackerReadIntent(restartedGraphRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(restartedGraphRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        restartedGraphRead.operation.operationId,
        makeCompleteTaskTrackerFactsObserved(restartedGraphRead.operation, graph.snapshot)
      )
    )
    const restartedSpecificationRead = (yield* reacquisitionRuntime.readFrontier).transitions[0]
    if (restartedSpecificationRead?._tag !== "ObservePlannedAttemptContinuationSpecification") {
      return yield* Effect.die("restart must reread the task specification")
    }
    yield* journal.append(
      runId,
      intentRecordKey(restartedSpecificationRead.operation.operationId),
      taskTrackerReadIntent(restartedSpecificationRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(restartedSpecificationRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        restartedSpecificationRead.operation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(restartedSpecificationRead.operation, specification)
      )
    )
    const restartedClaimRead = (yield* reacquisitionRuntime.readFrontier).transitions[0]
    if (restartedClaimRead?._tag !== "ObservePlannedAttemptContinuationClaim") {
      return yield* Effect.die("restart must reread the missing claim")
    }
    yield* journal.append(
      runId,
      intentRecordKey(restartedClaimRead.operation.operationId),
      taskTrackerReadIntent(restartedClaimRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(restartedClaimRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        restartedClaimRead.operation.operationId,
        makeFocusedTaskClaimFactsObserved(restartedClaimRead.operation, UnclaimedTask.make({ taskId }))
      )
    )
    const restartedReacquisition = (yield* reacquisitionRuntime.readFrontier).transitions[0]
    expect(restartedReacquisition).toEqual(reacquisitionTransition)
    if (restartedReacquisition?._tag !== "CommitTaskClaimReacquisitionIntent") {
      return yield* Effect.die("the pre-crash command must survive restart")
    }
    yield* reacquisitionRuntime.runTransition(
      restartedReacquisition,
      makeOwnedTransitionExecutionFixture({
        bindPlannedAttemptExecutorPosition: () => Effect.void,
        recordIntent: (operationId) => Ref.update(boundIntentIds, (ids) => [...ids, operationId]),
        releasePlannedAttemptExecutorWorkPosition: () => Effect.void
      })
    )
    expect(yield* Ref.get(boundIntentIds)).toEqual([replacement.operationId])
    expect(replacement.operationId).not.toBe(acquisition.operationId)
    expect(replacement.token).not.toBe(acquisition.token)
    expect(command).not.toHaveProperty("operationId")
    expect(command).not.toHaveProperty("token")
    const replacementEvents = (yield* journal.read(runId)).filter(
      ({ event }) =>
        (event._tag === "TaskClaimAcquisitionIntended" &&
          event.operation.acquisition.operationId === replacement.operationId) ||
        (event._tag === "TaskClaimAcquired" && event.claim.operationId === replacement.operationId)
    )
    expect(replacementEvents).toHaveLength(2)
    expect(replacementEvents[0]?.event).toMatchObject({
      operation: { authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", commandId: command.commandId } }
    })

    const replacementRead = (yield* recovery.readFrontier).transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationClaim"
    )
    if (replacementRead?._tag !== "ObservePlannedAttemptContinuationClaim") {
      return yield* Effect.die("expected a new exact claim read after reacquisition")
    }
    yield* journal.append(
      runId,
      intentRecordKey(replacementRead.operation.operationId),
      taskTrackerReadIntent(replacementRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(replacementRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        replacementRead.operation.operationId,
        makeFocusedTaskClaimFactsObserved(replacementRead.operation, { _tag: "ActiveTaskClaim", ...replacement })
      )
    )
    const worktreeRead = (yield* recovery.readFrontier).transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationWorktree"
    )
    if (worktreeRead?._tag !== "ObservePlannedAttemptContinuationWorktree") {
      return yield* Effect.die("expected a current planned worktree read after claim reconciliation")
    }
    yield* journal.append(
      runId,
      intentRecordKey(worktreeRead.operation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeRead.operation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(worktreeRead.operation.operationId),
      PlannedAttemptWorktreeObservedEvent.make({
        observation: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeRead.operation.operationId,
        version: workflowJournalEventVersion
      })
    )
    expect((yield* recovery.readFrontier).transitions).toContainEqual({
      _tag: "ContinuePlannedAttemptExecutorWork",
      plannedAttempt
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: unused,
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)
