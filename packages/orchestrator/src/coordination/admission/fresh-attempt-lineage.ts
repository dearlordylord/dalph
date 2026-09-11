import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import { Option } from "effect"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { isDependencySatisfied, isTaskOpen } from "../../authorities/task-tracker/task.js"
import {
  causalPredecessorOperationIds,
  causalPredecessorOperationIdsFromEvidence
} from "../../workflow/causal-history.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { reconstructedTaskGraphFor } from "../reconstruction/graph-knowledge.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalGraphSnapshotForObservation,
  journalRecordByKey,
  journalRecordsForAttemptKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"

/** The latest fresh-workflow boundary whose exact accepted causal lineage must be present. */
type FreshAttemptLineageBoundary = "Plan" | "WorktreeReady"

/**
 * Exact accepted authority chain for one immutable fresh attempt.
 *
 * These operation identities are evidence projected from Journal history, not
 * a second persisted workflow state or a substitute for tracker/Git authority.
 */
interface AcceptedFreshAttemptLineageFields {
  readonly claimOperationId: OperationId
  readonly planOperationId: OperationId
  readonly postClaimGraphOperationId: OperationId
  readonly specificationOperationId: OperationId
}

/** Exact accepted authority chain through the immutable plan, before worktree readiness. */
interface AcceptedFreshAttemptPlanLineage extends AcceptedFreshAttemptLineageFields {
  readonly _tag: "AcceptedFreshAttemptPlanLineage"
}

/** Exact accepted authority chain extended through one ready worktree observation. */
interface AcceptedFreshAttemptWorktreeLineage extends AcceptedFreshAttemptLineageFields {
  readonly _tag: "AcceptedFreshAttemptWorktreeLineage"
  readonly worktreeOperationId: OperationId
}

type AcceptedFreshAttemptLineage = AcceptedFreshAttemptPlanLineage | AcceptedFreshAttemptWorktreeLineage

type TaskAttemptPlanOperation = Extract<WorkflowOperation, { readonly _tag: "RecordTaskAttemptPlan" }>
type FactsObservedEvent = Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
type FactsObservedRecord = JournalRecord & { readonly event: FactsObservedEvent }
type SpecificationOutcomeRecord = JournalRecord & {
  readonly event: FactsObservedEvent & {
    readonly observation: Extract<
      FactsObservedEvent["observation"],
      { readonly _tag: "FocusedTaskWorkSpecificationFacts" }
    >
  }
}

const exactlyOne = <A>(values: ReadonlyArray<A>): A | undefined => (values.length === 1 ? values[0] : undefined)

const causalPredecessors = (records: JournalHistorySource, operation: WorkflowOperation): ReadonlySet<OperationId> =>
  isJournalRecordEvidence(records)
    ? causalPredecessorOperationIdsFromEvidence(records, operation)
    : causalPredecessorOperationIds(records, operation)

const evidenceThrough = (records: JournalHistorySource, position: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, position + 1)
    : records.filter((record) => record.position <= position)

const recordsForRun = (records: JournalHistorySource, runId: PlannedTaskAttempt["runId"]): JournalHistorySource =>
  isJournalRecordEvidence(records) ? records : records.filter((record) => record.runId === runId)

const claimAcquisitionMatches = (
  intent: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquisitionIntended" }>,
  claim: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
): boolean =>
  intent.operation.authority._tag === "TaskSelectionAuthority" &&
  intent.operation.acquisition.operationId === claim.operationId &&
  intent.operation.acquisition.owner === claim.owner &&
  intent.operation.acquisition.taskId === claim.taskId &&
  intent.operation.acquisition.token === claim.token

const isExactClaimIntent = (
  record: JournalRecord,
  claimOutcome: JournalRecord,
  claim: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
): boolean =>
  record.position < claimOutcome.position &&
  record.key === intentRecordKey(claim.operationId) &&
  record.event._tag === "TaskClaimAcquisitionIntended" &&
  claimAcquisitionMatches(record.event, claim)

type ClaimIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquisitionIntended" }>
}

const acceptedClaimIntent = (
  records: JournalHistorySource,
  claimOutcome: JournalRecord,
  claim: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
): ClaimIntentRecord | undefined => {
  const intent = journalRecordByKey(records, intentRecordKey(claim.operationId))
  return intent?.event._tag === "TaskClaimAcquisitionIntended" && isExactClaimIntent(intent, claimOutcome, claim)
    ? { ...intent, event: intent.event }
    : undefined
}

const isSpecificationOutcomeForPlan = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt,
  planPredecessors: ReadonlySet<OperationId>
): record is SpecificationOutcomeRecord => {
  const event = record.event
  return (
    event._tag === "TaskTrackerFactsObserved" &&
    event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
    record.key === outcomeRecordKey(event.operationId) &&
    planPredecessors.has(event.operationId) &&
    event.observation.factFamily.taskId === plannedAttempt.taskId &&
    event.observation.factFamily.fingerprint === plannedAttempt.taskRevision
  )
}

const isCompleteGraphOutcomeBefore = (
  record: JournalRecord,
  before: JournalPosition,
  specificationPredecessors: ReadonlySet<OperationId>
): record is FactsObservedRecord => {
  const event = record.event
  if (record.position >= before || event._tag !== "TaskTrackerFactsObserved") return false
  const complete =
    event.observation._tag === "CompleteTaskTrackerFacts" ||
    event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
  return (
    complete && record.key === outcomeRecordKey(event.operationId) && specificationPredecessors.has(event.operationId)
  )
}

const graphReadScopeMatches = (
  record: JournalRecord,
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  record.event._tag === "TaskTrackerReadIntentRecorded" &&
  record.event.operation._tag === "ReadTrackerGraph" &&
  record.event.operation.operationId === operationId &&
  record.event.operation.cause._tag === "WorkflowEstablishment" &&
  record.event.operation.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId)

const graphReadChronologyMatches = (
  record: JournalRecord,
  claimOutcome: JournalRecord,
  outcome: JournalRecord,
  claimOperationId: OperationId
): boolean =>
  record.position > claimOutcome.position &&
  record.position < outcome.position &&
  record.event._tag === "TaskTrackerReadIntentRecorded" &&
  record.event.operation._tag === "ReadTrackerGraph" &&
  record.key === intentRecordKey(record.event.operation.operationId) &&
  record.event.operation.predecessorOperationIds.includes(claimOperationId)

const taskWasEligibleAt = (
  records: JournalHistorySource,
  outcome: JournalRecord,
  taskId: PlannedTaskAttempt["taskId"]
): boolean => {
  if (outcome.event._tag !== "TaskTrackerFactsObserved") return false
  const observation = outcome.event.observation
  if (observation._tag !== "CompleteTaskTrackerFacts" && observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") {
    return false
  }
  if (isJournalRecordEvidence(records)) {
    const graph = journalGraphSnapshotForObservation(records, outcome.position)
    if (Option.isNone(graph)) return false
    const lifecycle = graph.value.lifecycleOf(taskId)
    return (
      Option.isSome(lifecycle) &&
      isTaskOpen(lifecycle.value) &&
      graph.value.prerequisitesOf(taskId).every((prerequisiteId) => {
        const prerequisite = graph.value.lifecycleOf(prerequisiteId)
        return Option.isSome(prerequisite) && isDependencySatisfied(prerequisite.value)
      })
    )
  }
  const priorFull =
    observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      ? journalRecordByKey(records, outcomeRecordKey(observation.priorFullObservationOperationId))
      : undefined
  const taskTrackerFacts = [
    ...(priorFull?.event._tag === "TaskTrackerFactsObserved" &&
    priorFull.event.observation._tag === "CompleteTaskTrackerFacts"
      ? [priorFull.event.observation]
      : []),
    observation
  ]
  const reconstructed = reconstructedTaskGraphFor({ taskTrackerFacts }, observation.target)
  return Option.isSome(reconstructed) && reconstructed.value.eligibleTasks().some(({ id }) => id === taskId)
}

const acceptedPlanPredecessorLineage = (
  records: JournalHistorySource,
  planOperation: TaskAttemptPlanOperation
): AcceptedFreshAttemptLineageFields | undefined => {
  const plannedAttempt = planOperation.plannedAttempt
  const recordsBeforePlan = records
  const planPredecessors = causalPredecessors(recordsBeforePlan, planOperation)
  const claimOutcome = exactlyOne(
    Array.from(planPredecessors).flatMap((operationId) => {
      const record = journalRecordByKey(recordsBeforePlan, outcomeRecordKey(operationId))
      return record?.event._tag === "TaskClaimAcquired" && record.event.claim.taskId === plannedAttempt.taskId
        ? [record]
        : []
    })
  )
  if (claimOutcome?.event._tag !== "TaskClaimAcquired") return undefined
  const claim = claimOutcome.event.claim

  const claimIntent = acceptedClaimIntent(recordsBeforePlan, claimOutcome, claim)
  if (claimIntent === undefined) return undefined

  const specification = exactlyOne(
    Array.from(planPredecessors).flatMap((operationId) => {
      const outcome = journalRecordByKey(recordsBeforePlan, outcomeRecordKey(operationId))
      if (outcome === undefined) return []
      if (!isSpecificationOutcomeForPlan(outcome, plannedAttempt, planPredecessors)) {
        return []
      }
      const intent = journalRecordByKey(recordsBeforePlan, intentRecordKey(operationId))
      if (
        intent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
        intent.event.operation._tag !== "ReadTaskWorkSpecification"
      ) {
        return []
      }
      return [{ intent, operation: intent.event.operation, outcome }]
    })
  )
  if (specification === undefined) return undefined

  const specificationOperation = specification.operation
  const specificationPredecessors = causalPredecessors(recordsBeforePlan, specificationOperation)
  const postClaimGraph = exactlyOne(
    Array.from(specificationPredecessors).flatMap((operationId) => {
      const outcome = journalRecordByKey(recordsBeforePlan, outcomeRecordKey(operationId))
      if (outcome === undefined) return []
      if (!isCompleteGraphOutcomeBefore(outcome, specification.intent.position, specificationPredecessors)) {
        return []
      }
      const observation = outcome.event.observation
      const intent = journalRecordByKey(recordsBeforePlan, intentRecordKey(operationId))
      if (
        intent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
        intent.event.operation._tag !== "ReadTrackerGraph" ||
        !graphReadChronologyMatches(intent, claimOutcome, outcome, claim.operationId) ||
        !graphReadScopeMatches(intent, operationId, plannedAttempt) ||
        !taskTrackerObservationMatchesRead(observation, intent.event.operation)
      ) {
        return []
      }
      return taskWasEligibleAt(recordsBeforePlan, outcome, plannedAttempt.taskId)
        ? [{ intent, operation: intent.event.operation, outcome }]
        : []
    })
  )
  if (
    postClaimGraph === undefined ||
    taskTrackerTargetKey(postClaimGraph.operation.target) !== taskTrackerTargetKey(specificationOperation.target)
  ) {
    return undefined
  }

  return {
    claimOperationId: claim.operationId,
    planOperationId: planOperation.operationId,
    postClaimGraphOperationId: postClaimGraph.operation.operationId,
    specificationOperationId: specificationOperation.operationId
  }
}

/** Whether an unrecorded fresh plan operation has every exact accepted predecessor required before append. */
export const freshAttemptPlanPredecessorLineageWasAccepted = (
  records: JournalHistorySource,
  operation: TaskAttemptPlanOperation
): boolean => acceptedPlanPredecessorLineage(records, operation) !== undefined

/**
 * Projects one accepted fresh attempt only when every required authority stage
 * exists in exact chronological and causal order through the requested boundary.
 */
export const acceptedFreshAttemptLineage = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  boundary: FreshAttemptLineageBoundary
): AcceptedFreshAttemptLineage | undefined => {
  const runRecords = recordsForRun(records, plannedAttempt.runId)
  const planRecord = journalRecordByKey(runRecords, attemptPlanRecordKey(plannedAttempt.attemptId))
  if (planRecord?.event._tag !== "TaskAttemptPlanned") return undefined
  if (
    planRecord.runId !== plannedAttempt.runId ||
    !plannedTaskAttemptEquivalence(planRecord.event.operation.plannedAttempt, plannedAttempt)
  ) {
    return undefined
  }
  const recordsThroughPlan = evidenceThrough(runRecords, planRecord.position)
  const plan = acceptedPlanPredecessorLineage(recordsThroughPlan, planRecord.event.operation)
  if (plan === undefined) return undefined
  if (boundary === "Plan") return { _tag: "AcceptedFreshAttemptPlanLineage", ...plan }

  let worktree:
    | {
        readonly intent: JournalRecord
        readonly operation: Extract<WorkflowOperation, { readonly _tag: "ReconcileTaskWorktree" }>
        readonly outcome: JournalRecord
      }
    | undefined
  let worktreeCount = 0
  for (const intent of journalRecordsForAttemptKind(
    runRecords,
    plannedAttempt.attemptId,
    "TaskWorktreeReconciliationIntended"
  )) {
    if (
      intent.event._tag !== "TaskWorktreeReconciliationIntended" ||
      !plannedTaskAttemptEquivalence(intent.event.operation.plannedAttempt, plannedAttempt)
    ) {
      continue
    }
    const operationId = intent.event.operation.operationId
    const outcome = journalRecordByKey(runRecords, outcomeRecordKey(operationId))
    if (
      outcome?.event._tag !== "TaskWorktreeReady" ||
      outcome.runId !== plannedAttempt.runId ||
      intent.position >= outcome.position ||
      outcome.event.operationId !== operationId ||
      !plannedAttemptWorktreeObservationMatchesPlan(outcome.event.proof, plannedAttempt) ||
      !causalPredecessors(runRecords, intent.event.operation).has(plan.planOperationId)
    ) {
      continue
    }
    worktreeCount += 1
    worktree ??= { intent, operation: intent.event.operation, outcome }
  }
  return worktreeCount !== 1 || worktree === undefined
    ? undefined
    : { _tag: "AcceptedFreshAttemptWorktreeLineage", ...plan, worktreeOperationId: worktree.operation.operationId }
}
