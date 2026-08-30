import { plannedAttemptExecutorCorrelation, PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { PlannedAttemptContinuationAuthorizedEvent, type PlannedAttemptContinuationWitness } from "./events.js"
import { plannedAttemptContinuationAuthorizedRecordKey } from "../../../workflow-journal/record-key.js"
import { evaluatePlannedAttemptContinuationAuthorization } from "./authorization-evaluation.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit,
  withPlannedAttemptProtocolPermit
} from "../planned-attempt-executor-work/protocol-controller.js"

export { evaluatePlannedAttemptContinuationAuthorization } from "./authorization-evaluation.js"

/** The exact current-fact family named by a failed continuation authorization. */
export const ContinuationAuthorizationWitness = Schema.Literals([
  "AcceptedSafeExecutorReport",
  "ActiveTaskContinuationGraph",
  "ActiveTaskContinuationSpecification",
  "ActiveTaskContinuationClaim",
  "PlannedAttemptWorktree",
  "PlannedAttemptTargetLineage"
])
export type ContinuationAuthorizationWitness = typeof ContinuationAuthorizationWitness.Type
export type ContinuationAuthorizationReason = "MissingWitness" | "StaleWitness" | "LaterWitness" | "WrongAttemptWitness"

/**
 * A continuation may contact the executor only after all named observations
 * are present, current, and correlated to the retained responsibility.
 */
export class PlannedAttemptContinuationAuthorizationRejected extends Schema.TaggedError<PlannedAttemptContinuationAuthorizationRejected>()(
  "PlannedAttemptContinuationAuthorizationRejected",
  {
    detail: Schema.String,
    plannedAttempt: PlannedTaskAttempt,
    reason: Schema.Literals(["MissingWitness", "StaleWitness", "LaterWitness", "WrongAttemptWitness"]),
    witness: ContinuationAuthorizationWitness
  }
) {}

export type PlannedAttemptContinuationAuthorizationEvaluation =
  | { readonly _tag: "Authorized" }
  | {
      readonly _tag: "Rejected"
      readonly detail: string
      readonly reason: ContinuationAuthorizationReason
      readonly witness: ContinuationAuthorizationWitness
    }

const authorizePlannedAttemptContinuationUnderPermit = Effect.fn("PlannedAttemptContinuation.authorizeUnderPermit")(
  function* (
    permit: PlannedAttemptProtocolPermit,
    plannedAttempt: PlannedTaskAttempt,
    witness: PlannedAttemptContinuationWitness
  ) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(plannedAttempt.runId)
    const evaluation = evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, witness)
    if (evaluation._tag === "Rejected") {
      return yield* new PlannedAttemptContinuationAuthorizationRejected({
        detail: evaluation.detail,
        plannedAttempt,
        reason: evaluation.reason,
        witness: evaluation.witness
      })
    }
    const key = plannedAttemptContinuationAuthorizedRecordKey(plannedAttempt.attemptId, witness)
    const existing = records.find(({ key: recordKey }) => recordKey === key)
    if (existing !== undefined) return existing
    return yield* permit.recordFact(
      Effect.gen(function* () {
        const currentRecords = yield* journal.read(plannedAttempt.runId)
        const currentEvaluation = evaluatePlannedAttemptContinuationAuthorization(
          currentRecords,
          plannedAttempt,
          witness
        )
        if (currentEvaluation._tag === "Rejected") {
          return yield* new PlannedAttemptContinuationAuthorizationRejected({
            detail: currentEvaluation.detail,
            plannedAttempt,
            reason: currentEvaluation.reason,
            witness: currentEvaluation.witness
          })
        }
        const currentExisting = currentRecords.find(({ key: recordKey }) => recordKey === key)
        if (currentExisting !== undefined) return currentExisting
        return yield* journal.append(
          plannedAttempt.runId,
          key,
          PlannedAttemptContinuationAuthorizedEvent.make({
            plannedAttempt,
            version: workflowJournalEventVersion,
            witness
          })
        )
      })
    )
  }
)

/** Authorizes exact continuation facts while holding the shared attempt protocol permit. */
export const authorizePlannedAttemptContinuationWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    authorizePlannedAttemptContinuationUnderPermit(permit, plannedAttempt, witness)
  )

/** Acquires the shared attempt protocol permit before authorizing continuation facts. */
export const authorizePlannedAttemptContinuation = Effect.fn("PlannedAttemptContinuation.authorize")(function* (
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
    authorizePlannedAttemptContinuationUnderPermit(permit, plannedAttempt, witness)
  )
})
