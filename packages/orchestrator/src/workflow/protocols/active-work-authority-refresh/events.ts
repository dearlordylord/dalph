import { IntegrationTarget, PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Schema } from "effect"
import { GitTargetLineageReadFailure } from "../../../authorities/git/target-lineage.js"
import { GitWorktreeReadFailure } from "../../../authorities/git/worktree.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import type { WorkflowOperation } from "../../registry/operation.js"
import { ActiveWorkAuthorityRefreshAuthority, ActiveWorkAuthorityRefreshOrdinal } from "./intent.js"
export {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshOrdinal,
  ActiveWorkAuthorityRefreshGitReadPurpose
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

/** Exact branded task-worktree read payload owned by one active refresh authority. */
const ActiveWorktreeReadOperation = Schema.TaggedStruct("ReadTaskWorktree", {
  authority: ActiveWorkAuthorityRefreshAuthority,
  operationId: OperationId,
  ordinal: ActiveWorkAuthorityRefreshOrdinal,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(Schema.makeFilter(withoutSelfPredecessor))

/** Exact branded target-lineage read payload owned by one active refresh authority. */
const ActiveTargetLineageReadOperation = Schema.TaggedStruct("ReadTargetLineage", {
  authority: ActiveWorkAuthorityRefreshAuthority,
  integrationTarget: IntegrationTarget,
  operationId: OperationId,
  ordinal: ActiveWorkAuthorityRefreshOrdinal,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationIds: CausalPredecessorOperationIds
}).check(Schema.makeFilter(withoutSelfPredecessor))

/**
 * One exact active-refresh Git read, branded separately from ordinary Git
 * reads so history cannot mistake a refresh failure for a Restart failure.
 */
export const ActiveWorkAuthorityRefreshGitReadOperation = Schema.Union([
  ActiveWorktreeReadOperation,
  ActiveTargetLineageReadOperation
]).pipe(Schema.brand("ActiveWorkAuthorityRefreshGitReadOperation"))
export type ActiveWorkAuthorityRefreshGitReadOperation = typeof ActiveWorkAuthorityRefreshGitReadOperation.Type

type GitReadOperation = Extract<WorkflowOperation, { readonly _tag: "ReadTaskWorktree" | "ReadTargetLineage" }>

/**
 * Compares the branded operation carried by an active-refresh outcome with
 * the ordinary Git intent that was journaled before the provider call.
 * Authority and ordinal are deliberately checked by the outcome validator;
 * this helper compares the exact protocol-level read payload only.
 */
export const activeWorkAuthorityRefreshGitReadOperationMatchesIntent = (
  active: ActiveWorkAuthorityRefreshGitReadOperation,
  intent: GitReadOperation
): boolean => {
  const purpose = intent.purpose
  if (
    purpose?._tag !== "ActiveWorkAuthorityRefresh" ||
    purpose.authority.attemptId !== active.authority.attemptId ||
    purpose.authority.runId !== active.authority.runId ||
    purpose.authority.source !== active.authority.source ||
    purpose.ordinal !== active.ordinal
  ) {
    return false
  }
  if (active._tag !== intent._tag || active.operationId !== intent.operationId) return false
  if (!plannedTaskAttemptEquivalence(active.plannedAttempt, intent.plannedAttempt)) return false
  if (
    active.predecessorOperationIds.length !== intent.predecessorOperationIds.length ||
    !active.predecessorOperationIds.every((operationId, index) => operationId === intent.predecessorOperationIds[index])
  ) {
    return false
  }
  return active._tag === "ReadTargetLineage" && intent._tag === "ReadTargetLineage"
    ? active.integrationTarget.repository === intent.integrationTarget.repository &&
        active.integrationTarget.ref === intent.integrationTarget.ref
    : active._tag === "ReadTaskWorktree" && intent._tag === "ReadTaskWorktree"
}

/** Adds owner authority and ordinal to the exact journal-first Git operation. */
export const makeActiveWorkAuthorityRefreshGitReadOperation = (
  operation: GitReadOperation,
  authority: ActiveWorkAuthorityRefreshAuthority,
  ordinal: ActiveWorkAuthorityRefreshOrdinal
): ActiveWorkAuthorityRefreshGitReadOperation => {
  if (operation._tag === "ReadTaskWorktree") {
    const { purpose: _purpose, ...baseOperation } = operation
    return ActiveWorkAuthorityRefreshGitReadOperation.make(
      ActiveWorktreeReadOperation.make({ ...baseOperation, authority, ordinal })
    )
  }
  const { purpose: _purpose, ...baseOperation } = operation
  return ActiveWorkAuthorityRefreshGitReadOperation.make(
    ActiveTargetLineageReadOperation.make({ ...baseOperation, authority, ordinal })
  )
}

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
    version: Schema.Literal(workflowJournalEventVersion)
  }
).check(
  Schema.makeFilter((event) => {
    if (
      event.operation.authority.attemptId !== event.authority.attemptId ||
      event.operation.authority.runId !== event.authority.runId ||
      event.operation.authority.source !== event.authority.source ||
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
