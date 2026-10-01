import { Schema } from "effect"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { AuthoredCassetteStoryItem, AuthoredScenarioCassette } from "./authored-domain.js"
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
  cleanupFor,
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
const integrationCompletionReplacementEnd = 14
const finalTaskIds = ["E", "F", "G"] as const
const finalTaskProfiles = {
  E: { positions: ePositions },
  F: { positions: fPositions },
  G: { positions: gPositions }
} as const
const { absent: bCleanupAbsentObservation, revision: bCleanupRevision } = cleanupFor(
  "B",
  successorCommit,
  bIntegrationPositions
)
const { absent: cCleanupAbsentObservation, revision: cCleanupRevision } = cleanupFor(
  "C",
  candidateCommit("B"),
  cPositions
)
const { absent: dCleanupAbsentObservation, revision: dCleanupRevision } = cleanupFor(
  "D",
  candidateCommit("C"),
  dPositions
)
const { absent: eCleanupAbsentObservation, revision: eCleanupRevision } = cleanupFor(
  "E",
  candidateCommit("D"),
  ePositions
)
const { absent: fCleanupAbsentObservation, revision: fCleanupRevision } = cleanupFor(
  "F",
  candidateCommit("E"),
  fPositions
)
const { absent: gCleanupAbsentObservation, revision: gCleanupRevision } = cleanupFor(
  "G",
  candidateCommit("F"),
  gPositions
)
/** Alice's single five-to-seven task Run; all boundary results are interpreted by the ordinary authored runner. */
const deliveryStoryCapstoneInput = {
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
      observedTaskRevision: makeTaskWorkSpecification(specification("B")).fingerprint,
      requestNonce: "continue-original-B"
    },
    ...readGraph(graphs.G2),
    ...readCurrent("B"),
    terminal("A"),
    select({ _tag: "ReadTaskClaim", taskId: "B" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    select({ _tag: "ReadTaskClaim", taskId: "B" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    report("B", "Resume"),
    ...rerunA,
    ...predecessorCleanup,
    ...readGraph(graphs.G3),
    { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
    ...readGraph(graphs.G4),
    ...["B", "D"].flatMap(readCurrent),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
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
    ...readGraph(graphs.G5),
    ...["B", "C", "D"].flatMap(readCurrent),
    terminal("B"),
    ...readGraph(graphs.G5),
    select({ _tag: "AcquireTaskClaim", taskId: "E" }),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
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
    bCleanupRevision,
    bCleanupAbsentObservation,
    ...readGraph(graphs.G5),
    select({ _tag: "ReadTaskClaim", taskId: "C" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "C" },
    ...admission("F", graphs.G5).slice(1, admissionClaimGraphEnd),
    ...admission("F", graphs.G5).slice(0, 1),
    ...readGraph(graphs.G5),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(0, 1),
    ...admission("F", graphs.G5).slice(admissionClaimGraphEnd, admissionSpecificationEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(1, integrationPreparationEnd),
    ...admission("F", graphs.G5).slice(admissionSpecificationEnd, admissionPlanEnd),
    ...admission("F", graphs.G5).slice(admissionPlanEnd, admissionReconciliationEnd),
    ...admission("F", graphs.G5).slice(admissionReconciliationEnd),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(
      integrationPreparationEnd,
      integrationPromotionEnd
    ),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(
      integrationPromotionEnd,
      integrationCompletionReplacementEnd
    ),
    ...integrate("C", candidateCommit("B"), candidateCommit("C"), cPositions).slice(
      integrationCompletionReplacementEnd
    ),
    terminal("D"),
    cCleanupRevision,
    cCleanupAbsentObservation,
    ...readGraph(graphs.G5),
    select({ _tag: "ReadTaskClaim", taskId: "D" }),
    { _tag: "TaskClaimCurrentReadReturned", taskId: "D" },
    ...readGraph(graphs.G5),
    ...admission("G", graphs.G5).slice(0, admissionClaimGraphEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(0, 1),
    ...admission("G", graphs.G5).slice(admissionClaimGraphEnd, admissionSpecificationEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(1, integrationPreparationEnd),
    ...admission("G", graphs.G5).slice(admissionSpecificationEnd, admissionPlanEnd),
    ...admission("G", graphs.G5).slice(admissionPlanEnd, admissionReconciliationEnd),
    ...admission("G", graphs.G5).slice(admissionReconciliationEnd),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(
      integrationPreparationEnd,
      integrationPromotionEnd
    ),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(
      integrationPromotionEnd,
      integrationCompletionReplacementEnd
    ),
    ...integrate("D", candidateCommit("C"), candidateCommit("D"), dPositions).slice(
      integrationCompletionReplacementEnd
    ),
    ...finalTaskIds.flatMap((taskId) => {
      const { positions } = finalTaskProfiles[taskId]
      const integration = integrate(
        taskId,
        candidateCommit(orderedNames[orderedNames.indexOf(taskId) - 1] ?? "A"),
        candidateCommit(taskId),
        positions
      )
      return [
        terminal(taskId),
        ...(taskId === "E" ? [dCleanupRevision, dCleanupAbsentObservation] : []),
        ...(taskId === "F" ? [eCleanupRevision, eCleanupAbsentObservation] : []),
        ...(taskId === "G" ? [fCleanupRevision, fCleanupAbsentObservation] : []),
        ...readGraph(graphs.G5),
        ...(taskId === "F" || taskId === "G"
          ? []
          : [select({ _tag: "ReadTaskClaim", taskId }), { _tag: "TaskClaimCurrentReadReturned", taskId }]),
        ...(taskId === "F" || taskId === "G" ? [] : readGraph(graphs.G5)),
        ...integration
      ]
    }),
    gCleanupRevision,
    gCleanupAbsentObservation,
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
}

// The first three admitted pipelines share no cross-task arrival order. In
// particular A's Begin may cross B or C's worktree reconciliation while each
// task keeps its own claim, read, plan, worktree, and executor predecessors.
const firstAdmissionCausalWindow = {
  startIndex: 15,
  endIndex: 34,
  occurrences: [
    { id: "A-plan", storyIndex: 15, predecessorIds: [] },
    { id: "A-worktree", storyIndex: 16, predecessorIds: ["A-plan"] },
    { id: "C-claim", storyIndex: 17, predecessorIds: [] },
    { id: "C-graph", storyIndex: 18, predecessorIds: ["C-claim"] },
    { id: "C-graph-result", storyIndex: 19, predecessorIds: ["C-graph"], ownerRole: "C-graph" },
    { id: "A-begin", storyIndex: 20, predecessorIds: ["A-worktree"] },
    { id: "B-claim", storyIndex: 21, predecessorIds: [] },
    { id: "B-graph", storyIndex: 22, predecessorIds: ["B-claim"] },
    { id: "B-graph-result", storyIndex: 23, predecessorIds: ["B-graph"], ownerRole: "B-graph" },
    { id: "C-spec", storyIndex: 24, predecessorIds: ["C-graph-result"] },
    { id: "C-spec-result", storyIndex: 25, predecessorIds: ["C-spec"], ownerRole: "C-spec" },
    { id: "B-spec", storyIndex: 26, predecessorIds: ["B-graph-result"] },
    { id: "B-spec-result", storyIndex: 27, predecessorIds: ["B-spec"], ownerRole: "B-spec" },
    { id: "C-plan", storyIndex: 28, predecessorIds: ["C-spec-result"] },
    { id: "C-worktree", storyIndex: 29, predecessorIds: ["C-plan"] },
    { id: "C-begin", storyIndex: 30, predecessorIds: ["C-worktree"] },
    { id: "B-plan", storyIndex: 31, predecessorIds: ["B-spec-result"] },
    { id: "B-worktree", storyIndex: 32, predecessorIds: ["B-plan"] },
    { id: "B-begin", storyIndex: 33, predecessorIds: ["B-worktree"] }
  ]
} as const

const firstAdmissionRolePredecessors = new Map<string, ReadonlyArray<string>>([
  ["C-claim", []],
  ["C-graph", ["C-claim"]],
  ["B-claim", []],
  ["B-graph", ["B-claim"]]
])
const firstAdmissionCausalSelection = new Map<
  number,
  { readonly occurrenceRole: string; readonly predecessorRoles: ReadonlyArray<string> }
>()
for (const { id, storyIndex } of firstAdmissionCausalWindow.occurrences) {
  const predecessorRoles = firstAdmissionRolePredecessors.get(id)
  if (predecessorRoles !== undefined)
    firstAdmissionCausalSelection.set(storyIndex, { occurrenceRole: id, predecessorRoles })
}

export const deliveryStoryCapstoneAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...deliveryStoryCapstoneInput,
  story: deliveryStoryCapstoneInput.story.map((item, index) => {
    const causal = firstAdmissionCausalSelection.get(index)
    return causal === undefined ? item : { ...Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(item), causal }
  }),
  causalWindows: [firstAdmissionCausalWindow]
})
