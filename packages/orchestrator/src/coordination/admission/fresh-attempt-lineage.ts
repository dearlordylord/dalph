import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import { Option } from "effect"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { causalPredecessorOperationIds } from "../../workflow/causal-history.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { reconstructedTaskGraphFor } from "../reconstruction/graph-knowledge.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"

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
  records: ReadonlyArray<JournalRecord>,
  claimOutcome: JournalRecord,
  claim: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
): ClaimIntentRecord | undefined => {
  const intents = records.filter(
    (record): record is ClaimIntentRecord =>
      record.event._tag === "TaskClaimAcquisitionIntended" && isExactClaimIntent(record, claimOutcome, claim)
  )
  return exactlyOne(intents)
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

const specificationReadMatches = (
  record: JournalRecord,
  outcome: JournalRecord,
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  record.position < outcome.position &&
  record.key === intentRecordKey(operationId) &&
  record.event._tag === "TaskTrackerReadIntentRecorded" &&
  record.event.operation._tag === "ReadTaskWorkSpecification" &&
  record.event.operation.operationId === operationId &&
  record.event.operation.taskId === plannedAttempt.taskId &&
  outcome.event._tag === "TaskTrackerFactsObserved" &&
  taskTrackerObservationMatchesRead(outcome.event.observation, record.event.operation)

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
  records: ReadonlyArray<JournalRecord>,
  outcome: JournalRecord,
  taskId: PlannedTaskAttempt["taskId"]
): boolean => {
  if (outcome.event._tag !== "TaskTrackerFactsObserved") return false
  const reconstructed = reconstructedTaskGraphFor(
    {
      taskTrackerFacts: records.flatMap((record) =>
        record.position <= outcome.position && record.event._tag === "TaskTrackerFactsObserved"
          ? [record.event.observation]
          : []
      )
    },
    outcome.event.observation.target
  )
  return Option.isSome(reconstructed) && reconstructed.value.eligibleTasks().some(({ id }) => id === taskId)
}

const acceptedPlanPredecessorLineage = (
  records: ReadonlyArray<JournalRecord>,
  planOperation: TaskAttemptPlanOperation
): AcceptedFreshAttemptLineageFields | undefined => {
  const plannedAttempt = planOperation.plannedAttempt
  const recordsBeforePlan = records.filter((record) => record.runId === plannedAttempt.runId)
  const planPredecessors = causalPredecessorOperationIds(recordsBeforePlan, planOperation)
  const claimOutcome = exactlyOne(
    recordsBeforePlan.filter(
      (record) =>
        record.event._tag === "TaskClaimAcquired" &&
        record.key === outcomeRecordKey(record.event.claim.operationId) &&
        record.event.claim.taskId === plannedAttempt.taskId &&
        planPredecessors.has(record.event.claim.operationId)
    )
  )
  if (claimOutcome?.event._tag !== "TaskClaimAcquired") return undefined
  const claim = claimOutcome.event.claim

  const claimIntent = acceptedClaimIntent(recordsBeforePlan, claimOutcome, claim)
  if (claimIntent === undefined) return undefined

  const specification = exactlyOne(
    recordsBeforePlan.flatMap((outcome) => {
      if (!isSpecificationOutcomeForPlan(outcome, plannedAttempt, planPredecessors)) {
        return []
      }
      const operationId = outcome.event.operationId
      const intent = exactlyOne(
        recordsBeforePlan.filter((candidate) =>
          specificationReadMatches(candidate, outcome, operationId, plannedAttempt)
        )
      )
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
  const specificationPredecessors = causalPredecessorOperationIds(recordsBeforePlan, specificationOperation)
  const postClaimGraph = exactlyOne(
    recordsBeforePlan.flatMap((outcome) => {
      if (!isCompleteGraphOutcomeBefore(outcome, specification.intent.position, specificationPredecessors)) {
        return []
      }
      const observation = outcome.event.observation
      const operationId = outcome.event.operationId
      const intent = exactlyOne(
        recordsBeforePlan.filter(
          (candidate) =>
            graphReadChronologyMatches(candidate, claimOutcome, outcome, claim.operationId) &&
            graphReadScopeMatches(candidate, operationId, plannedAttempt) &&
            candidate.event._tag === "TaskTrackerReadIntentRecorded" &&
            candidate.event.operation._tag === "ReadTrackerGraph" &&
            taskTrackerObservationMatchesRead(observation, candidate.event.operation)
        )
      )
      if (
        intent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
        intent.event.operation._tag !== "ReadTrackerGraph"
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
  records: ReadonlyArray<JournalRecord>,
  operation: TaskAttemptPlanOperation
): boolean => acceptedPlanPredecessorLineage(records, operation) !== undefined

/**
 * Projects one accepted fresh attempt only when every required authority stage
 * exists in exact chronological and causal order through the requested boundary.
 */
export const acceptedFreshAttemptLineage = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  boundary: FreshAttemptLineageBoundary
): AcceptedFreshAttemptLineage | undefined => {
  const planRecord = exactlyOne(
    records.filter(
      (record) =>
        record.runId === plannedAttempt.runId &&
        record.key === attemptPlanRecordKey(plannedAttempt.attemptId) &&
        record.event._tag === "TaskAttemptPlanned" &&
        plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, plannedAttempt)
    )
  )
  if (planRecord?.event._tag !== "TaskAttemptPlanned") return undefined
  const recordsThroughPlan = records.filter(
    (record) => record.runId === plannedAttempt.runId && record.position <= planRecord.position
  )
  const plan = acceptedPlanPredecessorLineage(recordsThroughPlan, planRecord.event.operation)
  if (plan === undefined) return undefined
  if (boundary === "Plan") return { _tag: "AcceptedFreshAttemptPlanLineage", ...plan }

  const worktree = exactlyOne(
    records.flatMap((outcome) => {
      if (
        outcome.runId !== plannedAttempt.runId ||
        outcome.event._tag !== "TaskWorktreeReady" ||
        outcome.key !== outcomeRecordKey(outcome.event.operationId) ||
        !plannedAttemptWorktreeObservationMatchesPlan(outcome.event.proof, plannedAttempt)
      ) {
        return []
      }
      const operationId = outcome.event.operationId
      const intent = exactlyOne(
        records.filter(
          (candidate) =>
            candidate.runId === plannedAttempt.runId &&
            candidate.position < outcome.position &&
            candidate.key === intentRecordKey(operationId) &&
            candidate.event._tag === "TaskWorktreeReconciliationIntended" &&
            candidate.event.operation.operationId === operationId &&
            plannedTaskAttemptEquivalence(candidate.event.operation.plannedAttempt, plannedAttempt) &&
            causalPredecessorOperationIds(records, candidate.event.operation).has(plan.planOperationId)
        )
      )
      if (intent?.event._tag !== "TaskWorktreeReconciliationIntended") return []
      return [{ intent, operation: intent.event.operation, outcome }]
    })
  )
  return worktree === undefined
    ? undefined
    : { _tag: "AcceptedFreshAttemptWorktreeLineage", ...plan, worktreeOperationId: worktree.operation.operationId }
}
