/* eslint-disable max-lines -- One gated event loop owns admission, evaluations, completion publication, and quiescence. */
import { RunId } from "@dalph/contracts"
import { Cause, Context, Deferred, Effect, Exit, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect"
import {
  OperationIdAllocator,
  type PlannedTaskAttemptError,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalAppendFailureDisposition } from "../../workflow-journal/store.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionExecutionError,
  DeliverySemanticTrace,
  type DeliveryActionResult,
  type DeliverySemanticTraceEvent
} from "./delivery-action-executor.js"
import { DeliveryProposalId, type DeliveryActionProposal } from "./delivery-action-proposal.js"
import { deliveryProposalOfAcceptedFreshTask } from "./delivery-proposal.js"
import {
  type DeliveryAdmissionRollbackDisposition,
  type DeliveryAdmissionReservation
} from "./delivery-runtime-admission.js"
import { materializeDeliveryAction, materializedOperationId } from "./delivery-action-materialization.js"
import {
  makeDeliveryRuntimeAdmissionLoop,
  DeliveryRuntimeProposalOwnershipConflict
} from "./delivery-runtime-admission-loop.js"
import { runDeliveryRuntimeAdmissionSweep } from "./delivery-runtime-admission-sweep.js"
import type { DeliveryRuntimeAdmissionProgressContradiction } from "./delivery-runtime-admission-sweep.js"
import {
  attachCurrentSignal,
  freshTaskCandidateObservationOf,
  type CurrentSignal,
  type DeliveryRuntimeEvaluation
} from "./relations.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"
import * as RuntimeObservation from "./delivery-runtime-observation.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { installInterruptibleDeliveryChild } from "./delivery-child-handoff.js"
import { liveActionIsPresent, proposalIsPresent, proposalsForLiveAction } from "./live-delivery-action.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import {
  DeliveryRuntimePhase,
  evaluationForPhase,
  type DeliveryRuntimePhase as DeliveryRuntimePhaseType
} from "./delivery-runtime-phase.js"
import {
  classifyTaskWorkAdmissionStalledRuntimeQuiescence,
  type AvailableProposalFrontier,
  type DeliveryRuntimeQuiescence,
  type EmptyProposalFrontier
} from "./delivery-runtime-quiescence.js"
import {
  deliveryRuntimeLocalDeferralAfter,
  deliveryRuntimeLocalDeferralAppliesAt,
  type DeliveryRuntimeLocalDeferral
} from "./delivery-runtime-local-deferral.js"
import { reconcileDeliveryRuntimeLocalDeferrals } from "./delivery-runtime-local-deferral-reconciliation.js"
import {
  DeliveryAcceptedFactPublication,
  type DeliveryAcceptedPublicationBoundary
} from "./delivery-accepted-fact-publication.js"
import type { FreshTaskCandidateFrontier } from "./fresh-task-candidate.js"

export { DeliveryRuntimeProposalOwnershipConflict } from "./delivery-runtime-admission-loop.js"
export { DeliveryRuntimeAdmissionProgressContradiction } from "./delivery-runtime-admission-sweep.js"
export * from "./delivery-runtime-phase.js"
export type { DeliveryRuntimeQuiescence } from "./delivery-runtime-quiescence.js"

/** Reconfirmation was allowed without one exact accepted established graph, so G2 cannot be ordered after G1. */
export class DeliveryRuntimeReconfirmationStateInvalid extends Schema.TaggedError<DeliveryRuntimeReconfirmationStateInvalid>()(
  "DeliveryRuntimeReconfirmationStateInvalid",
  {
    acceptedAt: Schema.NullOr(JournalPosition),
    graphState: Schema.Literals(["GraphEstablished", "GraphNotEstablished"])
  }
) {}

/** One coherent runtime evaluation carries authority for a different Run. */
export class DeliveryRuntimeRunMismatch extends Schema.TaggedError<DeliveryRuntimeRunMismatch>()(
  "DeliveryRuntimeRunMismatch",
  { actualRunIds: Schema.Array(RunId), expectedRunId: RunId }
) {}

/** A completion proof names a different Run, owner, or result, so no live action may settle from it. */
export class DeliveryActionCompletionPublicationMismatch extends Schema.TaggedError<DeliveryActionCompletionPublicationMismatch>()(
  "DeliveryActionCompletionPublicationMismatch",
  {
    expectedProposalId: DeliveryProposalId,
    expectedRunId: RunId,
    publicationRunId: RunId,
    resultProposalId: DeliveryProposalId
  }
) {}

type LiveOwner = RuntimeObservation.DeliveryRuntimeLiveOwnerSource

interface PublishedDeliveryActionResult {
  readonly publicationThrough: DeliveryAcceptedPublicationBoundary
  readonly result: DeliveryActionResult
}

interface Completion {
  readonly acknowledged: Deferred.Deferred<void>
  readonly exit: Exit.Exit<PublishedDeliveryActionResult, DeliveryActionExecutionError | PlannedTaskAttemptError>
  readonly proposalId: DeliveryProposalId
}

type RuntimeEvent<E> =
  | { readonly _tag: "ActionCompleted"; readonly completion: Completion }
  | { readonly _tag: "EvaluationChanged"; readonly evaluation: DeliveryRuntimeEvaluation }
  | { readonly _tag: "RelationFailed"; readonly cause: Cause.Cause<E> }

/**
 * The runtime consumes one coherent current-first evaluation signal. Authority
 * facts may remove a proposal before its admitted interpreter has returned;
 * live ownership remains process-local until that exact action settles.
 */
export type DeliveryRuntimeInput<E = never> = CurrentSignal<DeliveryRuntimeEvaluation, E>

const runtimeEvaluationRunIds = (evaluation: DeliveryRuntimeEvaluation): ReadonlyArray<RunId> => {
  const frontierRunIds =
    evaluation.proposedActions._tag === "DeliveryProposalsAvailable" &&
    evaluation.proposedActions.freshTaskCandidateFrontier !== undefined
      ? [
          evaluation.proposedActions.freshTaskCandidateFrontier.runId,
          ...evaluation.proposedActions.freshTaskCandidateFrontier.candidates.map(({ runId }) => runId)
        ]
      : []
  return [
    evaluation.runId,
    evaluation.taskWork.runId,
    ...(evaluation.current.runId === undefined ? [] : [evaluation.current.runId]),
    ...frontierRunIds
  ]
}

const validateRuntimeEvaluationRun = (
  expectedRunId: RunId,
  evaluation: DeliveryRuntimeEvaluation
): Effect.Effect<void, DeliveryRuntimeRunMismatch> => {
  const actualRunIds = [...new Set(runtimeEvaluationRunIds(evaluation).filter((runId) => runId !== expectedRunId))]
  return actualRunIds.length === 0
    ? Effect.void
    : Effect.fail(new DeliveryRuntimeRunMismatch({ actualRunIds, expectedRunId }))
}

/**
 * The sole runtime-coloured consumer of the descriptive delivery relation.
 * It owns subscriptions, admission, live actions, completion, and quiescence.
 * Its required Run identity comes from the activation, not the optional
 * reconstructed snapshot carried by an evaluation.
 *
 * The executable fresh-task-admission model covers bounded entry, durable
 * commitment, and exact handoff through the production admission seams used
 * by this loop. Other loop concerns — pause, quiescence, integration resource
 * ownership, and the complete live-owner lifecycle — remain governed by their
 * focused models and production tests rather than one whole-loop model.
 */
export const runDeliveryRuntimePhase = Effect.fn("DeliveryRuntime.runPhase")(function* <E>(
  expectedRunId: RunId,
  relation: DeliveryRuntimeInput<E>,
  phase: DeliveryRuntimePhaseType = DeliveryRuntimePhase.Ordinary
): Effect.fn.Return<
  DeliveryRuntimeQuiescence,
  | E
  | ApplicationExiting
  | DeliveryActionCompletionPublicationMismatch
  | DeliveryActionExecutionError
  | DeliveryRuntimeAdmissionProgressContradiction
  | DeliveryRuntimeProposalOwnershipConflict
  | DeliveryRuntimeReconfirmationStateInvalid
  | DeliveryRuntimeRunMismatch
  | PlannedTaskAttemptError,
  | DeliveryActionExecutor
  | DeliveryAcceptedFactPublication
  | RuntimeObservation.DeliveryRuntimeObservationPublication
  | DeliveryRuntimeResources
  | OperationIdAllocator
  | PlannedAttemptProtocolController
  | PlannedTaskAttemptPlanner
> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const executor = yield* DeliveryActionExecutor
      const acceptedFactPublication = yield* DeliveryAcceptedFactPublication
      const resources = yield* DeliveryRuntimeResources
      const runtimeObservation = yield* RuntimeObservation.DeliveryRuntimeObservationPublication
      const operationAllocator = yield* OperationIdAllocator
      const attemptPlanner = yield* PlannedTaskAttemptPlanner
      const ambient = yield* Effect.context<never>()
      const semanticTrace = Context.getOption(ambient, DeliverySemanticTrace)
      const emit = (event: DeliverySemanticTraceEvent) =>
        Option.match(semanticTrace, { onNone: () => Effect.void, onSome: ({ emit }) => emit(event) })
      const events = yield* Queue.unbounded<RuntimeEvent<E>>()
      const owners = yield* Ref.make<ReadonlyMap<DeliveryProposalId, LiveOwner>>(new Map())
      const localDeferrals = yield* Ref.make<ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>>(new Map())
      const pendingCompletions = yield* Ref.make<ReadonlyMap<DeliveryProposalId, Completion>>(new Map())
      const latest = yield* Ref.make<Option.Option<DeliveryRuntimeEvaluation>>(Option.none())
      const selectionGate = yield* Semaphore.make(1)
      const integrationTargets = resources.integrationTargets
      const attachment = yield* attachCurrentSignal(relation)
      yield* validateRuntimeEvaluationRun(expectedRunId, attachment.current)
      const first = evaluationForPhase(phase, attachment.current)
      yield* Ref.set(latest, Option.some(first))
      yield* runtimeObservation.publish(first, [])
      const admission = yield* resources.makeAdmissionController(first.taskWork)
      yield* admission.synchronize(first.taskWork, freshTaskCandidateObservationOf(first.proposedActions))
      const evaluationsSubscribed = yield* Deferred.make<void>()

      yield* Stream.concat(
        Stream.fromEffect(Deferred.succeed(evaluationsSubscribed, undefined)).pipe(Stream.drain),
        attachment.changes
      ).pipe(
        Stream.runForEach((evaluation) => Queue.offer(events, { _tag: "EvaluationChanged", evaluation })),
        Effect.catchCause((cause) => Queue.offer(events, { _tag: "RelationFailed", cause })),
        Effect.forkIn(scope)
      )
      yield* Deferred.await(evaluationsSubscribed)

      const publishRuntimeObservationInsideGate = Effect.fn("DeliveryRuntime.publishObservationInsideGate")(
        function* () {
          const evaluation = Option.getOrThrow(yield* Ref.get(latest))
          yield* runtimeObservation.publish(
            evaluation,
            yield* RuntimeObservation.deliveryRuntimeLiveOwnerSnapshots(yield* Ref.get(owners))
          )
        }
      )
      const publishRuntimeObservation = Effect.fn("DeliveryRuntime.publishObservation")(() =>
        selectionGate.withPermit(publishRuntimeObservationInsideGate())
      )

      const journalAppendMayHaveAccepted = (cause: Cause.Cause<unknown>): boolean =>
        Option.match(Cause.findErrorOption(cause), {
          onNone: () => false,
          // A typed MayHaveCommitted result retains admission. Any non-journal
          // failure can only occur after the intent callback has marked the
          // owner, so `intentRecorded` below remains the primary proof.
          onSome: (failure) => journalAppendFailureDisposition(failure) === "MayHaveCommitted"
        })

      const rollbackDispositionAfterClaim = (
        intentRecorded: boolean,
        failureCause: Cause.Cause<unknown> | undefined
      ): DeliveryAdmissionRollbackDisposition =>
        intentRecorded || (failureCause !== undefined && journalAppendMayHaveAccepted(failureCause))
          ? "AfterDurableClaimIntentOrAmbiguity"
          : "BeforeDurableClaimIntent"

      const rollbackDispositionFor = (
        reservation: DeliveryAdmissionReservation,
        intentRecorded: boolean,
        failureCause?: Cause.Cause<unknown>
      ): DeliveryAdmissionRollbackDisposition => {
        const candidateStep = reservation.freshTaskCandidate?.decision.step._tag
        if (candidateStep === "ReadCurrentTaskGraph") return "BeforeDurableClaimIntent"
        if (candidateStep === "AcquireTaskClaim") return rollbackDispositionAfterClaim(intentRecorded, failureCause)
        return intentRecorded ? "AfterDurableClaimIntentOrAmbiguity" : "BeforeDurableClaimIntent"
      }

      yield* publishRuntimeObservation()

      const start = Effect.fn("DeliveryRuntime.startProposal")(function* (reservation: DeliveryAdmissionReservation) {
        const proposal = reservation.proposal
        const owner = yield* RuntimeObservation.makeDeliveryRuntimeLiveOwner(reservation)
        yield* Ref.update(owners, (current) => new Map(current).set(proposal.id, owner))
        yield* publishRuntimeObservationInsideGate()
        yield* emit({ _tag: "ProposalAdmitted", proposalId: proposal.id })
        const run = Effect.gen(function* () {
          const action = yield* materializeDeliveryAction(proposal).pipe(
            Effect.provideService(OperationIdAllocator, operationAllocator),
            Effect.provideService(PlannedTaskAttemptPlanner, attemptPlanner)
          )
          const operationId = materializedOperationId(action)
          if (operationId !== null) {
            yield* selectionGate.withPermit(
              Effect.gen(function* () {
                if (reservation.freshTaskCandidate?.decision.step._tag === "AcquireTaskClaim") {
                  yield* admission.bindFreshTaskClaimOperation(reservation, operationId)
                }
                yield* owner.materialize(operationId)
                yield* publishRuntimeObservationInsideGate()
              })
            )
          } else {
            yield* publishRuntimeObservation()
          }
          return yield* executor.execute(
            action,
            RuntimeObservation.makeObservedDeliveryActionLease(
              admission,
              integrationTargets,
              owner,
              publishRuntimeObservation()
            )
          )
        })
        const releaseInterruptedOwner = selectionGate.withPermit(
          owner.isSettled.pipe(
            Effect.flatMap((isSettled) =>
              isSettled
                ? Effect.void
                : owner.intentRecorded.pipe(
                    Effect.flatMap((intentRecorded) =>
                      admission.rollback(reservation, rollbackDispositionFor(reservation, intentRecorded))
                    ),
                    Effect.andThen(
                      Ref.update(owners, (current) => new Map([...current].filter(([id]) => id !== proposal.id)))
                    ),
                    Effect.andThen(publishRuntimeObservationInsideGate())
                  )
            )
          )
        )
        const child = Effect.gen(function* () {
          const exit = yield* Effect.exit(
            run.pipe(
              Effect.flatMap((result) =>
                acceptedFactPublication.awaitCurrent.pipe(
                  Effect.map((publicationThrough) => ({ publicationThrough, result }))
                )
              )
            )
          )
          const acknowledged = yield* Deferred.make<void>()
          yield* Queue.offer(events, {
            _tag: "ActionCompleted",
            completion: { acknowledged, exit, proposalId: proposal.id }
          })
          yield* Deferred.await(acknowledged)
        })
        return yield* installInterruptibleDeliveryChild(scope, child, releaseInterruptedOwner)
      })

      const reserveAndStart = Effect.fn("DeliveryRuntime.reserveAndStart")((proposal: DeliveryActionProposal) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const result = yield* admission.tryReserve(proposal)
            if (result._tag === "Deferred") return result
            const started = yield* start(result.reservation)
            return { _tag: "Started" as const, started }
          })
        )
      )

      const reserveFreshAndStart = Effect.fn("DeliveryRuntime.reserveFreshAndStart")(
        (frontier: FreshTaskCandidateFrontier) =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              const result = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
              if (result._tag === "Deferred") return result
              const started = yield* start(result.reservation)
              return { _tag: "Started" as const, started }
            })
          )
      )

      const admissionLoop = yield* makeDeliveryRuntimeAdmissionLoop({
        admission,
        localDeferrals,
        emit,
        latest,
        owners,
        publishRuntimeObservationInsideGate,
        reserveAndStart,
        reserveFreshAndStart,
        selectionGate
      })

      const applyEvaluation = Effect.fn("DeliveryRuntime.applyEvaluation")(function* (
        evaluation: DeliveryRuntimeEvaluation
      ) {
        yield* validateRuntimeEvaluationRun(expectedRunId, evaluation)
        const phaseEvaluation = evaluationForPhase(phase, evaluation)
        yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            // Relation refreshes can be queued behind a newer journal publication while an action is settling.
            // Never let that older frontier resurrect an already-observed operation or its stale proposal.
            if (
              current.acceptedAt !== null &&
              (phaseEvaluation.acceptedAt === null || phaseEvaluation.acceptedAt < current.acceptedAt)
            ) {
              return
            }
            yield* Ref.set(latest, Option.some(phaseEvaluation))
            yield* Ref.update(localDeferrals, (current) =>
              reconcileDeliveryRuntimeLocalDeferrals(
                current,
                phaseEvaluation.proposedActions,
                phaseEvaluation.acceptedAt
              )
            )
            yield* admission.synchronize(
              phaseEvaluation.taskWork,
              freshTaskCandidateObservationOf(phaseEvaluation.proposedActions)
            )
            yield* admissionLoop.pruneSettledOwners(phaseEvaluation.proposedActions)
            yield* publishRuntimeObservationInsideGate()
          })
        )
      })

      const validatePublishedCompletion = Effect.fn("DeliveryRuntime.validatePublishedCompletion")(function* (
        completion: Completion,
        published: PublishedDeliveryActionResult
      ) {
        if (
          expectedRunId !== published.publicationThrough.runId ||
          completion.proposalId !== published.result.proposalId
        ) {
          return yield* new DeliveryActionCompletionPublicationMismatch({
            expectedProposalId: completion.proposalId,
            expectedRunId,
            publicationRunId: published.publicationThrough.runId,
            resultProposalId: published.result.proposalId
          })
        }
      })

      const successfulCompletionMustRemainPending = (
        current: DeliveryRuntimeEvaluation,
        completion: Completion,
        published: PublishedDeliveryActionResult,
        localDeferral: Option.Option<DeliveryRuntimeLocalDeferral>
      ): boolean =>
        current.acceptedAt === null ||
        current.acceptedAt < published.publicationThrough.acceptedThrough ||
        (Option.isNone(localDeferral) && proposalIsPresent(current.proposedActions, completion.proposalId))

      const retainPendingCompletion = Effect.fn("DeliveryRuntime.retainPendingCompletion")(function* (
        completion: Completion,
        published: PublishedDeliveryActionResult
      ) {
        const pending = yield* Ref.get(pendingCompletions)
        yield* Ref.set(pendingCompletions, new Map(pending).set(completion.proposalId, completion))
        if (!pending.has(completion.proposalId)) {
          yield* emit({
            _tag: "ActionCompletionPublicationPending",
            acceptedThrough: published.publicationThrough.acceptedThrough,
            proposalId: completion.proposalId
          })
        }
      })

      const removePendingCompletion = (proposalId: DeliveryProposalId) =>
        Ref.update(
          pendingCompletions,
          (pending) => new Map([...pending].filter(([pendingProposalId]) => pendingProposalId !== proposalId))
        )

      const removeOwnerInsideGate = (proposalId: DeliveryProposalId) =>
        Ref.update(
          owners,
          (current) => new Map([...current].filter(([ownerProposalId]) => ownerProposalId !== proposalId))
        ).pipe(Effect.andThen(publishRuntimeObservationInsideGate()))

      const proposalIdsForLocalDeferral = (
        current: DeliveryRuntimeEvaluation,
        owner: LiveOwner,
        proposalId: DeliveryProposalId,
        localDeferral: DeliveryRuntimeLocalDeferral
      ): ReadonlyArray<DeliveryProposalId> => {
        if (localDeferral._tag === "PassiveOwnerAttached") {
          return proposalsForLiveAction(current.proposedActions, owner.proposal).map(({ id }) => id)
        }
        return proposalIsPresent(current.proposedActions, proposalId) ? [proposalId] : []
      }

      const installLocalDeferral = Effect.fn("DeliveryRuntime.installLocalDeferral")(function* (
        current: DeliveryRuntimeEvaluation,
        owner: LiveOwner,
        proposalId: DeliveryProposalId,
        localDeferral: DeliveryRuntimeLocalDeferral
      ) {
        const proposalIds = proposalIdsForLocalDeferral(current, owner, proposalId, localDeferral)
        if (proposalIds.length === 0) return
        yield* Ref.update(
          localDeferrals,
          (deferred) => new Map([...deferred, ...proposalIds.map((id) => [id, localDeferral] as const)])
        )
      })

      const settleCompletionInsideGate = Effect.fn("DeliveryRuntime.settleCompletionInsideGate")(function* (
        completion: Completion,
        owner: LiveOwner,
        localDeferral: Option.Option<DeliveryRuntimeLocalDeferral>
      ) {
        const intentRecorded = yield* owner.intentRecorded
        if (Exit.isFailure(completion.exit)) {
          yield* admission.rollback(
            owner.reservation,
            rollbackDispositionFor(owner.reservation, intentRecorded, completion.exit.cause)
          )
          yield* owner.settle
          yield* publishRuntimeObservationInsideGate()
          yield* removeOwnerInsideGate(completion.proposalId)
          return
        }

        const actionResult = completion.exit.value.result
        yield* admission.complete(owner.reservation)
        yield* emit({ _tag: "ActionOutcome", result: actionResult })
        yield* owner.settle
        yield* publishRuntimeObservationInsideGate()
        // Sample the accepted signal before deciding whether this owner coalesces with the next proposal.
        const current = Option.getOrThrow(yield* Ref.get(latest))
        yield* Ref.set(latest, Option.some(current))
        yield* admission.synchronize(current.taskWork, freshTaskCandidateObservationOf(current.proposedActions))
        if (Option.isSome(localDeferral)) {
          yield* installLocalDeferral(current, owner, completion.proposalId, localDeferral.value)
          yield* removeOwnerInsideGate(completion.proposalId)
        } else if (!liveActionIsPresent(current.proposedActions, owner.proposal)) {
          yield* removeOwnerInsideGate(completion.proposalId)
        }
      })

      const applyCompletion = Effect.fn("DeliveryRuntime.applyCompletion")(function* (completion: Completion) {
        const applied = yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            const owner = Option.getOrThrow(Option.fromUndefinedOr((yield* Ref.get(owners)).get(completion.proposalId)))
            const localDeferral = Exit.isSuccess(completion.exit)
              ? deliveryRuntimeLocalDeferralAfter(completion.exit.value.result, owner.proposal, current.acceptedAt)
              : Option.none<DeliveryRuntimeLocalDeferral>()
            if (Exit.isSuccess(completion.exit)) {
              const published = completion.exit.value
              yield* validatePublishedCompletion(completion, published)
              if (successfulCompletionMustRemainPending(current, completion, published, localDeferral)) {
                yield* retainPendingCompletion(completion, published)
                return Option.none<
                  Exit.Exit<DeliveryActionResult, DeliveryActionExecutionError | PlannedTaskAttemptError>
                >()
              }
            }
            yield* removePendingCompletion(completion.proposalId)
            yield* settleCompletionInsideGate(completion, owner, localDeferral)
            return Option.some(Exit.map(completion.exit, ({ result }) => result))
          })
        )
        if (Option.isSome(applied)) yield* Deferred.succeed(completion.acknowledged, undefined)
        return applied
      })

      const applyPublishedCompletions = Effect.fn("DeliveryRuntime.applyPublishedCompletions")(function* () {
        const acceptedAt = Option.getOrThrow(yield* Ref.get(latest)).acceptedAt
        if (acceptedAt === null) return
        const ready = [...(yield* Ref.get(pendingCompletions)).values()].filter(
          (completion) =>
            Exit.isSuccess(completion.exit) && completion.exit.value.publicationThrough.acceptedThrough <= acceptedAt
        )
        for (const completion of ready) {
          const applied = yield* applyCompletion(completion)
          if (Option.isSome(applied) && Exit.isFailure(applied.value)) {
            return yield* Effect.failCause(applied.value.cause)
          }
        }
      })

      const runtimeQuiescence = Effect.fn("DeliveryRuntime.quiescence")(function* () {
        return yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            const live = yield* Ref.get(owners)
            const proposedActions = current.proposedActions
            if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
              return yield* new DeliveryRuntimeProposalOwnershipConflict({
                proposalIds: proposedActions.conflicts.map(({ id }) => id)
              })
            }
            const deferred = yield* Ref.get(localDeferrals)
            const locallyRunnableProposals = proposedActions.proposals.filter(({ id }) => {
              const localDeferral = deferred.get(id)
              return (
                localDeferral === undefined || !deliveryRuntimeLocalDeferralAppliesAt(localDeferral, current.acceptedAt)
              )
            })
            const locallyRunnableFrontier: AvailableProposalFrontier = {
              ...proposedActions,
              proposals: locallyRunnableProposals
            }
            const everyProposalIsLocallyDeferred =
              locallyRunnableProposals.length === 0 && proposedActions.freshTaskCandidates.length === 0
            const activeRefreshG2Pending =
              phase._tag === "ActiveRefreshPreG2RuntimePhase" && current.activeRefreshBoundary !== undefined
            /**
             * After G2, an active refresh may deliberately retain a Running
             * executor position while the relation exposes independent work. If
             * that position fills the whole configured capacity and no local
             * action owner remains, waiting for another runtime event cannot free
             * it: the retained executor responsibility is outside this phase.
             * Return an unsettled quiescence while leaving the proposal in the
             * descriptive relation so a later ordinary activation can retry it.
             */
            const postG2RetainedCapacityBlocks =
              phase._tag === "ActiveRefreshPostG2RuntimePhase" &&
              current.activeRefreshBoundary !== undefined &&
              current.taskWork.held.length >= Number(current.taskWork.capacity) &&
              current.taskWork.held.every(({ correlation }) =>
                current.activeRefreshBoundary?.reconciledAttempts.some(
                  (subject) => subject.runId === correlation.runId && subject.attemptId === correlation.attemptId
                )
              ) &&
              locallyRunnableProposals.length > 0 &&
              locallyRunnableProposals.every(
                ({ admission: { taskWorkPosition } }) =>
                  taskWorkPosition._tag === "TaskWorkPositionRequired" && taskWorkPosition.mode === "ReserveOrReuse"
              )
            if (live.size !== 0) return Option.none<DeliveryRuntimeQuiescence>()
            const ordinaryTaskWorkAdmissionStalled =
              phase._tag === "OrdinaryDeliveryRuntimePhase"
                ? yield* admission.snapshot.pipe(
                    Effect.map((snapshot) =>
                      classifyTaskWorkAdmissionStalledRuntimeQuiescence(current, snapshot, locallyRunnableFrontier)
                    )
                  )
                : Option.none()
            if (
              !activeRefreshG2Pending &&
              !everyProposalIsLocallyDeferred &&
              !postG2RetainedCapacityBlocks &&
              Option.isNone(ordinaryTaskWorkAdmissionStalled)
            ) {
              return Option.none<DeliveryRuntimeQuiescence>()
            }
            if (Option.isSome(ordinaryTaskWorkAdmissionStalled)) {
              return Option.some<DeliveryRuntimeQuiescence>(ordinaryTaskWorkAdmissionStalled.value)
            }
            const empty: EmptyProposalFrontier = { ...locallyRunnableFrontier, freshTaskCandidates: [], proposals: [] }
            if (current.quiescence._tag === "QuiescencePassive") {
              const quiescence: DeliveryRuntimeQuiescence = {
                _tag: "PassiveRuntimeQuiescence",
                acceptedAt: current.acceptedAt,
                current: current.current,
                disposition: current.quiescence,
                proposedActions: empty,
                ...(current.activeRefreshBoundary === undefined
                  ? {}
                  : { activeRefreshBoundary: current.activeRefreshBoundary })
              }
              return Option.some(quiescence)
            }
            const graph = current.current.trackerGraph
            if (graph._tag !== "GraphEstablished" || current.acceptedAt === null) {
              return yield* new DeliveryRuntimeReconfirmationStateInvalid({
                acceptedAt: current.acceptedAt,
                graphState: graph._tag
              })
            }
            const quiescence: DeliveryRuntimeQuiescence = {
              _tag: "TrackerReconfirmationQuiescence",
              acceptedAt: current.acceptedAt,
              current: { ...current.current, trackerGraph: graph },
              disposition: current.quiescence,
              proposedActions: empty,
              ...(current.activeRefreshBoundary === undefined
                ? {}
                : { activeRefreshBoundary: current.activeRefreshBoundary })
            }
            return Option.some(quiescence)
          })
        )
      })

      const applyRuntimeEvent = Effect.fn("DeliveryRuntime.applyEvent")(function* (event: RuntimeEvent<E>) {
        if (event._tag === "RelationFailed") return yield* Effect.failCause(event.cause)
        if (event._tag === "EvaluationChanged") {
          yield* applyEvaluation(event.evaluation)
          yield* applyPublishedCompletions()
          return
        }
        const exit = yield* applyCompletion(event.completion)
        if (Option.isSome(exit) && Exit.isFailure(exit.value)) return yield* Effect.failCause(exit.value.cause)
      })

      for (;;) {
        const current = Option.getOrThrow(yield* Ref.get(latest))
        const activeRefreshG2Pending =
          phase._tag === "ActiveRefreshPreG2RuntimePhase" && current.activeRefreshBoundary !== undefined
        if (!activeRefreshG2Pending) {
          yield* runDeliveryRuntimeAdmissionSweep(current.proposedActions, admissionLoop.admitPass)
        }

        const quiescence = yield* runtimeQuiescence()
        if (Option.isSome(quiescence)) {
          yield* publishRuntimeObservation()
          return quiescence.value
        }
        yield* applyRuntimeEvent(yield* Queue.take(events))
      }
    })
  )
})

/** Runs one standalone runtime phase and releases its process-local resources at the phase boundary. */
export const runDeliveryRuntime = <E>(expectedRunId: RunId, relation: DeliveryRuntimeInput<E>) =>
  runDeliveryRuntimePhase(expectedRunId, relation).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll)
        yield* Effect.flatMap(RuntimeObservation.DeliveryRuntimeObservationPublication, ({ close }) => close)
      })
    )
  )
