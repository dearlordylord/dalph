import { allocateResultRecoveryReplacementWithPermit } from "../../workflow/protocols/result-recovery/replacement.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { journalRecordByKey } from "../../workflow-journal/record-evidence.js"
import { resultRecoveryContinueAuthorizedRecordKey } from "../../workflow-journal/record-key.js"
import { ResultRecoveryNotAvailable } from "../../workflow/protocols/result-recovery/control.js"
import {
  plannedTaskAttemptEquivalence,
  plannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect } from "effect"
import type { DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import type { ResultRecoveryRequestId } from "../../workflow/protocols/result-recovery/events.js"
import { executeResultRecoveryContinueWithPermit } from "../../workflow/protocols/result-recovery/execution.js"

/** The scheduler's admitted lease binds the exact position before crossing the executor boundary. */
export const deliverResultRecoveryContinue = Effect.fn("DeliveryAction.resultRecoveryContinue")(function* (
  lease: Pick<DeliveryActionExecutionLease, "bindPlannedAttemptPosition" | "withPlannedAttemptProtocol">,
  plannedAttempt: PlannedTaskAttempt,
  requestId: ResultRecoveryRequestId
) {
  const accepted = yield* AcceptedJournalReader
  const records = yield* accepted.readAccepted(requestId.runId)
  const permission = journalRecordByKey(records, resultRecoveryContinueAuthorizedRecordKey(requestId))
  if (
    permission?.event._tag !== "ResultRecoveryContinueAuthorized" ||
    !plannedTaskAttemptEquivalence(permission.event.plannedAttempt, plannedAttempt)
  )
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "delivery requires the exact authorized attempt plan"
    })
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  return yield* lease.withPlannedAttemptProtocol(correlation, (permit) =>
    executeResultRecoveryContinueWithPermit(permit, requestId, (receipt) =>
      lease.bindPlannedAttemptPosition(plannedAttempt, undefined, receipt)
    )
  )
})

/** Restart records its successor under the predecessor permit before any successor boundary can run. */
export const deliverResultRecoveryRestart = Effect.fn("DeliveryAction.resultRecoveryRestart")(function* (
  lease: Pick<DeliveryActionExecutionLease, "withPlannedAttemptProtocol">,
  transition: Extract<RunnableFrontierTransition, { readonly _tag: "ReplaceRejectedResult" }>
) {
  return yield* lease.withPlannedAttemptProtocol(
    plannedAttemptExecutorCorrelation(transition.plannedAttempt),
    (permit) =>
      allocateResultRecoveryReplacementWithPermit(
        permit,
        transition.requestId,
        transition.witness,
        transition.integrationTarget,
        transition.specification,
        transition.plannedAttempt
      )
  )
})
