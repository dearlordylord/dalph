import { Effect, Schema } from "effect"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import type { SafeContinuationRevalidationEligibility } from "../../../coordination/frontier/fresh-facts.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { evaluatePlannedAttemptResumeRedeliveryAuthorization } from "../planned-attempt-continuation/resume-redelivery-authorization.js"
import type { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import { appendExecutorCommandDeliveryIntent, type AcceptedExecutorCommandDelivery } from "./command-delivery.js"
import { issuePlannedAttemptExecutorCommand, recordPlannedAttemptExecutorCommandResponse } from "./command.js"
import {
  PlannedAttemptExecutorResumeRedeliveryIntendedEvent,
  PlannedAttemptExecutorResumeRedeliveryOrdinal
} from "./events.js"
import { plannedAttemptExecutorRequestFor } from "./evidence.js"
import type { PlannedAttemptProtocolPermit } from "./protocol-controller.js"

/** Rejects retry-delivery authorization before any new ambiguity-crossing intent exists. */
export class PlannedAttemptResumeRedeliveryRejected extends Schema.TaggedError<PlannedAttemptResumeRedeliveryRejected>()(
  "PlannedAttemptResumeRedeliveryRejected",
  { detail: Schema.String }
) {}

/** Redelivers only an already-intended Resume; the original semantic ordinal is unchanged. */
export const runPlannedAttemptExecutorResumeRedelivery = Effect.fn("PlannedAttemptExecutorWorkflow.redeliverResume")(
  function* (
    permit: PlannedAttemptProtocolPermit,
    plannedAttempt: PlannedTaskAttempt,
    eligibility: SafeContinuationRevalidationEligibility,
    witness: PlannedAttemptContinuationWitness,
    onIntentAccepted: (receipt: AcceptedExecutorCommandDelivery) => Effect.Effect<void>
  ) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(plannedAttempt.runId)
    const request = yield* plannedAttemptExecutorRequestFor(records, plannedAttempt)
    const intended = yield* Effect.uninterruptibleMask((restore) =>
      permit.commitIntent(
        Effect.gen(function* () {
          const current = yield* journal.read(plannedAttempt.runId)
          const evaluation = evaluatePlannedAttemptResumeRedeliveryAuthorization(
            current,
            plannedAttempt,
            eligibility,
            witness
          )
          if (evaluation._tag === "Rejected") {
            return yield* new PlannedAttemptResumeRedeliveryRejected({ detail: evaluation.detail })
          }
          const authorization = evaluation.authorization
          const redeliveryOrdinal = PlannedAttemptExecutorResumeRedeliveryOrdinal.make(
            current.filter(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" &&
                event.plannedAttempt.runId === plannedAttempt.runId &&
                event.plannedAttempt.attemptId === plannedAttempt.attemptId &&
                event.commandOrdinal === authorization.resumeCommandOrdinal
            ).length + 1
          )
          const receipt = yield* restore(
            appendExecutorCommandDeliveryIntent(
              PlannedAttemptExecutorResumeRedeliveryIntendedEvent.make({
                authorization: {
                  safeProjectionObservedAt: authorization.safeProjectionObservedAt,
                  witness: authorization.witness
                },
                commandOrdinal: authorization.resumeCommandOrdinal,
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                plannedAttempt,
                projectionOrdinal: authorization.projectionOrdinal,
                redeliveryOrdinal,
                version: workflowJournalEventVersion
              })
            )
          )
          yield* onIntentAccepted(receipt)
          return receipt
        })
      )
    )
    const report = yield* issuePlannedAttemptExecutorCommand(plannedAttempt, { _tag: "Resume", request })
    return yield* recordPlannedAttemptExecutorCommandResponse(plannedAttempt, intended.commandOrdinal, report)
  }
)
