import { Schema } from "effect"
import { AcceptedResult, IntegrationTarget, PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { WorkflowActor } from "./actor.js"
import type { WorkflowJournalEvent } from "./event.js"
import { integrationResponsibilityEquivalence } from "../protocols/integration-admission/responsibility.js"

const integrationActionFields = {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}

/** Dalph accepted responsibility to integrate one immutable result into its coordinator-selected target. */
export const IntegrationResponsibilityBegan = Schema.TaggedStruct("IntegrationResponsibilityBegan", {
  acceptedResult: AcceptedResult,
  ...integrationActionFields,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegrationResponsibilityBegan = typeof IntegrationResponsibilityBegan.Type

/** Dalph crossed the exact responsibility's non-cancellable integration cutoff. */
export const IntegrationStarted = Schema.TaggedStruct("IntegrationStarted", {
  acceptedResult: AcceptedResult,
  ...integrationActionFields,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  recordedAt: JournalPosition,
  responsibilityBeganAt: JournalPosition,
  runId: RunId
})
export type IntegrationStarted = typeof IntegrationStarted.Type

type IntegrationJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }
>

/** Projects one integration action without attributing an executor-internal actor. */
export const projectIntegrationOccurrence = (
  record: JournalRecord,
  event: IntegrationJournalEvent
): IntegrationResponsibilityBegan | IntegrationStarted =>
  event._tag === "IntegrationResponsibilityBegan"
    ? IntegrationResponsibilityBegan.make({
        acceptedResult: event.acceptedResult,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        integrationTarget: event.integrationTarget,
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt,
        recordedAt: record.position,
        runId: record.runId
      })
    : IntegrationStarted.make({
        acceptedResult: event.acceptedResult,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        integrationTarget: event.integrationTarget,
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt,
        recordedAt: record.position,
        responsibilityBeganAt: event.responsibilityBeganAt,
        runId: record.runId
      })

const integrationResponsibilityMatches = (
  responsibility: IntegrationResponsibilityBegan | undefined,
  occurrence: IntegrationStarted
): boolean =>
  responsibility !== undefined &&
  responsibility.runId === occurrence.runId &&
  responsibility.recordedAt < occurrence.recordedAt &&
  integrationResponsibilityEquivalence(responsibility, occurrence)

const isIntegrationStarted = (candidate: { readonly _tag: string }): candidate is IntegrationStarted =>
  candidate._tag === "IntegrationStarted"

export const invalidIntegrationOccurrenceRelationship = (
  occurrences: ReadonlyArray<{ readonly _tag: string }>,
  candidate: { readonly _tag: string },
  index: number
) => {
  if (!isIntegrationStarted(candidate)) return undefined
  const occurrence = candidate
  const responsibility = occurrences.find(
    (candidate): candidate is IntegrationResponsibilityBegan =>
      candidate._tag === "IntegrationResponsibilityBegan" &&
      Reflect.get(candidate, "recordedAt") === occurrence.responsibilityBeganAt
  )
  return integrationResponsibilityMatches(responsibility, occurrence)
    ? undefined
    : {
        issue: `integration start must have one exact earlier responsibility at ${occurrence.responsibilityBeganAt}`,
        path: ["occurrences", index]
      }
}
