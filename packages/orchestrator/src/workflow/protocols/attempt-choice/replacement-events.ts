import { GitCommitSha, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Match, Schema } from "effect"
import { GitTargetLineageReadFailure } from "../../../authorities/git/target-lineage.js"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { taskTrackerTargetKey, TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { WorkflowOperation } from "../../registry/operation.js"
import { AttemptChoiceRequestId, AttemptChoiceSubject, AttemptQuiescenceProof } from "./events.js"

const replacementWitnessObservationCount = 5

/**
 * Exact recorded facts that authorize replacing P1 with P2. Each operation
 * identity refers to the durable outcome of a fresh read; the embedded values
 * keep the atomic event independently auditable after reconstruction.
 */
export const PlannedAttemptReplacementWitness = Schema.Struct({
  claimObservationOperationId: OperationId,
  expectedClaim: ActiveTaskClaim,
  graphObservationOperationId: OperationId,
  oldWorktreeObservationOperationId: OperationId,
  oldWorktreeProof: PlannedWorktreeReady,
  quiescenceProof: AttemptQuiescenceProof,
  specificationObservationOperationId: OperationId,
  targetHeadSha: GitCommitSha,
  targetLineageObservationOperationId: OperationId
}).check(
  Schema.makeFilter((witness) =>
    new Set([
      witness.claimObservationOperationId,
      witness.graphObservationOperationId,
      witness.oldWorktreeObservationOperationId,
      witness.specificationObservationOperationId,
      witness.targetLineageObservationOperationId
    ]).size === replacementWitnessObservationCount
      ? undefined
      : "replacement witnesses must name five distinct boundary observations"
  )
)
export type PlannedAttemptReplacementWitness = typeof PlannedAttemptReplacementWitness.Type

/** A complete tracker read failed without proving any replacement task facts. */
export const AttemptRestartTaskFactsReadFailure = Schema.TaggedStruct("AttemptRestartTaskFactsReadFailure", {
  detail: Schema.String,
  source: Schema.Literals([
    "FixtureReader.FixtureReadError",
    "TaskDag.GraphProjectionError",
    "TrackerGraphReader.AdapterReadError",
    "TrackerGraphReader.TrackerReadError"
  ]),
  target: TrackerTarget
})
export type AttemptRestartTaskFactsReadFailure = typeof AttemptRestartTaskFactsReadFailure.Type

/** Exact read-only boundary failure that leaves P1 intact and authorizes no P2. */
export const AttemptRestartAuthorityReadFailure = Schema.Union([
  AttemptRestartTaskFactsReadFailure,
  GitWorktreeReadFailure,
  GitTargetLineageReadFailure
])
export type AttemptRestartAuthorityReadFailure = typeof AttemptRestartAuthorityReadFailure.Type

const restartTaskFactsReadOperationMatches = (
  operation: WorkflowOperation,
  failure: AttemptRestartTaskFactsReadFailure,
  subject: AttemptChoiceSubject
): boolean => {
  const taskId = subject.plannedAttempt.taskId
  if (operation._tag === "ReadTrackerGraph") {
    return (
      operation.readShape.explicitlyCoveredTaskIds.includes(taskId) &&
      taskTrackerTargetKey(operation.target) === taskTrackerTargetKey(failure.target)
    )
  }
  return (
    operation._tag === "ReadTaskWorkSpecification" &&
    operation.taskId === taskId &&
    taskTrackerTargetKey(operation.target) === taskTrackerTargetKey(failure.target)
  )
}

const restartWorktreeReadOperationMatches = (
  operation: WorkflowOperation,
  failure: GitWorktreeReadFailure,
  subject: AttemptChoiceSubject
): boolean =>
  operation._tag === "ReadTaskWorktree" &&
  failure.worktree === subject.plannedAttempt.worktree &&
  plannedTaskAttemptEquivalence(operation.plannedAttempt, subject.plannedAttempt)

const restartTargetReadOperationMatches = (
  operation: WorkflowOperation,
  failure: GitTargetLineageReadFailure,
  subject: AttemptChoiceSubject
): boolean =>
  operation._tag === "ReadTargetLineage" &&
  failure.plannedBaseSha === subject.plannedAttempt.baseSha &&
  plannedTaskAttemptEquivalence(operation.plannedAttempt, subject.plannedAttempt) &&
  operation.integrationTarget.repository === failure.target.repository &&
  operation.integrationTarget.ref === failure.target.ref

/**
 * Matches one Restart read failure to the exact typed task or Git operation
 * that could have produced it. Chronology remains owned by each consuming
 * journal or occurrence boundary.
 */
export const restartAuthorityReadOperationMatches = (
  operation: WorkflowOperation,
  failure: AttemptRestartAuthorityReadFailure,
  subject: AttemptChoiceSubject
): boolean =>
  Match.valueTags(failure, {
    AttemptRestartTaskFactsReadFailure: (failure) => restartTaskFactsReadOperationMatches(operation, failure, subject),
    GitTargetLineageReadFailure: (failure) => restartTargetReadOperationMatches(operation, failure, subject),
    GitWorktreeReadFailure: (failure) => restartWorktreeReadOperationMatches(operation, failure, subject)
  })

/**
 * Dalph durably observed one typed Restart authority-read failure. The exact
 * operation links this non-action occurrence to its already-recorded read
 * intent so recovery waits without inventing task or Git authority.
 */
export const AttemptRestartAuthorityReadFailedEvent = Schema.TaggedStruct("AttemptRestartAuthorityReadFailed", {
  failure: AttemptRestartAuthorityReadFailure,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) => {
    const plannedAttempt = event.subject.plannedAttempt
    if (event.failure._tag === "GitWorktreeReadFailure" && event.failure.worktree !== plannedAttempt.worktree) {
      return "Restart worktree read failure must name P1's exact worktree"
    }
    if (
      event.failure._tag === "GitTargetLineageReadFailure" &&
      event.failure.plannedBaseSha !== plannedAttempt.baseSha
    ) {
      return "Restart target read failure must name P1's exact Base SHA"
    }
    return undefined
  })
)
export type AttemptRestartAuthorityReadFailedEvent = typeof AttemptRestartAuthorityReadFailedEvent.Type

interface ReplacementShape {
  readonly subject: AttemptChoiceSubject
  readonly successorPlan: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
  readonly witness: PlannedAttemptReplacementWitness
}

const replacementValidationRules = (event: ReplacementShape): ReadonlyArray<readonly [boolean, string]> => {
  const prior = event.subject.plannedAttempt
  const successor = event.successorPlan.plannedAttempt
  const oldWorktree = event.witness.oldWorktreeProof
  const requiredPredecessors = [
    event.witness.expectedClaim.operationId,
    event.witness.claimObservationOperationId,
    event.witness.graphObservationOperationId,
    event.witness.oldWorktreeObservationOperationId,
    event.witness.specificationObservationOperationId,
    event.witness.targetLineageObservationOperationId
  ]
  return [
    [
      [successor.runId === prior.runId, successor.taskId === prior.taskId].every(Boolean),
      "replacement successor must belong to the exact Run and task"
    ],
    [
      successor.taskRevision === event.subject.observedTaskRevision,
      "replacement successor must bind the exact observed task fingerprint"
    ],
    [
      successor.baseSha === event.witness.targetHeadSha,
      "replacement successor Base SHA must equal the recorded target head"
    ],
    [
      [
        successor.attemptId !== prior.attemptId,
        successor.branch !== prior.branch,
        successor.worktree !== prior.worktree
      ].every(Boolean),
      "replacement successor must use a distinct attempt, branch, and worktree"
    ],
    [
      [
        oldWorktree.baseSha === prior.baseSha,
        oldWorktree.branch === prior.branch,
        oldWorktree.worktree === prior.worktree
      ].every(Boolean),
      "replacement witness must prove the exact prior planned worktree ready"
    ],
    [event.witness.expectedClaim.taskId === prior.taskId, "replacement witness claim must belong to the exact task"],
    [
      requiredPredecessors.every((operationId) => event.successorPlan.predecessorOperationIds.includes(operationId)),
      "replacement successor plan must causally name the retained claim and every fresh authority witness"
    ]
  ]
}

const invalidReplacement = (event: ReplacementShape): string | undefined =>
  replacementValidationRules(event).find(([valid]) => !valid)?.[1]

/** One atomic journal fact supersedes exact P1 and records immutable P2. */
export const PlannedAttemptReplacedEvent = Schema.TaggedStruct("PlannedAttemptReplaced", {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  successorPlan: WorkflowOperation.cases.RecordTaskAttemptPlan,
  version: Schema.Literal(workflowJournalEventVersion),
  witness: PlannedAttemptReplacementWitness
}).check(Schema.makeFilter(invalidReplacement))
export type PlannedAttemptReplacedEvent = typeof PlannedAttemptReplacedEvent.Type
