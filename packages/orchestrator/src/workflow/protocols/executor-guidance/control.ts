import { executorGuidanceDispatchProblem, executorGuidanceRedelivery } from "./protocol.js"
import {
  AttemptId,
  ExecutorGuidanceRequestId,
  type RunId,
  ExecutorGuidanceTransmission,
  PlannedAttemptExecutor,
  PlannedTaskAttempt,
  samePlannedTaskAttempt,
  executorGuidanceTextByteLimit
} from "@dalph/contracts"
import type { Crypto } from "effect"
import { Effect, Schema, Semaphore } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import { journalRecordByKey } from "../../../workflow-journal/record-evidence.js"
import {
  executorGuidanceAdmittedRecordKey,
  executorGuidanceDispatchIntendedRecordKey,
  executorGuidanceObservedRecordKey
} from "../../../workflow-journal/record-key.js"
import { recordedTaskAttemptPlanFor, recordedTaskAttemptPlans } from "../task-attempt-planning/journal-evidence.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  ExecutorGuidanceMetadata,
  ExecutorGuidancePayloadDigest,
  ExecutorGuidancePayloadBytes,
  ExecutorGuidanceAdmittedEvent,
  ExecutorGuidanceDispatchIntendedEvent,
  ExecutorGuidanceObservedEvent
} from "./events.js"

const guidanceText = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      new TextDecoder().decode(new TextEncoder().encode(text)) === text || "guidance must be well-formed Unicode"
  )
)
export const SendExecutorGuidanceRequest = Schema.Struct({
  requestId: ExecutorGuidanceRequestId,
  attemptId: AttemptId,
  text: guidanceText
})
export const ApplyExecutorGuidanceRequest = Schema.Struct({
  requestId: ExecutorGuidanceRequestId,
  plannedAttempt: PlannedTaskAttempt,
  text: guidanceText
})
export class ExecutorGuidanceIdentityContradiction extends Schema.TaggedError<ExecutorGuidanceIdentityContradiction>()(
  "ExecutorGuidanceIdentityContradiction",
  { requestId: ExecutorGuidanceRequestId }
) {}
const byteHexWidth = 2
const hexRadix = 16

/** The Run owns metadata and dispatch; the ephemeral text belongs only to this invocation. */
export const makeExecutorGuidanceControl = (runId: RunId, crypto: Crypto.Crypto) =>
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const accepted = yield* AcceptedJournalReader
    const executor = yield* PlannedAttemptExecutor
    const serial = yield* Semaphore.make(1)
    const apply = Effect.fn("ExecutorGuidanceControl.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyExecutorGuidanceRequest, { onExcessProperty: "error" })(
        input
      )
      if (request.plannedAttempt.runId !== runId)
        return ExecutorGuidanceTransmission.cases.Refused.make({ reason: "TargetChanged" })
      const bytes = new TextEncoder().encode(request.text)
      const digest = yield* crypto.digest("SHA-256", bytes)
      const metadata = ExecutorGuidanceMetadata.make({
        requestId: request.requestId,
        plannedAttempt: request.plannedAttempt,
        payloadBytes: ExecutorGuidancePayloadBytes.make(bytes.byteLength),
        payloadDigest: ExecutorGuidancePayloadDigest.make(
          Array.from(digest, (byte) => byte.toString(hexRadix).padStart(byteHexWidth, "0")).join("")
        )
      })
      return yield* serial.withPermit(
        Effect.gen(function* () {
          const runId = request.plannedAttempt.runId
          const records = yield* accepted.readAccepted(runId)
          const redelivery = executorGuidanceRedelivery(records, metadata)
          const observe = (disposition: ExecutorGuidanceTransmission) =>
            journal
              .append(
                runId,
                executorGuidanceObservedRecordKey(request.requestId),
                ExecutorGuidanceObservedEvent.make({
                  requestId: request.requestId,
                  disposition,
                  version: workflowJournalEventVersion
                })
              )
              .pipe(
                Effect.flatMap((record) => Schema.decodeUnknownEffect(ExecutorGuidanceObservedEvent)(record.event)),
                Effect.map((event) => event.disposition)
              )
          if (redelivery._tag === "Contradiction")
            return yield* new ExecutorGuidanceIdentityContradiction({ requestId: request.requestId })
          if (redelivery._tag === "Retained") return redelivery.disposition
          if (redelivery._tag === "Observe") return yield* observe(redelivery.disposition)

          if (recordedTaskAttemptPlanFor(records, request.plannedAttempt) === undefined)
            return ExecutorGuidanceTransmission.cases.Refused.make({ reason: "TargetChanged" })
          yield* journal.append(
            runId,
            executorGuidanceAdmittedRecordKey(request.requestId),
            ExecutorGuidanceAdmittedEvent.make({ metadata, version: workflowJournalEventVersion })
          )
          if (bytes.byteLength > executorGuidanceTextByteLimit)
            return yield* observe(ExecutorGuidanceTransmission.cases.Refused.make({ reason: "TextTooLarge" }))
          if (executorGuidanceDispatchProblem(records, request.plannedAttempt) !== undefined)
            return yield* observe(ExecutorGuidanceTransmission.cases.Refused.make({ reason: "AttemptInactive" }))
          const select = executor.selectGuidanceTarget
          const send = executor.sendGuidance
          if (select === undefined || send === undefined)
            return yield* observe(ExecutorGuidanceTransmission.cases.Refused.make({ reason: "CapabilityUnavailable" }))
          const selected = yield* select(request.plannedAttempt)
          if (selected._tag === "Refused")
            return yield* observe(ExecutorGuidanceTransmission.cases.Refused.make({ reason: selected.reason }))
          if (!samePlannedTaskAttempt(selected.target.plannedAttempt, request.plannedAttempt))
            return yield* observe(ExecutorGuidanceTransmission.cases.Refused.make({ reason: "TargetChanged" }))
          const beforeDispatch = yield* accepted.readAccepted(runId)
          if (executorGuidanceDispatchProblem(beforeDispatch, request.plannedAttempt) !== undefined)
            return yield* observe(ExecutorGuidanceTransmission.cases.Refused.make({ reason: "AttemptInactive" }))
          yield* journal.append(
            runId,
            executorGuidanceDispatchIntendedRecordKey(request.requestId),
            ExecutorGuidanceDispatchIntendedEvent.make({
              requestId: request.requestId,
              target: selected.target,
              version: workflowJournalEventVersion
            })
          )
          return yield* observe(yield* send(selected.target, request.requestId, request.text))
        })
      )
    })
    const send = Effect.fn("ExecutorGuidanceControl.send")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(SendExecutorGuidanceRequest, { onExcessProperty: "error" })(
        input
      )
      const prefix = yield* accepted.readAccepted(runId)
      const retained = journalRecordByKey(prefix, executorGuidanceAdmittedRecordKey(request.requestId))
      if (
        retained?.event._tag === "ExecutorGuidanceAdmitted" &&
        retained.event.metadata.plannedAttempt.attemptId !== request.attemptId
      )
        return yield* new ExecutorGuidanceIdentityContradiction({ requestId: request.requestId })
      const plan = recordedTaskAttemptPlans(prefix).find(
        ({ plannedAttempt }) => plannedAttempt.attemptId === request.attemptId
      )
      if (plan === undefined) return ExecutorGuidanceTransmission.cases.Refused.make({ reason: "TargetChanged" })
      return yield* apply({ requestId: request.requestId, plannedAttempt: plan.plannedAttempt, text: request.text })
    })
    return { apply, send }
  })

export type ExecutorGuidanceControlService = Effect.Success<ReturnType<typeof makeExecutorGuidanceControl>>
