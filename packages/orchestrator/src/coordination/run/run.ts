import { type PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Schema } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import type { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import type { TaskControlSubjectOutsideRun } from "../../workflow/protocols/control-direction-application/task-subject.js"
import type { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import type { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import type {
  JournalError,
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
import { Journal, type JournalInitialHistoryInvalid } from "../delivery/journal.js"
import { delivery } from "../delivery/delivery.js"
import { deliveryRuntimeFrom } from "../delivery/delivery-runtime-adapter.js"
import { DeliveryActionExecutor, type DeliveryActionExecutorService } from "../delivery/delivery-action-executor.js"
import { makeLiveDeliveryActionExecutor } from "../delivery/live-delivery-action-executor.js"
import { makeReactiveDeliveryRelationsLayer } from "../delivery/reactive-delivery-relations.js"
import { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import type { RunFinalityDecision, RunFinalityProof } from "../frontier/frontier.js"
import { runStabilizedDelivery } from "./run-stabilization.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import type { AllocatedFreshWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import type { StartupRecoveryBlocked } from "./startup-recovery.js"

export type JournaledRunServices =
  | Journal
  | ControlDirectionApplication
  | DeliveryRuntimeResources
  | InRunJournal
  | OperationIdAllocator
  | PlannedAttemptExecutor
  | RunRecoveryProjection
  | TaskWorkCapacityControl
  | TaskClaimReacquisitionControl
  | WorkflowInterpreter
  | WorkflowTrace

export type JournaledRunBootstrapError =
  | JournalInitialHistoryInvalid
  | JournalError
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
  readonly operatorControl: {
    readonly applyControlDirection: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<ControlDirectionApplication["Service"]["apply"]>>,
      | Effect.Error<ReturnType<ControlDirectionApplication["Service"]["apply"]>>
      | Effect.Error<ReturnType<WorkflowInterpreter["Service"]["readTrackerGraph"]>>
      | Effect.Error<ReturnType<WorkflowTrace["Service"]["emit"]>>
      | JournaledRunNotActive
      | TaskControlSubjectOutsideRun
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

/** Owns fresh/recovered sequencing and constructs every in-Run service only after journal installation. */
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
  const journal = yield* Journal
  const recovery = yield* RunRecoveryProjection
  const resources = yield* DeliveryRuntimeResources
  return yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources.integrationTargets)
})

const runDeliveryComposition = Effect.fn("Delivery.runComposition")(function* <
  Relations extends DeliveryRelationsLayer,
  ERelations,
  RRelations,
  EExecutor,
  RExecutor
>(
  target: TrackerTarget,
  relationsEffect: Effect.Effect<Relations, ERelations, RRelations>,
  executorOf: (relations: Relations) => Effect.Effect<DeliveryActionExecutorService, EExecutor, RExecutor>
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const relations = yield* relationsEffect
      return yield* Effect.gen(function* () {
        const executor = yield* executorOf(relations)
        const consequences = yield* delivery
        const relation = yield* deliveryRuntimeFrom(consequences)

        return yield* runStabilizedDelivery(target, relation).pipe(
          Effect.provideService(DeliveryActionExecutor, executor)
        )
      }).pipe(Effect.provide(relations))
    })
  )
})

const runJournaledDelivery = (runId: RunId, target: TrackerTarget) =>
  runDeliveryComposition(target, makeJournaledDeliveryRelations(runId, target), () =>
    makeLiveDeliveryActionExecutor(runId, target)
  )

/** Runs a fresh workflow through the ordinary delivery composition. */
export const runWorkflow = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: AllocatedFreshWorkflowRunId
) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.fresh(target, initialControlPolicy, runId, runJournaledDelivery(runId, target))
  })

/** Runs the exact reconstructed identity through the same ordinary delivery composition. */
export const runRecoveredWorkflow = (target: TrackerTarget) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.recovered(
      target,
      Effect.gen(function* () {
        const recovery = yield* RunRecoveryProjection
        /* v8 ignore start -- recovered bootstrap installs only its authoritative projection variant. */
        if (recovery._tag !== "AuthoritativeRunRecoveryProjection") {
          return yield* Effect.die("a recovered workflow requires authoritative recovered activation")
        }
        /* v8 ignore stop */
        return yield* runJournaledDelivery(recovery.runId, target)
      })
    )
  })
