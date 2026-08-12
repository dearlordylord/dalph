import { type RunId } from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Layer, Option, Ref, Semaphore, Stream } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import { applyOperatorControlDirection } from "../../workflow/protocols/control-direction-application/operator-control.js"
import {
  OperationIdAllocator,
  type OperationIdAllocatorService
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { AttemptChoiceControl } from "../../workflow/protocols/attempt-choice/control.js"
import { Journal, journalLayer } from "../delivery/journal.js"
import {
  DeliveryRuntimeResources,
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf,
  type DeliveryRuntimeResourcesService
} from "../delivery/delivery-runtime-resources.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  RunFinalityDecision,
  type RunFinalityDecision as RunFinalityDecisionType,
  type RunFinalityProof
} from "../frontier/frontier.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory, ValidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import {
  JournaledRunBootstrap,
  JournaledRunIdentityMismatch,
  JournaledRunNotActive,
  type JournaledRunBootstrapService,
  type JournaledRunProcessServices,
  type JournaledRunServices
} from "./run.js"
import { inspectStartupRecovery, StartupRecoveryBlocked } from "./startup-recovery.js"
import { observePauseProgress } from "./pause-progress-observer.js"
import {
  type InRunJournal,
  type JournalReadError,
  JournalStore,
  RunLifecycleJournal
} from "../../workflow-journal/store.js"
import { ApplicationExitAdmission, type ForwardOwnerLease } from "../application-exit/lifecycle.js"
import { ApplicationExitDiagnostic } from "../application-exit/lifecycle-decision.js"
import { ApplicationExitDrainFailure, type ApplicationExitShellService } from "../application-exit/application-shell.js"

export interface JournaledRuntimeLayerInput {
  readonly runId: RunId
}

export type JournaledRuntimeLayer = Layer.Layer<
  Exclude<JournaledRunServices, Journal | JournaledRunProcessServices>,
  InvalidWorkflowJournalHistory | JournalReadError | StartupRecoveryBlocked,
  ApplicationExitAdmission | CoordinatorOwnership | InRunJournal
>

interface RuntimeControls {
  readonly attemptChoice: AttemptChoiceControl["Service"]
  readonly controlDirection: ControlDirectionApplication["Service"]
  readonly deliveryRuntimeResources: DeliveryRuntimeResourcesService
  readonly journal: Journal["Service"]
  readonly operationIdAllocator: OperationIdAllocatorService
  readonly runId: RunId
  readonly target: TrackerTarget
  readonly taskClaimReacquisition: TaskClaimReacquisitionControl["Service"]
  readonly taskWorkCapacity: TaskWorkCapacityControl["Service"]
  readonly workflowInterpreter: WorkflowInterpreter["Service"]
  readonly workflowTrace: WorkflowTrace["Service"]
}

interface RuntimeControlLease {
  readonly controls: RuntimeControls
  readonly forwardOwner: ForwardOwnerLease
}

type RuntimeControlState =
  | { readonly _tag: "RuntimeInactive" }
  | {
      readonly _tag: "RuntimeAcceptingControl"
      readonly activeLeases: number
      readonly controls: RuntimeControls
      readonly drained: Deferred.Deferred<void>
    }
  | {
      readonly _tag: "RuntimeClosing"
      readonly activeLeases: number
      readonly controls: RuntimeControls
      readonly drained: Deferred.Deferred<void>
    }

const validateRun = Effect.fn("JournaledRunBootstrap.validateRun")(function* (
  runId: RunId,
  records: Parameters<typeof reduceWorkflowJournalHistory>[1]
) {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* new StartupRecoveryBlocked({ issues: reduction.issues })
  }
  return reduction
})

/**
 * Owns the complete bootstrap/runtime/termination chronology. Raw storage never
 * enters the runtime context; external Operator calls borrow only narrow
 * controls and teardown waits for every accepted borrow to finish.
 */
export const journaledRunBootstrapLayer = (
  expectedRunId: RunId,
  runtimeLayer: (input: JournaledRuntimeLayerInput) => JournaledRuntimeLayer,
  applicationExit: ApplicationExitShellService
) =>
  Layer.effect(
    JournaledRunBootstrap,
    Effect.gen(function* () {
      const ownership = yield* CoordinatorOwnership
      const storage = yield* JournalStore
      const lifecycle = yield* RunLifecycleJournal
      const admission = applicationExit.admission
      const unresolvedProducedWrites = yield* Ref.make<ReadonlyMap<string, ApplicationExitDiagnostic>>(new Map())
      const observeProducedWrite = <A, E, R>(
        writeKey: string,
        operation: "append" | "begin" | "terminate",
        write: Effect.Effect<A, E, R>
      ) =>
        write.pipe(
          Effect.tap(() =>
            Ref.update(unresolvedProducedWrites, (current) => {
              const unresolved = new Map(current)
              unresolved.delete(writeKey)
              return unresolved
            })
          ),
          Effect.tapError(() =>
            Ref.update(unresolvedProducedWrites, (current) =>
              new Map(current).set(
                writeKey,
                ApplicationExitDiagnostic.make(`Run journal ${operation} failed before application Exit completed`)
              )
            )
          )
        )
      const exitAwareStorage = JournalStore.of({
        ...storage,
        append: (...input) => observeProducedWrite(`append:${input[1]}`, "append", storage.append(...input))
      })
      const runtimeState = yield* Ref.make<RuntimeControlState>({ _tag: "RuntimeInactive" })
      const activeRuntimeClosed = yield* Ref.make<Option.Option<Deferred.Deferred<void>>>(Option.none())
      const activation = yield* Semaphore.make(1)
      const processRuntimeCapabilities = yield* deliveryRuntimeResourceCapabilitiesOf(
        yield* makeIntegrationTargetResourceController(),
        admission
      )
      yield* Effect.addFinalizer(() => processRuntimeCapabilities.observation.close)
      const processRuntimeLayer = deliveryRuntimeResourceCapabilitiesLayer(processRuntimeCapabilities)

      const acquireControlLease = Effect.fn("JournaledRunBootstrap.acquireControlLease")(function* () {
        const forwardOwner = yield* admission.acquireForwardOwner("InterruptibleBoundary")
        const controls = yield* Ref.modify(runtimeState, (current) =>
          current._tag === "RuntimeAcceptingControl"
            ? [
                Option.some(current.controls),
                { ...current, activeLeases: current.activeLeases + 1 } satisfies RuntimeControlState
              ]
            : [Option.none<RuntimeControls>(), current]
        )
        if (Option.isNone(controls)) {
          yield* forwardOwner.release
          return yield* new JournaledRunNotActive()
        }
        return { controls: controls.value, forwardOwner } satisfies RuntimeControlLease
      })

      const releaseControlLease = Effect.fn("JournaledRunBootstrap.releaseControlLease")(function* (
        lease: RuntimeControlLease
      ) {
        const signal = yield* Ref.modify(runtimeState, (current) => {
          /* v8 ignore start -- acquireUseRelease cannot release a lease that was never acquired. */
          if (current._tag === "RuntimeInactive") return [Option.none<Deferred.Deferred<void>>(), current]
          /* v8 ignore stop */
          const activeLeases = current.activeLeases - 1
          return [
            current._tag === "RuntimeClosing" && activeLeases === 0
              ? Option.some(current.drained)
              : Option.none<Deferred.Deferred<void>>(),
            { ...current, activeLeases } satisfies RuntimeControlState
          ]
        })
        yield* lease.forwardOwner.release
        if (Option.isSome(signal)) yield* Deferred.succeed(signal.value, undefined)
      })

      const withRuntimeControls = <A, E>(use: (controls: RuntimeControls) => Effect.Effect<A, E>) =>
        Effect.acquireUseRelease(acquireControlLease(), ({ controls }) => use(controls), releaseControlLease)

      const closeControlAdmission = Effect.fn("JournaledRunBootstrap.closeControlAdmission")(function* () {
        const wait = yield* Ref.modify(runtimeState, (current) => {
          /* v8 ignore start -- runWithJournal opens admission exactly once before closing it exactly once. */
          if (current._tag !== "RuntimeAcceptingControl") return [Effect.void, current]
          /* v8 ignore stop */
          const closing = { ...current, _tag: "RuntimeClosing" as const }
          return [current.activeLeases === 0 ? Effect.void : Deferred.await(current.drained), closing]
        })
        yield* wait
        yield* Ref.set(runtimeState, { _tag: "RuntimeInactive" })
      })

      const runWithJournal = <E, R>(
        runId: RunId,
        target: Parameters<JournaledRunBootstrapService["activate"]>[0],
        initial: ValidWorkflowJournalHistory,
        program: Effect.Effect<RunFinalityProof, E, R>
      ) =>
        Effect.gen(function* () {
          const runtimeClosed = yield* Deferred.make<void>()
          yield* Ref.set(activeRuntimeClosed, Option.some(runtimeClosed))
          return yield* Effect.scoped(
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const downstream = runtimeLayer({ runId }).pipe(
                  Layer.provideMerge(processRuntimeLayer),
                  Layer.provide(Layer.succeed(ApplicationExitAdmission, admission)),
                  Layer.provide(Layer.succeed(CoordinatorOwnership, ownership))
                )
                const runtime = downstream.pipe(
                  Layer.provideMerge(journalLayer(runId, target, initial, exitAwareStorage))
                )
                const context = yield* Layer.build(runtime)
                const journal = Context.get(context, Journal)
                const controls: RuntimeControls = {
                  attemptChoice: Context.get(context, AttemptChoiceControl),
                  controlDirection: Context.get(context, ControlDirectionApplication),
                  deliveryRuntimeResources: Context.get(context, DeliveryRuntimeResources),
                  journal,
                  operationIdAllocator: Context.get(context, OperationIdAllocator),
                  runId,
                  target,
                  taskClaimReacquisition: Context.get(context, TaskClaimReacquisitionControl),
                  taskWorkCapacity: Context.get(context, TaskWorkCapacityControl),
                  workflowInterpreter: Context.get(context, WorkflowInterpreter),
                  workflowTrace: Context.get(context, WorkflowTrace)
                }
                const drained = yield* Deferred.make<void>()
                yield* Ref.set(runtimeState, { _tag: "RuntimeAcceptingControl", activeLeases: 0, controls, drained })
                const result = yield* restore(Effect.provide(program, context)).pipe(Effect.exit)
                yield* closeControlAdmission()
                return yield* Exit.match(result, {
                  onFailure: Effect.failCause,
                  onSuccess: (proof) =>
                    proof.decision._tag === "RunMustRemainActive"
                      ? Effect.succeed(proof.decision)
                      : journal.state.get.pipe(
                          Effect.map(({ records }) =>
                            records.some(
                              ({ event, position }) =>
                                (proof.acceptedAt === null || position > proof.acceptedAt) &&
                                event._tag !== "TaskWorkCapacityChanged"
                            )
                              ? RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
                              : proof.decision
                          )
                        )
                })
              })
            )
          ).pipe(
            Effect.ensuring(
              Deferred.succeed(runtimeClosed, undefined).pipe(
                Effect.andThen(Ref.set(activeRuntimeClosed, Option.none()))
              )
            )
          )
        })

      const finish = Effect.fn("JournaledRunBootstrap.finish")(function* (
        runId: RunId,
        finality: RunFinalityDecisionType
      ) {
        if (finality._tag !== "RunMayTerminate") return finality
        const owner = yield* admission.acquireForwardOwner("AuthorizedRunTerminationAppend").pipe(Effect.option)
        if (Option.isNone(owner)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        }
        yield* observeProducedWrite(`terminate:${runId}`, "terminate", lifecycle.terminateRun(runId)).pipe(
          Effect.ensuring(owner.value.release)
        )
        return finality
      })

      yield* applicationExit.registerProcessLocalDrain({
        closeProcessLocalResources: Effect.gen(function* () {
          const active = yield* Ref.get(activeRuntimeClosed)
          if (Option.isSome(active)) yield* Deferred.await(active.value)
          yield* processRuntimeCapabilities.resources.integrationTargets.releaseAll
          yield* processRuntimeCapabilities.observation.close
          const diagnostics = [...(yield* Ref.get(unresolvedProducedWrites)).values()]
          const [first, ...remaining] = diagnostics
          if (first !== undefined) {
            return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
          }
        })
      })

      const activate: JournaledRunBootstrapService["activate"] = (target, initialControlPolicySource, runId, program) =>
        activation.withPermit(
          Effect.acquireUseRelease(
            admission.acquireForwardOwner("RunActivation"),
            () =>
              Effect.gen(function* () {
                if (runId !== expectedRunId) {
                  return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: runId })
                }
                const current = yield* inspectStartupRecovery(runId, lifecycle)
                if (current === undefined) {
                  const initialControlPolicy = yield* initialControlPolicySource
                  yield* observeProducedWrite(
                    `begin:${runId}`,
                    "begin",
                    lifecycle.beginRun(runId, target, initialControlPolicy)
                  ).pipe(
                    Effect.catch((beginFailure) =>
                      lifecycle.readRunForRecovery(runId, target).pipe(
                        Effect.tap(() =>
                          Ref.update(unresolvedProducedWrites, (current) => {
                            const unresolved = new Map(current)
                            unresolved.delete(`begin:${runId}`)
                            return unresolved
                          })
                        ),
                        Effect.asVoid,
                        Effect.mapError((reconciliationFailure) =>
                          reconciliationFailure._tag === "WorkflowRunTargetMismatch" ||
                          reconciliationFailure._tag === "WorkflowRunAlreadyTerminated"
                            ? reconciliationFailure
                            : beginFailure
                        )
                      )
                    )
                  )
                }
                yield* lifecycle.readRunForRecovery(runId, target)
                const initial = yield* validateRun(runId, yield* lifecycle.read(runId))
                return yield* finish(runId, yield* runWithJournal(runId, target, initial, program))
              }),
            (activationOwner) => activationOwner.release
          )
        )

      const operatorControl: JournaledRunBootstrapService["operatorControl"] = {
        applyAttemptChoice: (input) => withRuntimeControls(({ attemptChoice }) => attemptChoice.apply(input)),
        applyControlDirection: (input) =>
          withRuntimeControls(
            ({ controlDirection, operationIdAllocator, runId, target, workflowInterpreter, workflowTrace }) =>
              applyOperatorControlDirection(runId, target, input, {
                allocator: operationIdAllocator,
                application: controlDirection,
                interpreter: workflowInterpreter,
                trace: workflowTrace
              })
          ),
        applyTaskClaimReacquisition: (input) =>
          withRuntimeControls(({ taskClaimReacquisition }) => taskClaimReacquisition.apply(input)),
        readAttemptChoice: (input) => withRuntimeControls(({ attemptChoice }) => attemptChoice.read(input)),
        readTaskWorkCapacity: (runId) => withRuntimeControls(({ taskWorkCapacity }) => taskWorkCapacity.read(runId)),
        observePause: (input) =>
          Stream.unwrap(
            withRuntimeControls(({ deliveryRuntimeResources, journal, runId }) =>
              journal.state.get.pipe(
                Effect.map(({ position }) =>
                  observePauseProgress(deliveryRuntimeResources, runId, { latestAcceptedAt: position }, input)
                )
              )
            )
          ),
        setTaskWorkCapacity: (input) => withRuntimeControls(({ taskWorkCapacity }) => taskWorkCapacity.apply(input))
      }

      return JournaledRunBootstrap.of({ activate, operatorControl })
    })
  )
