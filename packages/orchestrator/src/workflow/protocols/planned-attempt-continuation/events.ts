import { Schema } from "effect"
import { PlannedTaskAttempt } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

const activeTaskContinuationObservationCount = 3
const continuationWitnessObservationCount = 5

/**
 * The ordinary current-fact reads that witness one continuation. Keeping the
 * operation identities here makes the durable authorization auditable without
 * inventing a recovery-specific read or executor identity.
 */
export const ActiveTaskContinuationRead = Schema.Struct({
  graphObservationOperationId: OperationId,
  taskClaimObservationOperationId: OperationId,
  taskWorkSpecificationObservationOperationId: OperationId
}).check(
  Schema.makeFilter((read) =>
    new Set([
      read.graphObservationOperationId,
      read.taskClaimObservationOperationId,
      read.taskWorkSpecificationObservationOperationId
    ]).size === activeTaskContinuationObservationCount
      ? undefined
      : "an active-task continuation read must name three distinct observations"
  )
)
export type ActiveTaskContinuationRead = typeof ActiveTaskContinuationRead.Type

/** Exact witnesses required before continuing one existing executor responsibility. */
export const PlannedAttemptContinuationWitness = Schema.Struct({
  activeTaskContinuationRead: ActiveTaskContinuationRead,
  targetLineageObservationOperationId: OperationId,
  worktreeObservationOperationId: OperationId
}).check(
  Schema.makeFilter((witness) =>
    new Set([
      witness.activeTaskContinuationRead.graphObservationOperationId,
      witness.activeTaskContinuationRead.taskClaimObservationOperationId,
      witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
      witness.targetLineageObservationOperationId,
      witness.worktreeObservationOperationId
    ]).size === continuationWitnessObservationCount
      ? undefined
      : "a continuation authorization must name five distinct observations"
  )
)
export type PlannedAttemptContinuationWitness = typeof PlannedAttemptContinuationWitness.Type

/**
 * Dalph durably authorized continuation of an existing executor responsibility
 * after current tracker and Git observations. This is a generic workflow fact;
 * it is deliberately not named after recovery or coordinator process death.
 */
export const PlannedAttemptContinuationAuthorizedEvent = Schema.TaggedStruct("PlannedAttemptContinuationAuthorized", {
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type PlannedAttemptContinuationAuthorizedEvent = typeof PlannedAttemptContinuationAuthorizedEvent.Type
