import { GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
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
      "replacement successor plan must causally name every fresh authority witness"
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
