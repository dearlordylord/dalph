/* eslint-disable max-lines -- Run bootstrap keeps activation and its serialized operator controls in one ownership boundary. */
import { plannedAttemptExecutorCorrelation, RunId } from "@dalph/contracts"
import { RunActivationGraphBaseline } from "./activation-graph-baseline.js"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef
} from "effect"
import { TrackerTarget, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import {
  ControlDirectionApplication,
  controlDirectionApplicationLayer
} from "../../workflow/protocols/control-direction-application/protocol.js"
import { ApplyControlDirectionRequest } from "../../workflow/protocols/control-direction-application/request.js"
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
  IntegrationQuarantineDirectionResultNotFound,
  makeIntegrationQuarantineDirectionControl
} from "../../workflow/protocols/integration-quarantine/control.js"
import { ApplyIntegrationQuarantineDirectionRequest } from "../../workflow/protocols/integration-quarantine/events.js"
import { ReadIntegrationQuarantineDirectionRequest } from "../../workflow/protocols/integration-quarantine/request.js"
import {
  Journal,
  type JournalInitialHistoryInvalid,
  journalLayer,
  type JournalState,
  type JournalStorageBoundary
} from "../delivery/journal.js"
import { DeliveryRelationPublicationObserver } from "../delivery/delivery-publication-observer.js"
import {
  DeliveryRuntimeResources,
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf,
  type DeliveryRuntimeResourcesService
} from "../delivery/delivery-runtime-resources.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunFinalityDecision, type RunFinalityProof } from "../frontier/frontier.js"
import { RunTerminationDisposition, runFinalityEvidenceMatches } from "../frontier/run-finality.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory, ValidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import {
  JournaledRunBootstrap,
  JournaledRunIdentityMismatch,
  JournaledRunNotActive,
  JournaledRunReactivationObserverAlreadyRegistered,
  type JournaledRunBootstrapService,
  type JournaledRunProcessServices,
  type JournaledRunServices,
  type AcceptedRunReactivationObservers
} from "./run.js"
import { inspectStartupRecovery, StartupRecoveryBlocked } from "./startup-recovery.js"
import { observePauseProgress } from "./pause-progress-observer.js"
import {
  InRunJournal,
  type JournalAppendError,
  type JournalError,
  type JournalReadError,
  type JournalRecord,
  JournalStore,
  RunLifecycleJournal,
  WorkflowRunAlreadyTerminated,
  WorkflowRunNotBegan,
  WorkflowRunTargetMismatch
} from "../../workflow-journal/store.js"
import {
  journalMaintenanceDiagnosticFor,
  type JournalMaintenanceObservationService
} from "../../workflow-journal/maintenance.js"
import type { AllocatedWorkflowRunId } from "./fresh-run-identity.js"
import { ApplicationExitAdmission, type ForwardOwnerLease } from "../application-exit/lifecycle.js"
import { ApplicationExitDiagnostic } from "../application-exit/lifecycle-decision.js"
import { ApplicationExitDrainFailure, type ApplicationExitShellService } from "../application-exit/application-shell.js"
import { suspendExecutingExecutorWorkForApplicationExit } from "../application-exit/executor-drain.js"

import {
  AppliedRunCancellation,
  ApplyRunCancellationRequest,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import { intentRecordKey, runCancellationAppliedRecordKey } from "../../workflow-journal/record-key.js"
import {
  firstJournalRecordOfKind,
  journalRecordByKey,
  journalWorkflowFinalityPremiseChangeAt,
  lastJournalRecordOfKind
} from "../../workflow-journal/record-evidence.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsForRunState,
  RunActivationOpportunity
} from "./run-activation-opportunity.js"
import {
  makePlannedAttemptProtocolController,
  PlannedAttemptProtocolController
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  publishPlannedAttemptExecutorProjectionResultWithPermit,
  type PlannedAttemptExecutorObservationResult
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  makePassivePlannedAttemptObserver,
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication,
  type PassivePlannedAttemptProjectionPublicationService
} from "./passive-planned-attempt-observer.js"
import type { IntegratorCandidateCleanupEvidenceReadFailure } from "../../workflow/protocols/disposition-cleanup/integrator-candidate.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TraceCursor } from "../../presentation/trace-reader.js"
import type { DeliveryRuntimeObservationState } from "../delivery/delivery-runtime-observation.js"
import { currentSignalFromCurrentFirstStream, type CurrentSignal } from "../delivery/relations.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { exactWorkflowRunTargetFor } from "../../workflow-journal/run-target.js"

/** A journal prefix has acknowledged the exact beginning before delivery can call the tracker. */
export const JournaledRunEstablished = Schema.Struct({
  acceptedAt: JournalPosition,
  runId: RunId,
  target: TrackerTarget
})
export type JournaledRunEstablished = typeof JournaledRunEstablished.Type

/** The exact acknowledged terminal occurrence that closes one selected Run. */
export const JournaledRunTermination = Schema.Struct({
  disposition: RunTerminationDisposition,
  terminatedAt: TraceCursor
})
export type JournaledRunTermination = typeof JournaledRunTermination.Type

/** Read-only process-local completion source; callers cannot complete it. */
export interface JournaledRunTerminationSource {
  readonly await: Effect.Effect<JournaledRunTermination>
  readonly poll: Effect.Effect<Option.Option<JournaledRunTermination>>
}

/** Read-only process source published by one scoped Journal-backed Run graph. */
export interface JournaledRunObservationSourceService {
  /** Latest exact Journal cursor published only after its append is acknowledged. */
  readonly acceptedHistory: CurrentSignal<TraceCursor>
  readonly awaitEstablished: Effect.Effect<JournaledRunEstablished>
  readonly current: CurrentSignal<DeliveryRuntimeObservationState>
  /** Completes only after this Run's terminal Journal append is acknowledged. */
  readonly runTermination: JournaledRunTerminationSource
}

export class JournaledRunObservationSource extends Context.Service<
  JournaledRunObservationSource,
  JournaledRunObservationSourceService
>()("@dalph/JournaledRunObservationSource") {}

export interface JournaledRuntimeLayerInput {
  readonly runId: RunId
  readonly opportunity: RunActivationOpportunity
}

export type JournaledRuntimeLayer = Layer.Layer<
  Exclude<
    JournaledRunServices,
    AcceptedJournalReader | Journal | JournaledRunProcessServices | RunActivationGraphBaseline
  >,
  | InvalidWorkflowJournalHistory
  | JournalAppendError
  | JournalReadError
  | StartupRecoveryBlocked
  | IntegratorCandidateCleanupEvidenceReadFailure,
  | ApplicationExitAdmission
  | AcceptedJournalReader
  | CoordinatorOwnership
  | InRunJournal
  | JournaledRunProcessServices
  | PlannedAttemptProtocolController
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

type ProcessJournalContext = Context.Context<Journal | AcceptedJournalReader | InRunJournal>

type ProcessJournalHolder =
  | { readonly _tag: "NotEstablished" }
  | { readonly _tag: "Failed"; readonly failure: JournalInitialHistoryInvalid }
  | {
      readonly _tag: "Established"
      readonly context: ProcessJournalContext
      readonly controlDirection: ControlDirectionApplication["Service"]
      readonly integrationQuarantineDirection: IntegrationQuarantineDirectionControlService
      readonly journal: Journal["Service"]
      readonly target: TrackerTarget
    }

type TerminalRunFinalityProof = Extract<RunFinalityProof, { readonly decision: { readonly _tag: "RunMayTerminate" } }>

type TaskTrackerReadIntentEvent = Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>
type TrackerGraphReadOperation = Extract<TaskTrackerReadIntentEvent["operation"], { readonly _tag: "ReadTrackerGraph" }>
type TrackerGraphReadIntentEvent = Omit<TaskTrackerReadIntentEvent, "operation"> & {
  readonly operation: TrackerGraphReadOperation
}

const isTrackerGraphReadIntentEvent = (event: JournalRecord["event"]): event is TrackerGraphReadIntentEvent =>
  event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"

const terminalGraphReadFor = (proof: TerminalRunFinalityProof, state: JournalState) => {
  const graph = state.graph
  const operationRecord = journalRecordByKey(state.prefix, intentRecordKey(proof.evidence.operationId))
  const operation = operationRecord?.event._tag === "TaskTrackerReadIntentRecorded" ? operationRecord.event : undefined
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

/** Alice's accepted cancellation makes an older terminal graph non-current even when later bookkeeping advanced the activation. */
const cancellationSupersedesTerminalEvidence = (proof: TerminalRunFinalityProof, state: JournalState): boolean =>
  (lastJournalRecordOfKind(state.prefix, "RunCancellationApplied")?.position ?? 0) > proof.evidence.observedAt

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
  maintenanceObservation: JournalMaintenanceObservationService,
  operatorControlGraphReadBoundary: OperatorControlGraphReadBoundary = identityOperatorControlGraphReadBoundary
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const bootstrapScope = yield* Scope.Scope
      const ownership = yield* CoordinatorOwnership
      const storage = yield* JournalStore
      const lifecycle = yield* RunLifecycleJournal
      const admission = applicationExit.admission
      const unresolvedProducedWrites = yield* Ref.make<ReadonlyMap<string, ApplicationExitDiagnostic>>(new Map())
      const startupRetirementAttempts = yield* Ref.make<ReadonlySet<RunId>>(new Set())
      const observeProducedWrite = <A, E, R>(
        writeKey: string,
        operation: "append" | "begin" | "terminate",
        write: Effect.Effect<A, E, R>
      ) =>
        write.pipe(
          Effect.tap(() =>
            Ref.update(unresolvedProducedWrites, (current) => {
              return new Map([...current].filter(([key]) => key !== writeKey))
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
      const acceptedHistoryState = yield* SubscriptionRef.make<Option.Option<TraceCursor>>(Option.none())
      const runTermination = yield* Deferred.make<JournaledRunTermination>()
      yield* Effect.addFinalizer(() => PubSub.shutdown(acceptedHistoryState.pubsub))
      const acceptedHistoryPublication = yield* Semaphore.make(1)
      const publishAcceptedHistory = (runId: RunId, position: JournalPosition) =>
        acceptedHistoryPublication.withPermit(
          SubscriptionRef.get(acceptedHistoryState).pipe(
            Effect.flatMap((current) => {
              /* v8 ignore next -- validated Journal reads reject a foreign Run before publication. */
              if (runId !== expectedRunId)
                return Effect.die(new Error("accepted history cannot publish another Run identity"))
              if (Option.isSome(current) && current.value.position >= position) return Effect.void
              return SubscriptionRef.set(acceptedHistoryState, Option.some(TraceCursor.make({ position, runId })))
            })
          )
        )
      const acceptedHistory = currentSignalFromCurrentFirstStream(
        SubscriptionRef.changes(acceptedHistoryState).pipe(
          Stream.filter(Option.isSome),
          Stream.map((cursor) => cursor.value)
        )
      )
      const exitAwareStorage: JournalStorageBoundary = {
        append: (...input) => observeProducedWrite(`append:${input[1]}`, "append", storage.append(...input)),
        read: storage.read,
        terminateRun: (...input) =>
          observeProducedWrite(`terminate:${input[0]}`, "terminate", lifecycle.terminateRun(...input))
      }
      const processJournal = yield* Ref.make<ProcessJournalHolder>({ _tag: "NotEstablished" })
      const processAcceptedJournalReader = AcceptedJournalReader.of({
        readAccepted: (runId) =>
          Ref.get(processJournal).pipe(
            Effect.flatMap((holder) =>
              holder._tag === "Established"
                ? holder.journal.readAccepted(runId)
                : Effect.die("accepted history was requested before this process established its Journal")
            )
          )
      })
      const journalEstablishment = yield* Semaphore.make(1)

      const installJournalUnlocked = (target: TrackerTarget, initial: ValidWorkflowJournalHistory) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(processJournal)
          if (current._tag === "Failed") return yield* current.failure
          if (current._tag === "Established") {
            if (taskTrackerTargetKey(current.target) !== taskTrackerTargetKey(target)) {
              return yield* new WorkflowRunTargetMismatch({
                recordedTarget: current.target,
                requestedTarget: target,
                runId: expectedRunId
              })
            }
            return current
          }
          const built = yield* Layer.build(
            journalLayer(expectedRunId, target, initial, exitAwareStorage, (record) =>
              // Journal acceptance precedes presentation. The terminal cursor
              // must wait for finish to close status and announce termination,
              // so a current-first history consumer can stop at that cursor.
              record.event._tag === "WorkflowRunTerminated"
                ? Effect.void
                : publishAcceptedHistory(record.runId, record.position)
            )
          ).pipe(Scope.provide(bootstrapScope), Effect.exit)
          if (built._tag === "Failure") {
            const failure = yield* Effect.failCause(built.cause).pipe(Effect.flip)
            yield* Ref.set(processJournal, { _tag: "Failed", failure })
            return yield* failure
          }
          const context = built.value
          const journal = Context.get(context, Journal)
          const accepted = Context.get(context, AcceptedJournalReader)
          const inRun = Context.get(context, InRunJournal)
          const controlContext = yield* Layer.build(
            controlDirectionApplicationLayer.pipe(
              Layer.provide(Layer.succeed(AcceptedJournalReader, accepted)),
              Layer.provide(Layer.succeed(InRunJournal, inRun))
            )
          ).pipe(Scope.provide(bootstrapScope))
          const establishedJournal: Extract<ProcessJournalHolder, { readonly _tag: "Established" }> = {
            _tag: "Established",
            context,
            controlDirection: Context.get(controlContext, ControlDirectionApplication),
            integrationQuarantineDirection: yield* makeIntegrationQuarantineDirectionControl(inRun).pipe(
              Effect.provideService(AcceptedJournalReader, accepted)
            ),
            journal,
            target
          }
          yield* Ref.set(processJournal, establishedJournal)
          return establishedJournal
        })

      const establishStoredJournal = (requestedTarget?: TrackerTarget) =>
        journalEstablishment.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(processJournal)
            if (current._tag === "Failed") return yield* current.failure
            if (current._tag === "Established") {
              if (
                requestedTarget !== undefined &&
                taskTrackerTargetKey(current.target) !== taskTrackerTargetKey(requestedTarget)
              ) {
                return yield* new WorkflowRunTargetMismatch({
                  recordedTarget: current.target,
                  requestedTarget,
                  runId: expectedRunId
                })
              }
              return Option.some(current)
            }
            const records = yield* lifecycle.read(expectedRunId)
            if (records.length === 0) return Option.none()
            const initial = yield* validateRun(expectedRunId, records)
            const recordedTarget = exactWorkflowRunTargetFor(initial.prefix)
            /* v8 ignore next -- validation accepts a non-empty workflow history only after WorkflowRunBegan. */
            if (recordedTarget === undefined) return yield* Effect.die("validated Run has no established target")
            if (
              requestedTarget !== undefined &&
              taskTrackerTargetKey(recordedTarget) !== taskTrackerTargetKey(requestedTarget)
            ) {
              return yield* new WorkflowRunTargetMismatch({ recordedTarget, requestedTarget, runId: expectedRunId })
            }
            return Option.some(yield* installJournalUnlocked(recordedTarget, initial))
          })
        )
      const acceptedRunReactivationObservers = yield* Ref.make<Option.Option<AcceptedRunReactivationObservers>>(
        Option.none()
      )
      const runtimeState = yield* Ref.make<RuntimeControlState>({ _tag: "RuntimeInactive" })
      const activation = yield* Semaphore.make(1)
      const processRuntimeCapabilities = yield* deliveryRuntimeResourceCapabilitiesOf(
        yield* makeIntegrationTargetResourceController(),
        admission
      )
      const processPlannedAttemptProtocolController = yield* makePlannedAttemptProtocolController()
      const processPassiveObserver = yield* makePassivePlannedAttemptObserver()
      yield* Effect.addFinalizer(() => processRuntimeCapabilities.observation.close)
      const established = yield* Deferred.make<JournaledRunEstablished>()

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

      const withPassivePublicationJournal = <A, E>(
        use: (
          holder: Extract<ProcessJournalHolder, { readonly _tag: "Established" }>,
          publishStoredFactHint: boolean
        ) => Effect.Effect<A, E>
      ) =>
        withRuntimeControls(() =>
          Ref.get(processJournal).pipe(
            Effect.flatMap((holder) =>
              holder._tag === "Established"
                ? use(holder, false)
                : Effect.die("active runtime has no established process Journal")
            )
          )
        ).pipe(
          Effect.catchTag("JournaledRunNotActive", () =>
            Ref.get(processJournal).pipe(
              Effect.flatMap((holder) =>
                holder._tag === "Established"
                  ? withJournalControl(use(holder, true))
                  : Effect.die("passive publication arrived before this process established its Journal")
              )
            )
          )
        )

      const withActivePassivePublicationJournal = <A, E>(
        use: (journal: InRunJournal["Service"]) => Effect.Effect<A, E>
      ) =>
        Ref.get(runtimeState).pipe(
          Effect.flatMap((current) =>
            current._tag === "RuntimeAcceptingControl"
              ? use(InRunJournal.of({ append: current.controls.journal.append, read: current.controls.journal.read }))
              : Effect.die("an admitted executor action lost its active Journal before current publication")
          )
        )

      const releaseAcceptedPlannedAttemptPosition = (result: PlannedAttemptExecutorObservationResult) =>
        result.report._tag === "ExecutorWorkSafelySuspended" || result.report._tag === "ExecutorWorkTerminal"
          ? processRuntimeCapabilities.releasePlannedAttemptPosition(result.report.correlation)
          : Effect.succeed("AlreadyAbsent" as const)

      const passiveProjectionPublication: PassivePlannedAttemptProjectionPublicationService = {
        publish: (plannedAttempt, projection) =>
          withPassivePublicationJournal((holder, publishStoredFactHint) =>
            processPlannedAttemptProtocolController
              .withPermit(plannedAttemptExecutorCorrelation(plannedAttempt), (permit) =>
                publishPlannedAttemptExecutorProjectionResultWithPermit(permit, plannedAttempt, projection).pipe(
                  Effect.provide(holder.context)
                )
              )
              .pipe(
                Effect.tap((result) =>
                  result.acceptedFacts === "Changed" ? releaseAcceptedPlannedAttemptPosition(result) : Effect.void
                ),
                Effect.tap((result) =>
                  publishStoredFactHint && result.acceptedFacts === "Changed"
                    ? Ref.get(acceptedRunReactivationObservers).pipe(
                        Effect.flatMap((observers) =>
                          Option.match(observers, {
                            onNone: () => Effect.void,
                            onSome: ({ acceptedFactPublication }) => acceptedFactPublication()
                          })
                        )
                      )
                    : Effect.void
                )
              )
          ),
        publishWithPermit: (permit, plannedAttempt, projection) =>
          withActivePassivePublicationJournal(() =>
            Ref.get(processJournal).pipe(
              Effect.flatMap((holder) =>
                holder._tag === "Established"
                  ? publishPlannedAttemptExecutorProjectionResultWithPermit(permit, plannedAttempt, projection).pipe(
                      Effect.provide(holder.context)
                    )
                  : Effect.die("active executor publication has no established process Journal")
              )
            )
          )
      }
      const processRuntimeLayer = Layer.mergeAll(
        deliveryRuntimeResourceCapabilitiesLayer(processRuntimeCapabilities),
        Layer.succeed(PassivePlannedAttemptObserver, processPassiveObserver),
        Layer.succeed(PlannedAttemptProtocolController, processPlannedAttemptProtocolController),
        Layer.succeed(
          PassivePlannedAttemptProjectionPublication,
          PassivePlannedAttemptProjectionPublication.of(passiveProjectionPublication)
        )
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
        processJournal: Extract<ProcessJournalHolder, { readonly _tag: "Established" }>,
        initialState: JournalState,
        program: Effect.Effect<RunFinalityProof, E, R>,
        opportunity: RunActivationOpportunity
      ) =>
        Effect.scoped(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const reactivationObservers = yield* Ref.get(acceptedRunReactivationObservers)
              const acceptedPublicationWatermark = yield* Ref.make<JournalPosition | null>(initialState.position)
              const ambientPublicationObserver = yield* DeliveryRelationPublicationObserver
              const publicationObserver = DeliveryRelationPublicationObserver.of({
                observe: (bundle) =>
                  Effect.gen(function* () {
                    yield* ambientPublicationObserver.observe(bundle)
                    const acceptedAt = bundle.actionInputs.runtimeFacts.acceptedAt
                    if (acceptedAt === null) return
                    const advanced = yield* Ref.modify(acceptedPublicationWatermark, (current) =>
                      current !== null && acceptedAt <= current ? [false, current] : [true, acceptedAt]
                    )
                    if (!advanced) return
                    yield* Option.match(reactivationObservers, {
                      onNone: () => Effect.void,
                      onSome: ({ acceptedFactPublication }) => acceptedFactPublication()
                    })
                  })
              })
              const downstream = runtimeLayer({ runId, opportunity }).pipe(
                // Delivery creates reactive relations while running the program, after Layer.build returns.
                Layer.provideMerge(Layer.succeed(DeliveryRelationPublicationObserver, publicationObserver)),
                Layer.provideMerge(processRuntimeLayer),
                Layer.provide(Layer.succeed(ApplicationExitAdmission, admission)),
                Layer.provide(Layer.succeed(CoordinatorOwnership, ownership))
              )
              const runtimeJournalLayer = Layer.succeedContext(processJournal.context)
              const runtime = downstream.pipe(
                Layer.provideMerge(runtimeJournalLayer),
                Layer.provideMerge(Layer.succeed(RunActivationGraphBaseline, initialState.position))
              )
              const context = yield* Layer.build(runtime)
              const journal = processJournal.journal
              yield* applicationExit.registerExecutorDrain({
                suspendExecutingExecutorWork: suspendExecutingExecutorWorkForApplicationExit().pipe(
                  Effect.provide(context)
                )
              })
              const controls: RuntimeControls = {
                attemptChoice: Context.get(context, AttemptChoiceControl),
                controlDirection: Context.get(context, ControlDirectionApplication),
                deliveryRuntimeResources: Context.get(context, DeliveryRuntimeResources),
                integrationQuarantineDirection: processJournal.integrationQuarantineDirection,
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
                          const latestPremiseChange = journalWorkflowFinalityPremiseChangeAt(state.prefix, runId)
                          const changed =
                            latestPremiseChange !== undefined &&
                            (proof.acceptedAt === null || latestPremiseChange > proof.acceptedAt)
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
        journal: Journal["Service"],
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
        if (cancellationSupersedesTerminalEvidence(terminalProof, state)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        }
        const graphRead = terminalGraphReadFor(terminalProof, state)
        if (!terminalProofMatchesGraphRead(terminalProof, runId, target, graphRead)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        }
        const owner = yield* admission.acquireForwardOwner("AuthorizedRunTerminationAppend").pipe(Effect.option)
        if (Option.isNone(owner)) {
          return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        }
        const termination = yield* journal
          .terminate(terminalProof.disposition, terminalProof.evidence)
          .pipe(Effect.ensuring(owner.value.release))
        yield* Ref.update(unresolvedProducedWrites, (current) => {
          return new Map([...current].filter(([key]) => key !== `terminate:${runId}`))
        })
        /* v8 ignore next -- @preserve RunLifecycleJournal.terminateRun returns the acknowledged terminal record. */
        if (termination.event._tag !== "WorkflowRunTerminated") {
          return yield* Effect.die(new Error("Run termination did not return its terminal Journal record"))
        }
        // Run finality closes the process-local status source at the same terminal boundary.
        // Host-scope cleanup remains idempotent, but public observers need the exact final
        // Ready value wrapped as Closed before they can report the terminal disposition.
        yield* processRuntimeCapabilities.observation.close
        yield* Deferred.succeed(
          runTermination,
          JournaledRunTermination.make({
            disposition: termination.event.disposition,
            terminatedAt: TraceCursor.make({ position: termination.position, runId: termination.runId })
          })
        )
        yield* publishAcceptedHistory(termination.runId, termination.position)
        const shouldAttemptRetirement = yield* Ref.modify(startupRetirementAttempts, (attempted) => {
          /* v8 ignore next -- @preserve lifecycle.terminateRun accepts one terminal append per Run; a second finish for the same Run is rejected before this guard. */
          if (attempted.has(runId)) return [false, attempted] as const
          return [true, new Set([...attempted, runId])] as const
        })
        /* v8 ignore next -- @preserve the preceding lifecycle invariant makes this false branch unreachable; repeated inspections use StartupRecovery's guard. */
        if (shouldAttemptRetirement) {
          yield* lifecycle
            .retireTerminalRun(runId)
            .pipe(
              Effect.catch((failure) => maintenanceObservation.observe(journalMaintenanceDiagnosticFor(runId, failure)))
            )
        }
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

      type ActivationProgram<E, R> = (opportunity: RunActivationOpportunity) => Effect.Effect<RunFinalityProof, E, R>

      const activateWithOpportunity = <EInitial, RInitial, E, R>(
        target: TrackerTarget,
        initialControlPolicySource: Effect.Effect<InitialControlPolicy, EInitial, RInitial>,
        runId: AllocatedWorkflowRunId,
        program: ActivationProgram<E, R>,
        opportunityFor: (state: JournalState) => RunActivationOpportunity
      ) =>
        activation.withPermit(
          Effect.acquireUseRelease(
            admission.acquireForwardOwner("RunActivation"),
            () =>
              Effect.gen(function* () {
                if (runId !== expectedRunId) {
                  return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: runId })
                }
                const process = yield* journalEstablishment.withPermit(
                  Effect.gen(function* () {
                    const cached = yield* Ref.get(processJournal)
                    if (cached._tag === "Failed") return yield* cached.failure
                    if (cached._tag === "Established") {
                      if (taskTrackerTargetKey(cached.target) !== taskTrackerTargetKey(target)) {
                        return yield* new WorkflowRunTargetMismatch({
                          recordedTarget: cached.target,
                          requestedTarget: target,
                          runId
                        })
                      }
                      return cached
                    }
                    const initial = yield* inspectStartupRecovery(
                      runId,
                      lifecycle,
                      maintenanceObservation,
                      startupRetirementAttempts
                    )
                    if (initial === undefined) {
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
                                return new Map([...current].filter(([key]) => key !== `begin:${runId}`))
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
                      yield* lifecycle.readRunForRecovery(runId, target)
                      return yield* installJournalUnlocked(
                        target,
                        yield* validateRun(runId, yield* lifecycle.read(runId))
                      )
                    }
                    /* v8 ignore next -- inspectStartupRecovery rejects every invalid reduction before selecting this Run. */
                    if (initial._tag !== "ValidWorkflowJournalHistory") {
                      return yield* Effect.die("startup inspection returned invalid selected history")
                    }
                    const terminated = lastJournalRecordOfKind(initial.prefix, "WorkflowRunTerminated")
                    if (terminated !== undefined) {
                      return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })
                    }
                    const recordedTarget = exactWorkflowRunTargetFor(initial.prefix)
                    /* v8 ignore next -- startup validation requires WorkflowRunBegan for every non-empty valid history. */
                    if (recordedTarget === undefined)
                      return yield* Effect.die("validated Run has no established target")
                    if (taskTrackerTargetKey(recordedTarget) !== taskTrackerTargetKey(target)) {
                      return yield* new WorkflowRunTargetMismatch({ recordedTarget, requestedTarget: target, runId })
                    }
                    return yield* installJournalUnlocked(target, initial)
                  })
                )
                const state = yield* process.journal.state.get
                const terminal = lastJournalRecordOfKind(state.prefix, "WorkflowRunTerminated")
                if (terminal !== undefined) {
                  return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminal.position })
                }
                const acceptedAt = state.position
                yield* publishAcceptedHistory(runId, acceptedAt)
                yield* Deferred.succeed(established, JournaledRunEstablished.make({ acceptedAt, runId, target }))
                const opportunity = opportunityFor(state)
                const activationProgram = program(opportunity)
                return yield* finish(
                  runId,
                  target,
                  process.journal,
                  yield* runWithJournal(runId, target, process, state, activationProgram, opportunity)
                )
              }),
            (activationOwner) => activationOwner.release
          )
        )

      const activate: JournaledRunBootstrapService["activate"] = (
        target,
        initialControlPolicySource,
        runId,
        program,
        opportunity = RunActivationOpportunity.OrdinaryRunEntry()
      ) =>
        activateWithOpportunity(
          target,
          initialControlPolicySource,
          runId,
          () => program,
          () => opportunity
        )

      const activateActiveWorkAuthorityRefresh: JournaledRunBootstrapService["activateActiveWorkAuthorityRefresh"] = (
        target,
        initialControlPolicySource,
        runId,
        program,
        source
      ) =>
        activateWithOpportunity(target, initialControlPolicySource, runId, program, (state) =>
          activeWorkAuthorityRefreshForOwner(source, activeWorkAuthorityRefreshSubjectsForRunState(state.reconstructed))
        )

      const readRunReactivationControl: JournaledRunBootstrapService["readRunReactivationControl"] = (target, runId) =>
        Effect.gen(function* () {
          if (runId !== expectedRunId) {
            return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: runId })
          }
          const establishedJournal = yield* establishStoredJournal(target)
          if (Option.isNone(establishedJournal)) return "RunUnpaused" as const
          const state = yield* establishedJournal.value.journal.state.get
          if (lastJournalRecordOfKind(state.prefix, "WorkflowRunTerminated") !== undefined) {
            return "RunTerminated" as const
          }
          return state.reconstructed.pause.run._tag === "RunPaused" ? ("RunPaused" as const) : ("RunUnpaused" as const)
        })

      const registerAcceptedRunReactivationObservers: JournaledRunBootstrapService["registerAcceptedRunReactivationObservers"] =
        (observers) =>
          Ref.modify(acceptedRunReactivationObservers, (current) =>
            Option.isSome(current)
              ? ([Option.none(), current] as const)
              : ([Option.some(undefined), Option.some(observers)] as const)
          ).pipe(
            Effect.flatMap((registered) =>
              Option.isSome(registered)
                ? Effect.void
                : Effect.fail(new JournaledRunReactivationObserverAlreadyRegistered())
            )
          )

      const applyRunCancellationTo = (journal: Journal["Service"], runId: RunId) =>
        Effect.gen(function* () {
          const state = yield* journal.state.get
          const terminated = lastJournalRecordOfKind(state.prefix, "WorkflowRunTerminated")
          if (terminated?.event._tag === "WorkflowRunTerminated") {
            return AppliedRunCancellation.cases.RunCancellationRunTerminated.make({
              disposition: terminated.event.disposition,
              terminatedAt: terminated.position
            })
          }
          const existing = firstJournalRecordOfKind(state.prefix, "RunCancellationApplied")
          if (existing !== undefined) {
            return AppliedRunCancellation.cases.RunCancellationAlreadyApplied.make({ appliedAt: existing.position })
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

      const readInactiveRunCancellationFrom = (journal: Journal["Service"]) =>
        Effect.gen(function* () {
          const state = yield* journal.state.get
          const terminated = lastJournalRecordOfKind(state.prefix, "WorkflowRunTerminated")
          if (terminated?.event._tag === "WorkflowRunTerminated") {
            return AppliedRunCancellation.cases.RunCancellationRunTerminated.make({
              disposition: terminated.event.disposition,
              terminatedAt: terminated.position
            })
          }
          return yield* new JournaledRunNotActive()
        })

      const operatorControl: JournaledRunBootstrapService["operatorControl"] = {
        applyRunCancellation: (input) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(ApplyRunCancellationRequest, {
              onExcessProperty: "error"
            })(input)
            if (request.runId !== expectedRunId) {
              return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: request.runId })
            }
            return yield* withRuntimeControls(({ journal, runId }) => applyRunCancellationTo(journal, runId)).pipe(
              Effect.catchTag("JournaledRunNotActive", () =>
                Effect.gen(function* () {
                  const holder = yield* establishStoredJournal()
                  if (Option.isNone(holder)) return yield* new JournaledRunNotActive()
                  return yield* withJournalControl(readInactiveRunCancellationFrom(holder.value.journal))
                })
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
            return yield* withRuntimeControls(({ integrationQuarantineDirection }) =>
              integrationQuarantineDirection.apply(request)
            ).pipe(
              Effect.catchTag("JournaledRunNotActive", () =>
                Effect.gen(function* () {
                  const holder = yield* establishStoredJournal()
                  if (Option.isNone(holder)) return yield* new WorkflowRunNotBegan({ runId: expectedRunId })
                  return yield* withJournalControl(holder.value.integrationQuarantineDirection.apply(request))
                })
              )
            )
          }),
        applyAttemptChoice: (input) => withRuntimeControls(({ attemptChoice }) => attemptChoice.apply(input)),
        applyControlDirection: (input) =>
          Effect.gen(function* () {
            const request = yield* Schema.decodeUnknownEffect(ApplyControlDirectionRequest, {
              onExcessProperty: "error"
            })(input)
            if (request.subject._tag === "Run" && request.subject.runId !== expectedRunId) {
              return yield* new JournaledRunIdentityMismatch({ expectedRunId, requestedRunId: request.subject.runId })
            }
            const publishAcceptedRunControl = Ref.get(acceptedRunReactivationObservers).pipe(
              Effect.flatMap((observer) =>
                Option.match(observer, {
                  onNone: () => Effect.void,
                  onSome: ({ control }) => control(request.direction)
                })
              )
            )
            const applied =
              request.subject._tag === "Run"
                ? withRuntimeControls(
                    ({ controlDirection, operationIdAllocator, runId, target, workflowInterpreter, workflowTrace }) =>
                      applyOperatorControlDirection(runId, target, request, {
                        allocator: operationIdAllocator,
                        application: controlDirection,
                        graphReadBoundary: operatorControlGraphReadBoundary,
                        interpreter: workflowInterpreter,
                        trace: workflowTrace
                      }).pipe(Effect.tap(() => publishAcceptedRunControl))
                  ).pipe(
                    Effect.catchTag("JournaledRunNotActive", () =>
                      Effect.gen(function* () {
                        const holder = yield* establishStoredJournal()
                        if (Option.isNone(holder)) return yield* new WorkflowRunNotBegan({ runId: expectedRunId })
                        return yield* withJournalControl(
                          holder.value.controlDirection.apply(request).pipe(Effect.tap(() => publishAcceptedRunControl))
                        )
                      })
                    )
                  )
                : withRuntimeControls(
                    ({ controlDirection, operationIdAllocator, runId, target, workflowInterpreter, workflowTrace }) =>
                      applyOperatorControlDirection(runId, target, request, {
                        allocator: operationIdAllocator,
                        application: controlDirection,
                        graphReadBoundary: operatorControlGraphReadBoundary,
                        interpreter: workflowInterpreter,
                        trace: workflowTrace
                      })
                  )
            return yield* applied
          }),
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
            return yield* withRuntimeControls(({ integrationQuarantineDirection }) =>
              integrationQuarantineDirection.read(request)
            ).pipe(
              Effect.catchTag("JournaledRunNotActive", () =>
                Effect.gen(function* () {
                  const holder = yield* establishStoredJournal()
                  if (Option.isNone(holder)) {
                    return yield* new IntegrationQuarantineDirectionResultNotFound({ requestId: request.requestId })
                  }
                  return yield* withJournalControl(holder.value.integrationQuarantineDirection.read(request))
                })
              )
            )
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

      const bootstrap = JournaledRunBootstrap.of({
        activate,
        activateActiveWorkAuthorityRefresh,
        readRunReactivationControl,
        registerAcceptedRunReactivationObservers,
        operatorControl
      })
      const observation = JournaledRunObservationSource.of({
        acceptedHistory,
        awaitEstablished: Deferred.await(established),
        current: processRuntimeCapabilities.resources.runtimeObservation,
        runTermination: {
          await: Deferred.await(runTermination),
          poll: Deferred.poll(runTermination).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(Option.none<JournaledRunTermination>()),
                onSome: Effect.map(Option.some)
              })
            )
          )
        }
      })
      return Context.empty().pipe(
        Context.add(AcceptedJournalReader, processAcceptedJournalReader),
        Context.add(JournaledRunBootstrap, bootstrap),
        Context.add(JournaledRunObservationSource, observation)
      )
    })
  )
