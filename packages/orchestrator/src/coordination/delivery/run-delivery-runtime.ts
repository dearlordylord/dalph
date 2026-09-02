/* eslint-disable max-lines -- One gated event loop owns admission, evaluations, completion publication, and quiescence. */
import {
  AttemptId,
  plannedAttemptExecutorCorrelation,
  RunId,
  samePlannedAttemptExecutorCorrelation,
  TaskId
} from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect"
import type * as Cause from "effect/Cause"
import {
  OperationIdAllocator,
  type PlannedTaskAttemptError,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionExecutionError,
  DeliverySemanticTrace,
  type DeliveryActionResult,
  type DeliverySemanticTraceEvent
} from "./delivery-action-executor.js"
import {
  deliveryProposalOrderTaskId,
  DeliveryProposalId,
  type DeliveryActionProposal
} from "./delivery-action-proposal.js"
import { materializeDeliveryAction, materializedOperationId } from "./delivery-action-materialization.js"
import { deliveryTaskWorkAdmissionBasisOf, type DeliveryAdmissionReservation } from "./delivery-runtime-admission.js"
import {
  makeDeliveryRuntimeAdmissionLoop,
  DeliveryRuntimeProposalOwnershipConflict
} from "./delivery-runtime-admission-loop.js"
import { attachCurrentSignal, type CurrentSignal, type DeliveryRuntimeEvaluation } from "./relations.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"
import * as RuntimeObservation from "./delivery-runtime-observation.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { installInterruptibleDeliveryChild } from "./delivery-child-handoff.js"
import { liveActionIsPresent, proposalIsPresent, proposalsForLiveAction } from "./live-delivery-action.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import {
  DeliveryRuntimePhase,
  deliveryProposalPlannedAttemptSubject,
  evaluationForPhase,
  type DeliveryRuntimePhase as DeliveryRuntimePhaseType
} from "./delivery-runtime-phase.js"
import {
  classifyPostG2TaskWorkAdmissionStalledRuntimeQuiescence,
  classifyTaskWorkAdmissionStalledRuntimeQuiescence,
  PostG2AdmissionStallCutToken,
  type AppliedPostG2TaskWorkOutcome,
  type AvailableProposalFrontier,
  type DeliveryRuntimeQuiescence,
  type EmptyProposalFrontier,
  type PostG2TaskWorkAdmissionStalledRuntimeQuiescence,
  sameDeliveryTaskWorkAdmissionBasis,
  sameExactPlannedAttemptCorrelationSet
} from "./delivery-runtime-quiescence.js"
import type { DeliveryRuntimeAdmissionPassResult } from "./delivery-runtime-admission-loop.js"
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

export { DeliveryRuntimeProposalOwnershipConflict } from "./delivery-runtime-admission-loop.js"
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

/** A post-G2 successful-outcome witness combines identities from incompatible proposal/result sources. */
export class PostG2TaskWorkOutcomeIdentityMismatch extends Schema.TaggedError<PostG2TaskWorkOutcomeIdentityMismatch>()(
  "PostG2TaskWorkOutcomeIdentityMismatch",
  {
    expectedAttemptId: Schema.NullOr(AttemptId),
    expectedRunId: RunId,
    expectedTaskId: Schema.NullOr(TaskId),
    observedAttemptId: Schema.NullOr(AttemptId),
    observedRunId: Schema.NullOr(RunId),
    observedTaskId: Schema.NullOr(TaskId),
    proposalId: DeliveryProposalId,
    source: Schema.Literals([
      "ProposalRoute",
      "ExecutorResult",
      "ExecutorReport",
      "ProposalAdmission",
      "ProposalOrder",
      "TaskWorkPosition"
    ])
  }
) {}

type LiveOwner = RuntimeObservation.DeliveryRuntimeLiveOwnerSource

/** Consumer result after every causally prior event and the current stall predicate have been applied. */
type PostG2AdmissionStallCutAcknowledgement = "Applied" | "Invalidated"

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
  | {
      readonly _tag: "PostG2AdmissionStallCut"
      readonly acknowledged: Deferred.Deferred<PostG2AdmissionStallCutAcknowledgement>
      readonly token: PostG2AdmissionStallCutToken
    }

type PendingPostG2AdmissionStallCut =
  | {
      readonly _tag: "Offered"
      readonly acknowledged: Deferred.Deferred<PostG2AdmissionStallCutAcknowledgement>
      readonly admissionPass: DeliveryRuntimeAdmissionPassResult
      readonly candidate: Option.Option<PostG2TaskWorkAdmissionStalledRuntimeQuiescence>
      readonly token: PostG2AdmissionStallCutToken
    }
  | {
      readonly _tag: "Applied"
      readonly candidate: PostG2TaskWorkAdmissionStalledRuntimeQuiescence
      readonly token: PostG2AdmissionStallCutToken
    }

type OfferedPostG2AdmissionStallCut = Extract<PendingPostG2AdmissionStallCut, { readonly _tag: "Offered" }>

const isMatchingOfferedPostG2AdmissionStallCut = (
  pending: PendingPostG2AdmissionStallCut,
  event: Extract<RuntimeEvent<unknown>, { readonly _tag: "PostG2AdmissionStallCut" }>
): pending is OfferedPostG2AdmissionStallCut =>
  pending._tag === "Offered" && pending.token === event.token && pending.acknowledged === event.acknowledged

type ExactPostG2OutcomeSources = {
  readonly position: Extract<
    DeliveryActionProposal["admission"]["taskWorkPosition"],
    { readonly _tag: "TaskWorkPositionRequired"; readonly mode: "ReserveOrReuse" }
  >
  readonly protocol: Extract<
    DeliveryActionProposal["admission"]["plannedAttemptProtocol"],
    { readonly _tag: "PlannedAttemptProtocolRequired" }
  >
  readonly result: Extract<DeliveryActionResult, { readonly _tag: "ExecutorReportPublished" }> & {
    readonly report: Extract<
      Extract<DeliveryActionResult, { readonly _tag: "ExecutorReportPublished" }>["report"],
      { readonly _tag: "ExecutorWorkExecuting" }
    >
  }
}

const exactPostG2OutcomeSourcesOf = (
  result: DeliveryActionResult,
  proposal: DeliveryActionProposal
): Option.Option<ExactPostG2OutcomeSources> => {
  const position = proposal.admission.taskWorkPosition
  const protocol = proposal.admission.plannedAttemptProtocol
  if (
    result._tag !== "ExecutorReportPublished" ||
    result.report._tag !== "ExecutorWorkExecuting" ||
    position._tag !== "TaskWorkPositionRequired" ||
    position.mode !== "ReserveOrReuse" ||
    protocol._tag !== "PlannedAttemptProtocolRequired"
  ) {
    return Option.none()
  }
  return Option.some({ position, protocol, result: { ...result, report: result.report } })
}

type PostG2IdentityContext = {
  readonly expectedRunId: RunId
  readonly proposal: DeliveryActionProposal
  readonly routeSubject: ReturnType<typeof deliveryProposalPlannedAttemptSubject>
  readonly sources: ExactPostG2OutcomeSources
}

const postG2IdentityMismatch = (
  context: PostG2IdentityContext,
  source: PostG2TaskWorkOutcomeIdentityMismatch["source"],
  observed: { readonly attemptId: AttemptId | null; readonly runId: RunId | null; readonly taskId: TaskId | null }
): Option.Option<PostG2TaskWorkOutcomeIdentityMismatch> => {
  const expected = context.routeSubject ?? { attemptId: null, runId: context.expectedRunId, taskId: null }
  return Option.some(
    new PostG2TaskWorkOutcomeIdentityMismatch({
      expectedAttemptId: expected.attemptId,
      expectedRunId: context.expectedRunId,
      expectedTaskId: expected.taskId,
      observedAttemptId: observed.attemptId,
      observedRunId: observed.runId,
      observedTaskId: observed.taskId,
      proposalId: context.proposal.id,
      source
    })
  )
}

const postG2ResultIdentityMismatchOf = (
  context: PostG2IdentityContext
): Option.Option<PostG2TaskWorkOutcomeIdentityMismatch> => {
  const route = context.routeSubject
  if (route === undefined) {
    return postG2IdentityMismatch(context, "ProposalRoute", { attemptId: null, runId: null, taskId: null })
  }
  if (route.runId !== context.expectedRunId) return postG2IdentityMismatch(context, "ProposalRoute", route)
  const planned = context.sources.result.plannedAttempt
  if (!samePlannedAttemptExecutorCorrelation(route, planned) || route.taskId !== planned.taskId) {
    return postG2IdentityMismatch(context, "ExecutorResult", planned)
  }
  const report = context.sources.result.report.correlation
  return !samePlannedAttemptExecutorCorrelation(route, report)
    ? postG2IdentityMismatch(context, "ExecutorReport", { ...report, taskId: route.taskId })
    : Option.none()
}

const postG2ProposalIdentityMismatchOf = (
  context: PostG2IdentityContext
): Option.Option<PostG2TaskWorkOutcomeIdentityMismatch> => {
  const route = context.routeSubject
  if (route === undefined) return Option.none()
  const protocol = context.sources.protocol.correlation
  if (!samePlannedAttemptExecutorCorrelation(route, protocol)) {
    return postG2IdentityMismatch(context, "ProposalAdmission", { ...protocol, taskId: route.taskId })
  }
  const orderTaskId = deliveryProposalOrderTaskId(context.proposal.order)
  if (orderTaskId !== route.taskId) {
    return postG2IdentityMismatch(context, "ProposalOrder", { ...route, taskId: orderTaskId })
  }
  return context.sources.position.taskId !== route.taskId
    ? postG2IdentityMismatch(context, "TaskWorkPosition", { ...route, taskId: context.sources.position.taskId })
    : Option.none()
}

const postG2TaskWorkOutcomeIdentityMismatchOf = (
  expectedRunId: RunId,
  proposal: DeliveryActionProposal,
  result: Extract<DeliveryActionResult, { readonly _tag: "ExecutorReportPublished" }>
): Option.Option<PostG2TaskWorkOutcomeIdentityMismatch> => {
  const sources = exactPostG2OutcomeSourcesOf(result, proposal)
  if (Option.isNone(sources)) return Option.none()
  const context = {
    expectedRunId,
    proposal,
    routeSubject: deliveryProposalPlannedAttemptSubject(proposal),
    sources: sources.value
  }
  return Option.orElse(postG2ResultIdentityMismatchOf(context), () => postG2ProposalIdentityMismatchOf(context))
}

const completionPublicationMismatchOf = (
  expectedRunId: RunId,
  completion: Completion,
  published: PublishedDeliveryActionResult
): Option.Option<DeliveryActionCompletionPublicationMismatch> => {
  if (expectedRunId === published.publicationThrough.runId && completion.proposalId === published.result.proposalId) {
    return Option.none()
  }
  return Option.some(
    new DeliveryActionCompletionPublicationMismatch({
      expectedProposalId: completion.proposalId,
      expectedRunId,
      publicationRunId: published.publicationThrough.runId,
      resultProposalId: published.result.proposalId
    })
  )
}

const isFreshBeginExecutorRoute = (proposal: DeliveryActionProposal): boolean =>
  proposal.route._tag === "FreshExecutorWorkflowRoute" && proposal.route.step._tag === "BeginPlannedAttemptExecutorWork"

const appliedPostG2TaskWorkOutcomeOf = (
  result: DeliveryActionResult,
  proposal: DeliveryActionProposal
): Option.Option<AppliedPostG2TaskWorkOutcome> => {
  const sources = exactPostG2OutcomeSourcesOf(result, proposal)
  if (Option.isNone(sources) || !isFreshBeginExecutorRoute(proposal)) {
    return Option.none()
  }
  const plannedCorrelation = plannedAttemptExecutorCorrelation(sources.value.result.plannedAttempt)
  if (
    !samePlannedAttemptExecutorCorrelation(sources.value.result.report.correlation, plannedCorrelation) ||
    !samePlannedAttemptExecutorCorrelation(sources.value.protocol.correlation, plannedCorrelation)
  ) {
    return Option.none()
  }
  return Option.some({
    correlation: plannedCorrelation,
    proposalId: sources.value.result.proposalId,
    taskId: sources.value.result.plannedAttempt.taskId
  })
}

/**
 * The runtime consumes one coherent current-first evaluation signal. Authority
 * facts may remove a proposal before its admitted interpreter has returned;
 * live ownership remains process-local until that exact action settles.
 */
export type DeliveryRuntimeInput<E = never> = CurrentSignal<DeliveryRuntimeEvaluation, E>

/**
 * The sole runtime-coloured consumer of the descriptive delivery relation.
 * It owns subscriptions, admission, live actions, completion, and quiescence.
 * Its required Run identity comes from the activation, not the optional
 * reconstructed snapshot carried by an evaluation.
 *
 * TODO: this is the largest unmodelled state machine in the system. Every
 * property the delivery requirements rest on — restart mid-attempt, capacity
 * changed mid-run, operator pause, tickets added to the graph mid-run — is
 * decided in the loop below, across `owners`, the selection semaphore, and
 * forked fibers with interrupt handlers. No model covers any of it.
 * `research/verification-bakeoff/quint/deliveryCore.qnt` is an abstraction of
 * what this loop should do and is bound to no code;
 * `specs/plannedAttemptExecutor.qnt` binds to code and stops at the executor
 * boundary. Closing that gap means an MBT driver over this loop, which is the
 * single highest-value model in the study.
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
  | DeliveryRuntimeProposalOwnershipConflict
  | DeliveryRuntimeReconfirmationStateInvalid
  | PostG2TaskWorkOutcomeIdentityMismatch
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
      const appliedPostG2TaskWorkOutcomes = yield* Ref.make<ReadonlyArray<AppliedPostG2TaskWorkOutcome>>([])
      const pendingPostG2AdmissionStallCut = yield* Ref.make<Option.Option<PendingPostG2AdmissionStallCut>>(
        Option.none()
      )
      let nextPostG2AdmissionStallCutToken = 0
      const latest = yield* Ref.make<Option.Option<DeliveryRuntimeEvaluation>>(Option.none())
      const selectionGate = yield* Semaphore.make(1)
      const integrationTargets = resources.integrationTargets
      const attachment = yield* attachCurrentSignal(relation)
      const first = evaluationForPhase(phase, attachment.current)
      yield* Ref.set(latest, Option.some(first))
      yield* runtimeObservation.publish(first, [])
      const admission = yield* resources.makeAdmissionController(first.taskWork)
      const evaluationsSubscribed = yield* Deferred.make<void>()

      yield* Stream.concat(
        Stream.fromEffect(Deferred.succeed(evaluationsSubscribed, undefined)).pipe(Stream.drain),
        attachment.changes
      ).pipe(
        Stream.runForEach((evaluation) =>
          Queue.offer(events, { _tag: "EvaluationChanged", evaluation }).pipe(
            Effect.andThen(emit({ _tag: "RuntimeEvaluationOffered", acceptedAt: evaluation.acceptedAt }))
          )
        ),
        Effect.catchCause((cause) =>
          Queue.offer(events, { _tag: "RelationFailed", cause }).pipe(
            Effect.andThen(emit({ _tag: "RuntimeRelationFailureOffered" }))
          )
        ),
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
          if (operationId !== null) yield* owner.materialize(operationId)
          yield* publishRuntimeObservation()
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
                : admission
                    .rollback(reservation, false)
                    .pipe(
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
          yield* emit({ _tag: "RuntimeCompletionOffered", proposalId: proposal.id })
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

      const admissionLoop = yield* makeDeliveryRuntimeAdmissionLoop({
        admission,
        deferNewPositionUntilLiveOwnersSettle: phase._tag === "ActiveRefreshPostG2RuntimePhase",
        localDeferrals,
        emit,
        latest,
        owners,
        publishRuntimeObservationInsideGate,
        reserveAndStart,
        selectionGate
      })

      const applyEvaluation = Effect.fn("DeliveryRuntime.applyEvaluation")(function* (
        evaluation: DeliveryRuntimeEvaluation
      ) {
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
            yield* admission.synchronize(phaseEvaluation.taskWork)
            yield* admissionLoop.pruneSettledOwners(phaseEvaluation.proposedActions)
            yield* publishRuntimeObservationInsideGate()
          })
        )
      })

      const validatePublishedCompletion = Effect.fn("DeliveryRuntime.validatePublishedCompletion")(function* (
        completion: Completion,
        proposal: DeliveryActionProposal,
        published: PublishedDeliveryActionResult
      ) {
        const mismatch = completionPublicationMismatchOf(expectedRunId, completion, published)
        if (Option.isSome(mismatch)) return yield* mismatch.value
        if (phase._tag === "ActiveRefreshPostG2RuntimePhase" && published.result._tag === "ExecutorReportPublished") {
          const postG2Mismatch = postG2TaskWorkOutcomeIdentityMismatchOf(expectedRunId, proposal, published.result)
          if (Option.isSome(postG2Mismatch)) return yield* postG2Mismatch.value
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
          yield* admission.rollback(owner.reservation, intentRecorded)
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
        yield* admission.synchronize(current.taskWork)
        if (Option.isSome(localDeferral)) {
          yield* installLocalDeferral(current, owner, completion.proposalId, localDeferral.value)
          yield* removeOwnerInsideGate(completion.proposalId)
        } else if (!liveActionIsPresent(current.proposedActions, owner.proposal)) {
          yield* removeOwnerInsideGate(completion.proposalId)
        }
        if (phase._tag === "ActiveRefreshPostG2RuntimePhase") {
          const outcome = appliedPostG2TaskWorkOutcomeOf(actionResult, owner.proposal)
          if (Option.isSome(outcome)) {
            yield* Ref.update(appliedPostG2TaskWorkOutcomes, (outcomes) => [...outcomes, outcome.value])
          }
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
              yield* validatePublishedCompletion(completion, owner.proposal, published)
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

      const locallyRunnableFrontierInsideGate = Effect.fn("DeliveryRuntime.locallyRunnableFrontierInsideGate")(
        function* (current: DeliveryRuntimeEvaluation) {
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
          return { ...proposedActions, proposals: locallyRunnableProposals } satisfies AvailableProposalFrontier
        }
      )

      const postG2AdmissionStallCandidate = Effect.fn("DeliveryRuntime.postG2AdmissionStallCandidate")(function* (
        admissionPass: DeliveryRuntimeAdmissionPassResult
      ) {
        if (phase._tag !== "ActiveRefreshPostG2RuntimePhase") {
          return Option.none<PostG2TaskWorkAdmissionStalledRuntimeQuiescence>()
        }
        return yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            const live = yield* Ref.get(owners)
            if (live.size !== 0) {
              return Option.none<PostG2TaskWorkAdmissionStalledRuntimeQuiescence>()
            }
            const proposedActions = yield* locallyRunnableFrontierInsideGate(current)
            const capacityDeniedProposalIds = new Set(
              admissionPass.deferrals
                .filter(({ reason }) => reason === "TaskWorkPositionUnavailable")
                .map(({ proposalId }) => proposalId)
            )
            return classifyPostG2TaskWorkAdmissionStalledRuntimeQuiescence(
              expectedRunId,
              phase.subjects,
              current,
              deliveryTaskWorkAdmissionBasisOf(yield* admission.snapshot),
              proposedActions,
              capacityDeniedProposalIds,
              yield* Ref.get(appliedPostG2TaskWorkOutcomes)
            )
          })
        )
      })

      const samePostG2AdmissionStallBasis = (
        left: PostG2TaskWorkAdmissionStalledRuntimeQuiescence,
        right: PostG2TaskWorkAdmissionStalledRuntimeQuiescence
      ): boolean => {
        const sameBoundary =
          left.acceptedAt === right.acceptedAt &&
          left.activeRefreshBoundary.runId === right.activeRefreshBoundary.runId &&
          sameExactPlannedAttemptCorrelationSet(
            left.activeRefreshBoundary.reconciledAttempts,
            right.activeRefreshBoundary.reconciledAttempts
          )
        const sameProposals =
          left.proposedActions.proposals.length === right.proposedActions.proposals.length &&
          left.proposedActions.proposals.every((proposal) =>
            right.proposedActions.proposals.some((candidate) => candidate.id === proposal.id)
          )
        return sameBoundary && sameDeliveryTaskWorkAdmissionBasis(left.taskWork, right.taskWork) && sameProposals
      }

      const runtimeQuiescence = Effect.fn("DeliveryRuntime.quiescence")(function* () {
        return yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            const live = yield* Ref.get(owners)
            const locallyRunnableFrontier = yield* locallyRunnableFrontierInsideGate(current)
            const locallyRunnableProposals = locallyRunnableFrontier.proposals
            const everyProposalIsLocallyDeferred = locallyRunnableProposals.length === 0
            const activeRefreshG2Pending =
              phase._tag === "ActiveRefreshPreG2RuntimePhase" && current.activeRefreshBoundary !== undefined
            if (live.size !== 0) return Option.none<DeliveryRuntimeQuiescence>()
            const ordinaryTaskWorkAdmissionStalled =
              phase._tag === "OrdinaryDeliveryRuntimePhase"
                ? classifyTaskWorkAdmissionStalledRuntimeQuiescence(
                    current,
                    deliveryTaskWorkAdmissionBasisOf(yield* admission.snapshot),
                    locallyRunnableFrontier
                  )
                : Option.none()
            if (
              !activeRefreshG2Pending &&
              !everyProposalIsLocallyDeferred &&
              Option.isNone(ordinaryTaskWorkAdmissionStalled)
            ) {
              return Option.none<DeliveryRuntimeQuiescence>()
            }
            if (Option.isSome(ordinaryTaskWorkAdmissionStalled)) {
              return Option.some<DeliveryRuntimeQuiescence>(ordinaryTaskWorkAdmissionStalled.value)
            }
            const empty: EmptyProposalFrontier = { ...locallyRunnableFrontier, proposals: [] }
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

      const applyPostG2AdmissionStallCut = Effect.fn("DeliveryRuntime.applyPostG2AdmissionStallCut")(function* (
        event: Extract<RuntimeEvent<E>, { readonly _tag: "PostG2AdmissionStallCut" }>
      ) {
        const pending = yield* Ref.get(pendingPostG2AdmissionStallCut)
        const offered = Option.filter(pending, (candidate) =>
          isMatchingOfferedPostG2AdmissionStallCut(candidate, event)
        )
        if (Option.isNone(offered)) {
          yield* Deferred.succeed(event.acknowledged, "Invalidated")
          return
        }
        const rechecked = offered.value.admissionPass.started
          ? Option.none<PostG2TaskWorkAdmissionStalledRuntimeQuiescence>()
          : yield* postG2AdmissionStallCandidate(offered.value.admissionPass)
        const applied =
          Option.isSome(offered.value.candidate) &&
          Option.isSome(rechecked) &&
          samePostG2AdmissionStallBasis(offered.value.candidate.value, rechecked.value)
            ? Option.some<PendingPostG2AdmissionStallCut>({
                _tag: "Applied",
                candidate: rechecked.value,
                token: event.token
              })
            : Option.none<PendingPostG2AdmissionStallCut>()
        yield* Ref.set(pendingPostG2AdmissionStallCut, applied)
        yield* Deferred.succeed(event.acknowledged, Option.isSome(applied) ? "Applied" : "Invalidated")
      })

      const applyRuntimeEvent = Effect.fn("DeliveryRuntime.applyEvent")(function* (event: RuntimeEvent<E>) {
        if (event._tag === "RelationFailed") return yield* Effect.failCause(event.cause)
        if (event._tag === "EvaluationChanged") {
          yield* applyEvaluation(event.evaluation)
          yield* applyPublishedCompletions()
          return
        }
        if (event._tag === "PostG2AdmissionStallCut") {
          yield* applyPostG2AdmissionStallCut(event)
          return
        }
        const exit = yield* applyCompletion(event.completion)
        if (Option.isSome(exit) && Exit.isFailure(exit.value)) return yield* Effect.failCause(exit.value.cause)
      })

      const runAdmissionPasses = Effect.fn("DeliveryRuntime.runAdmissionPasses")(function* () {
        const current = Option.getOrThrow(yield* Ref.get(latest))
        const activeRefreshG2Pending =
          phase._tag === "ActiveRefreshPreG2RuntimePhase" && current.activeRefreshBoundary !== undefined
        let admissionPass: DeliveryRuntimeAdmissionPassResult = { deferrals: [], started: false }
        if (activeRefreshG2Pending) return admissionPass
        admissionPass = yield* admissionLoop.admitPass()
        while (admissionPass.started) {
          yield* Effect.yieldNow
          admissionPass = yield* admissionLoop.admitPass()
        }
        return admissionPass
      })

      const offerPostG2AdmissionStallCut = Effect.fn("DeliveryRuntime.offerPostG2AdmissionStallCut")(function* (
        admissionPass: DeliveryRuntimeAdmissionPassResult
      ) {
        const postG2Candidate = yield* postG2AdmissionStallCandidate(admissionPass)
        const offeredAcknowledgement = yield* Deferred.make<PostG2AdmissionStallCutAcknowledgement>()
        const offeredToken = yield* Ref.modify(pendingPostG2AdmissionStallCut, (pending) => {
          if (Option.isSome(pending) && pending.value._tag === "Offered") {
            return [
              Option.none<PostG2AdmissionStallCutToken>(),
              Option.some({ ...pending.value, candidate: postG2Candidate })
            ]
          }
          if (Option.isNone(postG2Candidate)) return [Option.none<PostG2AdmissionStallCutToken>(), pending]
          nextPostG2AdmissionStallCutToken += 1
          const token = PostG2AdmissionStallCutToken.make(nextPostG2AdmissionStallCutToken)
          return [
            Option.some(token),
            Option.some<PendingPostG2AdmissionStallCut>({
              _tag: "Offered",
              acknowledged: offeredAcknowledgement,
              admissionPass,
              candidate: postG2Candidate,
              token
            })
          ]
        })
        if (Option.isSome(offeredToken)) {
          yield* emit({ _tag: "PostG2AdmissionStallCandidateReady", token: offeredToken.value })
          const pending = yield* Ref.get(pendingPostG2AdmissionStallCut)
          if (
            Option.isSome(pending) &&
            pending.value._tag === "Offered" &&
            pending.value.token === offeredToken.value
          ) {
            const offered = pending.value
            yield* Effect.gen(function* () {
              yield* Queue.offer(events, {
                _tag: "PostG2AdmissionStallCut",
                acknowledged: offered.acknowledged,
                token: offeredToken.value
              })
              yield* emit({ _tag: "PostG2AdmissionStallCutOffered", token: offeredToken.value })
              const acknowledgement = yield* Deferred.await(offered.acknowledged)
              if (acknowledgement === "Applied") {
                yield* emit({ _tag: "PostG2AdmissionStallCutApplied", token: offeredToken.value })
              }
            }).pipe(Effect.forkIn(scope))
          }
        }
      })

      const quiescenceWithoutPendingCut = Effect.fn("DeliveryRuntime.quiescenceWithoutPendingCut")(function* () {
        if (Option.isSome(yield* Ref.get(pendingPostG2AdmissionStallCut))) {
          return Option.none<DeliveryRuntimeQuiescence>()
        }
        return yield* runtimeQuiescence()
      })

      for (;;) {
        const pendingCut = yield* Ref.get(pendingPostG2AdmissionStallCut)
        if (Option.isSome(pendingCut) && pendingCut.value._tag === "Applied") {
          yield* publishRuntimeObservation()
          return pendingCut.value.candidate
        }
        if (Option.isSome(pendingCut) && pendingCut.value._tag === "Offered") {
          yield* applyRuntimeEvent(yield* Queue.take(events))
          continue
        }
        yield* offerPostG2AdmissionStallCut(yield* runAdmissionPasses())
        const quiescence = yield* quiescenceWithoutPendingCut()
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
