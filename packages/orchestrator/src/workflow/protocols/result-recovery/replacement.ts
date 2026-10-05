import type { JournalRecord, JournalAppendError } from "../../../workflow-journal/store.js"
import { ResultRecoveryAttemptReplacedEvent } from "./replacement-events.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import type { PlannedAttemptProtocolPermit } from "../planned-attempt-executor-work/protocol-controller.js"
import { ResultRecoveryNotAvailable, ResultRecoveryRequestIdentityContradiction } from "./control.js"
import {
  plannedAttemptExecutorCorrelation,
  samePlannedAttemptExecutorCorrelation,
  plannedTaskAttemptEquivalence,
  type PlannedTaskAttempt,
  type IntegrationTarget,
  PlannedAttemptExecutor,
  TaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Schema, Context, Option } from "effect"
import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import {
  journalRecordByKey,
  journalRecordsForAttempt,
  journalRecordsForTask
} from "../../../workflow-journal/record-evidence.js"
import {
  resultRecoveryAttemptReplacedRecordKey,
  resultRecoveryDirectedRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { recordedTaskAttemptPlanFor } from "../task-attempt-planning/journal-evidence.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import type { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import type { ResultRecoveryRequestId } from "./events.js"
import {
  OperationIdAllocator,
  PlannedTaskAttemptPlanner,
  PlannedTaskAttemptOrdinal,
  PlannedTaskAttemptPlanRequest
} from "../task-attempt-planning/plan.js"
import { makeTaskAttemptPlanOperation } from "../../registry/operation.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { ResultRecoverySubject } from "./events.js"
import { evaluateResultRecoveryRestartFacts } from "./restart-authorization.js"

export { ResultRecoveryAttemptReplacedEvent } from "./replacement-events.js"

/** Uses only the accepted prefix before replacement; fresh facts and stopped custody are mandatory. */
export const resultRecoveryReplacementProblem = (
  records: JournalHistorySource,
  event: ResultRecoveryAttemptReplacedEvent
): string | undefined => {
  const direction = journalRecordByKey(records, resultRecoveryDirectedRecordKey(event.requestId))
  if (
    direction?.event._tag !== "ResultRecoveryDirected" ||
    !Schema.toEquivalence(ResultRecoverySubject)(direction.event.subject, event.subject)
  )
    return "result replacement requires its exact applied direction and selected report"
  const facts = evaluateResultRecoveryRestartFacts(records, event.requestId, event.witness, event.integrationTarget)
  if (facts._tag !== "FreshRestartFactsVerified") return facts.detail
  if (facts.custody !== "AcceptedStoppedRejection" && event.writerCustody === undefined)
    return "historical failure requires separately reconciled executor writer custody before replacement"
  const prior = event.subject.plannedAttempt
  const plan = recordedTaskAttemptPlanFor(records, prior)
  const claim = authorizedClaimForAttempt(records, prior)
  if (
    plan === undefined ||
    claim === undefined ||
    !event.successorPlan.predecessorOperationIds.includes(plan.operationId) ||
    !event.successorPlan.predecessorOperationIds.includes(claim.claim.operationId)
  )
    return "result replacement must retain exact predecessor plan and claim authority"
  const successor = event.successorPlan.plannedAttempt
  if (successor.taskRevision !== facts.taskRevision || successor.baseSha !== facts.baseSha)
    return "result replacement successor must bind fresh tracker revision and Git Base"
  for (const { event: priorEvent } of journalRecordsForAttempt(records, prior.attemptId)) {
    if (
      priorEvent._tag === "PlannedAttemptReplaced" &&
      plannedTaskAttemptEquivalence(priorEvent.subject.plannedAttempt, prior)
    )
      return "the retained result already has a successor"
  }
  return undefined
}

export type ResultRecoveryReplacementRecord = Omit<JournalRecord, "event"> & {
  readonly event: ResultRecoveryAttemptReplacedEvent
}

/** Durable exact replacement acknowledgement precedes all successor worktree or provider effects. */
export const recordResultRecoveryReplacementWithPermit: (
  permit: PlannedAttemptProtocolPermit,
  input: unknown
) => Effect.Effect<
  ResultRecoveryReplacementRecord,
  Schema.SchemaError | JournalAppendError | ResultRecoveryNotAvailable | ResultRecoveryRequestIdentityContradiction,
  AcceptedJournalReader | InRunJournal
> = Effect.fn("ResultRecovery.recordReplacement")(function* (permit: PlannedAttemptProtocolPermit, input: unknown) {
  const event = yield* Schema.decodeUnknownEffect(ResultRecoveryAttemptReplacedEvent, { onExcessProperty: "error" })(
    input
  )
  if (
    !samePlannedAttemptExecutorCorrelation(
      permit.correlation,
      plannedAttemptExecutorCorrelation(event.subject.plannedAttempt)
    )
  )
    return yield* new ResultRecoveryNotAvailable({
      requestId: event.requestId,
      detail: "replacement requires its exact predecessor protocol permit"
    })
  const accepted = yield* AcceptedJournalReader
  const journal = yield* InRunJournal
  return yield* permit.recordFact(
    Effect.gen(function* () {
      const records = yield* accepted.readAccepted(event.requestId.runId)
      const key = resultRecoveryAttemptReplacedRecordKey(event.subject.plannedAttempt.attemptId)
      const existing = journalRecordByKey(records, key)
      if (existing !== undefined) {
        if (
          existing.event._tag !== "ResultRecoveryAttemptReplaced" ||
          !Schema.toEquivalence(ResultRecoveryAttemptReplacedEvent)(existing.event, event)
        )
          return yield* new ResultRecoveryRequestIdentityContradiction({
            requestId: event.requestId,
            existingPosition: existing.position
          })
        return { ...existing, event: existing.event }
      }
      const problem = resultRecoveryReplacementProblem(records, event)
      if (problem !== undefined)
        return yield* new ResultRecoveryNotAvailable({ requestId: event.requestId, detail: problem })
      const recorded = yield* journal.append(event.requestId.runId, key, event)
      return {
        ...recorded,
        event: yield* Schema.decodeUnknownEffect(ResultRecoveryAttemptReplacedEvent)(recorded.event)
      }
    })
  )
})

/** Reconcile the durable successor before allocating identities; no worktree or provider effect occurs here. */
export const allocateResultRecoveryReplacementWithPermit = Effect.fn("ResultRecovery.allocateReplacement")(function* (
  permit: PlannedAttemptProtocolPermit,
  requestId: ResultRecoveryRequestId,
  witness: PlannedAttemptContinuationWitness,
  integrationTarget: IntegrationTarget,
  specification: TaskWorkSpecification,
  expectedPlannedAttempt?: PlannedTaskAttempt
) {
  const accepted = yield* AcceptedJournalReader
  const records = yield* accepted.readAccepted(requestId.runId)
  const direction = journalRecordByKey(records, resultRecoveryDirectedRecordKey(requestId))
  if (direction?.event._tag !== "ResultRecoveryDirected")
    return yield* new ResultRecoveryNotAvailable({ requestId, detail: "replacement requires its recorded direction" })
  const prior = direction.event.subject.plannedAttempt
  if (expectedPlannedAttempt !== undefined && !plannedTaskAttemptEquivalence(expectedPlannedAttempt, prior))
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "replacement delivery must name the exact retained plan"
    })
  if (!samePlannedAttemptExecutorCorrelation(permit.correlation, plannedAttemptExecutorCorrelation(prior)))
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "replacement allocation requires the exact predecessor permit"
    })
  const existing = journalRecordByKey(records, resultRecoveryAttemptReplacedRecordKey(prior.attemptId))
  if (existing !== undefined) {
    if (
      existing.event._tag !== "ResultRecoveryAttemptReplaced" ||
      existing.event.requestId.nonce !== requestId.nonce ||
      existing.event.requestId.runId !== requestId.runId
    )
      return yield* new ResultRecoveryRequestIdentityContradiction({ requestId, existingPosition: existing.position })
    return { ...existing, event: existing.event }
  }
  const facts = evaluateResultRecoveryRestartFacts(records, requestId, witness, integrationTarget)
  if (facts._tag !== "FreshRestartFactsVerified")
    return yield* new ResultRecoveryNotAvailable({ requestId, detail: facts.detail })
  const observed = journalRecordByKey(
    records,
    outcomeRecordKey(witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId)
  )
  if (
    observed?.event._tag !== "TaskTrackerFactsObserved" ||
    observed.event.observation._tag !== "FocusedTaskWorkSpecificationFacts" ||
    !Schema.toEquivalence(TaskWorkSpecification)(observed.event.observation.factFamily, specification)
  )
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "allocation requires exact fresh specification and proved stopped writers"
    })
  const plan = recordedTaskAttemptPlanFor(records, prior)
  const claim = authorizedClaimForAttempt(records, prior)
  if (plan === undefined || claim === undefined)
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "allocation requires predecessor plan and claim authority"
    })
  let count = 0
  for (const { event } of journalRecordsForTask(records, prior.taskId)) {
    if (
      event._tag === "TaskAttemptPlanned" ||
      event._tag === "PlannedAttemptReplaced" ||
      event._tag === "ResultRecoveryAttemptReplaced"
    )
      count += 1
  }
  let writerCustody: ResultRecoveryAttemptReplacedEvent["writerCustody"]
  if (facts.custody === "RequiresExecutorReconciliation") {
    const executor = Context.getOption(yield* Effect.context<never>(), PlannedAttemptExecutor)
    if (Option.isNone(executor) || executor.value.observeWriterCustody === undefined)
      return yield* new ResultRecoveryNotAvailable({
        requestId,
        detail: "executor cannot prove historical writer custody"
      })
    const observedCustody = yield* executor.value.observeWriterCustody(prior)
    if (observedCustody._tag !== "Stopped" || !plannedTaskAttemptEquivalence(observedCustody.plannedAttempt, prior))
      return yield* new ResultRecoveryNotAvailable({
        requestId,
        detail: "historical executor writers remain unresolved"
      })
    writerCustody = observedCustody
  }
  const planner = yield* PlannedTaskAttemptPlanner
  const allocator = yield* OperationIdAllocator
  const successor = yield* planner.plan(
    PlannedTaskAttemptPlanRequest.ExactReplacement({
      baseSha: facts.baseSha,
      ordinal: PlannedTaskAttemptOrdinal.make(count),
      specification
    })
  )
  return yield* recordResultRecoveryReplacementWithPermit(
    permit,
    ResultRecoveryAttemptReplacedEvent.make({
      requestId,
      subject: direction.event.subject,
      ...(writerCustody === undefined ? {} : { writerCustody }),
      integrationTarget,
      witness,
      successorPlan: makeTaskAttemptPlanOperation({
        operationId: yield* allocator.allocate(),
        plannedAttempt: successor,
        predecessorOperationIds: [
          plan.operationId,
          claim.claim.operationId,
          witness.activeTaskContinuationRead.graphObservationOperationId,
          witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
          witness.activeTaskContinuationRead.taskClaimObservationOperationId,
          witness.worktreeObservationOperationId,
          witness.targetLineageObservationOperationId
        ]
      }),
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
})
