/* eslint-disable max-lines -- The maintained authored story catalog keeps complete chronological cassettes reviewable together. */
import { Schema } from "effect"
import { AuthoredScenarioCassette } from "./authored.js"

const singletonGraph = {
  revision: "singleton-revision",
  tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
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

/** Public catalog consumed by acceptance tests, documentation, and Reducer Lab. */
export const maintainedAuthoredCassetteCatalog = {
  acceptedResultRestartsIntoIntegration: acceptedResultRestartsIntoIntegrationAuthoredCassette,
  compatibleTargetAdvanceContinues: compatibleTargetAdvanceContinuesAuthoredCassette,
  dependentTasksCompleteInOneRun: dependentTasksCompleteInOneRunAuthoredCassette,
  incompatibleTargetRewriteSafelySuspends: incompatibleTargetRewriteSafelySuspendsAuthoredCassette,
  lostPlannedWorktreeSafelySuspends: lostPlannedWorktreeSafelySuspendsAuthoredCassette,
  singletonTaskCompletes: singletonTaskCompletesAuthoredCassette
} as const
