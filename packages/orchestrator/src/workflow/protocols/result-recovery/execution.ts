import {
  PlannedAttemptExecutor,
  PlannedAttemptResultRecoveryAuthorization,
  plannedAttemptExecutorCorrelation,
  samePlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import {
  journalRecordByKey,
  journalRecordCountForAttemptKind,
  journalRecordsForAttemptKind
} from "../../../workflow-journal/record-evidence.js"
import {
  resultRecoveryContinueAuthorizedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit
} from "../planned-attempt-executor-work/protocol-controller.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal
} from "../planned-attempt-executor-work/events.js"
import {
  appendExecutorCommandDeliveryIntent,
  type AcceptedExecutorCommandDelivery
} from "../planned-attempt-executor-work/command-delivery.js"
import {
  reconcileUnsettledPlannedAttemptExecutorCommand,
  recordPlannedAttemptExecutorCommandResponse
} from "../planned-attempt-executor-work/command.js"
import {
  latestUnsettledPlannedAttemptExecutorCommand,
  plannedAttemptExecutorRequestFor
} from "../planned-attempt-executor-work/evidence.js"
import { ResultRecoveryRequestId } from "./events.js"
import { ResultRecoveryNotAvailable } from "./control.js"
import { resultRecoveryContinueAuthorizationProblem } from "./authorization.js"

/** One permission consumes one journaled semantic command; ambiguous delivery is reconciled without resend. */
export const executeResultRecoveryContinueWithPermit = Effect.fn("ResultRecovery.executeContinueWithPermit")(function* (
  permit: PlannedAttemptProtocolPermit,
  input: unknown,
  onIntentAccepted: (receipt: AcceptedExecutorCommandDelivery) => Effect.Effect<void>
) {
  const requestId = yield* Schema.decodeUnknownEffect(ResultRecoveryRequestId, { onExcessProperty: "error" })(input)
  const accepted = yield* AcceptedJournalReader
  const executor = yield* PlannedAttemptExecutor
  const initial = yield* accepted.readAccepted(requestId.runId)
  const permission = journalRecordByKey(initial, resultRecoveryContinueAuthorizedRecordKey(requestId))
  if (permission?.event._tag !== "ResultRecoveryContinueAuthorized")
    return yield* new ResultRecoveryNotAvailable({ requestId, detail: "no exact committed Continue permission" })
  const event = permission.event
  const attempt = event.plannedAttempt
  if (!samePlannedAttemptExecutorCorrelation(permit.correlation, plannedAttemptExecutorCorrelation(attempt)))
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "result recovery requires its exact protocol permit"
    })

  return yield* Effect.gen(function* () {
    const records = yield* accepted.readAccepted(requestId.runId)
    const existing = Array.from(
      journalRecordsForAttemptKind(records, attempt.attemptId, "PlannedAttemptExecutorCommandIntended")
    ).find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" && event.recoveryAuthorization?.nonce === requestId.nonce
    )
    if (existing?.event._tag === "PlannedAttemptExecutorCommandIntended") {
      const response = journalRecordByKey(
        records,
        plannedAttemptExecutorCommandResponseObservedRecordKey(attempt.attemptId, existing.event.ordinal)
      )
      if (response?.event._tag === "PlannedAttemptExecutorCommandResponseObserved") return response.event.report
      return yield* reconcileUnsettledPlannedAttemptExecutorCommand(permit, records, attempt, existing.event)
    }
    const problem = resultRecoveryContinueAuthorizationProblem(records, event)
    if (problem !== undefined) return yield* new ResultRecoveryNotAvailable({ requestId, detail: problem })
    if (latestUnsettledPlannedAttemptExecutorCommand(records, attempt) !== undefined)
      return yield* new ResultRecoveryNotAvailable({ requestId, detail: "another executor command remains unsettled" })
    if (executor.continueRejectedResult === undefined)
      return yield* new ResultRecoveryNotAvailable({
        requestId,
        detail: "the executor does not provide explicit result recovery"
      })
    const request = yield* plannedAttemptExecutorRequestFor(records, attempt)
    const authorization = PlannedAttemptResultRecoveryAuthorization.make({
      nonce: requestId.nonce,
      correlation: plannedAttemptExecutorCorrelation(attempt)
    })
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(
      journalRecordCountForAttemptKind(records, attempt.attemptId, "PlannedAttemptExecutorCommandIntended") + 1
    )
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const receipt = yield* restore(
          permit.commitIntent(
            appendExecutorCommandDeliveryIntent(
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "ContinueRejectedResult",
                recoveryAuthorization: authorization,
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal,
                plannedAttempt: attempt,
                version: workflowJournalEventVersion
              })
            )
          )
        )
        yield* onIntentAccepted(receipt)
      })
    )
    const report = yield* executor.continueRejectedResult(request, authorization)
    return yield* recordPlannedAttemptExecutorCommandResponse(attempt, ordinal, report)
  })
})

/** Standalone protocol composition for controlled diagnostics; Run delivery supplies its admitted lease separately. */
export const executeResultRecoveryContinue = Effect.fn("ResultRecovery.executeContinue")(function* (input: unknown) {
  const requestId = yield* Schema.decodeUnknownEffect(ResultRecoveryRequestId, { onExcessProperty: "error" })(input)
  const accepted = yield* AcceptedJournalReader
  const protocols = yield* PlannedAttemptProtocolController
  const records = yield* accepted.readAccepted(requestId.runId)
  const permission = journalRecordByKey(records, resultRecoveryContinueAuthorizedRecordKey(requestId))
  if (permission?.event._tag !== "ResultRecoveryContinueAuthorized")
    return yield* new ResultRecoveryNotAvailable({ requestId, detail: "no exact committed Continue permission" })
  return yield* protocols.withPermit(plannedAttemptExecutorCorrelation(permission.event.plannedAttempt), (permit) =>
    executeResultRecoveryContinueWithPermit(permit, requestId, () => Effect.void)
  )
})
