/* eslint-disable max-lines -- One driver keeps the Run-entry action-to-production-seam map auditable. */
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Context, Deferred, Effect, Fiber, Layer, Match, Option, Queue, Schema, Scope, Stream } from "effect"
import { expect } from "vitest"
import {
  InitialControlPolicy,
  JournalPosition,
  JournalRecordKey,
  type JournalRecord,
  JournalStore,
  makeApplicationExitShell,
  makeApplicationExitLifecycle,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  RunPolicyRevision,
  TaskAttemptPlannedEvent,
  TaskWorkCapacity,
  TaskWorkCapacityChangedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { makeCompleteTaskTrackerFactsObserved, taskTrackerFactsObservedEvent } from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../../../orchestrator/src/workflow/registry/event.js"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import type { TrackerTarget } from "../../../orchestrator/src/authorities/task-tracker/target.js"
import { makeIntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeDeliveryRuntimeAdmissionController } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  trackerGraphReadProposalOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import {
  deriveRunFinalityDecision,
  makeRunFinalityEvidence,
  RunFinalityReadShape,
  type RunFinalityEvidence
} from "../../../orchestrator/src/coordination/frontier/run-finality.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { deliveryRuntime } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-adapter.js"
import { makeReactiveDeliveryRelationsLayer } from "../../../orchestrator/src/coordination/delivery/reactive-delivery-relations.js"
import { Journal } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { RunRecoveryProjection } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { AllocatedWorkflowRunId } from "../../../orchestrator/src/coordination/run/fresh-run-identity.js"
import { journaledRunBootstrapLayer } from "../../../orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import { JournaledRunBootstrap } from "../../../orchestrator/src/coordination/run/run.js"
import { validatedRunActivationLayer } from "../../../orchestrator/src/coordination/run/startup-recovery.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  runCancellationAppliedRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import {
  type JournalStoreService,
  journalStoreCapabilities,
  RunLifecycleJournal
} from "../../../orchestrator/src/workflow-journal/store.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { deterministicOperationIdAllocatorLayer } from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import {
  makeTaskAttemptPlanOperation,
  makeTrackerGraphObservationOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import { attemptChoiceControlLayer } from "../../../orchestrator/src/workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../../orchestrator/src/workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-reacquisition/control.js"
import { taskWorkCapacityControlLayer } from "../../../orchestrator/src/control/task-work-capacity.js"
import { PlannedAttemptProtocolController } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { continuePlannedAttemptExecutorWork } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/guarded-protocol.js"
import { RunFinalityDecision } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import { RunCancellationAppliedEvent } from "../../../orchestrator/src/workflow/protocols/run-cancellation/events.js"

const HistoryVariant = Schema.Struct({
  tag: Schema.Literals([
    "EmptyHistory",
    "InvalidHistory",
    "MultipleUnfinishedHistories",
    "OneUnfinishedHistory",
    "TerminatedHistory"
  ]),
  value: Schema.Unknown
})
const PhaseVariant = Schema.Struct({
  tag: Schema.Literals(["ActivatingRun", "ActivationReturned", "EntryFailed", "EntryIdle", "EstablishingRun"]),
  value: Schema.Unknown
})
const SourceVariant = Schema.Struct({
  tag: Schema.Literals(["BeginningAppended", "ExistingHistoryReduced", "NoEstablishmentSource"]),
  value: Schema.Unknown
})
const EntryFailureVariant = Schema.Struct({
  tag: Schema.Literals([
    "DuplicateBeginningFailure",
    "ForeignRunRecordFailure",
    "InvalidChronologyFailure",
    "MultipleUnfinishedRunsFailure",
    "NoEntryFailure",
    "OtherUnfinishedRunFailure",
    "TargetMismatchFailure",
    "TerminatedRunFailure"
  ]),
  value: Schema.Unknown
})
const RunIdVariant = Schema.Struct({ tag: Schema.Literals(["R1", "R2"]), value: Schema.Unknown })
const TargetVariant = Schema.Struct({ tag: Schema.Literals(["Target1", "Target2"]), value: Schema.Unknown })
const CapacityVariant = Schema.Struct({ tag: Schema.Literals(["Capacity1", "Capacity2"]), value: Schema.Unknown })
const AttemptIdVariant = Schema.Struct({
  tag: Schema.Literals(["AttemptA", "AttemptB", "AttemptC"]),
  value: Schema.Unknown
})
const EstablishedRunVariant = Schema.Union([
  Schema.Struct({ tag: Schema.Literal("NoEstablishedRun"), value: Schema.Unknown }),
  Schema.Struct({
    tag: Schema.Literal("ExactEstablishedRun"),
    value: Schema.Struct({
      initialPolicy: Schema.Struct({ taskCapacity: CapacityVariant }),
      latestPolicy: Schema.Struct({ taskCapacity: CapacityVariant }),
      runId: RunIdVariant,
      target: TargetVariant
    })
  })
])
const PositionVariant = Schema.Union([
  Schema.Struct({ tag: Schema.Literal("NoTaskPosition"), value: Schema.Unknown }),
  Schema.Struct({
    tag: Schema.Literal("ExactTaskPosition"),
    value: Schema.Struct({ attemptId: AttemptIdVariant, runId: RunIdVariant })
  })
])
const TerminalDisposition = Schema.Struct({
  tag: Schema.Literals(["NoTerminal", "Completed", "Blocked", "Cancelled"]),
  value: Schema.Unknown
})
const GraphOutcome = Schema.Struct({
  tag: Schema.Literals(["GraphAllSucceeded", "GraphBlocked", "GraphUnsettled"]),
  value: Schema.Unknown
})
const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    durable: Schema.Struct({
      history: HistoryVariant,
      independentTaskSettled: Schema.Boolean,
      cancellationApplied: Schema.Boolean,
      terminationDisposition: TerminalDisposition
    }),
    requestedRunId: RunIdVariant,
    requestedTarget: TargetVariant,
    trackerFinality: Schema.Struct({ targetSettled: Schema.Boolean, graphOutcome: GraphOutcome }),
    process: Schema.Struct({
      establishedRun: EstablishedRunVariant,
      entryFailure: EntryFailureVariant,
      establishmentSource: SourceVariant,
      heldPosition: PositionVariant,
      otherHeldPosition: PositionVariant,
      independentTaskAdmitted: Schema.Boolean,
      initialPolicyEvaluated: Schema.Boolean,
      initialTrackerObserved: Schema.Boolean,
      phase: PhaseVariant,
      postQuiescenceReads: ITFBigInt,
      quiescent: Schema.Boolean,
      terminalDisposition: TerminalDisposition
    }),
    trace: Schema.Struct({
      activationsStarted: ITFBigInt,
      beginningAppends: ITFBigInt,
      cancellationAppends: ITFBigInt,
      cancellationRedeliveries: ITFBigInt,
      executorCalls: ITFBigInt,
      initialPolicyEvaluations: ITFBigInt,
      processLosses: ITFBigInt,
      terminationAppends: ITFBigInt,
      trackerCalls: ITFBigInt
    })
  })
})

const runId = RunId.make("run-activation-R1")
const otherRunId = RunId.make("run-activation-R2")
const target = FixtureTarget.make("run-activation-T1")
const otherTarget = FixtureTarget.make("run-activation-T2")
const taskA = TaskId.make("run-activation-A")
const taskB = TaskId.make("run-activation-B")
const taskC = TaskId.make("run-activation-capacity-sentinel")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const earlierPolicy = initialPolicy
const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
const ownershipLayer = Layer.succeed(CoordinatorOwnership, ownership)

const attemptFor = (taskId: TaskId, suffix: string) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`run-activation-${suffix}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/run-activation-${suffix}`),
    executor: TaskExecutorLocator.make("executor:run-activation"),
    runId,
    taskId,
    taskRevision: TaskRevision.make(`run-activation-revision-${suffix}`),
    worktree: WorktreeLocator.make(`/worktrees/run-activation-${suffix}`)
  })

const attemptA = attemptFor(taskA, "A")
const attemptB = attemptFor(taskB, "B")
const attemptC = attemptFor(taskC, "C")

const snapshotForGraphOutcome = (outcome: "GraphAllSucceeded" | "GraphBlocked" | "GraphUnsettled") => {
  const tasks = outcome === "GraphBlocked"
    ? [
        { id: taskA, lifecycle: { _tag: "TerminalWithoutSuccess" as const }, parentTaskId: null, prerequisiteIds: [] },
        { id: taskB, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [taskA] }
      ]
    : [{
        id: taskA,
        lifecycle: { _tag: outcome === "GraphAllSucceeded" ? "CompletedSuccessfully" as const : "Open" as const },
        parentTaskId: null,
        prerequisiteIds: []
      }]
  const projected = projectTrackerSnapshot({ revision: `run-activation-${outcome}`, tasks })
  if (projected._tag !== "Valid") throw new Error(`invalid finality fixture graph: ${JSON.stringify(projected.issues)}`)
  return projected.snapshot
}

const finalityEvidenceFor = (
  eventRunId: RunId,
  eventTarget: TrackerTarget,
  outcome: "GraphAllSucceeded" | "GraphBlocked" | "GraphUnsettled",
  observedAt: JournalPosition
): RunFinalityEvidence => {
  const snapshot = snapshotForGraphOutcome(outcome)
  const operationId = OperationId.make(`run-activation-fixture-finality-${observedAt}`)
  return makeRunFinalityEvidence({
    operationId,
    observedAt,
    readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: snapshot.taskIds() }),
    rootPresent: true,
    runId: eventRunId,
    snapshot,
    target: eventTarget
  })
}

type HistoryTag =
  | "EmptyHistory"
  | "InvalidHistory"
  | "MultipleUnfinishedHistories"
  | "OneUnfinishedHistory"
  | "TerminatedHistory"
type Phase = "ActivatingRun" | "ActivationReturned" | "EntryFailed" | "EntryIdle" | "EstablishingRun"
type Source = "BeginningAppended" | "ExistingHistoryReduced" | "NoEstablishmentSource"
type Position = "AttemptA" | "AttemptB" | "AttemptC" | "NoTaskPosition"
type RunTag = "R1" | "R2"
type TargetTag = "Target1" | "Target2"
type CapacityTag = "Capacity1" | "Capacity2"
type EntryFailureTag =
  | "DuplicateBeginningFailure"
  | "ForeignRunRecordFailure"
  | "InvalidChronologyFailure"
  | "MultipleUnfinishedRunsFailure"
  | "NoEntryFailure"
  | "OtherUnfinishedRunFailure"
  | "TargetMismatchFailure"
  | "TerminatedRunFailure"
type TerminalDispositionTag = "NoTerminal" | "Completed" | "Blocked" | "Cancelled"
type GraphOutcomeTag = "GraphAllSucceeded" | "GraphBlocked" | "GraphUnsettled"
type ActivationCommandTag =
  | "ActivateEstablishedRun"
  | "ApplyCancellation"
  | "AdmitIndependentTask"
  | "ReadInitialTrackerGraph"
  | "ReadPostQuiescenceTrackerGraph"
  | "ReachQuiescence"
  | "ReconcileAmbiguousExecutorCommand"
  | "ReturnIncomplete"
  | "RedeliverCancellation"
  | "SettleIndependentTask"
  | "SettleOtherRetainedAttempt"
  | "SettleRetainedAttempt"
  | "TerminateRun"
  | "TrackerFactsBecomeSettled"

interface ActivationCommand {
  readonly acknowledged: Deferred.Deferred<void>
  readonly tag: ActivationCommandTag
}

let runActivationMbtScope: Scope.Scope | undefined

interface DriverProjection {
  readonly activationsStarted: number
  readonly beginningAppends: number
  readonly cancellationAppends: number
  readonly cancellationRedeliveries: number
  readonly cancellationApplied: boolean
  readonly establishmentSource: Source
  readonly entryFailure: EntryFailureTag
  readonly establishedCapacity: CapacityTag | "NoEstablishedCapacity"
  readonly establishedInitialCapacity: CapacityTag | "NoEstablishedCapacity"
  readonly establishedRunId: RunTag | "NoEstablishedRun"
  readonly establishedTarget: TargetTag | "NoEstablishedTarget"
  readonly executorCalls: number
  readonly heldPosition: Position
  readonly history: HistoryTag
  readonly independentTaskAdmitted: boolean
  readonly independentTaskSettled: boolean
  readonly initialPolicyEvaluated: boolean
  readonly initialPolicyEvaluations: number
  readonly initialTrackerObserved: boolean
  readonly otherHeldPositions: number
  readonly phase: Phase
  readonly postQuiescenceReads: number
  readonly processLosses: number
  readonly quiescent: boolean
  readonly requestedRunId: RunTag
  readonly requestedTarget: TargetTag
  readonly terminationAppends: number
  readonly terminationDisposition: TerminalDispositionTag
  readonly terminalDisposition: TerminalDispositionTag
  readonly graphOutcome: GraphOutcomeTag
  readonly trackerCalls: number
  readonly trackerSettled: boolean
}

const runActivationActions = {
  activateEstablishedRun: {},
  applyCancellation: {},
  admitIndependentTask: {},
  crash: {},
  establishAbsentHistory: {},
  establishExistingHistory: {},
  init: {},
  invokeSameEntryAgain: {},
  reachQuiescence: {},
  readInitialTrackerGraph: {},
  readPostQuiescenceTrackerGraph: {},
  rejectInvalidHistory: {},
  rejectMismatchedHistory: {},
  rejectMultipleUnfinishedHistories: {},
  rejectTerminatedHistory: {},
  returnIncomplete: {},
  redeliverCancellation: {},
  selectContractedExactExistingHistory: {},
  selectDuplicateBeginningHistory: {},
  selectExactExistingHistory: {},
  selectExactExistingHistoryWithoutResponsibility: {},
  selectForeignRunRecordHistory: {},
  selectInvalidHistory: {},
  selectMismatchedExistingHistory: {},
  selectMultipleUnfinishedHistories: {},
  selectOtherUnfinishedRun: {},
  selectTerminatedHistory: {},
  selectBlockedRunGraph: {},
  selectCancelledRunGraph: {},
  settleIndependentTask: {},
  settleOtherRetainedAttempt: {},
  settleRetainedAttempt: {},
  terminateRun: {},
  trackerFactsBecomeSettled: {}
} as const

const makeRunActivationDriverImplementation = () => {
  let records: ReadonlyArray<JournalRecord> = []
  let otherRecords: ReadonlyArray<JournalRecord> = []
  let activationCommands: Queue.Queue<ActivationCommand> | undefined
  let awaitActivation: Effect.Effect<void, unknown> | undefined
  let interruptActivation: Effect.Effect<void> | undefined
  let requestedRunId = runId
  let history: HistoryTag = "EmptyHistory"
  let phase: Phase = "EntryIdle"
  let establishmentSource: Source = "NoEstablishmentSource"
  let entryFailure: EntryFailureTag = "NoEntryFailure"
  let establishedRunId: DriverProjection["establishedRunId"] = "NoEstablishedRun"
  let establishedTarget: DriverProjection["establishedTarget"] = "NoEstablishedTarget"
  let establishedCapacity: DriverProjection["establishedCapacity"] = "NoEstablishedCapacity"
  let establishedInitialCapacity: DriverProjection["establishedInitialCapacity"] = "NoEstablishedCapacity"
  let heldPosition: Position = "NoTaskPosition"
  let otherHeldPositions = 0
  let initialPolicyEvaluated = false
  let initialTrackerObserved = false
  let independentTaskAdmitted = false
  let independentTaskSettled = false
  let quiescent = false
  let postQuiescenceReads = 0
  let initialPolicyEvaluations = 0
  let beginningAppends = 0
  let terminationAppends = 0
  let activationsStarted = 0
  let trackerCalls = 0
  let executorCalls = 0
  let processLosses = 0
  let trackerSettled = false
  let graphOutcome: GraphOutcomeTag = "GraphAllSucceeded"
  let cancellationApplied = false
  let cancellationAppends = 0
  let cancellationRedeliveries = 0
  let terminalDisposition: TerminalDispositionTag = "NoTerminal"
  let terminationDisposition: TerminalDispositionTag = "NoTerminal"
  let finalityEvidence: RunFinalityEvidence | undefined
  let latestCapacity = 1
  let ambiguousExecutorProjectionAvailable = false
  let executorCommandCalls = 0
  let executorProjectionCalls = 0

  const append = (eventRunId: RunId, key: JournalRecordKey, event: JournalRecord["event"]): JournalRecord => {
    const selected = eventRunId === runId ? records : otherRecords
    const record = {
      event,
      key,
      position: JournalPosition.make(selected.length + 1),
      runId: eventRunId
    } satisfies JournalRecord
    if (eventRunId === runId) records = [...records, record]
    else otherRecords = [...otherRecords, record]
    return record
  }

  const begin = (eventRunId: RunId, eventTarget: TrackerTarget, policy: InitialControlPolicy): JournalRecord => {
    const selected = eventRunId === runId ? records : otherRecords
    const decision = decideWorkflowRunBeginning(selected, eventRunId, eventTarget, policy)
    if (decision._tag !== "LifecycleTransitionAccepted") throw new Error("Run activation fixture failed to begin")
    if (eventRunId === runId) records = [...records, decision.record]
    else otherRecords = [...otherRecords, decision.record]
    return decision.record
  }

  const capacityChangeEvent = (capacity: number) =>
    TaskWorkCapacityChangedEvent.make({
      capacity: TaskWorkCapacity.make(capacity),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      previousRevision: RunPolicyRevision.make(1),
      revision: RunPolicyRevision.make(2),
      version: workflowJournalEventVersion
    })

  const appendCapacityChange = (capacity = 1): void => {
    append(runId, JournalRecordKey.make("run-policy:2:task-work-capacity"), capacityChangeEvent(capacity))
  }

  const appendResponsibility = (plannedAttempt: PlannedTaskAttempt): void => {
    const operation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make(`plan-${plannedAttempt.attemptId}`),
      plannedAttempt,
      predecessorOperationIds: []
    })
    append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion })
    )
    append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
  }

  const appendUnsettledStartIntent = (plannedAttempt: PlannedTaskAttempt): void => {
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  }

  const journal = JournalStore.of({
    append: (eventRunId, key, event) => Effect.sync(() => append(eventRunId, key, event)),
    beginRun: (eventRunId, eventTarget, policy) => Effect.sync(() => begin(eventRunId, eventTarget, policy)),
    read: (eventRunId) => Effect.succeed(eventRunId === runId ? records : otherRecords),
    readRunForRecovery: (eventRunId, eventTarget) =>
      readRecoverableRunBeginning(eventRunId === runId ? records : otherRecords, eventRunId, eventTarget),
    scan: () =>
      Effect.succeed({
        issues: [],
        runs: [
          ...(records.length === 0 ? [] : [{ records, runId }]),
          ...(otherRecords.length === 0 ? [] : [{ records: otherRecords, runId: otherRunId }])
        ]
      }),
    terminateRun: (eventRunId, disposition, evidence) =>
      Effect.sync(() => {
        const decision = decideWorkflowRunTermination(
          eventRunId === runId ? records : otherRecords,
          eventRunId,
          disposition,
          evidence
        )
        if (decision._tag !== "LifecycleTransitionAccepted") throw decision.failure
        if (eventRunId === runId) records = [...records, decision.record]
        else otherRecords = [...otherRecords, decision.record]
        return decision.record
      })
  }) satisfies JournalStoreService

  const executor = PlannedAttemptExecutor.of({
    project: (correlation) =>
      Effect.sync(() => {
        executorProjectionCalls += 1
        return ambiguousExecutorProjectionAvailable &&
          correlation.attemptId === attemptA.attemptId &&
          correlation.runId === runId
          ? PlannedAttemptExecutorProjection.cases.Exact.make({
              report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
            })
          : PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
      }),
    requestSuspension: () => Effect.die("Run activation reconstruction does not suspend executor work"),
    startOrContinue: () =>
      Effect.sync(() => {
        executorCommandCalls += 1
      }).pipe(Effect.andThen(Effect.die("ambiguous command must reconcile before continuation")))
  })
  const interpreter = WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("Run activation model does not acquire a tracker claim"),
    readTaskClaim: () => Effect.die("Run activation model does not read a tracker claim"),
    readTaskWorktree: () => Effect.die("Run activation model does not read Git"),
    readTargetLineage: () => Effect.die("Run activation model does not read Git lineage"),
    readTrackerGraph: () => Effect.die("tracker reads are activation-level facts in this subject model"),
    readTaskWorkSpecification: () => Effect.die("Run activation model does not read task specifications"),
    reconcileTaskWorktree: () => Effect.die("Run activation model does not reconcile Git"),
    recordTaskAttemptPlan: () => Effect.die("Run activation model does not plan a fresh attempt"),
    releaseTaskClaim: () => Effect.die("Run activation model does not release tracker claims")
  })

  const withBootstrap = <A, E, R>(
    expectedRunId: RunId,
    use: (service: JournaledRunBootstrap["Service"]) => Effect.Effect<A, E, R>
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, journal)))
        const dependencies = Layer.mergeAll(
          Layer.succeed(JournalStore, journal),
          Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
          ownershipLayer
        )
        const runtimeLayer = ({ runId: activeRunId }: { readonly runId: RunId }) => {
          const controls = Layer.mergeAll(
            attemptChoiceControlLayer,
            controlDirectionApplicationLayer,
            taskClaimReacquisitionControlLayer,
            taskWorkCapacityControlLayer
          )
          return validatedRunActivationLayer(activeRunId, undefined).pipe(
            Layer.provide(
              journaledWorkflowInterpreterLayer(activeRunId, Layer.succeed(WorkflowInterpreter, interpreter))
            ),
            Layer.provide(controls),
            Layer.provide(deterministicOperationIdAllocatorLayer(`run-activation:${activeRunId}`)),
            Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
            Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
          )
        }
        const context = yield* Layer.build(
          journaledRunBootstrapLayer(
            expectedRunId,
            runtimeLayer,
            yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
          ).pipe(Layer.provide(dependencies))
        )
        return yield* use(Context.get(context, JournaledRunBootstrap))
      })
    )

  const selectExisting = (withResponsibility: boolean, contracted = false): void => {
    records = []
    begin(runId, target, earlierPolicy)
    if (contracted) {
      appendResponsibility(attemptA)
      appendResponsibility(attemptB)
      appendCapacityChange()
    } else {
      appendCapacityChange()
      if (withResponsibility) appendResponsibility(attemptA)
    }
    history = "OneUnfinishedHistory"
    latestCapacity = 1
  }

  const setProcessIdle = (): void => {
    phase = "EntryIdle"
    establishmentSource = "NoEstablishmentSource"
    entryFailure = "NoEntryFailure"
    establishedRunId = "NoEstablishedRun"
    establishedTarget = "NoEstablishedTarget"
    establishedCapacity = "NoEstablishedCapacity"
    establishedInitialCapacity = "NoEstablishedCapacity"
    heldPosition = "NoTaskPosition"
    otherHeldPositions = 0
    initialPolicyEvaluated = false
    initialTrackerObserved = false
    independentTaskAdmitted = false
    terminalDisposition = "NoTerminal"
    finalityEvidence = undefined
    quiescent = false
    postQuiescenceReads = 0
  }

  const sendActivationCommand = (tag: ActivationCommandTag): Effect.Effect<void> =>
    Effect.gen(function* () {
      const commands = activationCommands
      if (commands === undefined) return yield* Effect.die("Run activation callback is not active")
      const completion = awaitActivation
      if (completion === undefined) return yield* Effect.die("Run activation completion was not installed")
      const acknowledged = yield* Deferred.make<void>()
      const accepted = yield* Queue.offer(commands, { acknowledged, tag })
      if (!accepted) return yield* Effect.die("Run activation callback rejected a command while modeled active")
      yield* Effect.raceFirst(
        Deferred.await(acknowledged),
        completion.pipe(
          Effect.andThen(Deferred.poll(acknowledged)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die("Run activation callback exited before acknowledging its command"),
              onSome: () => Effect.void
            })
          )
        )
      ).pipe(Effect.orDie)
    })

  const proposalForC = trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  })
  const admissionProposalC = {
    ...proposalForC,
    admission: {
      integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
      plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
      taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId: taskC }
    },
    id: DeliveryProposalId.make("run-activation-capacity-sentinel")
  }

  const startEntry = (source: Source) =>
    Effect.gen(function* () {
      const commands = yield* Queue.unbounded<ActivationCommand>()
      const ready = yield* Deferred.make<void>()
      activationCommands = commands
      const activation = withBootstrap(requestedRunId, (service) =>
        service.activate(
          target,
          source === "BeginningAppended"
            ? Effect.succeed(initialPolicy)
            : Effect.die("an established Run must not evaluate a replacement initial policy"),
          AllocatedWorkflowRunId.make(requestedRunId),
          Effect.gen(function* () {
            const recovery = yield* RunRecoveryProjection
            const protocolController = yield* PlannedAttemptProtocolController
            const journal = yield* Journal
            const current = reduceWorkflowJournalHistory(runId, records)
            if (current._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die("activation history invalid")
            if (current.runState.responsibility.entries.length > 0) {
              const retainedFinality = deriveRunFinalityDecision(
                { explanations: [], transitions: [] },
                current.runState.responsibility,
                true
              )
              if (
                retainedFinality._tag !== "RunMustRemainActive" ||
                retainedFinality.reason !== "UnsettledResponsibility"
              ) {
                return yield* Effect.die("production finality terminated a Run with retained responsibility")
              }
            }
            const policy = Option.getOrThrow(current.runState.controlPolicy)
            const integrationTargets = yield* makeIntegrationTargetResourceController()
            const relations = yield* makeReactiveDeliveryRelationsLayer(
              runId,
              target,
              journal,
              recovery,
              integrationTargets
            )
            const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
            const productionAdmissionBasis = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead)).taskWork
            const reconstructedAdmissionBasis = {
              capacity: policy.taskExecutionCapacity,
              held: recovery.reconstructedPlannedAttemptPositions.map(({ attemptId, runId, taskId }) => ({
                correlation: { attemptId, runId },
                taskId
              }))
            }
            const basesMatch =
              productionAdmissionBasis.capacity === reconstructedAdmissionBasis.capacity &&
              productionAdmissionBasis.held.length === reconstructedAdmissionBasis.held.length &&
              productionAdmissionBasis.held.every(({ correlation, taskId }, index) => {
                const reconstructed = reconstructedAdmissionBasis.held[index]
                return (
                  reconstructed !== undefined &&
                  reconstructed.taskId === taskId &&
                  reconstructed.correlation.runId === correlation.runId &&
                  reconstructed.correlation.attemptId === correlation.attemptId
                )
              })
            if (!basesMatch) {
              return yield* Effect.die(
                "production delivery relation and Run recovery projected different task-work admission bases"
              )
            }
            const activeController = yield* makeDeliveryRuntimeAdmissionController(
              productionAdmissionBasis,
              integrationTargets,
              (yield* makeApplicationExitLifecycle()).admission
            ).pipe(Effect.provideService(PlannedAttemptProtocolController, protocolController))
            yield* Deferred.succeed(ready, undefined)

            const appendResponsibilityThroughJournal = (plannedAttempt: PlannedTaskAttempt) =>
              Effect.gen(function* () {
                const operation = makeTaskAttemptPlanOperation({
                  operationId: OperationId.make(`plan-${plannedAttempt.attemptId}`),
                  plannedAttempt,
                  predecessorOperationIds: []
                })
                yield* journal.append(
                  runId,
                  attemptPlanRecordKey(plannedAttempt.attemptId),
                  TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion })
                )
                yield* journal.append(
                  runId,
                  plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
                  PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
                    plannedAttempt,
                    version: workflowJournalEventVersion
                  })
                )
              })

            const appendTerminalReportThroughJournal = (plannedAttempt: PlannedTaskAttempt) =>
              Effect.gen(function* () {
                const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
                yield* journal.append(
                  runId,
                  plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
                  PlannedAttemptExecutorCommandIntendedEvent.make({
                    command: "StartOrContinue",
                    initiatedBy: { _tag: "DalphCoordinator" },
                    occurrenceClassification: "InitiatedAction",
                    ordinal: commandOrdinal,
                    plannedAttempt,
                    version: workflowJournalEventVersion
                  })
                )
                const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
                yield* journal.append(
                  runId,
                  plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
                  PlannedAttemptExecutorWorkReportedEvent.make({
                    ordinal,
                    report: PlannedAttemptExecutorReport.cases.Terminal.make({
                      correlation: { attemptId: plannedAttempt.attemptId, runId },
                      result: { _tag: "Completed" }
                    }),
                    version: workflowJournalEventVersion
                  })
                )
              })

            // oxlint-disable-next-line typescript/no-unnecessary-condition -- a final command returns the proof.
            while (true) {
              const command = yield* Queue.take(commands)
              const finalResult = yield* Match.value(command.tag).pipe(
                Match.when("ActivateEstablishedRun", () =>
                  Effect.gen(function* () {
                    heldPosition = recovery.reconstructedPlannedAttemptPositions.some(({ taskId }) => taskId === taskA)
                      ? "AttemptA"
                      : recovery.reconstructedPlannedAttemptPositions.some(({ taskId }) => taskId === taskC)
                        ? "AttemptC"
                        : "NoTaskPosition"
                    otherHeldPositions = recovery.reconstructedPlannedAttemptPositions.filter(
                      ({ taskId }) => taskId === taskB
                    ).length
                    if (otherHeldPositions > 0) {
                      const blocked = yield* activeController.tryReserve(admissionProposalC)
                      if (blocked._tag !== "Deferred") {
                        return yield* Effect.die(
                          `contracted capacity admitted new work over reconstructed holders: ${JSON.stringify({
                            basis: productionAdmissionBasis,
                            positions: [...(yield* activeController.snapshot).positions]
                          })}`
                        )
                      }
                    }
                    phase = "ActivatingRun"
                    activationsStarted += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("ApplyCancellation", () =>
                  Effect.gen(function* () {
                    if (cancellationApplied || cancellationAppends !== 0) {
                      return yield* Effect.die("duplicate Run cancellation crossed the idempotent journal boundary")
                    }
                    yield* journal.append(
                      runId,
                      runCancellationAppliedRecordKey,
                      RunCancellationAppliedEvent.make({
                        initiatedBy: { _tag: "Operator" },
                        occurrenceClassification: "InitiatedAction",
                        version: workflowJournalEventVersion
                      })
                    )
                    cancellationApplied = true
                    cancellationAppends += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("ReadInitialTrackerGraph", () =>
                  Effect.gen(function* () {
                    initialTrackerObserved = true
                    trackerCalls += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("ReconcileAmbiguousExecutorCommand", () =>
                  Effect.gen(function* () {
                    const report = yield* continuePlannedAttemptExecutorWork(attemptA)
                    if (report._tag !== "Running") {
                      return yield* Effect.die("ambiguous executor command did not reconcile to exact Running")
                    }
                    executorCalls += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("SettleRetainedAttempt", () =>
                  Effect.gen(function* () {
                    yield* activeController.releasePlannedAttemptPosition({ attemptId: attemptA.attemptId, runId })
                    yield* appendTerminalReportThroughJournal(attemptA)
                    heldPosition = "NoTaskPosition"
                    executorCalls += 1
                    if (otherHeldPositions > 0) {
                      const blocked = yield* activeController.tryReserve(admissionProposalC)
                      if (blocked._tag !== "Deferred") {
                        return yield* Effect.die("capacity-one admission ignored the remaining retained holder")
                      }
                    }
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("SettleOtherRetainedAttempt", () =>
                  Effect.gen(function* () {
                    yield* activeController.releasePlannedAttemptPosition({ attemptId: attemptB.attemptId, runId })
                    yield* appendTerminalReportThroughJournal(attemptB)
                    otherHeldPositions -= 1
                    executorCalls += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("AdmitIndependentTask", () =>
                  Effect.gen(function* () {
                    const decision = yield* activeController.tryReserve(admissionProposalC)
                    if (decision._tag === "Deferred") {
                      return yield* Effect.die("independent task must fit released capacity")
                    }
                    yield* activeController.bindPlannedAttemptPosition(taskC, { attemptId: attemptC.attemptId, runId })
                    yield* appendResponsibilityThroughJournal(attemptC)
                    heldPosition = "AttemptC"
                    independentTaskAdmitted = true
                    executorCalls += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("SettleIndependentTask", () =>
                  Effect.gen(function* () {
                    yield* activeController.releasePlannedAttemptPosition({ attemptId: attemptC.attemptId, runId })
                    yield* appendTerminalReportThroughJournal(attemptC)
                    heldPosition = "NoTaskPosition"
                    independentTaskAdmitted = false
                    independentTaskSettled = true
                    executorCalls += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("TrackerFactsBecomeSettled", () =>
                  Effect.gen(function* () {
                    trackerSettled = true
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("ReachQuiescence", () =>
                  Effect.gen(function* () {
                    quiescent = true
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("ReadPostQuiescenceTrackerGraph", () =>
                  Effect.gen(function* () {
                    if (postQuiescenceReads !== 0) {
                      return yield* Effect.die("one activation cannot perform a second final tracker read")
                    }
                    postQuiescenceReads = 1
                    trackerCalls += 1
                    const operation = makeTrackerGraphObservationOperation(
                      OperationId.make(`run-activation-finality-${trackerCalls}`),
                      target,
                      [],
                      snapshotForGraphOutcome(graphOutcome).taskIds()
                    )
                    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
                    const snapshot = snapshotForGraphOutcome(graphOutcome)
                    const observation = yield* journal.append(
                      runId,
                      outcomeRecordKey(operation.operationId),
                      taskTrackerFactsObservedEvent(
                        operation.operationId,
                        makeCompleteTaskTrackerFactsObserved(operation, snapshot)
                      )
                    )
                    finalityEvidence = makeRunFinalityEvidence({
                      operationId: operation.operationId,
                      observedAt: observation.position,
                      readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: snapshot.taskIds() }),
                      rootPresent: true,
                      runId,
                      snapshot,
                      target
                    })
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("ReturnIncomplete", () =>
                  Effect.gen(function* () {
                    phase = "ActivationReturned"
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return {
                      acceptedAt: records.at(-1)?.position ?? null,
                      decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
                    }
                  })
                ),
                Match.when("RedeliverCancellation", () =>
                  Effect.gen(function* () {
                    if (!cancellationApplied || cancellationAppends !== 1 || cancellationRedeliveries !== 0) {
                      return yield* Effect.die("Run cancellation redelivery lacked one durable applied event")
                    }
                    if (records.filter(({ event }) => event._tag === "RunCancellationApplied").length !== 1) {
                      return yield* Effect.die("Run cancellation redelivery changed durable history")
                    }
                    cancellationRedeliveries += 1
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return undefined
                  })
                ),
                Match.when("TerminateRun", () =>
                  Effect.gen(function* () {
                    const evidence = finalityEvidence
                    if (evidence === undefined) return yield* Effect.die("terminal classification lacked graph evidence")
                    const current = reduceWorkflowJournalHistory(runId, records)
                    if (current._tag !== "ValidWorkflowJournalHistory") {
                      return yield* Effect.die("terminal classification saw invalid Run history")
                    }
                    const terminalExplanations = records.flatMap(({ event }) => {
                      if (event._tag !== "PlannedAttemptExecutorWorkReported" || event.report._tag !== "Terminal") {
                        return []
                      }
                      const responsibility = current.runState.responsibility.entries.find(
                        (entry) =>
                          entry._tag === "PlannedAttemptExecutorWorkResponsibility" &&
                          entry.plannedAttempt.attemptId === event.report.correlation.attemptId
                      )
                      return responsibility === undefined ||
                          responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility"
                        ? []
                        : [{ _tag: "PlannedAttemptExecutorWorkTerminal" as const, report: event.report, taskId: responsibility.plannedAttempt.taskId }]
                    })
                    const decision = deriveRunFinalityDecision(
                      { explanations: terminalExplanations, transitions: [] },
                      current.runState.responsibility,
                      trackerSettled
                    )
                    if (decision._tag !== "RunMayTerminate") {
                      return yield* Effect.die(
                        `production finality rejected settled model Run: ${JSON.stringify(decision)}`
                      )
                    }
                    const disposition: TerminalDispositionTag = evidence.graphOutcome === "AllTasksSucceeded"
                      ? "Completed"
                      : cancellationApplied
                        ? "Cancelled"
                        : evidence.graphOutcome === "Blocked"
                          ? "Blocked"
                          : "NoTerminal"
                    if (disposition === "NoTerminal") {
                      return yield* Effect.die("unsettled graph cannot be terminally classified")
                    }
                    terminalDisposition = disposition
                    terminationDisposition = disposition
                    phase = "ActivationReturned"
                    yield* Deferred.succeed(command.acknowledged, undefined)
                    return { acceptedAt: records.at(-1)?.position ?? null, decision, disposition, evidence }
                  })
                ),
                Match.exhaustive
              )
              if (finalResult !== undefined) {
                return finalResult
              }
            }
          })
        )
      )
      const scope = runActivationMbtScope
      if (scope === undefined) return yield* Effect.die("Run activation MBT scope was not installed")
      const fiber = yield* Effect.forkScoped(activation).pipe(Effect.provideService(Scope.Scope, scope))
      interruptActivation = Fiber.interrupt(fiber).pipe(Effect.asVoid)
      awaitActivation = Fiber.join(fiber).pipe(Effect.asVoid)
      yield* Effect.raceFirst(
        Deferred.await(ready),
        awaitActivation.pipe(Effect.andThen(Effect.die("Run activation callback exited before becoming ready")))
      ).pipe(Effect.orDie)
    }).pipe(Effect.orDie)

  return {
    init: () =>
      Effect.gen(function* () {
        const priorInterrupt = interruptActivation
        if (priorInterrupt !== undefined) yield* priorInterrupt
        const priorCommands = activationCommands
        if (priorCommands !== undefined) yield* Queue.shutdown(priorCommands)
        records = []
        otherRecords = []
        activationCommands = undefined
        awaitActivation = undefined
        interruptActivation = undefined
        requestedRunId = runId
        history = "EmptyHistory"
        independentTaskSettled = false
        initialPolicyEvaluations = 0
        beginningAppends = 0
        terminationAppends = 0
        activationsStarted = 0
        trackerCalls = 0
        executorCalls = 0
        processLosses = 0
        trackerSettled = false
        graphOutcome = "GraphAllSucceeded"
        cancellationApplied = false
        cancellationAppends = 0
        cancellationRedeliveries = 0
        terminalDisposition = "NoTerminal"
        terminationDisposition = "NoTerminal"
        finalityEvidence = undefined
        latestCapacity = 1
        ambiguousExecutorProjectionAvailable = false
        executorCommandCalls = 0
        executorProjectionCalls = 0
        setProcessIdle()
      }),
    selectExactExistingHistory: () => Effect.sync(() => selectExisting(true)),
    selectAmbiguousExecutorHistory: () =>
      Effect.sync(() => {
        selectExisting(true)
        appendUnsettledStartIntent(attemptA)
        ambiguousExecutorProjectionAvailable = true
      }),
    selectContractedExactExistingHistory: () => Effect.sync(() => selectExisting(true, true)),
    selectExactExistingHistoryWithoutResponsibility: () => Effect.sync(() => selectExisting(false)),
    selectOtherUnfinishedRun: () =>
      Effect.sync(() => {
        records = []
        otherRecords = []
        begin(runId, target, earlierPolicy)
        appendCapacityChange()
        history = "OneUnfinishedHistory"
        requestedRunId = otherRunId
      }),
    selectMismatchedExistingHistory: () =>
      Effect.sync(() => {
        records = []
        begin(runId, otherTarget, earlierPolicy)
        history = "OneUnfinishedHistory"
      }),
    selectInvalidHistory: () =>
      Effect.sync(() => {
        records = []
        const began = decideWorkflowRunBeginning([], runId, target, initialPolicy)
        if (began._tag !== "LifecycleTransitionAccepted") throw began.failure
        records = [
          {
            event: capacityChangeEvent(1),
            key: JournalRecordKey.make("run-policy:2:task-work-capacity"),
            position: JournalPosition.make(1),
            runId
          },
          { ...began.record, position: JournalPosition.make(2) }
        ]
        history = "InvalidHistory"
      }),
    selectDuplicateBeginningHistory: () =>
      Effect.sync(() => {
        records = []
        const began = begin(runId, target, initialPolicy)
        records = [...records, { ...began, position: JournalPosition.make(2) }]
        history = "InvalidHistory"
      }),
    selectForeignRunRecordHistory: () =>
      Effect.sync(() => {
        records = []
        begin(runId, target, initialPolicy)
        records = [
          ...records,
          {
            event: capacityChangeEvent(1),
            key: JournalRecordKey.make("run-policy:2:task-work-capacity"),
            position: JournalPosition.make(2),
            runId: otherRunId
          }
        ]
        history = "InvalidHistory"
      }),
    selectMultipleUnfinishedHistories: () =>
      Effect.sync(() => {
        records = []
        otherRecords = []
        begin(runId, target, initialPolicy)
        begin(otherRunId, otherTarget, initialPolicy)
        history = "MultipleUnfinishedHistories"
      }),
    selectTerminatedHistory: () =>
      Effect.sync(() => {
        records = []
        begin(runId, target, earlierPolicy)
        appendCapacityChange()
        const evidence = finalityEvidenceFor(runId, target, "GraphAllSucceeded", JournalPosition.make(records.length))
        const decision = decideWorkflowRunTermination(records, runId, "Completed", evidence)
        if (decision._tag !== "LifecycleTransitionAccepted") throw decision.failure
        records = [...records, decision.record]
        history = "TerminatedHistory"
      }),
    selectBlockedRunGraph: () =>
      Effect.sync(() => {
        records = []
        begin(runId, target, initialPolicy)
        history = "OneUnfinishedHistory"
        latestCapacity = 2
        graphOutcome = "GraphBlocked"
        trackerSettled = true
      }),
    selectCancelledRunGraph: () =>
      Effect.sync(() => {
        records = []
        begin(runId, target, initialPolicy)
        history = "OneUnfinishedHistory"
        latestCapacity = 2
        graphOutcome = "GraphBlocked"
        trackerSettled = true
      }),
    establishAbsentHistory: () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          history = "OneUnfinishedHistory"
          phase = "EstablishingRun"
          establishmentSource = "BeginningAppended"
          establishedRunId = "R1"
          establishedTarget = "Target1"
          establishedCapacity = "Capacity2"
          establishedInitialCapacity = "Capacity2"
          initialPolicyEvaluated = true
          initialPolicyEvaluations += 1
          beginningAppends += 1
          latestCapacity = 2
        })
        yield* startEntry("BeginningAppended")
      }),
    establishExistingHistory: () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          const reduced = reduceWorkflowJournalHistory(runId, records)
          if (reduced._tag !== "ValidWorkflowJournalHistory") {
            throw new Error(`existing Run did not reduce: ${JSON.stringify(reduced.issues)}`)
          }
          const policy = Option.getOrThrow(reduced.runState.controlPolicy)
          if (policy.taskExecutionCapacity !== latestCapacity) {
            throw new Error("activation did not reconstruct latest capacity")
          }
          phase = "EstablishingRun"
          establishmentSource = "ExistingHistoryReduced"
          establishedRunId = "R1"
          establishedTarget = "Target1"
          establishedCapacity = policy.taskExecutionCapacity === 2 ? "Capacity2" : "Capacity1"
          establishedInitialCapacity = "Capacity2"
        })
        yield* startEntry("ExistingHistoryReduced")
      }),
    rejectMismatchedHistory: () =>
      withBootstrap(requestedRunId, (service) =>
        service.activate(
          target,
          Effect.die("existing history must not evaluate the initial policy"),
          AllocatedWorkflowRunId.make(requestedRunId),
          Effect.die("mismatched history must not enter activation")
        )
      ).pipe(
        Effect.flip,
        Effect.flatMap((failure) => {
          if (requestedRunId === otherRunId) {
            return failure._tag === "StartupRecoveryBlocked" &&
              failure.issues.length === 1 &&
              failure.issues[0]?._tag === "OtherUnfinishedRunIssue" &&
              failure.issues[0].requestedRunId === otherRunId &&
              failure.issues[0].unfinishedRunId === runId
              ? Effect.sync(() => (entryFailure = "OtherUnfinishedRunFailure"))
              : Effect.die("production did not preserve the requested and unfinished Run identities")
          }
          return failure._tag === "WorkflowRunTargetMismatch" &&
            failure.runId === runId &&
            failure.recordedTarget === otherTarget &&
            failure.requestedTarget === target
            ? Effect.sync(() => (entryFailure = "TargetMismatchFailure"))
            : Effect.die("production accepted mismatched Run target")
        }),
        Effect.tap(() => Effect.sync(() => (phase = "EntryFailed"))),
        Effect.asVoid
      ),
    rejectInvalidHistory: () =>
      withBootstrap(requestedRunId, (service) =>
        service.activate(
          target,
          Effect.die("invalid history must not evaluate the initial policy"),
          AllocatedWorkflowRunId.make(requestedRunId),
          Effect.die("invalid history must not enter activation")
        )
      ).pipe(
        Effect.flip,
        Effect.flatMap((failure) => {
          if (failure._tag !== "StartupRecoveryBlocked" || failure.issues.length === 0) {
            return Effect.die("production accepted invalid Run history")
          }
          const duplicateBeginning = failure.issues.some(
            (issue) =>
              issue._tag === "WorkflowJournalHistorySemanticIssue" &&
              issue.runId === runId &&
              issue.position === 2 &&
              issue.detail === "duplicate journal record key run:began"
          )
          if (duplicateBeginning) return Effect.sync(() => (entryFailure = "DuplicateBeginningFailure"))
          const invalidChronology = failure.issues.some(
            (issue) =>
              issue._tag === "WorkflowJournalHistorySemanticIssue" &&
              issue.runId === runId &&
              issue.position === 2 &&
              issue.detail === "WorkflowRunBegan must be the first record"
          )
          if (invalidChronology) return Effect.sync(() => (entryFailure = "InvalidChronologyFailure"))
          const foreignRecord = failure.issues.some(
            (issue) =>
              issue._tag === "WorkflowJournalHistoryIdentityIssue" &&
              issue.runId === runId &&
              issue.position === 2 &&
              issue.detail === "record belongs to run run-activation-R2"
          )
          return foreignRecord
            ? Effect.sync(() => (entryFailure = "ForeignRunRecordFailure"))
            : Effect.die("invalid history did not preserve its exact typed issue payload")
        }),
        Effect.tap(() => Effect.sync(() => (phase = "EntryFailed"))),
        Effect.asVoid
      ),
    rejectMultipleUnfinishedHistories: () =>
      withBootstrap(requestedRunId, (service) =>
        service.activate(
          target,
          Effect.die("ambiguous history must not evaluate the initial policy"),
          AllocatedWorkflowRunId.make(requestedRunId),
          Effect.die("ambiguous history must not enter activation")
        )
      ).pipe(
        Effect.flip,
        Effect.flatMap((failure) =>
          failure._tag === "StartupRecoveryBlocked" &&
          failure.issues.length === 1 &&
          failure.issues[0]?._tag === "OtherUnfinishedRunIssue" &&
          failure.issues[0].requestedRunId === runId &&
          failure.issues[0].unfinishedRunId === otherRunId
            ? Effect.sync(() => (entryFailure = "MultipleUnfinishedRunsFailure"))
            : Effect.die("production did not name the unfinished Run ambiguity")
        ),
        Effect.tap(() => Effect.sync(() => (phase = "EntryFailed"))),
        Effect.asVoid
      ),
    rejectTerminatedHistory: () =>
      withBootstrap(requestedRunId, (service) =>
        service.activate(
          target,
          Effect.die("terminated history must not evaluate the initial policy"),
          AllocatedWorkflowRunId.make(requestedRunId),
          Effect.die("terminated history must not enter activation")
        )
      ).pipe(
        Effect.flip,
        Effect.flatMap((failure) =>
          failure._tag === "WorkflowRunAlreadyTerminated"
            ? Effect.sync(() => (entryFailure = "TerminatedRunFailure"))
            : Effect.die("production accepted a terminated Run")
        ),
        Effect.tap(() => Effect.sync(() => (phase = "EntryFailed"))),
        Effect.asVoid
      ),
    activateEstablishedRun: () => sendActivationCommand("ActivateEstablishedRun"),
    applyCancellation: () => sendActivationCommand("ApplyCancellation"),
    readInitialTrackerGraph: () => sendActivationCommand("ReadInitialTrackerGraph"),
    reconcileAmbiguousExecutorCommand: () => sendActivationCommand("ReconcileAmbiguousExecutorCommand"),
    settleRetainedAttempt: () => sendActivationCommand("SettleRetainedAttempt"),
    settleOtherRetainedAttempt: () => sendActivationCommand("SettleOtherRetainedAttempt"),
    admitIndependentTask: () => sendActivationCommand("AdmitIndependentTask"),
    settleIndependentTask: () => sendActivationCommand("SettleIndependentTask"),
    trackerFactsBecomeSettled: () =>
      Effect.suspend(() =>
        activationCommands === undefined
          ? Effect.sync(() => (trackerSettled = true))
          : sendActivationCommand("TrackerFactsBecomeSettled")
      ),
    reachQuiescence: () => sendActivationCommand("ReachQuiescence"),
    readPostQuiescenceTrackerGraph: () => sendActivationCommand("ReadPostQuiescenceTrackerGraph"),
    returnIncomplete: () =>
      Effect.gen(function* () {
        yield* sendActivationCommand("ReturnIncomplete")
        const completion = awaitActivation
        if (completion === undefined) return yield* Effect.die("Run activation completion was not installed")
        yield* completion
        const commands = activationCommands
        if (commands !== undefined) {
          yield* Queue.shutdown(commands)
          const staleReply = yield* Deferred.make<void>()
          const staleAccepted = yield* Queue.offer(commands, {
            acknowledged: staleReply,
            tag: "ReadInitialTrackerGraph"
          })
          if (staleAccepted) return yield* Effect.die("closed activation callback accepted a later command")
        }
        activationCommands = undefined
        awaitActivation = undefined
        interruptActivation = undefined
      }).pipe(Effect.orDie),
    redeliverCancellation: () => sendActivationCommand("RedeliverCancellation"),
    terminateRun: () =>
      Effect.gen(function* () {
        yield* sendActivationCommand("TerminateRun")
        const completion = awaitActivation
        if (completion === undefined) return yield* Effect.die("Run activation completion was not installed")
        yield* completion
        history = "TerminatedHistory"
        terminationAppends += 1
        const commands = activationCommands
        if (commands !== undefined) yield* Queue.shutdown(commands)
        activationCommands = undefined
        awaitActivation = undefined
        interruptActivation = undefined
      }).pipe(Effect.orDie),
    crash: () =>
      Effect.gen(function* () {
        const before = records
        const interrupt = interruptActivation
        if (interrupt !== undefined) yield* interrupt
        const commands = activationCommands
        if (commands !== undefined) {
          yield* Queue.shutdown(commands)
          const staleReply = yield* Deferred.make<void>()
          const staleAccepted = yield* Queue.offer(commands, {
            acknowledged: staleReply,
            tag: "ReadInitialTrackerGraph"
          })
          if (staleAccepted) return yield* Effect.die("crashed activation callback accepted a later command")
        }
        activationCommands = undefined
        awaitActivation = undefined
        interruptActivation = undefined
        processLosses += 1
        setProcessIdle()
        if (records !== before) return yield* Effect.die("process loss changed durable journal history")
      }),
    invokeSameEntryAgain: () => Effect.sync(setProcessIdle),
    getExecutorProtocolEvidence: () =>
      Effect.succeed({
        commandCalls: executorCommandCalls,
        eventTags: records.map(({ event }) => event._tag),
        projectionCalls: executorProjectionCalls
      }),
    getState: () =>
      Effect.succeed({
        activationsStarted,
        beginningAppends,
        cancellationAppends,
        cancellationRedeliveries,
        cancellationApplied,
        establishedCapacity,
        establishedInitialCapacity,
        establishedRunId,
        establishedTarget,
        establishmentSource,
        entryFailure,
        executorCalls,
        heldPosition,
        history,
        independentTaskAdmitted,
        independentTaskSettled,
        initialPolicyEvaluated,
        initialPolicyEvaluations,
        initialTrackerObserved,
        otherHeldPositions,
        phase,
        postQuiescenceReads,
        processLosses,
        quiescent,
        requestedRunId: requestedRunId === otherRunId ? "R2" : "R1",
        requestedTarget: "Target1",
        terminationAppends,
        terminationDisposition,
        terminalDisposition,
        graphOutcome,
        trackerCalls,
        trackerSettled
      } satisfies DriverProjection)
  }
}

const runActivationDriver = defineDriver(runActivationActions, makeRunActivationDriverImplementation)

const withRunActivationDriver = <A, E>(
  use: (driver: ReturnType<typeof makeRunActivationDriverImplementation>) => Effect.Effect<A, E>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      runActivationMbtScope = yield* Effect.scope
      yield* Effect.addFinalizer(() => Effect.sync(() => (runActivationMbtScope = undefined)))
      return yield* use(makeRunActivationDriverImplementation())
    })
  )

it.effect("reconciles an ambiguous executor command before continuation through unified Run activation", () =>
  withRunActivationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectAmbiguousExecutorHistory()
      yield* driver.establishExistingHistory()
      yield* driver.activateEstablishedRun()
      yield* driver.readInitialTrackerGraph()
      yield* driver.reconcileAmbiguousExecutorCommand()

      const evidence = yield* driver.getExecutorProtocolEvidence()
      expect(evidence.commandCalls).toBe(0)
      expect(evidence.projectionCalls).toBe(1)
      expect(evidence.eventTags).toContain("PlannedAttemptExecutorCommandProjectionObserved")
    })
  )
)

it.effect("reactivates the same incomplete Run through the same unified bootstrap entry", () =>
  withRunActivationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.establishAbsentHistory()
      yield* driver.activateEstablishedRun()
      yield* driver.readInitialTrackerGraph()
      yield* driver.reachQuiescence()
      yield* driver.readPostQuiescenceTrackerGraph()
      yield* driver.returnIncomplete()
      yield* driver.invokeSameEntryAgain()
      yield* driver.establishExistingHistory()
      yield* driver.activateEstablishedRun()

      const state = yield* driver.getState()
      expect(state.beginningAppends).toBe(1)
      expect(state.activationsStarted).toBe(2)
      expect(state.establishmentSource).toBe("ExistingHistoryReduced")
      expect(state.requestedRunId).toBe("R1")
    })
  )
)

it.effect("permits only one final tracker read in each unified Run activation", () =>
  withRunActivationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.establishAbsentHistory()
      yield* driver.activateEstablishedRun()
      yield* driver.readInitialTrackerGraph()
      yield* driver.reachQuiescence()
      yield* driver.readPostQuiescenceTrackerGraph()

      const duplicate = yield* driver.readPostQuiescenceTrackerGraph().pipe(Effect.exit)
      expect(duplicate._tag).toBe("Failure")
      expect((yield* driver.getState()).trackerCalls).toBe(2)
    })
  )
)

quintIt(
  (name, test, options) =>
    it.effect(
      name,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            runActivationMbtScope = yield* Effect.scope
            yield* Effect.addFinalizer(() => Effect.sync(() => (runActivationMbtScope = undefined)))
            return yield* test()
          })
        ),
      options
    ),
  "replays idempotent Run establishment and bounded activation through production seams",
  {
    backend: "typescript",
    driverFactory: runActivationDriver,
    maxSteps: 20,
    nTraces: 100,
    seed: "195",
    spec: "specs/runActivation.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(
            ({ state }): DriverProjection => ({
              activationsStarted: Number(state.trace.activationsStarted),
              beginningAppends: Number(state.trace.beginningAppends),
              cancellationAppends: Number(state.trace.cancellationAppends),
              cancellationRedeliveries: Number(state.trace.cancellationRedeliveries),
              cancellationApplied: state.durable.cancellationApplied,
              establishedCapacity:
                state.process.establishedRun.tag === "ExactEstablishedRun"
                  ? state.process.establishedRun.value.latestPolicy.taskCapacity.tag
                  : "NoEstablishedCapacity",
              establishedInitialCapacity:
                state.process.establishedRun.tag === "ExactEstablishedRun"
                  ? state.process.establishedRun.value.initialPolicy.taskCapacity.tag
                  : "NoEstablishedCapacity",
              establishedRunId:
                state.process.establishedRun.tag === "ExactEstablishedRun"
                  ? state.process.establishedRun.value.runId.tag
                  : "NoEstablishedRun",
              establishedTarget:
                state.process.establishedRun.tag === "ExactEstablishedRun"
                  ? state.process.establishedRun.value.target.tag
                  : "NoEstablishedTarget",
              establishmentSource: state.process.establishmentSource.tag,
              entryFailure: state.process.entryFailure.tag,
              executorCalls: Number(state.trace.executorCalls),
              heldPosition:
                state.process.heldPosition.tag === "ExactTaskPosition"
                  ? state.process.heldPosition.value.attemptId.tag
                  : "NoTaskPosition",
              history: state.durable.history.tag,
              independentTaskAdmitted: state.process.independentTaskAdmitted,
              independentTaskSettled: state.durable.independentTaskSettled,
              initialPolicyEvaluated: state.process.initialPolicyEvaluated,
              initialPolicyEvaluations: Number(state.trace.initialPolicyEvaluations),
              initialTrackerObserved: state.process.initialTrackerObserved,
              otherHeldPositions: state.process.otherHeldPosition.tag === "ExactTaskPosition" ? 1 : 0,
              phase: state.process.phase.tag,
              postQuiescenceReads: Number(state.process.postQuiescenceReads),
              processLosses: Number(state.trace.processLosses),
              quiescent: state.process.quiescent,
              requestedRunId: state.requestedRunId.tag,
              requestedTarget: state.requestedTarget.tag,
              terminationAppends: Number(state.trace.terminationAppends),
              trackerCalls: Number(state.trace.trackerCalls),
              trackerSettled: state.trackerFinality.targetSettled,
              terminationDisposition: state.durable.terminationDisposition.tag,
              terminalDisposition: state.process.terminalDisposition.tag,
              graphOutcome: state.trackerFinality.graphOutcome.tag
            })
          ),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.activationsStarted === implementation.activationsStarted &&
        spec.beginningAppends === implementation.beginningAppends &&
        spec.cancellationAppends === implementation.cancellationAppends &&
        spec.cancellationRedeliveries === implementation.cancellationRedeliveries &&
        spec.cancellationApplied === implementation.cancellationApplied &&
        spec.establishedCapacity === implementation.establishedCapacity &&
        spec.establishedInitialCapacity === implementation.establishedInitialCapacity &&
        spec.establishedRunId === implementation.establishedRunId &&
        spec.establishedTarget === implementation.establishedTarget &&
        spec.establishmentSource === implementation.establishmentSource &&
        spec.entryFailure === implementation.entryFailure &&
        spec.executorCalls === implementation.executorCalls &&
        spec.heldPosition === implementation.heldPosition &&
        spec.history === implementation.history &&
        spec.independentTaskAdmitted === implementation.independentTaskAdmitted &&
        spec.independentTaskSettled === implementation.independentTaskSettled &&
        spec.initialPolicyEvaluated === implementation.initialPolicyEvaluated &&
        spec.initialPolicyEvaluations === implementation.initialPolicyEvaluations &&
        spec.initialTrackerObserved === implementation.initialTrackerObserved &&
        spec.otherHeldPositions === implementation.otherHeldPositions &&
        spec.phase === implementation.phase &&
        spec.postQuiescenceReads === implementation.postQuiescenceReads &&
        spec.processLosses === implementation.processLosses &&
        spec.quiescent === implementation.quiescent &&
        spec.requestedRunId === implementation.requestedRunId &&
        spec.requestedTarget === implementation.requestedTarget &&
        spec.terminationAppends === implementation.terminationAppends &&
        spec.terminationDisposition === implementation.terminationDisposition &&
        spec.terminalDisposition === implementation.terminalDisposition &&
        spec.graphOutcome === implementation.graphOutcome &&
        spec.trackerCalls === implementation.trackerCalls &&
        spec.trackerSettled === implementation.trackerSettled
    )
  },
  120_000
)
