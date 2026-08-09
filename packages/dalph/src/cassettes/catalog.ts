/* eslint-disable max-lines -- The maintained authored story catalog keeps complete chronological cassettes reviewable together. */
import { TaskId } from "@dalph/contracts"
import { makeTaskWorkSpecification } from "@dalph/orchestrator"
import { Option, Schema } from "effect"
import { AuthoredScenarioCassette } from "./authored.js"
import { AuthoredCassetteStoryItem } from "./authored-domain.js"

const decodeStoryItem = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)
const terminalStoryItemOffset = -1

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
export const singletonTaskCompletesAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
      ? [{ _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "B" } }]
      : [])
  ])
  .flatMap((item) => [
    ...(item._tag === "DalphSelects" && item.operation._tag === "ReadTaskWorkSpecification"
      ? [
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
          },
          { _tag: "TrackerGraphReadReturned" as const, graph: twoEligibleTasksGraph }
        ]
      : []),
    item
  ])
  .flatMap((item) => [
    ...(item._tag === "DalphSelects" && item.operation._tag === "RecordTaskAttemptPlan"
      ? [
          { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId: "B" } },
          {
            _tag: "TaskWorkSpecificationReadReturned" as const,
            body: "Implement the second eligible behavior.",
            taskId: "B",
            title: "Implement second task"
          }
        ]
      : []),
    item
  ])
  .flatMap((item) => [
    ...(item._tag === "DalphSelects" && item.operation._tag === "ReconcileTaskWorktree"
      ? [
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId: "attempt:B:1", taskId: "B" }
          }
        ]
      : []),
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
export const runPauseSafelySuspendsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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

/** Restart reconstructs Run Pause, safely suspends prior work, and performs no tracker read. */
export const runPauseRestartsPassivelyAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...runPauseSafelySuspendsAuthoredCassette,
  name: "a confirmed paused Run restarts without run-specific polling",
  story: [
    ...twoEligiblePlannedStoryBeforeRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Pause",
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
export const staleTaskPauseRejectedAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const unreadableTaskUnpauseRejectedAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
    if (item._tag === "ExpectedBehavior") {
      return [...taskControlMembershipRead(emptyTaskControlGraph), item]
    }
    return [item]
  })
})

/** Pausing A suspends its running attempt, then independent B uses the released task-work position. */
export const taskPauseLetsIndependentTaskContinueAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const taskPauseCoversGroupingChildAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
      subject: { _tag: "Task", taskId: "A" }
    },
    ...taskControlMembershipRead(groupingChildTasksGraph),
    singletonRunningExecutorReport,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: groupingChildTasksGraph },
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

const lostWorktreeStoryBeforeAssertions = singletonTaskCompletesAuthoredCassette.story.flatMap((item) => {
  if (item._tag === "ExpectedBehavior") return []
  return item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal"
    ? [{ _tag: "CoordinatorProcessDies" as const }]
    : [item]
})

/** After process death, the same running attempt records its disappeared worktree and suspends without repair. */
export const lostPlannedWorktreeSafelySuspendsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const changedAttemptContinuesAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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

const changedAttemptContinueRestartAt = changedAttemptContinuesAuthoredCassette.story.findLastIndex(
  (item) => item._tag === "CoordinatorProcessDies"
)

/** A later F3 observation invalidates F2's Continue authority and exposes one new F1/F3 choice. */
export const changedAgainAttemptRequiresNewChoiceAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const changedAttemptStopsAndReleasesAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const changedAttemptChoiceRaceAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
        expected: { _tag: "Applied", status: "SettledNoRelease" },
        observedTaskRevision: changedAttemptRevision,
        requestNonce,
        taskId: "A"
      },
      attemptChoiceExpectedBehavior
    ]
  })

/** Stop records the missing claim as a distinct terminal no-release disposition. */
export const changedAttemptStopsWithAbsentClaimAuthoredCassette = stoppedAttemptWithoutClaimMutationCassette(
  "Alice stops the exact changed attempt while its tracker claim is absent",
  "stop-changed-attempt-A-absent",
  { _tag: "UnclaimedTask", taskId: "A" }
)

/** Stop preserves a replacement claim owned by another actor. */
export const changedAttemptStopsWithForeignClaimAuthoredCassette = stoppedAttemptWithoutClaimMutationCassette(
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

const stoppedAttemptReleaseSelectedAt = changedAttemptStopsAndReleasesAuthoredCassette.story.findIndex(
  (item) => item._tag === "DalphSelects" && item.operation._tag === "ReleaseTaskClaim"
)

/** The tracker applies K1's release, loses the response, survives an unreadable activation, then settles absent. */
export const changedAttemptStopReleaseResponseLostAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)(
  {
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
  }
)

/** Unpause during suspension finishes that request, then freshly rereads every continuation authority. */
export const runUnpauseAfterSafeSuspensionAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
      subject: { _tag: "Run" }
    },
    singletonRunningExecutorReport,
    {
      _tag: "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
      direction: "Unpause",
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

/**
 * Alice stops after F2 while an already admitted continuation is held before intent;
 * later activations settle its lost response and the lost third Suspend without a duplicate command.
 */
export const changedAttemptStopLostThirdSuspensionAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)(
  {
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
      {
        _tag: "PlannedAttemptExecutorProjectionReturned",
        report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" }
      },
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
  }
)

const admittedContinuationResponseLostAt = changedAttemptStopLostThirdSuspensionAuthoredCassette.story.findIndex(
  (item) => item._tag === "PlannedAttemptExecutorResponseLost" && item.request === "StartOrContinue"
)
const unprovedStoppageActivationReturnAt = changedAttemptStopLostThirdSuspensionAuthoredCassette.story.findIndex(
  (item, index) => index > admittedContinuationResponseLostAt && item._tag === "CoordinatorActivationReturned"
)

/** A projected Running writer leaves Stop visibly pending and preserves every exact attempt resource. */
export const changedAttemptStopRemainsUnprovedAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const runUnpauseDuringSuspensionRestartsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses while exact suspension succeeds but its response is lost before restart",
  story: suspensionResponseLostAcrossRestart(
    runUnpauseAfterSafeSuspensionAuthoredCassette.story,
    "the exact Run suspension succeeded after Unpause, but the coordinator lost its response"
  )
})

/** Task Unpause finishes its in-flight suspension, then rereads the preserved attempt's authorities. */
export const taskUnpauseAfterSafeSuspensionAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const taskUnpauseDuringSuspensionRestartsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...taskUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses task A while exact suspension succeeds but its response is lost before restart",
  story: suspensionResponseLostAcrossRestart(
    taskUnpauseAfterSafeSuspensionAuthoredCassette.story,
    "the exact task suspension succeeded after Unpause, but the coordinator lost its response"
  )
})

/** After process death, the same attempt continues when Git proves the target advanced from its immutable Base. */
export const compatibleTargetAdvanceContinuesAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const incompatibleTargetRewriteSafelySuspendsAuthoredCassette = Schema.decodeUnknownSync(
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

/** The maintained dependency story proving one Run consumes a later complete graph observation. */
export const dependentTasksCompleteInOneRunAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
      verificationPlanId: null,
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
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
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
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: [
          { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
          { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
        ]
      }
    }
  ]
})

/**
 * A capacity contraction retains two already-running attempts across process
 * death and admits C only after both exact responsibilities settle.
 */
export const contractedCapacityRetainsTwoAttemptsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "B" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
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
    { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:C:2", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:C:2", taskId: "C" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", attemptId: "attempt:C:2", result: { _tag: "Completed" } },
      request: "StartOrContinue"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "RunActivationFinalTrackerGraphReadReturned", graph: threeEligibleTasksGraph },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
    },
    ...taskControlMembershipRead(threeEligibleTasksGraph),
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "RunActivationFinalTrackerGraphReadReturned", graph: threeEligibleTasksGraph },
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
export const acceptedResultRestartsIntoIntegrationAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)(
  {
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
  }
)

/** Alice cannot apply a stale pre-integration direction after integration has consumed the exact attempt. */
export const postIntegrationAttemptChoiceRejectedAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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

/** Conflict edits stay in one isolated candidate resource until an explicit exact submission. */
export const candidateConflictRecoveryAuthoredCassette = candidateScenarioFrom(
  "candidate conflict recovery stays in one isolated integration resource",
  [
    { _tag: "IntegrationCandidateAgentReported", report: { _tag: "Conflict" } },
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    },
    {
      _tag: "IntegrationCandidateGitValidationReturned",
      observation: {
        _tag: "Commit",
        directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      }
    }
  ],
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

/** A task paused after a recoverable candidate conflict finishes the held integration boundary without cleanup. */
export const taskPauseFinishesHeldIntegrationAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
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
export const candidateCorrectionAfterUnreadableGitAuthoredCassette = candidateScenarioFrom(
  "candidate correction rereads unreadable Git without charging the agent",
  [
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    },
    { _tag: "IntegrationCandidateGitValidationReturned", observation: { _tag: "Missing" } },
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }
    },
    { _tag: "IntegrationCandidateGitValidationFailed", detail: "repository temporarily unreadable" },
    {
      _tag: "IntegrationCandidateGitValidationReturned",
      observation: {
        _tag: "Commit",
        directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      }
    }
  ],
  "cccccccccccccccccccccccccccccccccccccccc",
  { _tag: "Passed", artifacts: [{ name: "verification-report", content: "all selected checks passed" }] }
)

/** A selected public verification plan reports failure and leaves the exact candidate unpromoted. */
export const candidateVerificationFailureAuthoredCassette = candidateScenarioFrom(
  "selected public verification fails without promotion",
  [
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    },
    { _tag: "IntegrationCandidateGitValidationReturned", observation: { _tag: "Missing" } },
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }
    },
    { _tag: "IntegrationCandidateGitValidationFailed", detail: "repository temporarily unreadable" },
    {
      _tag: "IntegrationCandidateGitValidationReturned",
      observation: {
        _tag: "Commit",
        directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      }
    }
  ],
  "cccccccccccccccccccccccccccccccccccccccc",
  { _tag: "Failed", artifacts: [{ name: "verification-report", content: "one selected check failed" }] }
)

/** A foreign wrapper correlation is durably contradicted before any evidence can authorize M. */
export const candidateVerificationContradictionAuthoredCassette = candidateScenarioFrom(
  "foreign public verification correlation fails closed",
  [
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    },
    { _tag: "IntegrationCandidateGitValidationReturned", observation: { _tag: "Missing" } },
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }
    },
    { _tag: "IntegrationCandidateGitValidationFailed", detail: "repository temporarily unreadable" },
    {
      _tag: "IntegrationCandidateGitValidationReturned",
      observation: {
        _tag: "Commit",
        directParents: ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
      }
    }
  ],
  "cccccccccccccccccccccccccccccccccccccccc",
  { _tag: "CorrelationContradiction" }
)

const promotionCandidateCommit = "cccccccccccccccccccccccccccccccccccccccc"
const promotionExpectedHead = "1111111111111111111111111111111111111111"

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
export const targetPromotionSuccessAuthoredCassette = promotionScenarioFrom(
  "promotes verified M by exact compare-and-set and records exact ancestry",
  [
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: promotionExpectedHead }
    },
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

/** Three lost mutation responses are each reconciled against H; exhaustion sends no fourth request. */
export const targetPromotionAmbiguityExhaustionAuthoredCassette = promotionScenarioFrom(
  "reconciles a lost promotion response and never sends a fourth request",
  [
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: promotionExpectedHead }
    },
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "attempt 1 response lost" },
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: promotionExpectedHead }
    },
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "attempt 2 response lost" },
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: promotionExpectedHead }
    },
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "attempt 3 response lost" },
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: promotionExpectedHead }
    }
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
export const targetPromotionStaleBeforeCompareAndSetAuthoredCassette = promotionScenarioFrom(
  "records stale H2 and never overwrites it",
  [
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: "2222222222222222222222222222222222222222" }
    }
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
export const targetPromotionLostResponseDiscoversCurrentCandidateAuthoredCassette = promotionScenarioFrom(
  "discovers M in current target ancestry after losing the promotion response",
  [
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: promotionExpectedHead }
    },
    { _tag: "TargetPromotionCompareAndSetResponseLost", detail: "Git applied M but the response was lost" },
    {
      _tag: "TargetPromotionGitReadReturned",
      observation: { _tag: "CandidateCurrent", currentHeadSha: promotionCandidateCommit }
    }
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
export const candidateCorrectionExhaustionAuthoredCassette = candidateScenarioFrom(
  "candidate correction exhaustion preserves non-convergent work",
  [
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    },
    { _tag: "IntegrationCandidateGitValidationReturned", observation: { _tag: "Missing" } },
    {
      _tag: "IntegrationCandidateAgentReported",
      report: { _tag: "Submitted", candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" }
    },
    { _tag: "IntegrationCandidateGitValidationReturned", observation: { _tag: "Commit", directParents: [] } }
  ],
  undefined
)

/** A misrouted response is preserved as a correlation contradiction and never reaches Git. */
export const candidateCorrelationContradictionAuthoredCassette = candidateScenarioFrom(
  "candidate correlation contradiction fails closed before Git",
  [{ _tag: "IntegrationCandidateAgentReported", report: { _tag: "CorrelationContradiction" } }],
  undefined
)

/** Public catalog consumed by acceptance tests, documentation, and Reducer Lab. */
const defineAuthoredCassetteCatalog = <const Name extends string>(
  catalog: Readonly<Record<Name, AuthoredScenarioCassette>>
): Readonly<Record<Name, AuthoredScenarioCassette>> => catalog

export const maintainedAuthoredCassetteCatalog = defineAuthoredCassetteCatalog({
  acceptedResultRestartsIntoIntegration: acceptedResultRestartsIntoIntegrationAuthoredCassette,
  postIntegrationAttemptChoiceRejected: postIntegrationAttemptChoiceRejectedAuthoredCassette,
  candidateConflictRecovery: candidateConflictRecoveryAuthoredCassette,
  candidateCorrectionAfterUnreadableGit: candidateCorrectionAfterUnreadableGitAuthoredCassette,
  candidateCorrectionExhaustion: candidateCorrectionExhaustionAuthoredCassette,
  candidateCorrelationContradiction: candidateCorrelationContradictionAuthoredCassette,
  candidateVerificationFailure: candidateVerificationFailureAuthoredCassette,
  candidateVerificationContradiction: candidateVerificationContradictionAuthoredCassette,
  candidateVerificationPassed: candidateCorrectionAfterUnreadableGitAuthoredCassette,
  targetPromotionSuccess: targetPromotionSuccessAuthoredCassette,
  targetPromotionAmbiguityExhaustion: targetPromotionAmbiguityExhaustionAuthoredCassette,
  targetPromotionStaleBeforeCompareAndSet: targetPromotionStaleBeforeCompareAndSetAuthoredCassette,
  targetPromotionLostResponseDiscoversCurrentCandidate:
    targetPromotionLostResponseDiscoversCurrentCandidateAuthoredCassette,
  changedAttemptContinues: changedAttemptContinuesAuthoredCassette,
  changedAttemptChoiceRace: changedAttemptChoiceRaceAuthoredCassette,
  changedAgainAttemptRequiresNewChoice: changedAgainAttemptRequiresNewChoiceAuthoredCassette,
  changedAttemptStopLostThirdSuspension: changedAttemptStopLostThirdSuspensionAuthoredCassette,
  changedAttemptStopRemainsUnproved: changedAttemptStopRemainsUnprovedAuthoredCassette,
  changedAttemptStopsAndReleases: changedAttemptStopsAndReleasesAuthoredCassette,
  changedAttemptStopReleaseResponseLost: changedAttemptStopReleaseResponseLostAuthoredCassette,
  changedAttemptStopsWithAbsentClaim: changedAttemptStopsWithAbsentClaimAuthoredCassette,
  changedAttemptStopsWithForeignClaim: changedAttemptStopsWithForeignClaimAuthoredCassette,
  compatibleTargetAdvanceContinues: compatibleTargetAdvanceContinuesAuthoredCassette,
  contractedCapacityRetainsTwoAttempts: contractedCapacityRetainsTwoAttemptsAuthoredCassette,
  dependentTasksCompleteInOneRun: dependentTasksCompleteInOneRunAuthoredCassette,
  incompatibleTargetRewriteSafelySuspends: incompatibleTargetRewriteSafelySuspendsAuthoredCassette,
  lostPlannedWorktreeSafelySuspends: lostPlannedWorktreeSafelySuspendsAuthoredCassette,
  runPauseRestartsPassively: runPauseRestartsPassivelyAuthoredCassette,
  runPauseSafelySuspends: runPauseSafelySuspendsAuthoredCassette,
  runUnpauseAfterSafeSuspension: runUnpauseAfterSafeSuspensionAuthoredCassette,
  runUnpauseDuringSuspensionRestarts: runUnpauseDuringSuspensionRestartsAuthoredCassette,
  staleTaskPauseRejected: staleTaskPauseRejectedAuthoredCassette,
  unreadableTaskUnpauseRejected: unreadableTaskUnpauseRejectedAuthoredCassette,
  taskPauseCoversGroupingChild: taskPauseCoversGroupingChildAuthoredCassette,
  taskPauseFinishesHeldIntegration: taskPauseFinishesHeldIntegrationAuthoredCassette,
  taskPauseLetsIndependentTaskContinue: taskPauseLetsIndependentTaskContinueAuthoredCassette,
  taskUnpauseAfterSafeSuspension: taskUnpauseAfterSafeSuspensionAuthoredCassette,
  taskUnpauseDuringSuspensionRestarts: taskUnpauseDuringSuspensionRestartsAuthoredCassette,
  singletonTaskCompletes: singletonTaskCompletesAuthoredCassette
})
