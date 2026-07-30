import { Context, Effect, Layer, Schema } from "effect"
import { AttemptId, type PlannedTaskAttempt } from "@dalph/contracts"
import { GitWorktree } from "../../authorities/git/worktree.js"
import { type JournalRecord, JournalStore, type JournalStoreError } from "../../workflow-journal/store.js"
import { type WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { isExactTaskClaim, TrackerMutation } from "../../authorities/task-tracker/claim-mutation.js"
import { type WorkflowOperation, workflowOperationId } from "../../workflow/registry/operation.js"
import { observeTaskClaim } from "../../workflow/protocols/task-claim-observation/protocol.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"

/** A recovered attempt no longer has the exact tracker/Git facts that authorized it. */
export class PlannedAttemptRecoveryAuthorityMismatch extends Schema.TaggedErrorClass<PlannedAttemptRecoveryAuthorityMismatch>()(
  "PlannedAttemptRecoveryAuthorityMismatch",
  { attemptId: AttemptId, boundary: Schema.Literals(["Git", "TaskTracker"]), detail: Schema.String }
) {}

/** A recovery boundary could not currently provide authoritative evidence. */
export class PlannedAttemptRecoveryAuthorityUnreadable extends Schema.TaggedErrorClass<PlannedAttemptRecoveryAuthorityUnreadable>()(
  "PlannedAttemptRecoveryAuthorityUnreadable",
  { attemptId: AttemptId, boundary: Schema.Literals(["Git", "TaskTracker"]), detail: Schema.String }
) {}

export type PlannedAttemptRecoveryAuthorityError =
  | JournalStoreError
  | PlannedAttemptRecoveryAuthorityMismatch
  | PlannedAttemptRecoveryAuthorityUnreadable

interface PlannedAttemptRecoveryAuthorityService {
  readonly verify: (plannedAttempt: PlannedTaskAttempt) => Effect.Effect<void, PlannedAttemptRecoveryAuthorityError>
}

const journaledOperation = (event: WorkflowJournalEvent): WorkflowOperation | undefined =>
  "operation" in event ? event.operation : undefined

/** Finds every operation that causally precedes an operation in durable history. */
const causalPredecessorClosure = (
  operation: WorkflowOperation,
  operations: ReadonlyMap<ReturnType<typeof workflowOperationId>, WorkflowOperation>
): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
  const visit = (
    pending: ReadonlyArray<ReturnType<typeof workflowOperationId>>,
    reachable: ReadonlySet<ReturnType<typeof workflowOperationId>>
  ): ReadonlySet<ReturnType<typeof workflowOperationId>> => {
    const [operationId, ...remaining] = pending
    if (operationId === undefined) return reachable
    /* v8 ignore next -- @preserve A canonical predecessor graph normally visits each operation once; this closes defensive cycles. */
    if (reachable.has(operationId)) return visit(remaining, reachable)
    const predecessor = operations.get(operationId)
    return visit([...remaining, ...(predecessor?.predecessorOperationIds ?? [])], new Set([...reachable, operationId]))
  }
  return visit(operation.predecessorOperationIds, new Set())
}

/** Finds the exact acquired claim in one planned attempt's causal history. */
export const causalClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  attemptId: AttemptId
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const plan = records.find(
    ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === attemptId
  )?.event
  if (plan?._tag !== "TaskAttemptPlanned") return undefined
  const operations = new Map(
    records.flatMap(({ event }) => {
      const operation = journaledOperation(event)
      return operation === undefined ? [] : [[workflowOperationId(operation), operation] as const]
    })
  )
  const causalOperationIds = causalPredecessorClosure(plan.operation, operations)
  const claim = records.find(
    ({ event }) => event._tag === "TaskClaimAcquired" && causalOperationIds.has(event.claim.operationId)
  )?.event
  return claim?._tag === "TaskClaimAcquired" ? claim : undefined
}

/**
 * Finds the original planned claim or the latest replacement authorized by an
 * authenticated reacquisition command and its exact durable intent.
 */
export const authorizedClaimForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const replacement = records.findLast(({ event, position: outcomePosition }) => {
    if (event._tag !== "TaskClaimAcquired" || event.claim.taskId !== plannedAttempt.taskId) return false
    const intent = records.findLast(
      ({ event: candidate, position: intentPosition }) =>
        intentPosition < outcomePosition &&
        candidate._tag === "TaskClaimAcquisitionIntended" &&
        candidate.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
        candidate.operation.acquisition.operationId === event.claim.operationId &&
        candidate.operation.acquisition.owner === event.claim.owner &&
        candidate.operation.acquisition.taskId === event.claim.taskId &&
        candidate.operation.acquisition.token === event.claim.token
    )
    if (intent?.event._tag !== "TaskClaimAcquisitionIntended") return false
    const intentEvent = intent.event
    /* v8 ignore next -- @preserve The selecting predicate above already narrows this exact authority variant. */
    if (intentEvent.operation.authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return false
    const commandId = intentEvent.operation.authority.commandId
    const command = records.findLast(
      ({ event: candidate, position: commandPosition }) =>
        commandPosition < intent.position &&
        candidate._tag === "ControlCommandRecorded" &&
        candidate.command._tag === "RequestTaskClaimReacquisition" &&
        candidate.command.runId === plannedAttempt.runId &&
        candidate.command.taskId === plannedAttempt.taskId &&
        candidate.command.commandId === commandId &&
        taskClaimReacquisitionOperationId(candidate.command.commandId) === event.claim.operationId
    )
    return command?.event._tag === "ControlCommandRecorded"
  })?.event
  return replacement?._tag === "TaskClaimAcquired"
    ? replacement
    : causalClaimForAttempt(records, plannedAttempt.attemptId)
}

/** Rereads the tracker claim and Git worktree before recovered executor work continues. */
export class PlannedAttemptRecoveryAuthority extends Context.Service<
  PlannedAttemptRecoveryAuthority,
  PlannedAttemptRecoveryAuthorityService
>()("@dalph/PlannedAttemptRecoveryAuthority") {}

export const livePlannedAttemptRecoveryAuthorityLayer = Layer.effect(
  PlannedAttemptRecoveryAuthority,
  Effect.gen(function* () {
    const git = yield* GitWorktree
    const journal = yield* JournalStore
    const tracker = yield* TrackerMutation
    const verifyTrackerClaim = Effect.fn("PlannedAttemptRecoveryAuthority.verifyTrackerClaim")(function* (
      plannedAttempt: PlannedTaskAttempt,
      claim: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>
    ) {
      const observedClaim = yield* observeTaskClaim(tracker, plannedAttempt.taskId).pipe(
        Effect.mapError(
          (error) =>
            new PlannedAttemptRecoveryAuthorityUnreadable({
              attemptId: plannedAttempt.attemptId,
              boundary: "TaskTracker",
              detail: error.detail
            })
        )
      )
      if (observedClaim._tag !== "ActiveTaskClaim" || !isExactTaskClaim(observedClaim, claim.claim)) {
        return yield* new PlannedAttemptRecoveryAuthorityMismatch({
          attemptId: plannedAttempt.attemptId,
          boundary: "TaskTracker",
          detail: "the current tracker claim differs from durable history"
        })
      }
    })
    const verifyGitWorktree = Effect.fn("PlannedAttemptRecoveryAuthority.verifyGitWorktree")(function* (
      plannedAttempt: PlannedTaskAttempt
    ) {
      const worktree = yield* git
        .readPlannedWorktree(plannedAttempt)
        .pipe(
          Effect.mapError(
            (error) =>
              new PlannedAttemptRecoveryAuthorityUnreadable({
                attemptId: plannedAttempt.attemptId,
                boundary: "Git",
                detail: error._tag
              })
          )
        )
      if (
        worktree._tag !== "PlannedWorktreeReady" ||
        worktree.baseSha !== plannedAttempt.baseSha ||
        worktree.branch !== plannedAttempt.branch ||
        worktree.worktree !== plannedAttempt.worktree
      ) {
        return yield* new PlannedAttemptRecoveryAuthorityMismatch({
          attemptId: plannedAttempt.attemptId,
          boundary: "Git",
          detail: "the exact planned worktree is not ready"
        })
      }
    })
    return PlannedAttemptRecoveryAuthority.of({
      verify: Effect.fn("PlannedAttemptRecoveryAuthority.verify")(function* (plannedAttempt) {
        const records = yield* journal.read(plannedAttempt.runId)
        const claim = authorizedClaimForAttempt(records, plannedAttempt)
        if (claim === undefined) {
          return yield* new PlannedAttemptRecoveryAuthorityMismatch({
            attemptId: plannedAttempt.attemptId,
            boundary: "TaskTracker",
            detail: "no causal acquired task claim exists"
          })
        }
        yield* verifyTrackerClaim(plannedAttempt, claim)
        yield* verifyGitWorktree(plannedAttempt)
      })
    })
  })
)

/** Unit scenarios may state that their already-constructed boundary facts are trusted. */
export const trustedPlannedAttemptRecoveryAuthorityLayer = Layer.succeed(
  PlannedAttemptRecoveryAuthority,
  PlannedAttemptRecoveryAuthority.of({ verify: () => Effect.void })
)
