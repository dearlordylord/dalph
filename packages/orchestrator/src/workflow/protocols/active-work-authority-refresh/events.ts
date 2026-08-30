import { IntegrationTarget, PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Schema } from "effect"
import { GitTargetLineageReadFailure } from "../../../authorities/git/target-lineage.js"
import { GitWorktreeReadFailure } from "../../../authorities/git/worktree.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { WorkflowOperation, type WorkflowOperation as WorkflowOperationType } from "../../registry/operation.js"
import {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshOrdinal,
  ActiveWorkAuthorityRefreshSource
} from "./intent.js"
import { WorkflowActor } from "../../registry/actor.js"
export {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshOrdinal,
  ActiveWorkAuthorityRefreshSource
} from "./intent.js"

const CausalPredecessorOperationIds = Schema.Array(OperationId).check(Schema.isUnique())

const withoutSelfPredecessor = <
  A extends { readonly operationId: OperationId; readonly predecessorOperationIds: ReadonlyArray<OperationId> }
>(
  operation: A
) =>
  operation.predecessorOperationIds.includes(operation.operationId)
    ? { issue: "an operation cannot causally precede itself", path: ["predecessorOperationIds"] }
    : undefined

const activeReadBindsPlannedAttempt = <
  A extends { readonly authority: ActiveWorkAuthorityRefreshAuthority; readonly plannedAttempt: PlannedTaskAttempt }
>(
  operation: A
) =>
  operation.authority.attemptId === operation.plannedAttempt.attemptId &&
  operation.authority.runId === operation.plannedAttempt.runId
    ? undefined
    : { issue: "an active-refresh Git intent must bind its exact planned attempt", path: ["authority"] }

/** Exact branded task-worktree read payload owned by one active refresh authority. */
const ActiveWorktreeReadOperation = Schema.TaggedStruct("ReadTaskWorktree", {
  authority: ActiveWorkAuthorityRefreshAuthority,
  operationId: OperationId,
  ordinal: ActiveWorkAuthorityRefreshOrdinal,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(
  Schema.makeFilter((operation) => withoutSelfPredecessor(operation) ?? activeReadBindsPlannedAttempt(operation))
)

/** Exact branded target-lineage read payload owned by one active refresh authority. */
const ActiveTargetLineageReadOperation = Schema.TaggedStruct("ReadTargetLineage", {
  authority: ActiveWorkAuthorityRefreshAuthority,
  integrationTarget: IntegrationTarget,
  operationId: OperationId,
  ordinal: ActiveWorkAuthorityRefreshOrdinal,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(
  Schema.makeFilter((operation) => withoutSelfPredecessor(operation) ?? activeReadBindsPlannedAttempt(operation))
)

/**
 * One exact active-refresh Git read, branded separately from ordinary Git
 * reads so history cannot mistake a refresh failure for a Restart failure.
 */
export const ActiveWorkAuthorityRefreshGitReadOperation = Schema.Union([
  ActiveWorktreeReadOperation,
  ActiveTargetLineageReadOperation
]).pipe(Schema.brand("ActiveWorkAuthorityRefreshGitReadOperation"))
export type ActiveWorkAuthorityRefreshGitReadOperation = typeof ActiveWorkAuthorityRefreshGitReadOperation.Type

export type GitReadOperation = Extract<
  WorkflowOperationType,
  { readonly _tag: "ReadTaskWorktree" | "ReadTargetLineage" }
>

/** Converts an active protocol read to its ordinary Git boundary payload. */
export const ordinaryGitReadOperationFor = (
  operation: ActiveWorkAuthorityRefreshGitReadOperation
): GitReadOperation => {
  if (operation._tag === "ReadTaskWorktree") {
    const { authority: _authority, ordinal: _ordinal, ...ordinary } = operation
    return WorkflowOperation.cases.ReadTaskWorktree.make(ordinary)
  }
  const { authority: _authority, ordinal: _ordinal, ...ordinary } = operation
  return WorkflowOperation.cases.ReadTargetLineage.make(ordinary)
}

/**
 * Compares the branded operation carried by an active-refresh outcome with
 * the exact active intent that was journaled before the provider call.
 * Authority and ordinal are checked here as well as by the outcome validator
 * so replay cannot silently pair a failure with another active read.
 */
export const activeWorkAuthorityRefreshGitReadOperationMatchesIntent = (
  active: ActiveWorkAuthorityRefreshGitReadOperation,
  intent: ActiveWorkAuthorityRefreshGitReadOperation
): boolean => {
  if (
    intent.authority.attemptId !== active.authority.attemptId ||
    intent.authority.runId !== active.authority.runId ||
    intent.ordinal !== active.ordinal
  )
    return false
  return sameGitReadOperation(ordinaryGitReadOperationFor(active), ordinaryGitReadOperationFor(intent))
}

const sameGitReadOperation = (left: GitReadOperation, right: GitReadOperation): boolean => {
  if (left._tag !== right._tag || left.operationId !== right.operationId) return false
  if (!plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt)) return false
  if (
    left.predecessorOperationIds.length !== right.predecessorOperationIds.length ||
    !left.predecessorOperationIds.every((operationId, index) => operationId === right.predecessorOperationIds[index])
  ) {
    return false
  }
  return left._tag === "ReadTargetLineage" && right._tag === "ReadTargetLineage"
    ? left.integrationTarget.repository === right.integrationTarget.repository &&
        left.integrationTarget.ref === right.integrationTarget.ref
    : left._tag === "ReadTaskWorktree" && right._tag === "ReadTaskWorktree"
}

/** Compares an active failure's exact Git subject with its projected boundary read. */
export const activeWorkAuthorityRefreshGitReadOperationMatchesBoundary = (
  active: ActiveWorkAuthorityRefreshGitReadOperation,
  ordinary: GitReadOperation
): boolean => sameGitReadOperation(ordinaryGitReadOperationFor(active), ordinary)

/** Adds owner authority and ordinal to the exact journal-first Git operation. */
export const makeActiveWorkAuthorityRefreshGitReadOperation = (
  operation: GitReadOperation,
  authority: ActiveWorkAuthorityRefreshAuthority,
  ordinal: ActiveWorkAuthorityRefreshOrdinal
): ActiveWorkAuthorityRefreshGitReadOperation => {
  if (operation._tag === "ReadTaskWorktree") {
    return ActiveWorkAuthorityRefreshGitReadOperation.make(
      ActiveWorktreeReadOperation.make({ ...operation, authority, ordinal })
    )
  }
  return ActiveWorkAuthorityRefreshGitReadOperation.make(
    ActiveTargetLineageReadOperation.make({ ...operation, authority, ordinal })
  )
}

/** Dalph durably begins one exact active-refresh Git read before calling Git. */
export const ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent = Schema.TaggedStruct(
  "ActiveWorkAuthorityRefreshGitReadIntentRecorded",
  {
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    operation: ActiveWorkAuthorityRefreshGitReadOperation,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent =
  typeof ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.Type

export const ActiveWorkAuthorityRefreshGitReadFailure = Schema.Union([
  GitWorktreeReadFailure,
  GitTargetLineageReadFailure
])
export type ActiveWorkAuthorityRefreshGitReadFailure = typeof ActiveWorkAuthorityRefreshGitReadFailure.Type

/**
 * A Git worktree or target-lineage read failed while an owner refreshed a
 * Running attempt. This is a non-action occurrence: no executor command or
 * suspension follows it, and the held work position remains unchanged.
 */
export const ActiveWorkAuthorityRefreshGitReadFailedEvent = Schema.TaggedStruct(
  "ActiveWorkAuthorityRefreshGitReadFailed",
  {
    authority: ActiveWorkAuthorityRefreshAuthority,
    failure: ActiveWorkAuthorityRefreshGitReadFailure,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    operation: ActiveWorkAuthorityRefreshGitReadOperation,
    ordinal: ActiveWorkAuthorityRefreshOrdinal,
    source: ActiveWorkAuthorityRefreshSource,
    version: Schema.Literal(workflowJournalEventVersion)
  }
).check(
  Schema.makeFilter((event) => {
    if (
      event.operation.authority.attemptId !== event.authority.attemptId ||
      event.operation.authority.runId !== event.authority.runId ||
      event.operation.ordinal !== event.ordinal ||
      event.operation.plannedAttempt.attemptId !== event.authority.attemptId ||
      event.operation.plannedAttempt.runId !== event.authority.runId
    ) {
      return "active-refresh Git failure must bind one exact attempt, authority, and ordinal"
    }
    if (event.operation._tag === "ReadTaskWorktree") {
      return event.failure._tag === "GitWorktreeReadFailure" &&
        event.failure.worktree === event.operation.plannedAttempt.worktree
        ? undefined
        : "active-refresh worktree failure must name the exact planned worktree"
    }
    return event.failure._tag === "GitTargetLineageReadFailure" &&
      event.failure.plannedBaseSha === event.operation.plannedAttempt.baseSha &&
      event.failure.target.repository === event.operation.integrationTarget.repository &&
      event.failure.target.ref === event.operation.integrationTarget.ref
      ? undefined
      : "active-refresh target-lineage failure must name the exact target and planned Base SHA"
  })
)
export type ActiveWorkAuthorityRefreshGitReadFailedEvent = typeof ActiveWorkAuthorityRefreshGitReadFailedEvent.Type
