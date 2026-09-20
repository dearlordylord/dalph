/* eslint-disable max-lines -- The complete executor protocol action map stays visible in one adapter. */
/* eslint-disable import/no-nodejs-modules -- Conformance instrumentation reads repository provenance and CPU. */
/* eslint-disable no-restricted-globals -- Conformance instrumentation records process provenance and CPU. */
/* eslint-disable no-magic-numbers -- Focused conformance seeds, ordinals, and timeout bounds are protocol fixtures. */
/* eslint-disable functional/no-throw-statements -- Invalid directed observations fail closed. */
import { it } from "@effect/vitest"
import {
  defineDriver,
  ITFBigInt,
  stateCheck,
  quintRun,
  quintRunWithTraceGeneration,
  generateTraces,
  TraceGeneration
} from "@firfi/quint-connect/effect"
import { expect } from "vitest"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorBeginProofId,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  beginPlannedAttemptExecutorResponsibility,
  beginPlannedAttemptExecutorWork,
  type JournalRecord,
  Journal,
  JournalStore,
  JournalPosition,
  makePlannedAttemptProtocolController,
  makeApplicationExitLifecycle,
  observePlannedAttemptExecutorState,
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolControllerService,
  requestPlannedAttemptExecutorSuspension,
  resumePlannedAttemptExecutorWork,
  TaskWorkCapacity
} from "../../../orchestrator/src/index.js"
import { Cause, Clock, Context, Deferred, Duration, Effect, Fiber, Layer, Ref, Schema, Scope } from "effect"
import { AcceptedJournalReader } from "../../../orchestrator/src/workflow-journal/accepted-reader.js"
import { liveJournalTestLayer } from "../../../orchestrator/src/coordination/delivery/live-journal-test-layer.js"
import { makeExecutorResumeModelFixture } from "./planned-attempt-executor-resume-fixture.js"
import { makeWorkflowRunBeganRecord } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { InitialControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { runPlannedAttemptExecutorResumeRedelivery } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/resume-redelivery.js"
import type { PlannedAttemptContinuationWitness } from "../../../orchestrator/src/workflow/protocols/planned-attempt-continuation/events.js"
import {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorResumeRedeliveryOrdinal
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import type { PlannedAttemptExecutorCommandProjectionOrdinal } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import type { SafeContinuationRevalidationEligibility } from "../../../orchestrator/src/coordination/frontier/fresh-facts.js"
import { requiredPlannedAttemptPositionsOf } from "../../../orchestrator/src/coordination/run/required-planned-attempt-positions.js"
import { ActiveTaskClaim } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { PlannedWorktreeReady } from "../../../orchestrator/src/authorities/git/worktree.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "../../../orchestrator/src/coordination/delivery/delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  trackerGraphReadProposalOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import { makeIntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeFreshTaskAdmissionBasis } from "../../../orchestrator/src/coordination/admission/fresh-task-admission.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../../orchestrator/src/workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { InRunJournal } from "../../../orchestrator/src/workflow-journal/store.js"
import { JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  attemptPlanRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import {
  checkReverseTrace,
  checkReverseTraceWithOracle,
  checkReverseTraceWithReversedEnumeration,
  checkReverseCollection,
  decodeReverseProjection,
  reverseModelStep,
  reverseModelSourceSha256,
  reverseProjectionFieldManifest,
  reverseProjectionId,
  reverseProjectionVersion,
  reverseTraceVersion,
  modelPathSemanticIdentity,
  modelTransitionSemanticIdentity,
  projectModelEnvironment,
  type ReverseCollection,
  type ReverseExecutorObservation,
  type ReverseJournalObservation,
  type ReverseOutcome,
  type ReverseTrace,
  type ReverseTraceEvent
} from "./planned-attempt-executor-reverse.js"
import {
  loadCanonicalMbtStepOracle,
  loadOracleFromBytes,
  loadResumeRedeliveryOracle,
  quintModelStateIdentity
} from "./quint-evaluator-frontier.js"
import { version as quintVersion } from "@informalsystems/quint/dist/src/version.js"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { currentSourceInputDigest, repositoryHead } from "./gate-run-identity-adapter.js"

const specification = makeTaskWorkSpecification({
  body: "Complete the model task.",
  taskId: TaskId.make("model-task"),
  title: "Complete model task"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/model-attempt"),
  executor: TaskExecutorLocator.make("executor:model"),
  runId: RunId.make("158"),
  taskId: TaskId.make("model-task"),
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/model-attempt")
})
const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
const modelTarget = FixtureTarget.make("planned-attempt-executor-model")
const modelRunBegan = makeWorkflowRunBeganRecord(
  plannedAttempt.runId,
  modelTarget,
  InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
)
let executorConformanceScope: Scope.Scope | undefined
const freshAttemptPrefixAcceptedAt = JournalPosition.make(10)
const plannedAttemptGraph = (() => {
  const projected = projectTrackerSnapshot({
    revision: "planned-attempt-executor-model-graph",
    tasks: [
      { id: plannedAttempt.taskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  if (projected._tag !== "Valid")
    return Effect.runSync(Effect.die(`invalid planned-attempt graph fixture: ${JSON.stringify(projected.issues)}`))
  return projected.snapshot
})()
const continuationProposal = {
  ...trackerGraphReadProposalOf({
    acceptedAt: freshAttemptPrefixAcceptedAt,
    purpose: "EstablishCurrentGraph",
    runId: plannedAttempt.runId,
    target: modelTarget
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
    plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
    taskWorkPosition: {
      _tag: "TaskWorkPositionRequired" as const,
      mode: "ReserveOrReuse" as const,
      taskId: plannedAttempt.taskId
    }
  },
  id: DeliveryProposalId.make("planned-attempt-executor-model-continuation")
}

const Variant = Schema.Struct({ tag: Schema.String, value: Schema.Unknown })
const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    resumeRecovery: Schema.Struct({
      projectionOrdinal: ITFBigInt,
      totalRedeliveryIntents: ITFBigInt,
      redeliveryCallCount: ITFBigInt
    }),
    commandCallCount: ITFBigInt,
    beginTurnCrossingCount: ITFBigInt,
    commandIntentCount: ITFBigInt,
    commandResponseEvidenceCount: ITFBigInt,
    commandResponseSettlementCount: ITFBigInt,
    commandSettlementCount: ITFBigInt,
    commandState: Variant,
    evidence: Variant,
    nextCommandOrdinal: ITFBigInt,
    positionHeld: Schema.Boolean,
    reconciliationProjectionsThisActivation: ITFBigInt,
    recoveryCount: ITFBigInt,
    responseAmbiguous: Schema.Boolean,
    beginIntentsSinceSafeSuspension: ITFBigInt,
    resumeIntentsSinceSafeSuspension: ITFBigInt,
    acceptedReportOrdinal: ITFBigInt,
    observationCount: ITFBigInt,
    durableObservationCount: ITFBigInt,
    proposalIdentityCount: ITFBigInt,
    status: Variant,
    suspendIntentsSinceExecuting: ITFBigInt,
    terminalReportEverAccepted: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)
const pickedTag = variantTag
const reportFrom = (value: unknown): PlannedAttemptExecutorReport => {
  switch (pickedTag(value)) {
    case "ExecutorWorkSafelySuspended":
      return PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    case "ExecutorWorkTerminal":
      return PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation,
        result: { _tag: "Completed" }
      })
    default:
      return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
  }
}

type ReverseDriverCapture = {
  readonly journal: Array<ReverseJournalObservation>
  readonly executor: Array<ReverseExecutorObservation>
  readonly eligibility: Array<SafeContinuationRevalidationEligibility>
  readonly witnesses: Array<PlannedAttemptContinuationWitness>
  readonly projections: Array<ReturnType<typeof decodeReverseProjection>>
  processCuts: number
  eligibilityReads: number
  witnessReads: number
}

let activeReverseDriverCapture: ReverseDriverCapture | undefined
let activeReverseDriverStop: (() => Effect.Effect<void, never, never>) | undefined

const executorConformanceDriver = defineDriver(
  {
    acceptFreshStateProjectionProof: {},
    beginResponsibility: {},
    callBegin: {},
    callBeginPreTurn: {},
    recordPreTurnThreadRead: { read: Schema.Unknown },
    recordEmptyReplacementIntent: {},
    allocateReplacementThread: {},
    associateReplacementThread: {},
    redeliverBegin: {},
    crossRedeliveredBeginTurn: {},
    callResume: {},
    readResumeContinuationWitness: {},
    recordResumeRedeliveryIntent: {},
    callResumeRedelivery: {},
    crashResumeDelivery: {},
    callSuspend: {},
    init: {},
    loseCommandResponse: {},
    receiveCommandResponse: { report: Schema.Unknown },
    recordCommandProjection: { commandProjection: Schema.Unknown },
    recordFreshStateProjection: { stateObservation: Schema.Unknown },
    recordBeginIntent: {},
    recordResumeIntent: {},
    recordSuspendIntent: {},
    recoverActivation: {},
    settleCommandProjection: {},
    settleCommandResponse: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = [modelRunBegan]
    let controller: DeliveryRuntimeAdmissionController | undefined
    let protocolController: PlannedAttemptProtocolControllerService | undefined
    let authorityReport: PlannedAttemptExecutorReport | undefined
    let currentProjection: PlannedAttemptExecutorProjection | undefined
    let commandKind: "Begin" | "Resume" | "Suspend" = "Begin"
    let commandIntentGate = Deferred.makeUnsafe<void>()
    let commandIntentSignal = Deferred.makeUnsafe<void>()
    let commandCallSignal = Deferred.makeUnsafe<void>()
    let commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
    let beginTurnGate = Deferred.makeUnsafe<void>()
    let beginTurnSignal = Deferred.makeUnsafe<void>()
    let beginTurnCrossingCount = 0
    let responseGate = Deferred.makeUnsafe<void>()
    let responseSignal = Deferred.makeUnsafe<void>()
    let projectionGate = Deferred.makeUnsafe<void>()
    let projectionSignal = Deferred.makeUnsafe<void>()
    let stateGate = Deferred.makeUnsafe<void>()
    let stateSignal = Deferred.makeUnsafe<void>()
    let pauseCommandIntent = false
    let pauseResponse = false
    let pauseProjection = false
    let pauseState = false
    let pendingCommand: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let pendingProjection: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let pendingState: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let commandCalls = 0
    let currentCommandCalled = false
    let observationCalls = 0
    // Recovery count is an activation-local driver fact; command and evidence
    // state below still comes exclusively from the production journal.
    let recoveryCount = 0
    let projectionBaseline = 0
    let resumeRecoveryRequired = false
    let resumeWitness: PlannedAttemptContinuationWitness | undefined
    let resumeEligibility: SafeContinuationRevalidationEligibility | undefined
    let resumeReservation: DeliveryAdmissionReservation | undefined
    let redeliveryCalls: ReadonlyArray<PlannedAttemptExecutorCommandOrdinal> = []
    let observedAttemptId: AttemptId | undefined
    let liveExecutorOperation: ReverseExecutorObservation["operation"] | undefined
    let liveExecutorCorrelation: ReverseExecutorObservation["correlation"] | undefined
    const reverseCapture: ReverseDriverCapture = {
      journal: [],
      executor: [],
      eligibility: [],
      witnesses: [],
      projections: [],
      processCuts: 0,
      eligibilityReads: 0,
      witnessReads: 0
    }
    activeReverseDriverCapture = reverseCapture
    activeReverseDriverStop = () =>
      Effect.gen(function* () {
        const detached = [pendingCommand, pendingProjection, pendingState]
        pendingCommand = undefined
        pendingProjection = undefined
        pendingState = undefined
        for (const fiber of detached) {
          if (fiber === undefined) continue
          yield* Fiber.interrupt(fiber)
        }
      })

    const recordExecutorCall = (
      operation: ReverseExecutorObservation["operation"],
      phase: ReverseExecutorObservation["phase"],
      arguments_: ReverseExecutorObservation["arguments"] = [],
      result?: ReverseExecutorObservation["result"],
      observedCorrelation?: ReverseExecutorObservation["correlation"]
    ) => {
      const correlation = observedCorrelation ?? liveExecutorCorrelation
      if (correlation === undefined) throw new Error(`executor ${operation} observation omitted correlation`)
      const reportTagOf = (value: ReverseExecutorObservation["result"]): ReverseExecutorObservation["report"] => {
        if (value === undefined) return undefined
        if ("report" in value) return value.report._tag
        return value._tag
      }
      reverseCapture.executor.push({
        operation,
        phase,
        correlation,
        arguments: arguments_,
        result,
        request:
          phase === "call" && operation !== "observe"
            ? operation === "begin"
              ? "Begin"
              : operation === "resume"
                ? "Resume"
                : "Suspend"
            : undefined,
        report: phase === "return" ? reportTagOf(result) : undefined
      })
      if (phase === "call") {
        liveExecutorOperation = operation
        liveExecutorCorrelation = correlation
      } else {
        liveExecutorOperation = undefined
        liveExecutorCorrelation = undefined
      }
    }
    const recordJournalObservation = (record: JournalRecord, existing: boolean) => {
      const event = record.event
      const eventAttemptId = (() => {
        if (event._tag === "TaskAttemptPlanned") return event.operation.plannedAttempt.attemptId
        if (
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
          event._tag === "PlannedAttemptExecutorCommandIntended" ||
          event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" ||
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
          event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
          event._tag === "PlannedAttemptExecutorStateObserved"
        )
          return event.plannedAttempt.attemptId
        return undefined
      })()
      if (eventAttemptId !== undefined) observedAttemptId ??= eventAttemptId
      const attemptId =
        eventAttemptId ?? (event._tag === "PlannedAttemptExecutorWorkReported" ? observedAttemptId : undefined)
      const commandOrdinal = (() => {
        if (event._tag === "PlannedAttemptExecutorCommandIntended") return event.ordinal
        if (
          event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" ||
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
          event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
          event._tag === "PlannedAttemptExecutorCommandResponseObserved"
        )
          return event.commandOrdinal
        return undefined
      })()
      reverseCapture.journal.push({
        record,
        key: record.key,
        position: record.position,
        event: event._tag,
        runId: record.runId,
        attemptId,
        commandOrdinal,
        existing
      })
    }

    const scope = executorConformanceScope
    if (scope === undefined) return Effect.runSync(Effect.die("executor model requires a live Journal scope"))
    const liveContext = Effect.runSync(
      Layer.build(
        liveJournalTestLayer({ records: [modelRunBegan], runId: plannedAttempt.runId, target: modelTarget })
      ).pipe(Effect.provideService(Scope.Scope, scope))
    )
    const liveJournal = Context.get(liveContext, Journal)
    const acceptedJournal = Context.get(liveContext, AcceptedJournalReader)
    const liveInRunJournal = Context.get(liveContext, InRunJournal)
    const liveJournalStore = Context.get(liveContext, JournalStore)
    const appendAcceptedRecord = (event: JournalRecord["event"]) =>
      Effect.gen(function* () {
        if (
          pauseCommandIntent &&
          (event._tag === "PlannedAttemptExecutorCommandIntended" ||
            event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended")
        ) {
          pauseCommandIntent = false
          yield* Deferred.succeed(commandIntentSignal, undefined)
          yield* Deferred.await(commandIntentGate)
        }
        if (pauseResponse && event._tag === "PlannedAttemptExecutorCommandResponseObserved") {
          pauseResponse = false
          yield* Deferred.succeed(responseSignal, undefined)
          yield* Deferred.await(responseGate)
        }
        if (pauseProjection && event._tag === "PlannedAttemptExecutorCommandProjectionObserved") {
          pauseProjection = false
          yield* Deferred.succeed(projectionSignal, undefined)
          yield* Deferred.await(projectionGate)
        }
        if (pauseState && event._tag === "PlannedAttemptExecutorStateObserved") {
          pauseState = false
          yield* Deferred.succeed(stateSignal, undefined)
          yield* Deferred.await(stateGate)
        }
      })
    const journal = InRunJournal.of({
      append: (eventRunId, key, event) =>
        Effect.gen(function* () {
          const existing = records.find((record) => record.runId === eventRunId && record.key === key)
          if (existing !== undefined) {
            recordJournalObservation(existing, true)
            return existing
          }
          const record = yield* liveInRunJournal.append(eventRunId, key, event)
          records = yield* liveInRunJournal.read(eventRunId)
          const appended =
            records.find((candidate) => candidate.key === key && candidate.runId === eventRunId) ?? record
          recordJournalObservation(appended, false)
          yield* appendAcceptedRecord(event)
          return appended
        }),
      read: (requestedRunId) => liveInRunJournal.read(requestedRunId)
    })
    const reducerValidInMemoryJournal = journal
    const resumeFixture = makeExecutorResumeModelFixture(reducerValidInMemoryJournal, plannedAttempt, specification)
    const appendExactFreshAttemptPrefix = Effect.fn("ExecutorModel.appendExactFreshAttemptPrefix")(function* () {
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("planned-attempt-executor-model-claim"),
          owner: ClaimOwner.make("dalph"),
          taskId: plannedAttempt.taskId,
          token: ClaimToken.make("planned-attempt-executor-model-claim-token")
        },
        predecessorOperationIds: []
      })
      yield* journal.append(
        plannedAttempt.runId,
        intentRecordKey(claimOperation.acquisition.operationId),
        TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        plannedAttempt.runId,
        outcomeRecordKey(claimOperation.acquisition.operationId),
        TaskClaimAcquiredEvent.make({
          claim: ActiveTaskClaim.make(claimOperation.acquisition),
          version: workflowJournalEventVersion
        })
      )
      const postClaimGraphOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("planned-attempt-executor-model-post-claim-graph"),
        FixtureTarget.make("planned-attempt-executor-model"),
        [claimOperation.acquisition.operationId],
        [plannedAttempt.taskId]
      )
      yield* journal.append(
        plannedAttempt.runId,
        intentRecordKey(postClaimGraphOperation.operationId),
        taskTrackerReadIntent(postClaimGraphOperation)
      )
      yield* journal.append(
        plannedAttempt.runId,
        outcomeRecordKey(postClaimGraphOperation.operationId),
        taskTrackerFactsObservedEvent(
          postClaimGraphOperation.operationId,
          makeCompleteTaskTrackerFactsObserved(postClaimGraphOperation, plannedAttemptGraph)
        )
      )
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("planned-attempt-executor-model-specification"),
        FixtureTarget.make("planned-attempt-executor-model"),
        plannedAttempt.taskId,
        [postClaimGraphOperation.operationId]
      )
      yield* journal.append(
        plannedAttempt.runId,
        intentRecordKey(specificationOperation.operationId),
        taskTrackerReadIntent(specificationOperation)
      )
      yield* journal.append(
        plannedAttempt.runId,
        outcomeRecordKey(specificationOperation.operationId),
        taskTrackerFactsObservedEvent(
          specificationOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
        )
      )
      const planOperation = {
        _tag: "RecordTaskAttemptPlan" as const,
        operationId: OperationId.make("planned-attempt-executor-model-plan"),
        plannedAttempt,
        predecessorOperationIds: [specificationOperation.operationId]
      }
      yield* journal.append(
        plannedAttempt.runId,
        attemptPlanRecordKey(plannedAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
      )
      const worktreeOperation = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("planned-attempt-executor-model-worktree"),
        plannedAttempt,
        predecessorOperationIds: [planOperation.operationId]
      })
      yield* journal.append(
        plannedAttempt.runId,
        intentRecordKey(worktreeOperation.operationId),
        TaskWorktreeReconciliationIntendedEvent.make({
          operation: worktreeOperation,
          version: workflowJournalEventVersion
        })
      )
      yield* journal.append(
        plannedAttempt.runId,
        outcomeRecordKey(worktreeOperation.operationId),
        TaskWorktreeReadyEvent.make({
          operationId: worktreeOperation.operationId,
          proof: PlannedWorktreeReady.make({
            baseSha: plannedAttempt.baseSha,
            branch: plannedAttempt.branch,
            headSha: plannedAttempt.baseSha,
            worktree: plannedAttempt.worktree
          }),
          version: workflowJournalEventVersion
        })
      )
    })
    const journalLayer = Layer.mergeAll(
      Layer.succeed(InRunJournal, reducerValidInMemoryJournal),
      Layer.succeed(AcceptedJournalReader, acceptedJournal),
      Layer.succeed(JournalStore, liveJournalStore),
      Layer.succeed(Journal, liveJournal)
    )
    const executor = PlannedAttemptExecutor.of({
      observe: (observedCorrelation, purpose) => {
        recordExecutorCall("observe", "call", [observedCorrelation, purpose], undefined, observedCorrelation)
        const projection =
          currentProjection ??
          (authorityReport === undefined
            ? PlannedAttemptExecutorProjection.cases.NoReport.make({
                correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
              })
            : PlannedAttemptExecutorProjection.cases.Exact.make({ report: authorityReport }))
        recordExecutorCall("observe", "return", [], projection)
        return Effect.succeed(projection)
      },
      requestSuspension: (suspensionAttempt) =>
        Effect.gen(function* () {
          const directCorrelation: PlannedAttemptExecutorCorrelation = {
            attemptId: suspensionAttempt.attemptId,
            runId: suspensionAttempt.runId
          }
          recordExecutorCall("requestSuspension", "call", [suspensionAttempt], undefined, directCorrelation)
          currentCommandCalled = true
          commandCalls += 1
          yield* Deferred.succeed(commandCallSignal, undefined)
          const report = yield* Deferred.await(commandResponse)
          recordExecutorCall("requestSuspension", "return", [], report)
          return report
        }),
      begin: (request, delivery) =>
        Effect.gen(function* () {
          const directCorrelation: PlannedAttemptExecutorCorrelation = {
            attemptId: request.plannedAttempt.attemptId,
            runId: request.plannedAttempt.runId
          }
          recordExecutorCall("begin", "call", [request, delivery], undefined, directCorrelation)
          currentCommandCalled = true
          if (
            request.specification.body !== specification.body ||
            request.specification.fingerprint !== specification.fingerprint ||
            request.specification.taskId !== specification.taskId ||
            request.specification.title !== specification.title
          ) {
            return yield* Effect.die("the model command must carry its exact task-work specification")
          }
          commandCalls += 1
          yield* Deferred.succeed(commandCallSignal, undefined)
          yield* Deferred.await(beginTurnGate)
          beginTurnCrossingCount += 1
          yield* Deferred.succeed(beginTurnSignal, undefined)
          const report = yield* Deferred.await(commandResponse)
          recordExecutorCall("begin", "return", [], report)
          return report
        }),
      resume: (request) =>
        Effect.gen(function* () {
          const directCorrelation: PlannedAttemptExecutorCorrelation = {
            attemptId: request.plannedAttempt.attemptId,
            runId: request.plannedAttempt.runId
          }
          recordExecutorCall("resume", "call", [request], undefined, directCorrelation)
          currentCommandCalled = true
          commandCalls += 1
          const latestDelivery = records.findLast(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" ||
              event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended"
          )?.event
          if (latestDelivery?._tag === "PlannedAttemptExecutorResumeRedeliveryIntended")
            redeliveryCalls = [...redeliveryCalls, latestDelivery.commandOrdinal]
          yield* Deferred.succeed(commandCallSignal, undefined)
          const report = yield* Deferred.await(commandResponse)
          recordExecutorCall("resume", "return", [], report)
          return report
        })
    })
    const workflowLayer = Layer.merge(journalLayer, Layer.succeed(PlannedAttemptExecutor, executor))
    const provideWorkflow = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      protocolController === undefined
        ? Effect.die("planned-attempt protocol controller not initialized")
        : effect.pipe(
            Effect.provide(workflowLayer),
            Effect.provideService(PlannedAttemptProtocolController, protocolController)
          )
    const workflow = () =>
      commandKind === "Suspend"
        ? provideWorkflow(requestPlannedAttemptExecutorSuspension(plannedAttempt))
        : commandKind === "Resume"
          ? provideWorkflow(resumePlannedAttemptExecutorWork(plannedAttempt, specification))
          : provideWorkflow(beginPlannedAttemptExecutorWork(plannedAttempt, specification))
    const requireController = () =>
      controller === undefined ? Effect.die("admission controller not initialized") : Effect.succeed(controller)
    const reservePosition = Effect.fn("ExecutorModel.reservePosition")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot
      if (!snapshot.positions.has(plannedAttempt.taskId)) {
        const decision = yield* admission.tryReserve(continuationProposal)
        if (decision._tag === "Deferred") return yield* Effect.die("planned attempt must be admitted")
        const acceptedResponsibility = yield* provideWorkflow(beginPlannedAttemptExecutorResponsibility(plannedAttempt))
        yield* admission.bindPlannedAttemptPosition(decision.reservation, plannedAttempt, acceptedResponsibility)
        yield* admission.complete(decision.reservation)
      }
    })
    const releasePosition = Effect.fn("ExecutorModel.releasePosition")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot
      if (snapshot.positions.has(plannedAttempt.taskId)) yield* admission.releasePlannedAttemptPosition(correlation)
    })
    const resetCommand = (kind: typeof commandKind) => {
      resumeRecoveryRequired = false
      currentCommandCalled = false
      commandKind = kind
      commandIntentGate = Deferred.makeUnsafe<void>()
      commandIntentSignal = Deferred.makeUnsafe<void>()
      commandCallSignal = Deferred.makeUnsafe<void>()
      commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
      responseGate = Deferred.makeUnsafe<void>()
      responseSignal = Deferred.makeUnsafe<void>()
      pauseCommandIntent = true
      pauseResponse = false
    }
    const recordIntent = (kind: typeof commandKind) =>
      Effect.gen(function* () {
        resetCommand(kind)
        const commandFiber = yield* workflow().pipe(Effect.forkDetach({ startImmediately: true }))
        pendingCommand = commandFiber
        yield* Effect.raceFirst(
          Deferred.await(commandIntentSignal),
          Fiber.await(commandFiber).pipe(
            Effect.flatMap(() => Effect.die(`production ${kind} command exited before recording its intent`))
          )
        )
      })
    const call = () =>
      Deferred.succeed(commandIntentGate, undefined).pipe(
        Effect.andThen(Deferred.await(commandCallSignal)),
        Effect.asVoid
      )
    const settleAccepted = (fiber: Fiber.Fiber<PlannedAttemptExecutorReport, unknown>) =>
      Effect.gen(function* () {
        const report = yield* Fiber.join(fiber)
        if (report._tag === "ExecutorWorkSafelySuspended" || report._tag === "ExecutorWorkTerminal")
          yield* releasePosition()
        else yield* reservePosition()
        if (report._tag === "ExecutorWorkSafelySuspended") yield* resumeFixture.graph("Open")
        resumeRecoveryRequired = false
      })
    const projectionEventCount = () =>
      records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
          event._tag === "PlannedAttemptExecutorStateObserved"
      ).length
    const unmatchedCommand = () => {
      const intended = records.findLast(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
      if (intended?.event._tag !== "PlannedAttemptExecutorCommandIntended") return undefined
      const intendedOrdinal = intended.event.ordinal
      const delivery =
        records.findLast(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" && event.commandOrdinal === intendedOrdinal
        ) ?? intended
      const settled = records.some(
        ({ event, position }, index) =>
          position > delivery.position &&
          !(
            index === records.length - 1 &&
            ((event._tag === "PlannedAttemptExecutorCommandResponseObserved" && pendingCommand !== undefined) ||
              (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" && pendingProjection !== undefined))
          ) &&
          (event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
            (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.commandOrdinal === intendedOrdinal &&
              event.observation._tag === "ExactExecutorReport"))
      )
      return settled ? undefined : intended.event
    }
    const evidenceTag = () => {
      if (pauseResponse === false && pendingCommand !== undefined) {
        const latest = records.at(-1)?.event
        if (latest?._tag === "PlannedAttemptExecutorCommandResponseObserved") return "BoundaryCommandResponse"
      }
      const latest = records.at(-1)?.event
      if (pendingProjection !== undefined && latest?._tag === "PlannedAttemptExecutorCommandProjectionObserved")
        return "CommandProjectionEvidence"
      if (pendingState !== undefined && latest?._tag === "PlannedAttemptExecutorStateObserved")
        return "FreshStateProjection"
      return "NoEvidence"
    }
    const exactReport = (event: JournalRecord["event"] | undefined) => {
      if (event?._tag === "PlannedAttemptExecutorCommandResponseObserved") return event.report
      if (
        event?._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
        event?._tag === "PlannedAttemptExecutorStateObserved"
      )
        return event.observation._tag === "ExactExecutorReport" ? event.observation.report : undefined
      return undefined
    }
    const settledCommands = () => {
      let activeIntent:
        | Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorCommandIntended" }>
        | undefined
      const settlements: Array<{
        readonly ordinal: PlannedAttemptExecutorCommandOrdinal
        readonly command: "Begin" | "Resume" | "Suspend"
        readonly recordIndex: number
        readonly report: PlannedAttemptExecutorReport
        readonly source: "Projection" | "Response"
      }> = []
      records.forEach(({ event }, index) => {
        if (event._tag === "PlannedAttemptExecutorCommandIntended") {
          activeIntent = event
          return
        }
        if (event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended") {
          const original = records.find(
            ({ event: candidate }) =>
              candidate._tag === "PlannedAttemptExecutorCommandIntended" && candidate.ordinal === event.commandOrdinal
          )?.event
          activeIntent = original?._tag === "PlannedAttemptExecutorCommandIntended" ? original : undefined
          const previous = settlements.findIndex((settlement) => settlement.ordinal === event.commandOrdinal)
          if (previous >= 0) settlements.splice(previous, 1)
          return
        }
        const report = exactReport(event)
        const isPendingEvidence =
          index === records.length - 1 &&
          ((event._tag === "PlannedAttemptExecutorCommandResponseObserved" && pendingCommand !== undefined) ||
            (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" && pendingProjection !== undefined))
        if (isPendingEvidence || activeIntent === undefined || report === undefined) return
        if (event._tag === "PlannedAttemptExecutorStateObserved") return
        if (
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
          event.commandOrdinal !== activeIntent.ordinal
        ) {
          return
        }
        settlements.push({
          ordinal: activeIntent.ordinal,
          command: activeIntent.command,
          recordIndex: index,
          report,
          source: event._tag === "PlannedAttemptExecutorCommandResponseObserved" ? "Response" : "Projection"
        })
        activeIntent = undefined
      })
      return settlements
    }

    return {
      init: () =>
        Effect.gen(function* () {
          reverseCapture.journal.length = 0
          reverseCapture.executor.length = 0
          reverseCapture.eligibility.length = 0
          reverseCapture.witnesses.length = 0
          reverseCapture.projections.length = 0
          reverseCapture.processCuts = 0
          reverseCapture.eligibilityReads = 0
          reverseCapture.witnessReads = 0
          if (pendingCommand !== undefined) yield* Fiber.interrupt(pendingCommand)
          if (pendingProjection !== undefined) yield* Fiber.interrupt(pendingProjection)
          if (pendingState !== undefined) yield* Fiber.interrupt(pendingState)
          records = yield* liveInRunJournal.read(plannedAttempt.runId)
          resumeRecoveryRequired = false
          resumeWitness = undefined
          resumeEligibility = undefined
          resumeReservation = undefined
          redeliveryCalls = []
          observedAttemptId = undefined
          authorityReport = undefined
          currentProjection = undefined
          commandCalls = 0
          currentCommandCalled = false
          beginTurnCrossingCount = 0
          beginTurnGate = Deferred.makeUnsafe<void>()
          beginTurnSignal = Deferred.makeUnsafe<void>()
          observationCalls = 0
          recoveryCount = 0
          projectionBaseline = 0
          pendingCommand = undefined
          pendingProjection = undefined
          pendingState = undefined
          yield* appendExactFreshAttemptPrefix()
          const freshProtocolController = yield* makePlannedAttemptProtocolController()
          protocolController = freshProtocolController
          controller = yield* makeDeliveryRuntimeAdmissionController(
            yield* makeFreshTaskAdmissionBasis({
              acceptedAt: freshAttemptPrefixAcceptedAt,
              capacity: TaskWorkCapacity.make(1),
              entries: [],
              runId: plannedAttempt.runId
            }),
            yield* makeIntegrationTargetResourceController(),
            (yield* makeApplicationExitLifecycle()).admission
          ).pipe(Effect.provideService(PlannedAttemptProtocolController, freshProtocolController))
        }),
      beginResponsibility: () => reservePosition().pipe(Effect.orDie, Effect.asVoid),
      recordBeginIntent: () => reservePosition().pipe(Effect.andThen(recordIntent("Begin")), Effect.orDie),
      recordResumeIntent: () => reservePosition().pipe(Effect.andThen(recordIntent("Resume")), Effect.orDie),
      recordSuspendIntent: () => recordIntent("Suspend").pipe(Effect.orDie),
      callBegin: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(beginTurnGate, undefined)
          yield* call()
          yield* Deferred.await(beginTurnSignal)
        }).pipe(Effect.orDie),
      callBeginPreTurn: () => call().pipe(Effect.orDie),
      // The controller cannot observe executor-private reads, EmptyPreTurn
      // writes, or empty-thread allocations. They stutter at this normalized
      // boundary; production executor crash-prefix tests check those effects.
      recordPreTurnThreadRead: () => Effect.void,
      recordEmptyReplacementIntent: () => Effect.void,
      allocateReplacementThread: () => Effect.void,
      associateReplacementThread: () => Effect.void,
      redeliverBegin: () =>
        Effect.gen(function* () {
          commandCallSignal = Deferred.makeUnsafe<void>()
          commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
          beginTurnGate = Deferred.makeUnsafe<void>()
          beginTurnSignal = Deferred.makeUnsafe<void>()
          responseGate = Deferred.makeUnsafe<void>()
          responseSignal = Deferred.makeUnsafe<void>()
          pendingCommand = pendingProjection
          pendingProjection = undefined
          yield* Deferred.succeed(projectionGate, undefined)
          yield* Deferred.await(commandCallSignal)
        }).pipe(Effect.orDie),
      crossRedeliveredBeginTurn: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(beginTurnGate, undefined)
          yield* Deferred.await(beginTurnSignal)
        }),
      callResume: () => call().pipe(Effect.orDie),
      readResumeContinuationWitness: () =>
        Effect.gen(function* () {
          resumeEligibility = yield* resumeFixture.eligibility()
          reverseCapture.eligibilityReads += 1
          const eligibility = resumeEligibility
          reverseCapture.eligibility.push(eligibility)
          const admission = yield* requireController()
          yield* admission.synchronize(
            yield* makeFreshTaskAdmissionBasis({
              acceptedAt: records.at(-1)?.position ?? null,
              capacity: TaskWorkCapacity.make(1),
              entries: [],
              runId: plannedAttempt.runId,
              safeContinuationRevalidations: [eligibility]
            })
          )
          const proposal = {
            ...continuationProposal,
            admission: { ...continuationProposal.admission, safeContinuationRevalidation: eligibility }
          }
          const decision = yield* admission.tryReserve(proposal)
          if (decision._tag !== "Admitted") return yield* Effect.die("retry reservation was rejected")
          resumeReservation = decision.reservation
          resumeWitness = yield* resumeFixture.readWitnesses()
          reverseCapture.witnessReads += 1
          reverseCapture.witnesses.push(resumeWitness)
        }).pipe(Effect.orDie),
      recordResumeRedeliveryIntent: () =>
        Effect.gen(function* () {
          if (
            resumeWitness === undefined ||
            resumeEligibility === undefined ||
            resumeReservation === undefined ||
            protocolController === undefined
          )
            return yield* Effect.die("retry requires actual current witnesses, eligibility, and reservation")
          const witness = resumeWitness
          const eligibility = resumeEligibility
          const reservation = resumeReservation
          if (reservation._tag !== "PlannedAttemptProtocolAdmission")
            return yield* Effect.die("retry requires exact protocol admission")
          if ((yield* reservation.permit.activate) !== "Active")
            return yield* Effect.die("retry protocol admission was released")
          const admission = yield* requireController()
          yield* admission.bindPlannedAttemptPosition(reservation, plannedAttempt)
          resetCommand("Resume")
          const fiber = yield* provideWorkflow(
            runPlannedAttemptExecutorResumeRedelivery(
              reservation.permit,
              plannedAttempt,
              eligibility,
              witness,
              (receipt) => admission.bindPlannedAttemptPosition(reservation, plannedAttempt, undefined, receipt)
            )
          ).pipe(Effect.forkDetach({ startImmediately: true }))
          pendingCommand = fiber
          yield* Effect.raceFirst(
            Deferred.await(commandIntentSignal),
            Fiber.await(fiber).pipe(Effect.flatMap(() => Effect.die("retry ended before durable intent")))
          )
          // The append is durable while its return is deliberately paused. Ordinary
          // recovery must already reconstruct Held on this side of the handoff.
          const reduction = reduceWorkflowJournalHistory(plannedAttempt.runId, records)
          if (reduction._tag !== "ValidWorkflowJournalHistory")
            return yield* Effect.die("retry intent history is invalid")
          yield* admission.synchronize(
            yield* makeFreshTaskAdmissionBasis({
              acceptedAt: records.at(-1)?.position ?? null,
              capacity: TaskWorkCapacity.make(1),
              entries: requiredPlannedAttemptPositionsOf(reduction.runState).map(() => ({
                _tag: "ExactAttemptHeld" as const,
                plannedAttempt
              })),
              runId: plannedAttempt.runId
            })
          )
          resumeWitness = undefined
          resumeEligibility = undefined
        }).pipe(Effect.orDie),
      callResumeRedelivery: () => call().pipe(Effect.orDie),
      crashResumeDelivery: () =>
        Effect.gen(function* () {
          if (pendingCommand !== undefined) {
            yield* Fiber.interrupt(pendingCommand)
            if (liveExecutorOperation !== undefined) recordExecutorCall(liveExecutorOperation, "interrupted")
          }
          reverseCapture.processCuts += 1
          pendingCommand = undefined
          if (resumeReservation !== undefined) yield* (yield* requireController()).complete(resumeReservation)
          resumeReservation = undefined
          resumeWitness = undefined
          resumeEligibility = undefined
          resumeRecoveryRequired = true
          projectionBaseline = projectionEventCount()
          recoveryCount = Math.min(recoveryCount + 1, 5)
        }),
      callSuspend: () => call().pipe(Effect.orDie),
      receiveCommandResponse: ({ report }) =>
        Effect.gen(function* () {
          if (
            !["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended", "ExecutorWorkTerminal"].includes(
              pickedTag(report)
            )
          )
            return yield* Effect.die(`model report argument was not an exact lifecycle: ${JSON.stringify(report)}`)
          pauseResponse = true
          const response = reportFrom(report)
          if (
            response._tag === "ExecutorWorkSafelySuspended" &&
            authorityReport?._tag !== "ExecutorWorkSafelySuspended"
          )
            yield* resumeFixture.graph("TerminalWithoutSuccess")
          authorityReport = response
          yield* Deferred.succeed(commandResponse, response)
          yield* Deferred.await(responseSignal)
        }).pipe(Effect.orDie),
      settleCommandResponse: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(responseGate, undefined)
          if (pendingCommand === undefined) return yield* Effect.die("command response must be pending")
          yield* settleAccepted(pendingCommand)
          pendingCommand = undefined
          if (resumeReservation !== undefined) yield* (yield* requireController()).complete(resumeReservation)
          resumeReservation = undefined
        }).pipe(Effect.orDie),
      loseCommandResponse: () =>
        Effect.gen(function* () {
          if (pendingCommand === undefined) return yield* Effect.die("command must be pending")
          yield* Fiber.interrupt(pendingCommand)
          pendingCommand = undefined
          if (resumeReservation !== undefined) yield* (yield* requireController()).complete(resumeReservation)
          resumeReservation = undefined
        }),
      recordCommandProjection: ({ commandProjection }) =>
        Effect.gen(function* () {
          projectionGate = Deferred.makeUnsafe<void>()
          projectionSignal = Deferred.makeUnsafe<void>()
          pauseProjection = true
          const tag = pickedTag(commandProjection)
          if (
            tag === "CommandProjectionExactSafelySuspended" &&
            authorityReport?._tag !== "ExecutorWorkSafelySuspended"
          )
            yield* resumeFixture.graph("TerminalWithoutSuccess")
          const foreignReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: { attemptId: AttemptId.make("other"), runId: plannedAttempt.runId }
          })
          currentProjection =
            tag === "CommandProjectionBeginNotCrossed"
              ? PlannedAttemptExecutorProjection.cases.BeginNotCrossed.make({
                  correlation,
                  proofId: PlannedAttemptExecutorBeginProofId.make("fresh-begin-proof")
                })
              : tag === "CommandProjectionNoCurrentReport"
                ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                : tag === "CommandProjectionTemporarilyUnavailable"
                  ? PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
                  : tag === "CommandProjectionUnreadable"
                    ? PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })
                    : tag === "CommandProjectionContradiction"
                      ? PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
                          expected: correlation,
                          observed: foreignReport
                        })
                      : tag === "CommandProjectionExactSafelySuspended"
                        ? PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
                          })
                        : tag === "CommandProjectionExactTerminal"
                          ? PlannedAttemptExecutorProjection.cases.Exact.make({
                              report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                                correlation,
                                result: { _tag: "Completed" }
                              })
                            })
                          : PlannedAttemptExecutorProjection.cases.Exact.make({
                              report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
                            })
          authorityReport =
            currentProjection._tag === "Exact"
              ? currentProjection.report
              : currentProjection._tag === "CorrelationContradiction"
                ? currentProjection.observed
                : undefined
          pendingProjection = yield* workflow().pipe(Effect.forkDetach({ startImmediately: true }))
          yield* Deferred.await(projectionSignal)
        }).pipe(Effect.orDie),
      settleCommandProjection: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(projectionGate, undefined)
          if (pendingProjection === undefined) return yield* Effect.die("command projection must be pending")
          yield* settleAccepted(pendingProjection)
          pendingProjection = undefined
        }).pipe(Effect.orDie),
      recordFreshStateProjection: ({ stateObservation }) =>
        Effect.gen(function* () {
          const tag = pickedTag(stateObservation)
          const latestAccepted = records.findLast(
            ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"
          )?.event
          const unchangedExact =
            latestAccepted?._tag === "PlannedAttemptExecutorWorkReported" &&
            ((tag === "ExecutorStateExecuting" && latestAccepted.report._tag === "ExecutorWorkExecuting") ||
              (tag === "ExecutorStateSafelySuspended" &&
                latestAccepted.report._tag === "ExecutorWorkSafelySuspended") ||
              (tag === "ExecutorStateTerminal" && latestAccepted.report._tag === "ExecutorWorkTerminal"))
          const foreignReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: { attemptId: AttemptId.make("other"), runId: plannedAttempt.runId }
          })
          currentProjection =
            tag === "ExecutorStateNoCurrentReport"
              ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
              : tag === "ExecutorStateTemporarilyUnavailable"
                ? PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
                : tag === "ExecutorStateUnreadable"
                  ? PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })
                  : tag === "ExecutorStateContradiction"
                    ? PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
                        expected: correlation,
                        observed: foreignReport
                      })
                    : tag === "ExecutorStateSafelySuspended"
                      ? PlannedAttemptExecutorProjection.cases.Exact.make({
                          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
                        })
                      : tag === "ExecutorStateTerminal"
                        ? PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                              correlation,
                              result: { _tag: "Completed" }
                            })
                          })
                        : PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
                          })
          authorityReport =
            currentProjection._tag === "Exact"
              ? currentProjection.report
              : currentProjection._tag === "CorrelationContradiction"
                ? currentProjection.observed
                : undefined
          observationCalls += 1
          if (unchangedExact) {
            yield* provideWorkflow(observePlannedAttemptExecutorState(plannedAttempt))
            return
          }
          stateGate = Deferred.makeUnsafe<void>()
          stateSignal = Deferred.makeUnsafe<void>()
          pauseState = true
          pendingState = yield* provideWorkflow(observePlannedAttemptExecutorState(plannedAttempt)).pipe(
            Effect.forkDetach({ startImmediately: true })
          )
          yield* Deferred.await(stateSignal)
        }).pipe(Effect.orDie),
      acceptFreshStateProjectionProof: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(stateGate, undefined)
          if (pendingState === undefined) return yield* Effect.die("state projection must be pending")
          yield* settleAccepted(pendingState)
          pendingState = undefined
        }).pipe(Effect.orDie),
      recoverActivation: () =>
        Effect.gen(function* () {
          if (resumeWitness !== undefined && resumeReservation !== undefined) {
            yield* (yield* requireController()).rollback(resumeReservation, "BeforeDurableClaimIntent")
            resumeReservation = undefined
            resumeEligibility = undefined
          }
          resumeWitness = undefined
          if (pendingProjection !== undefined) {
            if (currentProjection?._tag === "BeginNotCrossed") {
              yield* Fiber.interrupt(pendingProjection)
            } else {
              yield* Deferred.succeed(projectionGate, undefined)
              yield* Fiber.await(pendingProjection)
            }
            pendingProjection = undefined
          }
          if (pendingState !== undefined) {
            yield* Deferred.succeed(stateGate, undefined)
            yield* Fiber.await(pendingState)
            pendingState = undefined
          }
          projectionBaseline = projectionEventCount()
          recoveryCount = Math.min(recoveryCount + 1, 5)
        }),
      getState: () =>
        Effect.gen(function* () {
          const admission = yield* requireController()
          const snapshot = yield* admission.snapshot
          const intents = records.flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorCommandIntended" ? [event] : []
          )
          const reports = records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
          const settlements = settledCommands()
          const latestSafeIndex = records.findLastIndex(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
          )
          const sinceSafe = records.slice(latestSafeIndex + 1)
          const unmatched = unmatchedCommand()
          const evidence = evidenceTag()
          const stateProjectionCount = projectionEventCount() - projectionBaseline
          const latestAcceptedReport = reports.at(-1)?.event
          const responsibilityBegan = records.some(
            ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          )
          const responseAmbiguous =
            unmatched !== undefined && (currentCommandCalled || resumeRecoveryRequired) && pendingCommand === undefined
          const lastResume = intents.findLast((intent) => intent.command === "Resume")
          const projection = {
            resumeRecovery: {
              projectionOrdinal: BigInt(
                lastResume === undefined
                  ? 0
                  : records.filter(
                      ({ event }) =>
                        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
                        event.commandOrdinal === lastResume.ordinal
                    ).length
              ),
              totalRedeliveryIntents: BigInt(
                records.filter(({ event }) => event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended").length
              ),
              redeliveryCallCount: BigInt(redeliveryCalls.filter((ordinal) => ordinal === lastResume?.ordinal).length)
            },
            commandCallCount: BigInt(commandCalls),
            beginTurnCrossingCount: BigInt(beginTurnCrossingCount),
            commandIntentCount: BigInt(intents.length),
            commandResponseEvidenceCount: BigInt(
              records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved").length
            ),
            commandResponseSettlementCount: BigInt(settlements.filter(({ source }) => source === "Response").length),
            commandSettlementCount: BigInt(settlements.length),
            commandState:
              unmatched === undefined
                ? "NoCommand"
                : resumeRecoveryRequired
                  ? "CommandRecoveryRequired"
                  : !currentCommandCalled
                    ? "CommandIntended"
                    : "CommandCalled",
            evidence,
            nextCommandOrdinal: BigInt(intents.length + 1),
            positionHeld: snapshot.positions.has(plannedAttempt.taskId),
            reconciliationProjectionsThisActivation: BigInt(stateProjectionCount),
            recoveryCount: BigInt(recoveryCount),
            responseAmbiguous,
            beginIntentsSinceSafeSuspension: BigInt(intents.filter(({ command }) => command === "Begin").length),
            resumeIntentsSinceSafeSuspension: BigInt(
              sinceSafe.filter(
                ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
              ).length
            ),
            acceptedReportOrdinal: BigInt(reports.length),
            observationCount: BigInt(observationCalls),
            durableObservationCount: BigInt(
              records.filter(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved").length
            ),
            proposalIdentityCount: BigInt(
              reports.filter(
                ({ event }) =>
                  event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
              ).length
            ),
            status:
              latestAcceptedReport?._tag === "PlannedAttemptExecutorWorkReported"
                ? latestAcceptedReport.report._tag === "ExecutorWorkExecuting"
                  ? "StatusExecuting"
                  : latestAcceptedReport.report._tag === "ExecutorWorkSafelySuspended"
                    ? "StatusSafelySuspended"
                    : "StatusTerminal"
                : responsibilityBegan
                  ? "ResponsibilityBegan"
                  : "ResponsibilityNotBegun",
            suspendIntentsSinceExecuting: BigInt(
              sinceSafe.filter(
                ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
              ).length
            ),
            terminalReportEverAccepted: reports.some(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
            )
          }
          yield* Effect.sync(() => reverseCapture.projections.push(projection))
          return projection
        })
    }
  }
)

const scopedExecutorConformanceDriver = {
  create: () => {
    executorConformanceScope = Scope.makeUnsafe()
    return executorConformanceDriver.create()
  }
}

type DirectedRawStep = {
  readonly preProjection: ReturnType<typeof decodeReverseProjection> | undefined
  readonly postProjection: ReturnType<typeof decodeReverseProjection>
  readonly journal: ReadonlyArray<ReverseJournalObservation>
  readonly executor: ReadonlyArray<ReverseExecutorObservation>
  readonly eligibility: ReadonlyArray<SafeContinuationRevalidationEligibility>
  readonly witnesses: ReadonlyArray<PlannedAttemptContinuationWitness>
  readonly processCuts: number
  readonly eligibilityReads: number
  readonly witnessReads: number
}

type ReverseRunSignal = ReturnType<typeof Deferred.makeUnsafe<void>>
type ReverseRunControl = {
  readonly blockAt: string | undefined
  readonly reached: ReverseRunSignal
  readonly release: ReverseRunSignal
  readonly processCutReached: ReverseRunSignal
  readonly observationStreamClosed: ReverseRunSignal
  readonly completed: ReverseRunSignal
  readonly raw: Array<DirectedRawStep>
  readonly closeAfterProcessCut: boolean
}

const makeReverseRunControl = (blockAt: string | undefined, closeAfterProcessCut = false): ReverseRunControl => ({
  blockAt,
  reached: Deferred.makeUnsafe<void>(),
  release: Deferred.makeUnsafe<void>(),
  processCutReached: Deferred.makeUnsafe<void>(),
  observationStreamClosed: Deferred.makeUnsafe<void>(),
  completed: Deferred.makeUnsafe<void>(),
  raw: [],
  closeAfterProcessCut
})

type ReverseCaptureReader = () => Effect.Effect<ReverseDriverCapture, never, never>

type ReverseCaptureMeasurement = { readonly wallMs: number; readonly cpuMs: number }

let lastReverseCaptureMeasurement: ReverseCaptureMeasurement | undefined

const reverseCaptureMeasurement = (): ReverseCaptureMeasurement => {
  if (lastReverseCaptureMeasurement === undefined) throw new Error("reverse capture measurement is unavailable")
  return lastReverseCaptureMeasurement
}

const reverseDriverCaptureOf = (): ReverseCaptureReader => () => {
  const capture = activeReverseDriverCapture
  if (capture === undefined) return Effect.die("reverse driver observation hook is missing")
  return Effect.succeed({
    journal: [...capture.journal],
    executor: [...capture.executor],
    eligibility: [...capture.eligibility],
    witnesses: [...capture.witnesses],
    projections: [...capture.projections],
    processCuts: capture.processCuts,
    eligibilityReads: capture.eligibilityReads,
    witnessReads: capture.witnessReads
  })
}

const reverseActionBoundary = (operation: string): ReverseTraceEvent["durableBoundary"] => {
  if (operation === "init") return "initialization"
  if (operation === "beginResponsibility") return "responsibility"
  if (operation === "recordPreTurnThreadRead") return "stutter"
  if (operation.includes("Intent")) return "intent"
  if (operation.startsWith("call")) return "call"
  if (operation.startsWith("receive")) return "response"
  if (operation === "recordCommandProjection") return "projection"
  if (operation.startsWith("settle")) return "settlement"
  if (operation === "readResumeContinuationWitness") return "witness"
  if (operation === "crashResumeDelivery") return "crash"
  throw new Error(`reverse schedule operation is not a reviewed boundary: ${operation}`)
}

type ObservedSpanClassification = {
  readonly action: string
  readonly refinement: ReverseTraceEvent["refinement"]
  readonly outcome: ReverseOutcome
  readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal | undefined
  readonly projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal | undefined
  readonly redeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal | undefined
}

const typedCommandOrdinalOf = (step: DirectedRawStep): PlannedAttemptExecutorCommandOrdinal | undefined =>
  step.journal.findLast(({ record }) => {
    const tag = record.event._tag
    return (
      tag === "PlannedAttemptExecutorCommandIntended" ||
      tag === "PlannedAttemptExecutorResumeRedeliveryIntended" ||
      tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
      tag === "PlannedAttemptExecutorCommandResponseObserved" ||
      tag === "PlannedAttemptExecutorCommandResponseContradicted"
    )
  })?.commandOrdinal

const typedProjectionOrdinalOf = (
  step: DirectedRawStep
): PlannedAttemptExecutorCommandProjectionOrdinal | undefined => {
  const event = step.journal.findLast(
    ({ record }) => record.event._tag === "PlannedAttemptExecutorCommandProjectionObserved"
  )?.record.event
  return event?._tag === "PlannedAttemptExecutorCommandProjectionObserved" ? event.projectionOrdinal : undefined
}

const typedRedeliveryOrdinalOf = (step: DirectedRawStep): PlannedAttemptExecutorResumeRedeliveryOrdinal | undefined => {
  const event = step.journal.findLast(
    ({ record }) => record.event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended"
  )?.record.event
  return event?._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" ? event.redeliveryOrdinal : undefined
}

const classifyObservedSpan = (
  step: DirectedRawStep,
  index: number,
  activeCommandOrdinal: PlannedAttemptExecutorCommandOrdinal | undefined
): ObservedSpanClassification => {
  const candidates: Array<string> = []
  const tags = step.journal.map(({ record }) => record.event._tag)
  if (index === 0) candidates.push("init")
  if (tags.includes("PlannedAttemptExecutorWorkResponsibilityBegan")) candidates.push("beginResponsibility")
  const commandIntent = step.journal.find(({ record }) => record.event._tag === "PlannedAttemptExecutorCommandIntended")
  if (commandIntent?.record.event._tag === "PlannedAttemptExecutorCommandIntended") {
    candidates.push(
      commandIntent.record.event.command === "Begin"
        ? "recordBeginIntent"
        : commandIntent.record.event.command === "Suspend"
          ? "recordSuspendIntent"
          : "recordResumeIntent"
    )
  }
  if (tags.includes("PlannedAttemptExecutorResumeRedeliveryIntended")) candidates.push("recordResumeRedeliveryIntent")
  if (tags.includes("PlannedAttemptExecutorCommandProjectionObserved")) candidates.push("recordCommandProjection")
  if (tags.includes("PlannedAttemptExecutorCommandResponseObserved")) candidates.push("receiveCommandResponse")
  if (tags.includes("PlannedAttemptExecutorWorkReported")) candidates.push("settleCommandResponse")
  if (step.witnessReads > 0 || step.eligibilityReads > 0) candidates.push("readResumeContinuationWitness")
  if (step.processCuts > 0) candidates.push("crashResumeDelivery")
  const call = step.executor.find(({ phase }) => phase === "call")
  if (call?.operation === "begin") candidates.push("callBegin")
  if (call?.operation === "requestSuspension") candidates.push("callSuspend")
  if (call?.operation === "resume") {
    if (
      step.preProjection !== undefined &&
      step.preProjection.resumeRecovery.totalRedeliveryIntents > step.preProjection.resumeRecovery.redeliveryCallCount
    )
      candidates.push("callResumeRedelivery")
    else candidates.push("callResume")
  }
  if (
    candidates.length === 0 &&
    step.journal.length > 0 &&
    step.executor.length === 0 &&
    activeCommandOrdinal !== undefined
  )
    candidates.push("settleCommandProjection")
  if (candidates.length !== 1)
    throw new Error(
      `production observation span ${index} inferred ${candidates.length} boundaries: ${candidates.join(",")}`
    )
  const action = candidates[0]
  if (action === undefined) throw new Error(`production observation span ${index} omitted its boundary`)
  const commandOrdinal =
    typedCommandOrdinalOf(step) ??
    (action === "init" || action === "beginResponsibility" || action === "readResumeContinuationWitness"
      ? undefined
      : activeCommandOrdinal)
  if (
    action !== "init" &&
    action !== "beginResponsibility" &&
    action !== "readResumeContinuationWitness" &&
    commandOrdinal === undefined
  )
    throw new Error(`production observation span ${index} omitted a typed command ordinal for ${action}`)
  return {
    action,
    refinement:
      action === "receiveCommandResponse" || action === "recordCommandProjection" || action === "callResumeRedelivery"
        ? "hidden-model-choice"
        : "direct-model-step",
    outcome: step.processCuts === 0 ? "completed" : "crashed",
    commandOrdinal,
    projectionOrdinal: typedProjectionOrdinalOf(step),
    redeliveryOrdinal: typedRedeliveryOrdinalOf(step)
  }
}

const reverseTraceFromRaw = (
  raw: ReadonlyArray<DirectedRawStep>,
  faults: ReadonlyArray<string> = ["initial-resume-crash", "first-redelivery-crash"]
): ReverseTrace => {
  const first = raw[0]
  if (first === undefined) throw new Error("reverse directed schedule produced no observations")
  const correlation = raw.flatMap((step) => [
    ...step.journal.flatMap((record) =>
      record.attemptId === undefined ? [] : [{ runId: record.runId, attemptId: record.attemptId }]
    ),
    ...step.executor.map(({ correlation: observed }) => observed)
  ])[0]
  if (correlation === undefined) throw new Error("reverse observations omit correlation")
  for (const observed of raw.flatMap((step) => [
    ...step.journal.flatMap((record) =>
      record.attemptId === undefined ? [] : [{ runId: record.runId, attemptId: record.attemptId }]
    ),
    ...step.executor.map(({ correlation: fact }) => fact)
  ])) {
    if (observed.runId !== correlation.runId || observed.attemptId !== correlation.attemptId)
      throw new Error("reverse observations contain more than one subject identity")
  }
  let latestProjectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal | undefined
  let latestRedeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal | undefined
  let activeCommandOrdinal: PlannedAttemptExecutorCommandOrdinal | undefined
  const events: Array<ReverseTraceEvent> = raw.map((step, index) => {
    const classification = classifyObservedSpan(step, index, activeCommandOrdinal)
    if (classification.projectionOrdinal !== undefined) latestProjectionOrdinal = classification.projectionOrdinal
    if (classification.redeliveryOrdinal !== undefined) latestRedeliveryOrdinal = classification.redeliveryOrdinal
    const implementationAction = classification.action
    const commandOrdinal = classification.commandOrdinal
    if (
      implementationAction === "recordBeginIntent" ||
      implementationAction === "recordResumeIntent" ||
      implementationAction === "recordSuspendIntent" ||
      implementationAction === "recordResumeRedeliveryIntent"
    ) {
      if (commandOrdinal === undefined) throw new Error(`observed ${implementationAction} omitted its command ordinal`)
      activeCommandOrdinal = commandOrdinal
    }
    if (implementationAction === "settleCommandResponse") activeCommandOrdinal = undefined
    return {
      index,
      implementationAction,
      refinement: classification.refinement,
      correlation,
      commandOrdinal,
      projectionOrdinal: latestProjectionOrdinal,
      redeliveryOrdinal: latestRedeliveryOrdinal,
      preProjection: step.preProjection,
      postProjection: step.postProjection,
      eligibility: step.eligibility,
      witnesses: step.witnesses,
      durableBoundary: reverseActionBoundary(implementationAction),
      outcome: classification.outcome,
      journal: step.journal,
      executor: step.executor
    }
  })
  const last = events.at(-1)
  if (last === undefined) throw new Error("reverse directed schedule has no final observation")
  return {
    version: reverseTraceVersion,
    model: {
      specification: "specs/plannedAttemptExecutor.qnt",
      step: reverseModelStep,
      quintVersion,
      checker: "typescript-evaluator-frontier",
      sourceSha256: reverseModelSourceSha256
    },
    implementation: {
      driver: "executorConformanceDriver",
      version: "production-observation-driver-v2",
      head: repositoryHead(process.cwd()),
      sourceInputDigest: currentSourceInputDigest(process.cwd())
    },
    projection: {
      id: reverseProjectionId,
      version: reverseProjectionVersion,
      fieldManifest: reverseProjectionFieldManifest
    },
    schedule: { id: "resume-redelivery-directed-production-v2", seed: "158", faults },
    events,
    terminal: { outcome: "completed", finalAction: last.implementationAction, finalStatus: last.postProjection.status }
  }
}

const runDirectedResumeRedeliveryObserved = (
  driverFactory: typeof scopedExecutorConformanceDriver = scopedExecutorConformanceDriver,
  options: { readonly secondRedelivery?: boolean; readonly control?: ReverseRunControl } = {}
) =>
  Effect.gen(function* () {
    const captureStartedWall = performance.now()
    const captureStartedCpu = process.cpuUsage()
    const driver = yield* driverFactory.create()
    const getState = driver.getState
    if (getState === undefined) return yield* Effect.die("reverse driver state observer is missing")
    const capture = reverseDriverCaptureOf()
    const raw = options.control?.raw ?? []
    const action = (name: string) => {
      const selected = driver.actions[name]
      if (selected === undefined) throw new Error(`reverse driver action is missing: ${name}`)
      return selected
    }
    const invoke = (name: string, picks: Record<string, unknown> = {}) =>
      Effect.gen(function* () {
        const before = yield* capture()
        const preProjection = raw.length === 0 ? undefined : decodeReverseProjection(yield* getState())
        yield* action(name).handler(picks)
        const postProjection = decodeReverseProjection(yield* getState())
        const after = yield* capture()
        raw.push({
          preProjection,
          postProjection,
          journal: after.journal.slice(before.journal.length),
          executor: after.executor.slice(before.executor.length),
          eligibility: after.eligibility.slice(before.eligibility.length),
          witnesses: after.witnesses.slice(before.witnesses.length),
          processCuts: after.processCuts - before.processCuts,
          eligibilityReads: after.eligibilityReads - before.eligibilityReads,
          witnessReads: after.witnessReads - before.witnessReads
        })
        if (options.control?.closeAfterProcessCut && after.processCuts > before.processCuts) {
          yield* Deferred.succeed(options.control.processCutReached, undefined)
          yield* Deferred.await(options.control.observationStreamClosed)
          return yield* Effect.never
        }
        if (options.control?.blockAt === name) {
          yield* Deferred.succeed(options.control.reached, undefined)
          yield* Deferred.await(options.control.release)
        }
      })
    yield* invoke("init")
    yield* invoke("beginResponsibility")
    yield* invoke("recordBeginIntent")
    yield* invoke("callBegin")
    yield* invoke("receiveCommandResponse", { report: "ExecutorWorkExecuting" })
    yield* invoke("settleCommandResponse")
    yield* invoke("recordSuspendIntent")
    yield* invoke("callSuspend")
    yield* invoke("receiveCommandResponse", { report: "ExecutorWorkSafelySuspended" })
    yield* invoke("settleCommandResponse")
    yield* invoke("recordResumeIntent")
    yield* invoke("crashResumeDelivery")
    yield* invoke("recordCommandProjection", { commandProjection: "CommandProjectionExactSafelySuspended" })
    yield* invoke("settleCommandProjection")
    yield* invoke("readResumeContinuationWitness")
    yield* invoke("recordResumeRedeliveryIntent")
    yield* invoke("callResumeRedelivery")
    if (options.secondRedelivery ?? true) {
      yield* invoke("crashResumeDelivery")
      yield* invoke("recordCommandProjection", { commandProjection: "CommandProjectionExactSafelySuspended" })
      yield* invoke("settleCommandProjection")
      yield* invoke("readResumeContinuationWitness")
      yield* invoke("recordResumeRedeliveryIntent")
      yield* invoke("callResumeRedelivery")
    }
    yield* invoke("receiveCommandResponse", { report: "ExecutorWorkExecuting" })
    yield* invoke("settleCommandResponse")
    const trace = reverseTraceFromRaw(
      raw,
      (options.secondRedelivery ?? true) ? ["initial-resume-crash", "first-redelivery-crash"] : ["initial-resume-crash"]
    )
    const captureUsage = process.cpuUsage(captureStartedCpu)
    lastReverseCaptureMeasurement = {
      wallMs: performance.now() - captureStartedWall,
      cpuMs: (captureUsage.user + captureUsage.system) / 1000
    }
    if (options.control !== undefined) yield* Deferred.succeed(options.control.completed, undefined)
    return trace
  })

type ReverseCollectionMode = "completed" | "cancelled" | "timed-out" | "truncated"
const reverseCollectionDeadlineMs = 25
const realClockMillis = (): number => Number(process.hrtime.bigint() / 1_000_000n)
const realDeadlineClock = Clock.Clock.of({
  currentTimeMillisUnsafe: realClockMillis,
  currentTimeMillis: Effect.sync(realClockMillis),
  currentTimeNanosUnsafe: () => process.hrtime.bigint(),
  currentTimeNanos: Effect.sync(() => process.hrtime.bigint()),
  monotonicTimeNanosUnsafe: () => process.hrtime.bigint(),
  monotonicTimeNanos: Effect.sync(() => process.hrtime.bigint()),
  sleep: (duration) =>
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, Math.max(0, Duration.toMillis(duration)))
        })
    )
})

const stopDetachedReverseProduction = () => Effect.suspend(() => activeReverseDriverStop?.() ?? Effect.void)

const reversePrefixOf = (
  control: ReverseRunControl,
  faults: ReadonlyArray<string>
): ReadonlyArray<ReverseTraceEvent> => {
  if (control.raw.length === 0) throw new Error("reverse collection stopped before one observable prefix event")
  return reverseTraceFromRaw(control.raw, faults).events
}

/** Collects the directed run through real fibers and Deferred observation gates. */
const collectDirectedReverseCollection = (mode: ReverseCollectionMode) =>
  Effect.gen(function* () {
    const faults = ["initial-resume-crash", "first-redelivery-crash"]
    const control = makeReverseRunControl(
      mode === "cancelled" ? "callSuspend" : mode === "timed-out" ? "callResumeRedelivery" : undefined,
      mode === "truncated"
    )
    const run = yield* runDirectedResumeRedeliveryObserved(scopedExecutorConformanceDriver, { control }).pipe(
      Effect.forkChild
    )
    if (mode === "completed") {
      const trace = yield* Fiber.join(run)
      return { _tag: "Completed" as const, trace }
    }
    if (mode === "cancelled") {
      yield* Deferred.await(control.reached)
      yield* stopDetachedReverseProduction()
      yield* Fiber.interrupt(run)
      const exit = yield* Fiber.await(run)
      if (exit._tag === "Success") return yield* Effect.die("cancelled reverse run completed after interruption")
      return {
        _tag: "Cancelled" as const,
        reason: "production fiber interrupted while its executor call was blocked",
        prefix: reversePrefixOf(control, faults),
        stopped: true as const
      }
    }
    if (mode === "timed-out") {
      const started = performance.now()
      yield* Deferred.await(control.reached)
      const deadlineExit = yield* Effect.exit(
        Deferred.await(control.completed).pipe(
          Effect.timeout(Duration.millis(reverseCollectionDeadlineMs)),
          Effect.provideService(Clock.Clock, realDeadlineClock)
        )
      )
      const timedOutByClock =
        deadlineExit._tag === "Failure" &&
        deadlineExit.cause.reasons.some((reason) => Cause.isFailReason(reason) && Cause.isTimeoutError(reason.error))
      if (!timedOutByClock) return yield* Effect.die("timed-out reverse run did not observe a Clock TimeoutError")
      yield* stopDetachedReverseProduction()
      yield* Fiber.interrupt(run)
      const exit = yield* Fiber.await(run)
      if (exit._tag === "Success") return yield* Effect.die("timed-out reverse run completed after its deadline")
      return {
        _tag: "TimedOut" as const,
        elapsedMs: performance.now() - started,
        deadlineMs: reverseCollectionDeadlineMs,
        timeoutCause: "ClockDeadlineExceeded" as const,
        prefix: reversePrefixOf(control, faults),
        stopped: true as const
      }
    }
    yield* Deferred.await(control.processCutReached)
    // Closing this observation stream is the process-cut boundary.  The run
    // remains parked until the close is observed, then interruption proves the
    // production fiber cannot continue from a truncated prefix.
    yield* Deferred.succeed(control.observationStreamClosed, undefined)
    yield* stopDetachedReverseProduction()
    yield* Fiber.interrupt(run)
    const exit = yield* Fiber.await(run)
    if (exit._tag === "Success") return yield* Effect.die("truncated reverse run completed after stream close")
    return {
      _tag: "Truncated" as const,
      reason: "observation stream closed after the production process cut",
      prefix: reversePrefixOf(control, faults),
      stopped: true as const
    }
  })

const executorStateCheck = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
      Effect.map(({ state }) => ({
        ...state,
        commandState: variantTag(state.commandState),
        evidence: variantTag(state.evidence),
        status: variantTag(state.status)
      })),
      Effect.orDie
    ),
  (spec, implementation) =>
    JSON.stringify(spec, (_, value) => (typeof value === "bigint" ? value.toString() : value)) ===
    JSON.stringify(implementation, (_, value) => (typeof value === "bigint" ? value.toString() : value))
)

const makeOmittedRetryDriver = (mutantObserved: Ref.Ref<boolean>) => ({
  create: () =>
    scopedExecutorConformanceDriver.create().pipe(
      Effect.map((driver) => {
        const callBeginPreTurn = driver.actions["callBeginPreTurn"]
        if (callBeginPreTurn === undefined) throw new Error("reverse mutant driver action is missing")
        return {
          ...driver,
          actions: {
            ...driver.actions,
            callBeginPreTurn: { ...callBeginPreTurn, handler: () => Ref.set(mutantObserved, true) }
          }
        }
      })
    )
})

const reverseCheckRejectsObserved = (trace: ReverseTrace) =>
  Effect.promise(() =>
    checkReverseTrace(trace).then(
      () => false,
      () => true
    )
  )

const reverseObservedTraceDigest = (trace: ReverseTrace): string =>
  createHash("sha256")
    .update(JSON.stringify(trace, (_, value) => (typeof value === "bigint" ? `${value}n` : value)))
    .digest("hex")

const quintValueIdentity = (value: unknown): string =>
  JSON.stringify(value, (_, nested) => (typeof nested === "bigint" ? `${nested}n` : nested))

it.effect(
  "retains canonical mbtStep ambiguity paths until Safe settlement",
  () =>
    Effect.promise(async () => {
      const oracle = await loadCanonicalMbtStepOracle()
      let state = oracle.initialState
      const prefix = [] as Array<Awaited<ReturnType<typeof oracle.enumerateSuccessorsForAction>>[number]>
      for (const action of [
        "beginResponsibility",
        "recordBeginIntent",
        "callBegin",
        "receiveCommandResponse",
        "settleCommandResponse",
        "recordSuspendIntent",
        "callSuspend"
      ]) {
        const successors = oracle.enumerateSuccessorsForAction(state, action)
        if (successors.length === 0) throw new Error(`canonical mbtStep has no ${action} successor`)
        const transition =
          action === "receiveCommandResponse"
            ? successors.find(
                (candidate) =>
                  oracle.enumerateSuccessorsForAction(candidate.postState, "settleCommandResponse").length > 0
              )
            : successors[0]
        if (transition === undefined) throw new Error(`canonical mbtStep ${action} successor disappeared`)
        prefix.push(transition)
        state = transition.postState
      }
      const responses = oracle.enumerateSuccessorsForAction(state, "receiveCommandResponse")
      if (responses.length === 0) throw new Error("canonical mbtStep has no response successors")
      const observedProjection = projectModelEnvironment(responses[0]?.postState ?? state)
      const projectionMatches = responses.filter(
        (transition) =>
          quintValueIdentity(projectModelEnvironment(transition.postState)) === quintValueIdentity(observedProjection)
      )
      const fullStates = new Set(projectionMatches.map((transition) => quintModelStateIdentity(transition.postState)))
      expect(fullStates.size).toBeGreaterThanOrEqual(2)
      const safeSettlementProjection = projectionMatches
        .flatMap((response) => oracle.enumerateSuccessorsForAction(response.postState, "settleCommandResponse"))
        .map((settlement) => projectModelEnvironment(settlement.postState))
        .find((projection) => projection.status === "StatusSafelySuspended")
      if (safeSettlementProjection === undefined) throw new Error("canonical mbtStep has no observable Safe settlement")
      const settledPaths = projectionMatches.flatMap((response) =>
        oracle
          .enumerateSuccessorsForAction(response.postState, "settleCommandResponse")
          .filter(
            (settlement) =>
              quintValueIdentity(projectModelEnvironment(settlement.postState)) ===
              quintValueIdentity(safeSettlementProjection)
          )
          .map((settlement) => [...prefix, response, settlement])
      )
      const settledPathIdentities = new Set(settledPaths.map(modelPathSemanticIdentity))
      const settledStateIdentities = new Set(
        settledPaths.map((path) => quintModelStateIdentity(path.at(-1)?.postState ?? state))
      )
      expect(settledPathIdentities.size).toBe(1)
      expect(settledStateIdentities.size).toBe(1)
      const reversedResponses = oracle.enumerateSuccessorsForActionReversed(state, "receiveCommandResponse")
      const reversedSettledPathIdentities = new Set(
        reversedResponses
          .filter(
            (transition) =>
              quintValueIdentity(projectModelEnvironment(transition.postState)) ===
              quintValueIdentity(observedProjection)
          )
          .flatMap((response) =>
            oracle
              .enumerateSuccessorsForActionReversed(response.postState, "settleCommandResponse")
              .filter(
                (settlement) =>
                  quintValueIdentity(projectModelEnvironment(settlement.postState)) ===
                  quintValueIdentity(safeSettlementProjection)
              )
              .map((settlement) => modelPathSemanticIdentity([...prefix, response, settlement]))
          )
      )
      expect(reversedSettledPathIdentities).toEqual(settledPathIdentities)
      const firstResponse = responses[0] ?? prefix[0]
      if (firstResponse === undefined) throw new Error("canonical mbtStep response path is empty")
      expect(modelTransitionSemanticIdentity(firstResponse)).toContain("branchIr")
    }),
  { timeout: 45_000 }
)

it.effect(
  "checks the production-observed Resume-redelivery chronology with the Quint frontier",
  () =>
    Effect.gen(function* () {
      const trace = yield* runDirectedResumeRedeliveryObserved()
      const captureCost = reverseCaptureMeasurement()
      expect(captureCost.wallMs).toBeGreaterThan(0)
      expect(captureCost.cpuMs).toBeGreaterThanOrEqual(0)
      const result = yield* Effect.promise(() => checkReverseTrace(trace))
      expect(result.accepted).toBe(true)
      expect(result.completePaths).toBeGreaterThan(0)
      expect(result.frontierSizes.length).toBe(trace.events.length)
      expect(result.paths).toHaveLength(result.completePaths)
      expect(result.perEvent).toHaveLength(trace.events.length)
      expect(result.perEvent.every(({ distinctFullStates, paths }) => paths >= distinctFullStates)).toBe(true)
      const safeResponseIndex = trace.events.findIndex(
        (event, index) =>
          event.implementationAction === "receiveCommandResponse" &&
          trace.events[index + 1]?.implementationAction === "settleCommandResponse" &&
          trace.events[index + 1]?.postProjection.status === "StatusSafelySuspended"
      )
      if (safeResponseIndex < 0) throw new Error("production chronology omitted its observed Safe response")
      const safeSettlementIndex = trace.events.findIndex(
        (event, index) =>
          index > safeResponseIndex &&
          event.implementationAction === "settleCommandResponse" &&
          event.postProjection.status === "StatusSafelySuspended"
      )
      if (safeSettlementIndex < 0) throw new Error("production chronology omitted its Safe settlement")
      expect(result.perEvent[safeResponseIndex]?.distinctFullStates).toBe(1)
      expect(result.perEvent[safeSettlementIndex]?.distinctFullStates).toBe(1)
      expect(result.perEvent[safeSettlementIndex]?.paths).toBe(1)
      const reversed = yield* Effect.promise(() => checkReverseTraceWithReversedEnumeration(trace))
      expect(reversed.frontierSizes).toEqual(result.frontierSizes)
      expect(reversed.perEvent[safeResponseIndex]?.distinctFullStates).toBe(1)
      expect(reversed.perEvent[safeSettlementIndex]?.distinctFullStates).toBe(1)
    }),
  { timeout: 45_000 }
)

it.effect(
  "accepts a foreign CorrelationContradiction and rejects subject-correlation mutation",
  () =>
    Effect.gen(function* () {
      const trace = yield* runDirectedResumeRedeliveryObserved()
      const oracle = yield* Effect.promise(loadResumeRedeliveryOracle)
      const target = trace.events
        .flatMap((event, eventIndex) =>
          event.executor.map((observation, observationIndex) => ({ event, eventIndex, observation, observationIndex }))
        )
        .find(({ observation }) => observation.operation === "observe" && observation.phase === "return")
      if (target === undefined || target.observation.result === undefined)
        return yield* Effect.die("production chronology omitted an observe return for contradiction control")
      const foreignCorrelation: PlannedAttemptExecutorCorrelation = {
        runId: trace.events[0]?.correlation.runId ?? correlation.runId,
        attemptId: AttemptId.make("foreign-observation")
      }
      const foreignReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: foreignCorrelation
      })
      const contradiction = PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
        expected: trace.events[0]?.correlation ?? correlation,
        observed: foreignReport
      })
      const withForeignObservation: ReverseTrace = {
        ...trace,
        events: trace.events.map((event, eventIndex) =>
          eventIndex !== target.eventIndex
            ? event
            : {
                ...event,
                executor: event.executor.map((observation, observationIndex) =>
                  eventIndex === target.eventIndex && observationIndex === target.observationIndex
                    ? { ...observation, result: contradiction, report: "CorrelationContradiction" as const }
                    : observation
                )
              }
        )
      }
      expect(
        yield* Effect.promise(() => checkReverseTraceWithOracle(withForeignObservation, oracle).then(() => true))
      ).toBe(true)
      const subjectMutation: ReverseTrace = {
        ...withForeignObservation,
        events: withForeignObservation.events.map((event, eventIndex) =>
          eventIndex !== target.eventIndex
            ? event
            : {
                ...event,
                executor: event.executor.map((observation, observationIndex) =>
                  eventIndex === target.eventIndex && observationIndex === target.observationIndex
                    ? {
                        ...observation,
                        result: {
                          ...contradiction,
                          observed: { ...foreignReport, correlation: trace.events[0]?.correlation ?? correlation }
                        },
                        report: "CorrelationContradiction" as const
                      }
                    : observation
                )
              }
        )
      }
      expect(yield* reverseCheckRejectsObserved(subjectMutation)).toBe(true)
    }),
  { timeout: 45_000 }
)

it.effect(
  "keeps the evaluator frontier sensitive to chronology, identity, durability, and terminal completeness",
  () =>
    Effect.gen(function* () {
      const trace = yield* runDirectedResumeRedeliveryObserved()
      const oracle = yield* Effect.promise(loadResumeRedeliveryOracle)
      const rejectsWithLoadedOracle = (candidate: ReverseTrace) =>
        Effect.promise(() =>
          checkReverseTraceWithOracle(candidate, oracle, true).then(
            () => false,
            () => true
          )
        )
      const renumber = (events: ReadonlyArray<ReverseTraceEvent>) => events.map((event, index) => ({ ...event, index }))
      const eventAt = (index: number): ReverseTraceEvent => {
        const event = trace.events[index]
        if (event === undefined) throw new Error(`reverse control trace is missing event ${index}`)
        return event
      }
      const secondProjection = eventAt(18)
      const secondSettlement = eventAt(19)
      const firstProjection = eventAt(12)
      const firstCrash = eventAt(11)
      const secondCrash = eventAt(17)
      const firstJournal = firstProjection.journal[0]
      if (firstJournal === undefined) throw new Error("reverse control trace is missing journal evidence")
      const candidates: Array<ReverseTrace> = [
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 24
              ? {
                  ...event,
                  postProjection: {
                    ...event.postProjection,
                    resumeRecovery: { ...event.postProjection.resumeRecovery, redeliveryCallCount: 99n }
                  }
                }
              : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 3 ? { ...event, implementationAction: "callSuspend", durableBoundary: "call" } : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 22 ? { ...event, refinement: "direct-model-step" } : event
          )
        },
        {
          ...trace,
          events: trace.events.filter((_event, index) => index !== 18).map((event, index) => ({ ...event, index }))
        },
        {
          ...trace,
          events: renumber([
            ...trace.events.slice(0, 18),
            secondSettlement,
            secondProjection,
            ...trace.events.slice(20)
          ])
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 18 ? { ...event, postProjection: firstProjection.postProjection } : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 16 ? { ...event, commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(2) } : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 21
              ? { ...event, redeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal.make(1) }
              : event
          )
        },
        {
          ...trace,
          events: trace.events.slice(0, 12),
          terminal: {
            ...trace.terminal,
            finalAction: firstCrash.implementationAction,
            finalStatus: firstCrash.postProjection.status
          }
        },
        {
          ...trace,
          events: trace.events.slice(0, 18),
          terminal: {
            ...trace.terminal,
            finalAction: secondCrash.implementationAction,
            finalStatus: secondCrash.postProjection.status
          }
        },
        { ...trace, schedule: { ...trace.schedule, faults: ["initial-resume-crash"] } },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 0
              ? { ...event, correlation: { ...event.correlation, attemptId: AttemptId.make("foreign") } }
              : event
          )
        },
        { ...trace, events: trace.events.map((event, index) => (index === 12 ? { ...event, journal: [] } : event)) },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 12 ? { ...event, journal: [...event.journal, firstJournal] } : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 14 ? { ...event, journal: [...event.journal].reverse() } : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 12
              ? {
                  ...event,
                  journal: event.journal.map((record, recordIndex) =>
                    recordIndex === 0
                      ? {
                          ...record,
                          key: JournalRecordKey.make("attempt:1:executor-command:3:projection:99:observation")
                        }
                      : record
                  )
                }
              : event
          )
        },
        {
          ...trace,
          events: trace.events.map((event, index) =>
            index === 12
              ? {
                  ...event,
                  journal: event.journal.map((record, recordIndex) =>
                    recordIndex === 0 ? { ...record, event: modelRunBegan.event._tag } : record
                  )
                }
              : event
          )
        },
        { ...trace, events: trace.events.map((event, index) => (index === 22 ? { ...event, executor: [] } : event)) }
      ]
      for (const candidate of candidates) expect(yield* rejectsWithLoadedOracle(candidate)).toBe(true)
    }),
  { timeout: 45_000 }
)

it.effect(
  "enumerates ordinary Quint evaluator samples without collapsing full states",
  () =>
    Effect.promise(async () => {
      const oracle = await loadResumeRedeliveryOracle()
      const ordinary = oracle.ordinarySuccessor(oracle.initialState, 158n)
      if (ordinary === undefined) throw new Error("ordinary evaluator sample did not produce a successor")
      const exhaustive = oracle.enumerateSuccessorsForAction(
        oracle.initialState,
        ordinary.actionName ?? "beginResponsibility"
      )
      expect(
        exhaustive.some(
          (candidate) => quintModelStateIdentity(candidate.postState) === quintModelStateIdentity(ordinary.postState)
        )
      ).toBe(true)
    }),
  { timeout: 30_000 }
)

it.effect(
  "proves a focused Quint guard mutation flips only the reverse-lane sample",
  () =>
    Effect.gen(function* () {
      const canonicalTrace = yield* runDirectedResumeRedeliveryObserved()
      const mutantTrace = yield* runDirectedResumeRedeliveryObserved(scopedExecutorConformanceDriver, {
        secondRedelivery: false
      })
      const modelBytes = readFileSync("specs/plannedAttemptExecutor.qnt")
      const focusedGuard =
        "activeCommand(state.commandState).kind == BeginCommand or state.resumeRecovery.redeliveryIntents.length() == 2,"
      const mutatedGuard =
        "activeCommand(state.commandState).kind == BeginCommand or state.resumeRecovery.redeliveryIntents.length() >= 1,"
      const modelSource = modelBytes.toString()
      if (modelSource.split(focusedGuard).length !== 2) return yield* Effect.die("focused Quint guard is not unique")
      const mutantOracle = yield* Effect.promise(() =>
        loadOracleFromBytes(Buffer.from(modelSource.replace(focusedGuard, mutatedGuard), "utf8"))
      )
      const provenanceMutation = {
        ...canonicalTrace,
        model: { ...canonicalTrace.model, sourceSha256: mutantOracle.sourceSha256 }
      }
      expect(yield* reverseCheckRejectsObserved(provenanceMutation)).toBe(true)
      const acceptedMutantTrace = {
        ...mutantTrace,
        model: { ...mutantTrace.model, sourceSha256: mutantOracle.sourceSha256 }
      }
      const frozenDigest = reverseObservedTraceDigest(acceptedMutantTrace)
      const canonicalOracle = yield* Effect.promise(loadResumeRedeliveryOracle)
      const canonicalRejectedOneRedelivery = {
        ...mutantTrace,
        model: { ...mutantTrace.model, sourceSha256: canonicalOracle.sourceSha256 }
      }
      expect(
        yield* Effect.promise(() =>
          checkReverseTraceWithOracle(canonicalRejectedOneRedelivery, canonicalOracle).then(
            () => false,
            () => true
          )
        )
      ).toBe(true)
      const mutantResult = yield* Effect.promise(() => checkReverseTraceWithOracle(acceptedMutantTrace, mutantOracle))
      expect(mutantResult.accepted).toBe(true)
      expect(reverseObservedTraceDigest(acceptedMutantTrace)).toBe(frozenDigest)
    }),
  { timeout: 45_000 }
)

it.effect(
  "times public Quint generation separately from service-backed replay",
  () =>
    Effect.gen(function* () {
      const directedTrace = yield* runDirectedResumeRedeliveryObserved()
      const directedCapture = yield* reverseDriverCaptureOf()()
      expect(directedTrace.events.length).toBeGreaterThan(0)
      const options = {
        backend: "typescript" as const,
        spec: "specs/plannedAttemptExecutor.qnt",
        step: "resumeRedeliveryMbtStep",
        maxSamples: 1,
        maxSteps: 40,
        nTraces: 1,
        seed: "158"
      }
      const generationStartedWall = performance.now()
      const generationStartedCpu = process.cpuUsage()
      const traces = yield* generateTraces(options)
      const generationUsage = process.cpuUsage(generationStartedCpu)
      expect(traces).toHaveLength(1)
      const replayOnce = () =>
        quintRunWithTraceGeneration({
          ...options,
          driverFactory: scopedExecutorConformanceDriver,
          stateCheck: executorStateCheck
        }).pipe(
          Effect.provide(Layer.succeed(TraceGeneration, TraceGeneration.of({ generate: () => Effect.succeed(traces) })))
        )
      const replayStartedWall = performance.now()
      const replayStartedCpu = process.cpuUsage()
      const replay = yield* replayOnce()
      const replayUsage = process.cpuUsage(replayStartedCpu)
      const generatedCapture = yield* reverseDriverCaptureOf()()
      expect(replay.tracesReplayed).toBe(1)
      expect(generatedCapture.journal.length).toBeGreaterThan(0)
      expect(generatedCapture.executor.length).toBeGreaterThan(0)
      expect(generatedCapture.projections.length).toBeGreaterThan(0)
      expect(generatedCapture.journal).toEqual(directedCapture.journal)
      expect(generatedCapture.executor).toEqual(directedCapture.executor)
      expect(generatedCapture.projections).not.toEqual(directedCapture.projections)
      expect(generatedCapture.projections.length).not.toBe(directedCapture.projections.length)
      expect(performance.now() - generationStartedWall).toBeGreaterThan(0)
      expect((generationUsage.user + generationUsage.system) / 1000).toBeGreaterThanOrEqual(0)
      expect(performance.now() - replayStartedWall).toBeGreaterThan(0)
      expect((replayUsage.user + replayUsage.system) / 1000).toBeGreaterThanOrEqual(0)
    }),
  { timeout: 45_000 }
)

it.effect(
  "fails closed for cancelled, timed-out, and truncated reverse collections",
  () =>
    Effect.gen(function* () {
      const incomplete: ReadonlyArray<ReverseCollection> = [
        yield* collectDirectedReverseCollection("cancelled"),
        yield* collectDirectedReverseCollection("timed-out"),
        yield* collectDirectedReverseCollection("truncated")
      ]
      expect(incomplete[0]?._tag).toBe("Cancelled")
      expect(incomplete[1]?._tag).toBe("TimedOut")
      expect(incomplete[2]?._tag).toBe("Truncated")
      if (incomplete[1]?._tag === "TimedOut") {
        expect(incomplete[1].timeoutCause).toBe("ClockDeadlineExceeded")
        expect(incomplete[1].deadlineMs).toBe(reverseCollectionDeadlineMs)
        expect(incomplete[1].elapsedMs).toBeGreaterThanOrEqual(reverseCollectionDeadlineMs)
      }
      for (const collection of incomplete)
        expect(
          yield* Effect.promise(() =>
            checkReverseCollection(collection).then(
              () => false,
              () => true
            )
          )
        ).toBe(true)
      const completed = yield* collectDirectedReverseCollection("completed")
      expect(yield* Effect.promise(() => checkReverseCollection(completed))).toMatchObject({ accepted: true })
    }),
  { timeout: 45_000 }
)

it.effect(
  "retains model-generated coverage for an omitted implementation retry schedule",
  () =>
    Effect.gen(function* () {
      const mutantObserved = yield* Ref.make(false)
      const mutantDriver = makeOmittedRetryDriver(mutantObserved)
      const reverseTrace = yield* runDirectedResumeRedeliveryObserved(mutantDriver)
      const reverseResult = yield* Effect.promise(() => checkReverseTrace(reverseTrace))
      expect(reverseResult.accepted).toBe(true)
      expect(yield* Ref.get(mutantObserved)).toBe(false)
      const modelReplay = yield* Effect.exit(
        quintRun({
          backend: "typescript",
          driverFactory: mutantDriver,
          maxSamples: 1,
          maxSteps: 34,
          nTraces: 1,
          seed: "2",
          spec: "specs/plannedAttemptExecutor.qnt",
          stateCheck: executorStateCheck,
          step: "mbtStep"
        })
      )
      expect(modelReplay._tag).toBe("Failure")
      expect(yield* Ref.get(mutantObserved)).toBe(true)
    }),
  { timeout: 45_000 }
)

quintIt(
  it.effect,
  "replays durable executor commands through production protocol and admission seams",
  {
    backend: "typescript",
    driverFactory: scopedExecutorConformanceDriver,
    maxSamples: 100,
    maxSteps: 34,
    nTraces: 100,
    seed: "158",
    spec: "specs/plannedAttemptExecutor.qnt",
    step: "mbtStep",
    stateCheck: executorStateCheck
  },
  180_000
)

it.effect(
  "replays two same-command Resume redeliveries after distinct crashes through production authority",
  () =>
    Effect.gen(function* () {
      const reached = yield* Ref.make({ intents: 0n, calls: 0n })
      yield* quintRun({
        backend: "typescript",
        spec: "specs/plannedAttemptExecutor.qnt",
        step: "resumeRedeliveryMbtStep",
        maxSamples: 1,
        maxSteps: 40,
        nTraces: 1,
        seed: "158",
        stateCheck: executorStateCheck,
        driverFactory: {
          create: () =>
            scopedExecutorConformanceDriver
              .create()
              .pipe(
                Effect.map((driver) => ({
                  ...driver,
                  getState: () =>
                    driver.getState === undefined
                      ? Effect.die("executor MBT state observer is missing")
                      : driver
                          .getState()
                          .pipe(
                            Effect.tap((state) =>
                              Ref.set(reached, {
                                intents: state.resumeRecovery.totalRedeliveryIntents,
                                calls: state.resumeRecovery.redeliveryCallCount
                              })
                            )
                          )
                }))
              )
        }
      })
      expect(yield* Ref.get(reached)).toEqual({ intents: 2n, calls: 2n })
    }),
  { timeout: 180_000 }
)
