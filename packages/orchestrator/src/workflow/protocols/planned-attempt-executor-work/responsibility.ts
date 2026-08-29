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
  PlannedAttemptExecutorResponsibilityContradiction
} from "./errors.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "./events.js"

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
  } else {
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
  }
})
