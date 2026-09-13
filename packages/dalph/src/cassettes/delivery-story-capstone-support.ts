import { Schema } from "effect"
import { makeTaskWorkSpecification, TaskId } from "@dalph/contracts"
import {
  IntegratorSessionCorrelation,
  integratorSuccessorCorrelationFor,
  JournalPosition,
  TargetLineageObservation
} from "@dalph/orchestrator"

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
const cPositions = { queuedAt: 315, startedAt: 318, targetLineageObservedAt: 322 }
const dPositions = { queuedAt: 371, startedAt: 374, targetLineageObservedAt: 378 }
const ePositions = { queuedAt: 423, startedAt: 424, targetLineageObservedAt: 428 }
const fPositions = { queuedAt: 464, startedAt: 465, targetLineageObservedAt: 473 }
const gPositions = { queuedAt: 509, startedAt: 510, targetLineageObservedAt: 518 }
const bIntegrationPositions = { queuedAt: 265, startedAt: 268, targetLineageObservedAt: 271 }
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
const prepareIntegration = (
  taskId: string,
  head: string,
  candidateCommit: string,
  positions: typeof predecessorPositions
) => [
  select({ _tag: "ReadTargetLineage", taskId, attemptId: attempt(taskId) }),
  {
    _tag: "IntegratorRequestReceived",
    correlation: {
      ordinal: 1,
      session: session(taskId, head, positions.queuedAt, positions.startedAt, positions.targetLineageObservedAt)
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

export {
  names,
  orderedNames,
  target,
  integrationTarget,
  worktreeRoot,
  executor,
  initialHead,
  changedHead,
  successorCommit,
  attempt,
  specification,
  changedSpecification,
  graphs,
  select,
  readGraph,
  readSpecification,
  readCurrent,
  report,
  acceptedCommit,
  candidateCommit,
  terminal,
  planTaskWorktree,
  admission,
  prepareIntegration,
  integrate,
  bPromotionRequest,
  bIntegrationReleasingE,
  predecessorCleanupRevision,
  predecessorCleanup,
  rerunA,
  bIntegrationPositions,
  cPositions,
  dPositions,
  ePositions,
  fPositions,
  gPositions,
  admissionClaimGraphEnd,
  admissionSpecificationEnd
}
