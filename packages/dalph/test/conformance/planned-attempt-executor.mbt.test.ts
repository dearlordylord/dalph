/* eslint-disable max-lines -- The complete executor protocol action map stays visible in one adapter. */
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
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  beginPlannedAttemptExecutorResponsibility,
  continuePlannedAttemptExecutorWork,
  type JournalRecord,
  JournalStore,
  journalStoreCapabilities,
  unpublishedInRunJournalTestLayer,
  JournalPosition,
  makePlannedAttemptProtocolController,
  makeApplicationExitLifecycle,
  observePlannedAttemptExecutorState,
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolControllerService,
  requestPlannedAttemptExecutorSuspension,
  TaskWorkCapacity
} from "../../../orchestrator/src/index.js"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryRuntimeAdmissionController
} from "../../../orchestrator/src/coordination/delivery/delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  trackerGraphReadProposalOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import { makeIntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"

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
const continuationProposal = {
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(1),
    purpose: "EstablishCurrentGraph",
    runId: plannedAttempt.runId,
    target: FixtureTarget.make("planned-attempt-executor-model")
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
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
    commandCallCount: ITFBigInt,
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
    startOrContinueIntentsSinceSafeSuspension: ITFBigInt,
    status: Variant,
    suspendIntentsSinceRunning: ITFBigInt
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)
const pickedTag = (value: unknown): string => variantTag(value)
const reportFrom = (value: unknown): PlannedAttemptExecutorReport => {
  switch (pickedTag(value)) {
    case "ReportSafelySuspended":
      return PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    case "ReportTerminal":
      return PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    default:
      return PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  }
}

const executorConformanceDriver = defineDriver(
  {
    acceptFreshStateProjectionProof: {},
    beginResponsibility: {},
    callStartOrContinue: {},
    callSuspend: {},
    init: {},
    loseCommandResponse: {},
    receiveCommandResponse: { report: Schema.Unknown },
    recordCommandProjection: { commandProjection: Schema.Unknown },
    recordFreshStateProjection: { stateObservation: Schema.Unknown },
    recordStartOrContinueIntent: {},
    recordSuspendIntent: {},
    recoverActivation: {},
    settleCommandProjection: {},
    settleCommandResponse: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = []
    let controller: DeliveryRuntimeAdmissionController | undefined
    let protocolController: PlannedAttemptProtocolControllerService | undefined
    let authorityReport: PlannedAttemptExecutorReport | undefined
    let currentProjection: PlannedAttemptExecutorProjection | undefined
    let commandKind: "StartOrContinue" | "Suspend" = "StartOrContinue"
    let commandIntentGate = Deferred.makeUnsafe<void>()
    let commandIntentSignal = Deferred.makeUnsafe<void>()
    let commandCallSignal = Deferred.makeUnsafe<void>()
    let commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
    let reportGate = Deferred.makeUnsafe<void>()
    let reportSignal = Deferred.makeUnsafe<void>()
    let projectionGate = Deferred.makeUnsafe<void>()
    let projectionSignal = Deferred.makeUnsafe<void>()
    let stateGate = Deferred.makeUnsafe<void>()
    let stateSignal = Deferred.makeUnsafe<void>()
    let pauseCommandIntent = false
    let pauseReport = false
    let pauseProjection = false
    let pauseState = false
    let pendingCommand: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let pendingProjection: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let pendingState: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let commandCalls = 0
    // Recovery count is an activation-local driver fact; command and evidence
    // state below still comes exclusively from the production journal.
    let recoveryCount = 0
    let projectionBaseline = 0

    const journal = JournalStore.of({
      append: (eventRunId, key, event) =>
        Effect.gen(function* () {
          const existing = records.find((record) => record.runId === eventRunId && record.key === key)
          if (existing !== undefined) return existing
          const record = {
            event,
            key,
            position: JournalPosition.make(records.filter(({ runId }) => runId === eventRunId).length + 1),
            runId: eventRunId
          } satisfies JournalRecord
          records = [...records, record]
          if (pauseCommandIntent && event._tag === "PlannedAttemptExecutorCommandIntended") {
            pauseCommandIntent = false
            yield* Deferred.succeed(commandIntentSignal, undefined)
            yield* Deferred.await(commandIntentGate)
          }
          if (pauseReport && event._tag === "PlannedAttemptExecutorWorkReported") {
            pauseReport = false
            yield* Deferred.succeed(reportSignal, undefined)
            yield* Deferred.await(reportGate)
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
          return record
        }),
      beginRun: () => Effect.die("executor model does not own Run lifecycle"),
      read: (requestedRunId) => Effect.succeed(records.filter(({ runId }) => runId === requestedRunId)),
      readRunForRecovery: () => Effect.die("executor model reconstructs its exact journal locally"),
      scanHot: () => Effect.die("executor model never scans all Runs"),
      auditAll: () => Effect.die("executor model never audits all Runs"),
      retireTerminalRun: (eventRunId) =>
        Effect.succeed({ _tag: "AlreadyRetired", partition: "Cold", runId: eventRunId } as const),
      terminateRun: () => Effect.die("executor model never terminates its Run")
    })
    const journalLayer = unpublishedInRunJournalTestLayer.pipe(
      Layer.provideMerge(journalStoreCapabilities(Layer.succeed(JournalStore, journal)))
    )
    const executor = PlannedAttemptExecutor.of({
      project: () =>
        Effect.succeed(
          currentProjection ??
            (authorityReport === undefined
              ? PlannedAttemptExecutorProjection.cases.NoReport.make({
                  correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
                })
              : PlannedAttemptExecutorProjection.cases.Exact.make({ report: authorityReport }))
        ),
      requestSuspension: () =>
        Effect.gen(function* () {
          commandCalls += 1
          yield* Deferred.succeed(commandCallSignal, undefined)
          return yield* Deferred.await(commandResponse)
        }),
      startOrContinue: (request) =>
        Effect.gen(function* () {
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
          return yield* Deferred.await(commandResponse)
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
        : provideWorkflow(continuePlannedAttemptExecutorWork(plannedAttempt, undefined, specification))
    const requireController = () =>
      controller === undefined ? Effect.die("admission controller not initialized") : Effect.succeed(controller)
    const reservePosition = Effect.fn("ExecutorModel.reservePosition")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot
      if (!snapshot.positions.has(plannedAttempt.taskId)) {
        const decision = yield* admission.tryReserve(continuationProposal)
        if (decision._tag === "Deferred") return yield* Effect.die("planned attempt must be admitted")
        yield* admission.bindPlannedAttemptPosition(plannedAttempt.taskId, correlation)
      }
    })
    const releasePosition = Effect.fn("ExecutorModel.releasePosition")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot
      if (snapshot.positions.has(plannedAttempt.taskId)) yield* admission.releasePlannedAttemptPosition(correlation)
    })
    const resetCommand = (kind: typeof commandKind) => {
      commandKind = kind
      commandIntentGate = Deferred.makeUnsafe<void>()
      commandIntentSignal = Deferred.makeUnsafe<void>()
      commandCallSignal = Deferred.makeUnsafe<void>()
      commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
      reportGate = Deferred.makeUnsafe<void>()
      reportSignal = Deferred.makeUnsafe<void>()
      pauseCommandIntent = true
      pauseReport = false
    }
    const recordIntent = (kind: typeof commandKind) =>
      Effect.gen(function* () {
        resetCommand(kind)
        pendingCommand = yield* workflow().pipe(Effect.forkDetach({ startImmediately: true }))
        yield* Deferred.await(commandIntentSignal)
      })
    const call = () =>
      Deferred.succeed(commandIntentGate, undefined).pipe(
        Effect.andThen(Deferred.await(commandCallSignal)),
        Effect.asVoid
      )
    const settleAccepted = (fiber: Fiber.Fiber<PlannedAttemptExecutorReport, unknown>) =>
      Effect.gen(function* () {
        const report = yield* Fiber.join(fiber)
        if (report._tag === "SafelySuspended" || report._tag === "Terminal") yield* releasePosition()
        else yield* reservePosition()
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
      const settled = records.some(
        ({ event, position }, index) =>
          position > intended.position &&
          !(
            index === records.length - 1 &&
            ((event._tag === "PlannedAttemptExecutorWorkReported" && pendingCommand !== undefined) ||
              (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" && pendingProjection !== undefined))
          ) &&
          (event._tag === "PlannedAttemptExecutorWorkReported" ||
            (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.commandOrdinal === intendedOrdinal &&
              event.observation._tag === "ExactExecutorReport"))
      )
      return settled ? undefined : intended.event
    }
    const evidenceTag = () => {
      if (pauseReport === false && pendingCommand !== undefined) {
        const latest = records.at(-1)?.event
        if (latest?._tag === "PlannedAttemptExecutorWorkReported") return "CommandResponse"
      }
      const latest = records.at(-1)?.event
      if (pendingProjection !== undefined && latest?._tag === "PlannedAttemptExecutorCommandProjectionObserved")
        return "CommandProjectionEvidence"
      if (pendingState !== undefined && latest?._tag === "PlannedAttemptExecutorStateObserved")
        return "FreshStateProjection"
      return "NoEvidence"
    }
    const exactReport = (event: JournalRecord["event"] | undefined) => {
      if (event?._tag === "PlannedAttemptExecutorWorkReported") return event.report
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
        readonly command: "StartOrContinue" | "Suspend"
        readonly recordIndex: number
        readonly report: PlannedAttemptExecutorReport
        readonly source: "Projection" | "Response"
      }> = []
      records.forEach(({ event }, index) => {
        if (event._tag === "PlannedAttemptExecutorCommandIntended") {
          activeIntent = event
          return
        }
        const report = exactReport(event)
        const isPendingEvidence =
          index === records.length - 1 &&
          ((event._tag === "PlannedAttemptExecutorWorkReported" && pendingCommand !== undefined) ||
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
          command: activeIntent.command,
          recordIndex: index,
          report,
          source: event._tag === "PlannedAttemptExecutorWorkReported" ? "Response" : "Projection"
        })
        activeIntent = undefined
      })
      return settlements
    }

    return {
      init: () =>
        Effect.gen(function* () {
          if (pendingCommand !== undefined) yield* Fiber.interrupt(pendingCommand)
          if (pendingProjection !== undefined) yield* Fiber.interrupt(pendingProjection)
          if (pendingState !== undefined) yield* Fiber.interrupt(pendingState)
          records = []
          authorityReport = undefined
          currentProjection = undefined
          commandCalls = 0
          recoveryCount = 0
          projectionBaseline = 0
          pendingCommand = undefined
          pendingProjection = undefined
          pendingState = undefined
          const freshProtocolController = yield* makePlannedAttemptProtocolController()
          protocolController = freshProtocolController
          controller = yield* makeDeliveryRuntimeAdmissionController(
            { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
            yield* makeIntegrationTargetResourceController(),
            (yield* makeApplicationExitLifecycle()).admission
          ).pipe(Effect.provideService(PlannedAttemptProtocolController, freshProtocolController))
        }),
      beginResponsibility: () =>
        reservePosition().pipe(
          Effect.andThen(provideWorkflow(beginPlannedAttemptExecutorResponsibility(plannedAttempt))),
          Effect.orDie,
          Effect.asVoid
        ),
      recordStartOrContinueIntent: () =>
        reservePosition().pipe(Effect.andThen(recordIntent("StartOrContinue")), Effect.orDie),
      recordSuspendIntent: () => recordIntent("Suspend").pipe(Effect.orDie),
      callStartOrContinue: () => call().pipe(Effect.orDie),
      callSuspend: () => call().pipe(Effect.orDie),
      receiveCommandResponse: ({ report }) =>
        Effect.gen(function* () {
          pauseReport = true
          const response = reportFrom(report)
          authorityReport = response
          yield* Deferred.succeed(commandResponse, response)
          yield* Deferred.await(reportSignal)
        }).pipe(Effect.orDie),
      settleCommandResponse: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(reportGate, undefined)
          if (pendingCommand === undefined) return yield* Effect.die("command response must be pending")
          yield* settleAccepted(pendingCommand)
          pendingCommand = undefined
        }).pipe(Effect.orDie),
      loseCommandResponse: () =>
        Effect.gen(function* () {
          if (pendingCommand === undefined) return yield* Effect.die("command must be pending")
          yield* Fiber.interrupt(pendingCommand)
          pendingCommand = undefined
        }),
      recordCommandProjection: ({ commandProjection }) =>
        Effect.gen(function* () {
          projectionGate = Deferred.makeUnsafe<void>()
          projectionSignal = Deferred.makeUnsafe<void>()
          pauseProjection = true
          const tag = pickedTag(commandProjection)
          const foreignReport = PlannedAttemptExecutorReport.cases.Running.make({
            correlation: { attemptId: AttemptId.make("other"), runId: plannedAttempt.runId }
          })
          currentProjection =
            tag === "CommandProjectionNoCurrentReport"
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
                          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
                        })
                      : tag === "CommandProjectionExactTerminal"
                        ? PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.Terminal.make({
                              correlation,
                              result: { _tag: "Completed" }
                            })
                          })
                        : PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
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
          stateGate = Deferred.makeUnsafe<void>()
          stateSignal = Deferred.makeUnsafe<void>()
          pauseState = true
          const tag = pickedTag(stateObservation)
          const foreignReport = PlannedAttemptExecutorReport.cases.Running.make({
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
                          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
                        })
                      : tag === "ExecutorStateTerminal"
                        ? PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.Terminal.make({
                              correlation,
                              result: { _tag: "Completed" }
                            })
                          })
                        : PlannedAttemptExecutorProjection.cases.Exact.make({
                            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
                          })
          authorityReport =
            currentProjection._tag === "Exact"
              ? currentProjection.report
              : currentProjection._tag === "CorrelationContradiction"
                ? currentProjection.observed
                : undefined
          pendingState = yield* provideWorkflow(observePlannedAttemptExecutorState(plannedAttempt)).pipe(
            Effect.forkDetach({ startImmediately: true })
          )
          yield* Deferred.await(stateSignal)
        }).pipe(Effect.orDie),
      acceptFreshStateProjectionProof: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(stateGate, undefined)
          if (pendingState === undefined) return yield* Effect.die("state projection must be pending")
          yield* Fiber.join(pendingState)
          pendingState = undefined
          yield* releasePosition()
        }).pipe(Effect.orDie),
      recoverActivation: () =>
        Effect.gen(function* () {
          if (pendingProjection !== undefined) {
            yield* Deferred.succeed(projectionGate, undefined)
            yield* Fiber.await(pendingProjection)
            pendingProjection = undefined
          }
          if (pendingState !== undefined) {
            yield* Deferred.succeed(stateGate, undefined)
            yield* Fiber.await(pendingState)
            pendingState = undefined
          }
          projectionBaseline = projectionEventCount()
          recoveryCount = Math.min(recoveryCount + 1, 3)
        }),
      getState: () =>
        Effect.gen(function* () {
          const admission = yield* requireController()
          const snapshot = yield* admission.snapshot
          const intents = records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
          const reports = records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
          const settlements = settledCommands()
          const latestSafeSettlement = settlements.findLast(({ report }) => report._tag === "SafelySuspended")
          const latestAcceptedSafeStateIndex = records.findLastIndex(
            ({ event }, index) =>
              !(index === records.length - 1 && pendingState !== undefined) &&
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "SafelySuspended"
          )
          const latestSafeIndex = Math.max(latestSafeSettlement?.recordIndex ?? -1, latestAcceptedSafeStateIndex)
          const sinceSafe = records.slice(latestSafeIndex + 1)
          const latestStartRunningSettlement = settlements.findLast(
            ({ command, report }) => command === "StartOrContinue" && report._tag === "Running"
          )
          const sinceRunning = records.slice((latestStartRunningSettlement?.recordIndex ?? -1) + 1)
          const unmatched = unmatchedCommand()
          const evidence = evidenceTag()
          const stateProjectionCount = projectionEventCount() - projectionBaseline
          const latestSettlement = settlements.at(-1)
          const latestAcceptedStateIndex = records.findLastIndex(
            ({ event }, index) =>
              !(index === records.length - 1 && pendingState !== undefined) &&
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              (event.observation.report._tag === "SafelySuspended" || event.observation.report._tag === "Terminal")
          )
          const latestAcceptedState = records.at(latestAcceptedStateIndex)?.event
          const responsibilityBegan = records.some(
            ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          )
          const responseAmbiguous =
            unmatched !== undefined && commandCalls === intents.length && pendingCommand === undefined
          return {
            commandCallCount: BigInt(commandCalls),
            commandIntentCount: BigInt(intents.length),
            commandResponseEvidenceCount: BigInt(reports.length),
            commandResponseSettlementCount: BigInt(settlements.filter(({ source }) => source === "Response").length),
            commandSettlementCount: BigInt(settlements.length),
            commandState:
              unmatched === undefined
                ? "NoCommand"
                : commandCalls < intents.length
                  ? "CommandIntended"
                  : "CommandCalled",
            evidence,
            nextCommandOrdinal: BigInt(intents.length + 1),
            positionHeld: snapshot.positions.has(plannedAttempt.taskId),
            reconciliationProjectionsThisActivation: BigInt(stateProjectionCount),
            recoveryCount: BigInt(recoveryCount),
            responseAmbiguous,
            startOrContinueIntentsSinceSafeSuspension: BigInt(
              sinceSafe.filter(
                ({ event }) =>
                  event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "StartOrContinue"
              ).length
            ),
            status:
              latestAcceptedStateIndex > (latestSettlement?.recordIndex ?? -1) &&
              latestAcceptedState?._tag === "PlannedAttemptExecutorStateObserved" &&
              latestAcceptedState.observation._tag === "ExactExecutorReport"
                ? latestAcceptedState.observation.report._tag
                : (latestSettlement?.report._tag ??
                  (responsibilityBegan ? "ResponsibilityBegan" : "ResponsibilityNotBegun")),
            suspendIntentsSinceRunning: BigInt(
              sinceRunning.filter(
                ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
              ).length
            )
          }
        })
    }
  }
)

quintIt(
  it.effect,
  "replays durable executor commands through production protocol and admission seams",
  {
    backend: "typescript",
    driverFactory: executorConformanceDriver,
    maxSamples: 100,
    maxSteps: 34,
    nTraces: 100,
    seed: "158",
    spec: "specs/plannedAttemptExecutor.qnt",
    step: "mbtStep",
    stateCheck: stateCheck(
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
  },
  180_000
)
