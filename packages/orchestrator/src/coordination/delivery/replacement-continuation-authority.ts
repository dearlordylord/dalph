import {
  TaskWorkSpecification,
  plannedTaskAttemptEquivalence,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import { Schema } from "effect"
import { isExactTaskClaim, type ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { causalClaimForAttempt } from "../../workflow/claim-authority-history.js"
import type { OperationId } from "../../workflow/identity.js"
import {
  exactAppliedRestart,
  recordedReplacement,
  restartClaimAuthorityAtApplication
} from "../../workflow/protocols/attempt-choice/restart-authority-evidence.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { immutableSnapshot } from "../immutable-snapshot.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"

/** Replacement successors may resume only at these post-plan boundaries. */
export type ReplacementContinuationStep = Extract<
  FreshWorkflowStep,
  { readonly _tag: "BeginPlannedAttemptExecutorWork" | "ReconcileTaskWorktree" }
>

const ReplacementContinuationAuthorityTypeId: unique symbol = Symbol("@dalph/ReplacementContinuationAuthority")
const issuedReplacementContinuationAuthorities = new WeakSet<object>()
const replacementAuthorityByStep = new WeakMap<object, ReplacementContinuationAuthority>()

/** Exact accepted Restart replacement authority for one immutable successor attempt. */
export interface ReplacementContinuationAuthority {
  readonly [ReplacementContinuationAuthorityTypeId]: typeof ReplacementContinuationAuthorityTypeId
  readonly claim: ActiveTaskClaim
  readonly plannedAttempt: PlannedTaskAttempt
  readonly replacementAt: JournalPosition
  readonly specification: TaskWorkSpecification
  readonly specificationObservationOperationId: OperationId
  readonly successorPlanOperationId: OperationId
}

type ReplacementRecord = NonNullable<ReturnType<typeof recordedReplacement>>

/** Runtime guard for replacement authority minted from one validated accepted Journal prefix. */
const isReplacementContinuationAuthority = (value: unknown): value is ReplacementContinuationAuthority =>
  typeof value === "object" && value !== null && issuedReplacementContinuationAuthorities.has(value)

/** Returns the exact replacement capability attached to a derived successor continuation step. */
export const replacementContinuationAuthorityOf = (
  step: FreshWorkflowStep
): ReplacementContinuationAuthority | undefined => replacementAuthorityByStep.get(step)

const replacementStepCommonIdentityMatches = (
  authority: ReplacementContinuationAuthority,
  step: FreshWorkflowStep
): boolean =>
  step.task.id === authority.plannedAttempt.taskId &&
  "claimOperationId" in step &&
  step.claimOperationId === authority.claim.operationId

const replacementBeginMatches = (
  authority: ReplacementContinuationAuthority,
  step: Extract<FreshWorkflowStep, { readonly _tag: "BeginPlannedAttemptExecutorWork" }>
): boolean =>
  plannedTaskAttemptEquivalence(step.plannedAttempt, authority.plannedAttempt) &&
  step.specification.taskId === authority.specification.taskId &&
  step.specification.fingerprint === authority.specification.fingerprint &&
  step.specification.title === authority.specification.title &&
  step.specification.body === authority.specification.body

const replacementReconciliationMatches = (
  authority: ReplacementContinuationAuthority,
  step: Extract<FreshWorkflowStep, { readonly _tag: "ReconcileTaskWorktree" }>
): boolean =>
  step.predecessorOperationId === authority.successorPlanOperationId &&
  plannedTaskAttemptEquivalence(step.plannedAttempt, authority.plannedAttempt)

/** Checks that an issued replacement capability still names this exact successor boundary. */
export const replacementContinuationAuthorityMatchesStep = (
  authority: ReplacementContinuationAuthority,
  step: FreshWorkflowStep
): step is ReplacementContinuationStep =>
  isReplacementContinuationAuthority(authority) &&
  replacementStepCommonIdentityMatches(authority, step) &&
  (step._tag === "BeginPlannedAttemptExecutorWork"
    ? replacementBeginMatches(authority, step)
    : step._tag === "ReconcileTaskWorktree" && replacementReconciliationMatches(authority, step))

const exactReplacementClaim = (
  records: ReadonlyArray<JournalRecord>,
  replacement: NonNullable<ReturnType<typeof recordedReplacement>>,
  causalClaim: NonNullable<ReturnType<typeof causalClaimForAttempt>>
): ActiveTaskClaim | undefined => {
  const application = exactAppliedRestart(records, replacement.event.requestId, replacement.event.subject)
  if (application === undefined) return undefined
  const restartClaim = restartClaimAuthorityAtApplication(records, application)
  if (restartClaim === undefined || !isExactTaskClaim(restartClaim.claim, causalClaim.claim)) return undefined
  return isExactTaskClaim(replacement.event.witness.expectedClaim, causalClaim.claim) ? causalClaim.claim : undefined
}

interface ExactReplacementSpecification {
  readonly operationId: OperationId
  readonly specification: TaskWorkSpecification
}

type SpecificationOutcomeRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
      { readonly _tag: "FocusedTaskWorkSpecificationFacts" }
    >
  }
}

type SpecificationIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
    readonly operation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"],
      { readonly _tag: "ReadTaskWorkSpecification" }
    >
  }
}

const exactSpecificationOutcome = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  operationId: OperationId
): SpecificationOutcomeRecord | undefined => {
  const matches = records.filter(
    (record): record is SpecificationOutcomeRecord =>
      record.runId === runId &&
      record.key === outcomeRecordKey(operationId) &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === operationId &&
      record.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
  )
  return matches.length === 1 ? matches[0] : undefined
}

const exactSpecificationIntent = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  operationId: OperationId
): SpecificationIntentRecord | undefined => {
  const matches = records.filter(
    (record): record is SpecificationIntentRecord =>
      record.runId === runId &&
      record.key === intentRecordKey(operationId) &&
      record.event._tag === "TaskTrackerReadIntentRecorded" &&
      record.event.operation._tag === "ReadTaskWorkSpecification" &&
      record.event.operation.operationId === operationId
  )
  return matches.length === 1 ? matches[0] : undefined
}

const specificationChronologyMatches = (
  intent: SpecificationIntentRecord,
  outcome: SpecificationOutcomeRecord,
  applicationAt: JournalPosition,
  replacementAt: JournalPosition
): boolean => intent.position < outcome.position && intent.position > applicationAt && outcome.position < replacementAt

const specificationIdentityMatches = (
  outcome: SpecificationOutcomeRecord,
  intent: SpecificationIntentRecord,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const fact = outcome.event.observation.factFamily
  return (
    fact.taskId === plannedAttempt.taskId &&
    fact.fingerprint === plannedAttempt.taskRevision &&
    taskTrackerObservationMatchesRead(outcome.event.observation, intent.event.operation)
  )
}

const exactReplacementSpecification = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  plannedAttempt: PlannedTaskAttempt,
  replacement: NonNullable<ReturnType<typeof recordedReplacement>>
): ExactReplacementSpecification | undefined => {
  const application = exactAppliedRestart(records, replacement.event.requestId, replacement.event.subject)
  if (application === undefined) return undefined
  const operationId = replacement.event.witness.specificationObservationOperationId
  const outcome = exactSpecificationOutcome(records, runId, operationId)
  const intent = exactSpecificationIntent(records, runId, operationId)
  if (outcome === undefined || intent === undefined) return undefined
  if (!specificationChronologyMatches(intent, outcome, application.position, replacement.position)) return undefined
  const fact = outcome.event.observation.factFamily
  if (!specificationIdentityMatches(outcome, intent, plannedAttempt)) return undefined
  const specification = { body: fact.body, fingerprint: fact.fingerprint, taskId: fact.taskId, title: fact.title }
  return Schema.is(TaskWorkSpecification)(specification) ? { operationId, specification } : undefined
}

interface AcceptedReplacementEvidence {
  readonly causalClaim: NonNullable<ReturnType<typeof causalClaimForAttempt>>
  readonly records: ReadonlyArray<JournalRecord>
  readonly replacement: ReplacementRecord
}

const acceptedReplacementEvidenceFor = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  plannedAttempt: PlannedTaskAttempt,
  successorPlanOperationId: OperationId
): AcceptedReplacementEvidence | undefined => {
  const detachedRecords = immutableSnapshot(records)
  const history = reduceWorkflowJournalHistory(runId, detachedRecords)
  if (history._tag !== "ValidWorkflowJournalHistory") return undefined
  const replacement = detachedRecords.findLast(
    (record): record is ReplacementRecord =>
      record.event._tag === "PlannedAttemptReplaced" &&
      record.runId === runId &&
      record.event.requestId.runId === runId &&
      record.event.successorPlan.operationId === successorPlanOperationId &&
      plannedTaskAttemptEquivalence(record.event.successorPlan.plannedAttempt, plannedAttempt)
  )
  const causalClaim = causalClaimForAttempt(detachedRecords, plannedAttempt.attemptId)
  return replacement === undefined || causalClaim === undefined
    ? undefined
    : { causalClaim, records: detachedRecords, replacement }
}

/**
 * Reconstructs continuation authority only when one exact accepted Restart,
 * its causal claim, successor plan, and F2 specification observation agree.
 */
export const replacementContinuationAuthorityFrom = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  plannedAttempt: PlannedTaskAttempt,
  successorPlanOperationId: OperationId
): ReplacementContinuationAuthority | undefined => {
  const evidence = acceptedReplacementEvidenceFor(records, runId, plannedAttempt, successorPlanOperationId)
  if (evidence === undefined) return undefined
  const { causalClaim, records: acceptedRecords, replacement } = evidence
  const canonicalReplacement = recordedReplacement(acceptedRecords, replacement.event.subject)
  if (canonicalReplacement !== replacement || runId !== plannedAttempt.runId) return undefined
  const claim = exactReplacementClaim(acceptedRecords, replacement, causalClaim)
  const exactSpecification = exactReplacementSpecification(acceptedRecords, runId, plannedAttempt, replacement)
  if (claim === undefined || exactSpecification === undefined) return undefined

  const authority: ReplacementContinuationAuthority = {
    [ReplacementContinuationAuthorityTypeId]: ReplacementContinuationAuthorityTypeId,
    claim: immutableSnapshot(claim),
    plannedAttempt: immutableSnapshot(plannedAttempt),
    replacementAt: replacement.position,
    specification: immutableSnapshot(exactSpecification.specification),
    specificationObservationOperationId: exactSpecification.operationId,
    successorPlanOperationId
  }
  Object.freeze(authority)
  issuedReplacementContinuationAuthorities.add(authority)
  return authority
}

/** Attaches one already-reconstructed replacement capability to its exact next step. */
export const authorizeReplacementContinuationStep = <Step extends ReplacementContinuationStep>(
  authority: ReplacementContinuationAuthority,
  step: Step
): Step | undefined => {
  if (!replacementContinuationAuthorityMatchesStep(authority, step)) return undefined
  replacementAuthorityByStep.set(step, authority)
  return step
}
