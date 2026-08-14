/* eslint-disable max-lines -- The maintained authored story catalog keeps complete chronological cassettes reviewable together. */
import { makeTaskWorkSpecification, TaskId } from "@dalph/contracts"
import { Option, Schema } from "effect"
import { AuthoredScenarioCassette, type AuthoredScenarioCassette as ScenarioCassette } from "./authored.js"
import { AuthoredCassetteStoryItem } from "./authored-domain.js"

const decodeStoryItem = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)
const terminalStoryItemOffset = -1

const authoredReconcileProposal = (taskId: "A" | "B", attemptId: "attempt:A:0" | "attempt:B:1") => ({
  _tag: "FreshWorkflowRoute" as const,
  correlation: { _tag: "Attempt" as const, attemptId },
  proposalId: JSON.stringify(["FreshWorkflowRoute", "ReconcileTaskWorktree", attemptId, taskId]),
  taskId
})

const authoredSuspendProposal = (taskId: "A" | "D", attemptId: "attempt:A:0" | "attempt:D:1") => ({
  _tag: "IdentityFreeWorkflowRoute" as const,
  correlation: { _tag: "PlannedAttempt" as const, attemptId },
  proposalId: JSON.stringify([
    "IdentityFreeWorkflowRoute",
    "SuspendPlannedAttemptExecutorWork",
    attemptId,
    null,
    taskId
  ]),
  taskId
})

const authoredStartExecutorProposal = (taskId: "A", attemptId: "attempt:A:0") => ({
  _tag: "FreshExecutorWorkflowRoute" as const,
  attemptId,
  proposalId: JSON.stringify(["FreshExecutorWorkflowRoute", "StartPlannedAttemptExecutorWork", attemptId, taskId]),
  taskId
})

const authoredAdmittedOwner = <Proposal>(proposal: Proposal) => ({ _tag: "AdmittedDeliveryAction" as const, proposal })

const singletonGraph = {
  revision: "singleton-revision",
  tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
}

const changedAttemptSpecification = {
  body: "Implement the changed accepted singleton behavior without rewriting prior executor history.",
  taskId: TaskId.make("A"),
  title: "Implement changed singleton"
}
const changedAttemptRevision = makeTaskWorkSpecification(changedAttemptSpecification).fingerprint
const changedAgainAttemptSpecification = {
  body: "Implement the third accepted singleton behavior while preserving the immutable attempt.",
  taskId: TaskId.make("A"),
  title: "Implement third singleton revision"
}
const changedAgainAttemptRevision = makeTaskWorkSpecification(changedAgainAttemptSpecification).fingerprint

const emptyTaskControlGraph = { revision: "stale-task-control-revision", tasks: [] }

const twoEligibleTasksGraph = {
  revision: "two-eligible-tasks-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const threeEligibleTasksGraph = {
  revision: "three-eligible-tasks-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const groupingChildTasksGraph = {
  revision: "grouping-child-tasks-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
  ]
}

const pauseGroupingIndependentG1 = {
  revision: "pause-grouping-independent-G1",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const pauseGroupingAddedG2 = {
  revision: "pause-grouping-added-G2",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
  ]
}

const independentPostDeathGraph = {
  revision: "independent-post-death-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const independentPostDeathStartingGraph = {
  revision: "independent-post-death-starting-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const acceptedResultBlockedGraph = {
  revision: "accepted-result-new-blocker",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["C"] },
    { id: "C", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const blockedPipelineGraph = {
  revision: "pipeline-before-A-completes",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["A"] }
  ]
}

const releasedPipelineGraph = {
  revision: "pipeline-after-A-completes",
  tasks: [
    { id: "A", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["A"] }
  ]
}

const completedPipelineGraph = {
  revision: "pipeline-after-B-completes",
  tasks: [
    { id: "A", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: ["A"] }
  ]
}

const taskControlMembershipRead = (graph: unknown): ReadonlyArray<AuthoredCassetteStoryItem> => [
  decodeStoryItem({ _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } }),
  decodeStoryItem({ _tag: "TrackerGraphReadReturned", graph })
]

const singletonExpectedBehavior = {
  _tag: "ExpectedBehavior",
  orchestration: null,
  protocol: null,
  taskWork: {
    absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "B" }],
    results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }]
  }
} as const

/**
 * The maintained manually authored singleton story. Its schema version is
 * provisional; this catalog intentionally makes no released-data promise yet.
 */
export const singletonTaskCompletesAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "one open task completes its coarse executor work",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [
      { body: "Implement the accepted singleton behavior.", taskId: "A", title: "Implement singleton" }
    ],
    trackerGraph: singletonGraph,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      claimOwner: "cassette-owner",
      claimTokenPrefix: "cassette-claim",
      executor: "executor:cassette",
      integrationTarget: { repository: "/dalph/cassettes/repository.git", ref: "refs/heads/master" },
      target: "cassette-target",
      verificationPlanId: null,
      worktreeRoot: "/dalph/cassettes"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    singletonExpectedBehavior
  ]
})

const singletonRunningExecutorReportAt = singletonTaskCompletesAuthoredCassette.story.findIndex(
  (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running"
)
const singletonStoryBeforeRunningExecutorReport = singletonTaskCompletesAuthoredCassette.story.slice(
  0,
  singletonRunningExecutorReportAt
)
type SingletonStoryItem = (typeof singletonTaskCompletesAuthoredCassette.story)[number]
const isExecutorReport = (
  item: SingletonStoryItem | undefined
): item is Extract<SingletonStoryItem, { readonly _tag: "PlannedAttemptExecutorWorkReported" }> =>
  item?._tag === "PlannedAttemptExecutorWorkReported"
const singletonRunningExecutorReport = Option.getOrThrow(
  Option.fromUndefinedOr(singletonTaskCompletesAuthoredCassette.story[singletonRunningExecutorReportAt]).pipe(
    Option.filter(isExecutorReport)
  )
)
const twoEligibleStoryBeforeRunningExecutorReport = singletonStoryBeforeRunningExecutorReport
  .flatMap((item) => [
    ...(item._tag === "DalphSelects" && item.operation._tag === "AcquireTaskClaim"
      ? [
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
          },
          { _tag: "TrackerGraphReadReturned" as const, graph: twoEligibleTasksGraph }
        ]
      : []),
    item._tag === "TrackerGraphReadReturned" ? { ...item, graph: twoEligibleTasksGraph } : item
  ])
  .flatMap((item) => [
    item,
    ...(item._tag === "DalphSelects" && item.operation._tag === "AcquireTaskClaim"
      ? [
          { _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "B" } },
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
          },
          { _tag: "TrackerGraphReadReturned" as const, graph: twoEligibleTasksGraph }
        ]
      : [])
  ])
  .flatMap((item) => [
    item,
    ...(item._tag === "TaskWorkSpecificationReadReturned" && item.taskId === "A"
      ? [
          { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId: "B" } },
          {
            _tag: "TaskWorkSpecificationReadReturned" as const,
            body: "Implement the second eligible behavior.",
            taskId: "B",
            title: "Implement second task"
          }
        ]
      : [])
  ])
  .flatMap((item) => [
    item,
    ...(item._tag === "DalphSelects" && item.operation._tag === "RecordTaskAttemptPlan"
      ? [
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId: "attempt:B:1", taskId: "B" }
          }
        ]
      : [])
  ])
  .flatMap((item) => [
    item,
    ...(item._tag === "DalphSelects" && item.operation._tag === "ReconcileTaskWorktree"
      ? [
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "ReconcileTaskWorktree" as const, attemptId: "attempt:B:1", taskId: "B" }
          }
        ]
      : [])
  ])
const twoEligiblePlannedStoryBeforeRunningExecutorReport = twoEligibleStoryBeforeRunningExecutorReport
const runPauseExpectedBehavior = {
  _tag: "ExpectedBehavior",
  orchestration: [
    { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
    { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" }
  ],
  protocol: [
    { _tag: "TaskClaimAcquired", taskId: "A" },
    { _tag: "TaskClaimAcquired", taskId: "B" },
    { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "TaskAttemptPlanned", attemptId: "attempt:B:1", taskId: "B" },
    { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "TaskWorktreeReady", attemptId: "attempt:B:1", taskId: "B" },
    { _tag: "ControlDirectionApplied", direction: "Pause", subject: { _tag: "Run" } }
  ],
  taskWork: { absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "B" }], results: [] }
} as const

/** A live Run finishes the exact executor suspension selected after Alice applies Pause. */
export const runPauseSafelySuspendsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice pauses the Run while its exact executor work is running",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      ...singletonTaskCompletesAuthoredCassette.startingFacts.taskWorkSpecifications,
      { body: "Implement the second eligible behavior.", taskId: "B", title: "Implement second task" }
    ],
    trackerGraph: twoEligibleTasksGraph
  },
  story: [
    ...twoEligiblePlannedStoryBeforeRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Run" }
    },
    singletonRunningExecutorReport,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    runPauseExpectedBehavior
  ]
})

const singletonReconcileWorktreeAt = singletonTaskCompletesAuthoredCassette.story.findIndex(
  (item) => item._tag === "DalphSelects" && item.operation._tag === "ReconcileTaskWorktree"
)

/** Alice disconnects while an unresolved planned-worktree request reaches its ordinary Git reread boundary. */
export const runPauseObservationDisconnectsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice disconnects while Run R reaches its existing safe boundary",
  story: [
    ...singletonTaskCompletesAuthoredCassette.story.slice(0, singletonReconcileWorktreeAt + 1),
    { _tag: "OperatorAppliesControlDirection", direction: "Pause", subject: { _tag: "Run" } },
    { _tag: "OperatorStartsPauseObservation", subject: { _tag: "Run" } },
    {
      _tag: "PauseProgressObservedCancelledAndReconnected",
      subject: { _tag: "Run" },
      reconnectResult: {
        _tag: "PauseConfirmed",
        atBoundary: [
          {
            _tag: "WorkflowOperation",
            beganAt: 5,
            coverage: { _tag: "RunPauseCoverage" },
            operationId: "cassette:$authored-run:activation:1:operation:5",
            responsibilityTag: "TaskWorktreeResponsibility",
            taskId: "A"
          }
        ]
      },
      reconnectSubject: { _tag: "Run" },
      result: {
        _tag: "PauseWaiting",
        atBoundary: [],
        preventing: [
          {
            blockers: [
              {
                _tag: "ProposedDeliveryAction",
                proposal: {
                  _tag: "AcceptedWorkflowRoute",
                  operationId: "cassette:$authored-run:activation:1:operation:6",
                  proposalId: JSON.stringify([
                    "AcceptedWorkflowRoute",
                    "ReconcileTaskWorktree",
                    "cassette:$authored-run:activation:1:operation:6",
                    "A"
                  ]),
                  taskId: "A"
                }
              }
            ],
            responsibility: {
              _tag: "WorkflowOperation",
              beganAt: 13,
              coverage: { _tag: "RunPauseCoverage" },
              operationId: "cassette:$authored-run:activation:1:operation:6",
              responsibilityTag: "TaskWorktreeResponsibility",
              taskId: "A"
            }
          },
          {
            blockers: [
              {
                _tag: "LiveDeliveryAction",
                owner: {
                  _tag: "MaterializedDeliveryAction",
                  intent: "IntentRecorded",
                  operationId: "cassette:$authored-run:activation:1:operation:6",
                  proposal: authoredReconcileProposal("A", "attempt:A:0")
                }
              }
            ],
            responsibility: {
              _tag: "DeliveryAction",
              coverage: { _tag: "RunPauseCoverage" },
              proposal: authoredReconcileProposal("A", "attempt:A:0"),
              taskId: "A"
            }
          }
        ]
      }
    },
    { _tag: "GitPlannedWorktreeCreateResponseLost", detail: "Git applied OW but Dalph lost the response" },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: { absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "A" }], results: [] }
    }
  ]
})

/** Restart reconstructs Run Pause, safely suspends prior work, and performs no tracker read. */
export const runPauseRestartsPassivelyAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runPauseSafelySuspendsAuthoredCassette,
  name: "a confirmed paused Run restarts without run-specific polling",
  story: [
    ...twoEligiblePlannedStoryBeforeRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Run" }
    },
    singletonRunningExecutorReport,
    { _tag: "CoordinatorProcessDies" },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    runPauseExpectedBehavior
  ]
})

/** Alice's stale task Pause is rejected after a complete fresh target-closure read. */
export const staleTaskPauseRejectedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "Alice's stale task Pause is rejected visibly after a fresh read",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [],
    trackerGraph: emptyTaskControlGraph,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      claimOwner: "cassette-owner",
      claimTokenPrefix: "cassette-claim",
      executor: "executor:cassette",
      integrationTarget: { repository: "/dalph/cassettes/repository.git", ref: "refs/heads/master" },
      target: "cassette-target",
      verificationPlanId: null,
      worktreeRoot: "/dalph/cassettes"
    },
    { _tag: "OperatorAppliesControlDirection", direction: "Pause", subject: { _tag: "Task", taskId: "A" } },
    ...taskControlMembershipRead(emptyTaskControlGraph),
    {
      _tag: "OperatorControlDirectionFailed",
      direction: "Pause",
      reason: "OutsideCurrentTargetClosure",
      subject: { _tag: "Task", taskId: "A" }
    },
    { _tag: "OperatorStartsPauseObservation", subject: { _tag: "Task", taskId: "A" } },
    { _tag: "PauseProgressObserved", result: { _tag: "PauseNotApplied" }, subject: { _tag: "Task", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: emptyTaskControlGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: emptyTaskControlGraph },
    {
      _tag: "ExpectedBehavior",
      orchestration: [],
      protocol: [],
      taskWork: { absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "A" }], results: [] }
    }
  ]
})

/** An incomplete current read remains a tracker failure and cannot prove that Alice's task is stale. */
const staleTaskMembershipReturnedAt = staleTaskPauseRejectedAuthoredCassette.story.findIndex(
  (item, index) =>
    index >
      staleTaskPauseRejectedAuthoredCassette.story.findIndex(
        (candidate) => candidate._tag === "OperatorAppliesControlDirection"
      ) && item._tag === "TrackerGraphReadReturned"
)
export const unreadableTaskUnpauseRejectedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...staleTaskPauseRejectedAuthoredCassette,
  name: "Alice's task Unpause remains unapplied when the fresh read is incomplete",
  story: staleTaskPauseRejectedAuthoredCassette.story.flatMap((item, index) => {
    if (item._tag === "OperatorAppliesControlDirection") {
      return [decodeStoryItem({ ...item, direction: "Unpause" })]
    }
    if (index === staleTaskMembershipReturnedAt) {
      return [decodeStoryItem({ _tag: "TrackerGraphReadFailed", reason: "IncompleteSnapshot" })]
    }
    if (item._tag === "OperatorControlDirectionFailed") {
      return [decodeStoryItem({ ...item, direction: "Unpause", reason: "IncompleteSnapshot" })]
    }
    return [item]
  })
})

/** Pausing A suspends its running attempt, then independent B uses the released task-work position. */
export const taskPauseLetsIndependentTaskContinueAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice pauses task A while independent B continues after confirmed suspension",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      ...singletonTaskCompletesAuthoredCassette.startingFacts.taskWorkSpecifications,
      { body: "Implement the second eligible behavior.", taskId: "B", title: "Implement second task" }
    ]
  },
  story: [
    ...singletonStoryBeforeRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(twoEligibleTasksGraph),
    singletonRunningExecutorReport,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: twoEligibleTasksGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: twoEligibleTasksGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: twoEligibleTasksGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the second eligible behavior.",
      taskId: "B",
      title: "Implement second task"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:B:1" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:B:1", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    {
      _tag: "ExpectedBehavior",
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" },
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:B:1", taskId: "B" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:B:1", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:B:1", report: "TerminalCompleted" }
      ],
      protocol: [
        { _tag: "TaskClaimAcquired", taskId: "A" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "ControlDirectionApplied", direction: "Pause", subject: { _tag: "Task", taskId: "A" } },
        { _tag: "TaskClaimAcquired", taskId: "B" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:B:1", taskId: "B" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:B:1", taskId: "B" }
      ],
      taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: "B" }] }
    }
  ]
})

/** One task direction covers B through current grouping without recording a direction for B. */
export const taskPauseCoversGroupingChildAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runPauseSafelySuspendsAuthoredCassette,
  name: "Alice pauses task A and current grouping child B",
  startingFacts: { ...runPauseSafelySuspendsAuthoredCassette.startingFacts, trackerGraph: groupingChildTasksGraph },
  story: [
    ...twoEligiblePlannedStoryBeforeRunningExecutorReport.map((item) =>
      item._tag === "TrackerGraphReadReturned" ? { ...item, graph: groupingChildTasksGraph } : item
    ),
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(groupingChildTasksGraph),
    {
      _tag: "DalphHoldsExecutorRequestThroughNextDeliveryPublication",
      attemptId: "attempt:A:0",
      request: "StartOrContinue",
      taskId: "A"
    },
    singletonRunningExecutorReport,
    { _tag: "OperatorStartsPauseObservation", subject: { _tag: "Task", taskId: "A" } },
    {
      _tag: "PauseProgressObserved",
      result: {
        _tag: "PauseWaiting",
        atBoundary: [],
        preventing: [
          {
            blockers: [
              { _tag: "ExecutorSafeSuspensionRequired", attemptId: "attempt:A:0" },
              {
                _tag: "LiveDeliveryAction",
                owner: authoredAdmittedOwner(authoredStartExecutorProposal("A", "attempt:A:0"))
              }
            ],
            responsibility: {
              _tag: "PlannedAttemptExecutorWork",
              attemptId: "attempt:A:0",
              beganAt: 26,
              coverage: { _tag: "ExactTaskPauseCoverage" },
              taskId: "A"
            }
          }
        ]
      },
      subject: { _tag: "Task", taskId: "A" }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: groupingChildTasksGraph },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    {
      ...runPauseExpectedBehavior,
      protocol: [
        { _tag: "TaskClaimAcquired", taskId: "A" },
        { _tag: "TaskClaimAcquired", taskId: "B" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:B:1", taskId: "B" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:B:1", taskId: "B" },
        { _tag: "ControlDirectionApplied", direction: "Pause", subject: { _tag: "Task", taskId: "A" } }
      ]
    }
  ]
})

/** Alice withdraws task A's Pause while the exact executor suspension remains unresolved. */
const twoStoryItemsBefore = 2
type ExpectedBehaviorStoryItem = Extract<AuthoredCassetteStoryItem, { readonly _tag: "ExpectedBehavior" }>

const unpauseTerminalStory = (item: ExpectedBehaviorStoryItem): ReadonlyArray<AuthoredCassetteStoryItem> => [
  decodeStoryItem({
    _tag: "PlannedAttemptExecutorWorkReported",
    report: { _tag: "Terminal", attemptId: "attempt:B:1", result: { _tag: "Completed" } },
    request: "StartOrContinue"
  }),
  decodeStoryItem({
    ...item,
    orchestration:
      item.orchestration === null
        ? null
        : [
            ...item.orchestration,
            { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalCompleted" },
            { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:B:1", taskId: "B" },
            { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:B:1", report: "TerminalCompleted" }
          ],
    protocol:
      item.protocol === null
        ? null
        : [
            { _tag: "TaskClaimAcquired", taskId: "A" },
            { _tag: "TaskClaimAcquired", taskId: "B" },
            { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
            { _tag: "TaskAttemptPlanned", attemptId: "attempt:B:1", taskId: "B" },
            { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
            { _tag: "TaskWorktreeReady", attemptId: "attempt:B:1", taskId: "B" },
            { _tag: "ControlDirectionApplied", direction: "Pause", subject: { _tag: "Task", taskId: "A" } },
            { _tag: "ControlDirectionApplied", direction: "Unpause", subject: { _tag: "Task", taskId: "A" } }
          ],
    taskWork: {
      ...item.taskWork,
      absences: [],
      results: [
        { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
        { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
      ]
    }
  })
]

const unpauseAfterSafeStory: ReadonlyArray<AuthoredCassetteStoryItem> = [
  decodeStoryItem({
    _tag: "PlannedAttemptExecutorWorkReported",
    report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
    request: "StartOrContinue"
  }),
  decodeStoryItem({ _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } }),
  decodeStoryItem({ _tag: "TrackerGraphReadReturned", graph: groupingChildTasksGraph })
]

const graphSelectionFollowsBasePauseObservation = (
  item: AuthoredCassetteStoryItem,
  index: number,
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): boolean =>
  item._tag === "DalphSelects" &&
  item.operation._tag === "ReadTrackerGraph" &&
  story[index - 1]?._tag === "PauseProgressObserved"

const graphReturnFollowsBasePauseObservation = (
  item: AuthoredCassetteStoryItem,
  index: number,
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): boolean =>
  item._tag === "TrackerGraphReadReturned" &&
  story[index - 1]?._tag === "DalphSelects" &&
  story[index - twoStoryItemsBefore]?._tag === "PauseProgressObserved"

const followsBasePauseObservation = (
  item: AuthoredCassetteStoryItem,
  index: number,
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): boolean =>
  graphSelectionFollowsBasePauseObservation(item, index, story) ||
  graphReturnFollowsBasePauseObservation(item, index, story)

const unpauseWaitingStory = (): ReadonlyArray<AuthoredCassetteStoryItem> => [
  decodeStoryItem({
    _tag: "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
    attemptId: "attempt:A:0",
    taskId: "A"
  }),
  decodeStoryItem({ _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } }),
  decodeStoryItem({ _tag: "TrackerGraphReadReturned", graph: groupingChildTasksGraph }),
  decodeStoryItem({ _tag: "CassetteReleasesHeldPlannedAttemptSuspension", attemptId: "attempt:A:0", taskId: "A" }),
  decodeStoryItem({ _tag: "OperatorSubscribesToPauseObservation", subject: { _tag: "Task", taskId: "A" } }),
  decodeStoryItem({
    _tag: "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting",
    duringAttemptId: "attempt:A:0",
    queued: ["ProposedDeliveryAction", "LiveDeliveryAction"].map((blockerTag) => ({
      _tag: "PauseWaiting" as const,
      atBoundary: [],
      preventing: [
        {
          blockers: [
            { _tag: "ExecutorSafeSuspensionRequired" as const, attemptId: "attempt:A:0" },
            blockerTag === "ProposedDeliveryAction"
              ? { _tag: "ProposedDeliveryAction" as const, proposal: authoredSuspendProposal("A", "attempt:A:0") }
              : {
                  _tag: "LiveDeliveryAction" as const,
                  owner: authoredAdmittedOwner(authoredSuspendProposal("A", "attempt:A:0"))
                }
          ],
          responsibility: {
            _tag: "PlannedAttemptExecutorWork" as const,
            attemptId: "attempt:A:0",
            beganAt: 26,
            coverage: { _tag: "ExactTaskPauseCoverage" as const },
            taskId: "A"
          }
        }
      ]
    })),
    subject: { _tag: "Task", taskId: "A" }
  }),
  ...taskControlMembershipRead(groupingChildTasksGraph)
]

const unpauseStoryItem = (
  item: AuthoredCassetteStoryItem,
  index: number,
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): ReadonlyArray<AuthoredCassetteStoryItem> => {
  if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "SafelySuspended") {
    return [item, ...unpauseAfterSafeStory]
  }
  if (item._tag === "ExpectedBehavior") return unpauseTerminalStory(item)
  if (item._tag === "OperatorStartsPauseObservation" || followsBasePauseObservation(item, index, story)) return []
  return item._tag === "PauseProgressObserved" && item.result._tag === "PauseWaiting" ? unpauseWaitingStory() : [item]
}

export const taskPauseObservationUnpausedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...taskPauseCoversGroupingChildAuthoredCassette,
  name: "Alice unpauses task A before its Pause observation confirms",
  story: taskPauseCoversGroupingChildAuthoredCassette.story.flatMap(unpauseStoryItem)
})

/** G2 newly covers D, so only a post-G2 exact executor report can settle its Pause obligation. */
const groupingPauseAExecutor = {
  _tag: "PlannedAttemptExecutorWork" as const,
  attemptId: "attempt:A:0",
  beganAt: 21,
  coverage: { _tag: "ExactTaskPauseCoverage" as const },
  taskId: "A"
}
const groupingPauseDExecutor = {
  _tag: "PlannedAttemptExecutorWork" as const,
  attemptId: "attempt:D:1",
  beganAt: 2,
  coverage: { _tag: "GroupingDescendantPauseCoverage" as const, groupingObservedAt: 3, pausedTaskId: "A" },
  taskId: "D"
}
const groupingFactsAddedBeforeRunningA = [
  { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 2 } },
  {
    _tag: "RunCoordinator",
    baseSha: "1111111111111111111111111111111111111111",
    claimOwner: "cassette-owner",
    claimTokenPrefix: "cassette-claim",
    executor: "executor:cassette",
    integrationTarget: { repository: "/dalph/cassettes/repository.git", ref: "refs/heads/master" },
    target: "cassette-target",
    verificationPlanId: null,
    worktreeRoot: "/dalph/cassettes"
  },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
  { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
  { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "D" } },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
  { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "D" },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
  {
    _tag: "TaskWorkSpecificationReadReturned",
    body: "Implement the accepted singleton behavior.",
    taskId: "A",
    title: "Implement singleton"
  },
  { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
  { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } }
].map((item) => decodeStoryItem(item))

export const taskPauseGroupingFactsAddedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runPauseSafelySuspendsAuthoredCassette,
  name: "Alice sees current grouping facts add D to task A's Pause",
  startingFacts: {
    ...runPauseSafelySuspendsAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      { body: "Implement the accepted singleton behavior.", taskId: "A", title: "Implement singleton" },
      { body: "Implement the grouping descendant behavior.", taskId: "D", title: "Implement grouping descendant" }
    ],
    targetLineageObservation: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "2222222222222222222222222222222222222222"
    },
    trackerGraph: pauseGroupingIndependentG1
  },
  story: [
    ...groupingFactsAddedBeforeRunningA,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(pauseGroupingIndependentG1),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    { _tag: "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "D" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "D" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the grouping descendant behavior.",
      taskId: "D",
      title: "Implement grouping descendant"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:D:1", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:D:1", taskId: "D" } },
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:D:1",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "D" }
    },
    ...taskControlMembershipRead(pauseGroupingIndependentG1),
    {
      _tag: "DalphHoldsExecutorRequestThroughNextDeliveryPublication",
      attemptId: "attempt:D:1",
      request: "StartOrContinue",
      taskId: "D"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:D:1" },
      request: "StartOrContinue"
    },
    { _tag: "CassetteReleasesHeldPlannedAttemptSuspension", attemptId: "attempt:A:0", taskId: "A" },
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Unpause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(pauseGroupingIndependentG1),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the prerequisite behavior.",
      taskId: "A",
      title: "Implement prerequisite"
    },
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Unpause",
      duringAttemptId: "attempt:D:1",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "D" }
    },
    ...taskControlMembershipRead(pauseGroupingIndependentG1),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:D:1" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseGroupingIndependentG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "D" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the grouping descendant behavior.",
      taskId: "D",
      title: "Implement grouping descendant"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:D:1", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:D:1", taskId: "D" } },
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:D:1",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(pauseGroupingIndependentG1),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:D:1" },
      request: "StartOrContinue"
    },
    { _tag: "OperatorStartsPauseObservation", subject: { _tag: "Task", taskId: "A" } },
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:D:1",
      outcome: { _tag: "Rejected", reason: "OutsideCurrentTargetClosure" },
      subject: { _tag: "Task", taskId: "X" }
    },
    ...taskControlMembershipRead(pauseGroupingAddedG2),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:D:1" },
      request: "StartOrContinue"
    },
    {
      _tag: "OperatorAwaitsPauseProgress",
      subject: { _tag: "Task", taskId: "A" },
      result: {
        _tag: "PauseWaiting",
        atBoundary: [],
        preventing: [
          {
            blockers: [{ _tag: "ExecutorSafeSuspensionRequired", attemptId: "attempt:A:0" }],
            responsibility: groupingPauseAExecutor
          }
        ]
      }
    },
    {
      _tag: "OperatorAwaitsPauseProgress",
      subject: { _tag: "Task", taskId: "A" },
      result: {
        _tag: "PauseWaiting",
        atBoundary: [],
        preventing: [
          {
            blockers: [{ _tag: "ExecutorSafeSuspensionRequired", attemptId: "attempt:A:0" }],
            responsibility: groupingPauseAExecutor
          },
          {
            blockers: [
              { _tag: "ExecutorSafeSuspensionRequired", attemptId: "attempt:D:1" },
              {
                _tag: "LiveDeliveryAction",
                owner: {
                  _tag: "AdmittedDeliveryAction",
                  proposal: {
                    _tag: "FreshExecutorWorkflowRoute",
                    attemptId: "attempt:D:1",
                    proposalId: '["FreshExecutorWorkflowRoute","ContinuePlannedAttemptExecutorWork","attempt:D:1","D"]',
                    taskId: "D"
                  }
                }
              }
            ],
            responsibility: groupingPauseDExecutor
          }
        ]
      }
    },
    {
      _tag: "OperatorAwaitsPauseProgress",
      subject: { _tag: "Task", taskId: "A" },
      result: { _tag: "PauseConfirmed", atBoundary: [groupingPauseAExecutor, groupingPauseDExecutor] }
    },
    { _tag: "ExpectedBehavior", orchestration: null, protocol: null, taskWork: { absences: [], results: [] } }
  ]
})

const lostWorktreeStoryBeforeAssertions = singletonTaskCompletesAuthoredCassette.story.flatMap((item) => {
  if (item._tag === "ExpectedBehavior") return []
  return item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal"
    ? [{ _tag: "CoordinatorProcessDies" as const }]
    : [item]
})

/** After process death, the same running attempt records its disappeared worktree and suspends without repair. */
export const lostPlannedWorktreeSafelySuspendsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "a disappeared planned worktree safely suspends only the same attempt after process death",
  story: [
    ...lostWorktreeStoryBeforeAssertions,
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "GitWorktreeObservationChanged", observation: { _tag: "PlannedWorktreeAbsent" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      ...singletonExpectedBehavior,
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" }
      ],
      protocol: [
        { _tag: "TaskClaimAcquired", taskId: "A" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskClaimObserved", claimState: "Exact", taskId: "A" },
        { _tag: "AttemptWorktreeLost", attemptId: "attempt:A:0", taskId: "A" }
      ],
      taskWork: { ...singletonExpectedBehavior.taskWork, results: [] }
    }
  ]
})

const targetLineagePostDeathReads = [
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
  {
    _tag: "TaskWorkSpecificationReadReturned",
    body: "Implement the accepted singleton behavior.",
    taskId: "A",
    title: "Implement singleton"
  },
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
  { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
  { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } }
] as const

const targetLineageProtocolPrefix = [
  { _tag: "TaskClaimAcquired", taskId: "A" },
  { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
  { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
  { _tag: "TaskClaimObserved", claimState: "Exact", taskId: "A" }
] as const

/** A fresh activation keeps the same Run/attempt after a typed death immediately before the first report. */
export const coordinatorProcessDeathContinuesAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "a fresh activation continues the same planned attempt after coordinator death before its first report",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    targetLineageObservation: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "2222222222222222222222222222222222222222"
    }
  },
  story: [
    ...singletonStoryBeforeRunningExecutorReport,
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    ...targetLineagePostDeathReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      ...singletonExpectedBehavior,
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalCompleted" }
      ],
      protocol: [
        ...targetLineageProtocolPrefix,
        {
          _tag: "CompatibleTargetAdvance",
          plannedBaseSha: "1111111111111111111111111111111111111111",
          targetHeadSha: "2222222222222222222222222222222222222222",
          taskId: "A"
        }
      ]
    }
  ]
})

const changedAttemptChoiceExposureReads = [
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
  { _tag: "TaskWorkSpecificationReadReturned", ...changedAttemptSpecification }
] as const

const changedAttemptContinuationReads = [
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
  ...changedAttemptChoiceExposureReads,
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
  { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
  { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } }
] as const

const attemptChoiceStartingFacts = {
  ...singletonTaskCompletesAuthoredCassette.startingFacts,
  targetLineageObservation: {
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: "1111111111111111111111111111111111111111",
    targetHeadSha: "2222222222222222222222222222222222222222"
  }
} as const

const attemptChoiceExpectedBehavior = {
  _tag: "ExpectedBehavior",
  orchestration: null,
  protocol: null,
  taskWork: { absences: [], results: [] }
} as const

/** Alice keeps P immutable, then Dalph rereads every continuation authority before resuming it. */
export const changedAttemptContinuesAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice continues the exact changed attempt only after fresh authority reads",
  startingFacts: attemptChoiceStartingFacts,
  story: [
    ...lostWorktreeStoryBeforeAssertions,
    ...changedAttemptChoiceExposureReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    {
      _tag: "OperatorContinuesAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "continue-changed-attempt-A",
      taskId: "A"
    },
    {
      _tag: "OperatorContinuesAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "continue-changed-attempt-A",
      taskId: "A"
    },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Rejected", reason: "IdentityContradiction" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "continue-changed-attempt-A",
      taskId: "A"
    },
    { _tag: "CoordinatorProcessDies" },
    ...changedAttemptContinuationReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      ...attemptChoiceExpectedBehavior,
      taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }] }
    }
  ]
})

const changedAttemptRestartRequest = {
  _tag: "OperatorRestartsAttempt",
  attemptId: "attempt:A:0",
  expected: { _tag: "Applied" },
  observedTaskRevision: changedAttemptRevision,
  requestNonce: "restart-changed-attempt-A",
  taskId: "A"
} as const

const changedAttemptRestartAuthorityReads = [
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
  { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
  { _tag: "TaskWorkSpecificationReadReturned", ...changedAttemptSpecification },
  { _tag: "TaskClaimCurrentReadReturned", taskId: "A" }
] as const

const changedAttemptRestartStoryThroughChoice = [
  ...lostWorktreeStoryBeforeAssertions,
  ...changedAttemptChoiceExposureReads,
  {
    _tag: "PlannedAttemptExecutorWorkReported",
    report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
    request: "Suspend"
  },
  changedAttemptRestartRequest
] as const

const changedAttemptSuccessorStory = [
  { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:1", taskId: "A" } },
  {
    _tag: "PlannedAttemptExecutorWorkReported",
    report: { _tag: "Running", attemptId: "attempt:A:1" },
    request: "StartOrContinue"
  },
  {
    _tag: "PlannedAttemptExecutorWorkReported",
    report: { _tag: "Terminal", attemptId: "attempt:A:1", result: { _tag: "Completed" } },
    request: "StartOrContinue"
  }
] as const

/** Alice replaces exact safely suspended P1, then ordinary worktree reconciliation and admission start clean P2. */
export const changedAttemptRestartsCleanlyAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice restarts the exact changed attempt into one clean successor",
  startingFacts: attemptChoiceStartingFacts,
  story: [
    ...changedAttemptRestartStoryThroughChoice,
    ...changedAttemptRestartAuthorityReads,
    ...changedAttemptSuccessorStory,
    {
      ...attemptChoiceExpectedBehavior,
      taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }] }
    }
  ]
})

/** Process loss after the atomic append reconstructs exact P2 and never allocates P3. */
export const changedAttemptRestartAfterSupersessionCrashAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptRestartsCleanlyAuthoredCassette,
  name: "Dalph reconstructs the exact replacement successor after process loss",
  story: [
    ...changedAttemptRestartStoryThroughChoice,
    ...changedAttemptRestartAuthorityReads,
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    ...changedAttemptSuccessorStory,
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      ...attemptChoiceExpectedBehavior,
      taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }] }
    }
  ]
})

/** A fresh F3 read makes D1 stale and records no replacement successor. */
export const changedAttemptRestartFactsChangedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptRestartsCleanlyAuthoredCassette,
  name: "Alice sees changed-again task facts prevent the recorded Restart from planning P2",
  story: [
    ...changedAttemptRestartStoryThroughChoice,
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "TaskWorkSpecificationReadReturned", ...changedAgainAttemptSpecification },
    attemptChoiceExpectedBehavior
  ]
})

/** Three unreadable K1 reads enter the typed local wait without tracker mutation or P2. */
export const changedAttemptRestartClaimUnavailableAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptRestartsCleanlyAuthoredCassette,
  name: "Alice sees Restart wait after three unreadable exact-claim reads",
  story: [
    ...changedAttemptRestartStoryThroughChoice,
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "TaskWorkSpecificationReadReturned", ...changedAttemptSpecification },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    attemptChoiceExpectedBehavior
  ]
})

/** A concrete non-ready W1 observation preserves P1 and records no successor or Git mutation. */
export const changedAttemptRestartWorktreeNotReadyAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptRestartsCleanlyAuthoredCassette,
  name: "Alice sees Restart wait when Git reports the old worktree absent",
  story: [
    ...changedAttemptRestartStoryThroughChoice,
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "TaskWorkSpecificationReadReturned", ...changedAttemptSpecification },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "GitWorktreeObservationChanged", observation: { _tag: "PlannedWorktreeAbsent" } },
    attemptChoiceExpectedBehavior
  ]
})

const changedAttemptContinueRestartAt = changedAttemptContinuesAuthoredCassette.story.findLastIndex(
  (item) => item._tag === "CoordinatorProcessDies"
)

/** A later F3 observation invalidates F2's Continue authority and exposes one new F1/F3 choice. */
export const changedAgainAttemptRequiresNewChoiceAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptContinuesAuthoredCassette,
  name: "Alice must choose again when the continued attempt changes from F2 to F3",
  story: [
    ...changedAttemptContinuesAuthoredCassette.story.slice(0, changedAttemptContinueRestartAt + 1),
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    { _tag: "TaskWorkSpecificationReadReturned", ...changedAgainAttemptSpecification },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "AwaitingQuiescence" },
      observedTaskRevision: changedAgainAttemptRevision,
      requestNonce: "stop-changed-again-attempt-A",
      taskId: "A"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    attemptChoiceExpectedBehavior
  ]
})

/** Alice stops P after its exact safe report and Dalph releases only the freshly reread exact claim. */
export const changedAttemptStopsAndReleasesAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice stops the exact changed attempt and releases only its current exact claim",
  startingFacts: attemptChoiceStartingFacts,
  story: [
    ...lostWorktreeStoryBeforeAssertions,
    ...changedAttemptChoiceExposureReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "AwaitingQuiescence" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-changed-attempt-A",
      taskId: "A"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReleaseTaskClaim", taskId: "A" } },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "SettledReleased" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-changed-attempt-A",
      taskId: "A"
    },
    {
      _tag: "OperatorContinuesAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Rejected", reason: "IdentityContradiction" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-changed-attempt-A",
      taskId: "A"
    },
    attemptChoiceExpectedBehavior
  ]
})

const changedAttemptStopAppliedAt = changedAttemptStopsAndReleasesAuthoredCassette.story.findIndex(
  (item) => item._tag === "OperatorStopsAttempt"
)
const changedAttemptStopStoryThroughApplication = changedAttemptStopsAndReleasesAuthoredCassette.story.slice(
  0,
  changedAttemptStopAppliedAt + 1
)

/** Concurrent valid Continue and Stop requests cross the public boundary; the first journal append wins. */
export const changedAttemptChoiceRaceAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptStopsAndReleasesAuthoredCassette,
  name: "Alice races Continue and Stop for the same exposed F1 and F2 choice",
  story: [
    ...changedAttemptStopsAndReleasesAuthoredCassette.story.slice(0, changedAttemptStopAppliedAt),
    {
      _tag: "OperatorRacesContinueAndStop",
      attemptId: "attempt:A:0",
      continueRequestNonce: "race-continue-changed-attempt-A",
      observedTaskRevision: changedAttemptRevision,
      stopRequestNonce: "race-stop-changed-attempt-A",
      taskId: "A"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    attemptChoiceExpectedBehavior
  ]
})

const stoppedAttemptWithoutClaimMutationCassette = (
  name: string,
  requestNonce: string,
  observation:
    | { readonly _tag: "UnclaimedTask"; readonly taskId: string }
    | {
        readonly _tag: "ActiveTaskClaim"
        readonly operationId: string
        readonly owner: string
        readonly taskId: string
        readonly token: string
      }
) =>
  Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...changedAttemptStopsAndReleasesAuthoredCassette,
    name,
    story: [
      ...changedAttemptStopStoryThroughApplication.map((item) =>
        item._tag === "OperatorStopsAttempt" ? { ...item, requestNonce } : item
      ),
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
      { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
      { _tag: "TaskClaimReadReturned", observation },
      {
        _tag: "OperatorStopsAttempt",
        attemptId: "attempt:A:0",
        expected: { _tag: "Applied", status: "ImplementationAbandonedClaimDispositionPending" },
        observedTaskRevision: changedAttemptRevision,
        requestNonce,
        taskId: "A"
      },
      attemptChoiceExpectedBehavior
    ]
  })

/** Stop records the missing claim as a distinct terminal no-release disposition. */
export const changedAttemptStopsWithAbsentClaimAuthoredCassette: ScenarioCassette =
  stoppedAttemptWithoutClaimMutationCassette(
    "Alice stops the exact changed attempt while its tracker claim is absent",
    "stop-changed-attempt-A-absent",
    { _tag: "UnclaimedTask", taskId: "A" }
  )

/** Stop preserves a replacement claim owned by another actor. */
export const changedAttemptStopsWithForeignClaimAuthoredCassette: ScenarioCassette =
  stoppedAttemptWithoutClaimMutationCassette(
    "Alice stops the exact changed attempt without mutating its replacement claim",
    "stop-changed-attempt-A-foreign",
    {
      _tag: "ActiveTaskClaim",
      operationId: "replacement-claim-A",
      owner: "another-owner",
      taskId: "A",
      token: "replacement-token-A"
    }
  )

/** A definite foreign reacquisition conflict is exposed, then remains terminal across restart. */
export const changedAttemptReacquisitionForeignConflictAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "a missing claim reacquisition preserves a foreign claim and never retries after restart",
  story: [
    ...lostWorktreeStoryBeforeAssertions,
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimReadReturned", observation: { _tag: "UnclaimedTask", taskId: "A" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "OperatorDirectsTaskClaimReacquisition", requestId: "coverage-reacquire-foreign-A", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
    {
      _tag: "TaskClaimAcquisitionConflictReturned",
      operationId: "task-claim-reacquisition:coverage-reacquire-foreign-A",
      observed: {
        _tag: "ActiveTaskClaim",
        operationId: "foreign-reacquisition-operation-A",
        owner: "foreign-reacquisition-owner",
        taskId: "A",
        token: "foreign-reacquisition-token-A"
      }
    },
    {
      _tag: "TaskClaimAcquisitionRejected",
      operationId: "task-claim-reacquisition:coverage-reacquire-foreign-A",
      observed: {
        _tag: "ActiveTaskClaim",
        operationId: "foreign-reacquisition-operation-A",
        owner: "foreign-reacquisition-owner",
        taskId: "A",
        token: "foreign-reacquisition-token-A"
      }
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    // The restarted coordinator performs a current read; the tracker
    // must retain K2 from the conflict boundary rather than replaying
    // the earlier missing observation.
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    { _tag: "ExpectedBehavior", orchestration: null, protocol: null, taskWork: { absences: [], results: [] } }
  ]
})

const stoppedAttemptReleaseSelectedAt = changedAttemptStopsAndReleasesAuthoredCassette.story.findIndex(
  (item) => item._tag === "DalphSelects" && item.operation._tag === "ReleaseTaskClaim"
)

/** The tracker applies K1's release, loses the response, survives an unreadable activation, then settles absent. */
export const changedAttemptStopReleaseResponseLostAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptStopsAndReleasesAuthoredCassette,
  name: "Alice sees Stop settle after Dalph loses the exact claim-release response",
  story: [
    ...changedAttemptStopsAndReleasesAuthoredCassette.story.slice(0, stoppedAttemptReleaseSelectedAt + 1),
    {
      _tag: "TaskClaimReleaseResponseLost",
      detail: "tracker removed K1 but the coordinator did not receive the response",
      taskId: "A"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "ImplementationAbandonedClaimReleasePending" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-changed-attempt-A",
      taskId: "A"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimReadReturned", observation: { _tag: "UnclaimedTask", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "SettledNoRelease" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-changed-attempt-A",
      taskId: "A"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    attemptChoiceExpectedBehavior
  ]
})

/** Unpause during suspension finishes that request, then freshly rereads every continuation authority. */
export const runUnpauseAfterSafeSuspensionAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice unpauses the Run while exact executor suspension is in flight",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    targetLineageObservation: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "2222222222222222222222222222222222222222"
    }
  },
  story: [
    ...singletonStoryBeforeRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Run" }
    },
    singletonRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Unpause",
      duringAttemptId: "attempt:A:0",
      outcome: { _tag: "Applied" },
      subject: { _tag: "Run" }
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    ...targetLineagePostDeathReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      ...singletonExpectedBehavior,
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalCompleted" }
      ],
      protocol: [
        { _tag: "TaskClaimAcquired", taskId: "A" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "ControlDirectionApplied", direction: "Pause", subject: { _tag: "Run" } },
        { _tag: "ControlDirectionApplied", direction: "Unpause", subject: { _tag: "Run" } },
        { _tag: "TaskClaimObserved", claimState: "Exact", taskId: "A" },
        {
          _tag: "CompatibleTargetAdvance",
          plannedBaseSha: "1111111111111111111111111111111111111111",
          targetHeadSha: "2222222222222222222222222222222222222222",
          taskId: "A"
        }
      ]
    }
  ]
})

const runUnpauseContinuationReportAt = runUnpauseAfterSafeSuspensionAuthoredCassette.story.findIndex(
  (item) =>
    item._tag === "PlannedAttemptExecutorWorkReported" &&
    item.request === "StartOrContinue" &&
    item.report._tag === "Terminal"
)

const changedAttemptRestartWithHeldContinuationThroughChoice = [
  ...runUnpauseAfterSafeSuspensionAuthoredCassette.story.slice(0, runUnpauseContinuationReportAt),
  { _tag: "DalphHoldsAdmittedContinuationBeforeExecutorIntent", attemptId: "attempt:A:0", taskId: "A" },
  { _tag: "OperatorAppliesControlDirection", direction: "Pause", subject: { _tag: "Task", taskId: "A" } },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
  { _tag: "OperatorAppliesControlDirection", direction: "Unpause", subject: { _tag: "Task", taskId: "A" } },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
  { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
  { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
  { _tag: "TaskWorkSpecificationReadReturned", ...changedAttemptSpecification },
  { ...changedAttemptRestartRequest, requestNonce: "restart-held-continuation-A" }
] as const

/** An already admitted P1 continuation breaks safe suspension and leaves Restart visibly waiting while P1 runs. */
export const changedAttemptRestartRemainsUnprovedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice sees Restart remain unproved while the exact old attempt still runs",
  story: [
    ...changedAttemptRestartWithHeldContinuationThroughChoice,
    {
      _tag: "PlannedAttemptExecutorResponseLost",
      detail: "the admitted continuation reached Running after Restart, but its response was lost",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "PlannedAttemptExecutorProjectionReturned", report: { _tag: "Running", attemptId: "attempt:A:0" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    attemptChoiceExpectedBehavior
  ]
})

/** A late Accepted P1 report remains evidence but starts no integration; fresh authority still records exact P2. */
export const changedAttemptRestartLateAcceptedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Dalph honors the applied Restart after preserving a late Accepted P1 result",
  story: [
    ...changedAttemptRestartWithHeldContinuationThroughChoice,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: {
        _tag: "Terminal",
        attemptId: "attempt:A:0",
        result: { _tag: "Accepted", acceptedResult: { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
      },
      request: "StartOrContinue"
    },
    ...changedAttemptRestartAuthorityReads,
    ...changedAttemptSuccessorStory,
    {
      ...attemptChoiceExpectedBehavior,
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalAccepted" },
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:1", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:1", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:1", report: "TerminalCompleted" }
      ],
      taskWork: {
        absences: [],
        results: [
          { _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "A" },
          { _tag: "PlannedWorkForTaskCompleted", taskId: "A" }
        ]
      }
    }
  ]
})

/**
 * Alice stops after F2 while an already admitted continuation is held before intent;
 * later activations settle its lost response and the lost third Suspend without a duplicate command.
 */
export const changedAttemptStopLostThirdSuspensionAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice stops an admitted continuation and Dalph reconciles the lost third suspension response",
  story: [
    ...runUnpauseAfterSafeSuspensionAuthoredCassette.story.slice(0, runUnpauseContinuationReportAt),
    { _tag: "DalphHoldsAdmittedContinuationBeforeExecutorIntent", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "OperatorAppliesControlDirection", direction: "Pause", subject: { _tag: "Task", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "OperatorAppliesControlDirection", direction: "Unpause", subject: { _tag: "Task", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    { _tag: "TaskWorkSpecificationReadReturned", ...changedAttemptSpecification },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "AwaitingQuiescence" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-admitted-continuation-A",
      taskId: "A"
    },
    {
      _tag: "PlannedAttemptExecutorResponseLost",
      detail: "the admitted continuation reached Running after Stop, but its response was lost",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "PlannedAttemptExecutorProjectionReturned", report: { _tag: "Running", attemptId: "attempt:A:0" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "PlannedAttemptExecutorResponseLost",
      detail: "the third suspension request reached Running, but its response was lost",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "PlannedAttemptExecutorProjectionReturned", report: { _tag: "Running", attemptId: "attempt:A:0" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    { _tag: "PlannedAttemptExecutorProjectionReturned", report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReleaseTaskClaim", taskId: "A" } },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "SettledReleased" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-admitted-continuation-A",
      taskId: "A"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    attemptChoiceExpectedBehavior
  ]
})

const admittedContinuationResponseLostAt = changedAttemptStopLostThirdSuspensionAuthoredCassette.story.findIndex(
  (item) => item._tag === "PlannedAttemptExecutorResponseLost" && item.request === "StartOrContinue"
)
const unprovedStoppageActivationReturnAt = changedAttemptStopLostThirdSuspensionAuthoredCassette.story.findIndex(
  (item, index) => index > admittedContinuationResponseLostAt && item._tag === "CoordinatorActivationReturned"
)

/** A projected Running writer leaves Stop visibly pending and preserves every exact attempt resource. */
export const changedAttemptStopRemainsUnprovedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...changedAttemptStopLostThirdSuspensionAuthoredCassette,
  name: "Alice sees exact Stop remain pending while the projected executor writer may still be Running",
  story: [
    ...changedAttemptStopLostThirdSuspensionAuthoredCassette.story.slice(0, unprovedStoppageActivationReturnAt),
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Applied", status: "AwaitingQuiescence" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-admitted-continuation-A",
      taskId: "A"
    },
    changedAttemptStopLostThirdSuspensionAuthoredCassette.story[unprovedStoppageActivationReturnAt],
    attemptChoiceExpectedBehavior
  ]
})

const suspensionResponseLostAcrossRestart = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  detail: string
): ReadonlyArray<AuthoredCassetteStoryItem> =>
  story.flatMap((item) => {
    if (
      item._tag === "PlannedAttemptExecutorWorkReported" &&
      item.request === "Suspend" &&
      item.report._tag === "SafelySuspended"
    ) {
      return [
        decodeStoryItem({
          _tag: "PlannedAttemptExecutorResponseLost",
          detail,
          report: item.report,
          request: "Suspend"
        }),
        decodeStoryItem({ _tag: "CoordinatorProcessDies" }),
        decodeStoryItem({ _tag: "PlannedAttemptExecutorProjectionReturned", report: item.report })
      ]
    }
    if (item._tag !== "ExpectedBehavior" || item.orchestration === null) return [item]
    return [
      decodeStoryItem({
        ...item,
        orchestration: item.orchestration.map((evidence) =>
          evidence._tag === "PlannedAttemptExecutorWorkReported" && evidence.report === "SafelySuspended"
            ? { ...evidence, _tag: "PlannedAttemptExecutorCommandProjectionObserved" }
            : evidence
        )
      })
    ]
  })

/** The next activation reconciles the lost suspension response before ordinary work resumes after Unpause. */
export const runUnpauseDuringSuspensionRestartsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses while exact suspension succeeds but its response is lost before restart",
  story: suspensionResponseLostAcrossRestart(
    runUnpauseAfterSafeSuspensionAuthoredCassette.story,
    "the exact Run suspension succeeded after Unpause, but the coordinator lost its response"
  )
})

/** Task Unpause finishes its in-flight suspension, then rereads the preserved attempt's authorities. */
export const taskUnpauseAfterSafeSuspensionAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses task A while its exact executor suspension is in flight",
  story: runUnpauseAfterSafeSuspensionAuthoredCassette.story.flatMap(
    (item): ReadonlyArray<AuthoredCassetteStoryItem> => {
      if (item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight") {
        return [
          decodeStoryItem({ ...item, subject: { _tag: "Task", taskId: "A" } }),
          ...taskControlMembershipRead(singletonGraph)
        ]
      }
      if (item._tag !== "ExpectedBehavior" || item.protocol === null) return [item]
      return [
        decodeStoryItem({
          ...item,
          protocol: item.protocol.map((evidence) =>
            evidence._tag === "ControlDirectionApplied"
              ? { ...evidence, subject: { _tag: "Task", taskId: "A" } }
              : evidence
          )
        })
      ]
    }
  )
})

/** The next activation reconciles the lost task suspension response before ordinary work resumes after Unpause. */
export const taskUnpauseDuringSuspensionRestartsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...taskUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses task A while exact suspension succeeds but its response is lost before restart",
  story: suspensionResponseLostAcrossRestart(
    taskUnpauseAfterSafeSuspensionAuthoredCassette.story,
    "the exact task suspension succeeded after Unpause, but the coordinator lost its response"
  )
})

/** After process death, the same attempt continues when Git proves the target advanced from its immutable Base. */
export const compatibleTargetAdvanceContinuesAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "a compatible target advance keeps the same attempt eligible after process death",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    targetLineageObservation: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "2222222222222222222222222222222222222222"
    }
  },
  story: [
    ...lostWorktreeStoryBeforeAssertions,
    ...targetLineagePostDeathReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    {
      ...singletonExpectedBehavior,
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalCompleted" }
      ],
      protocol: [
        ...targetLineageProtocolPrefix,
        {
          _tag: "CompatibleTargetAdvance",
          plannedBaseSha: "1111111111111111111111111111111111111111",
          targetHeadSha: "2222222222222222222222222222222222222222",
          taskId: "A"
        }
      ]
    }
  ]
})

/** After process death, the same attempt safely suspends when Git proves the target left its immutable Base lineage. */
export const incompatibleTargetRewriteSafelySuspendsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "an incompatible target rewrite safely suspends only the same attempt after process death",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      ...singletonTaskCompletesAuthoredCassette.startingFacts.taskWorkSpecifications,
      { body: "Complete independent task C.", taskId: "C", title: "Complete C" }
    ],
    targetLineageObservation: {
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "3333333333333333333333333333333333333333"
    },
    trackerGraph: independentPostDeathStartingGraph
  },
  story: [
    ...lostWorktreeStoryBeforeAssertions.map((item) =>
      item._tag === "TrackerGraphReadReturned" ? { ...item, graph: independentPostDeathStartingGraph } : item
    ),
    ...targetLineagePostDeathReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentPostDeathGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentPostDeathGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentPostDeathGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "C" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Complete independent task C.",
      taskId: "C",
      title: "Complete C"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:C:0", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:C:0", taskId: "C" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:C:0" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:C:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    {
      _tag: "ExpectedBehavior",
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" },
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:C:0", taskId: "C" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:C:0", report: "Running" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:C:0", report: "TerminalCompleted" }
      ],
      protocol: [
        ...targetLineageProtocolPrefix,
        {
          _tag: "IncompatibleTargetRewrite",
          plannedBaseSha: "1111111111111111111111111111111111111111",
          targetHeadSha: "3333333333333333333333333333333333333333",
          taskId: "A"
        },
        { _tag: "TaskClaimAcquired", taskId: "C" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:C:0", taskId: "C" },
        { _tag: "TaskWorktreeReady", attemptId: "attempt:C:0", taskId: "C" }
      ],
      taskWork: {
        absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "B" }],
        results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: "C" }]
      }
    }
  ]
})

const pipelineGraphRead = (
  graph: typeof blockedPipelineGraph | typeof releasedPipelineGraph | typeof completedPipelineGraph
) => [
  {
    _tag: "DalphSelects" as const,
    operation: { _tag: "ReadTrackerGraph" as const, target: "pipeline-cassette-target" }
  },
  { _tag: "TrackerGraphReadReturned" as const, graph }
]

const pipelineAcceptedReport = (attemptId: "attempt:A:0" | "attempt:B:0", commit: string) => ({
  _tag: "PlannedAttemptExecutorWorkReported" as const,
  report: { _tag: "Terminal" as const, attemptId, result: { _tag: "Accepted" as const, acceptedResult: { commit } } },
  request: "StartOrContinue" as const
})

const candidateGitValidationReturned = (repository: string, candidateCommit: string, observation: unknown) => ({
  _tag: "IntegrationCandidateGitValidationReturned" as const,
  candidateCommit,
  observation,
  repository
})

const candidateGitValidationFailed = (repository: string, candidateCommit: string, detail: string) => ({
  _tag: "IntegrationCandidateGitValidationFailed" as const,
  candidateCommit,
  detail,
  repository
})

const targetPromotionGitReadReturned = (repository: string, candidateCommit: string, observation: unknown) => ({
  _tag: "TargetPromotionGitReadReturned" as const,
  candidateCommit,
  observation,
  repository
})

const pipelineIntegrationFinality = (
  taskId: "A" | "B",
  attemptId: "attempt:A:0" | "attempt:B:0",
  graph: typeof blockedPipelineGraph | typeof releasedPipelineGraph,
  acceptedResultCommit: string,
  candidateCommit: string
) => [
  ...pipelineGraphRead(graph),
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId } },
  { _tag: "TaskClaimCurrentReadReturned" as const, taskId },
  ...pipelineGraphRead(graph),
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTargetLineage" as const, attemptId, taskId } },
  {
    _tag: "IntegrationCandidateAgentReported" as const,
    attemptId,
    report: { _tag: "Submitted" as const, candidateCommit }
  },
  candidateGitValidationReturned("/dalph/cassettes/pipeline.git", candidateCommit, {
    _tag: "Commit" as const,
    directParents: ["2222222222222222222222222222222222222222", acceptedResultCommit]
  }),
  {
    _tag: "TargetVerificationReturned" as const,
    result: { _tag: "Passed" as const, artifacts: [{ name: "acceptance-verification", content: `verified ${taskId}` }] }
  },
  targetPromotionGitReadReturned("/dalph/cassettes/pipeline.git", candidateCommit, {
    _tag: "CandidateNotInAncestry" as const,
    currentHeadSha: "2222222222222222222222222222222222222222"
  }),
  { _tag: "TargetPromotionCompareAndSetReturned" as const, result: { _tag: "Applied" as const } },
  { _tag: "CompletionClaimReadReturned" as const, claim: "Active" as const, taskId },
  { _tag: "CompletionClaimReplacementApplied" as const, taskId },
  {
    _tag: "CompletionTaskFocusedReadReturned" as const,
    lifecycle: "Open" as const,
    taskId,
    unfinishedPrerequisiteTaskIds: []
  },
  targetPromotionGitReadReturned("/dalph/cassettes/pipeline.git", candidateCommit, {
    _tag: "CandidateCurrent" as const,
    currentHeadSha: candidateCommit
  }),
  { _tag: "CompletionTaskRequestReturned" as const, outcome: "Acknowledged" as const, taskId },
  {
    _tag: "CompletionTaskFocusedReadReturned" as const,
    lifecycle: "CompletedSuccessfully" as const,
    taskId,
    unfinishedPrerequisiteTaskIds: []
  },
  { _tag: "CompletionClaimReadReturned" as const, claim: "Completion" as const, taskId },
  { _tag: "CompletionClaimDeletionApplied" as const, taskId }
]

/** The maintained dependency story proving one Run consumes a later complete graph observation. */
export const dependentTasksCompleteInOneRunAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "a later recorded tracker observation releases the dependant in the same run",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [
      { body: "Complete task A.", taskId: "A", title: "Complete A" },
      { body: "Complete task B after A.", taskId: "B", title: "Complete B" }
    ],
    trackerGraph: blockedPipelineGraph,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
    {
      _tag: "RunCoordinator",
      baseSha: "2222222222222222222222222222222222222222",
      claimOwner: "pipeline-cassette-owner",
      claimTokenPrefix: "pipeline-cassette-claim",
      executor: "executor:cassette",
      integrationTarget: { repository: "/dalph/cassettes/pipeline.git", ref: "refs/heads/master" },
      target: "pipeline-cassette-target",
      verificationPlanId: "acceptance-verification",
      worktreeRoot: "/dalph/cassettes/pipeline"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: blockedPipelineGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: blockedPipelineGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: blockedPipelineGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    { _tag: "TaskWorkSpecificationReadReturned", body: "Complete task A.", taskId: "A", title: "Complete A" },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    pipelineAcceptedReport("attempt:A:0", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ...pipelineGraphRead(blockedPipelineGraph),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...pipelineIntegrationFinality(
      "A",
      "attempt:A:0",
      blockedPipelineGraph,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "cccccccccccccccccccccccccccccccccccccccc"
    ),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: releasedPipelineGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: releasedPipelineGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: releasedPipelineGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" } },
    { _tag: "TaskWorkSpecificationReadReturned", body: "Complete task B after A.", taskId: "B", title: "Complete B" },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:B:0", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:B:0", taskId: "B" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:B:0" },
      request: "StartOrContinue"
    },
    pipelineAcceptedReport("attempt:B:0", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ...pipelineGraphRead(releasedPipelineGraph),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...pipelineIntegrationFinality(
      "B",
      "attempt:B:0",
      releasedPipelineGraph,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "dddddddddddddddddddddddddddddddddddddddd"
    ),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...pipelineGraphRead(completedPipelineGraph),
    ...pipelineGraphRead(completedPipelineGraph),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: [
          { _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "A" },
          { _tag: "PlannedWorkForTaskAccepted", commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", taskId: "B" }
        ]
      }
    }
  ]
})

/**
 * A capacity contraction retains two already-running attempts across process
 * death and admits C only after both exact responsibilities settle.
 */
export const contractedCapacityRetainsTwoAttemptsAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "capacity contraction retains A and B across process death before C starts",
  startingFacts: {
    ...singletonTaskCompletesAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      ...singletonTaskCompletesAuthoredCassette.startingFacts.taskWorkSpecifications,
      { body: "Implement the second eligible behavior.", taskId: "B", title: "Implement second task" },
      { body: "Implement the third eligible behavior.", taskId: "C", title: "Implement third task" }
    ],
    trackerGraph: twoEligibleTasksGraph
  },
  story: [
    ...twoEligiblePlannedStoryBeforeRunningExecutorReport.map((item) =>
      item._tag === "InitialControlPolicy" ? { ...item, policy: { taskExecutionCapacity: 2 } } : item
    ),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:B:1" },
      request: "StartOrContinue"
    },
    { _tag: "SetTaskExecutionCapacity", capacity: 1 },
    { _tag: "CoordinatorProcessDies" },
    ...taskControlMembershipRead(threeEligibleTasksGraph),
    ...taskControlMembershipRead(threeEligibleTasksGraph),
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the second eligible behavior.",
      taskId: "B",
      title: "Implement second task"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the second eligible behavior.",
      taskId: "B",
      title: "Implement second task"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "B" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "B" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:B:1", taskId: "B" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:B:1", taskId: "B" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:B:1", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    ...taskControlMembershipRead(threeEligibleTasksGraph),
    ...taskControlMembershipRead(threeEligibleTasksGraph),
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "C" } },
    ...taskControlMembershipRead(threeEligibleTasksGraph),
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "C" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the third eligible behavior.",
      taskId: "C",
      title: "Implement third task"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:C:0", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:C:0", taskId: "C" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:C:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: [
          { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
          { _tag: "PlannedWorkForTaskCompleted", taskId: "B" },
          { _tag: "PlannedWorkForTaskCompleted", taskId: "C" }
        ]
      }
    }
  ]
})

/** Accepted executor output remains ordered by journal position and starts integration in the next activation. */
export const acceptedResultRestartsIntoIntegrationAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "an accepted result starts its exact integration responsibility after coordinator restart",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [{ body: "Produce an accepted commit.", taskId: "A", title: "Produce accepted result" }],
    trackerGraph: singletonGraph,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      claimOwner: "integration-cassette-owner",
      claimTokenPrefix: "integration-cassette-claim",
      executor: "executor:cassette",
      integrationTarget: { repository: "/dalph/cassettes/integration.git", ref: "refs/heads/master" },
      target: "cassette-target",
      verificationPlanId: null,
      worktreeRoot: "/dalph/cassettes/integration"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Produce an accepted commit.",
      taskId: "A",
      title: "Produce accepted result"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: {
        _tag: "Terminal",
        attemptId: "attempt:A:0",
        result: { _tag: "Accepted", acceptedResult: { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
      },
      request: "StartOrContinue"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: acceptedResultBlockedGraph },
    {
      _tag: "ExpectedBehavior",
      orchestration: [
        { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalAccepted" },
        {
          _tag: "AcceptedResultIntegrationResponsibilityBegan",
          attemptId: "attempt:A:0",
          commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          integrationTarget: { repository: "/dalph/cassettes/integration.git", ref: "refs/heads/master" },
          taskId: "A"
        },
        {
          _tag: "AcceptedResultIntegrationStarted",
          attemptId: "attempt:A:0",
          commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          integrationTarget: { repository: "/dalph/cassettes/integration.git", ref: "refs/heads/master" },
          taskId: "A"
        }
      ],
      protocol: null,
      taskWork: {
        absences: [],
        results: [
          { _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "A" }
        ]
      }
    }
  ]
})

/** Alice cannot apply a stale pre-integration direction after integration has consumed the exact attempt. */
export const postIntegrationAttemptChoiceRejectedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...acceptedResultRestartsIntoIntegrationAuthoredCassette,
  name: "Alice's stale Continue and Stop directions cannot cross the exact integration cutoff",
  story: [
    ...acceptedResultRestartsIntoIntegrationAuthoredCassette.story.slice(0, terminalStoryItemOffset),
    {
      _tag: "OperatorContinuesAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Rejected", reason: "OutsidePreIntegrationPhase" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "continue-after-integration-cutoff-A",
      taskId: "A"
    },
    {
      _tag: "OperatorStopsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Rejected", reason: "OutsidePreIntegrationPhase" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "stop-after-integration-cutoff-A",
      taskId: "A"
    },
    acceptedResultRestartsIntoIntegrationAuthoredCassette.story.at(terminalStoryItemOffset)
  ]
})

/** Integration start removes Restart capability before any executor, tracker, Git, cleanup, or disposition call. */
export const changedAttemptRestartPastIntegrationRejectedAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...acceptedResultRestartsIntoIntegrationAuthoredCassette,
  name: "Alice's Restart request is rejected after the exact integration cutoff",
  story: [
    ...acceptedResultRestartsIntoIntegrationAuthoredCassette.story.slice(0, terminalStoryItemOffset),
    {
      _tag: "OperatorRestartsAttempt",
      attemptId: "attempt:A:0",
      expected: { _tag: "Rejected", reason: "OutsidePreIntegrationPhase" },
      observedTaskRevision: changedAttemptRevision,
      requestNonce: "restart-after-integration-cutoff-A",
      taskId: "A"
    },
    acceptedResultRestartsIntoIntegrationAuthoredCassette.story.at(terminalStoryItemOffset)
  ]
})

type CandidateVerificationResult = {
  readonly _tag: "CorrelationContradiction" | "Passed" | "Failed" | "Killed" | "Partial" | "TimedOut"
  readonly artifacts?: ReadonlyArray<unknown>
}

const candidateScenarioRunCoordinatorFrom = (
  item: Extract<AuthoredCassetteStoryItem, { readonly _tag: "RunCoordinator" }>,
  verificationResult: CandidateVerificationResult | undefined
): ReadonlyArray<unknown> => [
  { ...item, verificationPlanId: verificationResult === undefined ? item.verificationPlanId : "public-checks-v1" }
]

const candidateConstructedEvidenceFrom = (constructedCommit: string | undefined): ReadonlyArray<unknown> =>
  constructedCommit === undefined
    ? []
    : [
        {
          _tag: "IntegrationCandidateConstructed",
          acceptedResultCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          attemptId: "attempt:A:0",
          candidateCommit: constructedCommit,
          expectedTargetHead: "1111111111111111111111111111111111111111",
          taskId: "A"
        }
      ]

const candidateVerificationStoryFrom = (verificationResult: CandidateVerificationResult | undefined) =>
  verificationResult === undefined ? [] : [{ _tag: "TargetVerificationReturned", result: verificationResult }]

const candidateVerificationEvidenceFrom = (
  constructedCommit: string | undefined,
  verificationResult: CandidateVerificationResult | undefined
): ReadonlyArray<unknown> => {
  if (verificationResult === undefined || verificationResult._tag === "CorrelationContradiction") return []
  return [
    verificationResult._tag === "Passed"
      ? {
          _tag: "TargetVerificationPassed" as const,
          /* v8 ignore next -- @preserve A Passed verification cassette is constructed only after its candidate commit has been authored. */
          candidateCommit: constructedCommit ?? "",
          planId: "public-checks-v1",
          taskId: "A"
        }
      : {
          _tag: "TargetVerificationStopped" as const,
          /* v8 ignore next -- @preserve A stopped verification cassette is constructed only after its candidate commit has been authored. */
          candidateCommit: constructedCommit ?? "",
          outcome: verificationResult._tag,
          planId: "public-checks-v1",
          taskId: "A"
        }
  ]
}

const candidateScenarioExpectedBehaviorFrom = (
  item: Extract<AuthoredCassetteStoryItem, { readonly _tag: "ExpectedBehavior" }>,
  candidateStory: ReadonlyArray<unknown>,
  constructedCommit: string | undefined,
  verificationResult: CandidateVerificationResult | undefined
): ReadonlyArray<unknown> => [
  { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
  ...candidateStory,
  ...candidateVerificationStoryFrom(verificationResult),
  {
    ...item,
    /* v8 ignore next -- @preserve Maintained candidate cassettes all declare the orchestration assertion lens. */
    orchestration:
      item.orchestration === null
        ? null
        : [
            ...item.orchestration,
            ...candidateConstructedEvidenceFrom(constructedCommit),
            ...candidateVerificationEvidenceFrom(constructedCommit, verificationResult)
          ]
  }
]

const candidateScenarioStoryItemsFrom = (
  item: AuthoredCassetteStoryItem,
  candidateStory: ReadonlyArray<unknown>,
  constructedCommit: string | undefined,
  verificationResult: CandidateVerificationResult | undefined
): ReadonlyArray<unknown> => {
  if (item._tag === "RunCoordinator") return candidateScenarioRunCoordinatorFrom(item, verificationResult)
  if (item._tag === "TrackerGraphReadReturned" && item.graph.revision === acceptedResultBlockedGraph.revision) {
    return [{ ...item, graph: singletonGraph }]
  }
  if (item._tag !== "ExpectedBehavior") return [item]
  return candidateScenarioExpectedBehaviorFrom(item, candidateStory, constructedCommit, verificationResult)
}

const candidateScenarioFrom = (
  name: string,
  candidateStory: ReadonlyArray<unknown>,
  constructedCommit: string | undefined,
  verificationResult?: CandidateVerificationResult
) => {
  const baseStory = acceptedResultRestartsIntoIntegrationAuthoredCassette.story
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...acceptedResultRestartsIntoIntegrationAuthoredCassette,
    name,
    story: baseStory.flatMap((item) =>
      candidateScenarioStoryItemsFrom(item, candidateStory, constructedCommit, verificationResult)
    )
  })
}

const candidateReportForA = (report: unknown) => ({
  _tag: "IntegrationCandidateAgentReported" as const,
  attemptId: "attempt:A:0" as const,
  report
})

/** Conflict edits stay in one isolated candidate resource until an explicit exact submission. */
export const candidateConflictRecoveryAuthoredCassette: ScenarioCassette = candidateScenarioFrom(
  "candidate conflict recovery stays in one isolated integration resource",
  [
    candidateReportForA({ _tag: "Conflict" }),
    candidateReportForA({ _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      _tag: "Commit",
      directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    })
  ],
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

/** A task paused after a recoverable candidate conflict finishes the held integration boundary without cleanup. */
export const taskPauseFinishesHeldIntegrationAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...candidateConflictRecoveryAuthoredCassette,
  name: "Alice pauses task A after its integration target is held",
  story: candidateConflictRecoveryAuthoredCassette.story.flatMap((item) =>
    item._tag === "IntegrationCandidateAgentReported" && item.report._tag === "Conflict"
      ? [
          item,
          {
            _tag: "OperatorAppliesControlDirection" as const,
            direction: "Pause" as const,
            subject: { _tag: "Task" as const, taskId: "A" }
          },
          ...taskControlMembershipRead(singletonGraph)
        ]
      : [item]
  )
})

/** A definitive invalid submission is corrected, while unreadable Git causes a reread without another agent call. */
export const candidateCorrectionAfterUnreadableGitAuthoredCassette: ScenarioCassette = candidateScenarioFrom(
  "candidate correction rereads unreadable Git without charging the agent",
  [
    candidateReportForA({ _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      _tag: "Missing"
    }),
    candidateReportForA({ _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }),
    candidateGitValidationFailed(
      "/dalph/cassettes/integration.git",
      "cccccccccccccccccccccccccccccccccccccccc",
      "repository temporarily unreadable"
    ),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "cccccccccccccccccccccccccccccccccccccccc", {
      _tag: "Commit",
      directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    })
  ],
  "cccccccccccccccccccccccccccccccccccccccc",
  { _tag: "Passed", artifacts: [{ name: "verification-report", content: "all selected checks passed" }] }
)

/** A selected public verification plan reports failure and leaves the exact candidate unpromoted. */
export const candidateVerificationFailureAuthoredCassette: ScenarioCassette = candidateScenarioFrom(
  "selected public verification fails without promotion",
  [
    candidateReportForA({ _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      _tag: "Missing"
    }),
    candidateReportForA({ _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }),
    candidateGitValidationFailed(
      "/dalph/cassettes/integration.git",
      "cccccccccccccccccccccccccccccccccccccccc",
      "repository temporarily unreadable"
    ),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "cccccccccccccccccccccccccccccccccccccccc", {
      _tag: "Commit",
      directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    })
  ],
  "cccccccccccccccccccccccccccccccccccccccc",
  { _tag: "Failed", artifacts: [{ name: "verification-report", content: "one selected check failed" }] }
)

/** A foreign wrapper correlation is durably contradicted before any evidence can authorize M. */
export const candidateVerificationContradictionAuthoredCassette: ScenarioCassette = candidateScenarioFrom(
  "foreign public verification correlation fails closed",
  [
    candidateReportForA({ _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      _tag: "Missing"
    }),
    candidateReportForA({ _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }),
    candidateGitValidationFailed(
      "/dalph/cassettes/integration.git",
      "cccccccccccccccccccccccccccccccccccccccc",
      "repository temporarily unreadable"
    ),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "cccccccccccccccccccccccccccccccccccccccc", {
      _tag: "Commit",
      directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    })
  ],
  "cccccccccccccccccccccccccccccccccccccccc",
  { _tag: "CorrelationContradiction" }
)

const promotionCandidateCommit = "cccccccccccccccccccccccccccccccccccccccc"
const promotionExpectedHead = "1111111111111111111111111111111111111111"

const pauseExecutorAndPromotionG1 = {
  revision: "pause-executor-promotion-G1",
  tasks: [
    { id: "P", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["P"] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["A"] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
  ]
} as const

const pauseExecutorAndPromotionG0 = {
  revision: "pause-executor-promotion-G0",
  tasks: [{ id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
} as const

const pauseExecutorAndPromotionRequestD = {
  acceptanceManifest: { byteLength: 273, digest: "1111111111111111111111111111111111111111111111111111111111111111" },
  candidateCommit: promotionCandidateCommit,
  candidateConstructedAt: 31,
  candidateCorrelation: {
    acceptanceManifest: { byteLength: 273, digest: "1111111111111111111111111111111111111111111111111111111111111111" },
    acceptedResultCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    attemptId: "attempt:D:0",
    candidateId: "integration-candidate:$authored-run:attempt:D:0:23",
    candidateResource: "integration-candidate-resource:integration-candidate:$authored-run:attempt:D:0:23",
    expectedTargetHead: promotionExpectedHead,
    integrationSessionId: "integration-session:$authored-run:attempt:D:0:23",
    integrationTarget: { repository: "/dalph/cassettes/pause-boundaries.git", ref: "refs/heads/master" },
    runId: "$authored-run"
  },
  expectedTargetHead: promotionExpectedHead,
  integrationTarget: { repository: "/dalph/cassettes/pause-boundaries.git", ref: "refs/heads/master" },
  reviewManifest: { byteLength: 1250, digest: "2222222222222222222222222222222222222222222222222222222222222222" },
  requestId: "target-promotion:integration-candidate:$authored-run:attempt:D:0:23",
  verificationCorrelation: {
    candidateCommit: promotionCandidateCommit,
    candidateCorrelation: {
      acceptanceManifest: {
        byteLength: 273,
        digest: "1111111111111111111111111111111111111111111111111111111111111111"
      },
      acceptedResultCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      attemptId: "attempt:D:0",
      candidateId: "integration-candidate:$authored-run:attempt:D:0:23",
      candidateResource: "integration-candidate-resource:integration-candidate:$authored-run:attempt:D:0:23",
      expectedTargetHead: promotionExpectedHead,
      integrationSessionId: "integration-session:$authored-run:attempt:D:0:23",
      integrationTarget: { repository: "/dalph/cassettes/pause-boundaries.git", ref: "refs/heads/master" },
      runId: "$authored-run"
    },
    candidateConstructedAt: 31,
    planId: "public-checks-v1",
    requestId: "target-verification:integration-candidate:$authored-run:attempt:D:0:23",
    reviewManifest: { byteLength: 1250, digest: "2222222222222222222222222222222222222222222222222222222222222222" }
  },
  verificationManifest: { byteLength: 1777, digest: "3333333333333333333333333333333333333333333333333333333333333333" }
} as const

const pauseExecutorAndPromotionSuspendA = {
  _tag: "IdentityFreeWorkflowRoute",
  correlation: { _tag: "PlannedAttempt", attemptId: "attempt:A:0" },
  proposalId: '["IdentityFreeWorkflowRoute","SuspendPlannedAttemptExecutorWork","attempt:A:0",null,"A"]',
  taskId: "A"
} as const

const pauseExecutorAndPromotionContinueA = {
  _tag: "FreshExecutorWorkflowRoute",
  attemptId: "attempt:A:0",
  proposalId: '["FreshExecutorWorkflowRoute","ContinuePlannedAttemptExecutorWork","attempt:A:0","A"]',
  taskId: "A"
} as const

const pauseExecutorAndPromotionRunD = {
  _tag: "IdentityFreeWorkflowRoute",
  correlation: {
    _tag: "TargetPromotion",
    attemptId: "attempt:D:0",
    queuedAt: 22,
    request: pauseExecutorAndPromotionRequestD
  },
  proposalId: '["IdentityFreeWorkflowRoute","RunTargetPromotion",null,22,"D"]',
  taskId: "D"
} as const

const pauseExecutorResponsibilityA = {
  _tag: "PlannedAttemptExecutorWork",
  attemptId: "attempt:A:0",
  beganAt: 66,
  coverage: { _tag: "ExactTaskPauseCoverage" },
  taskId: "A"
} as const

const pausePromotionResponsibilityD = {
  _tag: "StartedIntegration",
  attemptId: "attempt:D:0",
  coverage: { _tag: "GroupingDescendantPauseCoverage", groupingObservedAt: 73, pausedTaskId: "A" },
  queuedAt: 22,
  startedAt: 23,
  taskId: "D"
} as const

const pauseExecutorSafeA = { _tag: "ExecutorSafeSuspensionRequired", attemptId: "attempt:A:0" } as const
const pauseContinueLiveA = {
  _tag: "LiveDeliveryAction",
  owner: { _tag: "AdmittedDeliveryAction", proposal: pauseExecutorAndPromotionContinueA }
} as const
const pauseContinuePendingA = {
  _tag: "AcceptedOutcomePublicationPending",
  proposal: pauseExecutorAndPromotionContinueA
} as const
const pauseSuspendProposedA = { _tag: "ProposedDeliveryAction", proposal: pauseExecutorAndPromotionSuspendA } as const
const pauseSuspendLiveA = {
  _tag: "LiveDeliveryAction",
  owner: { _tag: "AdmittedDeliveryAction", proposal: pauseExecutorAndPromotionSuspendA }
} as const
const pauseSuspendPendingA = {
  _tag: "AcceptedOutcomePublicationPending",
  proposal: pauseExecutorAndPromotionSuspendA
} as const
const pausePromotionRequiredD = {
  _tag: "TargetPromotionResultRequired",
  request: pauseExecutorAndPromotionRequestD
} as const
const pausePromotionHeldD = { _tag: "HeldIntegrationTarget", queuedAt: 22 } as const
const pausePromotionActiveD = { _tag: "ActiveIntegrationTarget", queuedAt: 22 } as const
const pausePromotionLiveD = {
  _tag: "LiveDeliveryAction",
  owner: { _tag: "AdmittedDeliveryAction", proposal: pauseExecutorAndPromotionRunD }
} as const
const pausePromotionPendingD = {
  _tag: "AcceptedOutcomePublicationPending",
  proposal: pauseExecutorAndPromotionRunD
} as const

const pauseExecutorAndPromotionWaiting = (
  executorBlockers: ReadonlyArray<unknown>,
  promotionBlockers: ReadonlyArray<unknown>
) => ({
  _tag: "PauseProgressObserved" as const,
  result: {
    _tag: "PauseWaiting" as const,
    atBoundary: [],
    preventing: [
      { blockers: executorBlockers, responsibility: pauseExecutorResponsibilityA },
      { blockers: promotionBlockers, responsibility: pausePromotionResponsibilityD }
    ]
  },
  subject: { _tag: "Task" as const, taskId: "A" }
})

const pauseExecutorAtBoundaryAndPromotionWaiting = (promotionBlockers: ReadonlyArray<unknown>) => ({
  _tag: "PauseProgressObserved" as const,
  result: {
    _tag: "PauseWaiting" as const,
    atBoundary: [pauseExecutorResponsibilityA],
    preventing: [{ blockers: promotionBlockers, responsibility: pausePromotionResponsibilityD }]
  },
  subject: { _tag: "Task" as const, taskId: "A" }
})

const targetPromotionSuccessTailForD = [
  { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:D:0", taskId: "D" } },
  {
    _tag: "IntegrationCandidateAgentReported",
    attemptId: "attempt:D:0",
    report: { _tag: "Submitted", candidateCommit: promotionCandidateCommit }
  },
  candidateGitValidationReturned("/dalph/cassettes/pause-boundaries.git", promotionCandidateCommit, {
    _tag: "Commit",
    directParents: [promotionExpectedHead, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
  }),
  {
    _tag: "TargetVerificationReturned",
    result: { _tag: "Passed", artifacts: [{ name: "verification-report", content: "all selected checks passed" }] }
  },
  targetPromotionGitReadReturned("/dalph/cassettes/pause-boundaries.git", promotionCandidateCommit, {
    _tag: "CandidateNotInAncestry",
    currentHeadSha: promotionExpectedHead
  }),
  { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "Git may have applied MD before its response was lost" }
] as const

/** Alice observes A's executor and grouping child D's promotion reach their exact Pause boundaries. */
export const taskPauseExecutorAndPromotionBoundariesAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "Alice sees task A and grouping child D reach their exact Pause boundaries",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [
      { body: "Complete prerequisite P.", taskId: "P", title: "Complete prerequisite" },
      { body: "Keep executor A running.", taskId: "A", title: "Run A" },
      { body: "Wait for A.", taskId: "B", title: "Blocked dependant" },
      { body: "Keep independent C running.", taskId: "C", title: "Run C" },
      { body: "Produce D's accepted commit.", taskId: "D", title: "Integrate D" }
    ],
    trackerGraph: pauseExecutorAndPromotionG0,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 4 } },
    {
      _tag: "RunCoordinator",
      baseSha: promotionExpectedHead,
      claimOwner: "pause-boundaries-owner",
      claimTokenPrefix: "pause-boundaries-claim",
      executor: "executor:cassette",
      integrationTarget: { repository: "/dalph/cassettes/pause-boundaries.git", ref: "refs/heads/master" },
      target: "cassette-target",
      verificationPlanId: "public-checks-v1",
      worktreeRoot: "/dalph/cassettes/pause-boundaries"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG0 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG0 },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG0 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "D" } },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Produce D's accepted commit.",
      taskId: "D",
      title: "Integrate D"
    },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:D:0", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:D:0", taskId: "D" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: {
        _tag: "Terminal",
        attemptId: "attempt:D:0",
        result: { _tag: "Accepted", acceptedResult: { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
      },
      request: "StartOrContinue"
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG0 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG0 },
    ...targetPromotionSuccessTailForD,
    { _tag: "CassetteKillsCoordinatorAtTargetPromotionReconciliationRead", request: pauseExecutorAndPromotionRequestD },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "OperatorAppliesControlDirection", direction: "Pause", subject: { _tag: "Task", taskId: "X" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    {
      _tag: "OperatorControlDirectionFailed",
      direction: "Pause",
      reason: "OutsideCurrentTargetClosure",
      subject: { _tag: "Task", taskId: "X" }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:D:0", taskId: "D" } },
    {
      _tag: "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary",
      request: pauseExecutorAndPromotionRequestD
    },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
    { _tag: "TaskWorkSpecificationReadReturned", body: "Keep executor A running.", taskId: "A", title: "Run A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "C" } },
    { _tag: "TaskWorkSpecificationReadReturned", body: "Keep independent C running.", taskId: "C", title: "Run C" },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:C:1", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:C:1", taskId: "C" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:C:1" },
      request: "StartOrContinue"
    },
    {
      _tag: "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
      direction: "Pause",
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(pauseExecutorAndPromotionG1),
    { _tag: "OperatorStartsPauseObservation", subject: { _tag: "Task", taskId: "A" } },
    { _tag: "CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary", attemptId: "attempt:C:1", taskId: "C" },
    { _tag: "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary", attemptId: "attempt:A:0", taskId: "A" },
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseSuspendProposedA, pauseContinueLiveA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionActiveD, pausePromotionLiveD]
    ),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseContinueLiveA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionActiveD, pausePromotionLiveD]
    ),
    { _tag: "CassetteReleasesHeldPlannedAttemptSuspension", attemptId: "attempt:A:0", taskId: "A" },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseContinuePendingA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionActiveD, pausePromotionLiveD]
    ),
    { _tag: "CassetteReleasesHeldTargetPromotionReconciliationRead", request: pauseExecutorAndPromotionRequestD },
    targetPromotionGitReadReturned("/dalph/cassettes/pause-boundaries.git", promotionCandidateCommit, {
      _tag: "CandidateCurrent",
      currentHeadSha: promotionCandidateCommit
    }),
    { _tag: "CassetteReleasesHeldPlannedAttemptContinuation", attemptId: "attempt:C:1", taskId: "C" },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:C:1", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionActiveD, pausePromotionLiveD]
    ),
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseSuspendProposedA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionActiveD, pausePromotionLiveD]
    ),
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseSuspendLiveA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionActiveD, pausePromotionLiveD]
    ),
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseSuspendLiveA],
      [pausePromotionRequiredD, pausePromotionHeldD, pausePromotionLiveD]
    ),
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseSuspendLiveA],
      [pausePromotionRequiredD, pausePromotionLiveD]
    ),
    pauseExecutorAndPromotionWaiting(
      [pauseExecutorSafeA, pauseSuspendPendingA],
      [pausePromotionRequiredD, pausePromotionLiveD]
    ),
    pauseExecutorAndPromotionWaiting([pauseExecutorSafeA], [pausePromotionRequiredD, pausePromotionLiveD]),
    pauseExecutorAndPromotionWaiting([pauseExecutorSafeA], [pausePromotionRequiredD, pausePromotionPendingD]),
    pauseExecutorAtBoundaryAndPromotionWaiting([
      pausePromotionRequiredD,
      pausePromotionHeldD,
      pausePromotionActiveD,
      pausePromotionLiveD
    ]),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "PauseProgressObserved",
      result: { _tag: "PauseConfirmed", atBoundary: [pauseExecutorResponsibilityA, pausePromotionResponsibilityD] },
      subject: { _tag: "Task", taskId: "A" }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: pauseExecutorAndPromotionG1 },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: [
          { _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "D" },
          { _tag: "PlannedWorkForTaskCompleted", taskId: "C" }
        ]
      }
    }
  ]
})

const promotionScenarioFrom = (name: string, promotionStory: ReadonlyArray<unknown>, promotionEvidence: unknown) =>
  Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...candidateCorrectionAfterUnreadableGitAuthoredCassette,
    name,
    story: candidateCorrectionAfterUnreadableGitAuthoredCassette.story.flatMap((item) =>
      item._tag !== "ExpectedBehavior"
        ? [item]
        : [
            ...promotionStory,
            {
              ...item,
              /* v8 ignore next -- @preserve Promotion scenarios extend the maintained candidate cassette, whose assertion lens is non-null by construction. */
              orchestration: item.orchestration === null ? null : [...item.orchestration, promotionEvidence]
            }
          ]
    )
  })

/** Git accepts the one exact H -> M update after the verified candidate is sealed. */
export const targetPromotionSuccessAuthoredCassette: ScenarioCassette = promotionScenarioFrom(
  "promotes verified M by exact compare-and-set and records exact ancestry",
  [
    targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
      _tag: "CandidateNotInAncestry",
      currentHeadSha: promotionExpectedHead
    }),
    { _tag: "TargetPromotionCompareAndSetReturned", result: { _tag: "Applied" } }
  ],
  {
    _tag: "TargetPromotionSucceeded",
    basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
    candidateCommit: promotionCandidateCommit,
    expectedTargetHead: promotionExpectedHead,
    observedTargetHead: promotionCandidateCommit,
    observation: "CompareAndSetApplied",
    taskId: "A"
  }
)

const issue138PrePromotionBlockerGraph = {
  revision: "issue-138-pre-promotion-blocker",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["B"] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
} as const

const issue138PrePromotionClearedGraph = {
  revision: "issue-138-pre-promotion-edge-removed",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
  ]
} as const

const issue138PrePromotionRecoveryGraph = {
  revision: "issue-138-pre-promotion-blocker-recovery",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["B"] },
    { id: "B", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
  ]
} as const

const issue138PostPromotionBlockerGraph = {
  revision: "issue-138-post-promotion-blocker",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["B"] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
} as const

/** A complete new blocker read preserves the verified candidate before promotion. */
export const prePromotionBlockerAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)(
  {
    ...candidateCorrectionAfterUnreadableGitAuthoredCassette,
    name: "a new prerequisite preserves the verified candidate before promotion",
    story: candidateCorrectionAfterUnreadableGitAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
      if (item._tag === "TargetVerificationReturned") {
        return [
          item,
          {
            _tag: "CoordinatorActivationReturned",
            decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
          }
        ]
      }
      return item._tag !== "ExpectedBehavior"
        ? [item]
        : [
            { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
            { _tag: "TrackerGraphReadReturned", graph: issue138PrePromotionBlockerGraph },
            item
          ]
    })
  }
)

/** The blocker clears, H advances to H2, and one compatible successor is recorded before promotion. */
export const prePromotionBlockerClearAndSupersessionAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...prePromotionBlockerAuthoredCassette,
  name: "clears a pre-promotion blocker and supersedes H with one compatible H2 candidate",
  startingFacts: {
    ...prePromotionBlockerAuthoredCassette.startingFacts,
    targetLineageObservations: [
      {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: "1111111111111111111111111111111111111111",
        targetHeadSha: "1111111111111111111111111111111111111111"
      },
      {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: "1111111111111111111111111111111111111111",
        targetHeadSha: "2222222222222222222222222222222222222222"
      }
    ]
  },
  story: prePromotionBlockerAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
    if (item._tag === "TrackerGraphReadReturned" && item.graph.revision === issue138PrePromotionBlockerGraph.revision) {
      return [
        item,
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        { _tag: "TaskClaimCurrentReadReturned", taskId: "A" }
      ]
    }
    if (item._tag !== "ExpectedBehavior") return [item]
    return [
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: issue138PrePromotionClearedGraph },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: issue138PrePromotionClearedGraph },
      { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
      {
        _tag: "IntegrationCandidateAgentReported",
        attemptId: "attempt:A:0",
        report: { _tag: "Submitted", candidateCommit: "dddddddddddddddddddddddddddddddddddddddd" }
      },
      {
        _tag: "IntegrationCandidateGitValidationReturned",
        candidateCommit: "dddddddddddddddddddddddddddddddddddddddd",
        observation: {
          _tag: "Commit",
          directParents: ["2222222222222222222222222222222222222222", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
        },
        repository: "/dalph/cassettes/integration.git"
      },
      {
        _tag: "TargetVerificationReturned",
        result: { _tag: "Passed", artifacts: [{ name: "verification-report", content: "all selected checks passed" }] }
      },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: issue138PrePromotionClearedGraph },
      item.orchestration === null
        ? item
        : {
            ...item,
            orchestration: [
              ...item.orchestration,
              {
                _tag: "IntegrationCandidateConstructed",
                acceptedResultCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                attemptId: "attempt:A:0",
                candidateCommit: "dddddddddddddddddddddddddddddddddddddddd",
                expectedTargetHead: "2222222222222222222222222222222222222222",
                taskId: "A"
              },
              {
                _tag: "TargetVerificationPassed",
                candidateCommit: "dddddddddddddddddddddddddddddddddddddddd",
                planId: "public-checks-v1",
                taskId: "A"
              }
            ]
          }
    ]
  })
})

/** The complete blocker fact is durable before a crash; restart owns no target resource. */
export const prePromotionBlockerRecoveryAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...prePromotionBlockerAuthoredCassette,
  name: "a pre-promotion blocker survives a crash with empty target ownership",
  story: prePromotionBlockerAuthoredCassette.story.flatMap(
    (item): ReadonlyArray<unknown> =>
      item._tag === "TrackerGraphReadReturned" && item.graph.revision === issue138PrePromotionBlockerGraph.revision
        ? [
            item,
            { _tag: "CoordinatorProcessDies" as const },
            {
              _tag: "DalphSelects" as const,
              operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" as const }
            },
            { _tag: "TrackerGraphReadReturned" as const, graph: issue138PrePromotionRecoveryGraph },
            { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId: "A" as const } },
            { _tag: "TaskClaimCurrentReadReturned" as const, taskId: "A" as const },
            {
              _tag: "DalphSelects" as const,
              operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" as const }
            },
            { _tag: "TrackerGraphReadReturned" as const, graph: issue138PrePromotionRecoveryGraph },
            {
              _tag: "CoordinatorActivationReturned" as const,
              decision: { _tag: "RunMustRemainActive" as const, reason: "UnsettledResponsibility" as const }
            }
          ]
        : [item]
  )
})

/** A complete blocker survives one crash; an unreadable restart read is durable and a later complete read resumes the queued candidate. */
export const prePromotionBlockerUnreadableReadRecoveryAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...prePromotionBlockerAuthoredCassette,
  name: "an unreadable post-blocker read waits with empty target ownership before a later complete recovery read",
  story: prePromotionBlockerAuthoredCassette.story.flatMap(
    (item): ReadonlyArray<unknown> =>
      item._tag === "TrackerGraphReadReturned" && item.graph.revision === issue138PrePromotionBlockerGraph.revision
        ? [
            item,
            { _tag: "CoordinatorProcessDies" as const },
            {
              _tag: "DalphSelects" as const,
              operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" as const }
            },
            { _tag: "TrackerGraphReadFailed" as const, reason: "IncompleteSnapshot" as const },
            { _tag: "CoordinatorProcessDies" as const },
            {
              _tag: "DalphSelects" as const,
              operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" as const }
            },
            { _tag: "TrackerGraphReadReturned" as const, graph: issue138PrePromotionRecoveryGraph },
            { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId: "A" as const } },
            { _tag: "TaskClaimCurrentReadReturned" as const, taskId: "A" as const },
            {
              _tag: "DalphSelects" as const,
              operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" as const }
            },
            { _tag: "TrackerGraphReadReturned" as const, graph: issue138PrePromotionRecoveryGraph },
            {
              _tag: "CoordinatorActivationReturned" as const,
              decision: { _tag: "RunMustRemainActive" as const, reason: "UnsettledResponsibility" as const }
            }
          ]
        : [item]
  )
})

/** A post-promotion blocker preserves M and its promotion proof while A waits. */
export const blockersAroundPromotionAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...targetPromotionSuccessAuthoredCassette,
  name: "a post-promotion prerequisite preserves M while tracker completion waits",
  story: targetPromotionSuccessAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
    if (item._tag === "TargetPromotionCompareAndSetReturned") {
      return [
        item,
        {
          _tag: "CoordinatorActivationReturned",
          decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
        }
      ]
    }
    return item._tag !== "ExpectedBehavior"
      ? [item]
      : [
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
          { _tag: "TrackerGraphReadReturned", graph: issue138PostPromotionBlockerGraph },
          item
        ]
  })
})

const deliveryFinalityStartingGraph = {
  revision: "delivery-story-G0",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    ...["B", "C", "D", "E"].map((id) => ({
      id,
      lifecycle: { _tag: "Open" as const },
      parentTaskId: null,
      prerequisiteIds: ["A"]
    }))
  ]
} as const

const deliveryFinalityExpandedGraph = {
  revision: "delivery-story-G5",
  tasks: [
    ...deliveryFinalityStartingGraph.tasks,
    ...["F", "G"].map((id) => ({
      id,
      lifecycle: { _tag: "Open" as const },
      parentTaskId: null,
      prerequisiteIds: ["A"]
    }))
  ]
} as const

const deliveryFinalityReleasedGraph = {
  revision: "delivery-story-G6",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: { _tag: task.id === "B" ? ("Open" as const) : ("CompletedSuccessfully" as const) }
  }))
} as const

const deliveryFinalityPrerequisiteCompleteGraph = {
  revision: "delivery-story-prerequisite-complete",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: { _tag: task.id === "B" ? ("CompletedSuccessfully" as const) : ("Open" as const) },
    prerequisiteIds: task.id === "A" ? (["B"] as const) : task.id === "B" ? ([] as const) : task.prerequisiteIds
  }))
} as const

const deliveryFinalityPrerequisiteStartingGraph = {
  revision: "delivery-story-prerequisite-start",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: task.id === "B" ? { _tag: "CompletedSuccessfully" as const } : task.lifecycle,
    prerequisiteIds: task.id === "A" ? (["B"] as const) : task.id === "B" ? ([] as const) : task.prerequisiteIds
  }))
} as const

const deliveryFinalityPrerequisiteReopenedGraph = {
  revision: "delivery-story-prerequisite-reopened",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: { _tag: "Open" as const },
    prerequisiteIds: task.id === "A" ? (["B"] as const) : task.id === "B" ? ([] as const) : task.prerequisiteIds
  }))
} as const

const deliveryFinalityPrerequisiteACompleteGraph = {
  revision: "delivery-story-G6",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: { _tag: task.id === "B" ? ("Open" as const) : ("CompletedSuccessfully" as const) },
    prerequisiteIds: task.id === "A" ? (["B"] as const) : task.id === "B" ? ([] as const) : task.prerequisiteIds
  }))
} as const

const deliveryFinalityPrerequisiteCompletedGraph = {
  revision: "delivery-story-prerequisite-completed",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: { _tag: "CompletedSuccessfully" as const },
    prerequisiteIds: task.id === "A" ? (["B"] as const) : task.id === "B" ? ([] as const) : task.prerequisiteIds
  }))
} as const

const deliveryFinalityAdditionalPrerequisiteGraph = {
  revision: "delivery-story-G7",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => ({
    ...task,
    lifecycle: {
      _tag:
        task.id === "B"
          ? ("Open" as const)
          : task.id === "D"
            ? ("TerminalWithoutSuccess" as const)
            : ("CompletedSuccessfully" as const)
    },
    prerequisiteIds: task.id === "B" ? (["A", "D"] as const) : task.prerequisiteIds
  }))
} as const

const deliveryFinalityAdditionalPrerequisiteSatisfiedGraph = {
  revision: "delivery-story-G8",
  tasks: deliveryFinalityAdditionalPrerequisiteGraph.tasks.map((task) => ({
    ...task,
    lifecycle: { _tag: task.id === "B" ? ("Open" as const) : ("CompletedSuccessfully" as const) }
  }))
} as const

const deliveryFinalityBase = (() => {
  let recovered = false
  return targetPromotionSuccessAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
    if (item._tag === "CoordinatorProcessDies") recovered = true
    if (item._tag === "TrackerGraphReadReturned") {
      return [{ ...item, graph: recovered ? deliveryFinalityExpandedGraph : deliveryFinalityStartingGraph }]
    }
    if (item._tag !== "ExpectedBehavior") return [item]
    return [
      { _tag: "CompletionClaimReadReturned", claim: "Active", taskId: "A" },
      { _tag: "CompletionClaimReplacementApplied", taskId: "A" },
      { _tag: "CompletionTaskFocusedReadReturned", lifecycle: "Open", taskId: "A", unfinishedPrerequisiteTaskIds: [] },
      targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
        _tag: "CandidateCurrent",
        currentHeadSha: promotionCandidateCommit
      }),
      { _tag: "CompletionTaskRequestReturned", outcome: "Acknowledged", taskId: "A" },
      {
        _tag: "CompletionTaskFocusedReadReturned",
        lifecycle: "CompletedSuccessfully",
        taskId: "A",
        unfinishedPrerequisiteTaskIds: []
      },
      { _tag: "CompletionClaimReadReturned", claim: "Completion", taskId: "A" },
      { _tag: "CompletionClaimDeletionApplied", taskId: "A" },
      {
        _tag: "CoordinatorActivationReturned",
        decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
      },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: deliveryFinalityReleasedGraph },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: deliveryFinalityReleasedGraph },
      { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "B" } },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: deliveryFinalityReleasedGraph },
      { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" } },
      {
        _tag: "TaskWorkSpecificationReadReturned",
        body: "Implement the released dependant.",
        taskId: "B",
        title: "Implement released dependant"
      },
      { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:B:0", taskId: "B" } },
      { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:B:0", taskId: "B" } },
      {
        _tag: "PlannedAttemptExecutorWorkReported",
        report: { _tag: "Running", attemptId: "attempt:B:0" },
        request: "StartOrContinue"
      },
      {
        _tag: "PlannedAttemptExecutorWorkReported",
        report: { _tag: "Terminal", attemptId: "attempt:B:0", result: { _tag: "Completed" } },
        request: "StartOrContinue"
      },
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: deliveryFinalityReleasedGraph },
      {
        ...item,
        orchestration:
          item.orchestration === null
            ? null
            : [
                ...item.orchestration,
                { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:B:0", taskId: "B" },
                { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:B:0", report: "Running" },
                { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:B:0", report: "TerminalCompleted" }
              ],
        taskWork: {
          ...item.taskWork,
          results: [...item.taskWork.results, { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }]
        }
      }
    ]
  })
})()

/**
 * The executable spine linked from docs/DELIVERY-STORY.md. It exercises the
 * ordinary delivery runtime from a five-task graph through restart, a
 * seven-task graph, A's promotion, and A's exact completion-finality
 * settlement. The later tracker snapshot reports A complete and B open, so
 * the production delivery relation makes B eligible without claiming that
 * Dalph has already executed B or fabricating whole-Run termination.
 */
export const deliveryFinalitySpineAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...targetPromotionSuccessAuthoredCassette,
  name: "real A-finality spine (partial delivery-invariant story): five-to-seven task graph across restart",
  startingFacts: {
    ...targetPromotionSuccessAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      ...targetPromotionSuccessAuthoredCassette.startingFacts.taskWorkSpecifications,
      { body: "Implement the released dependant.", taskId: "B", title: "Implement released dependant" }
    ],
    trackerGraph: deliveryFinalityStartingGraph
  },
  story: deliveryFinalityBase
})

const isCompletedPrerequisiteAttempt = (item: DeliveryFinalityStoryItem): boolean =>
  item._tag === "PlannedAttemptExecutorWorkReported" &&
  item.report.attemptId === "attempt:B:0" &&
  item.report._tag === "Terminal" &&
  item.report.result._tag === "Completed"

const isDeliveryFinalityGraphReadAt = (item: DeliveryFinalityStoryItem, revision: string): boolean =>
  item._tag === "TrackerGraphReadReturned" && item.graph.revision === revision

const prerequisiteReopensStoryItem = (
  item: DeliveryFinalityStoryItem,
  bWorkCompleted: boolean
): ReadonlyArray<unknown> => {
  if (isDeliveryFinalityGraphReadAt(item, "delivery-story-G5")) {
    return [{ ...item, graph: deliveryFinalityPrerequisiteCompleteGraph }]
  }
  if (isDeliveryFinalityGraphReadAt(item, "delivery-story-G0")) {
    return [{ ...item, graph: deliveryFinalityPrerequisiteStartingGraph }]
  }
  if (bWorkCompleted && isDeliveryFinalityGraphReadAt(item, "delivery-story-G6")) {
    return [{ ...item, graph: deliveryFinalityPrerequisiteCompletedGraph }]
  }
  if (isDeliveryFinalityGraphReadAt(item, "delivery-story-G6")) {
    return [{ ...item, graph: deliveryFinalityPrerequisiteACompleteGraph }]
  }
  if (item._tag === "CompletionTaskRequestReturned" && item.outcome === "Acknowledged") {
    return [{ _tag: "CompletionTaskPrerequisiteReopened", graph: deliveryFinalityPrerequisiteReopenedGraph }, item]
  }
  return [item]
}

const prerequisiteReopensStory = (story: ReadonlyArray<DeliveryFinalityStoryItem>): ReadonlyArray<unknown> => {
  let bWorkCompleted = false
  return story.flatMap((item) => {
    if (isCompletedPrerequisiteAttempt(item)) bWorkCompleted = true
    return prerequisiteReopensStoryItem(item, bWorkCompleted)
  })
}

/** B reopens between the focused eligibility read and accepted completion Q. */
export const prerequisiteReopensDuringCompletionAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...deliveryFinalitySpineAuthoredCassette,
  name: "a prerequisite reopens while tracker completion is in flight",
  startingFacts: {
    ...deliveryFinalitySpineAuthoredCassette.startingFacts,
    trackerGraph: deliveryFinalityPrerequisiteStartingGraph
  },
  // B is complete in the graph used to authorize A.  It reopens at a fresh,
  // journaled graph read immediately before Q.  The accepted Q response and A
  // completion remain historical and are never repaired by Dalph.
  story: prerequisiteReopensStory(deliveryFinalitySpineAuthoredCassette.story)
})

/** The same A-to-B story when the tracker applies Q but its direct response is lost. */
export const ambiguousCompletionResponseAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...deliveryFinalitySpineAuthoredCassette,
  name: "Dalph checks A after losing the tracker completion response",
  story: deliveryFinalitySpineAuthoredCassette.story.map((item) =>
    item._tag === "CompletionTaskRequestReturned" ? { ...item, outcome: "ResponseLost" as const } : item
  )
})

const deliveryFinalityRecoveryStory = (() => {
  let focusedSuccessSeen = false
  let deathInserted = false
  return deliveryFinalitySpineAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
    if (item._tag === "CompletionTaskFocusedReadReturned" && item.lifecycle === "CompletedSuccessfully") {
      focusedSuccessSeen = true
    }
    if (
      focusedSuccessSeen &&
      !deathInserted &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReadTrackerGraph"
    ) {
      deathInserted = true
      return [{ _tag: "CoordinatorProcessDies" as const }, item]
    }
    return [item]
  })
})()

/** Restart occurs after focused A success but before the complete graph that can release B. */
export const completionGraphRefreshRecoveryAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...deliveryFinalitySpineAuthoredCassette,
  name: "Restart keeps B blocked between A's success confirmation and the later graph",
  story: deliveryFinalityRecoveryStory
})

const prerequisiteBlockingGraphReadCount = 2

type DeliveryFinalityStoryItem = (typeof deliveryFinalitySpineAuthoredCassette.story)[number]

const shouldInsertPrerequisiteReleaseReads = (
  item: DeliveryFinalityStoryItem,
  laterGraphCount: number,
  releaseReadsInserted: boolean
): boolean =>
  laterGraphCount === prerequisiteBlockingGraphReadCount &&
  !releaseReadsInserted &&
  item._tag === "DalphSelects" &&
  item.operation._tag === "AcquireTaskClaim" &&
  item.operation.taskId === "B"

const isDeliveryFinalityReleasedGraphRead = (item: DeliveryFinalityStoryItem): boolean =>
  item._tag === "TrackerGraphReadReturned" && String(item.graph.revision) === "delivery-story-G6"

const deliveryFinalityCurrentGraphStory = (() => {
  let laterGraphCount = 0
  let releaseReadsInserted = false
  return deliveryFinalitySpineAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
    if (shouldInsertPrerequisiteReleaseReads(item, laterGraphCount, releaseReadsInserted)) {
      releaseReadsInserted = true
      return [
        {
          _tag: "CoordinatorActivationReturned" as const,
          decision: { _tag: "RunMustRemainActive" as const, reason: "TrackerTargetUnsettled" as const }
        },
        { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned" as const, graph: deliveryFinalityAdditionalPrerequisiteSatisfiedGraph },
        { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned" as const, graph: deliveryFinalityAdditionalPrerequisiteSatisfiedGraph },
        item
      ]
    }
    if (!isDeliveryFinalityReleasedGraphRead(item)) return [item]
    laterGraphCount += 1
    return [
      {
        ...item,
        graph:
          laterGraphCount <= prerequisiteBlockingGraphReadCount
            ? deliveryFinalityAdditionalPrerequisiteGraph
            : deliveryFinalityAdditionalPrerequisiteSatisfiedGraph
      }
    ]
  })
})()

/** B remains excluded while current graph G7 reports unfinished D, then proceeds only after G8 completes D. */
export const currentCompletionGraphAuthorityAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...deliveryFinalitySpineAuthoredCassette,
  name: "The later complete graph gives the current reason B may proceed",
  story: deliveryFinalityCurrentGraphStory
})

const completionTaskConflictStartingGraph = {
  ...deliveryFinalityStartingGraph,
  revision: "delivery-story-S3-start",
  tasks: deliveryFinalityStartingGraph.tasks.map((task) => (task.id === "C" ? { ...task, prerequisiteIds: [] } : task))
} as const

const completionTaskConflictExpandedGraph = {
  ...deliveryFinalityExpandedGraph,
  revision: "delivery-story-S3-expanded",
  tasks: deliveryFinalityExpandedGraph.tasks.map((task) => (task.id === "C" ? { ...task, prerequisiteIds: [] } : task))
} as const

const completionConflictStory = (() => {
  let independentStartRefreshInserted = false
  let independentClaimRefreshInserted = false
  let independentSpecificationReadInserted = false
  let independentPlanInserted = false
  let restartSeen = false
  let postRestartClaimObserved = false
  let independentRunningInserted = false
  let rejectionSeen = false
  let terminalConflictSeen = false
  // eslint-disable-next-line complexity -- This authored chronology keeps C's independent concurrent steps ordered around A's restart and conflict.
  return deliveryFinalitySpineAuthoredCassette.story.flatMap((item): ReadonlyArray<unknown> => {
    if (item._tag === "CoordinatorProcessDies") restartSeen = true
    if (restartSeen && item._tag === "TaskClaimCurrentReadReturned" && item.taskId === "A") {
      postRestartClaimObserved = true
    }
    if (
      !independentStartRefreshInserted &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "AcquireTaskClaim" &&
      item.operation.taskId === "A"
    ) {
      independentStartRefreshInserted = true
      return [
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: completionTaskConflictStartingGraph },
        item,
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "C" } }
      ]
    }
    if (
      !independentClaimRefreshInserted &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReadTaskWorkSpecification" &&
      item.operation.taskId === "A"
    ) {
      independentClaimRefreshInserted = true
      return [
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: completionTaskConflictStartingGraph },
        item
      ]
    }
    if (
      !independentSpecificationReadInserted &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "RecordTaskAttemptPlan" &&
      item.operation.taskId === "A"
    ) {
      independentSpecificationReadInserted = true
      return [
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "C" } },
        {
          _tag: "TaskWorkSpecificationReadReturned",
          body: "Implement independent task C while A needs operator repair.",
          taskId: "C",
          title: "Implement independent C"
        },
        item
      ]
    }
    if (
      !independentPlanInserted &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReconcileTaskWorktree" &&
      item.operation.taskId === "A"
    ) {
      independentPlanInserted = true
      return [
        { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:C:1", taskId: "C" } },
        item,
        { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:C:1", taskId: "C" } }
      ]
    }
    if (
      postRestartClaimObserved &&
      !independentRunningInserted &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReadTrackerGraph"
    ) {
      independentRunningInserted = true
      return [
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Running", attemptId: "attempt:C:1" },
          request: "StartOrContinue"
        },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Terminal", attemptId: "attempt:C:1", result: { _tag: "Completed" } },
          request: "StartOrContinue"
        },
        item
      ]
    }
    if (!terminalConflictSeen && item._tag === "TrackerGraphReadReturned") {
      return [
        {
          ...item,
          graph:
            String(item.graph.revision) === String(deliveryFinalityStartingGraph.revision)
              ? completionTaskConflictStartingGraph
              : completionTaskConflictExpandedGraph
        }
      ]
    }
    if (item._tag === "CompletionTaskRequestReturned") {
      rejectionSeen = true
      return [{ ...item, outcome: "DefinitelyRejected" as const }]
    }
    if (rejectionSeen && item._tag === "CompletionTaskFocusedReadReturned") {
      terminalConflictSeen = true
      return [{ ...item, lifecycle: "TerminalWithoutSuccess" as const }]
    }
    if (!terminalConflictSeen) return [item]
    if (item._tag !== "ExpectedBehavior") return []
    return [
      {
        ...item,
        orchestration:
          item.orchestration === null
            ? null
            : item.orchestration
                .filter(
                  (evidence) =>
                    !("taskId" in evidence && evidence.taskId === "B") &&
                    !("attemptId" in evidence && evidence.attemptId === "attempt:B:0")
                )
                .flatMap(
                  (evidence): ReadonlyArray<unknown> =>
                    evidence._tag === "AcceptedResultIntegrationResponsibilityBegan"
                      ? [
                          {
                            _tag: "PlannedAttemptExecutorWorkResponsibilityBegan" as const,
                            attemptId: "attempt:C:1",
                            taskId: "C"
                          },
                          {
                            _tag: "PlannedAttemptExecutorWorkReported" as const,
                            attemptId: "attempt:C:1",
                            report: "Running" as const
                          },
                          evidence,
                          {
                            _tag: "PlannedAttemptExecutorWorkReported" as const,
                            attemptId: "attempt:C:1",
                            report: "TerminalCompleted" as const
                          }
                        ]
                      : [evidence]
                ),
        taskWork: {
          absences: [
            ...item.taskWork.absences.filter(({ taskId }) => taskId !== "B"),
            { _tag: "NoPlannedWorkUndertakenForTask", taskId: "B" }
          ],
          results: [
            ...item.taskWork.results.filter(({ taskId }) => taskId !== "B"),
            { _tag: "PlannedWorkForTaskCompleted", taskId: "C" }
          ]
        }
      }
    ]
  })
})()

/** A terminal-without-success tracker race remains local to A and preserves its promoted responsibility. */
export const completionTaskConflictAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...deliveryFinalitySpineAuthoredCassette,
  name: "A tracker client changes A while Dalph's completion request is pending",
  startingFacts: {
    ...deliveryFinalitySpineAuthoredCassette.startingFacts,
    taskWorkSpecifications: [
      ...deliveryFinalitySpineAuthoredCassette.startingFacts.taskWorkSpecifications,
      {
        body: "Implement independent task C while A needs operator repair.",
        taskId: "C",
        title: "Implement independent C"
      }
    ],
    trackerGraph: completionTaskConflictStartingGraph
  },
  story: completionConflictStory
})

const doubleDiamondTaskIds = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "X"] as const
const doubleDiamondPrerequisites = {
  A: [],
  B: ["A"],
  C: ["A"],
  D: ["B", "C"],
  E: ["D"],
  F: ["D"],
  G: ["H", "I"],
  H: ["E"],
  I: ["F"],
  X: ["A"]
} as const

const doubleDiamondGraph = (revision: string, completed: ReadonlySet<string>, xAdded: boolean) => ({
  revision,
  tasks: doubleDiamondTaskIds.flatMap((id) =>
    id === "X" && !xAdded
      ? []
      : [
          {
            id,
            lifecycle: { _tag: completed.has(id) ? ("CompletedSuccessfully" as const) : ("Open" as const) },
            parentTaskId: null,
            prerequisiteIds:
              id === "G" && xAdded ? [...doubleDiamondPrerequisites.G, "X"] : doubleDiamondPrerequisites[id]
          }
        ]
  )
})

const doubleDiamondGraphs = {
  initialAEligible: doubleDiamondGraph("double-diamond-G0", new Set(), false),
  aCompleteBeforeX: doubleDiamondGraph("double-diamond-G1", new Set(["A"]), false),
  xObservedDuringRestart: doubleDiamondGraph("double-diamond-G2-X-added", new Set(["A"]), true),
  bComplete: doubleDiamondGraph("double-diamond-G2-B-complete", new Set(["A", "B"]), true),
  middlePairComplete: doubleDiamondGraph("double-diamond-G3", new Set(["A", "B", "C"]), true),
  dComplete: doubleDiamondGraph("double-diamond-G3-D-complete", new Set(["A", "B", "C", "D"]), true),
  dAndXComplete: doubleDiamondGraph("double-diamond-G4", new Set(["A", "B", "C", "D", "X"]), true),
  eComplete: doubleDiamondGraph("double-diamond-G4-E-complete", new Set(["A", "B", "C", "D", "E", "X"]), true),
  lowerPairComplete: doubleDiamondGraph("double-diamond-G5", new Set(["A", "B", "C", "D", "E", "F", "X"]), true),
  hComplete: doubleDiamondGraph(
    "double-diamond-G5-H-complete",
    new Set(["A", "B", "C", "D", "E", "F", "H", "X"]),
    true
  ),
  deepPairComplete: doubleDiamondGraph(
    "double-diamond-G6",
    new Set(["A", "B", "C", "D", "E", "F", "H", "I", "X"]),
    true
  ),
  allComplete: doubleDiamondGraph("double-diamond-G7", new Set(doubleDiamondTaskIds), true)
} as const

type DoubleDiamondGraph = {
  readonly revision: string
  readonly tasks: ReadonlyArray<{
    readonly id: string
    readonly lifecycle: { readonly _tag: "CompletedSuccessfully" | "Open" }
    readonly parentTaskId: string | null
    readonly prerequisiteIds: ReadonlyArray<string>
  }>
}

const doubleDiamondGraphRead = (graph: DoubleDiamondGraph) => [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "double-diamond-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph }
]

const doubleDiamondSpecification = (taskId: (typeof doubleDiamondTaskIds)[number]) => ({
  body: `Complete double-diamond task ${taskId}.`,
  taskId,
  title: `Complete ${taskId}`
})

const lastArrayItemOffset = -1

const doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems = (
  graph: DoubleDiamondGraph,
  tasks: ReadonlyArray<{ readonly attemptId: string; readonly taskId: (typeof doubleDiamondTaskIds)[number] }>,
  claimTasks: ReadonlyArray<{ readonly taskId: (typeof doubleDiamondTaskIds)[number] }> = tasks,
  specificationTasks: ReadonlyArray<{ readonly taskId: (typeof doubleDiamondTaskIds)[number] }> = tasks,
  deferredTasks: ReadonlyArray<{
    readonly attemptId: string
    readonly taskId: (typeof doubleDiamondTaskIds)[number]
  }> = []
) => [
  ...Array.from({ length: claimTasks.length + 1 }, () => doubleDiamondGraphRead(graph)).flat(),
  ...claimTasks.map(({ taskId }) => ({
    _tag: "DalphSelects" as const,
    operation: { _tag: "AcquireTaskClaim" as const, taskId }
  })),
  ...Array.from({ length: claimTasks.length }, () => doubleDiamondGraphRead(graph)).flat(),
  ...specificationTasks.flatMap(({ taskId }) => [
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId } },
    { _tag: "TaskWorkSpecificationReadReturned" as const, ...doubleDiamondSpecification(taskId) }
  ]),
  ...tasks.map(({ attemptId, taskId }) => ({
    _tag: "DalphSelects" as const,
    operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId, taskId }
  })),
  ...(deferredTasks.length === 0 ? tasks : tasks.slice(0, lastArrayItemOffset)).map(({ attemptId, taskId }) => ({
    _tag: "DalphSelects" as const,
    operation: { _tag: "ReconcileTaskWorktree" as const, attemptId, taskId }
  })),
  ...deferredTasks.map(({ attemptId, taskId }) => ({
    _tag: "DalphSelects" as const,
    operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId, taskId }
  })),
  ...(deferredTasks.length === 0 ? [] : tasks.slice(lastArrayItemOffset)).map(({ attemptId, taskId }) => ({
    _tag: "DalphSelects" as const,
    operation: { _tag: "ReconcileTaskWorktree" as const, attemptId, taskId }
  }))
  // A deferred task has a durable attempt plan, but capacity prevents Dalph
  // from preparing its worktree until one of the currently running attempts
  // settles.
]

const hexadecimalRadix = 16
const gitShaCharacterLength = 40

const doubleDiamondExecutorReport = (
  attempt: { readonly attemptId: string; readonly taskId: (typeof doubleDiamondTaskIds)[number] },
  report: "Running" | "Terminal"
) => ({
  _tag: "PlannedAttemptExecutorWorkReported" as const,
  report:
    report === "Running"
      ? { _tag: "Running" as const, attemptId: attempt.attemptId }
      : { _tag: "Terminal" as const, attemptId: attempt.attemptId, result: { _tag: "Completed" as const } },
  request: "StartOrContinue" as const
})

const doubleDiamondAcceptedCommit = (taskId: (typeof doubleDiamondTaskIds)[number]) =>
  `${(doubleDiamondTaskIds.indexOf(taskId) + 1).toString(hexadecimalRadix)}`.repeat(gitShaCharacterLength)

const doubleDiamondCandidateCommit = (taskId: (typeof doubleDiamondTaskIds)[number]) =>
  "abcdef0173"[doubleDiamondTaskIds.indexOf(taskId)]?.repeat(gitShaCharacterLength) ?? "f".repeat(gitShaCharacterLength)

const doubleDiamondAcceptedReport = (attempt: {
  readonly attemptId: string
  readonly taskId: (typeof doubleDiamondTaskIds)[number]
}) => ({
  _tag: "PlannedAttemptExecutorWorkReported" as const,
  report: {
    _tag: "Terminal" as const,
    attemptId: attempt.attemptId,
    result: { _tag: "Accepted" as const, acceptedResult: { commit: doubleDiamondAcceptedCommit(attempt.taskId) } }
  },
  request: "StartOrContinue" as const
})

/** Every accepted executor result crosses the ordinary integration and completion-finality boundaries. */
const doubleDiamondIntegrationFinality = (
  attempt: { readonly attemptId: string; readonly taskId: (typeof doubleDiamondTaskIds)[number] },
  graphBeforeCompletion: DoubleDiamondGraph,
  claimsToRead: ReadonlyArray<{ readonly taskId: (typeof doubleDiamondTaskIds)[number] }> = [attempt],
  continueQueuedIntegration = false,
  lineageTasks: ReadonlyArray<{
    readonly attemptId: string
    readonly taskId: (typeof doubleDiamondTaskIds)[number]
  }> = [attempt],
  repository = "/dalph/cassettes/double-diamond.git"
) => {
  const acceptedResultCommit = doubleDiamondAcceptedCommit(attempt.taskId)
  const candidateCommit = doubleDiamondCandidateCommit(attempt.taskId)
  const expectedTargetHead = "2222222222222222222222222222222222222222"
  return [
    ...(continueQueuedIntegration
      ? []
      : [
          ...doubleDiamondGraphRead(graphBeforeCompletion),
          ...claimsToRead.flatMap(({ taskId }) => [
            { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId } },
            { _tag: "TaskClaimCurrentReadReturned" as const, taskId }
          ]),
          ...doubleDiamondGraphRead(graphBeforeCompletion),
          ...lineageTasks.map(({ attemptId, taskId }) => ({
            _tag: "DalphSelects" as const,
            operation: { _tag: "ReadTargetLineage" as const, attemptId, taskId }
          }))
        ]),
    {
      _tag: "IntegrationCandidateAgentReported" as const,
      attemptId: attempt.attemptId,
      report: { _tag: "Submitted" as const, candidateCommit }
    },
    candidateGitValidationReturned(repository, candidateCommit, {
      _tag: "Commit" as const,
      directParents: [expectedTargetHead, acceptedResultCommit]
    }),
    {
      _tag: "TargetVerificationReturned" as const,
      result: {
        _tag: "Passed" as const,
        artifacts: [{ name: "acceptance-verification", content: `verified ${attempt.taskId}` }]
      }
    },
    targetPromotionGitReadReturned(repository, candidateCommit, {
      _tag: "CandidateNotInAncestry" as const,
      currentHeadSha: expectedTargetHead
    }),
    { _tag: "TargetPromotionCompareAndSetReturned" as const, result: { _tag: "Applied" as const } },
    { _tag: "CompletionClaimReadReturned" as const, claim: "Active" as const, taskId: attempt.taskId },
    { _tag: "CompletionClaimReplacementApplied" as const, taskId: attempt.taskId },
    {
      _tag: "CompletionTaskFocusedReadReturned" as const,
      lifecycle: "Open" as const,
      taskId: attempt.taskId,
      unfinishedPrerequisiteTaskIds: []
    },
    targetPromotionGitReadReturned(repository, candidateCommit, {
      _tag: "CandidateCurrent" as const,
      currentHeadSha: candidateCommit
    }),
    { _tag: "CompletionTaskRequestReturned" as const, outcome: "Acknowledged" as const, taskId: attempt.taskId },
    {
      _tag: "CompletionTaskFocusedReadReturned" as const,
      lifecycle: "CompletedSuccessfully" as const,
      taskId: attempt.taskId,
      unfinishedPrerequisiteTaskIds: []
    },
    { _tag: "CompletionClaimReadReturned" as const, claim: "Completion" as const, taskId: attempt.taskId },
    { _tag: "CompletionClaimDeletionApplied" as const, taskId: attempt.taskId }
  ]
}

const doubleDiamondRecoveryReads = (
  tasks: ReadonlyArray<{ readonly attemptId: string; readonly taskId: (typeof doubleDiamondTaskIds)[number] }>,
  reconfirmSpecifications = false
) => [
  ...tasks.flatMap(({ taskId }) => [
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId } },
    { _tag: "TaskWorkSpecificationReadReturned" as const, ...doubleDiamondSpecification(taskId) }
  ]),
  ...tasks.flatMap(({ taskId }) => [
    ...(reconfirmSpecifications
      ? [
          { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId } },
          { _tag: "TaskWorkSpecificationReadReturned" as const, ...doubleDiamondSpecification(taskId) }
        ]
      : []),
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId } },
    { _tag: "TaskClaimCurrentReadReturned" as const, taskId }
  ]),
  ...tasks.flatMap(({ attemptId, taskId }, index) => [
    ...(reconfirmSpecifications && index > 0
      ? [
          { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId } },
          { _tag: "TaskClaimCurrentReadReturned" as const, taskId }
        ]
      : []),
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorktree" as const, attemptId, taskId } }
  ]),
  ...tasks.flatMap(({ attemptId, taskId }, index) => [
    ...(reconfirmSpecifications && index > 0
      ? [{ _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorktree" as const, attemptId, taskId } }]
      : []),
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTargetLineage" as const, attemptId, taskId } }
  ])
]

const doubleDiamondAttempts = {
  a: { attemptId: "attempt:A:0", taskId: "A" },
  b: { attemptId: "attempt:B:0", taskId: "B" },
  c: { attemptId: "attempt:C:1", taskId: "C" },
  d: { attemptId: "attempt:D:0", taskId: "D" },
  x: { attemptId: "attempt:X:1", taskId: "X" },
  e: { attemptId: "attempt:E:0", taskId: "E" },
  f: { attemptId: "attempt:F:1", taskId: "F" },
  h: { attemptId: "attempt:H:0", taskId: "H" },
  i: { attemptId: "attempt:I:1", taskId: "I" },
  g: { attemptId: "attempt:G:0", taskId: "G" }
} as const
const doubleDiamondExecutionOrder = ["A", "B", "C", "D", "X", "E", "F", "H", "I", "G"] as const

/** The real delivery runtime consumes a staggered double diamond and reconstructs both middle positions before observing X. */
export const deliveryInvariantStoryAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "accepted results settle through integration and later tracker observations consume a staggered double diamond while restart-delayed X waits for capacity",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: doubleDiamondTaskIds.map(doubleDiamondSpecification),
    trackerGraph: doubleDiamondGraphs.initialAEligible,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 2 } },
    {
      _tag: "RunCoordinator",
      baseSha: "2222222222222222222222222222222222222222",
      claimOwner: "double-diamond-owner",
      claimTokenPrefix: "double-diamond-claim",
      executor: "executor:double-diamond",
      integrationTarget: { repository: "/dalph/cassettes/double-diamond.git", ref: "refs/heads/master" },
      target: "double-diamond-target",
      verificationPlanId: "acceptance-verification",
      worktreeRoot: "/dalph/cassettes/double-diamond"
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(doubleDiamondGraphs.initialAEligible, [
      doubleDiamondAttempts.a
    ]),
    doubleDiamondExecutorReport(doubleDiamondAttempts.a, "Running"),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.a),
    ...doubleDiamondGraphRead(doubleDiamondGraphs.initialAEligible),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.a, doubleDiamondGraphs.initialAEligible),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(doubleDiamondGraphs.aCompleteBeforeX, [
      doubleDiamondAttempts.b,
      doubleDiamondAttempts.c
    ]),
    doubleDiamondExecutorReport(doubleDiamondAttempts.b, "Running"),
    doubleDiamondExecutorReport(doubleDiamondAttempts.c, "Running"),
    { _tag: "CoordinatorProcessDies" },
    ...doubleDiamondGraphRead(doubleDiamondGraphs.xObservedDuringRestart),
    ...doubleDiamondGraphRead(doubleDiamondGraphs.xObservedDuringRestart),
    ...doubleDiamondRecoveryReads([doubleDiamondAttempts.b, doubleDiamondAttempts.c], true),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.b),
    {
      _tag: "DalphSelects",
      operation: { _tag: "ReadTargetLineage", attemptId: doubleDiamondAttempts.c.attemptId, taskId: "C" }
    },
    doubleDiamondAcceptedReport(doubleDiamondAttempts.c),
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.b, doubleDiamondGraphs.xObservedDuringRestart, [], true),
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.c, doubleDiamondGraphs.bComplete, [], true),
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(doubleDiamondGraphs.middlePairComplete, [
      doubleDiamondAttempts.d,
      doubleDiamondAttempts.x
    ]),
    doubleDiamondExecutorReport(doubleDiamondAttempts.d, "Running"),
    doubleDiamondExecutorReport(doubleDiamondAttempts.x, "Running"),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.d),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.x),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.d, doubleDiamondGraphs.middlePairComplete, [
      doubleDiamondAttempts.d,
      doubleDiamondAttempts.x
    ]),
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:X:1", taskId: "X" } },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.x, doubleDiamondGraphs.dComplete, [], true),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(doubleDiamondGraphs.dAndXComplete, [
      doubleDiamondAttempts.e,
      doubleDiamondAttempts.f
    ]),
    doubleDiamondExecutorReport(doubleDiamondAttempts.e, "Running"),
    doubleDiamondExecutorReport(doubleDiamondAttempts.f, "Running"),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.e),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.f),
    ...doubleDiamondGraphRead(doubleDiamondGraphs.dAndXComplete),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.e, doubleDiamondGraphs.dAndXComplete, [
      doubleDiamondAttempts.e,
      doubleDiamondAttempts.f
    ]),
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:F:1", taskId: "F" } },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.f, doubleDiamondGraphs.eComplete, [], true),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(doubleDiamondGraphs.lowerPairComplete, [
      doubleDiamondAttempts.h,
      doubleDiamondAttempts.i
    ]),
    doubleDiamondExecutorReport(doubleDiamondAttempts.h, "Running"),
    doubleDiamondExecutorReport(doubleDiamondAttempts.i, "Running"),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.h),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.i),
    ...doubleDiamondGraphRead(doubleDiamondGraphs.lowerPairComplete),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.h, doubleDiamondGraphs.lowerPairComplete, [
      doubleDiamondAttempts.h,
      doubleDiamondAttempts.i
    ]),
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:I:1", taskId: "I" } },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.i, doubleDiamondGraphs.hComplete, [], true),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(doubleDiamondGraphs.deepPairComplete, [
      doubleDiamondAttempts.g
    ]),
    doubleDiamondExecutorReport(doubleDiamondAttempts.g, "Running"),
    doubleDiamondAcceptedReport(doubleDiamondAttempts.g),
    ...doubleDiamondGraphRead(doubleDiamondGraphs.deepPairComplete),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(doubleDiamondAttempts.g, doubleDiamondGraphs.allComplete),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: doubleDiamondExecutionOrder.map((taskId) => ({
          _tag: "PlannedWorkForTaskAccepted" as const,
          commit: doubleDiamondAcceptedCommit(taskId),
          taskId
        }))
      }
    }
  ]
})

const fiveTaskDiamondGraph = (revision: string, completed: ReadonlySet<string>) => ({
  ...doubleDiamondGraph(revision, completed, false),
  tasks: doubleDiamondGraph(revision, completed, false).tasks.flatMap((task) =>
    ["A", "B", "C", "D", "E"].includes(task.id)
      ? [
          {
            ...task,
            prerequisiteIds:
              task.id === "E" ? (["A"] as const) : task.id === "D" ? (["B", "C", "E"] as const) : task.prerequisiteIds
          }
        ]
      : []
  )
})

const fiveTaskDiamondGraphs = {
  noneComplete: fiveTaskDiamondGraph("five-task-diamond-G0", new Set()),
  aComplete: fiveTaskDiamondGraph("five-task-diamond-G1", new Set(["A"])),
  abcComplete: fiveTaskDiamondGraph("five-task-diamond-G2", new Set(["A", "B", "C"])),
  abceComplete: fiveTaskDiamondGraph("five-task-diamond-G3", new Set(["A", "B", "C", "E"])),
  allComplete: fiveTaskDiamondGraph("five-task-diamond-G4", new Set(["A", "B", "C", "D", "E"]))
} as const

const fiveTaskDiamondTaskIds = ["A", "B", "C", "E", "D"] as const

const fiveTaskDiamondAttempts = {
  a: { attemptId: "attempt:A:0", taskId: "A" },
  b: { attemptId: "attempt:B:0", taskId: "B" },
  c: { attemptId: "attempt:C:1", taskId: "C" },
  e: { attemptId: "attempt:E:2", taskId: "E" },
  d: { attemptId: "attempt:D:0", taskId: "D" }
} as const

/** Capacity two consumes A -> (B, C, E) -> D only after exact tracker-confirmed finality. */
export const productionShapedFiveTaskDiamondAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "five-task dependency diamond settles every accepted result before releasing D",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: fiveTaskDiamondTaskIds.map(doubleDiamondSpecification),
    trackerGraph: fiveTaskDiamondGraphs.noneComplete,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 2 } },
    {
      _tag: "RunCoordinator",
      baseSha: "2222222222222222222222222222222222222222",
      claimOwner: "five-task-diamond-owner",
      claimTokenPrefix: "five-task-diamond-claim",
      executor: "executor:five-task-diamond",
      integrationTarget: { repository: "/dalph/cassettes/five-task-diamond.git", ref: "refs/heads/master" },
      target: "double-diamond-target",
      verificationPlanId: "acceptance-verification",
      worktreeRoot: "/dalph/cassettes/five-task-diamond"
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(fiveTaskDiamondGraphs.noneComplete, [
      fiveTaskDiamondAttempts.a
    ]),
    doubleDiamondExecutorReport(fiveTaskDiamondAttempts.a, "Running"),
    doubleDiamondAcceptedReport(fiveTaskDiamondAttempts.a),
    ...doubleDiamondGraphRead(fiveTaskDiamondGraphs.noneComplete),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(
      fiveTaskDiamondAttempts.a,
      fiveTaskDiamondGraphs.noneComplete,
      undefined,
      false,
      undefined,
      "/dalph/cassettes/five-task-diamond.git"
    ),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(
      fiveTaskDiamondGraphs.aComplete,
      [fiveTaskDiamondAttempts.b, fiveTaskDiamondAttempts.c],
      [fiveTaskDiamondAttempts.b, fiveTaskDiamondAttempts.c, fiveTaskDiamondAttempts.e],
      [fiveTaskDiamondAttempts.b, fiveTaskDiamondAttempts.c, fiveTaskDiamondAttempts.e],
      [fiveTaskDiamondAttempts.e]
    ),
    doubleDiamondExecutorReport(fiveTaskDiamondAttempts.b, "Running"),
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:E:2", taskId: "E" } },
    doubleDiamondExecutorReport(fiveTaskDiamondAttempts.c, "Running"),
    doubleDiamondAcceptedReport(fiveTaskDiamondAttempts.b),
    doubleDiamondAcceptedReport(fiveTaskDiamondAttempts.c),
    doubleDiamondExecutorReport(fiveTaskDiamondAttempts.e, "Running"),
    doubleDiamondAcceptedReport(fiveTaskDiamondAttempts.e),
    ...doubleDiamondGraphRead(fiveTaskDiamondGraphs.aComplete),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(
      fiveTaskDiamondAttempts.b,
      fiveTaskDiamondGraphs.aComplete,
      [fiveTaskDiamondAttempts.b, fiveTaskDiamondAttempts.c, fiveTaskDiamondAttempts.e],
      false,
      [fiveTaskDiamondAttempts.b],
      "/dalph/cassettes/five-task-diamond.git"
    ),
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:C:1", taskId: "C" } },
    ...doubleDiamondIntegrationFinality(
      fiveTaskDiamondAttempts.c,
      fiveTaskDiamondGraphs.abcComplete,
      [],
      true,
      undefined,
      "/dalph/cassettes/five-task-diamond.git"
    ),
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:E:2", taskId: "E" } },
    ...doubleDiamondIntegrationFinality(
      fiveTaskDiamondAttempts.e,
      fiveTaskDiamondGraphs.abceComplete,
      [],
      true,
      undefined,
      "/dalph/cassettes/five-task-diamond.git"
    ),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphClaimSpecificationPlanAndWorktreeItems(fiveTaskDiamondGraphs.abceComplete, [
      fiveTaskDiamondAttempts.d
    ]),
    doubleDiamondExecutorReport(fiveTaskDiamondAttempts.d, "Running"),
    doubleDiamondAcceptedReport(fiveTaskDiamondAttempts.d),
    ...doubleDiamondGraphRead(fiveTaskDiamondGraphs.abceComplete),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    ...doubleDiamondIntegrationFinality(
      fiveTaskDiamondAttempts.d,
      fiveTaskDiamondGraphs.abceComplete,
      undefined,
      false,
      undefined,
      "/dalph/cassettes/five-task-diamond.git"
    ),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...doubleDiamondGraphRead(fiveTaskDiamondGraphs.allComplete),
    ...doubleDiamondGraphRead(fiveTaskDiamondGraphs.allComplete),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: fiveTaskDiamondTaskIds.map((taskId) => ({
          _tag: "PlannedWorkForTaskAccepted" as const,
          commit: doubleDiamondAcceptedCommit(taskId),
          taskId
        }))
      }
    }
  ]
})

/** Three lost mutation responses are each reconciled against H; exhaustion sends no fourth request. */
export const targetPromotionAmbiguityExhaustionAuthoredCassette: ScenarioCassette = promotionScenarioFrom(
  "reconciles a lost promotion response and never sends a fourth request",
  [
    targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
      _tag: "CandidateNotInAncestry",
      currentHeadSha: promotionExpectedHead
    }),
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "attempt 1 response lost" },
    targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
      _tag: "CandidateNotInAncestry",
      currentHeadSha: promotionExpectedHead
    }),
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "attempt 2 response lost" },
    targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
      _tag: "CandidateNotInAncestry",
      currentHeadSha: promotionExpectedHead
    }),
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "attempt 3 response lost" },
    targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
      _tag: "CandidateNotInAncestry",
      currentHeadSha: promotionExpectedHead
    })
  ],
  {
    _tag: "TargetPromotionNonConvergent",
    attemptOrdinal: 3,
    candidateCommit: promotionCandidateCommit,
    lastObservation: "ExpectedHeadStillObserved",
    taskId: "A"
  }
)

/** The post-intent Git read sees H2, records stale evidence, and sends no compare-and-set. */
export const targetPromotionStaleBeforeCompareAndSetAuthoredCassette: ScenarioCassette = promotionScenarioFrom(
  "records stale H2 and never overwrites it",
  [
    targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
      _tag: "CandidateNotInAncestry",
      currentHeadSha: "2222222222222222222222222222222222222222"
    })
  ],
  {
    _tag: "TargetPromotionStale",
    basis: { _tag: "BeforeFirstAttempt" },
    candidateCommit: promotionCandidateCommit,
    expectedTargetHead: promotionExpectedHead,
    observedTargetHead: "2222222222222222222222222222222222222222",
    observation: "ReconciledCandidateNotInAncestry",
    taskId: "A"
  }
)

/** Git applied M but lost the response; the required read discovers M and sends no retry. */
export const targetPromotionLostResponseDiscoversCurrentCandidateAuthoredCassette: ScenarioCassette =
  promotionScenarioFrom(
    "discovers M in current target ancestry after losing the promotion response",
    [
      targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
        _tag: "CandidateNotInAncestry",
        currentHeadSha: promotionExpectedHead
      }),
      { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "Git applied M but the response was lost" },
      targetPromotionGitReadReturned("/dalph/cassettes/integration.git", promotionCandidateCommit, {
        _tag: "CandidateCurrent",
        currentHeadSha: promotionCandidateCommit
      })
    ],
    {
      _tag: "TargetPromotionSucceeded",
      basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
      candidateCommit: promotionCandidateCommit,
      expectedTargetHead: promotionExpectedHead,
      observedTargetHead: promotionCandidateCommit,
      observation: "ReconciledCandidateCurrent",
      taskId: "A"
    }
  )

/** Two definitive invalid submissions exhaust the accepted one-correction cassette policy. */
export const candidateCorrectionExhaustionAuthoredCassette: ScenarioCassette = candidateScenarioFrom(
  "candidate correction exhaustion preserves non-convergent work",
  [
    candidateReportForA({ _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      _tag: "Missing"
    }),
    candidateReportForA({ _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }),
    candidateGitValidationReturned("/dalph/cassettes/integration.git", "cccccccccccccccccccccccccccccccccccccccc", {
      _tag: "Commit",
      directParents: []
    })
  ],
  undefined
)

/** A misrouted response is preserved as a correlation contradiction and never reaches Git. */
export const candidateCorrelationContradictionAuthoredCassette: ScenarioCassette = candidateScenarioFrom(
  "candidate correlation contradiction fails closed before Git",
  [candidateReportForA({ _tag: "CorrelationContradiction" })],
  undefined
)

/** Public catalog consumed by acceptance tests, documentation, and Reducer Lab. */
const defineAuthoredCassetteCatalog = <const Name extends string>(
  catalog: Readonly<Record<Name, AuthoredScenarioCassette>>
): Readonly<Record<Name, AuthoredScenarioCassette>> => catalog

type MaintainedAuthoredCassetteName =
  | "acceptedResultRestartsIntoIntegration"
  | "postIntegrationAttemptChoiceRejected"
  | "candidateConflictRecovery"
  | "candidateCorrectionAfterUnreadableGit"
  | "candidateCorrectionExhaustion"
  | "candidateCorrelationContradiction"
  | "candidateVerificationFailure"
  | "candidateVerificationContradiction"
  | "candidateVerificationPassed"
  | "prePromotionBlocker"
  | "prePromotionBlockerClearAndSupersession"
  | "prePromotionBlockerRecovery"
  | "prePromotionBlockerUnreadableReadRecovery"
  | "targetPromotionSuccess"
  | "blockersAroundPromotion"
  | "targetPromotionAmbiguityExhaustion"
  | "targetPromotionStaleBeforeCompareAndSet"
  | "targetPromotionLostResponseDiscoversCurrentCandidate"
  | "changedAttemptContinues"
  | "changedAttemptRestartAfterSupersessionCrash"
  | "changedAttemptRestartClaimUnavailable"
  | "changedAttemptRestartFactsChanged"
  | "changedAttemptRestartLateAccepted"
  | "changedAttemptRestartPastIntegrationRejected"
  | "changedAttemptRestartRemainsUnproved"
  | "changedAttemptRestartsCleanly"
  | "changedAttemptRestartWorktreeNotReady"
  | "changedAttemptChoiceRace"
  | "changedAgainAttemptRequiresNewChoice"
  | "changedAttemptStopLostThirdSuspension"
  | "changedAttemptStopRemainsUnproved"
  | "changedAttemptStopsAndReleases"
  | "changedAttemptStopReleaseResponseLost"
  | "changedAttemptStopsWithAbsentClaim"
  | "changedAttemptStopsWithForeignClaim"
  | "changedAttemptReacquisitionForeignConflict"
  | "compatibleTargetAdvanceContinues"
  | "coordinatorProcessDeathContinues"
  | "contractedCapacityRetainsTwoAttempts"
  | "ambiguousCompletionResponse"
  | "prerequisiteReopensDuringCompletion"
  | "completionGraphRefreshRecovery"
  | "completionTaskConflict"
  | "currentCompletionGraphAuthority"
  | "deliveryFinalitySpine"
  | "deliveryInvariantStory"
  | "productionShapedFiveTaskDiamond"
  | "dependentTasksCompleteInOneRun"
  | "incompatibleTargetRewriteSafelySuspends"
  | "lostPlannedWorktreeSafelySuspends"
  | "runPauseRestartsPassively"
  | "runPauseObservationDisconnects"
  | "runPauseSafelySuspends"
  | "runUnpauseAfterSafeSuspension"
  | "runUnpauseDuringSuspensionRestarts"
  | "staleTaskPauseRejected"
  | "unreadableTaskUnpauseRejected"
  | "taskPauseCoversGroupingChild"
  | "taskPauseObservationUnpaused"
  | "taskPauseGroupingFactsAdded"
  | "taskPauseExecutorAndPromotionBoundaries"
  | "taskPauseFinishesHeldIntegration"
  | "taskPauseLetsIndependentTaskContinue"
  | "taskUnpauseAfterSafeSuspension"
  | "taskUnpauseDuringSuspensionRestarts"
  | "singletonTaskCompletes"

export const maintainedAuthoredCassetteCatalog: Readonly<Record<MaintainedAuthoredCassetteName, ScenarioCassette>> =
  defineAuthoredCassetteCatalog({
    acceptedResultRestartsIntoIntegration: acceptedResultRestartsIntoIntegrationAuthoredCassette,
    postIntegrationAttemptChoiceRejected: postIntegrationAttemptChoiceRejectedAuthoredCassette,
    candidateConflictRecovery: candidateConflictRecoveryAuthoredCassette,
    candidateCorrectionAfterUnreadableGit: candidateCorrectionAfterUnreadableGitAuthoredCassette,
    candidateCorrectionExhaustion: candidateCorrectionExhaustionAuthoredCassette,
    candidateCorrelationContradiction: candidateCorrelationContradictionAuthoredCassette,
    candidateVerificationFailure: candidateVerificationFailureAuthoredCassette,
    candidateVerificationContradiction: candidateVerificationContradictionAuthoredCassette,
    candidateVerificationPassed: candidateCorrectionAfterUnreadableGitAuthoredCassette,
    prePromotionBlocker: prePromotionBlockerAuthoredCassette,
    prePromotionBlockerClearAndSupersession: prePromotionBlockerClearAndSupersessionAuthoredCassette,
    prePromotionBlockerRecovery: prePromotionBlockerRecoveryAuthoredCassette,
    prePromotionBlockerUnreadableReadRecovery: prePromotionBlockerUnreadableReadRecoveryAuthoredCassette,
    targetPromotionSuccess: targetPromotionSuccessAuthoredCassette,
    blockersAroundPromotion: blockersAroundPromotionAuthoredCassette,
    targetPromotionAmbiguityExhaustion: targetPromotionAmbiguityExhaustionAuthoredCassette,
    targetPromotionStaleBeforeCompareAndSet: targetPromotionStaleBeforeCompareAndSetAuthoredCassette,
    targetPromotionLostResponseDiscoversCurrentCandidate:
      targetPromotionLostResponseDiscoversCurrentCandidateAuthoredCassette,
    changedAttemptContinues: changedAttemptContinuesAuthoredCassette,
    changedAttemptRestartAfterSupersessionCrash: changedAttemptRestartAfterSupersessionCrashAuthoredCassette,
    changedAttemptRestartClaimUnavailable: changedAttemptRestartClaimUnavailableAuthoredCassette,
    changedAttemptRestartFactsChanged: changedAttemptRestartFactsChangedAuthoredCassette,
    changedAttemptRestartLateAccepted: changedAttemptRestartLateAcceptedAuthoredCassette,
    changedAttemptRestartPastIntegrationRejected: changedAttemptRestartPastIntegrationRejectedAuthoredCassette,
    changedAttemptRestartRemainsUnproved: changedAttemptRestartRemainsUnprovedAuthoredCassette,
    changedAttemptRestartsCleanly: changedAttemptRestartsCleanlyAuthoredCassette,
    changedAttemptRestartWorktreeNotReady: changedAttemptRestartWorktreeNotReadyAuthoredCassette,
    changedAttemptChoiceRace: changedAttemptChoiceRaceAuthoredCassette,
    changedAgainAttemptRequiresNewChoice: changedAgainAttemptRequiresNewChoiceAuthoredCassette,
    changedAttemptStopLostThirdSuspension: changedAttemptStopLostThirdSuspensionAuthoredCassette,
    changedAttemptStopRemainsUnproved: changedAttemptStopRemainsUnprovedAuthoredCassette,
    changedAttemptStopsAndReleases: changedAttemptStopsAndReleasesAuthoredCassette,
    changedAttemptStopReleaseResponseLost: changedAttemptStopReleaseResponseLostAuthoredCassette,
    changedAttemptStopsWithAbsentClaim: changedAttemptStopsWithAbsentClaimAuthoredCassette,
    changedAttemptStopsWithForeignClaim: changedAttemptStopsWithForeignClaimAuthoredCassette,
    changedAttemptReacquisitionForeignConflict: changedAttemptReacquisitionForeignConflictAuthoredCassette,
    compatibleTargetAdvanceContinues: compatibleTargetAdvanceContinuesAuthoredCassette,
    coordinatorProcessDeathContinues: coordinatorProcessDeathContinuesAuthoredCassette,
    contractedCapacityRetainsTwoAttempts: contractedCapacityRetainsTwoAttemptsAuthoredCassette,
    ambiguousCompletionResponse: ambiguousCompletionResponseAuthoredCassette,
    prerequisiteReopensDuringCompletion: prerequisiteReopensDuringCompletionAuthoredCassette,
    completionGraphRefreshRecovery: completionGraphRefreshRecoveryAuthoredCassette,
    completionTaskConflict: completionTaskConflictAuthoredCassette,
    currentCompletionGraphAuthority: currentCompletionGraphAuthorityAuthoredCassette,
    deliveryFinalitySpine: deliveryFinalitySpineAuthoredCassette,
    deliveryInvariantStory: deliveryInvariantStoryAuthoredCassette,
    productionShapedFiveTaskDiamond: productionShapedFiveTaskDiamondAuthoredCassette,
    dependentTasksCompleteInOneRun: dependentTasksCompleteInOneRunAuthoredCassette,
    incompatibleTargetRewriteSafelySuspends: incompatibleTargetRewriteSafelySuspendsAuthoredCassette,
    lostPlannedWorktreeSafelySuspends: lostPlannedWorktreeSafelySuspendsAuthoredCassette,
    runPauseRestartsPassively: runPauseRestartsPassivelyAuthoredCassette,
    runPauseObservationDisconnects: runPauseObservationDisconnectsAuthoredCassette,
    runPauseSafelySuspends: runPauseSafelySuspendsAuthoredCassette,
    runUnpauseAfterSafeSuspension: runUnpauseAfterSafeSuspensionAuthoredCassette,
    runUnpauseDuringSuspensionRestarts: runUnpauseDuringSuspensionRestartsAuthoredCassette,
    staleTaskPauseRejected: staleTaskPauseRejectedAuthoredCassette,
    unreadableTaskUnpauseRejected: unreadableTaskUnpauseRejectedAuthoredCassette,
    taskPauseCoversGroupingChild: taskPauseCoversGroupingChildAuthoredCassette,
    taskPauseObservationUnpaused: taskPauseObservationUnpausedAuthoredCassette,
    taskPauseGroupingFactsAdded: taskPauseGroupingFactsAddedAuthoredCassette,
    taskPauseExecutorAndPromotionBoundaries: taskPauseExecutorAndPromotionBoundariesAuthoredCassette,
    taskPauseFinishesHeldIntegration: taskPauseFinishesHeldIntegrationAuthoredCassette,
    taskPauseLetsIndependentTaskContinue: taskPauseLetsIndependentTaskContinueAuthoredCassette,
    taskUnpauseAfterSafeSuspension: taskUnpauseAfterSafeSuspensionAuthoredCassette,
    taskUnpauseDuringSuspensionRestarts: taskUnpauseDuringSuspensionRestartsAuthoredCassette,
    singletonTaskCompletes: singletonTaskCompletesAuthoredCassette
  })
