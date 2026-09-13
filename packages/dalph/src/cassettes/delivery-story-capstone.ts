import { Schema } from "effect"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { AuthoredScenarioCassette } from "./authored-domain.js"
import {
  acceptedCommit,
  admission,
  admissionClaimGraphEnd,
  admissionSpecificationEnd,
  attempt,
  bIntegrationPositions,
  bIntegrationReleasingE,
  bPromotionRequest,
  candidateCommit,
  changedSpecification,
  cPositions,
  changedHead,
  dPositions,
  ePositions,
  executor,
  fPositions,
  gPositions,
  graphs,
  initialHead,
  integrate,
  integrationTarget,
  names,
  orderedNames,
  planTaskWorktree,
  predecessorCleanup,
  predecessorCleanupRevision,
  prepareIntegration,
  readCurrent,
  readGraph,
  readSpecification,
  report,
  rerunA,
  select,
  successorCommit,
  specification,
  target,
  terminal,
  worktreeRoot
} from "./delivery-story-capstone-support.js"

const plannedAttemptRecordEnd = 3
const admissionPlanEnd = 6
const admissionReconciliationEnd = 7
const integrationPreparationEnd = 4
const integrationPromotionEnd = 6
const integrationCompletionReplacementEnd = 8

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
      ...Array.from({ length: 1 }, () => ({
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
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    predecessorCleanupRevision,
    ...readGraph(graphs.G5),
    select({ _tag: "ReadTaskClaim", taskId: "B" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    ...readGraph(graphs.G5),
    ...planTaskWorktree("E").slice(0, plannedAttemptRecordEnd),
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
    ...admission("F", graphs.G5).slice(1, admissionClaimGraphEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(0, 1),
    ...admission("F", graphs.G5).slice(admissionClaimGraphEnd, admissionSpecificationEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(1, integrationPreparationEnd),
    ...admission("F", graphs.G5).slice(admissionSpecificationEnd, admissionPlanEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(
      integrationPreparationEnd,
      integrationPromotionEnd
    ),
    ...admission("F", graphs.G5).slice(admissionPlanEnd, admissionReconciliationEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(
      integrationPromotionEnd,
      integrationCompletionReplacementEnd
    ),
    ...admission("F", graphs.G5).slice(admissionReconciliationEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(
      integrationCompletionReplacementEnd
    ),
    predecessorCleanupRevision,
    terminal("D"),
    ...readGraph(graphs.G5),
    select({ _tag: "ReadTaskClaim", taskId: "D" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    ...readGraph(graphs.G5),
    ...admission("G", graphs.G5).slice(0, admissionClaimGraphEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(0, 1),
    ...admission("G", graphs.G5).slice(admissionClaimGraphEnd, admissionSpecificationEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(1, integrationPreparationEnd),
    ...admission("G", graphs.G5).slice(admissionSpecificationEnd, admissionPlanEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(
      integrationPreparationEnd,
      integrationPromotionEnd
    ),
    ...admission("G", graphs.G5).slice(admissionPlanEnd, admissionReconciliationEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(
      integrationPromotionEnd,
      integrationCompletionReplacementEnd
    ),
    ...admission("G", graphs.G5).slice(admissionReconciliationEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(
      integrationCompletionReplacementEnd
    ),
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
