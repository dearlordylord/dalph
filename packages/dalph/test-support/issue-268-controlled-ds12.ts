import { plannedAttemptExecutorCorrelation, samePlannedTaskAttempt, type PlannedTaskAttempt } from "@dalph/contracts"
import {
  isExactTaskClaim,
  taskTrackerTargetKey,
  type DeliveryRelationInputBundle,
  type JournalRecord,
  type OperationId
} from "@dalph/orchestrator"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"
import { isIssue268ExactB1Plan } from "./issue-268-controlled-ds06.js"

const expectedHeld = [scenario.attempts.A1, scenario.attempts.D1]
  .map((attemptId) => `${scenario.runId}:${attemptId}`)
  .toSorted()

type DeliveryActionProposal =
  DeliveryRelationInputBundle["actionInputs"]["proposalContributions"]["ticketDelivery"][number]

const sameOperationIds = (left: ReadonlyArray<OperationId>, right: ReadonlyArray<OperationId>) =>
  [...left].toSorted().join(",") === [...right].toSorted().join(",")

const onlyItem = <A>(items: ReadonlyArray<A>): A | undefined => (items.length === 1 ? items[0] : undefined)

const exactBPlanRecord = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) =>
  records.find(
    ({ event }) =>
      event._tag === "TaskAttemptPlanned" && samePlannedTaskAttempt(event.operation.plannedAttempt, plannedAttempt)
  )

const exactBPlanOperationId = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const plan = exactBPlanRecord(records, plannedAttempt)
  return plan?.event._tag === "TaskAttemptPlanned" ? plan.event.operation.operationId : undefined
}

const exactBClaimRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === scenario.taskIds.B)

const exactChoiceRecord = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const choices = records.filter(
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "ContinueExistingAttempt" &&
      event.requestId.nonce === "issue-268-continue-B1" &&
      event.requestId.runId === scenario.runId &&
      event.subject.observedTaskRevision === scenario.specifications.F2.B.fingerprint &&
      samePlannedTaskAttempt(event.subject.plannedAttempt, plannedAttempt)
  )
  return choices.length === 1 ? choices[0] : undefined
}

const exactGraphPair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  planOperationId: OperationId
) => {
  const intents = records.filter(
    ({ event, position }) =>
      position > after &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.cause._tag === "AttemptContinuation" &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(scenario.target) &&
      event.operation.readShape.explicitlyCoveredTaskIds.length === 1 &&
      event.operation.readShape.explicitlyCoveredTaskIds[0] === scenario.taskIds.B &&
      sameOperationIds(event.operation.predecessorOperationIds, [planOperationId])
  )
  const intent = intents[0]
  if (intents.length !== 1 || intent?.event._tag !== "TaskTrackerReadIntentRecorded") return undefined
  const operation = intent.event.operation
  if (operation._tag !== "ReadTrackerGraph") return undefined
  const outcomes = records.filter(
    ({ event, position }) =>
      position > intent.position &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.operationId === operation.operationId &&
      event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed" &&
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(scenario.target) &&
      event.observation.factFamilies.every(({ contentIdentity }) => contentIdentity === scenario.graphs.G2.revision)
  )
  const outcome = onlyItem(outcomes)
  return outcome === undefined ? undefined : { intent, operationId: operation.operationId, outcome }
}

const exactSpecificationPair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  planOperationId: OperationId,
  graphOperationId: OperationId
) => {
  const intents = records.filter(
    ({ event, position }) =>
      position > after &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorkSpecification" &&
      event.operation.taskId === scenario.taskIds.B &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(scenario.target) &&
      sameOperationIds(event.operation.predecessorOperationIds, [planOperationId, graphOperationId])
  )
  const intent = intents[0]
  if (intents.length !== 1 || intent?.event._tag !== "TaskTrackerReadIntentRecorded") return undefined
  const operation = intent.event.operation
  if (operation._tag !== "ReadTaskWorkSpecification") return undefined
  const outcomes = records.filter(({ event, position }) => {
    if (position <= intent.position || event._tag !== "TaskTrackerFactsObserved") return false
    if (event.observation._tag !== "FocusedTaskWorkSpecificationFacts") return false
    return [
      event.operationId === operation.operationId,
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(scenario.target),
      event.observation.factFamily.coverage.taskId === scenario.taskIds.B,
      event.observation.factFamily.freshness.operationId === operation.operationId,
      event.observation.factFamily.taskId === scenario.taskIds.B,
      event.observation.factFamily.contentIdentity === scenario.specifications.F2.B.fingerprint,
      event.observation.factFamily.fingerprint === scenario.specifications.F2.B.fingerprint,
      event.observation.factFamily.title === scenario.specifications.F2.B.title,
      event.observation.factFamily.body === scenario.specifications.F2.B.body
    ].every(Boolean)
  })
  const outcome = onlyItem(outcomes)
  return outcome === undefined ? undefined : { intent, operationId: operation.operationId, outcome }
}

const exactClaimPair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  planOperationId: OperationId,
  graphOperationId: OperationId,
  specificationOperationId: OperationId
) => {
  const acquired = exactBClaimRecord(records)
  if (acquired?.event._tag !== "TaskClaimAcquired") return undefined
  const acquiredClaim = acquired.event.claim
  const intents = records.filter(
    ({ event, position }) =>
      position > after &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.taskId === scenario.taskIds.B &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(scenario.target) &&
      sameOperationIds(event.operation.predecessorOperationIds, [
        planOperationId,
        graphOperationId,
        specificationOperationId
      ])
  )
  const intent = intents[0]
  if (intents.length !== 1 || intent?.event._tag !== "TaskTrackerReadIntentRecorded") return undefined
  const operation = intent.event.operation
  if (operation._tag !== "ReadTaskClaim") return undefined
  const outcomes = records.filter(({ event, position }) => {
    if (position <= intent.position || event._tag !== "TaskTrackerFactsObserved") return false
    if (
      event.observation._tag !== "FocusedTaskClaimFacts" ||
      event.observation.observation._tag !== "ActiveTaskClaim"
    ) {
      return false
    }
    return [
      event.operationId === operation.operationId,
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(scenario.target),
      event.observation.coverage.taskId === scenario.taskIds.B,
      event.observation.freshness.operationId === operation.operationId,
      isExactTaskClaim(event.observation.observation, acquiredClaim)
    ].every(Boolean)
  })
  const outcome = onlyItem(outcomes)
  return outcome === undefined ? undefined : { intent, operationId: operation.operationId, outcome }
}

const exactWorktreePair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: ReadonlyArray<OperationId>
) => {
  const intents = records.filter(
    ({ event, position }) =>
      position > after &&
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorktree" &&
      samePlannedTaskAttempt(event.operation.plannedAttempt, plannedAttempt) &&
      sameOperationIds(event.operation.predecessorOperationIds, predecessorOperationIds)
  )
  const intent = intents[0]
  if (intents.length !== 1 || intent?.event._tag !== "GitReadIntentRecorded") return undefined
  const operation = intent.event.operation
  if (operation._tag !== "ReadTaskWorktree") return undefined
  const outcomes = records.filter(
    ({ event, position }) =>
      position > intent.position &&
      event._tag === "PlannedAttemptWorktreeObserved" &&
      event.operationId === operation.operationId &&
      event.observation._tag === "PlannedWorktreeReady" &&
      event.observation.baseSha === plannedAttempt.baseSha &&
      event.observation.branch === plannedAttempt.branch &&
      event.observation.worktree === plannedAttempt.worktree
  )
  const outcome = onlyItem(outcomes)
  return outcome === undefined ? undefined : { intent, operationId: operation.operationId, outcome }
}

const exactLineagePair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt,
  worktreeOperationId: OperationId
) => {
  const intents = records.filter(
    ({ event, position }) =>
      position > after &&
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTargetLineage" &&
      samePlannedTaskAttempt(event.operation.plannedAttempt, plannedAttempt) &&
      event.operation.integrationTarget.repository === scenario.integrationTarget.repository &&
      event.operation.integrationTarget.ref === scenario.integrationTarget.ref &&
      sameOperationIds(event.operation.predecessorOperationIds, [worktreeOperationId])
  )
  const intent = intents[0]
  if (intents.length !== 1 || intent?.event._tag !== "GitReadIntentRecorded") return undefined
  const operation = intent.event.operation
  if (operation._tag !== "ReadTargetLineage") return undefined
  const outcomes = records.filter(
    ({ event, position }) =>
      position > intent.position &&
      event._tag === "TargetLineageObserved" &&
      event.operationId === operation.operationId &&
      samePlannedTaskAttempt(event.plannedAttempt, plannedAttempt) &&
      event.observation.plannedBaseSha === plannedAttempt.baseSha &&
      event.observation.plannedBaseIsAncestorOfTargetHead
  )
  const outcome = onlyItem(outcomes)
  return outcome === undefined ? undefined : { intent, operationId: operation.operationId, outcome }
}

interface ContinuationWitnessIds {
  readonly claim: OperationId
  readonly graph: OperationId
  readonly lineage: OperationId
  readonly specification: OperationId
  readonly worktree: OperationId
}

const isExactWaitingBProposal = (
  proposal: DeliveryActionProposal,
  plannedAttempt: PlannedTaskAttempt,
  witness: ContinuationWitnessIds
) => {
  if (proposal.route._tag !== "IdentityFreeWorkflowRoute") return false
  const transition = proposal.route.transition
  if (transition._tag !== "ResumePlannedAttemptExecutorWorkAfterCurrentFacts") return false
  const { admission } = proposal
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const witnessMatches = [
    transition.witness.activeTaskContinuationRead.graphObservationOperationId === witness.graph &&
      transition.witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId ===
        witness.specification,
    transition.witness.activeTaskContinuationRead.taskClaimObservationOperationId === witness.claim,
    transition.witness.worktreeObservationOperationId === witness.worktree,
    transition.witness.targetLineageObservationOperationId === witness.lineage
  ].every(Boolean)
  const admissionMatches = [
    admission.taskWorkPosition._tag === "TaskWorkPositionRequired" &&
      admission.taskWorkPosition.mode === "ReserveOrReuse" &&
      admission.taskWorkPosition.taskId === scenario.taskIds.B,
    admission.plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired" &&
      admission.plannedAttemptProtocol.correlation.runId === correlation.runId &&
      admission.plannedAttemptProtocol.correlation.attemptId === correlation.attemptId
  ].every(Boolean)
  return [samePlannedTaskAttempt(transition.plannedAttempt, plannedAttempt), witnessMatches, admissionMatches].every(
    Boolean
  )
}

const retainsReadyB = (publication: DeliveryRelationInputBundle, plannedAttempt: PlannedTaskAttempt) => {
  const evidence = publication.publication.exactEvidence.filter(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
      evidence.facts.responsibility.plannedAttempt.runId === scenario.runId &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.B1
  )
  const exact = onlyItem(evidence)
  return (
    exact?._tag === "ResponsibilityFacts" &&
    exact.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
    exact.facts.disposition._tag === "Ready" &&
    isIssue268ExactB1Plan(exact.facts.responsibility.plannedAttempt) &&
    samePlannedTaskAttempt(exact.facts.responsibility.plannedAttempt, plannedAttempt)
  )
}

const retainsExactC = (publication: DeliveryRelationInputBundle, records: ReadonlyArray<JournalRecord>) => {
  const began = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === scenario.attempts.C1 &&
      event.plannedAttempt.runId === scenario.runId
  )
  if (began?.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return false
  const plannedAttempt = began.event.plannedAttempt
  const evidence = publication.publication.exactEvidence.filter(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
      evidence.facts.responsibility.plannedAttempt.runId === scenario.runId &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.C1
  )
  const exact = onlyItem(evidence)
  return (
    exact?._tag === "ResponsibilityFacts" &&
    exact.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
    exact.facts.disposition._tag === "TaskLifecycleConstraint" &&
    samePlannedTaskAttempt(exact.facts.responsibility.plannedAttempt, plannedAttempt)
  )
}

const hasExactOccupiedPositions = (publication: DeliveryRelationInputBundle) => {
  const occupied = publication.actionInputs.runtimeFacts.taskWork.occupied
  const expected = [
    { attemptId: scenario.attempts.A1, taskId: scenario.taskIds.A },
    { attemptId: scenario.attempts.D1, taskId: scenario.taskIds.D }
  ]
  return (
    occupied.size === expected.length &&
    expected.every(({ attemptId, taskId }) => {
      const position = occupied.get(taskId)
      return (
        position?._tag === "ExactAttemptHeld" &&
        position.plannedAttempt.runId === scenario.runId &&
        position.plannedAttempt.attemptId === attemptId &&
        position.plannedAttempt.taskId === taskId
      )
    })
  )
}

const hasNoPrematureBAction = (records: ReadonlyArray<JournalRecord>, after: JournalRecord["position"]) =>
  !records.some(
    ({ event, position }) =>
      position > after &&
      ((event._tag === "PlannedAttemptContinuationAuthorized" &&
        event.plannedAttempt.attemptId === scenario.attempts.B1) ||
        (event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Resume" &&
          event.plannedAttempt.attemptId === scenario.attempts.B1))
  )

const exactContinuationPrefix = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const planOperationId = exactBPlanOperationId(records, plannedAttempt)
  if (planOperationId === undefined) return undefined
  const choice = exactChoiceRecord(records, plannedAttempt)
  if (choice === undefined) return undefined
  const graph = exactGraphPair(records, choice.position, planOperationId)
  if (graph === undefined) return undefined
  const specification = exactSpecificationPair(records, graph.outcome.position, planOperationId, graph.operationId)
  if (specification === undefined) return undefined
  return { choice, graph, planOperationId, specification }
}

const exactContinuationSuffix = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  prefix: NonNullable<ReturnType<typeof exactContinuationPrefix>>
) => {
  const claim = exactClaimPair(
    records,
    prefix.specification.outcome.position,
    prefix.planOperationId,
    prefix.graph.operationId,
    prefix.specification.operationId
  )
  if (claim === undefined) return undefined
  const worktree = exactWorktreePair(records, claim.outcome.position, plannedAttempt, [
    prefix.planOperationId,
    prefix.graph.operationId,
    prefix.specification.operationId,
    claim.operationId
  ])
  if (worktree === undefined) return undefined
  const lineage = exactLineagePair(records, worktree.outcome.position, plannedAttempt, worktree.operationId)
  if (lineage === undefined) return undefined
  return { claim, lineage, worktree }
}

const exactContinuationHistory = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const prefix = exactContinuationPrefix(records, plannedAttempt)
  if (prefix === undefined) return undefined
  const suffix = exactContinuationSuffix(records, plannedAttempt, prefix)
  return suffix === undefined ? undefined : { ...prefix, ...suffix }
}

/** DS-12 completes when exact B1 is eligible to Resume but A1/D1 still fill P2. */
export const isIssue268Ds12CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const retainedB = publication.publication.exactEvidence.find(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.B1 &&
      evidence.facts.responsibility.plannedAttempt.runId === scenario.runId
  )
  if (
    retainedB === undefined ||
    retainedB._tag !== "ResponsibilityFacts" ||
    retainedB.facts._tag !== "PlannedAttemptExecutorFreshFacts"
  ) {
    return false
  }
  const plannedAttempt = retainedB.facts.responsibility.plannedAttempt
  const history = exactContinuationHistory(records, plannedAttempt)
  if (history === undefined) return false
  const acceptedAt = publication.actionInputs.runtimeFacts.acceptedAt
  if (acceptedAt === null || publication.publication.graph._tag !== "GraphEstablished") return false
  const held = publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => `${correlation.runId}:${correlation.attemptId}`)
    .toSorted()
  const witness = {
    claim: history.claim.operationId,
    graph: history.graph.operationId,
    lineage: history.lineage.operationId,
    specification: history.specification.operationId,
    worktree: history.worktree.operationId
  }
  const proposals = publication.actionInputs.proposalContributions.ticketDelivery.filter((proposal) =>
    isExactWaitingBProposal(proposal, plannedAttempt, witness)
  )
  return [
    acceptedAt >= history.lineage.outcome.position,
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G2.revision,
    publication.publication.policy.taskExecutionCapacity === scenario.policies.P2,
    held.join(",") === expectedHeld.join(","),
    hasExactOccupiedPositions(publication),
    proposals.length === 1,
    retainsReadyB(publication, plannedAttempt),
    retainsExactC(publication, records),
    hasNoPrematureBAction(records, history.choice.position)
  ].every(Boolean)
}
