/* eslint-disable max-lines -- The maintained capstone keeps one chronological DS01-17 story in one cassette. */
import { Schema } from "effect"
import { makeTaskWorkSpecification, TaskId } from "@dalph/contracts"
import { AuthoredScenarioCassette, type AuthoredScenarioCassette as ScenarioCassette } from "./authored.js"

const graph = {
  revision: "ds-probe-G0",
  rootTaskId: "A",
  tasks: ["A", "B", "C", "D", "E"].map((id) => ({
    id,
    lifecycle: { _tag: "Open" as const },
    parentTaskId: null,
    prerequisiteIds: []
  }))
}

const graphG1 = { ...graph, revision: "ds-probe-G1" }

const graphG2 = {
  ...graphG1,
  revision: "ds-probe-G2",
  tasks: graphG1.tasks.map((task) =>
    task.id === "C" ? { ...task, lifecycle: { _tag: "TerminalWithoutSuccess" as const } } : task
  )
}

const graphG3 = {
  ...graphG2,
  revision: "ds-probe-G3",
  tasks: graphG2.tasks.map((task) =>
    task.id === "A" ? { ...task, lifecycle: { _tag: "CompletedSuccessfully" as const } } : task
  )
}

const specification = (taskId: string) => ({
  body: `Implement task ${taskId}.`,
  taskId: TaskId.make(taskId),
  title: `Implement ${taskId}`
})

const changedSpecification = {
  body: "Alice changed task B instructions.",
  taskId: TaskId.make("B"),
  title: "Changed B"
}
const changedRevision = makeTaskWorkSpecification(changedSpecification).fingerprint

const acceptedCommitA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const expectedHead = "1111111111111111111111111111111111111111"
const staleTargetHead = "2222222222222222222222222222222222222222"
const successorCandidateCommit = "dddddddddddddddddddddddddddddddddddddddd"
const integratorCandidateA = "refs/heads/dalph/integrator-candidate-A"
const integratorSuccessorCandidateA = "refs/heads/dalph/integrator-candidate-A-successor"
const initialCandidateTargetLineageObservedAt = 156
const promotionStaleQuarantineAt = 187
const successorTargetLineageObservedAt = 234
const initialAttempts = [
  { taskId: "A", attemptId: "attempt:A:0" },
  { taskId: "B", attemptId: "attempt:B:1" },
  { taskId: "C", attemptId: "attempt:C:2" }
] as const
const integratorSessionCorrelationA = (targetLineageObservedAt: number) => {
  const suffix = `$authored-run:attempt:A:0:148:${targetLineageObservedAt}:${expectedHead}:${acceptedCommitA}:/dalph/cassettes/ds-probe.git:refs/heads/master`
  return {
    acceptedResult: {
      commit: acceptedCommitA,
      evidenceManifest: { byteLength: 273, digest: "1111111111111111111111111111111111111111111111111111111111111111" }
    },
    candidateResource: `integrator-resource:${suffix}`,
    expectedTargetHead: expectedHead,
    integrationTarget: { repository: "/dalph/cassettes/ds-probe.git", ref: "refs/heads/master" },
    plannedAttempt: {
      attemptId: "attempt:A:0",
      baseSha: expectedHead,
      branch: "refs/heads/dalph/attempt-A-0",
      executor: "executor:ds-probe",
      runId: "$authored-run",
      taskId: "A",
      taskRevision: makeTaskWorkSpecification(specification("A")).fingerprint,
      worktree: "/dalph/cassettes/ds-probe/attempt-A-0"
    },
    queuedAt: 141,
    sessionId: `integrator-session:${suffix}`,
    startedAt: 148,
    targetLineageObservedAt
  }
}

const integratorSuccessorSessionCorrelationA = (targetLineageObservedAt: number, directionAppliedAt = 188) => {
  const predecessor = integratorSessionCorrelationA(initialCandidateTargetLineageObservedAt)
  const material = [
    "full-rerun-successor",
    predecessor.sessionId,
    predecessor.candidateResource,
    predecessor.plannedAttempt.runId,
    predecessor.plannedAttempt.attemptId,
    predecessor.startedAt,
    promotionStaleQuarantineAt,
    directionAppliedAt,
    targetLineageObservedAt,
    staleTargetHead,
    predecessor.acceptedResult.commit,
    predecessor.integrationTarget.repository,
    predecessor.integrationTarget.ref
  ].join(":")
  return {
    ...predecessor,
    candidateResource: `integrator-resource:${material}`,
    expectedTargetHead: staleTargetHead,
    sessionId: `integrator-session:${material}`,
    targetLineageObservedAt
  }
}

const graphRead = [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "ds-probe-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph }
]

const graphReadG1 = [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "ds-probe-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph: graphG1 }
]

const graphReadG2 = [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "ds-probe-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph: graphG2 }
]

const graphReadG3 = [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "ds-probe-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph: graphG3 }
]

const specRead = (taskId: string) => [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId } },
  { _tag: "TaskWorkSpecificationReadReturned" as const, ...specification(taskId) }
]

const plan = (taskId: string, attemptId: string) => ({
  _tag: "DalphSelects" as const,
  operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId, taskId }
})

const worktree = (taskId: string, attemptId: string) => ({
  _tag: "DalphSelects" as const,
  operation: { _tag: "ReconcileTaskWorktree" as const, attemptId, taskId }
})

export const deliveryStoryCapstoneAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "DS01-17 accepted capacity, restart, stale-head, and FullRerun chronology",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: ["A", "B", "C", "D", "E"].map(specification),
    trackerGraph: graph,
    targetLineageObservations: [
      ...Array.from({ length: 11 }, () => ({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: expectedHead,
        targetHeadSha: expectedHead
      })),
      // DS17 performs one fresh H2 read for the applied FullRerun direction
      // and one more after the distinct successor candidate is observed.
      { plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: expectedHead, targetHeadSha: staleTargetHead },
      { plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: expectedHead, targetHeadSha: staleTargetHead }
    ],
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 3 } },
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      claimOwner: "ds-probe-owner",
      claimTokenPrefix: "ds-probe-claim",
      executor: "executor:ds-probe",
      integrationTarget: { repository: "/dalph/cassettes/ds-probe.git", ref: "refs/heads/master" },
      target: "ds-probe-target",
      targetPromotionConfigured: true,
      worktreeRoot: "/dalph/cassettes/ds-probe"
    },
    ...graphRead,
    ...graphRead,
    ...graphRead,
    ...graphRead,
    ...graphRead,
    ...graphRead,
    { _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "A" } },
    { _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "B" } },
    { _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "C" } },
    { _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "D" } },
    { _tag: "DalphSelects" as const, operation: { _tag: "AcquireTaskClaim" as const, taskId: "E" } },
    ...graphRead,
    ...graphRead,
    ...graphRead,
    ...graphRead,
    ...graphRead,
    ...["A", "B", "C"].flatMap(specRead),
    ...specRead("D"),
    ...specRead("E"),
    ...initialAttempts.map(({ attemptId, taskId }) => plan(taskId, attemptId)),
    plan("D", "attempt:D:3"),
    plan("E", "attempt:E:4"),
    ...initialAttempts.map(({ attemptId, taskId }) => worktree(taskId, attemptId)),
    worktree("D", "attempt:D:3"),
    worktree("E", "attempt:E:4"),
    {
      _tag: "DalphHoldsExecutorProgressAdmissionUntilReportBatchReady",
      members: initialAttempts.map(({ attemptId, taskId }) => ({
        attemptId,
        request: "StartOrContinue" as const,
        taskId
      }))
    },
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
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:C:2" },
      request: "StartOrContinue"
    },
    { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "B" },
    { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "A" },
    ...graphReadG1,
    {
      _tag: "DalphHoldsExecutorProgressAdmissionUntilReportBatchReady",
      members: [
        { attemptId: "attempt:C:2", request: "StartOrContinue", taskId: "C" },
        { attemptId: "attempt:B:1", request: "Suspend", taskId: "B" },
        { attemptId: "attempt:A:0", request: "StartOrContinue", taskId: "A" }
      ]
    },
    ...specRead("C"),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:C:2" },
      request: "StartOrContinue"
    },
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "B" },
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId: "B" } },
    { _tag: "TaskWorkSpecificationReadReturned" as const, ...changedSpecification },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:B:1" },
      request: "Suspend"
    },
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "A" },
    ...specRead("A"),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "C" },
    { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "A" },
    ...graphReadG1,
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:D:3" },
      request: "StartOrContinue"
    },
    ...graphReadG1,
    { _tag: "SetTaskExecutionCapacity", capacity: 2 },
    { _tag: "CoordinatorProcessDies" },
    ...graphReadG1,
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "C" },
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "A" },
    ...specRead("A"),
    ...specRead("C"),
    ...specRead("D"),
    { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "C" },
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned" as const, taskId: "A" },
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId: "C" } },
    { _tag: "TaskClaimCurrentReadReturned" as const, taskId: "C" },
    {
      _tag: "DalphSelects" as const,
      operation: { _tag: "ReadTaskWorktree" as const, attemptId: "attempt:A:0", taskId: "A" }
    },
    { _tag: "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary", taskId: "D" },
    { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned" as const, taskId: "D" },
    {
      _tag: "DalphSelects" as const,
      operation: { _tag: "ReadTaskWorktree" as const, attemptId: "attempt:C:2", taskId: "C" }
    },
    {
      _tag: "DalphSelects" as const,
      operation: { _tag: "ReadTargetLineage" as const, attemptId: "attempt:A:0", taskId: "A" }
    },
    {
      _tag: "DalphSelects" as const,
      operation: { _tag: "ReadTaskWorktree" as const, attemptId: "attempt:D:3", taskId: "D" }
    },
    {
      _tag: "DalphSelects" as const,
      operation: { _tag: "ReadTargetLineage" as const, attemptId: "attempt:C:2", taskId: "C" }
    },
    {
      _tag: "DalphSelects" as const,
      operation: { _tag: "ReadTargetLineage" as const, attemptId: "attempt:D:3", taskId: "D" }
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:C:2" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:D:3" },
      request: "StartOrContinue"
    },
    ...graphReadG1,
    ...graphReadG2,
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "C" },
    ...specRead("C"),
    { _tag: "CassetteReleasesHeldTaskWorkSpecificationRead", taskId: "D" },
    ...specRead("D"),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: {
        _tag: "Terminal",
        attemptId: "attempt:A:0",
        result: { _tag: "Accepted", acceptedResult: { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
      },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:C:2" },
      request: "Suspend"
    },
    {
      _tag: "OperatorContinuesAttempt",
      attemptId: "attempt:B:1",
      expected: { _tag: "Applied" },
      observedTaskRevision: changedRevision,
      requestNonce: "continue-B-after-C-safe",
      taskId: "B"
    },
    ...specRead("D"),
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "ds-probe-target" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "TrackerGraphReadReturned", graph: graphG1 },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:D:3", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" } },
    { _tag: "TaskWorkSpecificationReadReturned", ...changedSpecification },
    ...specRead("C"),
    ...specRead("D"),
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "B" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "C" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "C" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    {
      _tag: "IntegratorRequestReceived",
      correlation: integratorSessionCorrelationA(initialCandidateTargetLineageObservedAt)
    },
    { _tag: "IntegratorResultReturned", result: { _tag: "PreparedCandidate", candidateText: integratorCandidateA } },
    {
      _tag: "IntegratorGitObservationReturned",
      candidateText: integratorCandidateA,
      observation: {
        _tag: "Commit",
        candidateText: integratorCandidateA,
        commit: "cccccccccccccccccccccccccccccccccccccccc",
        directParents: [expectedHead, acceptedCommitA]
      }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:C:2", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:D:3", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:C:2", taskId: "C" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:D:3", taskId: "D" } },
    {
      _tag: "TargetPromotionGitReadReturned",
      candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: expectedHead },
      repository: "/dalph/cassettes/ds-probe.git"
    },
    {
      _tag: "TargetPromotionCompareAndSetReturned",
      result: { _tag: "RejectedExpectedHead", observedHeadSha: staleTargetHead }
    },
    {
      _tag: "OperatorAppliesIntegrationQuarantineDirection",
      expected: "Applied",
      request: {
        fingerprint: {
          direction: "FullRerun",
          quarantineAt: promotionStaleQuarantineAt,
          sessionId: integratorSessionCorrelationA(initialCandidateTargetLineageObservedAt).sessionId
        },
        requestId: { nonce: "full-rerun-A", runId: "$authored-run" }
      }
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:B:1" },
      request: "StartOrContinue"
    },
    { _tag: "CoordinatorProcessDies" },
    ...graphReadG2,
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    ...specRead("B"),
    ...specRead("D"),
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "B" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:D:3", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:D:3", taskId: "D" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:D:3" },
      request: "StartOrContinue"
    },
    ...graphReadG2,
    ...specRead("B"),
    ...specRead("D"),
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "B" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "D" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:D:3", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:B:1", taskId: "B" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:D:3", taskId: "D" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
    {
      _tag: "IntegratorRequestReceived",
      correlation: integratorSuccessorSessionCorrelationA(successorTargetLineageObservedAt)
    },
    {
      _tag: "IntegratorResultReturned",
      result: { _tag: "PreparedCandidate", candidateText: integratorSuccessorCandidateA }
    },
    {
      _tag: "IntegratorGitObservationReturned",
      candidateText: integratorSuccessorCandidateA,
      observation: {
        _tag: "Commit",
        candidateText: integratorSuccessorCandidateA,
        commit: successorCandidateCommit,
        directParents: [staleTargetHead, acceptedCommitA]
      }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
    {
      _tag: "TargetPromotionGitReadReturned",
      candidateCommit: successorCandidateCommit,
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: staleTargetHead },
      repository: "/dalph/cassettes/ds-probe.git"
    },
    { _tag: "TargetPromotionCompareAndSetReturned", result: { _tag: "Applied" } },
    { _tag: "CompletionClaimReadReturned", claim: "Active", taskId: "A" },
    { _tag: "CompletionClaimReplacementApplied", taskId: "A" },
    { _tag: "CompletionTaskFocusedReadReturned", lifecycle: "Open", taskId: "A", unfinishedPrerequisiteTaskIds: [] },
    {
      _tag: "TargetPromotionGitReadReturned",
      candidateCommit: successorCandidateCommit,
      observation: { _tag: "CandidateCurrent", currentHeadSha: successorCandidateCommit },
      repository: "/dalph/cassettes/ds-probe.git"
    },
    { _tag: "CompletionTaskRequestReturned", outcome: "Acknowledged", taskId: "A" },
    {
      _tag: "CompletionTaskFocusedReadReturned",
      lifecycle: "CompletedSuccessfully",
      taskId: "A",
      unfinishedPrerequisiteTaskIds: []
    },
    { _tag: "CompletionClaimReadReturned", claim: "Completion", taskId: "A" },
    { _tag: "CompletionClaimDeletionApplied", taskId: "A" },
    ...graphReadG3,
    ...graphReadG3,
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: [{ _tag: "PlannedWorkForTaskAccepted", commit: acceptedCommitA, taskId: "A" }]
      }
    }
  ]
})
