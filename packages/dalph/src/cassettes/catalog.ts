/* eslint-disable max-lines -- The maintained authored story catalog keeps complete chronological cassettes reviewable together. */
import { Option, Schema } from "effect"
import { AuthoredScenarioCassette } from "./authored.js"

const singletonGraph = {
  revision: "singleton-revision",
  tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
}

const twoEligibleTasksGraph = {
  revision: "two-eligible-tasks-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const groupingChildTasksGraph = {
  revision: "grouping-child-tasks-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
  ]
}

const independentRecoveryGraph = {
  revision: "independent-recovery-revision",
  tasks: [
    { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
  ]
}

const independentRecoveryStartingGraph = {
  revision: "independent-recovery-starting-revision",
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
      executor: "executor:controlled-fake",
      integrationTarget: { repository: "/dalph/cassettes/repository.git", ref: "refs/heads/master" },
      target: "cassette-target",
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
    ...(item._tag === "DalphSelects" && item.operation._tag === "ReadTaskWorkSpecification"
      ? [{ _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "B" } }]
      : []),
    item
  ])
  .flatMap((item) => [
    ...(item._tag === "DalphSelects" && item.operation._tag === "RecordTaskAttemptPlan"
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
    ...(item._tag === "DalphSelects" && item.operation._tag === "ReconcileTaskWorktree"
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
const twoEligiblePlannedStoryBeforeRunningExecutorReport = [
  ...twoEligibleStoryBeforeRunningExecutorReport,
  {
    _tag: "DalphSelects" as const,
    operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId: "attempt:B:1", taskId: "B" }
  }
]
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
    { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "TaskAttemptPlanned", attemptId: "attempt:B:1", taskId: "B" },
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
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: twoEligibleTasksGraph },
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
        { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
        { _tag: "TaskAttemptPlanned", attemptId: "attempt:B:1", taskId: "B" },
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

/** A recovered running attempt records its disappeared worktree and suspends without repairing it. */
export const lostPlannedWorktreeSafelySuspendsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "a disappeared planned worktree safely suspends only its recovered attempt",
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

const targetLineageRecoveryReads = [
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
    ...targetLineageRecoveryReads,
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

/** Recovery preserves an in-flight suspension across an Unpause and process death. */
export const runUnpauseDuringSuspensionRestartsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses during exact suspension before the coordinator restarts",
  story: runUnpauseAfterSafeSuspensionAuthoredCassette.story.flatMap((item) => [
    item,
    ...(item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" && item.direction === "Unpause"
      ? [{ _tag: "CoordinatorProcessDies" as const }]
      : [])
  ])
})

/** Task Unpause finishes its in-flight suspension, then rereads the preserved attempt's authorities. */
export const taskUnpauseAfterSafeSuspensionAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...runUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses task A while its exact executor suspension is in flight",
  story: runUnpauseAfterSafeSuspensionAuthoredCassette.story.map((item) => {
    if (item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight") {
      return { ...item, subject: { _tag: "Task" as const, taskId: "A" } }
    }
    if (item._tag !== "ExpectedBehavior" || item.protocol === null) return item
    return {
      ...item,
      protocol: item.protocol.map((evidence) =>
        evidence._tag === "ControlDirectionApplied"
          ? { ...evidence, subject: { _tag: "Task" as const, taskId: "A" } }
          : evidence
      )
    }
  })
})

/** Recovery preserves task Unpause while the exact suspension result remains unresolved. */
export const taskUnpauseDuringSuspensionRestartsAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...taskUnpauseAfterSafeSuspensionAuthoredCassette,
  name: "Alice unpauses task A during exact suspension before the coordinator restarts",
  story: taskUnpauseAfterSafeSuspensionAuthoredCassette.story.flatMap((item) => [
    item,
    ...(item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" && item.direction === "Unpause"
      ? [{ _tag: "CoordinatorProcessDies" as const }]
      : [])
  ])
})

/** A recovered attempt continues when Git proves the target advanced from its immutable Base. */
export const compatibleTargetAdvanceContinuesAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "a compatible target advance keeps the recovered attempt eligible",
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
    ...targetLineageRecoveryReads,
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

/** A recovered attempt safely suspends when Git proves the target left its immutable Base lineage. */
export const incompatibleTargetRewriteSafelySuspendsAuthoredCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "an incompatible target rewrite safely suspends only its recovered attempt",
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
    trackerGraph: independentRecoveryStartingGraph
  },
  story: [
    ...lostWorktreeStoryBeforeAssertions.map((item) =>
      item._tag === "TrackerGraphReadReturned" ? { ...item, graph: independentRecoveryStartingGraph } : item
    ),
    ...targetLineageRecoveryReads,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentRecoveryGraph },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentRecoveryGraph },
    { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentRecoveryGraph },
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
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: independentRecoveryGraph },
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
      executor: "executor:controlled-fake",
      integrationTarget: { repository: "/dalph/cassettes/pipeline.git", ref: "refs/heads/master" },
      target: "pipeline-cassette-target",
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
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "pipeline-cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: releasedPipelineGraph },
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

/** Accepted executor output remains ordered by journal position and starts integration after process recovery. */
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
        executor: "executor:controlled-fake",
        integrationTarget: { repository: "/dalph/cassettes/integration.git", ref: "refs/heads/master" },
        target: "cassette-target",
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

const candidateScenarioFrom = (
  name: string,
  candidateStory: ReadonlyArray<unknown>,
  constructedCommit: string | undefined
) => {
  const baseStory = acceptedResultRestartsIntoIntegrationAuthoredCassette.story
  const finalBlockedGraphIndex = baseStory.findLastIndex(
    (item) => item._tag === "TrackerGraphReadReturned" && item.graph.revision === acceptedResultBlockedGraph.revision
  )
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...acceptedResultRestartsIntoIntegrationAuthoredCassette,
    name,
    story: baseStory.flatMap((item, index) => {
      if (index === finalBlockedGraphIndex - 1 || index === finalBlockedGraphIndex) return []
      if (item._tag === "TrackerGraphReadReturned" && item.graph.revision === acceptedResultBlockedGraph.revision) {
        return [{ ...item, graph: singletonGraph }]
      }
      if (item._tag !== "ExpectedBehavior") return [item]
      const constructedEvidence =
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
      return [
        { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
        ...candidateStory,
        {
          ...item,
          /* v8 ignore next -- @preserve Maintained candidate cassettes all declare the orchestration assertion lens. */
          orchestration: item.orchestration === null ? null : [...item.orchestration, ...constructedEvidence]
        }
      ]
    })
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

/** A task paused after target acquisition finishes the already-started candidate boundary without later cleanup. */
const encodedCandidateConflictRecovery = Schema.encodeSync(AuthoredScenarioCassette)(
  candidateConflictRecoveryAuthoredCassette
)
export const taskPauseFinishesHeldIntegrationAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...encodedCandidateConflictRecovery,
  name: "Alice pauses task A after its integration target is held",
  story: encodedCandidateConflictRecovery.story.flatMap((item) =>
    item._tag === "DalphSelects" && item.operation._tag === "ReadTargetLineage"
      ? [
          {
            _tag: "OperatorAppliesControlDirection" as const,
            direction: "Pause" as const,
            subject: { _tag: "Task" as const, taskId: "A" }
          },
          item
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
  "cccccccccccccccccccccccccccccccccccccccc"
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
export const maintainedAuthoredCassetteCatalog = {
  acceptedResultRestartsIntoIntegration: acceptedResultRestartsIntoIntegrationAuthoredCassette,
  candidateConflictRecovery: candidateConflictRecoveryAuthoredCassette,
  candidateCorrectionAfterUnreadableGit: candidateCorrectionAfterUnreadableGitAuthoredCassette,
  candidateCorrectionExhaustion: candidateCorrectionExhaustionAuthoredCassette,
  candidateCorrelationContradiction: candidateCorrelationContradictionAuthoredCassette,
  compatibleTargetAdvanceContinues: compatibleTargetAdvanceContinuesAuthoredCassette,
  dependentTasksCompleteInOneRun: dependentTasksCompleteInOneRunAuthoredCassette,
  incompatibleTargetRewriteSafelySuspends: incompatibleTargetRewriteSafelySuspendsAuthoredCassette,
  lostPlannedWorktreeSafelySuspends: lostPlannedWorktreeSafelySuspendsAuthoredCassette,
  runPauseRestartsPassively: runPauseRestartsPassivelyAuthoredCassette,
  runPauseSafelySuspends: runPauseSafelySuspendsAuthoredCassette,
  runUnpauseAfterSafeSuspension: runUnpauseAfterSafeSuspensionAuthoredCassette,
  runUnpauseDuringSuspensionRestarts: runUnpauseDuringSuspensionRestartsAuthoredCassette,
  taskPauseCoversGroupingChild: taskPauseCoversGroupingChildAuthoredCassette,
  taskPauseFinishesHeldIntegration: taskPauseFinishesHeldIntegrationAuthoredCassette,
  taskPauseLetsIndependentTaskContinue: taskPauseLetsIndependentTaskContinueAuthoredCassette,
  taskUnpauseAfterSafeSuspension: taskUnpauseAfterSafeSuspensionAuthoredCassette,
  taskUnpauseDuringSuspensionRestarts: taskUnpauseDuringSuspensionRestartsAuthoredCassette,
  singletonTaskCompletes: singletonTaskCompletesAuthoredCassette
} as const
