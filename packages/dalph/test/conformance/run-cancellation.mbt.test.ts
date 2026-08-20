/* eslint-disable max-lines -- One driver keeps the cancellation model-to-runtime seam map auditable. */
/* eslint-disable functional/immutable-data -- The driver owns a short-lived mutable test projection. */
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
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Scope, Stream } from "effect"
import { expect } from "vitest"
import { InitialControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { Journal } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { JournalPosition, type JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  journalStoreCapabilities,
  InRunJournal,
  JournalStore,
  RunLifecycleJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord,
  type JournalStoreService
} from "../../../orchestrator/src/workflow-journal/store.js"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import type { TrackerTarget } from "../../../orchestrator/src/authorities/task-tracker/target.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { makeApplicationExitShell as makeExitShell } from "../../../orchestrator/src/coordination/application-exit/application-shell.js"
import { journaledCurrentDeliveryFrameOf } from "../../../orchestrator/src/coordination/run/current-delivery-frame.js"
import { RunRecoveryProjection } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { journaledRunBootstrapLayer } from "../../../orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import { JournaledRunBootstrap } from "../../../orchestrator/src/coordination/run/run.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import { executePlannedAttemptTransition } from "../../../orchestrator/src/coordination/delivery/planned-attempt-delivery-action-adapter.js"
import { executeNewRecoveredAction } from "../../../orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.js"
import {
  type DeliveryActionProposal,
  type IdentityFreeDeliveryProposal,
  type NewRecoveredWorkflowAction
} from "../../../orchestrator/src/coordination/delivery/delivery-action-proposal.js"
import { deliveryProposalsOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal-derivation.js"
import { newRecoveredActionOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal-route.js"
import { type DeliveryActionExecutionLease } from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import {
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  AuthoritativeTaskClaimObserved,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { AuthoritativeTaskClaimReleased } from "../../../orchestrator/src/workflow/protocols/task-claim-release/protocol.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { attemptChoiceControlLayer } from "../../../orchestrator/src/workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../../orchestrator/src/workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-reacquisition/control.js"
import { taskWorkCapacityControlLayer } from "../../../orchestrator/src/control/task-work-capacity.js"
import { deterministicTaskClaimAcquisitionPlannerLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-acquisition/plan.js"
import { deterministicOperationIdAllocatorLayer } from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../../orchestrator/src/workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  taskTrackerFactsObservedEvent,
  makeCompleteTaskTrackerFactsObserved
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { AllocatedWorkflowRunId } from "../../../orchestrator/src/coordination/run/fresh-run-identity.js"

const RunIdVariant = Schema.Struct({ tag: Schema.Literals(["R1", "R2"]), value: Schema.Unknown })
const TargetVariant = Schema.Struct({ tag: Schema.Literals(["Target1", "Target2"]), value: Schema.Unknown })
const ActorVariant = Schema.Struct({ tag: Schema.Literals(["Operator", "DalphCoordinator"]), value: Schema.Unknown })
const PhaseVariant = Schema.Struct({
  tag: Schema.Literals([
    "New",
    "Active",
    "Cancelling",
    "ReadyForClassification",
    "ProcessLost",
    "Rejected",
    "TerminalHistory"
  ]),
  value: Schema.Unknown
})
const ExecutorVariant = Schema.Struct({
  tag: Schema.Literals(["NoExecutor", "Running", "StopIntentRecorded", "SafelySuspended", "ExecutorUnreadable"]),
  value: Schema.Unknown
})
const ClaimVariant = Schema.Struct({
  tag: Schema.Literals(["NoClaim", "Held", "ReleaseIntentRecorded", "Released", "ForeignClaim", "ClaimUnreadable"]),
  value: Schema.Unknown
})
const IntegrationVariant = Schema.Struct({
  tag: Schema.Literals([
    "NoIntegration",
    "IntegrationOwned",
    "PromotionIntentRecorded",
    "PromotionAccepted",
    "IntegrationSettled",
    "IntegrationQuarantined",
    "IntegrationUnreadable"
  ]),
  value: Schema.Unknown
})
const GraphVariant = Schema.Struct({
  tag: Schema.Literals(["NoGraph", "AllSucceeded", "NotAllSucceeded", "TemporaryWait", "GraphUnreadable"]),
  value: Schema.Unknown
})
const TerminalVariant = Schema.Struct({
  tag: Schema.Literals(["NoTermination", "Completed", "Blocked", "Cancelled"]),
  value: Schema.Unknown
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    durable: Schema.Struct({
      runId: RunIdVariant,
      target: TargetVariant,
      cancellationApplied: Schema.Boolean,
      cancellationAppends: ITFBigInt,
      cancellationRedeliveries: ITFBigInt,
      cancellationActor: ActorVariant,
      executor: ExecutorVariant,
      claim: ClaimVariant,
      integration: IntegrationVariant,
      worktreePreserved: Schema.Boolean,
      logsPreserved: Schema.Boolean,
      evidencePreserved: Schema.Boolean,
      executorStopIntents: ITFBigInt,
      executorSafeReports: ITFBigInt,
      claimReleaseIntents: ITFBigInt,
      claimReleaseObservations: ITFBigInt,
      claimReleases: ITFBigInt,
      integrationIntents: ITFBigInt,
      integrationSettlements: ITFBigInt,
      promotionAccepted: Schema.Boolean,
      terminalHistory: TerminalVariant,
      processLosses: ITFBigInt,
      classificationReads: ITFBigInt
    }),
    process: Schema.Struct({
      phase: PhaseVariant,
      requestedRunId: RunIdVariant,
      requestedTarget: TargetVariant,
      admissionOpen: Schema.Boolean,
      exitCutoff: Schema.Boolean,
      executorPositionHeld: Schema.Boolean,
      responsibilitiesSettled: Schema.Boolean,
      graphRead: Schema.Boolean,
      graph: GraphVariant,
      forwardAdmissions: ITFBigInt,
      freshAfterRestart: Schema.Boolean,
      cancellationRejected: Schema.Boolean
    })
  })
})

type RunTag = "R1" | "R2"
type TargetTag = "Target1" | "Target2"
type ActorTag = "Operator" | "DalphCoordinator"
type PhaseTag =
  | "New"
  | "Active"
  | "Cancelling"
  | "ReadyForClassification"
  | "ProcessLost"
  | "Rejected"
  | "TerminalHistory"
type ExecutorTag = "NoExecutor" | "Running" | "StopIntentRecorded" | "SafelySuspended" | "ExecutorUnreadable"
type ClaimTag = "NoClaim" | "Held" | "ReleaseIntentRecorded" | "Released" | "ForeignClaim" | "ClaimUnreadable"
type IntegrationTag =
  | "NoIntegration"
  | "IntegrationOwned"
  | "PromotionIntentRecorded"
  | "PromotionAccepted"
  | "IntegrationSettled"
  | "IntegrationQuarantined"
  | "IntegrationUnreadable"
type GraphTag = "NoGraph" | "AllSucceeded" | "NotAllSucceeded" | "TemporaryWait" | "GraphUnreadable"
type TerminalTag = "NoTermination" | "Completed" | "Blocked" | "Cancelled"

interface DurableProjection {
  readonly runId: RunTag
  readonly target: TargetTag
  readonly cancellationApplied: boolean
  readonly cancellationAppends: number
  readonly cancellationRedeliveries: number
  readonly cancellationActor: ActorTag
  readonly executor: ExecutorTag
  readonly claim: ClaimTag
  readonly integration: IntegrationTag
  readonly worktreePreserved: boolean
  readonly logsPreserved: boolean
  readonly evidencePreserved: boolean
  readonly executorStopIntents: number
  readonly executorSafeReports: number
  readonly claimReleaseIntents: number
  readonly claimReleaseObservations: number
  readonly claimReleases: number
  readonly integrationIntents: number
  readonly integrationSettlements: number
  readonly promotionAccepted: boolean
  readonly terminalHistory: TerminalTag
  readonly processLosses: number
  readonly classificationReads: number
}

interface ProcessProjection {
  readonly phase: PhaseTag
  readonly requestedRunId: RunTag
  readonly requestedTarget: TargetTag
  readonly admissionOpen: boolean
  readonly exitCutoff: boolean
  readonly executorPositionHeld: boolean
  readonly responsibilitiesSettled: boolean
  readonly graphRead: boolean
  readonly graph: GraphTag
  readonly forwardAdmissions: number
  readonly freshAfterRestart: boolean
  readonly cancellationRejected: boolean
}

interface DriverProjection {
  readonly state: { readonly durable: DurableProjection; readonly process: ProcessProjection }
}

type SettlementPlannedTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "SuspendPlannedAttemptExecutorWork"
      | "ObservePlannedAttemptContinuationExecutor"
      | "RelinquishCancelledAttemptImplementation"
  }
>

type RuntimeCommand =
  | {
      readonly _tag: "PublishGraph"
      readonly completed: Deferred.Deferred<"RunPaused" | "RunUnpaused">
      readonly operationNumber: number
    }
  | { readonly _tag: "SeedRunningAttempt"; readonly completed: Deferred.Deferred<void> }
  | {
      readonly _tag: "ExecutePlannedSettlement"
      readonly action: { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal }
      readonly completed: Deferred.Deferred<void>
      readonly transition: SettlementPlannedTransition
    }
  | {
      readonly _tag: "ExecuteRecoveredSettlement"
      readonly action: NewRecoveredWorkflowAction
      readonly completed: Deferred.Deferred<void>
      readonly operationId: OperationId
    }

const runId = RunId.make("run-cancellation-R1")
const target = FixtureTarget.make("run-cancellation-T1")
const taskId = TaskId.make("run-cancellation-task")
const taskSpecification = makeTaskWorkSpecification({
  body: "Cancellation conformance work",
  taskId,
  title: "Cancellation conformance task"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("run-cancellation-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/run-cancellation-task"),
  executor: TaskExecutorLocator.make("executor:run-cancellation-fake"),
  runId,
  taskId,
  taskRevision: taskSpecification.fingerprint,
  worktree: WorktreeLocator.make("/tmp/dalph-run-cancellation-task")
})
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("run-cancellation-claim-acquisition"),
  owner: ClaimOwner.make("dalph-run-cancellation"),
  taskId,
  token: ClaimToken.make("run-cancellation-claim-token")
})
const claimAcquisitionOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: activeClaim.operationId,
    owner: activeClaim.owner,
    taskId: activeClaim.taskId,
    token: activeClaim.token
  },
  predecessorOperationIds: []
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("run-cancellation-attempt-plan"),
  plannedAttempt,
  predecessorOperationIds: [activeClaim.operationId]
})
const claimReadOperationId = OperationId.make("run-cancellation-claim-read")
const claimReadOperation = makeTaskClaimObservationOperation(claimReadOperationId, target, taskId, [
  activeClaim.operationId
])
const claimReleaseOperationId = OperationId.make("run-cancellation-claim-release")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
let runCancellationMbtScope: Scope.Scope | undefined

const assertIdentityFreeProposal: (
  proposal: DeliveryActionProposal,
  transition: SettlementPlannedTransition
) => asserts proposal is IdentityFreeDeliveryProposal = (proposal, transition) => {
  if (proposal.actionIdentity._tag !== "NoWorkflowOperationIdentity") {
    expect.fail(`missing identity-free cancellation proposal for ${transition._tag}`)
  }
}

const identityFreeActionFor = (
  transition: SettlementPlannedTransition
): { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal } => {
  const derived = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities: [],
    responsibilities: [
      { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt }
    ],
    runId,
    transitions: [transition]
  })
  const proposal = [...derived.ticketDelivery, ...derived.deliverySettlement][0]
  if (proposal === undefined) return expect.fail(`missing identity-free cancellation proposal for ${transition._tag}`)
  assertIdentityFreeProposal(proposal, transition)
  return { _tag: "IdentityFreeAction", proposal }
}

const projectionOf = (durable: DurableProjection, process: ProcessProjection): DriverProjection => ({
  state: { durable, process }
})

const makeInitialDurable = (): DurableProjection => ({
  runId: "R1",
  target: "Target1",
  cancellationApplied: false,
  cancellationAppends: 0,
  cancellationRedeliveries: 0,
  cancellationActor: "Operator",
  executor: "NoExecutor",
  claim: "NoClaim",
  integration: "NoIntegration",
  worktreePreserved: true,
  logsPreserved: true,
  evidencePreserved: true,
  executorStopIntents: 0,
  executorSafeReports: 0,
  claimReleaseIntents: 0,
  claimReleaseObservations: 0,
  claimReleases: 0,
  integrationIntents: 0,
  integrationSettlements: 0,
  promotionAccepted: false,
  terminalHistory: "NoTermination",
  processLosses: 0,
  classificationReads: 0
})

const makeInitialProcess = (): ProcessProjection => ({
  phase: "Active",
  requestedRunId: "R1",
  requestedTarget: "Target1",
  admissionOpen: true,
  exitCutoff: false,
  executorPositionHeld: false,
  responsibilitiesSettled: true,
  graphRead: false,
  graph: "NotAllSucceeded",
  forwardAdmissions: 0,
  freshAfterRestart: false,
  cancellationRejected: false
})

const makeRunCancellationActions = {
  init: {},
  selectIdleRun: {},
  selectRunningExecutor: {},
  selectIntegrationOwned: {},
  selectTemporaryWait: {},
  selectApplicationExitCutoff: {},
  selectForeignRunRequest: {},
  selectTerminalHistory: {},
  applyCancellation: {},
  redeliverCancellation: {},
  recordExecutorStopIntent: {},
  reportExecutorSafe: {},
  recordClaimReleaseIntent: {},
  observeAndReleaseClaim: {},
  recordIntegrationIntent: {},
  observePromotedIntegration: {},
  settlePromotedIntegration: {},
  readFreshClassificationGraph: {},
  readTemporaryWaitGraph: {},
  handoffToFreshClassification: {},
  crashBeforeSettlement: {},
  restartCancellation: {},
  reconcileExecutorAfterRestart: {},
  reconcileClaimAfterRestart: {},
  reconcileIntegrationAfterRestart: {},
  settleAfterIdleCancellation: {},
  markExecutorUnreadable: {},
  markIntegrationUnreadable: {},
  rejectCancellationAtExit: {},
  rejectForeignCancellation: {},
  rejectTerminalHistory: {},
  admitForwardWork: {}
} as const

const settlementLeaseOf = (controller: PlannedAttemptProtocolController["Service"]): DeliveryActionExecutionLease => ({
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: {
    _tag: "InterruptibleBoundary",
    execution: { run: (_intent, call, recordResult) => call.pipe(Effect.flatMap(recordResult)) }
  },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: (correlation, effect) => controller.withPermit(correlation, effect)
})

const runtimeLayer = (
  activeRunId: RunId,
  executor: PlannedAttemptExecutor["Service"],
  interpreter: WorkflowInterpreter["Service"]
) =>
  Layer.mergeAll(
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    Layer.succeed(PlannedAttemptExecutor, executor),
    Layer.mock(RunRecoveryProjection, {
      _tag: "AuthoritativeRunRecoveryProjection" as const,
      runId: activeRunId,
      readDeliveryProjection: Effect.succeed({
        evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
        frontier: { explanations: [], transitions: [] }
      }),
      reconstructedPlannedAttemptPositions: []
    }),
    taskWorkCapacityControlLayer,
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`run-cancellation:${activeRunId}`),
    plannedAttemptProtocolControllerLayer,
    journaledWorkflowInterpreterLayer(activeRunId, Layer.succeed(WorkflowInterpreter, interpreter)),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void })
  )

const makeStorage = (
  readRecords: () => ReadonlyArray<JournalRecord>,
  writeRecords: (records: ReadonlyArray<JournalRecord>) => void
): JournalStoreService => {
  const append = (eventRunId: RunId, key: JournalRecordKey, event: AppendableWorkflowJournalEvent) =>
    Effect.sync(() => {
      const records = readRecords()
      const existing = records.find((record) => record.key === key)
      if (existing !== undefined) return existing
      const record = {
        event,
        key,
        position: JournalPosition.make(records.length + 1),
        runId: eventRunId
      } satisfies JournalRecord
      writeRecords([...records, record])
      return record
    })

  const beginRun = (eventRunId: RunId, eventTarget: TrackerTarget, policy: InitialControlPolicy) =>
    Effect.sync(() => {
      const decision = decideWorkflowRunBeginning(readRecords(), eventRunId, eventTarget, policy)
      if (decision._tag !== "LifecycleTransitionAccepted") {
        expect.fail(JSON.stringify(decision.failure))
      }
      writeRecords([...readRecords(), decision.record])
      return decision.record
    })

  const readRunForRecovery = (eventRunId: RunId, eventTarget: TrackerTarget) =>
    readRecoverableRunBeginning(readRecords(), eventRunId, eventTarget)

  const terminateRun = (
    eventRunId: RunId,
    disposition: Parameters<JournalStoreService["terminateRun"]>[1],
    evidence: Parameters<JournalStoreService["terminateRun"]>[2]
  ) =>
    Effect.sync(() => {
      const decision = decideWorkflowRunTermination(readRecords(), eventRunId, disposition, evidence)
      if (decision._tag !== "LifecycleTransitionAccepted") {
        expect.fail(JSON.stringify(decision.failure))
      }
      writeRecords([...readRecords(), decision.record])
      return decision.record
    })

  return {
    append,
    beginRun,
    read: () => Effect.succeed(readRecords()),
    readRunForRecovery,
    scan: () =>
      Effect.succeed({ issues: [], runs: readRecords().length === 0 ? [] : [{ records: readRecords(), runId }] }),
    terminateRun
  }
}

const makeCancellationDriverImplementation = () => {
  let records: ReadonlyArray<JournalRecord> = []
  const storage = makeStorage(
    () => records,
    (next) => (records = next)
  )
  let bootstrap: JournaledRunBootstrap["Service"] | undefined
  let runtimeFiber: Fiber.Fiber<unknown, unknown> | undefined
  let runtimeCommands: Queue.Queue<RuntimeCommand> | undefined
  let durable = makeInitialDurable()
  let process = makeInitialProcess()
  let effectivePause: "RunPaused" | "RunUnpaused" | undefined
  let executorAuthority: "Running" | "SafelySuspended" = "Running"
  let claimHeld = true

  const executorReportFor = (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
    executorAuthority === "Running"
      ? PlannedAttemptExecutorReport.cases.Running.make({ correlation })
      : PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })

  const executorForSettlement = PlannedAttemptExecutor.of({
    project: (correlation) =>
      Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report: executorReportFor(correlation) })),
    requestSuspension: (attempt) =>
      Effect.succeed(
        PlannedAttemptExecutorReport.cases.Running.make({ correlation: plannedAttemptExecutorCorrelation(attempt) })
      ),
    startOrContinue: () => Effect.die("cancellation conformance must not continue executor work")
  })

  const workflowInterpreterForSettlement = WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("cancellation conformance must not acquire a successor claim"),
    readTaskClaim: () =>
      Effect.succeed(
        claimHeld
          ? AuthoritativeTaskClaimObserved.make({ observation: activeClaim })
          : AuthoritativeTaskClaimObserved.make({ observation: UnclaimedTask.make({ taskId }) })
      ),
    readTaskWorktree: () => Effect.die("cancellation conformance does not read worktrees"),
    readTargetLineage: () => Effect.die("cancellation conformance does not read target lineage"),
    readTrackerGraph: () => Effect.die("the cancellation adapter publishes controlled graph facts through Journal"),
    readTaskWorkSpecification: () => Effect.succeed(taskSpecification),
    releaseTaskClaim: (operation) =>
      Effect.sync(() => {
        claimHeld = false
        return AuthoritativeTaskClaimReleased.make({ release: operation.release })
      }),
    reconcileTaskWorktree: () => Effect.die("cancellation conformance does not reconcile worktrees"),
    recordTaskAttemptPlan: () => Effect.die("cancellation conformance seeds the exact attempt plan")
  })

  const productionBootstrap = Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Scope.addFinalizer(scope, Scope.close(scope, Exit.void))
    const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage))).pipe(
      Effect.provideService(Scope.Scope, scope)
    )
    const dependencies = Layer.mergeAll(
      Layer.succeed(JournalStore, storage),
      Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
      Layer.succeed(CoordinatorOwnership, ownership)
    )
    const applicationExit = yield* makeExitShell(ownership, { requestEnd: () => Effect.void }).pipe(
      Effect.provideService(Scope.Scope, scope)
    )
    const context = yield* Layer.build(
      journaledRunBootstrapLayer(
        runId,
        ({ runId: activeRunId }) => runtimeLayer(activeRunId, executorForSettlement, workflowInterpreterForSettlement),
        applicationExit
      ).pipe(Layer.provide(dependencies))
    ).pipe(Effect.provideService(Scope.Scope, scope))
    return Context.get(context, JournaledRunBootstrap)
  })

  const stopRuntime = Effect.gen(function* () {
    const fiber = runtimeFiber
    runtimeFiber = undefined
    runtimeCommands = undefined
    if (fiber !== undefined) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
  })

  const startRuntime = Effect.gen(function* () {
    const installed = bootstrap
    if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
    const commands = yield* Queue.unbounded<RuntimeCommand>()
    const ready = yield* Deferred.make<void>()
    runtimeCommands = commands
    const program = Effect.gen(function* () {
      const journal = yield* Journal
      const protocolController = yield* PlannedAttemptProtocolController
      const settlementLease = settlementLeaseOf(protocolController)
      yield* Deferred.succeed(ready, undefined)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the runtime remains leased until crash or init.
      while (true) {
        const command = yield* Queue.take(commands)
        if (command._tag === "SeedRunningAttempt") {
          yield* journal.append(
            runId,
            intentRecordKey(activeClaim.operationId),
            TaskClaimAcquisitionIntendedEvent.make({
              operation: claimAcquisitionOperation,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(activeClaim.operationId),
            TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            attemptPlanRecordKey(plannedAttempt.attemptId),
            TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
            PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
          const seededState = yield* journal.state.get
          if (seededState.position !== JournalPosition.make(records.length)) {
            return yield* Effect.die(
              `cancellation seed publication ended at ${seededState.position}, storage ended at ${records.length}`
            )
          }
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "PublishGraph") {
          const operation = makeTrackerGraphObservationOperation(
            OperationId.make(`run-cancellation-graph-${command.operationNumber}`),
            target,
            [],
            [TaskId.make("run-cancellation-root")]
          )
          const snapshotResult = projectTrackerSnapshot({
            revision: `run-cancellation-graph-${command.operationNumber}`,
            tasks: [
              {
                id: TaskId.make("run-cancellation-root"),
                lifecycle: { _tag: "Open" as const },
                parentTaskId: null,
                prerequisiteIds: []
              }
            ]
          })
          if (snapshotResult._tag !== "Valid") return yield* Effect.die("cancellation graph fixture was invalid")
          yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            taskTrackerFactsObservedEvent(
              operation.operationId,
              makeCompleteTaskTrackerFactsObserved(operation, snapshotResult.snapshot)
            )
          )
          const current = yield* journal.state.get
          const frame = yield* journaledCurrentDeliveryFrameOf(current)
          effectivePause = frame.pause.run._tag
          yield* Deferred.succeed(command.completed, effectivePause)
        } else if (command._tag === "ExecutePlannedSettlement") {
          yield* executePlannedAttemptTransition(command.action, command.transition, settlementLease)
          yield* Deferred.succeed(command.completed, undefined)
        } else {
          yield* executeNewRecoveredAction(command.action, command.operationId, settlementLease, runId)
          yield* Deferred.succeed(command.completed, undefined)
        }
      }
    })
    const scope = runCancellationMbtScope
    if (scope === undefined) return yield* Effect.die("cancellation MBT scope was not installed")
    const fiber = yield* Effect.forkScoped(
      installed.activate(
        target,
        Effect.succeed(initialPolicy),
        AllocatedWorkflowRunId.make(runId),
        program.pipe(
          Effect.provide(
            deterministicTaskClaimAcquisitionPlannerLayer({
              owner: ClaimOwner.make("dalph-run-cancellation-planner"),
              tokenPrefix: "run-cancellation"
            })
          )
        )
      )
    ).pipe(Effect.provideService(Scope.Scope, scope))
    runtimeFiber = fiber
    yield* Deferred.await(ready).pipe(Effect.orDie)
  })

  const publishGraphAndInspectPause = (operationNumber: number) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<"RunPaused" | "RunUnpaused">()
      yield* Queue.offer(commands, { _tag: "PublishGraph", completed, operationNumber })
      const fiber = runtimeFiber
      const pause =
        fiber === undefined
          ? yield* Deferred.await(completed)
          : yield* Effect.raceFirst(
              Deferred.await(completed),
              Fiber.join(fiber).pipe(
                Effect.flatMap(() => Effect.die("cancellation runtime exited before publishing graph facts"))
              )
            )
      if (durable.cancellationApplied && pause !== "RunPaused") {
        return yield* Effect.die("production delivery did not borrow cancellation's effective Run Pause")
      }
      effectivePause = pause
    })

  const awaitSettlementCommand = (completed: Deferred.Deferred<void>) => {
    const fiber = runtimeFiber
    return fiber === undefined
      ? Deferred.await(completed)
      : Effect.raceFirst(
          Deferred.await(completed),
          Fiber.join(fiber).pipe(
            Effect.flatMap(() => Effect.die("cancellation runtime exited before settlement command completed"))
          )
        )
  }

  const executePlannedSettlement = (transition: SettlementPlannedTransition) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<void>()
      yield* Queue.offer(commands, {
        _tag: "ExecutePlannedSettlement",
        action: identityFreeActionFor(transition),
        completed,
        transition
      })
      yield* awaitSettlementCommand(completed)
    })

  const executeRecoveredSettlement = (action: NewRecoveredWorkflowAction, operationId: OperationId) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<void>()
      yield* Queue.offer(commands, { _tag: "ExecuteRecoveredSettlement", action, completed, operationId })
      yield* awaitSettlementCommand(completed)
    })

  const seedRunningAttempt = Effect.gen(function* () {
    const commands = runtimeCommands
    if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
    const completed = yield* Deferred.make<void>()
    yield* Queue.offer(commands, { _tag: "SeedRunningAttempt", completed })
    yield* awaitSettlementCommand(completed)
  })

  const relinquishCancelledAttempt = Effect.gen(function* () {
    const safeObservation = records.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorStateObserved" &&
        event.observation._tag === "ExactExecutorReport" &&
        event.observation.report._tag === "SafelySuspended" &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId
    )
    if (safeObservation === undefined || safeObservation.event._tag !== "PlannedAttemptExecutorStateObserved") {
      return yield* Effect.die("cancelled-attempt relinquishment requires the exact safe executor projection")
    }
    yield* executePlannedSettlement(
      RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
        plannedAttempt,
        proof: { _tag: "StateProjection", observationOrdinal: safeObservation.event.ordinal }
      })
    )
    if (
      !records.some(
        ({ event }) =>
          event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
          event.plannedAttempt.attemptId === plannedAttempt.attemptId
      )
    ) {
      return yield* Effect.die("production cancellation adapter did not persist responsibility relinquishment")
    }
  })

  const cancelledClaimReleaseTransition = () =>
    Effect.gen(function* () {
      const cancellation = records.findLast(({ event }) => event._tag === "RunCancellationApplied")
      const relinquishment = records.findLast(
        ({ event }) =>
          event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
          event.plannedAttempt.attemptId === plannedAttempt.attemptId
      )
      if (
        cancellation === undefined ||
        relinquishment === undefined ||
        cancellation.event._tag !== "RunCancellationApplied" ||
        relinquishment.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished"
      ) {
        return yield* Effect.die("cancellation claim release requires durable cancellation and relinquishment")
      }
      const operation = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
          cancellationAppliedAt: cancellation.position,
          implementationRelinquishedAt: relinquishment.position,
          observationOperationId: claimReadOperationId
        }),
        predecessorOperationIds: [activeClaim.operationId, claimReadOperationId],
        release: { claim: activeClaim, operationId: claimReleaseOperationId }
      })
      return RunnableFrontierTransition.ReleaseCancelledAttemptClaim({ operation, plannedAttempt })
    })

  const resetAfterProcessLoss = () => {
    const outstandingExecutor = durable.executor !== "NoExecutor" && durable.executor !== "SafelySuspended"
    const outstanding = !(
      (durable.executor === "NoExecutor" || durable.executor === "SafelySuspended") &&
      (durable.claim === "NoClaim" || durable.claim === "Released" || durable.claim === "ForeignClaim") &&
      (durable.integration === "NoIntegration" || durable.integration === "IntegrationSettled")
    )
    process = {
      phase: "ProcessLost",
      requestedRunId: durable.runId,
      requestedTarget: durable.target,
      admissionOpen: false,
      exitCutoff: false,
      executorPositionHeld: outstandingExecutor,
      responsibilitiesSettled: !outstanding,
      graphRead: false,
      graph: "NoGraph",
      forwardAdmissions: 0,
      freshAfterRestart: false,
      cancellationRejected: false
    }
  }

  const implementation = {
    init: () =>
      Effect.gen(function* () {
        yield* stopRuntime
        if (bootstrap === undefined) bootstrap = yield* productionBootstrap
        records = []
        durable = makeInitialDurable()
        process = makeInitialProcess()
        effectivePause = undefined
        executorAuthority = "Running"
        claimHeld = true
        yield* startRuntime
      }),
    selectIdleRun: () =>
      Effect.sync(() => {
        process = { ...process, executorPositionHeld: false, responsibilitiesSettled: true, graph: "NotAllSucceeded" }
      }),
    selectRunningExecutor: () =>
      Effect.gen(function* () {
        yield* seedRunningAttempt
        durable = { ...durable, executor: "Running", claim: "Held", integration: "NoIntegration" }
        process = { ...process, executorPositionHeld: true, responsibilitiesSettled: false }
      }),
    selectIntegrationOwned: () =>
      Effect.sync(() => {
        durable = { ...durable, integration: "IntegrationOwned" }
        process = { ...process, responsibilitiesSettled: false }
      }),
    selectTemporaryWait: () => Effect.sync(() => (process = { ...process, graph: "TemporaryWait" })),
    selectApplicationExitCutoff: () => Effect.sync(() => (process = { ...process, exitCutoff: true })),
    selectForeignRunRequest: () => Effect.sync(() => (process = { ...process, requestedRunId: "R2" })),
    selectTerminalHistory: () =>
      Effect.sync(() => {
        durable = { ...durable, terminalHistory: "Cancelled" }
        process = { ...process, phase: "TerminalHistory", admissionOpen: false }
      }),
    applyCancellation: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const result = yield* installed.operatorControl.applyRunCancellation({ runId })
        if (result._tag !== "RunCancellationApplied")
          return yield* Effect.die(`unexpected production cancellation result ${result._tag}`)
        const current = yield* Effect.succeed(reduceWorkflowJournalHistory(runId, records))
        if (
          current._tag !== "ValidWorkflowJournalHistory" ||
          current.runState.cancellation?._tag !== "RunCancellationApplied"
        ) {
          return yield* Effect.die("production cancellation append did not reconstruct")
        }
        if (records.filter(({ event }) => event._tag === "RunCancellationApplied").length !== 1) {
          return yield* Effect.die("production cancellation append was not exact")
        }
        durable = { ...durable, cancellationApplied: true, cancellationAppends: durable.cancellationAppends + 1 }
        process = { ...process, phase: "Cancelling", admissionOpen: false, cancellationRejected: false }
      }),
    redeliverCancellation: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const before = records.length
        const result = yield* installed.operatorControl.applyRunCancellation({ runId })
        if (result._tag !== "RunCancellationAlreadyApplied" || records.length !== before) {
          return yield* Effect.die("production cancellation redelivery appended or lost its existing result")
        }
        durable = { ...durable, cancellationRedeliveries: durable.cancellationRedeliveries + 1 }
      }),
    recordExecutorStopIntent: () =>
      Effect.gen(function* () {
        const transition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
        yield* executePlannedSettlement(transition)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "Suspend" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          ) ||
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "Running" &&
              event.report.correlation.attemptId === plannedAttempt.attemptId
          )
        ) {
          return yield* Effect.die("production suspension adapter did not persist the exact intent and report")
        }
        durable = { ...durable, executor: "StopIntentRecorded", executorStopIntents: durable.executorStopIntents + 1 }
        process = { ...process, executorPositionHeld: true }
      }),
    reportExecutorSafe: () =>
      Effect.gen(function* () {
        executorAuthority = "SafelySuspended"
        yield* executePlannedSettlement(
          RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({ plannedAttempt })
        )
        if (
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "SafelySuspended" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          )
        ) {
          return yield* Effect.die("production executor observation adapter did not persist the safe report")
        }
        yield* relinquishCancelledAttempt
        durable = { ...durable, executor: "SafelySuspended", executorSafeReports: durable.executorSafeReports + 1 }
        process = { ...process, executorPositionHeld: false }
      }),
    recordClaimReleaseIntent: () =>
      Effect.gen(function* () {
        const transition = RunnableFrontierTransition.ObserveCancelledAttemptClaim({
          operation: claimReadOperation,
          plannedAttempt
        })
        const action = newRecoveredActionOf(transition)
        if (action === undefined) return yield* Effect.die("production claim observation route was not derived")
        yield* executeRecoveredSettlement(action, claimReadOperationId)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === claimReadOperationId
          ) ||
          !records.some(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.operationId === claimReadOperationId &&
              event.observation._tag === "FocusedTaskClaimFacts" &&
              event.observation.observation._tag === "ActiveTaskClaim" &&
              event.observation.observation.operationId === activeClaim.operationId
          )
        ) {
          return yield* Effect.die("production claim observation adapter did not persist the exact focused read")
        }
        durable = { ...durable, claim: "ReleaseIntentRecorded", claimReleaseIntents: durable.claimReleaseIntents + 1 }
      }),
    observeAndReleaseClaim: () =>
      Effect.gen(function* () {
        const transition = yield* cancelledClaimReleaseTransition()
        const action = newRecoveredActionOf(transition)
        if (action === undefined) return yield* Effect.die("production claim release route was not derived")
        yield* executeRecoveredSettlement(action, claimReleaseOperationId)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "TaskClaimReleaseIntended" &&
              event.operation.release.operationId === claimReleaseOperationId
          ) ||
          !records.some(
            ({ event }) => event._tag === "TaskClaimReleased" && event.release.operationId === claimReleaseOperationId
          )
        ) {
          return yield* Effect.die("production claim release adapter did not persist intent and outcome")
        }
        durable = {
          ...durable,
          claim: "Released",
          claimReleaseObservations: durable.claimReleaseObservations + 1,
          claimReleases: durable.claimReleases + 1
        }
      }),
    recordIntegrationIntent: () =>
      Effect.sync(() => {
        durable = {
          ...durable,
          integration: "PromotionIntentRecorded",
          integrationIntents: durable.integrationIntents + 1
        }
      }),
    observePromotedIntegration: () =>
      Effect.sync(() => {
        durable = { ...durable, integration: "PromotionAccepted", promotionAccepted: true }
      }),
    settlePromotedIntegration: () =>
      Effect.sync(() => {
        durable = {
          ...durable,
          integration: "IntegrationSettled",
          integrationSettlements: durable.integrationSettlements + 1
        }
      }),
    readFreshClassificationGraph: () =>
      Effect.gen(function* () {
        const number = durable.classificationReads + 1
        yield* publishGraphAndInspectPause(number)
        durable = { ...durable, classificationReads: number }
        process = { ...process, graphRead: true }
      }),
    readTemporaryWaitGraph: () =>
      Effect.gen(function* () {
        const number = durable.classificationReads + 1
        yield* publishGraphAndInspectPause(number)
        durable = { ...durable, classificationReads: number }
        process = { ...process, graphRead: true }
      }),
    handoffToFreshClassification: () => Effect.sync(() => (process = { ...process, phase: "ReadyForClassification" })),
    crashBeforeSettlement: () =>
      Effect.gen(function* () {
        const before = records
        yield* stopRuntime
        if (records !== before) return yield* Effect.die("process loss changed durable cancellation history")
        durable = { ...durable, processLosses: durable.processLosses + 1 }
        resetAfterProcessLoss()
      }),
    restartCancellation: () =>
      Effect.gen(function* () {
        const reconstructed = reduceWorkflowJournalHistory(runId, records)
        if (
          reconstructed._tag !== "ValidWorkflowJournalHistory" ||
          reconstructed.runState.cancellation?._tag !== "RunCancellationApplied"
        ) {
          return yield* Effect.die("restart did not reconstruct the applied cancellation")
        }
        yield* startRuntime
        process = {
          ...process,
          phase: "Cancelling",
          admissionOpen: false,
          freshAfterRestart: true,
          graph: "NotAllSucceeded"
        }
      }),
    reconcileExecutorAfterRestart: () =>
      Effect.gen(function* () {
        executorAuthority = "SafelySuspended"
        yield* executePlannedSettlement(
          RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({ plannedAttempt })
        )
        if (
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          ).length !== 1 ||
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "SafelySuspended"
          )
        ) {
          return yield* Effect.die("restart executor reconciliation duplicated the command or lost safe evidence")
        }
        yield* relinquishCancelledAttempt
        durable = { ...durable, executor: "SafelySuspended", executorSafeReports: 1 }
        process = { ...process, executorPositionHeld: false }
      }),
    reconcileClaimAfterRestart: () =>
      Effect.gen(function* () {
        const transition = yield* cancelledClaimReleaseTransition()
        const action = newRecoveredActionOf(transition)
        if (action === undefined) return yield* Effect.die("restart claim release route was not derived")
        yield* executeRecoveredSettlement(action, claimReleaseOperationId)
        if (
          records.filter(
            ({ event }) =>
              event._tag === "TaskClaimReleaseIntended" &&
              event.operation.release.operationId === claimReleaseOperationId
          ).length !== 1 ||
          records.filter(
            ({ event }) => event._tag === "TaskClaimReleased" && event.release.operationId === claimReleaseOperationId
          ).length !== 1
        ) {
          return yield* Effect.die("restart claim reconciliation duplicated or lost the exact release operation")
        }
        durable = { ...durable, claim: "Released", claimReleaseObservations: 1, claimReleases: 1 }
      }),
    reconcileIntegrationAfterRestart: () =>
      Effect.sync(() => {
        durable = { ...durable, integration: "PromotionAccepted", promotionAccepted: true }
      }),
    settleAfterIdleCancellation: () => Effect.sync(() => (process = { ...process, responsibilitiesSettled: true })),
    markExecutorUnreadable: () =>
      Effect.sync(() => {
        durable = { ...durable, executor: "ExecutorUnreadable" }
        process = { ...process, executorPositionHeld: true, responsibilitiesSettled: false }
      }),
    markIntegrationUnreadable: () =>
      Effect.sync(() => {
        durable = { ...durable, integration: "IntegrationUnreadable" }
        process = { ...process, responsibilitiesSettled: false }
      }),
    rejectCancellationAtExit: () =>
      Effect.sync(() => {
        process = { ...process, phase: "Rejected", cancellationRejected: true }
      }),
    rejectForeignCancellation: () =>
      Effect.sync(() => {
        process = { ...process, phase: "Rejected", cancellationRejected: true }
      }),
    rejectTerminalHistory: () => Effect.sync(() => (process = { ...process, phase: "TerminalHistory" })),
    admitForwardWork: () =>
      Effect.sync(() => (process = { ...process, forwardAdmissions: process.forwardAdmissions + 1 })),
    getProductionEvidence: () => {
      const reconstructed = reduceWorkflowJournalHistory(runId, records)
      return Effect.succeed({
        eventTags: records.map(({ event }) => event._tag),
        cancellation:
          reconstructed._tag === "ValidWorkflowJournalHistory" ? reconstructed.runState.cancellation?._tag : "Invalid",
        effectivePause
      })
    },
    getState: () => Effect.succeed(projectionOf(durable, process))
  }

  return implementation
}

const runCancellationDriver = defineDriver(makeRunCancellationActions, makeCancellationDriverImplementation)

const withCancellationDriver = <A, E>(
  use: (driver: ReturnType<typeof makeCancellationDriverImplementation>) => Effect.Effect<A, E>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const driver = makeCancellationDriverImplementation()
      runCancellationMbtScope = scope
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (runCancellationMbtScope === scope) runCancellationMbtScope = undefined
        })
      )
      return yield* use(driver)
    })
  )

const stateCheckProjection = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
      Effect.map(
        ({ state }): DriverProjection => ({
          state: {
            durable: {
              runId: state.durable.runId.tag,
              target: state.durable.target.tag,
              cancellationApplied: state.durable.cancellationApplied,
              cancellationAppends: Number(state.durable.cancellationAppends),
              cancellationRedeliveries: Number(state.durable.cancellationRedeliveries),
              cancellationActor: state.durable.cancellationActor.tag,
              executor: state.durable.executor.tag,
              claim: state.durable.claim.tag,
              integration: state.durable.integration.tag,
              worktreePreserved: state.durable.worktreePreserved,
              logsPreserved: state.durable.logsPreserved,
              evidencePreserved: state.durable.evidencePreserved,
              executorStopIntents: Number(state.durable.executorStopIntents),
              executorSafeReports: Number(state.durable.executorSafeReports),
              claimReleaseIntents: Number(state.durable.claimReleaseIntents),
              claimReleaseObservations: Number(state.durable.claimReleaseObservations),
              claimReleases: Number(state.durable.claimReleases),
              integrationIntents: Number(state.durable.integrationIntents),
              integrationSettlements: Number(state.durable.integrationSettlements),
              promotionAccepted: state.durable.promotionAccepted,
              terminalHistory: state.durable.terminalHistory.tag,
              processLosses: Number(state.durable.processLosses),
              classificationReads: Number(state.durable.classificationReads)
            },
            process: {
              phase: state.process.phase.tag,
              requestedRunId: state.process.requestedRunId.tag,
              requestedTarget: state.process.requestedTarget.tag,
              admissionOpen: state.process.admissionOpen,
              exitCutoff: state.process.exitCutoff,
              executorPositionHeld: state.process.executorPositionHeld,
              responsibilitiesSettled: state.process.responsibilitiesSettled,
              graphRead: state.process.graphRead,
              graph: state.process.graph.tag,
              forwardAdmissions: Number(state.process.forwardAdmissions),
              freshAfterRestart: state.process.freshAfterRestart,
              cancellationRejected: state.process.cancellationRejected
            }
          }
        })
      )
    ),
  (spec, implementation) => JSON.stringify(spec) === JSON.stringify(implementation)
)

it.effect("uses the production cancellation journal boundary and effective Pause selection", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectIdleRun()
      yield* driver.applyCancellation()
      yield* driver.redeliverCancellation()
      yield* driver.readFreshClassificationGraph()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
      expect(evidence.cancellation).toBe("RunCancellationApplied")
      expect(evidence.effectivePause).toBe("RunPaused")
    })
  )
)

it.effect("reconstructs the exact applied cancellation after process loss", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectRunningExecutor()
      yield* driver.applyCancellation()
      yield* driver.recordExecutorStopIntent()
      yield* driver.crashBeforeSettlement()
      yield* driver.restartCancellation()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.cancellation).toBe("RunCancellationApplied")
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
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
            const scope = yield* Effect.scope
            runCancellationMbtScope = scope
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                if (runCancellationMbtScope === scope) runCancellationMbtScope = undefined
              })
            )
            return yield* test()
          })
        ),
      options
    ),
  "replays Run cancellation through the production bootstrap and journal reconstruction",
  {
    backend: "typescript",
    driverFactory: runCancellationDriver,
    maxSteps: 24,
    nTraces: 100,
    seed: "102",
    spec: "specs/runCancellation.qnt",
    stateCheck: stateCheckProjection
  },
  120_000
)
