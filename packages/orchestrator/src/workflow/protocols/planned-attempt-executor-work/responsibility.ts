import {
  plannedAttemptExecutorCorrelation,
  plannedTaskAttemptEquivalence,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect } from "effect"
import { plannedAttemptExecutorWorkResponsibilityBeganRecordKey } from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptExecutorResponsibilityAbandoned,
  PlannedAttemptExecutorResponsibilityContradiction,
  PlannedAttemptExecutorResponsibilityLineageMissing
} from "./errors.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "./events.js"
import { acceptedFreshAttemptLineage } from "../../../coordination/admission/fresh-attempt-lineage.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"

/** Exact accepted Journal boundary that made one planned-attempt executor responsibility durable. */
class AcceptedPlannedAttemptExecutorResponsibilityValue {
  readonly #acceptedPlannedAttemptExecutorResponsibility = true

  constructor(
    readonly acceptedAt: JournalPosition,
    readonly plannedAttempt: PlannedTaskAttempt
  ) {
    Object.freeze(this)
  }

  isAcceptedResponsibility(): boolean {
    return this.#acceptedPlannedAttemptExecutorResponsibility
  }
}

export type AcceptedPlannedAttemptExecutorResponsibility = AcceptedPlannedAttemptExecutorResponsibilityValue

/** Runtime guard for the privately issued accepted-responsibility capability. */
export const isAcceptedPlannedAttemptExecutorResponsibility = (
  value: unknown
): value is AcceptedPlannedAttemptExecutorResponsibility =>
  value instanceof AcceptedPlannedAttemptExecutorResponsibilityValue && value.isAcceptedResponsibility()

const acceptedResponsibility = (
  acceptedAt: JournalPosition,
  plannedAttempt: PlannedTaskAttempt
): AcceptedPlannedAttemptExecutorResponsibility => {
  return new AcceptedPlannedAttemptExecutorResponsibilityValue(acceptedAt, plannedAttempt)
}

/** Records ownership before any adapter records a command intent or crosses the executor boundary. */
export const beginPlannedAttemptExecutorResponsibility = Effect.fn(
  "PlannedAttemptExecutorWorkflow.beginResponsibility"
)(function* (plannedAttempt: PlannedTaskAttempt) {
  const journal = yield* InRunJournal
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  if (
    records.some(
      ({ event }) =>
        event._tag === "AttemptImplementationAbandoned" &&
        event.subject.plannedAttempt.runId === plannedAttempt.runId &&
        event.subject.plannedAttempt.attemptId === plannedAttempt.attemptId
    )
  ) {
    return yield* new PlannedAttemptExecutorResponsibilityAbandoned({ correlation })
  }
  const responsibilityBegan = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (responsibilityBegan?.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    if (!plannedTaskAttemptEquivalence(responsibilityBegan.event.plannedAttempt, plannedAttempt)) {
      return yield* new PlannedAttemptExecutorResponsibilityContradiction({
        accepted: responsibilityBegan.event.plannedAttempt,
        requested: plannedAttempt
      })
    }
    return acceptedResponsibility(responsibilityBegan.position, responsibilityBegan.event.plannedAttempt)
  } else {
    const ordinaryPlanWasAccepted = records.some(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
    )
    if (
      ordinaryPlanWasAccepted &&
      acceptedFreshAttemptLineage(records, plannedAttempt, "WorktreeReady") === undefined
    ) {
      return yield* new PlannedAttemptExecutorResponsibilityLineageMissing({ correlation })
    }
    const appended = yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    return acceptedResponsibility(appended.position, plannedAttempt)
  }
})
