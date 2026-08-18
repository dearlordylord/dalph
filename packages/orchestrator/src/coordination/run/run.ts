import { type PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Schema, type Stream } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import type { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import type { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import type { TaskControlSubjectOutsideRun } from "../../workflow/protocols/control-direction-application/task-subject.js"
import type { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import type { AttemptChoiceControl } from "../../workflow/protocols/attempt-choice/control.js"
import type { IntegrationQuarantineDirectionControl } from "../../workflow/protocols/integration-quarantine/control.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
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
import {
  DeliveryRuntimeResources,
  type DeliveryRuntimeResourceCapabilityPair
} from "../delivery/delivery-runtime-resources.js"
import type { DeliveryRuntimeObservationPublication } from "../delivery/delivery-runtime-observation.js"
import type {
  PauseNotApplied,
  PauseObservationRunMismatch,
  PauseProgressProjectionConflict,
  PauseProgressView
} from "./pause-progress-observation.js"
import type { RunFinalityDecision, RunFinalityProof } from "../frontier/frontier.js"
import { runStabilizedDelivery } from "./run-stabilization.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import type { AllocatedWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import type { StartupRecoveryBlocked } from "./startup-recovery.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"

export type JournaledRunProcessServices =
  | DeliveryRuntimeResourceCapabilityPair
  | DeliveryRuntimeResources
  | DeliveryRuntimeObservationPublication

export type JournaledRunServices =
  | Journal
  | AttemptChoiceControl
  | ControlDirectionApplication
  | JournaledRunProcessServices
  | InRunJournal
  | OperationIdAllocator
  | PlannedAttemptExecutor
  | PlannedAttemptProtocolController
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
export class JournaledRunIdentityMismatch extends Schema.TaggedError<JournaledRunIdentityMismatch>()(
  "JournaledRunIdentityMismatch",
  { expectedRunId: RunId, requestedRunId: RunId }
) {}

/** An Operator request arrived while no established Run activation was installed. */
export class JournaledRunNotActive extends Schema.TaggedError<JournaledRunNotActive>()("JournaledRunNotActive", {}) {}

export interface JournaledRunBootstrapService {
  readonly activate: <EInitial, RInitial, E, R>(
    target: TrackerTarget,
    initialControlPolicySource: Effect.Effect<InitialControlPolicy, EInitial, RInitial>,
    runId: AllocatedWorkflowRunId,
    program: Effect.Effect<RunFinalityProof, E, R>
  ) => Effect.Effect<
    RunFinalityDecision,
    E | EInitial | ApplicationExiting | JournaledRunBootstrapError | JournaledRunIdentityMismatch,
    RInitial | Exclude<R, JournaledRunServices>
  >
  readonly operatorControl: {
    readonly applyIntegrationQuarantineDirection: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<IntegrationQuarantineDirectionControl["Service"]["apply"]>>,
      | Effect.Error<ReturnType<IntegrationQuarantineDirectionControl["Service"]["apply"]>>
      | ApplicationExiting
      | JournaledRunIdentityMismatch
    >
    readonly applyAttemptChoice: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<AttemptChoiceControl["Service"]["apply"]>>,
      Effect.Error<ReturnType<AttemptChoiceControl["Service"]["apply"]>> | ApplicationExiting | JournaledRunNotActive
    >
    readonly applyControlDirection: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<ControlDirectionApplication["Service"]["apply"]>>,
      | Effect.Error<ReturnType<ControlDirectionApplication["Service"]["apply"]>>
      | Effect.Error<ReturnType<WorkflowInterpreter["Service"]["readTrackerGraph"]>>
      | Effect.Error<ReturnType<WorkflowTrace["Service"]["emit"]>>
      | JournaledRunNotActive
      | ApplicationExiting
      | TaskControlSubjectOutsideRun
    >
    readonly applyTaskClaimReacquisition: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<TaskClaimReacquisitionControl["Service"]["apply"]>>,
      | Effect.Error<ReturnType<TaskClaimReacquisitionControl["Service"]["apply"]>>
      | ApplicationExiting
      | JournaledRunNotActive
    >
    readonly readAttemptChoice: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<AttemptChoiceControl["Service"]["read"]>>,
      Effect.Error<ReturnType<AttemptChoiceControl["Service"]["read"]>> | ApplicationExiting | JournaledRunNotActive
    >
    readonly readIntegrationQuarantineDirection: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<IntegrationQuarantineDirectionControl["Service"]["read"]>>,
      | Effect.Error<ReturnType<IntegrationQuarantineDirectionControl["Service"]["read"]>>
      | ApplicationExiting
      | JournaledRunIdentityMismatch
    >
    readonly readTaskWorkCapacity: (
      runId: RunId
    ) => Effect.Effect<
      Effect.Success<ReturnType<TaskWorkCapacityControl["Service"]["read"]>>,
      Effect.Error<ReturnType<TaskWorkCapacityControl["Service"]["read"]>> | ApplicationExiting | JournaledRunNotActive
    >
    readonly setTaskWorkCapacity: (
      input: unknown
    ) => Effect.Effect<
      Effect.Success<ReturnType<TaskWorkCapacityControl["Service"]["apply"]>>,
      Effect.Error<ReturnType<TaskWorkCapacityControl["Service"]["apply"]>> | ApplicationExiting | JournaledRunNotActive
    >
    /**
     * Alice passively observes the exact applied Pause through a transport-independent stream.
     * Subscription lifetime never owns the active Run or a runtime control lease.
     */
    readonly observePause: (
      input: unknown
    ) => Stream.Stream<
      PauseProgressView,
      | Schema.SchemaError
      | PauseNotApplied
      | PauseObservationRunMismatch
      | PauseProgressProjectionConflict
      | JournalError
      | JournaledRunNotActive
      | ApplicationExiting
    >
  }
}

/** Establishes one exact Run and constructs every in-Run service only after journal installation. */
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

/** Required factory seam for an explicit controlled composition of the ordinary delivery runtime. */
export type ControlledDeliveryActionExecutorFactory<E = never, R = never> = (
  runId: RunId,
  target: TrackerTarget
) => Effect.Effect<DeliveryActionExecutorService, E, R>

/** Evaluated and decoded by Run establishment only when the exact Run has no history. */
export type InitialControlPolicySource<E = never, R = never> = Effect.Effect<InitialControlPolicy, E, R>

const liveDeliveryActionExecutorFactory = (runId: RunId, target: TrackerTarget) =>
  makeLiveDeliveryActionExecutor(runId, target)

const runJournaledDelivery = <E, R>(
  runId: RunId,
  target: TrackerTarget,
  executorFactory: ControlledDeliveryActionExecutorFactory<E, R>
) => runDeliveryComposition(target, makeJournaledDeliveryRelations(runId, target), () => executorFactory(runId, target))

/** Explicit controlled composition; production callers use {@link runWorkflow}. */
export const runWorkflowWithControlledDeliveryActionExecutor = <EInitial, RInitial, E, R>(
  target: TrackerTarget,
  initialControlPolicySource: InitialControlPolicySource<EInitial, RInitial>,
  runId: AllocatedWorkflowRunId,
  executorFactory: ControlledDeliveryActionExecutorFactory<E, R>
) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.activate(
      target,
      initialControlPolicySource,
      runId,
      runJournaledDelivery(runId, target, executorFactory)
    )
  })

/** Establishes one exact Run and performs one bounded ordinary delivery activation. */
export const runWorkflow = <EInitial, RInitial>(
  target: TrackerTarget,
  initialControlPolicySource: InitialControlPolicySource<EInitial, RInitial>,
  runId: AllocatedWorkflowRunId
) =>
  runWorkflowWithControlledDeliveryActionExecutor(
    target,
    initialControlPolicySource,
    runId,
    liveDeliveryActionExecutorFactory
  )
