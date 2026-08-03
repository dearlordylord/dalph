import { type PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Schema } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import type { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import type { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import type {
  AcceptedFactPublicationError,
  InRunJournal,
  InRunJournalRunMismatch,
  JournalStoreError,
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan,
  WorkflowRunTargetMismatch
} from "../../workflow-journal/store.js"
import type { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import {
  AcceptedFactPublicationGateway,
  type AcceptedFactGatewayInitialHistoryInvalid
} from "../delivery/accepted-fact-gateway.js"
import { delivery } from "../delivery/delivery.js"
import { deliveryRuntimeFrom } from "../delivery/delivery-runtime-adapter.js"
import { DeliveryActionExecutor, type DeliveryActionExecutorService } from "../delivery/delivery-action-executor.js"
import { makeLiveDeliveryActionExecutor } from "../delivery/live-delivery-action-executor.js"
import { makeReactiveDeliveryRelationsLayer } from "../delivery/reactive-delivery-relations.js"
import type { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import type { TrackerGraphRelation } from "../delivery/relations.js"
import { runDeliveryRuntime } from "../delivery/run-delivery-runtime.js"
import {
  makeSyntheticDeliveryRelationsLayer,
  type SyntheticTrackerGraphObservationFactory
} from "../delivery/synthetic-delivery-relations.js"
import { makeSyntheticDeliveryActionExecutor } from "../delivery/synthetic-delivery-action-executor.js"
import type { RunFinalityDecision, RunFinalityProof } from "../frontier/frontier.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import type { AllocatedFreshWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import type { StartupRecoveryBlocked } from "./startup-recovery.js"

export type JournaledRunServices =
  | AcceptedFactPublicationGateway
  | ControlDirectionApplication
  | DeliveryRuntimeResources
  | InRunJournal
  | PlannedAttemptExecutor
  | RunRecoveryProjection
  | TaskWorkCapacityControl
  | TaskClaimReacquisitionControl
  | TrackerGraphRelation
  | WorkflowInterpreter
  | WorkflowTrace

export type JournaledRunBootstrapError =
  | AcceptedFactGatewayInitialHistoryInvalid
  | AcceptedFactPublicationError
  | InRunJournalRunMismatch
  | InvalidWorkflowJournalHistory
  | JournalStoreError
  | StartupRecoveryBlocked
  | WorkflowRunAlreadyBegan
  | WorkflowRunAlreadyTerminated
  | WorkflowRunIdentityAlreadyUsed
  | WorkflowRunNotBegan
  | WorkflowRunTargetMismatch

/** A fixed production composition was asked to begin a different Run identity. */
export class JournaledRunIdentityMismatch extends Schema.TaggedErrorClass<JournaledRunIdentityMismatch>()(
  "JournaledRunIdentityMismatch",
  { expectedRunId: RunId, requestedRunId: RunId }
) {}

/** An Operator request arrived while no fresh or recovered Run runtime was installed. */
export class JournaledRunNotActive extends Schema.TaggedErrorClass<JournaledRunNotActive>()(
  "JournaledRunNotActive",
  {}
) {}

export interface JournaledRunBootstrapService {
  readonly fresh: <E, R>(
    target: TrackerTarget,
    initialControlPolicy: InitialControlPolicy,
    runId: AllocatedFreshWorkflowRunId,
    program: Effect.Effect<RunFinalityProof, E, R>
  ) => Effect.Effect<
    RunFinalityDecision,
    E | JournaledRunBootstrapError | JournaledRunIdentityMismatch,
    Exclude<R, JournaledRunServices>
  >
  readonly recovered: <E, R>(
    target: TrackerTarget,
    program: Effect.Effect<RunFinalityProof, E, R>
  ) => Effect.Effect<RunFinalityDecision, E | JournaledRunBootstrapError, Exclude<R, JournaledRunServices>>
  readonly synthetic: <E, R>(
    target: TrackerTarget,
    initialControlPolicy: InitialControlPolicy,
    runId: RunId,
    program: Effect.Effect<RunFinalityProof, E, R>
  ) => Effect.Effect<
    RunFinalityDecision,
    E | JournaledRunBootstrapError | JournaledRunIdentityMismatch,
    Exclude<R, JournaledRunServices>
  >
  readonly operatorControl: {
    readonly applyControlDirection: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<ControlDirectionApplication["Service"]["apply"]>>,
      Effect.Error<ReturnType<ControlDirectionApplication["Service"]["apply"]>> | JournaledRunNotActive
    >
    readonly applyTaskClaimReacquisition: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<TaskClaimReacquisitionControl["Service"]["apply"]>>,
      Effect.Error<ReturnType<TaskClaimReacquisitionControl["Service"]["apply"]>> | JournaledRunNotActive
    >
    readonly readTaskWorkCapacity: (
      runId: RunId
    ) => Effect.Effect<
      Effect.Success<ReturnType<TaskWorkCapacityControl["Service"]["read"]>>,
      Effect.Error<ReturnType<TaskWorkCapacityControl["Service"]["read"]>> | JournaledRunNotActive
    >
    readonly setTaskWorkCapacity: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<TaskWorkCapacityControl["Service"]["apply"]>>,
      Effect.Error<ReturnType<TaskWorkCapacityControl["Service"]["apply"]>> | JournaledRunNotActive
    >
  }
}

/** Owns fresh/recovered sequencing and constructs every in-Run service only after gateway installation. */
export class JournaledRunBootstrap extends Context.Service<JournaledRunBootstrap, JournaledRunBootstrapService>()(
  "@dalph/JournaledRunBootstrap"
) {}

/**
 * The one application-level delivery program. Its scope closes the relation
 * subscription and runtime owner before JournaledRunBootstrap may terminate the Run.
 */
type DeliveryRelationsLayer = Effect.Success<ReturnType<typeof makeReactiveDeliveryRelationsLayer>>

const makeJournaledDeliveryRelations = Effect.fn("Delivery.makeJournaledRelations")(function* (
  runId: RunId,
  target: TrackerTarget
) {
  const gateway = yield* AcceptedFactPublicationGateway
  const recovery = yield* RunRecoveryProjection
  return yield* makeReactiveDeliveryRelationsLayer(runId, target, gateway, recovery)
})

const runFlatDelivery = Effect.fn("Delivery.runFlat")(function* <ERelations, RRelations, EExecutor, RExecutor>(
  relationsEffect: Effect.Effect<DeliveryRelationsLayer, ERelations, RRelations>,
  executorEffect: Effect.Effect<DeliveryActionExecutorService, EExecutor, RExecutor>
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const relations = yield* relationsEffect
      const executor = yield* executorEffect
      const consequences = yield* delivery.pipe(Effect.provide(relations))
      const relation = yield* deliveryRuntimeFrom(consequences).pipe(Effect.provide(relations))

      return yield* runDeliveryRuntime(relation).pipe(Effect.provideService(DeliveryActionExecutor, executor))
    })
  )
})

/** Runs a fresh workflow through the literal flat delivery composition. */
export const runWorkflow = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: AllocatedFreshWorkflowRunId
) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.fresh(
      target,
      initialControlPolicy,
      runId,
      runFlatDelivery(makeJournaledDeliveryRelations(runId, target), makeLiveDeliveryActionExecutor(runId, target))
    )
  })

/** Runs the exact reconstructed identity through the same flat delivery composition. */
export const runRecoveredWorkflow = (target: TrackerTarget) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.recovered(
      target,
      Effect.gen(function* () {
        const recovery = yield* RunRecoveryProjection
        if (recovery._tag !== "AuthoritativeRunRecoveryProjection") {
          return yield* Effect.die("a recovered workflow requires authoritative recovered activation")
        }
        return yield* runFlatDelivery(
          makeJournaledDeliveryRelations(recovery.runId, target),
          makeLiveDeliveryActionExecutor(recovery.runId, target)
        )
      })
    )
  })

/** Explicit non-durable interpretation of the same public delivery program. */
export const runSyntheticWorkflowWithBootstrap = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: RunId,
  observationOf: SyntheticTrackerGraphObservationFactory
) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.synthetic(
      target,
      initialControlPolicy,
      runId,
      runFlatDelivery(
        makeSyntheticDeliveryRelationsLayer(runId, target, initialControlPolicy, observationOf),
        makeSyntheticDeliveryActionExecutor(runId, target)
      )
    )
  })
