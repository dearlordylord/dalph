import { Schema } from "effect"
import { makeTaskWorkSpecification, TaskId } from "@dalph/contracts"
import {
  IntegratorSessionCorrelation,
  integratorSuccessorCorrelationFor,
  JournalPosition,
  TargetLineageObservation
} from "@dalph/orchestrator"
import { AuthoredScenarioCassette } from "./authored-domain.js"

const names = ["A", "B", "C", "D", "E", "F", "G"] as const
const orderedNames: ReadonlyArray<string> = names
const initialNames = names.slice(0, names.indexOf("E") + 1)
const target = "delivery-capstone-target"
const repository = "/dalph/cassettes/delivery-capstone.git"
const integrationTarget = { repository, ref: "refs/heads/master" }
const worktreeRoot = "/dalph/cassettes/delivery-capstone"
const executor = "executor:delivery-capstone"
const shaLength = 40
const digestLength = 64
const acceptedCommitOffset = 3
const candidateCommitPatternWidth = 2
const admissionClaimGraphEnd = 3
const admissionSpecificationEnd = 5
const predecessorPositions = { queuedAt: 134, startedAt: 135, targetLineageObservedAt: 137 }
const cPositions = { queuedAt: 317, startedAt: 320, targetLineageObservedAt: 324 }
const dPositions = { queuedAt: 373, startedAt: 376, targetLineageObservedAt: 380 }
const ePositions = { queuedAt: 425, startedAt: 426, targetLineageObservedAt: 430 }
const fPositions = { queuedAt: 466, startedAt: 467, targetLineageObservedAt: 475 }
const gPositions = { queuedAt: 511, startedAt: 512, targetLineageObservedAt: 520 }
const bIntegrationPositions = { queuedAt: 267, startedAt: 270, targetLineageObservedAt: 273 }
const rerunPositions = { quarantineAt: 146, directionAppliedAt: 147, targetLineageObservedAt: 149 }
const initialHead = "1".repeat(shaLength)
const changedHead = "2".repeat(shaLength)
const successorCommit = "d".repeat(shaLength)
const attempt = (taskId: string) =>
  `attempt:${taskId}:${taskId === "D" || taskId === "E" || taskId === "G" ? 0 : taskId === "F" ? 1 : ["A", "C", "B"].indexOf(taskId)}`
const specification = (taskId: string) => ({
  taskId: TaskId.make(taskId),
  title: `Implement ${taskId}`,
  body: `Implement task ${taskId}.`
})
const changedSpecification = {
  taskId: TaskId.make("B"),
  title: "Changed B",
  body: "Alice changed task B instructions."
}
const graph = (revision: string, completed: ReadonlyArray<string> = [], closedC = false, expanded = false) => ({
  revision,
  rootTaskId: "A",
  tasks: (expanded ? names : initialNames).map((id) => ({
    id,
    lifecycle: {
      _tag: completed.includes(id) ? "CompletedSuccessfully" : closedC && id === "C" ? "TerminalWithoutSuccess" : "Open"
    },
    parentTaskId: null,
    prerequisiteIds: []
  }))
})
const graphs = {
  G0: graph("G0"),
  G1: graph("G1"),
  G2: graph("G2", [], true),
  G3: graph("G3", ["A"], true),
  G4: graph("G4", ["A"]),
  G5: graph("G5", ["A"], false, true),
  Gfinal: graph("Gfinal", names, false, true)
}
const select = (operation: unknown) => ({ _tag: "DalphSelects", operation })
const readGraph = (value: ReturnType<typeof graph>) => [
  select({ _tag: "ReadTrackerGraph", target }),
  { _tag: "TrackerGraphReadReturned", graph: value }
]
const readSpecification = (taskId: string) => [
  select({ _tag: "ReadTaskWorkSpecification", taskId }),
  { _tag: "TaskWorkSpecificationReadReturned", ...(taskId === "B" ? changedSpecification : specification(taskId)) }
]
const readCurrent = (taskId: string) => [
  ...readSpecification(taskId),
  select({ _tag: "ReadTaskClaim", taskId }),
  { _tag: "TaskClaimCurrentReadReturned", taskId },
  select({ _tag: "ReadTaskWorktree", taskId, attemptId: attempt(taskId) }),
  select({ _tag: "ReadTargetLineage", taskId, attemptId: attempt(taskId) })
]
const report = (taskId: string, request: "Begin" | "Resume" | "Suspend") => ({
  _tag: "PlannedAttemptExecutorWorkReported",
  request,
  report: {
    _tag: request === "Suspend" ? "ExecutorWorkSafelySuspended" : "ExecutorWorkExecuting",
    attemptId: attempt(taskId)
  }
})
const acceptedCommit = (taskId: string) => `${orderedNames.indexOf(taskId) + acceptedCommitOffset}`.repeat(shaLength)
const candidateCommit = (taskId: string) =>
  `a${orderedNames.indexOf(taskId)}`.repeat(shaLength / candidateCommitPatternWidth)
const terminal = (taskId: string) => ({
  _tag: "PlannedAttemptExecutorPassiveLifecycleChanged",
  report: {
    _tag: "ExecutorWorkTerminal",
    attemptId: attempt(taskId),
    result: { _tag: "Accepted", acceptedResult: { commit: acceptedCommit(taskId) } }
  }
})
const planTaskWorktree = (taskId: string) => [
  select({ _tag: "ReadTaskWorkSpecification", taskId }),
  { _tag: "TaskWorkSpecificationReadReturned", ...specification(taskId) },
  select({ _tag: "RecordTaskAttemptPlan", taskId, attemptId: attempt(taskId) }),
  select({ _tag: "ReconcileTaskWorktree", taskId, attemptId: attempt(taskId) })
]
const admission = (taskId: string, value: ReturnType<typeof graph>, initial = false) => [
  select({ _tag: "AcquireTaskClaim", taskId }),
  ...readGraph(value),
  ...(initial ? readGraph(value) : []),
  ...(initial && taskId === "A" ? readGraph(value) : []),
  ...planTaskWorktree(taskId),
  report(taskId, "Begin")
]
const gitRead = (candidateCommit: string, head: string) => ({
  _tag: "TargetPromotionGitReadReturned",
  repository,
  candidateCommit,
  observation: { _tag: head === candidateCommit ? "CandidateCurrent" : "CandidateNotInAncestry", currentHeadSha: head }
})
const completion = (taskId: string, candidateCommit: string) => [
  { _tag: "CompletionClaimReadReturned", claim: "Active", taskId },
  { _tag: "CompletionClaimReplacementApplied", taskId },
  { _tag: "CompletionTaskFocusedReadReturned", lifecycle: "Open", taskId, unfinishedPrerequisiteTaskIds: [] },
  gitRead(candidateCommit, candidateCommit),
  { _tag: "CompletionTaskRequestReturned", outcome: "Acknowledged", taskId },
  {
    _tag: "CompletionTaskFocusedReadReturned",
    lifecycle: "CompletedSuccessfully",
    taskId,
    unfinishedPrerequisiteTaskIds: []
  },
  { _tag: "CompletionClaimReadReturned", claim: "CompletionMarker", taskId },
  { _tag: "TaskClaimCurrentReadReturned", taskId },
  select({ _tag: "ReleaseTaskClaim", taskId }),
  { _tag: "TaskClaimCurrentReadReturned", taskId },
  { _tag: "CompletionClaimReadReturned", claim: "CompletionMarker", taskId },
  { _tag: "TaskClaimCurrentReadReturned", taskId },
  { _tag: "CompletionClaimDeletionApplied", taskId },
  { _tag: "CompletionClaimReadReturned", claim: "CompletionMarkerAbsent", taskId },
  { _tag: "TaskClaimCurrentReadReturned", taskId }
]

// Boundary expectations are exact correlations; the diagnostic must reject a mismatched position.
const session = (
  taskId: string,
  head: string,
  queuedAt: number,
  startedAt: number,
  targetLineageObservedAt: number
) => {
  const suffix = `$authored-run:${attempt(taskId)}:${startedAt}:${targetLineageObservedAt}:${head}:${acceptedCommit(taskId)}:${repository}:refs/heads/master`
  return {
    acceptedResult: {
      commit: acceptedCommit(taskId),
      evidenceManifest: { byteLength: 285, digest: "1".repeat(digestLength) }
    },
    candidateResource: `integrator-resource:${suffix}`,
    expectedTargetHead: head,
    integrationTarget,
    plannedAttempt: {
      attemptId: attempt(taskId),
      baseSha: initialHead,
      branch: `refs/heads/dalph/${attempt(taskId).replaceAll(":", "-")}`,
      executor,
      runId: "$authored-run",
      taskId,
      taskRevision: makeTaskWorkSpecification(specification(taskId)).fingerprint,
      worktree: `${worktreeRoot}/${attempt(taskId).replaceAll(":", "-")}`
    },
    queuedAt,
    sessionId: `integrator-session:${suffix}`,
    startedAt,
    targetLineageObservedAt
  }
}
const prepareIntegration = (taskId: string, head: string, candidateCommit: string, positions: typeof predecessorPositions) => [
  select({ _tag: "ReadTargetLineage", taskId, attemptId: attempt(taskId) }),
  {
    _tag: "IntegratorRequestReceived",
    correlation: {
      ordinal: 1,
      session: session(
        taskId,
        head,
        positions.queuedAt,
        positions.startedAt,
        positions.targetLineageObservedAt
      )
    }
  },
  {
    _tag: "IntegratorResultReturned",
    result: { _tag: "PreparedCandidate", candidateText: `refs/heads/candidate-${taskId}` }
  },
  {
    _tag: "IntegratorGitObservationReturned",
    candidateText: `refs/heads/candidate-${taskId}`,
    observation: {
      _tag: "Commit",
      candidateText: `refs/heads/candidate-${taskId}`,
      commit: candidateCommit,
      directParents: [head, acceptedCommit(taskId)]
    }
  }
]
const promoteAndComplete = (taskId: string, head: string, candidateCommit: string) => [
  gitRead(candidateCommit, head),
  {
    _tag: "TargetPromotionCompareAndSetReturned",
    request: { integrationTarget, candidateCommit, expectedTargetHead: head },
    result: { _tag: "Applied" }
  },
  ...completion(taskId, candidateCommit)
]
const integrate = (taskId: string, head: string, candidateCommit: string, positions = predecessorPositions) => [
  ...prepareIntegration(taskId, head, candidateCommit, positions),
  ...promoteAndComplete(taskId, head, candidateCommit)
]
const bPromotionRequest = {
  integrationTarget,
  candidateCommit: candidateCommit("B"),
  expectedTargetHead: successorCommit
}
const bIntegrationReleasingE = promoteAndComplete("B", successorCommit, candidateCommit("B")).flatMap(
  (item): ReadonlyArray<unknown> =>
    item._tag === "TargetPromotionCompareAndSetReturned"
      ? [
          item,
          {
            _tag: "CassetteReleasesHeldTaskWorktreeSelection",
            taskId: "E",
            attemptId: attempt("E"),
            promotionRequest: bPromotionRequest
          },
          select({ _tag: "ReconcileTaskWorktree", taskId: "E", attemptId: attempt("E") }),
          report("E", "Begin"),
          {
            _tag: "CassetteReleasesHeldPromotedTaskCompletionClaimRead",
            promotedTaskId: "B",
            promotedAttemptId: attempt("B"),
            releasedByTaskId: "E",
            releasedByAttemptId: attempt("E")
          }
        ]
      : [item]
)

const predecessor = Schema.decodeUnknownSync(IntegratorSessionCorrelation)(
  session(
    "A",
    initialHead,
    predecessorPositions.queuedAt,
    predecessorPositions.startedAt,
    predecessorPositions.targetLineageObservedAt
  )
)
const quarantineAt = JournalPosition.make(rerunPositions.quarantineAt)
const successor = integratorSuccessorCorrelationFor({
  predecessor,
  quarantineAt,
  directionAppliedAt: JournalPosition.make(rerunPositions.directionAppliedAt),
  targetLineageObservedAt: JournalPosition.make(rerunPositions.targetLineageObservedAt),
  targetLineage: Schema.decodeUnknownSync(TargetLineageObservation)({
    plannedBaseSha: initialHead,
    targetHeadSha: changedHead,
    plannedBaseIsAncestorOfTargetHead: true
  })
})
const predecessorCleanupRevision = {
  _tag: "IntegratorCandidateCleanupEvidenceRevisionReturned",
  revision: 1,
  subject: { locator: predecessor.candidateResource, predecessor }
}
const predecessorCleanup = [
  predecessorCleanupRevision,
  {
    _tag: "IntegratorCandidateCleanupObservationReturned",
    observation: {
      _tag: "Present",
      locator: predecessor.candidateResource,
      revision: 1,
      sessionId: predecessor.sessionId,
      writerQuiescent: true
    }
  },
  {
    _tag: "IntegratorCandidateCleanupRemovalReturned",
    result: {
      _tag: "Unknown",
      detail: "provider removed the predecessor candidate but its response was lost",
      locator: predecessor.candidateResource,
      sessionId: predecessor.sessionId
    }
  },
  { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
  { _tag: "CoordinatorProcessDies" },
  predecessorCleanupRevision,
  {
    _tag: "IntegratorCandidateCleanupObservationReturned",
    observation: { _tag: "Absent", locator: predecessor.candidateResource, revision: 2 }
  }
]
const rerunA = integrate("A", initialHead, candidateCommit("A")).flatMap((item): ReadonlyArray<unknown> => {
  if (item._tag === "TargetPromotionCompareAndSetReturned")
    return [
      { ...item, result: { _tag: "RejectedExpectedHead", observedHeadSha: changedHead } },
      {
        _tag: "OperatorAppliesIntegrationQuarantineDirection",
        expected: "Applied",
        request: {
          fingerprint: { direction: "FullRerun", quarantineAt, sessionId: predecessor.sessionId },
          requestId: { nonce: "capstone-full-rerun-A", runId: "$authored-run" }
        }
      },
      select({ _tag: "ReadTargetLineage", taskId: "A", attemptId: attempt("A") }),
      { _tag: "IntegratorRequestReceived", correlation: { ordinal: 1, session: successor } },
      {
        _tag: "IntegratorResultReturned",
        result: { _tag: "PreparedCandidate", candidateText: "refs/heads/candidate-A-successor" }
      },
      {
        _tag: "IntegratorGitObservationReturned",
        candidateText: "refs/heads/candidate-A-successor",
        observation: {
          _tag: "Commit",
          candidateText: "refs/heads/candidate-A-successor",
          commit: successorCommit,
          directParents: [changedHead, acceptedCommit("A")]
        }
      },
      select({ _tag: "ReadTargetLineage", taskId: "A", attemptId: attempt("A") }),
      gitRead(successorCommit, changedHead),
      {
        _tag: "TargetPromotionCompareAndSetReturned",
        request: { integrationTarget, candidateCommit: successorCommit, expectedTargetHead: changedHead },
        result: { _tag: "Applied" }
      }
    ]
  // The successor, never the rejected predecessor, supplies A's finality proof.
  if (
    item._tag === "TargetPromotionGitReadReturned" &&
    "observation" in item &&
    item.observation._tag === "CandidateCurrent"
  )
    return [gitRead(successorCommit, successorCommit)]
  return [item]
})

/** Alice's single five-to-seven task Run; all boundary results are interpreted by the ordinary authored runner. */
export const deliveryStoryCapstoneAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  _tag: "AuthoredScenarioCassette",
  schemaVersion: 1,
  name: "Alice completes one seven-task delivery invariant story",
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: names.map(specification),
    targetLineageObservations: [
      ...Array.from({ length: 6 }, () => ({
        plannedBaseSha: initialHead,
        targetHeadSha: initialHead,
        plannedBaseIsAncestorOfTargetHead: true
      })),
      ...Array.from({ length: 2 }, () => ({
        plannedBaseSha: initialHead,
        targetHeadSha: changedHead,
        plannedBaseIsAncestorOfTargetHead: true
      })),
      ...Array.from({ length: 7 }, () => ({
        plannedBaseSha: initialHead,
        targetHeadSha: successorCommit,
        plannedBaseIsAncestorOfTargetHead: true
      })),
      ...["B", "C", "D", "E", "F"].map((taskId) => ({
        plannedBaseSha: initialHead,
        targetHeadSha: candidateCommit(taskId),
        plannedBaseIsAncestorOfTargetHead: true
      }))
    ],
    trackerGraph: graphs.G0,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 3 } },
    {
      _tag: "RunCoordinator",
      baseSha: initialHead,
      claimOwner: "capstone-owner",
      claimTokenPrefix: "capstone-claim",
      executor,
      integrationTarget,
      target,
      targetPromotionConfigured: true,
      worktreeRoot
    },
    ...readGraph(graphs.G0),
    ...readGraph(graphs.G0),
    ...admission("A", graphs.G0, true).filter((item) => item._tag !== "PlannedAttemptExecutorWorkReported"),
    ...admission("C", graphs.G0).slice(0, admissionClaimGraphEnd),
    report("A", "Begin"),
    ...admission("B", graphs.G0).slice(0, admissionClaimGraphEnd),
    ...admission("C", graphs.G0).slice(admissionClaimGraphEnd, admissionSpecificationEnd),
    ...admission("B", graphs.G0).slice(admissionClaimGraphEnd, admissionSpecificationEnd),
    ...admission("C", graphs.G0)
      .slice(admissionSpecificationEnd)
      .filter((item) => item._tag !== "PlannedAttemptExecutorWorkReported"),
    report("C", "Begin"),
    ...admission("B", graphs.G0).slice(admissionSpecificationEnd),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
    { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
    ...readGraph(graphs.G1),
    ...readGraph(graphs.G1),
    ...readCurrent("A"),
    ...readSpecification("B"),
    ...readCurrent("C"),
    report("B", "Suspend"),
    ...readGraph(graphs.G1),
    ...readGraph(graphs.G1),
    ...admission("D", graphs.G1),
    { _tag: "SetTaskExecutionCapacity", capacity: 2 },
    { _tag: "CoordinatorProcessDies" },
    ...readGraph(graphs.G1),
    ...["A", "C", "D"].map((taskId) => ({
      _tag: "PlannedAttemptExecutorProjectionReturned",
      report: { _tag: "ExecutorWorkExecuting", attemptId: attempt(taskId) }
    })),
    { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
    ...readGraph(graphs.G2),
    ...readCurrent("A"),
    ...readCurrent("D"),
    report("C", "Suspend"),
    ...readGraph(graphs.G2),
    {
      _tag: "OperatorContinuesAttempt",
      taskId: "B",
      attemptId: attempt("B"),
      expected: { _tag: "Applied" },
      observedTaskRevision: makeTaskWorkSpecification(changedSpecification).fingerprint,
      requestNonce: "continue-original-B"
    },
    ...readGraph(graphs.G2),
    ...readCurrent("B"),
    terminal("A"),
    report("B", "Resume"),
    ...rerunA,
    ...predecessorCleanup,
    ...readGraph(graphs.G3),
    { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
    predecessorCleanupRevision,
    ...readGraph(graphs.G4),
    ...["B", "D"].flatMap(readCurrent),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
    predecessorCleanupRevision,
    ...readGraph(graphs.G4),
    {
      _tag: "CassetteAwaitsSafeContinuationRevalidationPublication",
      graphRevision: graphs.G4.revision,
      taskId: "C",
      attemptId: attempt("C")
    },
    { _tag: "SetTaskExecutionCapacity", capacity: 3 },
    ...readGraph(graphs.G4),
    ...readCurrent("C"),
    report("C", "Resume"),
    { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
    predecessorCleanupRevision,
    ...readGraph(graphs.G5),
    ...["B", "C", "D"].flatMap(readCurrent),
    terminal("B"),
    ...readGraph(graphs.G5),
    select({ _tag: "AcquireTaskClaim", taskId: "E" }),
      { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" } },
      predecessorCleanupRevision,
      ...readGraph(graphs.G5),
      select({ _tag: "ReadTaskClaim", taskId: "B" }),
      { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    ...readGraph(graphs.G5),
    ...planTaskWorktree("E").slice(0, 3),
    {
      _tag: "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion",
      taskId: "E",
      attemptId: attempt("E"),
      promotionRequest: bPromotionRequest
    },
    {
      _tag: "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins",
      promotedTaskId: "B",
      promotedAttemptId: attempt("B"),
      releasedByTaskId: "E",
      releasedByAttemptId: attempt("E")
    },
    ...prepareIntegration("B", successorCommit, candidateCommit("B"), bIntegrationPositions),
    ...bIntegrationReleasingE,
    terminal("C"),
    ...readGraph(graphs.G5),
    select({ _tag: "ReadTaskClaim", taskId: "C" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "C" },
    ...admission("F", graphs.G5).slice(0, 1),
    ...admission("F", graphs.G5).slice(1, 3),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(0, 1),
    ...admission("F", graphs.G5).slice(3, 5),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(1, 4),
    ...admission("F", graphs.G5).slice(5, 6),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(4, 6),
    ...admission("F", graphs.G5).slice(6, 7),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(6, 8),
    ...admission("F", graphs.G5).slice(7),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(8),
    predecessorCleanupRevision,
    terminal("D"),
    ...readGraph(graphs.G5),
    select({ _tag: "ReadTaskClaim", taskId: "D" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    ...readGraph(graphs.G5),
    ...admission("G", graphs.G5).slice(0, 3),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(0, 1),
    ...admission("G", graphs.G5).slice(3, 5),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(1, 4),
    ...admission("G", graphs.G5).slice(5, 6),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(4, 6),
    ...admission("G", graphs.G5).slice(6, 7),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(6, 8),
    ...admission("G", graphs.G5).slice(7),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(8),
    ...["E", "F", "G"].flatMap((taskId) => [
      terminal(taskId),
      select({ _tag: "ReadTaskClaim", taskId }),
      { _tag: "TaskClaimCurrentReadReturned", taskId },
      ...(taskId === "F" || taskId === "G" ? [predecessorCleanupRevision] : []),
      ...readGraph(graphs.G5),
      ...(taskId === "F" || taskId === "G"
        ? [select({ _tag: "ReadTaskClaim", taskId }), { _tag: "TaskClaimCurrentReadReturned", taskId }]
        : []),
      ...(taskId === "F" || taskId === "G" ? readGraph(graphs.G5) : []),
      ...integrate(
        taskId,
        candidateCommit(orderedNames[orderedNames.indexOf(taskId) - 1] ?? "A"),
        candidateCommit(taskId),
        taskId === "E" ? ePositions : taskId === "F" ? fPositions : gPositions
      )
    ]),
    predecessorCleanupRevision,
    ...readGraph(graphs.Gfinal),
    ...readGraph(graphs.Gfinal),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: names.map((taskId) => ({ _tag: "PlannedWorkForTaskAccepted", taskId, commit: acceptedCommit(taskId) }))
      }
    }
  ]
})
