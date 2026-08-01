/* eslint-disable max-lines -- The production Run keeps pause gating inside the one shared fresh/recovered activation loop. */
import { Context, Deferred, Effect, Exit, Option, Queue, Ref, Semaphore } from "effect"
import { ActivationCause, makeActivationCoordinator } from "../activation/coordinator.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "../activation/selected-transition.js"
import {
  type AcceptedResult,
  type IntegrationTarget,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import { type InitialControlPolicy } from "../../control/policy.js"
import { type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { type AllocatedFreshWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryActivation, type RunRecoveryActivationError } from "./recovery-activation.js"
import {
  deriveRunFinalityDecision,
  type RunnableFrontier,
  type RunnableFrontierTransition,
  runnableTransitionTaskId
} from "../frontier/frontier.js"
import { makeTaskAdmissionController } from "../admission/controller.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { makeCompleteTaskTrackerFactsObserved } from "../../workflow/task-tracker-facts/observation.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { OperationSelected, TaskTrackerFactsObservedTrace } from "../../presentation/tracker-workflow-trace.js"
import { type TraceItem, WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { RunControlPolicy, initialRunPolicyRevision } from "../../control/policy.js"
import { makeIntegrationStageContext } from "./integration-stage-context.js"
import {
  type CurrentDeliveryRelation,
  type CurrentDeliveryGraphUnavailable,
  type JournaledCurrentDeliveryRelation,
  type SyntheticCurrentDeliveryRelation,
  makeJournaledCurrentDeliveryRelation,
  makeSyntheticCurrentDeliveryRelation
} from "./current-delivery-relation.js"
import { deriveFreshWorkflowDecisions, type FreshWorkflowDecision } from "./fresh-workflow.js"
import {
  runFreshWorkflowStep,
  type FreshWorkflowExecutionError,
  type FreshWorkflowStepResult
} from "./run-fresh-workflow-step.js"

const explanationTaskIds = (explanation: RunnableFrontier["explanations"][number]): ReadonlyArray<TaskId> =>
  Option.toArray(Option.fromUndefinedOr<TaskId>(Reflect.get(explanation, "taskId")))

/* v8 ignore start -- Every entry point replaces this construction-only boundary predicate before activation. */
const rejectAllBoundaryTransitions = (_transition: RunnableFrontierTransition): boolean => false
/* v8 ignore stop */

type RunControlPolicyReadError = Effect.Error<ReturnType<TaskWorkCapacityControl["Service"]["read"]>>

type RunActivationError =
  | CurrentDeliveryGraphUnavailable
  | FreshWorkflowExecutionError
  | RunControlPolicyReadError
  | RunRecoveryActivationError

// eslint-disable-next-line complexity -- Startup mode and finality branches surround one shared delivery-activation turn.
const runDeliveryActivation = Effect.fn("DeliveryActivation.run")(function* (
  target: TrackerTarget,
  startup:
    | {
        readonly _tag: "Fresh"
        readonly initialControlPolicy: InitialControlPolicy
        readonly runId: AllocatedFreshWorkflowRunId
      }
    | { readonly _tag: "Recovered" }
    | { readonly _tag: "Synthetic"; readonly initialControlPolicy: InitialControlPolicy; readonly runId: RunId },
  readCurrentControlPolicy: Effect.Effect<RunControlPolicy, RunControlPolicyReadError>
) {
  const allocator = yield* OperationIdAllocator
  const interpreter = yield* WorkflowInterpreter
  const claimPlanner = yield* TaskClaimAcquisitionPlanner
  const planner = yield* PlannedTaskAttemptPlanner
  const integration = yield* makeIntegrationStageContext()
  const trace = yield* WorkflowTrace
  const recovery = yield* RunRecoveryActivation
  const runId =
    recovery._tag === "AuthoritativeRunRecoveryActivation" || recovery._tag === "JournaledFreshRunActivation"
      ? recovery.runId
      : /* v8 ignore next -- Recovered entry points require authoritative recovery composition. */
        startup._tag === "Recovered"
        ? yield* Effect.die("a recovered workflow requires authoritative recovered activation")
        : startup.runId
  const initialControlPolicy = yield* readCurrentControlPolicy
  const journaledCurrentDelivery =
    recovery._tag === "SyntheticFreshOnlyActivation"
      ? undefined
      : yield* makeJournaledCurrentDeliveryRelation(
          runId,
          readCurrentControlPolicy,
          Option.getOrThrowWith(
            Context.getOption(yield* Effect.context<never>(), JournalStore),
            /* v8 ignore next -- Every journaled application composition provides its journal with recovery. */
            () => new Error("journaled activation requires a workflow journal")
          )
        )
  const traceEmission = yield* Semaphore.make(1)
  const emit = (item: TraceItem) => traceEmission.withPermit(trace.emit(item))
  const admissionController = yield* makeTaskAdmissionController({
    capacity: initialControlPolicy.taskExecutionCapacity,
    reconstructedPlannedAttemptPositions: recovery.reconstructedPlannedAttemptPositions
  })
  const recoveredAttemptIds = new Set(recovery.reconstructedPlannedAttemptPositions.map(({ attemptId }) => attemptId))
  const queueFreshAcceptedResult = (
    plannedAttempt: PlannedTaskAttempt,
    acceptedResult: AcceptedResult,
    integrationTarget: IntegrationTarget
  ): Effect.Effect<void, FreshWorkflowExecutionError> =>
    integration.queueAcceptedResult(plannedAttempt, acceptedResult, integrationTarget)
  interface WorkflowOperationCompletion {
    readonly acknowledged: Deferred.Deferred<void>
    readonly exit: Exit.Exit<FreshWorkflowStepResult | undefined, RunActivationError>
  }
  const completions = yield* Queue.unbounded<WorkflowOperationCompletion>()

  return yield* Effect.scoped(
    // eslint-disable-next-line complexity -- One scoped turn owns the closed boundary/delivery phases and finality outcomes.
    Effect.gen(function* () {
      type LiveCurrentDeliveryRelation =
        | JournaledCurrentDeliveryRelation<RunActivationError>
        | SyntheticCurrentDeliveryRelation<RunActivationError>
      type ActivationPhase =
        | { readonly _tag: "Boundary"; readonly mayRun: (transition: RunnableFrontierTransition) => boolean }
        | { readonly _tag: "Delivery"; readonly currentDelivery: LiveCurrentDeliveryRelation }
      interface DeliveryActivationTurn {
        readonly fresh: ReadonlyArray<FreshWorkflowDecision>
        readonly frontier: RunnableFrontier
        readonly policy: RunControlPolicy
      }
      const phase = yield* Ref.make<ActivationPhase>({ _tag: "Boundary", mayRun: rejectAllBoundaryTransitions })
      const readDeliveryActivationTurn = Effect.fn("DeliveryActivation.readTurn")(function* (): Effect.fn.Return<
        DeliveryActivationTurn,
        RunActivationError
      > {
        const currentPhase = yield* Ref.get(phase)
        const recovered = yield* recovery.readFrontier
        if (currentPhase._tag === "Boundary") {
          return {
            fresh: [],
            frontier: { ...recovered, transitions: recovered.transitions.filter(currentPhase.mayRun) },
            policy: yield* readCurrentControlPolicy
          }
        }
        const frame = yield* currentPhase.currentDelivery.read
        const fresh = deriveFreshWorkflowDecisions(frame, recoveredAttemptIds)
        const freshTaskIds = new Set(fresh.map(({ transition }) => runnableTransitionTaskId(transition)))
        const remainingRecovered = recovered.transitions.filter(
          (transition) => !freshTaskIds.has(runnableTransitionTaskId(transition))
        )
        return {
          fresh,
          policy: frame.runControlPolicy,
          frontier: {
            explanations: recovered.explanations.filter(
              (explanation) => !explanationTaskIds(explanation).some((taskId) => freshTaskIds.has(taskId))
            ),
            transitions: [...remainingRecovered, ...fresh.map(({ transition }) => transition)]
          }
        }
      })
      const checkedTurn = yield* Ref.make<DeliveryActivationTurn>({
        fresh: [],
        frontier: { explanations: [], transitions: [] },
        policy: initialControlPolicy
      })
      const readFrontier = readDeliveryActivationTurn().pipe(
        Effect.tap((turn) => Ref.set(checkedTurn, turn)),
        Effect.map(({ frontier }) => frontier)
      )
      const refreshCurrentGraph = Effect.fn("Workflow.refreshCurrentGraph")(function* () {
        const operation = makeTrackerGraphObservationOperation(yield* allocator.allocate(), target)
        yield* emit(OperationSelected.make({ operation }))
        const refreshed = yield* interpreter.readTrackerGraph(operation)
        const currentPhase = yield* Ref.get(phase)
        /* v8 ignore start -- Global refresh runs only after the delivery phase has been installed. */
        if (currentPhase._tag === "Boundary") return yield* Effect.die("delivery relation is not installed")
        /* v8 ignore stop */
        if (currentPhase.currentDelivery._tag === "JournaledCurrentDeliveryRelation") {
          yield* currentPhase.currentDelivery.refreshAcceptedHistory
        } else {
          yield* currentPhase.currentDelivery.acceptTrackerGraphObservation(operation.operationId, refreshed)
        }
        yield* emit(
          TaskTrackerFactsObservedTrace.make({
            operation,
            observation: makeCompleteTaskTrackerFactsObserved(operation, refreshed)
          })
        )
        return refreshed
      })
      const coordinator = yield* makeActivationCoordinator({
        admissionController,
        readFrontier,
        runId,
        runTransition: (transition, execution) =>
          Effect.gen(function* () {
            const fresh = (yield* Ref.get(checkedTurn)).fresh.find(
              (candidate) =>
                selectedTransitionKey(makeSelectedTransitionIdentity(runId, candidate.transition)) ===
                selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))
            )
            const operation: Effect.Effect<FreshWorkflowStepResult | undefined, RunActivationError> =
              fresh === undefined
                ? recovery._tag === "AuthoritativeRunRecoveryActivation" ||
                  recovery._tag === "JournaledFreshRunActivation"
                  ? recovery.runTransition(transition, execution).pipe(Effect.as(undefined))
                  : /* v8 ignore next -- A synthetic frontier contains only transitions paired with a fresh decision above. */
                    Effect.die("synthetic activation cannot derive a recovered transition")
                : runFreshWorkflowStep(
                    {
                      allocator,
                      claimPlanner,
                      continuePlannedAttemptExecutorWork: recovery.continueFreshPlannedAttemptExecutorWork,
                      emit,
                      integrationTarget: integration.integrationTarget,
                      interpreter,
                      planner,
                      queueAcceptedResult: queueFreshAcceptedResult,
                      target
                    },
                    fresh.step,
                    execution
                  )
            const exit = yield* Effect.exit(operation)
            const acknowledged = yield* Deferred.make<void>()
            yield* Queue.offer(completions, { acknowledged, exit })
            yield* Deferred.await(acknowledged)
            return yield* Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void
          })
      })
      // eslint-disable-next-line complexity -- Accepted completion variants route to their exact durable or synthetic fact boundary.
      const applyCompletion = Effect.fn("Workflow.applyOperationCompletion")(function* (
        completion: WorkflowOperationCompletion
      ) {
        const { exit } = completion
        if (Exit.isSuccess(exit)) {
          const currentPhase = yield* Ref.get(phase)
          if (
            currentPhase._tag === "Delivery" &&
            currentPhase.currentDelivery._tag === "JournaledCurrentDeliveryRelation"
          ) {
            yield* currentPhase.currentDelivery.refreshAcceptedHistory
          } else if (
            currentPhase._tag === "Delivery" &&
            currentPhase.currentDelivery._tag === "SyntheticCurrentDeliveryRelation" &&
            exit.value !== undefined
          ) {
            yield* currentPhase.currentDelivery.acceptWorkflowFact(exit.value.acceptedFact)
            if (
              exit.value.acceptedFact._tag === "CurrentTaskGraphObserved" ||
              exit.value.acceptedFact._tag === "PostClaimGraphObserved"
            ) {
              yield* currentPhase.currentDelivery.acceptTrackerGraphObservation(
                exit.value.acceptedFact.operationId,
                exit.value.acceptedFact.snapshot
              )
            }
          }
        }
        yield* Deferred.succeed(completion.acknowledged, undefined)
        if (Exit.isFailure(exit)) {
          return yield* Effect.failCause(exit.cause)
        }
      })

      const runTurn = Effect.fn("DeliveryActivation.turn")(function* (cause: ActivationCause) {
        const turn = yield* readDeliveryActivationTurn()
        yield* Ref.set(checkedTurn, turn)
        const admission = yield* admissionController.snapshot()
        if (admission.capacity !== turn.policy.taskExecutionCapacity) {
          yield* admissionController.resize(turn.policy.taskExecutionCapacity)
        }
        /* v8 ignore start -- The scoped coordinator can close at this handoff only during concurrent finalization. */
        yield* coordinator.signal(cause).pipe(Effect.catchTag("ActivationCoordinatorClosed", () => Effect.void))
        /* v8 ignore stop */
        const pendingCompletion = yield* Queue.poll(completions)
        if (Option.isSome(pendingCompletion)) yield* applyCompletion(pendingCompletion.value)
        return { completionApplied: Option.isSome(pendingCompletion), frontier: turn.frontier }
      })

      const drainBoundary = Effect.fn("DeliveryActivation.drainBoundary")(function* () {
        for (;;) {
          const turn = yield* runTurn(ActivationCause.Restart())
          if (turn.completionApplied) continue
          /* v8 ignore start -- These protect the handoff while a runner consumes the final selected transition. */
          if (turn.frontier.transitions.length > 0 || !(yield* coordinator.isIdle)) {
            yield* applyCompletion(yield* Queue.take(completions))
            continue
          }
          /* v8 ignore stop */
          return
        }
      })

      const pauseState = yield* recovery.readPauseState
      if (pauseState.run._tag === "RunPaused") {
        /* v8 ignore start -- Synthetic activation has no journal and therefore cannot reconstruct Run Pause. */
        if (recovery._tag === "SyntheticFreshOnlyActivation") {
          return yield* Effect.die("synthetic activation cannot reconstruct a Run Pause")
        }
        /* v8 ignore stop */
        yield* Ref.set(phase, { _tag: "Boundary", mayRun: () => true })
        yield* drainBoundary()
        return deriveRunFinalityDecision(
          yield* recovery.readFinalityFrontier,
          yield* recovery.readResponsibility,
          false
        )
      }
      if (recovery._tag !== "SyntheticFreshOnlyActivation" && (yield* recovery.readContinuationRequiresFreshFacts)) {
        yield* Ref.set(phase, {
          _tag: "Boundary",
          mayRun: (transition) =>
            transition._tag === "SuspendPlannedAttemptExecutorWork" ||
            transition._tag === "ObservePlannedAttemptContinuationWorktree" ||
            transition._tag === "ObservePlannedAttemptContinuationTargetLineage" ||
            transition._tag === "CheckTaskClaim" ||
            transition._tag === "ReconcileTaskClaim" ||
            transition._tag === "ReconcileTaskClaimRelease" ||
            transition._tag === "ReconcileTaskWorktree" ||
            transition._tag === "ReleaseStartedIntegrationTarget"
        })
        yield* drainBoundary()
      }

      const graphOperation = makeTrackerGraphObservationOperation(yield* allocator.allocate(), target)
      yield* emit(OperationSelected.make({ operation: graphOperation }))
      const snapshot = yield* interpreter.readTrackerGraph(graphOperation)
      yield* emit(
        TaskTrackerFactsObservedTrace.make({
          operation: graphOperation,
          observation: makeCompleteTaskTrackerFactsObserved(graphOperation, snapshot)
        })
      )
      const currentDelivery: CurrentDeliveryRelation<RunActivationError> &
        (JournaledCurrentDeliveryRelation<RunActivationError> | SyntheticCurrentDeliveryRelation<RunActivationError>) =
        recovery._tag === "SyntheticFreshOnlyActivation"
          ? yield* makeSyntheticCurrentDeliveryRelation(snapshot, graphOperation.operationId, readCurrentControlPolicy)
          : Option.getOrThrow(Option.fromUndefinedOr(journaledCurrentDelivery))
      if (currentDelivery._tag === "JournaledCurrentDeliveryRelation") {
        yield* currentDelivery.refreshAcceptedHistory
      }
      yield* Ref.set(phase, { _tag: "Delivery", currentDelivery })

      for (;;) {
        const turn = yield* runTurn(ActivationCause.Startup())
        if (turn.completionApplied) continue
        const currentFrontier = turn.frontier
        if (currentFrontier.transitions.length === 0) {
          /* v8 ignore start -- This protects the handoff instant after a runner consumes the last currently derived transition. */
          if (!(yield* coordinator.isIdle)) {
            yield* applyCompletion(yield* Queue.take(completions))
            continue
          }
          /* v8 ignore stop */
          if ((yield* recovery.readPauseState).run._tag === "RunPaused") {
            return deriveRunFinalityDecision(
              yield* recovery.readFinalityFrontier,
              yield* recovery.readResponsibility,
              false
            )
          }
          const refreshed = yield* refreshCurrentGraph()
          const refreshedFrontier = (yield* readDeliveryActivationTurn()).frontier
          if (refreshedFrontier.transitions.length === 0) {
            const trackerTargetSettled = refreshed
              .taskIds()
              .every((taskId) => Option.getOrThrow(refreshed.lifecycleOf(taskId))._tag === "CompletedSuccessfully")
            return deriveRunFinalityDecision(
              yield* recovery.readFinalityFrontier,
              yield* recovery.readResponsibility,
              trackerTargetSettled
            )
          }
          continue
        }
        const awaitedCompletion = yield* Queue.take(completions)
        yield* applyCompletion(awaitedCompletion)
      }
    })
  )
})

/** Runs a production fresh workflow only with an identity minted by `freshWorkflowRunId`. */
export const runWorkflow = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: AllocatedFreshWorkflowRunId
) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const control = yield* TaskWorkCapacityControl
    yield* journal.beginRun(runId, target, initialControlPolicy)
    const finality = yield* runDeliveryActivation(
      target,
      { _tag: "Fresh", initialControlPolicy, runId },
      control.read(runId)
    )
    if (finality._tag === "RunMayTerminate") yield* journal.terminateRun(runId)
    return finality
  })

/** Runs the exact reconstructed identity owned by authoritative recovery. */
export const runRecoveredWorkflow = (target: TrackerTarget) =>
  Effect.gen(function* () {
    const recovery = yield* RunRecoveryActivation
    /* v8 ignore start -- The public application recovery layer always supplies authoritative recovery. */
    if (recovery._tag !== "AuthoritativeRunRecoveryActivation") {
      return yield* Effect.die("a recovered workflow requires authoritative recovered activation")
    }
    /* v8 ignore stop */
    const journal = yield* JournalStore
    const control = yield* TaskWorkCapacityControl
    yield* journal.readRunForRecovery(recovery.runId, target)
    const finality = yield* runDeliveryActivation(target, { _tag: "Recovered" }, control.read(recovery.runId))
    if (finality._tag === "RunMayTerminate") yield* journal.terminateRun(recovery.runId)
    return finality
  })

/** Explicit non-durable path for dry-run and deterministic workflow tests. */
export const runSyntheticWorkflow = (target: TrackerTarget, initialControlPolicy: InitialControlPolicy, runId: RunId) =>
  runDeliveryActivation(
    target,
    { _tag: "Synthetic", initialControlPolicy, runId },
    Effect.succeed(
      RunControlPolicy.make({
        revision: initialRunPolicyRevision,
        taskExecutionCapacity: initialControlPolicy.taskExecutionCapacity
      })
    )
  )
