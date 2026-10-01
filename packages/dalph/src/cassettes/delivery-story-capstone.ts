/* eslint-disable max-lines -- The complete authored delivery chronology stays contiguous for causal boundary review. */
import { Schema } from "effect"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { AuthoredCassetteStoryItem, AuthoredCausalWindow, AuthoredScenarioCassette } from "./authored-domain.js"
import {
  acceptedCommit,
  admission,
  admissionClaimGraphEnd,
  admissionSpecificationEnd,
  attempt,
  bSuccessorAttempt,
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
  report,
  rerunA,
  select,
  successorCommit,
  specification,
  target,
  terminal,
  worktreeRoot
} from "./delivery-story-capstone-support.js"

const bF2Specification = { ...specification("B"), body: "Implement changed B from F2.", title: "Implement B F2" }
const bF2TaskRevision = makeTaskWorkSpecification(bF2Specification).fingerprint
const lineageObservation = (plannedBaseSha: string, targetHeadSha: string) => ({
  plannedBaseSha,
  targetHeadSha,
  plannedBaseIsAncestorOfTargetHead: true
})
const readBCurrentSpecification = () => [
  select({ _tag: "ReadTaskWorkSpecification", taskId: "B" }),
  { _tag: "TaskWorkSpecificationReadReturned", ...bF2Specification }
]
const readBRestartAuthorityGraph = () => [{ _tag: "TrackerGraphReadReturned", graph: graphs.G2 }]
const readBCurrentFacts = () => [
  ...readBCurrentSpecification(),
  select({ _tag: "ReadTaskClaim", taskId: "B" }),
  { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
  select({ _tag: "ReadTaskWorktree", taskId: "B", attemptId: bSuccessorAttempt }),
  select({ _tag: "ReadTargetLineage", taskId: "B", attemptId: bSuccessorAttempt })
]
const readCurrentAfterBSpecificationChange = (taskId: string) =>
  taskId === "B" ? readBCurrentFacts() : readCurrent(taskId)
const bReplacementPlan = { attemptId: bSuccessorAttempt, baseSha: changedHead, taskRevision: bF2TaskRevision }
const bIntegrationReleasingEWithF2 = bIntegrationReleasingE.map((item) => {
  const occurrence = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(item)
  return occurrence._tag === "TaskWorkSpecificationReadReturned" && occurrence.taskId === "B"
    ? { ...occurrence, ...bF2Specification }
    : occurrence
})
const bPreparationWithF2 = prepareIntegration(
  "B",
  successorCommit,
  candidateCommit("B"),
  bIntegrationPositions,
  bReplacementPlan
)

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
const { absent: bCleanupAbsentObservation, revision: initialBCleanupRevision } = cleanupFor(
  "B",
  successorCommit,
  bIntegrationPositions,
  bReplacementPlan
)
const bCleanupRevision = {
  ...initialBCleanupRevision,
  subject: {
    ...initialBCleanupRevision.subject,
    predecessor: {
      ...initialBCleanupRevision.subject.predecessor,
      plannedAttempt: { ...initialBCleanupRevision.subject.predecessor.plannedAttempt, taskRevision: bF2TaskRevision }
    }
  }
}
const rerunAWithPostPromotionFinality = rerunA.flatMap((value): ReadonlyArray<unknown> => {
  const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)
  return item._tag === "CompletionClaimReplacementApplied" && item.taskId === "A"
    ? [
        ...readGraph(graphs.G2),
        select({ _tag: "ReadTaskWorkSpecification", taskId: "A" }),
        { _tag: "TaskWorkSpecificationReadReturned", ...specification("A") },
        select({ _tag: "ReadTaskClaim", taskId: "A" }),
        { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
        item
      ]
    : [item]
})
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
    targetLineageByAttempt: [
      // A continuation at activations 4/6, initial integration, then exact FullRerun direction.
      {
        attemptId: attempt("A"),
        observations: [
          ...Array.from({ length: 3 }, () => lineageObservation(initialHead, initialHead)),
          lineageObservation(initialHead, changedHead)
        ]
      },
      // The original B Restart observation does not consume its successor's facts.
      { attemptId: attempt("B"), observations: [lineageObservation(initialHead, changedHead)] },
      {
        attemptId: bSuccessorAttempt,
        observations: Array.from({ length: 3 }, () => lineageObservation(changedHead, successorCommit))
      },
      {
        attemptId: attempt("C"),
        observations: [
          lineageObservation(initialHead, initialHead),
          ...Array.from({ length: 2 }, () => lineageObservation(initialHead, successorCommit)),
          lineageObservation(initialHead, candidateCommit("B"))
        ]
      },
      {
        attemptId: attempt("D"),
        observations: [
          lineageObservation(initialHead, initialHead),
          ...Array.from({ length: 2 }, () => lineageObservation(initialHead, successorCommit)),
          lineageObservation(initialHead, candidateCommit("C"))
        ]
      },
      ...(
        [
          ["E", "D"],
          ["F", "E"],
          ["G", "F"]
        ] as const
      ).map(([taskId, predecessor]) => ({
        attemptId: attempt(taskId),
        observations: [lineageObservation(initialHead, candidateCommit(predecessor))]
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
    ...readGraph(graphs.G0), // B establishment closure
    ...readGraph(graphs.G0), // C establishment closure
    ...readGraph(graphs.G0), // Independent empty closure from the next activation
    ...admission("A", graphs.G0).filter((item) => item._tag !== "PlannedAttemptExecutorWorkReported"),
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
    ...readBCurrentSpecification(),
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
      _tag: "OperatorRestartsAttempt",
      taskId: "B",
      attemptId: attempt("B"),
      expected: { _tag: "Applied" },
      observedTaskRevision: bF2TaskRevision,
      requestNonce: "restart-original-B"
    },
    ...readBRestartAuthorityGraph(),
    { _tag: "TaskWorkSpecificationReadReturned", ...bF2Specification },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "B" },
    {
      _tag: "DirectGitWorktreeReadReturned",
      taskId: "B",
      attemptId: attempt("B"),
      observation: {
        _tag: "PlannedWorktreeReady",
        baseSha: initialHead,
        headSha: initialHead,
        branch: "refs/heads/dalph/attempt-B-0",
        worktree: "/dalph/cassettes/delivery-capstone/attempt-B-0"
      }
    },
    {
      _tag: "DirectGitTargetLineageReadReturned",
      taskId: "B",
      attemptId: attempt("B"),
      observation: lineageObservation(initialHead, changedHead)
    },
    {
      _tag: "CassetteAwaitsSelectedTaskCapacityPublication",
      taskId: "B",
      heldPassiveAttemptId: attempt("A"),
      priorAttemptId: attempt("B"),
      successorAttemptId: bSuccessorAttempt,
      graphRevision: graphs.G2.revision,
      capacity: 2
    },
    {
      _tag: "CassetteHoldsAcceptedResultQueueUntilAttemptBegin",
      queuedAttemptId: attempt("A"),
      releasedByAttemptId: bSuccessorAttempt
    },
    terminal("A"),
    select({ _tag: "ReconcileTaskWorktree", taskId: "B", attemptId: bSuccessorAttempt }),
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      request: "Begin",
      report: { _tag: "ExecutorWorkExecuting", attemptId: bSuccessorAttempt }
    },
    ...rerunAWithPostPromotionFinality,
    ...predecessorCleanup,
    ...readGraph(graphs.G3),
    { _tag: "CassetteOffersRunReactivationHints", hints: ["TrackerNotification"] },
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMustRemainActiveReasonUnasserted" } },
    ...readGraph(graphs.G4),
    ...["B", "D"].flatMap(readCurrentAfterBSpecificationChange),
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
    ...["B", "C", "D"].flatMap(readCurrentAfterBSpecificationChange),
    terminal("B", bSuccessorAttempt),
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
      promotedAttemptId: bSuccessorAttempt,
      releasedByTaskId: "E",
      releasedByAttemptId: attempt("E")
    },
    ...bPreparationWithF2,
    ...bIntegrationReleasingEWithF2,
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
const firstAdmissionStart = 4
const firstAdmissionEnd = deliveryStoryCapstoneInput.story.findIndex(
  (value) => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)._tag === "CoordinatorActivationReturned"
)
const entryGraphRoles = new Map([
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [4, { id: "A-establishment", taskIds: ["A"], predecessors: [] }],
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [6, { id: "B-establishment", taskIds: ["B"], predecessors: [] }],
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [8, { id: "C-establishment", taskIds: ["C"], predecessors: [] }],
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [10, { id: "empty-establishment", taskIds: [], predecessors: [] }],
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [13, { id: "A-post-claim", taskIds: ["A"], predecessors: ["entry-12"] }],
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [20, { id: "C-post-claim", taskIds: ["C"], predecessors: ["entry-19"] }],
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  [24, { id: "B-post-claim", taskIds: ["B"], predecessors: ["entry-23"] }]
])
const firstAdmissionOccurrences: Array<{
  id: string
  storyIndex: number
  predecessorIds: Array<string>
  ownerRole?: string
  graphReadCause?: "WorkflowEstablishment" | "AttemptRestartAuthorityCheck" | "PostPromotionFinalityCheck"
  graphReadExplicitTaskIds?: Array<string>
  waitForPredecessors?: true
  directCleanupClaimRead?: NonNullable<
    (typeof AuthoredCausalWindow.Type)["occurrences"][number]["directCleanupClaimRead"]
  >
}> = []
const lastTaskOccurrence = new Map<string, string>()
const selectedReadRoles = new Map<string, string>()
const attemptTaskIds = new Map<string, string>()
for (let storyIndex = firstAdmissionStart; storyIndex < firstAdmissionEnd; storyIndex++) {
  const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(deliveryStoryCapstoneInput.story[storyIndex])
  const graphRole = entryGraphRoles.get(storyIndex)
  const id = graphRole?.id ?? `entry-${storyIndex}`
  const predecessorIds: Array<string> = []
  const node: (typeof firstAdmissionOccurrences)[number] = { id, storyIndex, predecessorIds }
  if (item._tag === "DalphSelects") {
    if (item.operation._tag === "ReadTrackerGraph") selectedReadRoles.set("graph", id)
    if (item.operation._tag === "ReadTaskWorkSpecification")
      selectedReadRoles.set(`specification:${item.operation.taskId}`, id)
    if (item.operation._tag === "RecordTaskAttemptPlan")
      attemptTaskIds.set(String(item.operation.attemptId), String(item.operation.taskId))
    if (item.operation._tag === "ReadTrackerGraph" && graphRole !== undefined) {
      node.graphReadCause = "WorkflowEstablishment"
      node.graphReadExplicitTaskIds = graphRole.taskIds
      predecessorIds.push(...graphRole.predecessors)
    } else if ("taskId" in item.operation) {
      const taskId = String(item.operation.taskId)
      const prior = lastTaskOccurrence.get(taskId)
      if (prior !== undefined) predecessorIds.push(prior)
      lastTaskOccurrence.set(taskId, id)
    }
  } else if (item._tag === "TrackerGraphReadReturned" || item._tag === "TaskWorkSpecificationReadReturned") {
    const readKey = item._tag === "TrackerGraphReadReturned" ? "graph" : `specification:${item.taskId}`
    const owner = selectedReadRoles.get(readKey)
    if (owner !== undefined) {
      node.ownerRole = owner
      predecessorIds.push(owner)
    }
    if (item._tag === "TaskWorkSpecificationReadReturned") lastTaskOccurrence.set(String(item.taskId), id)
  } else if (item._tag === "PlannedAttemptExecutorWorkReported") {
    // Executor responses are not owned by the previous selected read or worktree operation.
    const taskId = attemptTaskIds.get(String(item.report.attemptId))
    const prior = taskId === undefined ? undefined : lastTaskOccurrence.get(taskId)
    if (prior !== undefined) predecessorIds.push(prior)
    if (taskId !== undefined) lastTaskOccurrence.set(taskId, id)
  }
  // Control and lifecycle items do not inherit selected-operation ownership.
  firstAdmissionOccurrences.push(node)
}
const firstAdmissionCausalWindow = {
  startIndex: firstAdmissionStart,
  endIndex: firstAdmissionEnd,
  occurrences: firstAdmissionOccurrences
}

// Continuation epochs end at authored control/lifecycle barriers; no read may cross them.
const continuationItems = new Map<number, { occurrenceRole: string; predecessorRoles: Array<string> }>()
const continuationAnchors = new Map<number, string>()
const continuationWindows: Array<{
  startIndex: number
  endIndex: number
  occurrences: typeof firstAdmissionOccurrences
}> = []
const currentPlanRoles = new Map<string, string>()
const retainedContinuationAuthority = new Map<string, string>()
for (let index = 0; index < deliveryStoryCapstoneInput.story.length; index++) {
  const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(deliveryStoryCapstoneInput.story[index])
  if (item._tag === "OperatorRestartsAttempt" && item.taskId === "B") {
    currentPlanRoles.set("B", "B-accepted-successor-plan")
  }
  if (item._tag === "DalphSelects" && item.operation._tag === "RecordTaskAttemptPlan") {
    const role = index < firstAdmissionEnd ? `entry-${index}` : `plan-${item.operation.taskId}-${index}`
    currentPlanRoles.set(String(item.operation.taskId), role)
    if (index >= firstAdmissionEnd) continuationAnchors.set(index, role)
  }
  if (item._tag === "CassetteAwaitsSafeContinuationRevalidationPublication") {
    // The marker confirms this task's exact continuation graph before capacity changes.
    // eslint-disable-next-line no-magic-numbers -- The selection/result pair immediately precedes the marker.
    const authorityIndex = index - 2
    const authority = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
      deliveryStoryCapstoneInput.story[authorityIndex]
    )
    if (authority._tag === "DalphSelects" && authority.operation._tag === "ReadTrackerGraph") {
      const role = `retained-continuation-authority-${authorityIndex}`
      continuationAnchors.set(authorityIndex, role)
      retainedContinuationAuthority.set(String(item.taskId), role)
    }
  }
  const previous = deliveryStoryCapstoneInput.story[index - 1]
  if (
    index <= firstAdmissionEnd ||
    item._tag !== "DalphSelects" ||
    item.operation._tag !== "ReadTaskWorkSpecification" ||
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(previous)._tag !== "TrackerGraphReadReturned"
  )
    continue
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  const authorityIndex = index - 2
  const retainedAuthorityRole = retainedContinuationAuthority.get(String(item.operation.taskId))
  const authorityRole = retainedAuthorityRole ?? `continuation-authority-${authorityIndex}`
  const occurrences: typeof firstAdmissionOccurrences = []
  const readRoles = new Map<string, Array<string>>()
  let endIndex = index
  let missingPlan = false
  for (; endIndex < deliveryStoryCapstoneInput.story.length; endIndex++) {
    const read = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(deliveryStoryCapstoneInput.story[endIndex])
    if (
      !(
        read._tag === "TaskWorkSpecificationReadReturned" ||
        read._tag === "TaskClaimCurrentReadReturned" ||
        (read._tag === "DalphSelects" &&
          ["ReadTaskWorkSpecification", "ReadTaskClaim", "ReadTaskWorktree", "ReadTargetLineage"].includes(
            read.operation._tag
          ))
      )
    )
      break
    const id = `continuation-${endIndex}`
    const predecessorIds: Array<string> = []
    const node: (typeof occurrences)[number] = { id, storyIndex: endIndex, predecessorIds }
    if (read._tag === "DalphSelects" && "taskId" in read.operation) {
      const taskId = String(read.operation.taskId)
      const planRole = currentPlanRoles.get(taskId)
      if (planRole === undefined) missingPlan = true
      const priorReads = readRoles.get(taskId) ?? []
      const predecessorRoles =
        read.operation._tag === "ReadTargetLineage"
          ? // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
            priorReads.slice(-1)
          : [...(planRole === undefined ? [] : [planRole]), authorityRole, ...priorReads]
      continuationItems.set(endIndex, { occurrenceRole: id, predecessorRoles })
      // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
      const prior = priorReads.at(-1)
      if (prior !== undefined) predecessorIds.push(prior)
      priorReads.push(id)
      readRoles.set(taskId, priorReads)
    } else if (read._tag === "TaskWorkSpecificationReadReturned" || read._tag === "TaskClaimCurrentReadReturned") {
      // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
      const owner = readRoles.get(String(read.taskId))?.at(-1)
      if (owner !== undefined) {
        node.ownerRole = owner
        predecessorIds.push(owner)
      }
    }
    occurrences.push(node)
  }
  const hasWorktreeRead = occurrences.some(({ storyIndex }) => {
    const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(deliveryStoryCapstoneInput.story[storyIndex])
    return item._tag === "DalphSelects" && item.operation._tag === "ReadTaskWorktree"
  })
  if (missingPlan || !hasWorktreeRead) {
    for (const node of occurrences) continuationItems.delete(node.storyIndex)
  } else {
    if (retainedAuthorityRole === undefined) continuationAnchors.set(authorityIndex, authorityRole)
    retainedContinuationAuthority.delete(String(item.operation.taskId))
    continuationWindows.push({ startIndex: index, endIndex, occurrences })
  }
  index = endIndex - 1
}

const restartWindowStart =
  deliveryStoryCapstoneInput.story.findIndex(
    (value) => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)._tag === "OperatorRestartsAttempt"
  ) + 1
const restartBarrierOffset = 2
const restartTerminalIndex = deliveryStoryCapstoneInput.story.findIndex((value, index) => {
  const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)
  return (
    index > restartWindowStart &&
    item._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" &&
    item.report.attemptId === attempt("A") &&
    item.report._tag === "ExecutorWorkTerminal"
  )
})
const restartATerminalRole = "A-terminal-after-B-plan"
const successorReconcileIndex = restartTerminalIndex + 1
const successorBeginIndex = successorReconcileIndex + 1
const successorReconcileRole = "B-successor-reconcile"
const restartCausalWindow = {
  startIndex: restartWindowStart,
  // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
  endIndex: successorBeginIndex + 1,
  occurrences: [
    {
      id: "restart-result",
      storyIndex: restartWindowStart,
      predecessorIds: [],
      directGraphRole: "B-restart-authority",
      directGraphPredecessorRoles: [],
      graphReadCause: "AttemptRestartAuthorityCheck",
      graphReadExplicitTaskIds: ["B"]
    },
    {
      id: "restart-specification-result",
      // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
      storyIndex: restartWindowStart + 1,
      predecessorIds: ["restart-result"],
      directFocusedRead: {
        role: "B-restart-specification",
        kind: "ReadTaskWorkSpecification",
        taskId: "B",
        predecessorRoles: ["B-restart-authority"]
      }
    },
    {
      id: "restart-claim-result",
      // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
      storyIndex: restartWindowStart + 2,
      predecessorIds: ["restart-result", "restart-specification-result"],
      directFocusedRead: {
        role: "B-restart-claim",
        kind: "ReadTaskClaim",
        taskId: "B",
        predecessorRoles: ["B-restart-authority", "B-restart-specification"]
      }
    },
    {
      id: "restart-worktree-result",
      // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
      storyIndex: restartWindowStart + 3,
      predecessorIds: ["restart-result", "restart-specification-result", "restart-claim-result"],
      directGitRead: {
        role: "B-restart-worktree",
        kind: "ReadTaskWorktree",
        taskId: "B",
        attemptId: attempt("B"),
        predecessorRoles: ["B-restart-authority", "B-restart-specification", "B-restart-claim"]
      }
    },
    {
      id: "restart-lineage-result",
      // eslint-disable-next-line no-magic-numbers -- Exact authored occurrence offset, audited against this contiguous story.
      storyIndex: restartWindowStart + 4,
      predecessorIds: ["restart-worktree-result"],
      directGitRead: {
        role: "B-restart-lineage",
        kind: "ReadTargetLineage",
        taskId: "B",
        attemptId: attempt("B"),
        predecessorRoles: ["B-restart-worktree"]
      }
    },
    {
      id: "B-successor-capacity-publication",
      storyIndex: restartTerminalIndex - restartBarrierOffset,
      predecessorIds: ["restart-lineage-result"],
      acceptedPlanPredecessorRoles: ["B-accepted-successor-plan"]
    },
    {
      id: "A-queue-hold-armed",
      storyIndex: restartTerminalIndex - 1,
      predecessorIds: ["B-successor-capacity-publication"]
    },
    {
      id: restartATerminalRole,
      storyIndex: restartTerminalIndex,
      predecessorIds: ["A-queue-hold-armed"],
      acceptedPlanPredecessorRoles: ["B-accepted-successor-plan"]
    },
    {
      id: successorReconcileRole,
      storyIndex: successorReconcileIndex,
      predecessorIds: [restartATerminalRole],
      acceptedPlanPredecessorRoles: ["B-accepted-successor-plan"]
    },
    { id: "B-successor-begin-report", storyIndex: successorBeginIndex, predecessorIds: [successorReconcileRole] }
  ]
}
// Integration and a newly claimed task have separate causal lanes until the next passive lifecycle barrier.
// Reject invalid authored premises through the schema boundary before building causal occurrences.
const failInvalidAuthoredPremise: (message: string) => never = (message) =>
  Schema.decodeUnknownSync(Schema.Never)(message)
const releaseClaimReadCount = 2
const confirmOriginalClaimReadOrdinal = 3
const firstCleanupAttemptOrdinal = 1
const markerAbsentCleanupAttemptOrdinal = 2
const integrationAdmissionItems = new Map<number, { occurrenceRole: string; predecessorRoles: Array<string> }>()
const integrationAdmissionAnchors = new Map<number, string>()
const integrationAdmissionWindows: typeof continuationWindows = []
for (const [integratingTask, admittedTask] of [
  ["C", "F"],
  ["D", "G"]
]) {
  if (integratingTask === undefined || admittedTask === undefined) {
    failInvalidAuthoredPremise("missing exact integration/admission task pair")
  }
  // Find the lineage selection immediately before this task's exact Integrator request; continuation reads are earlier.
  const requestIndex = deliveryStoryCapstoneInput.story.findIndex((value) => {
    const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)
    return (
      item._tag === "IntegratorRequestReceived" && item.correlation.session.plannedAttempt.taskId === integratingTask
    )
  })
  const integrationStart = deliveryStoryCapstoneInput.story.findLastIndex((value, index) => {
    const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)
    return (
      index < requestIndex &&
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReadTargetLineage" &&
      item.operation.taskId === integratingTask
    )
  })
  const endIndex = deliveryStoryCapstoneInput.story.findIndex(
    (value, index) =>
      index > requestIndex &&
      Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)._tag ===
        "PlannedAttemptExecutorPassiveLifecycleChanged"
  )
  const claimGraphIndex = deliveryStoryCapstoneInput.story.findLastIndex((value, index) => {
    const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)
    return index < integrationStart && item._tag === "DalphSelects" && item.operation._tag === "ReadTrackerGraph"
  })
  const claimGraphRole = `admission-${admittedTask}-post-claim-graph`
  integrationAdmissionAnchors.set(claimGraphIndex, claimGraphRole)
  const occurrences: typeof firstAdmissionOccurrences = []
  const lastByLane = new Map<string, string>()
  const readOwners = new Map<string, string>()
  let finalityGraphRole: string | undefined
  let releaseReadOrdinal = 0
  const integrationRequest = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
    deliveryStoryCapstoneInput.story[requestIndex]
  )
  if (integrationRequest._tag !== "IntegratorRequestReceived")
    failInvalidAuthoredPremise("missing exact Integrator request")
  const promotionRequestId = `target-promotion:${integrationRequest.correlation.session.sessionId}:${integrationRequest.correlation.ordinal}:${candidateCommit(integratingTask)}`
  for (let index = integrationStart; index < endIndex; index++) {
    const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(deliveryStoryCapstoneInput.story[index])
    const admission =
      (item._tag === "DalphSelects" && "taskId" in item.operation && item.operation.taskId === admittedTask) ||
      (item._tag === "TaskWorkSpecificationReadReturned" && item.taskId === admittedTask) ||
      (item._tag === "PlannedAttemptExecutorWorkReported" && item.report.attemptId === attempt(admittedTask))
    const lane = admission ? admittedTask : integratingTask
    const id = continuationAnchors.get(index) ?? `integration-admission-${lane}-${index}`
    const prior = lastByLane.get(lane)
    const node: (typeof firstAdmissionOccurrences)[number] = {
      id,
      storyIndex: index,
      predecessorIds: prior === undefined ? [] : [prior]
    }
    if (item._tag === "DalphSelects") {
      integrationAdmissionAnchors.set(index, id)
      if (item.operation._tag === "ReadTargetLineage" && item.operation.taskId === integratingTask)
        integrationAdmissionItems.set(index, { occurrenceRole: id, predecessorRoles: [] })
      if (item.operation._tag === "ReadTrackerGraph") {
        node.graphReadCause = "PostPromotionFinalityCheck"
        node.graphReadExplicitTaskIds = [integratingTask]
        finalityGraphRole = id
        integrationAdmissionItems.set(index, { occurrenceRole: id, predecessorRoles: [] })
        readOwners.set("graph", id)
      }
      if (item.operation._tag === "ReadTaskWorkSpecification") {
        readOwners.set(`specification:${item.operation.taskId}`, id)
        const role = admission ? claimGraphRole : finalityGraphRole
        if (role !== undefined) integrationAdmissionItems.set(index, { occurrenceRole: id, predecessorRoles: [role] })
      }
      if (item.operation._tag === "ReadTaskClaim") {
        readOwners.set(`claim:${item.operation.taskId}`, id)
        if (finalityGraphRole !== undefined)
          integrationAdmissionItems.set(index, { occurrenceRole: id, predecessorRoles: [finalityGraphRole] })
      }
    } else if (
      item._tag === "TrackerGraphReadReturned" ||
      item._tag === "TaskWorkSpecificationReadReturned" ||
      item._tag === "TaskClaimCurrentReadReturned"
    ) {
      const key =
        item._tag === "TrackerGraphReadReturned"
          ? "graph"
          : item._tag === "TaskWorkSpecificationReadReturned"
            ? `specification:${item.taskId}`
            : `claim:${item.taskId}`
      const owner = readOwners.get(key)
      if (owner !== undefined) {
        node.ownerRole = owner
        readOwners.delete(key)
      } else if (item._tag === "TaskClaimCurrentReadReturned") {
        releaseReadOrdinal += 1
        const identity = { taskId: item.taskId, deletionOperationId: `completion-claim-deletion:${promotionRequestId}` }
        const cleanupOccurrence = Schema.decodeUnknownSync(AuthoredCausalWindow)({
          startIndex: index,
          endIndex: index + 1,
          occurrences: [
            {
              id,
              storyIndex: index,
              predecessorIds: [],
              directCleanupClaimRead:
                releaseReadOrdinal <= releaseClaimReadCount
                  ? {
                      ...identity,
                      call: "ReleaseOriginalClaimRead",
                      releaseOperationId: `completion-original-claim-release:${promotionRequestId}`,
                      readOrdinal: releaseReadOrdinal
                    }
                  : {
                      ...identity,
                      call:
                        releaseReadOrdinal === confirmOriginalClaimReadOrdinal
                          ? "ConfirmOriginalClaimReleased"
                          : "ConfirmNoActiveClaimAfterMarkerAbsent",
                      attemptOrdinal:
                        releaseReadOrdinal === confirmOriginalClaimReadOrdinal
                          ? firstCleanupAttemptOrdinal
                          : markerAbsentCleanupAttemptOrdinal,
                      readOrdinal: firstCleanupAttemptOrdinal
                    }
            }
          ]
        }).occurrences[0]
        if (cleanupOccurrence?.directCleanupClaimRead === undefined) {
          failInvalidAuthoredPremise(`missing exact cleanup claim identity at story ${index}`)
        }
        node.directCleanupClaimRead = cleanupOccurrence.directCleanupClaimRead
      }
    }
    occurrences.push(node)
    lastByLane.set(lane, id)
  }
  integrationAdmissionWindows.push({ startIndex: integrationStart, endIndex, occurrences })
}
export const deliveryStoryCapstoneAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...deliveryStoryCapstoneInput,
  story: deliveryStoryCapstoneInput.story.map((value, index) => {
    const item = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(value)
    if (index === successorReconcileIndex && item._tag === "DalphSelects") {
      return {
        ...item,
        causal: { occurrenceRole: successorReconcileRole, predecessorRoles: ["B-accepted-successor-plan"] }
      }
    }
    const integrationCausal = integrationAdmissionItems.get(index)
    if (integrationCausal !== undefined) return { ...item, causal: integrationCausal }
    const integrationAnchor = integrationAdmissionAnchors.get(index)
    if (integrationAnchor !== undefined && item._tag === "DalphSelects")
      return { ...item, causalAnchor: { occurrenceRole: integrationAnchor } }
    const anchor = continuationAnchors.get(index)
    if (anchor !== undefined && item._tag === "DalphSelects")
      return { ...item, causalAnchor: { occurrenceRole: anchor } }
    const causal = continuationItems.get(index)
    return causal === undefined ? item : { ...item, causal }
  }),
  acceptedReplacementPlanRoles: [
    { occurrenceRole: "B-accepted-successor-plan", taskId: "B", successorAttemptId: bSuccessorAttempt }
  ],
  causalWindows: [
    firstAdmissionCausalWindow,
    ...continuationWindows.filter((window) => window.startIndex < restartWindowStart),
    restartCausalWindow,
    ...continuationWindows.filter((window) => window.startIndex > restartWindowStart),
    ...integrationAdmissionWindows
  ]
})
