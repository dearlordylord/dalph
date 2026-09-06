import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence, type TaskRevision } from "@dalph/contracts"
import { isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import { taskTrackerObservationMatchesRead } from "../../task-tracker-facts/observation-match.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../planned-attempt-worktree-observation/protocol.js"

const exactAttempt = plannedTaskAttemptEquivalence

export const presentWitnessPair = (
  intent: JournalRecord | undefined,
  outcome: JournalRecord | undefined
): readonly [JournalRecord, JournalRecord] | undefined =>
  intent === undefined || outcome === undefined ? undefined : [intent, outcome]

export const graphIntentPrecedesOutcome = (intent: JournalRecord, outcome: JournalRecord): boolean =>
  intent.position < outcome.position && intent.event._tag === "TaskTrackerReadIntentRecorded"

export const graphReadMatchesOutcome = (intent: JournalRecord, outcome: JournalRecord): boolean =>
  intent.event._tag === "TaskTrackerReadIntentRecorded" &&
  intent.event.operation._tag === "ReadTrackerGraph" &&
  outcome.event._tag === "TaskTrackerFactsObserved" &&
  taskTrackerObservationMatchesRead(outcome.event.observation, intent.event.operation)

type TaskTrackerFactsObservedEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
type CompleteGraphObservedEvent = TaskTrackerFactsObservedEvent & {
  readonly observation: Extract<
    TaskTrackerFactsObservedEvent["observation"],
    { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
  >
}

export const isCompleteGraphObservation = (
  outcome: JournalRecord
): outcome is JournalRecord & { readonly event: CompleteGraphObservedEvent } =>
  outcome.event._tag === "TaskTrackerFactsObserved" &&
  (outcome.event.observation._tag === "CompleteTaskTrackerFacts" ||
    outcome.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")

export const specificationIntentMatches = (intent: JournalRecord, plannedAttempt: PlannedTaskAttempt): boolean =>
  intent.event._tag === "TaskTrackerReadIntentRecorded" &&
  intent.event.operation._tag === "ReadTaskWorkSpecification" &&
  intent.event.operation.taskId === plannedAttempt.taskId

export const specificationOutcomeMatches = (
  intent: JournalRecord,
  outcome: JournalRecord,
  plannedAttempt: PlannedTaskAttempt,
  authorizedTaskRevision: TaskRevision
): boolean =>
  intent.event._tag === "TaskTrackerReadIntentRecorded" &&
  outcome.event._tag === "TaskTrackerFactsObserved" &&
  outcome.event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
  outcome.event.observation.factFamily.taskId === plannedAttempt.taskId &&
  taskTrackerObservationMatchesRead(outcome.event.observation, intent.event.operation) &&
  outcome.event.observation.factFamily.fingerprint === authorizedTaskRevision

const claimIntentMatches = (intent: JournalRecord, plannedAttempt: PlannedTaskAttempt): boolean =>
  intent.event._tag === "TaskTrackerReadIntentRecorded" &&
  intent.event.operation._tag === "ReadTaskClaim" &&
  intent.event.operation.taskId === plannedAttempt.taskId

const claimOutcomeMatches = (
  intent: JournalRecord,
  outcome: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  intent.event._tag === "TaskTrackerReadIntentRecorded" &&
  outcome.event._tag === "TaskTrackerFactsObserved" &&
  outcome.event.observation._tag === "FocusedTaskClaimFacts" &&
  outcome.event.observation.coverage.taskId === plannedAttempt.taskId &&
  outcome.event.observation.observation._tag === "ActiveTaskClaim" &&
  taskTrackerObservationMatchesRead(outcome.event.observation, intent.event.operation)

type AuthorizedClaim = NonNullable<ReturnType<typeof authorizedClaimForAttempt>>

export const claimWitnessMatchesExactClaim = (
  intent: JournalRecord,
  outcome: JournalRecord,
  plannedAttempt: PlannedTaskAttempt,
  authorizedClaim: AuthorizedClaim
): boolean =>
  claimIntentMatches(intent, plannedAttempt) &&
  claimOutcomeMatches(intent, outcome, plannedAttempt) &&
  outcome.event._tag === "TaskTrackerFactsObserved" &&
  outcome.event.observation._tag === "FocusedTaskClaimFacts" &&
  outcome.event.observation.observation._tag === "ActiveTaskClaim" &&
  isExactTaskClaim(outcome.event.observation.observation, authorizedClaim.claim)

export const worktreeWitnessMatches = (
  intent: JournalRecord,
  outcome: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  intent.event._tag === "GitReadIntentRecorded" &&
  intent.event.operation._tag === "ReadTaskWorktree" &&
  exactAttempt(intent.event.operation.plannedAttempt, plannedAttempt) &&
  outcome.event._tag === "PlannedAttemptWorktreeObserved" &&
  outcome.event.observation._tag === "PlannedWorktreeReady" &&
  plannedAttemptWorktreeObservationMatchesPlan(outcome.event.observation, plannedAttempt)

export const targetLineageIntentMatches = (intent: JournalRecord, plannedAttempt: PlannedTaskAttempt): boolean =>
  intent.event._tag === "GitReadIntentRecorded" &&
  intent.event.operation._tag === "ReadTargetLineage" &&
  exactAttempt(intent.event.operation.plannedAttempt, plannedAttempt)

export const targetLineageOutcomeMatches = (outcome: JournalRecord, plannedAttempt: PlannedTaskAttempt): boolean =>
  outcome.event._tag === "TargetLineageObserved" &&
  exactAttempt(outcome.event.plannedAttempt, plannedAttempt) &&
  outcome.event.observation.plannedBaseSha === plannedAttempt.baseSha &&
  outcome.event.observation.plannedBaseIsAncestorOfTargetHead
