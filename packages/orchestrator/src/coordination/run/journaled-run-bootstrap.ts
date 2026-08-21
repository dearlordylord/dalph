/* eslint-disable max-lines -- Run bootstrap keeps activation and its serialized operator controls in one ownership boundary. */
import { type RunId } from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Layer, Option, Ref, Schema, Semaphore, Stream } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import {
  applyOperatorControlDirection,
  type OperatorControlGraphReadBoundary
} from "../../workflow/protocols/control-direction-application/operator-control.js"
import {
  OperationIdAllocator,
  type OperationIdAllocatorService
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { AttemptChoiceControl } from "../../workflow/protocols/attempt-choice/control.js"
import {
  type IntegrationQuarantineDirectionControlService,
  makeIntegrationQuarantineDirectionControl
} from "../../workflow/protocols/integration-quarantine/control.js"
import { ApplyIntegrationQuarantineDirectionRequest } from "../../workflow/protocols/integration-quarantine/events.js"
import { ReadIntegrationQuarantineDirectionRequest } from "../../workflow/protocols/integration-quarantine/request.js"
import { Journal, journalLayer, type JournalState } from "../delivery/journal.js"
import {
  DeliveryRuntimeResources,
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf,
  type DeliveryRuntimeResourcesService
} from "../delivery/delivery-runtime-resources.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunFinalityDecision, type RunFinalityProof } from "../frontier/frontier.js"
import { runFinalityEvidenceMatches } from "../frontier/run-finality.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
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
  InRunJournal,
  type JournalAppendError,
  type JournalError,
  type JournalReadError,
  JournalStore,
  RunLifecycleJournal
} from "../../workflow-journal/store.js"
import { ApplicationExitAdmission, type ForwardOwnerLease } from "../application-exit/lifecycle.js"
import { ApplicationExitDiagnostic } from "../application-exit/lifecycle-decision.js"
import { ApplicationExitDrainFailure, type ApplicationExitShellService } from "../application-exit/application-shell.js"
import { suspendRunningExecutorWorkForApplicationExit } from "../application-exit/executor-drain.js"
import {
  AppliedRunCancellation,
  ApplyRunCancellationRequest,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import { runCancellationAppliedRecordKey } from "../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"

export interface JournaledRuntimeLayerInput {
  readonly runId: RunId
}

export type JournaledRuntimeLayer = Layer.Layer<
  Exclude<JournaledRunServices, Journal | JournaledRunProcessServices>,
  InvalidWorkflowJournalHistory | JournalAppendError | JournalReadError | StartupRecoveryBlocked,
  ApplicationExitAdmission | CoordinatorOwnership | InRunJournal
>

interface RuntimeControls {
  readonly attemptChoice: AttemptChoiceControl["Service"]
  readonly controlDirection: ControlDirectionApplication["Service"]
  readonly deliveryRuntimeResources: DeliveryRuntimeResourcesService
  readonly integrationQuarantineDirection: IntegrationQuarantineDirectionControlService
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

const identityOperatorControlGraphReadBoundary: OperatorControlGraphReadBoundary = (effect) => effect

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

type TerminalRunFinalityProof = Extract<RunFinalityProof, { readonly decision: { readonly _tag: "RunMayTerminate" } }>

type TaskTrackerReadIntentEvent = Extract<
  JournalState["records"][number]["event"],
  { readonly _tag: "TaskTrackerReadIntentRecorded" }
>
type TrackerGraphReadOperation = Extract<TaskTrackerReadIntentEvent["operation"], { readonly _tag: "ReadTrackerGraph" }>
type TrackerGraphReadIntentEvent = Omit<TaskTrackerReadIntentEvent, "operation"> & {
  readonly operation: TrackerGraphReadOperation
}

const isTrackerGraphReadIntentEvent = (
  event: JournalState["records"][number]["event"]
): event is TrackerGraphReadIntentEvent =>
  event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"

const terminalGraphReadFor = (proof: TerminalRunFinalityProof, state: JournalState) => {
  const graph = state.graph
  let operation: TaskTrackerReadIntentEvent | undefined
  for (const { event } of state.records) {
    if (event._tag !== "TaskTrackerReadIntentRecorded") continue
    if (event.operation.operationId !== proof.evidence.operationId) continue
    operation = event
    break
  }
  if (graph._tag !== "GraphEstablished") return undefined
  if (operation === undefined) return undefined
  /* v8 ignore next -- @preserve Production terminal evidence is generated only from the exact tracker-graph read operation. */
  if (!isTrackerGraphReadIntentEvent(operation)) return undefined
  return { graph, operation }
}

const terminalProofMatchesGraphRead = (
  proof: TerminalRunFinalityProof,
  runId: RunId,
  target: TrackerTarget,
  graphRead: ReturnType<typeof terminalGraphReadFor>
): boolean => {
  if (graphRead === undefined) return false
  const rootTaskId = graphRead.graph.observation.snapshot.rootTaskId
  /* v8 ignore next -- @preserve A production RunMayTerminate proof requires a tracker-selected root in its complete graph. */
  if (rootTaskId === undefined) return false
  return (
    runFinalityEvidenceMatches(proof.evidence, {
      operationId: graphRead.graph.observation.operationId,
      observedAt: graphRead.graph.observation.recordedAt,
      readShape: graphRead.operation.operation.readShape,
      revision: graphRead.graph.observation.snapshot.revision,
      rootTaskId,
      runId,
      target
    }) && taskTrackerTargetKey(graphRead.operation.operation.target) === taskTrackerTargetKey(target)
  )
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
  applicationExit: ApplicationExitShellService,
  operatorControlGraphReadBoundary: OperatorControlGraphReadBoundary = identityOperatorControlGraphReadBoundary
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
      const integrationQuarantineDirection = yield* makeIntegrationQuarantineDirectionControl(
        InRunJournal.of({ append: exitAwareStorage.append, read: exitAwareStorage.read })
      )
      const runtimeState = yield* Ref.make<RuntimeControlState>({ _tag: "RuntimeInactive" })
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

      const withJournalControl = <A, E>(control: Effect.Effect<A, E>) =>
        Effect.acquireUseRelease(
          admission.acquireForwardOwner("InterruptibleBoundary"),
          () => control,
          (owner) => owner.release
        )

      const withPublishedOrStoredQuarantineControl = <A, E>(
        use: (control: IntegrationQuarantineDirectionControlService) => Effect.Effect<A, E>
      ) =>
        withRuntimeControls(({ integrationQuarantineDirection }) => use(integrationQuarantineDirection)).pipe(
          Effect.catchTag("JournaledRunNotActive", () => withJournalControl(use(integrationQuarantineDirection)))
        )

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
        Effect.scoped(
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
              const publishedIntegrationQuarantineDirection = yield* makeIntegrationQuarantineDirectionControl(
                InRunJournal.of({ append: journal.append, read: journal.read })
              )
              yield* applicationExit.registerExecutorDrain({
                suspendRunningExecutorWork: suspendRunningExecutorWorkForApplicationExit().pipe(Effect.provide(context))
              })
              const controls: RuntimeControls = {
                attemptChoice: Context.get(context, AttemptChoiceControl),
                controlDirection: Context.get(context, ControlDirectionApplication),
                deliveryRuntimeResources: Context.get(context, DeliveryRuntimeResources),
                integrationQuarantineDirection: publishedIntegrationQuarantineDirection,
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
                onSuccess: (
                  proof
                ): Effect.Effect<{ readonly proof: RunFinalityProof; readonly state?: JournalState }, JournalError> =>
                  proof.decision._tag === "RunMustRemainActive"
                    ? Effect.succeed({ proof })
                    : journal.state.get.pipe(
                        Effect.map((state) => {
                          const changed = state.records.some(
                            ({ event, position }) =>
                              (proof.acceptedAt === null || position > proof.acceptedAt) &&
                              event._tag !== "TaskWorkCapacityChanged"
                          )
                          const finalProof = changed
                            ? {
                                acceptedAt: proof.acceptedAt,
                                decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
                              }
                            : proof
                          return { proof: finalProof, state }
                        })
                      )
              })
            })
          )
        )

      const finish = Effect.fn("JournaledRunBootstrap.finish")(function* (
        runId: RunId,
        target: TrackerTarget,
        result: { readonly proof: RunFinalityProof; readonly state?: JournalState }
      ) {
        const { proof, state } = result
        if (proof.decision._tag !== "RunMayTerminate") return proof.decision
        /* v8 ignore next -- @preserve runWithJournal always returns its final immutable state with the proof. */
        if (state === undefined) return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        /* v8 ignore next -- @preserve The RunFinalityProof union requires evidence whenever its decision may terminate. */
        if (!("evidence" in proof)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        }
        const terminalProof = proof
        const graphRead = terminalGraphReadFor(terminalProof, state)
        if (!terminalProofMatchesGraphRead(terminalProof, runId, target, graphRead)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        }
        const owner = yield* admission.acquireForwardOwner("AuthorizedRunTerminationAppend").pipe(Effect.option)
        if (Option.isNone(owner)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        }
        yield* observeProducedWrite(
          `terminate:${runId}`,
          "terminate",
          lifecycle.terminateRun(runId, terminalProof.disposition, terminalProof.evidence)
        ).pipe(Effect.ensuring(owner.value.release))
        return proof.decision
      })

      yield* applicationExit.registerProcessLocalDrain({
        closeProcessLocalResources: Effect.gen(function* () {
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
                return yield* finish(runId, target, yield* runWithJournal(runId, target, initial, program))
              }),
            (activationOwner) => activationOwner.release
          )
        )

      const operatorControl: JournaledRunBootstrapService["operatorControl"] = {
        applyRunCancellation: (input) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(ApplyRunCancellationRequest, {
              onExcessProperty: "error"
            })(input)
            if (request.runId !== expectedRunId) {
              return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: request.runId })
            }
            return yield* withRuntimeControls(({ journal, runId }) =>
              Effect.gen(function* () {
                const existing = (yield* journal.state.get).records.find(
                  ({ event }) => event._tag === "RunCancellationApplied"
                )
                if (existing !== undefined) {
                  return AppliedRunCancellation.cases.RunCancellationAlreadyApplied.make({
                    appliedAt: existing.position
                  })
                }
                const applied = yield* journal.append(
                  runId,
                  runCancellationAppliedRecordKey,
                  RunCancellationAppliedEvent.make({
                    initiatedBy: { _tag: "Operator" },
                    occurrenceClassification: "InitiatedAction",
                    version: workflowJournalEventVersion
                  })
                )
                return AppliedRunCancellation.cases.RunCancellationApplied.make({ appliedAt: applied.position })
              })
            ).pipe(
              Effect.catchTag("JournaledRunNotActive", () =>
                lifecycle.read(expectedRunId).pipe(
                  Effect.flatMap((records) => {
                    const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
                    /* v8 ignore next -- @preserve The find predicate admits only WorkflowRunTerminated records. */
                    return terminated?.event._tag === "WorkflowRunTerminated"
                      ? Effect.succeed(
                          AppliedRunCancellation.cases.RunCancellationRunTerminated.make({
                            disposition: terminated.event.disposition,
                            terminatedAt: terminated.position
                          })
                        )
                      : Effect.fail(new JournaledRunNotActive())
                  })
                )
              )
            )
          }),
        applyIntegrationQuarantineDirection: (input) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(ApplyIntegrationQuarantineDirectionRequest, {
              onExcessProperty: "error"
            })(input)
            if (request.requestId.runId !== expectedRunId) {
              return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: request.requestId.runId })
            }
            return yield* withPublishedOrStoredQuarantineControl((control) => control.apply(request))
          }),
        applyAttemptChoice: (input) => withRuntimeControls(({ attemptChoice }) => attemptChoice.apply(input)),
        applyControlDirection: (input) =>
          withRuntimeControls(
            ({ controlDirection, operationIdAllocator, runId, target, workflowInterpreter, workflowTrace }) =>
              applyOperatorControlDirection(runId, target, input, {
                allocator: operationIdAllocator,
                application: controlDirection,
                graphReadBoundary: operatorControlGraphReadBoundary,
                interpreter: workflowInterpreter,
                trace: workflowTrace
              })
          ),
        applyTaskClaimReacquisition: (input) =>
          withRuntimeControls(({ taskClaimReacquisition }) => taskClaimReacquisition.apply(input)),
        readAttemptChoice: (input) => withRuntimeControls(({ attemptChoice }) => attemptChoice.read(input)),
        readIntegrationQuarantineDirection: (input) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(ReadIntegrationQuarantineDirectionRequest, {
              onExcessProperty: "error"
            })(input)
            if (request.requestId.runId !== expectedRunId) {
              return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: request.requestId.runId })
            }
            return yield* withPublishedOrStoredQuarantineControl((control) => control.read(request))
          }),
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
