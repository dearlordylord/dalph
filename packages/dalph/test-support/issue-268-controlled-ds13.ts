/* eslint-disable max-lines -- The DS-13 checkpoint keeps its exact causal witness validators co-located for auditability. */
import {
  samePlannedAttemptExecutorReport,
  samePlannedTaskAttempt,
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import {
  deliveryProposalOrderTaskId,
  isExactTaskClaim,
  PlannedAttemptExecutorReportOrdinal,
  taskTrackerTargetKey,
  type DeliveryRelationInputBundle,
  type JournalRecord,
  type OperationId
} from "@dalph/orchestrator"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"
import { isIssue268ExactB1Plan } from "./issue-268-controlled-ds06.js"

const expectedHeld = [scenario.attempts.B1, scenario.attempts.D1]
  .map((attemptId) => `${scenario.runId}:${attemptId}`)
  .toSorted()
const continuationWitnessCount = 5
const a1TerminalReportOrdinalValue = 2
const a1TerminalReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(a1TerminalReportOrdinalValue)

const onlyItem = <A>(items: ReadonlyArray<A>): A | undefined => (items.length === 1 ? items[0] : undefined)

const sameOperationIds = (left: ReadonlyArray<OperationId>, right: ReadonlyArray<OperationId>) =>
  [...left].toSorted().join(",") === [...right].toSorted().join(",")

const isScenarioAfter = (record: JournalRecord, after: JournalRecord["position"]) =>
  record.runId === scenario.runId && record.position > after

const isExactA1Plan = (plan: PlannedTaskAttempt) =>
  [
    plan.attemptId === scenario.attempts.A1,
    plan.baseSha === scenario.baseSha,
    plan.branch === "refs/heads/dalph/issue-268-a-1",
    plan.executor === "executor:issue-268-controlled",
    plan.runId === scenario.runId,
    plan.taskId === scenario.taskIds.A,
    plan.taskRevision === scenario.specifications.F1.A.fingerprint,
    plan.worktree === "/dalph/controlled-characterization/issue-268/A-1"
  ].every(Boolean)

const isExactC1Plan = (plan: PlannedTaskAttempt) =>
  [
    plan.attemptId === scenario.attempts.C1,
    plan.baseSha === scenario.baseSha,
    plan.branch === "refs/heads/dalph/issue-268-c-1",
    plan.executor === "executor:issue-268-controlled",
    plan.runId === scenario.runId,
    plan.taskId === scenario.taskIds.C,
    plan.taskRevision === scenario.specifications.F1.C.fingerprint,
    plan.worktree === "/dalph/controlled-characterization/issue-268/C-1"
  ].every(Boolean)

const isExactD1Plan = (plan: PlannedTaskAttempt) =>
  [
    plan.attemptId === scenario.attempts.D1,
    plan.baseSha === scenario.baseSha,
    plan.branch === "refs/heads/dalph/issue-268-d-1",
    plan.executor === "executor:issue-268-controlled",
    plan.runId === scenario.runId,
    plan.taskId === scenario.taskIds.D,
    plan.taskRevision === scenario.specifications.F1.D.fingerprint,
    plan.worktree === "/dalph/controlled-characterization/issue-268/D-1"
  ].every(Boolean)

const exactBPlanRecords = (records: ReadonlyArray<JournalRecord>) =>
  records.filter(
    ({ event, runId }) =>
      runId === scenario.runId &&
      event._tag === "TaskAttemptPlanned" &&
      isIssue268ExactB1Plan(event.operation.plannedAttempt)
  )

const exactChoiceRecords = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) =>
  records.filter(
    ({ event, runId }) =>
      runId === scenario.runId &&
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "ContinueExistingAttempt" &&
      event.requestId.nonce === "issue-268-continue-B1" &&
      event.requestId.runId === scenario.runId &&
      event.subject.observedTaskRevision === scenario.specifications.F2.B.fingerprint &&
      samePlannedTaskAttempt(event.subject.plannedAttempt, plannedAttempt)
  )

const isExactGraphIntent = (record: JournalRecord, after: JournalRecord["position"], planOperationId: OperationId) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "TaskTrackerReadIntentRecorded") return false
  if (event.operation._tag !== "ReadTrackerGraph" || event.operation.cause._tag !== "AttemptContinuation") return false
  return [
    taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(scenario.target),
    event.operation.readShape.explicitlyCoveredTaskIds.length === 1,
    event.operation.readShape.explicitlyCoveredTaskIds[0] === scenario.taskIds.B,
    sameOperationIds(event.operation.predecessorOperationIds, [planOperationId])
  ].every(Boolean)
}

const isExactGraphOutcome = (record: JournalRecord, after: JournalRecord["position"], operationId: OperationId) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "TaskTrackerFactsObserved") return false
  if (event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return false
  return [
    event.operationId === operationId,
    taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(scenario.target),
    event.observation.factFamilies.every(({ contentIdentity }) => contentIdentity === scenario.graphs.G2.revision)
  ].every(Boolean)
}

const exactGraphPair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  planOperationId: OperationId
) => {
  const intents = records.filter((record) => isExactGraphIntent(record, after, planOperationId))
  const intent = onlyItem(intents)
  if (intent?.event._tag !== "TaskTrackerReadIntentRecorded" || intent.event.operation._tag !== "ReadTrackerGraph") {
    return undefined
  }
  const operation = intent.event.operation
  const outcomes = records.filter((record) => isExactGraphOutcome(record, intent.position, operation.operationId))
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
    ({ event, position, runId }) =>
      runId === scenario.runId &&
      position > after &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorkSpecification" &&
      event.operation.taskId === scenario.taskIds.B &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(scenario.target) &&
      sameOperationIds(event.operation.predecessorOperationIds, [planOperationId, graphOperationId])
  )
  const intent = onlyItem(intents)
  if (
    intent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
    intent.event.operation._tag !== "ReadTaskWorkSpecification"
  ) {
    return undefined
  }
  const operation = intent.event.operation
  const outcomes = records.filter(({ event, position, runId }) => {
    if (runId !== scenario.runId || position <= intent.position || event._tag !== "TaskTrackerFactsObserved")
      return false
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
  const acquired = onlyItem(
    records.filter(
      ({ event, runId }) =>
        runId === scenario.runId && event._tag === "TaskClaimAcquired" && event.claim.taskId === scenario.taskIds.B
    )
  )
  if (acquired?.event._tag !== "TaskClaimAcquired") return undefined
  const acquiredClaim = acquired.event.claim
  const intents = records.filter(
    ({ event, position, runId }) =>
      runId === scenario.runId &&
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
  const intent = onlyItem(intents)
  if (intent?.event._tag !== "TaskTrackerReadIntentRecorded" || intent.event.operation._tag !== "ReadTaskClaim") {
    return undefined
  }
  const operation = intent.event.operation
  const outcomes = records.filter(({ event, position, runId }) => {
    if (runId !== scenario.runId || position <= intent.position || event._tag !== "TaskTrackerFactsObserved")
      return false
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

const isExactWorktreeIntent = (
  record: JournalRecord,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: ReadonlyArray<OperationId>
) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "GitReadIntentRecorded") return false
  if (event.operation._tag !== "ReadTaskWorktree") return false
  return [
    samePlannedTaskAttempt(event.operation.plannedAttempt, plannedAttempt),
    sameOperationIds(event.operation.predecessorOperationIds, predecessorOperationIds)
  ].every(Boolean)
}

const isExactWorktreeOutcome = (
  record: JournalRecord,
  after: JournalRecord["position"],
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt
) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "PlannedAttemptWorktreeObserved") return false
  if (event.observation._tag !== "PlannedWorktreeReady") return false
  return [
    event.operationId === operationId,
    event.observation.baseSha === plannedAttempt.baseSha,
    event.observation.branch === plannedAttempt.branch,
    event.observation.headSha === plannedAttempt.baseSha,
    event.observation.worktree === plannedAttempt.worktree
  ].every(Boolean)
}

const exactWorktreePair = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: ReadonlyArray<OperationId>
) => {
  const intents = records.filter((record) =>
    isExactWorktreeIntent(record, after, plannedAttempt, predecessorOperationIds)
  )
  const intent = onlyItem(intents)
  if (intent?.event._tag !== "GitReadIntentRecorded" || intent.event.operation._tag !== "ReadTaskWorktree") {
    return undefined
  }
  const operation = intent.event.operation
  const outcomes = records.filter((record) =>
    isExactWorktreeOutcome(record, intent.position, operation.operationId, plannedAttempt)
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
    ({ event, position, runId }) =>
      runId === scenario.runId &&
      position > after &&
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTargetLineage" &&
      samePlannedTaskAttempt(event.operation.plannedAttempt, plannedAttempt) &&
      event.operation.integrationTarget.repository === scenario.integrationTarget.repository &&
      event.operation.integrationTarget.ref === scenario.integrationTarget.ref &&
      sameOperationIds(event.operation.predecessorOperationIds, [worktreeOperationId])
  )
  const intent = onlyItem(intents)
  if (intent?.event._tag !== "GitReadIntentRecorded" || intent.event.operation._tag !== "ReadTargetLineage") {
    return undefined
  }
  const operation = intent.event.operation
  const outcomes = records.filter(
    ({ event, position, runId }) =>
      runId === scenario.runId &&
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

const exactContinuationPrefix = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const plan = onlyItem(exactBPlanRecords(records))
  const choice = onlyItem(exactChoiceRecords(records, plannedAttempt))
  if (plan?.event._tag !== "TaskAttemptPlanned" || choice === undefined) return undefined
  if (
    plan.position >= choice.position ||
    !samePlannedTaskAttempt(plan.event.operation.plannedAttempt, plannedAttempt)
  ) {
    return undefined
  }
  const planOperationId = plan.event.operation.operationId
  const graph = exactGraphPair(records, choice.position, planOperationId)
  if (graph === undefined) return undefined
  const specification = exactSpecificationPair(records, graph.outcome.position, planOperationId, graph.operationId)
  if (specification === undefined) return undefined
  return { choice, graph, plan, planOperationId, specification }
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
  return lineage === undefined ? undefined : { claim, lineage, worktree }
}

const exactContinuationHistory = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const prefix = exactContinuationPrefix(records, plannedAttempt)
  if (prefix === undefined) return undefined
  const suffix = exactContinuationSuffix(records, plannedAttempt, prefix)
  return suffix === undefined ? undefined : { ...prefix, ...suffix }
}

const isAcceptedTerminalReport = (report: PlannedAttemptExecutorReport, attemptId: PlannedTaskAttempt["attemptId"]) =>
  report._tag === "ExecutorWorkTerminal" &&
  report.correlation.runId === scenario.runId &&
  report.correlation.attemptId === attemptId &&
  report.result._tag === "Accepted"

const isExactA1TerminalState = (
  record: JournalRecord,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt
) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "PlannedAttemptExecutorStateObserved") return false
  if (event.observation._tag !== "ExactExecutorReport") return false
  return (
    samePlannedTaskAttempt(event.plannedAttempt, plannedAttempt) &&
    isAcceptedTerminalReport(event.observation.report, scenario.attempts.A1)
  )
}

const isExactA1TerminalReport = (record: JournalRecord, after: JournalRecord["position"]) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "PlannedAttemptExecutorWorkReported") return false
  return isAcceptedTerminalReport(event.report, scenario.attempts.A1)
}

const isExactA1PlanRecord = (record: JournalRecord) => {
  const { event } = record
  if (record.runId !== scenario.runId || event._tag !== "TaskAttemptPlanned") return false
  return event.operation.plannedAttempt.taskId === scenario.taskIds.A && isExactA1Plan(event.operation.plannedAttempt)
}

const isFreshResponsibilityEvidenceFor = (
  candidate: DeliveryRelationInputBundle["publication"]["exactEvidence"][number],
  plannedAttempt: PlannedTaskAttempt
) => {
  if (candidate._tag !== "ResponsibilityFacts" || candidate.facts._tag !== "PlannedAttemptExecutorFreshFacts") {
    return false
  }
  return samePlannedTaskAttempt(candidate.facts.responsibility.plannedAttempt, plannedAttempt)
}

const exactA1StateAndReport = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt
) => {
  const state = onlyItem(records.filter((record) => isExactA1TerminalState(record, after, plannedAttempt)))
  if (
    state?.event._tag !== "PlannedAttemptExecutorStateObserved" ||
    state.event.observation._tag !== "ExactExecutorReport"
  ) {
    return undefined
  }
  const report = onlyItem(records.filter((record) => isExactA1TerminalReport(record, state.position)))
  if (report?.event._tag !== "PlannedAttemptExecutorWorkReported") return undefined
  if (report.event.ordinal !== a1TerminalReportOrdinal) return undefined
  if (!samePlannedAttemptExecutorReport(state.event.observation.report, report.event.report)) return undefined
  return { report: { ...report, event: report.event }, state: { ...state, event: state.event } }
}

const exactA1TerminalHistory = (records: ReadonlyArray<JournalRecord>, after: JournalRecord["position"]) => {
  const aPlan = onlyItem(records.filter(isExactA1PlanRecord))
  if (aPlan?.event._tag !== "TaskAttemptPlanned") return undefined
  const planned = aPlan.event.operation.plannedAttempt
  const terminal = exactA1StateAndReport(records, after, planned)
  return terminal === undefined ? undefined : { aPlan: planned, ...terminal }
}

const exactA1PublicationEvidence = (
  publication: DeliveryRelationInputBundle,
  plannedAttempt: PlannedTaskAttempt,
  report: PlannedAttemptExecutorReport
) => {
  const evidence = publication.publication.exactEvidence.filter((candidate) =>
    isFreshResponsibilityEvidenceFor(candidate, plannedAttempt)
  )
  const exact = onlyItem(evidence)
  if (exact?._tag !== "ResponsibilityFacts" || exact.facts._tag !== "PlannedAttemptExecutorFreshFacts") {
    return false
  }
  const { disposition } = exact.facts
  return (
    disposition._tag === "PlannedAttemptExecutorWorkTerminal" &&
    samePlannedAttemptExecutorReport(disposition.report, report)
  )
}

const exactReadyBPublicationEvidence = (
  publication: DeliveryRelationInputBundle,
  plannedAttempt: PlannedTaskAttempt,
  reportOrdinal: PlannedAttemptExecutorReportOrdinal
) => {
  const evidence = publication.publication.exactEvidence.filter(
    (candidate) =>
      candidate._tag === "ResponsibilityFacts" &&
      candidate.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
      candidate.facts.responsibility.plannedAttempt.runId === scenario.runId &&
      candidate.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.B1
  )
  const exact = onlyItem(evidence)
  if (exact?._tag !== "ResponsibilityFacts" || exact.facts._tag !== "PlannedAttemptExecutorFreshFacts") {
    return false
  }
  const { disposition, responsibility } = exact.facts
  return (
    disposition._tag === "Ready" &&
    isIssue268ExactB1Plan(responsibility.plannedAttempt) &&
    samePlannedTaskAttempt(responsibility.plannedAttempt, plannedAttempt) &&
    disposition.acceptedProgress._tag === "ExecutorReportAccepted" &&
    disposition.acceptedProgress.ordinal === reportOrdinal
  )
}

const isExactC1PlanRecord = (record: JournalRecord) => {
  const { event } = record
  if (record.runId !== scenario.runId || event._tag !== "TaskAttemptPlanned") return false
  return event.operation.plannedAttempt.taskId === scenario.taskIds.C && isExactC1Plan(event.operation.plannedAttempt)
}

const isExactC1ResponsibilityRecord = (record: JournalRecord) => {
  const { event } = record
  if (record.runId !== scenario.runId || event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return false
  return isExactC1Plan(event.plannedAttempt)
}

const exactC1Attempt = (records: ReadonlyArray<JournalRecord>) => {
  const cPlan = onlyItem(records.filter(isExactC1PlanRecord))
  const began = onlyItem(records.filter(isExactC1ResponsibilityRecord))
  if (
    cPlan?.event._tag !== "TaskAttemptPlanned" ||
    began?.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan"
  ) {
    return undefined
  }
  return samePlannedTaskAttempt(cPlan.event.operation.plannedAttempt, began.event.plannedAttempt)
    ? began.event.plannedAttempt
    : undefined
}

const exactRetainedC1PublicationEvidence = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const cAttempt = exactC1Attempt(records)
  if (cAttempt === undefined) return false
  const evidence = publication.publication.exactEvidence.filter((candidate) =>
    isFreshResponsibilityEvidenceFor(candidate, cAttempt)
  )
  const exact = onlyItem(evidence)
  if (exact?._tag !== "ResponsibilityFacts" || exact.facts._tag !== "PlannedAttemptExecutorFreshFacts") return false
  return exact.facts.disposition._tag === "TaskLifecycleConstraint"
}

const hasExactFinalPositions = (publication: DeliveryRelationInputBundle) => {
  const held = publication.actionInputs.runtimeFacts.taskWork.held
  const occupied = publication.actionInputs.runtimeFacts.taskWork.occupied
  const heldCorrelations = held.map(({ correlation }) => `${correlation.runId}:${correlation.attemptId}`).toSorted()
  const expected = [
    { attemptId: scenario.attempts.B1, plan: isIssue268ExactB1Plan, taskId: scenario.taskIds.B },
    { attemptId: scenario.attempts.D1, plan: isExactD1Plan, taskId: scenario.taskIds.D }
  ]
  return (
    heldCorrelations.join(",") === expectedHeld.join(",") &&
    occupied.size === expected.length &&
    expected.every(({ attemptId, plan, taskId }) => {
      const position = occupied.get(taskId)
      return (
        position?._tag === "ExactAttemptHeld" &&
        position.plannedAttempt.runId === scenario.runId &&
        position.plannedAttempt.attemptId === attemptId &&
        position.plannedAttempt.taskId === taskId &&
        plan(position.plannedAttempt)
      )
    })
  )
}

const isEFocusedRead = (
  operation: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"]
) => {
  if (operation._tag !== "ReadTaskClaim" && operation._tag !== "ReadTaskWorkSpecification") return false
  return operation.taskId === scenario.taskIds.E
}

const isForbiddenEWorkEvent = (event: JournalRecord["event"]) => {
  if (event._tag === "TaskAttemptPlanned") return event.operation.plannedAttempt.taskId === scenario.taskIds.E
  if (event._tag === "TaskWorktreeReconciliationIntended") {
    return event.operation.plannedAttempt.taskId === scenario.taskIds.E
  }
  if (event._tag === "TaskClaimAcquisitionIntended") return event.operation.acquisition.taskId === scenario.taskIds.E
  if (event._tag === "TaskClaimAcquired") return event.claim.taskId === scenario.taskIds.E
  if (event._tag === "TaskTrackerReadIntentRecorded") return isEFocusedRead(event.operation)
  if (event._tag === "GitReadIntentRecorded") return event.operation.plannedAttempt.taskId === scenario.taskIds.E
  return false
}

const hasNoPostDs12EWork = (records: ReadonlyArray<JournalRecord>, after: JournalRecord["position"]) =>
  !records.some((record) => isScenarioAfter(record, after) && isForbiddenEWorkEvent(record.event))

const hasNoPostChoicePostQuiescenceRead = (records: ReadonlyArray<JournalRecord>, after: JournalRecord["position"]) =>
  !records.some(
    ({ event, position, runId }) =>
      runId === scenario.runId &&
      position > after &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.cause._tag === "PostQuiescenceReconfirmation" &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(scenario.target)
  )

const hasNoPostDs12FreshMutation = (records: ReadonlyArray<JournalRecord>, after: JournalRecord["position"]) =>
  !records.some(
    ({ event, position, runId }) =>
      runId === scenario.runId &&
      position > after &&
      (event._tag === "TaskClaimAcquisitionIntended" ||
        event._tag === "TaskClaimAcquired" ||
        event._tag === "TaskAttemptPlanned" ||
        event._tag === "TaskWorktreeReconciliationIntended")
  )

const isExactContinuationAuthorization = (
  record: JournalRecord,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt,
  continuation: NonNullable<ReturnType<typeof exactContinuationHistory>>
) => {
  const { event } = record
  if (!isScenarioAfter(record, after) || event._tag !== "PlannedAttemptContinuationAuthorized") return false
  const witness = [
    event.witness.activeTaskContinuationRead.taskClaimObservationOperationId,
    event.witness.activeTaskContinuationRead.graphObservationOperationId,
    event.witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
    event.witness.targetLineageObservationOperationId,
    event.witness.worktreeObservationOperationId
  ]
  return [
    samePlannedTaskAttempt(event.plannedAttempt, plannedAttempt),
    new Set(witness).size === continuationWitnessCount,
    witness[0] === continuation.claim.operationId,
    witness[1] === continuation.graph.operationId,
    witness[2] === continuation.specification.operationId,
    witness[3] === continuation.lineage.operationId,
    witness[4] === continuation.worktree.operationId
  ].every(Boolean)
}

const exactAuthorization = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  plannedAttempt: PlannedTaskAttempt,
  continuation: NonNullable<ReturnType<typeof exactContinuationHistory>>
) => {
  const all = records.filter(
    ({ event, runId }) =>
      runId === scenario.runId &&
      event._tag === "PlannedAttemptContinuationAuthorized" &&
      event.plannedAttempt.taskId === scenario.taskIds.B
  )
  const exact = all.filter((record) => isExactContinuationAuthorization(record, after, plannedAttempt, continuation))
  const authorization = onlyItem(exact)
  return all.length === 1 && authorization?.event._tag === "PlannedAttemptContinuationAuthorized"
    ? authorization
    : undefined
}

const exactResumeIntent = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const all = records.filter(
    ({ event, runId }) =>
      runId === scenario.runId && event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
  )
  const exact = all.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      samePlannedTaskAttempt(event.plannedAttempt, plannedAttempt)
  )
  const intent = onlyItem(exact)
  if (all.length !== 1 || intent?.event._tag !== "PlannedAttemptExecutorCommandIntended") return undefined
  return { ...intent, event: intent.event }
}

const exactResumeResponse = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  intent: NonNullable<ReturnType<typeof exactResumeIntent>>
) => {
  const responses = records.filter(
    ({ event, runId }) =>
      runId === scenario.runId &&
      event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
      event.commandOrdinal === intent.event.ordinal &&
      samePlannedTaskAttempt(event.plannedAttempt, plannedAttempt)
  )
  const response = onlyItem(responses)
  if (response?.event._tag !== "PlannedAttemptExecutorCommandResponseObserved") return undefined
  const report = response.event.report
  return response.position > intent.position &&
    report._tag === "ExecutorWorkExecuting" &&
    report.correlation.runId === scenario.runId &&
    report.correlation.attemptId === scenario.attempts.B1
    ? { ...response, event: response.event }
    : undefined
}

const exactBExecutingReport = (
  records: ReadonlyArray<JournalRecord>,
  response: NonNullable<ReturnType<typeof exactResumeResponse>>
) => {
  const reports = records.filter(
    ({ event, position, runId }) =>
      runId === scenario.runId &&
      position > response.position &&
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.runId === scenario.runId &&
      event.report.correlation.attemptId === scenario.attempts.B1
  )
  const report = onlyItem(reports)
  return report?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    report.event.report._tag === "ExecutorWorkExecuting" &&
    Number(report.event.ordinal) === Number(response.event.commandOrdinal) &&
    samePlannedAttemptExecutorReport(report.event.report, response.event.report)
    ? { ...report, event: report.event }
    : undefined
}

const hasSingleContinueChoice = (records: ReadonlyArray<JournalRecord>) =>
  records.filter(
    ({ event, runId }) =>
      runId === scenario.runId &&
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "ContinueExistingAttempt" &&
      event.subject.plannedAttempt.taskId === scenario.taskIds.B
  ).length === 1

const hasSingleExactBPlan = (records: ReadonlyArray<JournalRecord>) => {
  const plans = records.filter(
    ({ event, runId }) =>
      runId === scenario.runId &&
      event._tag === "TaskAttemptPlanned" &&
      event.operation.plannedAttempt.taskId === scenario.taskIds.B
  )
  const plan = onlyItem(plans)
  return (
    plans.length === 1 &&
    plan?.event._tag === "TaskAttemptPlanned" &&
    isIssue268ExactB1Plan(plan.event.operation.plannedAttempt)
  )
}

const finalPublicationMatches = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  aTerminal: NonNullable<ReturnType<typeof exactA1TerminalHistory>>,
  bReport: NonNullable<ReturnType<typeof exactBExecutingReport>>
) => {
  const acceptedAt = publication.actionInputs.runtimeFacts.acceptedAt
  if (acceptedAt === null || publication.publication.graph._tag !== "GraphEstablished") return false
  return [
    acceptedAt >= bReport.position,
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G2.revision,
    publication.publication.policy.taskExecutionCapacity === scenario.policies.P2,
    publication.actionInputs.runtimeFacts.taskWork.capacity === scenario.policies.P2,
    hasExactFinalPositions(publication),
    exactA1PublicationEvidence(publication, aTerminal.aPlan, aTerminal.report.event.report),
    exactReadyBPublicationEvidence(publication, plannedAttempt, bReport.event.ordinal),
    exactRetainedC1PublicationEvidence(publication, records),
    publication.actionInputs.proposalContributions.ticketDelivery.every(
      ({ order }) => deliveryProposalOrderTaskId(order) !== scenario.taskIds.E
    )
  ].every(Boolean)
}

const isForbiddenDs13Command = (record: JournalRecord, after: JournalRecord["position"]) => {
  const { event } = record
  if (record.runId !== scenario.runId || record.position <= after) return false
  if (event._tag !== "PlannedAttemptExecutorCommandIntended") return false
  return event.command === "Begin" || event.command === "Suspend"
}

const hasNoForbiddenDs13Work = (
  records: ReadonlyArray<JournalRecord>,
  continuation: NonNullable<ReturnType<typeof exactContinuationHistory>>
) => {
  return [
    hasNoPostDs12EWork(records, continuation.choice.position),
    hasNoPostDs12FreshMutation(records, continuation.choice.position),
    hasNoPostChoicePostQuiescenceRead(records, continuation.choice.position),
    !records.some((record) => isForbiddenDs13Command(record, continuation.choice.position))
  ].every(Boolean)
}

const exactDs13PreResumeHistory = (records: ReadonlyArray<JournalRecord>) => {
  const bPlan = onlyItem(exactBPlanRecords(records))
  if (bPlan?.event._tag !== "TaskAttemptPlanned") return undefined
  const plannedAttempt = bPlan.event.operation.plannedAttempt
  const continuation = exactContinuationHistory(records, plannedAttempt)
  if (continuation === undefined) return undefined
  const aTerminal = exactA1TerminalHistory(records, continuation.lineage.outcome.position)
  if (aTerminal === undefined) return undefined
  const authorization = exactAuthorization(records, aTerminal.report.position, plannedAttempt, continuation)
  if (authorization === undefined) return undefined
  return { aTerminal, authorization, continuation, plannedAttempt }
}

const exactDs13ResumeHistory = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  authorization: NonNullable<ReturnType<typeof exactAuthorization>>
) => {
  const resumeIntent = exactResumeIntent(records, plannedAttempt)
  if (resumeIntent === undefined || resumeIntent.position <= authorization.position) return undefined
  const resumeResponse = exactResumeResponse(records, plannedAttempt, resumeIntent)
  if (resumeResponse === undefined) return undefined
  const bReport = exactBExecutingReport(records, resumeResponse)
  if (bReport === undefined) return undefined
  return { bReport, resumeIntent, resumeResponse }
}

/** DS-13 completes after A1 accepts, releases its position, and the original B1 resumes ahead of fresh E. */
export const isIssue268Ds13CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const preResume = exactDs13PreResumeHistory(records)
  if (preResume === undefined) return false
  const { aTerminal, authorization, continuation, plannedAttempt } = preResume
  const resumed = exactDs13ResumeHistory(records, plannedAttempt, authorization)
  if (resumed === undefined) return false
  const { bReport, resumeResponse } = resumed
  return [
    finalPublicationMatches(publication, records, plannedAttempt, aTerminal, bReport),
    hasSingleContinueChoice(records),
    hasSingleExactBPlan(records),
    continuation.choice.position < continuation.graph.intent.position,
    continuation.lineage.outcome.position < aTerminal.state.position,
    aTerminal.state.position < aTerminal.report.position,
    bReport.position > resumeResponse.position,
    hasNoForbiddenDs13Work(records, continuation)
  ].every(Boolean)
}
