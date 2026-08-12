import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  PlannedAttemptExecutorReport,
  RunId,
  type PlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainTick,
  ApplicationExitExecutorAttemptEvidence,
  ApplicationExitLiveForwardOwnerCount,
  ApplicationExitProducedWriteEvidence,
  ForwardOwnerAdmission,
  advanceApplicationExitTick,
  closeApplicationExitAdmission,
  decideApplicationExitDrain,
  decideApplicationProcessEnd,
  decideExecutorPosition,
  decideForwardOwnerRegistration,
  decideInterruptibleOwnerRelease,
  freshApplicationExitState,
  joinApplicationExitDrain,
  type ApplicationExitDrainSnapshot,
  type ForwardOwnerKind,
  type ForwardOwnerAdmission as ForwardOwnerAdmissionType
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    phase: Schema.Unknown,
    tick: ITFBigInt,
    cutoffCount: ITFBigInt,
    requestCount: ITFBigInt,
    result: Schema.Unknown,
    requestedStatus: Schema.Unknown,
    ownerA: Schema.Unknown,
    ownerB: Schema.Unknown,
    attemptA: Schema.Unknown,
    attemptB: Schema.Unknown,
    attemptAPositionHeld: Schema.Boolean,
    attemptBPositionHeld: Schema.Boolean,
    write: Schema.Unknown,
    reservationHeld: Schema.Boolean,
    fiberOpen: Schema.Boolean,
    coordinatorLockHeld: Schema.Boolean,
    failureDiagnosticRetained: Schema.Boolean,
    ownerAAmbiguous: Schema.Boolean,
    ownerBAmbiguous: Schema.Boolean,
    durable: Schema.Struct({
      ownerAIntentAcknowledged: Schema.Boolean,
      ownerBIntentAcknowledged: Schema.Boolean,
      ownerAKnownObservationRecorded: Schema.Boolean,
      ownerBKnownObservationRecorded: Schema.Boolean,
      attemptASuspensionIntentAcknowledged: Schema.Boolean,
      attemptBSuspensionIntentAcknowledged: Schema.Boolean,
      pauseApplied: Schema.Boolean,
      runTerminationAuthorized: Schema.Boolean,
      runTerminated: Schema.Boolean,
      durableResourcesPreserved: Schema.Boolean,
      workflowExitRecords: ITFBigInt
    }),
    trace: Schema.Struct({
      postCutoffForwardRegistrations: ITFBigInt,
      ambiguousReleasesWithoutIntent: ITFBigInt,
      foreignExecutorReleases: ITFBigInt,
      timerResets: ITFBigInt,
      tickRegressions: ITFBigInt,
      joinedResultMismatches: ITFBigInt,
      llmRequests: ITFBigInt,
      freshReconciliationReads: ITFBigInt,
      stabilizationReads: ITFBigInt,
      durableCleanupCalls: ITFBigInt,
      attemptReplacements: ITFBigInt,
      postCutoffControlApplications: ITFBigInt,
      postCutoffTerminationStarts: ITFBigInt,
      manufacturedWorkflowOutcomes: ITFBigInt,
      gracefulTerminationRequested: Schema.Boolean,
      forcedTerminationRequested: Schema.Boolean,
      unexpectedDeathObserved: Schema.Boolean,
      restarted: Schema.Boolean,
      restartClearedLifecycle: Schema.Boolean
    })
  })
})

type LifecyclePhase =
  | "Draining"
  | "FailureReported"
  | "ProcessGoneFailure"
  | "ProcessGoneGraceful"
  | "ProcessGoneTimeout"
  | "ProcessGoneUnexpected"
  | "Serving"
  | "SuccessReported"

type ExecutorAttempt =
  | "AttemptNotStarted"
  | "AttemptRunning"
  | "AttemptSafelySuspended"
  | "AttemptTerminal"
  | "FastSuspensionCalled"
  | "SuspensionCallFailed"
  | "SuspensionIntentRecorded"

type ProducedWrite = "NoProducedWrite" | "ProducedWriteAcknowledged" | "ProducedWriteFailed" | "ProducedWritePending"

const correlationA: PlannedAttemptExecutorCorrelation = {
  attemptId: AttemptId.make("application-exit-model-attempt-A"),
  runId: RunId.make("application-exit-model-run")
}

const correlationB: PlannedAttemptExecutorCorrelation = {
  attemptId: AttemptId.make("application-exit-model-attempt-B"),
  runId: RunId.make("application-exit-model-run")
}

const failureDiagnostic = ApplicationExitDiagnostic.make("controlled application Exit drain failure")

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const variantValue = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "value" in value ? value.value : undefined

const normalizedOwner = (value: unknown): string => {
  const tag = variantTag(value)
  return tag === "NoForwardOwner" ? tag : `${tag}:${variantTag(variantValue(value))}`
}

const ownerKey = (owner: ForwardOwnerAdmissionType): string =>
  owner._tag === "NoForwardOwner" ? owner._tag : `${owner._tag}:${owner.kind}`

const ownerIsRegistered = (owner: ForwardOwnerAdmissionType, kind?: ForwardOwnerKind): boolean =>
  owner._tag === "RegisteredForwardOwner" && (kind === undefined || owner.kind === kind)

const attemptForDrain = (attempt: ExecutorAttempt): ApplicationExitDrainSnapshot["attempts"][number] => {
  switch (attempt) {
    case "AttemptNotStarted":
      return ApplicationExitExecutorAttemptEvidence.NotStarted()
    case "AttemptRunning":
      return ApplicationExitExecutorAttemptEvidence.Running()
    case "AttemptSafelySuspended":
      return ApplicationExitExecutorAttemptEvidence.SafelySuspended()
    case "AttemptTerminal":
      return ApplicationExitExecutorAttemptEvidence.Terminal()
    case "FastSuspensionCalled":
      return ApplicationExitExecutorAttemptEvidence.FastSuspensionCalled()
    case "SuspensionCallFailed":
      return ApplicationExitExecutorAttemptEvidence.SuspensionCallFailed({ diagnostic: failureDiagnostic })
    case "SuspensionIntentRecorded":
      return ApplicationExitExecutorAttemptEvidence.SuspensionIntentRecorded()
  }
}

const writeForDrain = (write: ProducedWrite): ApplicationExitDrainSnapshot["producedWrite"] => {
  switch (write) {
    case "NoProducedWrite":
      return ApplicationExitProducedWriteEvidence.None()
    case "ProducedWriteAcknowledged":
      return ApplicationExitProducedWriteEvidence.Acknowledged()
    case "ProducedWriteFailed":
      return ApplicationExitProducedWriteEvidence.Failed({ diagnostic: failureDiagnostic })
    case "ProducedWritePending":
      return ApplicationExitProducedWriteEvidence.Pending()
  }
}

const applicationExitActions = {
  acknowledgeOwnerAIntent: {},
  acknowledgeOwnerBIntent: {},
  acknowledgeProducedWrite: {},
  acceptExit: {},
  advanceTick: {},
  applyPauseBeforeCutoff: {},
  callFastSuspensionA: {},
  callFastSuspensionB: {},
  closeFiber: {},
  failFastSuspensionA: {},
  failProducedWrite: {},
  finishAtomicOwnerA: {},
  finishAuthorizedTerminationAppendA: {},
  forceAfterFailure: {},
  init: {},
  interruptOwnerAWithRecoverableAmbiguity: {},
  interruptOwnerBWithRecoverableAmbiguity: {},
  joinExit: {},
  observeOwnerAKnownResult: {},
  observeOwnerBKnownResult: {},
  openFiber: {},
  prepareAtomicOwnerA: {},
  prepareInterruptibleOwnerA: {},
  prepareInterruptibleOwnerB: {},
  prepareTerminationAppendOwnerA: {},
  produceJournalWrite: {},
  recordAttemptASuspensionIntent: {},
  recordAttemptBSuspensionIntent: {},
  registerOwnerA: {},
  registerOwnerB: {},
  releaseCoordinatorLock: {},
  releaseReservation: {},
  reportAttemptASafelySuspended: {},
  reportAttemptATerminal: {},
  reportAttemptBSafelySuspended: {},
  reportAttemptBTerminal: {},
  reportFailure: {},
  reportSuccess: {},
  restartApplication: {},
  startAttemptA: {},
  startAttemptB: {},
  stopAfterSuccess: {},
  unexpectedDeath: {},
  holdReservation: {}
}

const applicationExitDriver = defineDriver(applicationExitActions, () => {
  let phase: LifecyclePhase
  let tick: number
  let cutoffCount: number
  let requestCount: number
  let result: "Failed" | "NoExitResult" | "Succeeded" | "TimedOut"
  let requestedStatus: "NoRequestedStatus" | "NonzeroStatus" | "ZeroStatus"
  let ownerA: ForwardOwnerAdmissionType
  let ownerB: ForwardOwnerAdmissionType
  let attemptA: ExecutorAttempt
  let attemptB: ExecutorAttempt
  let attemptAPositionHeld: boolean
  let attemptBPositionHeld: boolean
  let write: ProducedWrite
  let reservationHeld: boolean
  let fiberOpen: boolean
  let coordinatorLockHeld: boolean
  let failureDiagnosticRetained: boolean
  let ownerAAmbiguous: boolean
  let ownerBAmbiguous: boolean
  let gracefulTerminationRequested: boolean
  let forcedTerminationRequested: boolean
  let unexpectedDeathObserved: boolean
  let restarted: boolean
  let restartClearedLifecycle: boolean
  const durable = {
    ownerAIntentAcknowledged: false,
    ownerBIntentAcknowledged: false,
    ownerAKnownObservationRecorded: false,
    ownerBKnownObservationRecorded: false,
    attemptASuspensionIntentAcknowledged: false,
    attemptBSuspensionIntentAcknowledged: false,
    pauseApplied: false,
    runTerminationAuthorized: false,
    runTerminated: false,
    durableResourcesPreserved: true,
    workflowExitRecords: 0
  }

  const reset = () => {
    phase = "Serving"
    tick = 0
    cutoffCount = 0
    requestCount = 0
    result = "NoExitResult"
    requestedStatus = "NoRequestedStatus"
    ownerA = ForwardOwnerAdmission.NoForwardOwner()
    ownerB = ForwardOwnerAdmission.NoForwardOwner()
    attemptA = "AttemptNotStarted"
    attemptB = "AttemptNotStarted"
    attemptAPositionHeld = false
    attemptBPositionHeld = false
    write = "NoProducedWrite"
    reservationHeld = false
    fiberOpen = false
    coordinatorLockHeld = true
    failureDiagnosticRetained = false
    ownerAAmbiguous = false
    ownerBAmbiguous = false
    gracefulTerminationRequested = false
    forcedTerminationRequested = false
    unexpectedDeathObserved = false
    restarted = false
    restartClearedLifecycle = false
    durable.ownerAIntentAcknowledged = false
    durable.ownerBIntentAcknowledged = false
    durable.ownerAKnownObservationRecorded = false
    durable.ownerBKnownObservationRecorded = false
    durable.attemptASuspensionIntentAcknowledged = false
    durable.attemptBSuspensionIntentAcknowledged = false
    durable.pauseApplied = false
    durable.runTerminationAuthorized = false
    durable.runTerminated = false
    durable.durableResourcesPreserved = true
    durable.workflowExitRecords = 0
  }

  reset()

  const registerOwner = (owner: ForwardOwnerAdmissionType): ForwardOwnerAdmissionType => {
    if (owner._tag !== "PreparingForwardOwner") return owner
    const decision = decideForwardOwnerRegistration(cutoffCount === 1, owner.kind)
    return decision._tag === "ForwardOwnerRegistered"
      ? ForwardOwnerAdmission.RegisteredForwardOwner({ kind: decision.kind })
      : owner
  }

  const boundaryRelease = (
    owner: ForwardOwnerAdmissionType,
    intentAcknowledged: boolean,
    observation: "Ambiguous" | "KnownResult"
  ) => {
    if (!ownerIsRegistered(owner, "InterruptibleBoundary")) return { ambiguous: false, owner, recordKnown: false }
    const decision = decideInterruptibleOwnerRelease(intentAcknowledged, observation)
    if (decision._tag === "RetainOwnerForMissingIntent") return { ambiguous: false, owner, recordKnown: false }
    return {
      ambiguous: decision._tag === "ReleaseRecoverableAmbiguity",
      owner: ForwardOwnerAdmission.NoForwardOwner(),
      recordKnown: decision._tag === "RecordKnownObservationAndRelease"
    }
  }

  const reportExecutor = (
    expected: PlannedAttemptExecutorCorrelation,
    report:
      | ReturnType<typeof PlannedAttemptExecutorReport.cases.SafelySuspended.make>
      | ReturnType<typeof PlannedAttemptExecutorReport.cases.Terminal.make>
  ) => decideExecutorPosition(expected, report)._tag === "ReleasePosition"

  const drainSnapshot = (): ApplicationExitDrainSnapshot => ({
    attempts: [attemptForDrain(attemptA), attemptForDrain(attemptB)],
    coordinatorLockHeld,
    fiberOpen,
    liveForwardOwnerCount: ApplicationExitLiveForwardOwnerCount.make(
      [ownerA, ownerB].filter((owner) => ownerIsRegistered(owner)).length
    ),
    producedWrite: writeForDrain(write),
    reservationHeld,
    tick: ApplicationExitDrainTick.make(tick)
  })

  const clearProcessLocalStateAfterDeath = () => {
    ownerA = ForwardOwnerAdmission.NoForwardOwner()
    ownerB = ForwardOwnerAdmission.NoForwardOwner()
    attemptA = "AttemptNotStarted"
    attemptB = "AttemptNotStarted"
    attemptAPositionHeld = false
    attemptBPositionHeld = false
    write = "NoProducedWrite"
    reservationHeld = false
    fiberOpen = false
    coordinatorLockHeld = false
  }

  return {
    init: () => Effect.sync(reset),
    acknowledgeOwnerAIntent: () => Effect.sync(() => (durable.ownerAIntentAcknowledged = true)),
    acknowledgeOwnerBIntent: () => Effect.sync(() => (durable.ownerBIntentAcknowledged = true)),
    prepareInterruptibleOwnerA: () =>
      Effect.sync(() => (ownerA = ForwardOwnerAdmission.PreparingForwardOwner({ kind: "InterruptibleBoundary" }))),
    prepareAtomicOwnerA: () =>
      Effect.sync(() => (ownerA = ForwardOwnerAdmission.PreparingForwardOwner({ kind: "AtomicBoundary" }))),
    prepareTerminationAppendOwnerA: () =>
      Effect.sync(
        () => (ownerA = ForwardOwnerAdmission.PreparingForwardOwner({ kind: "AuthorizedRunTerminationAppend" }))
      ),
    prepareInterruptibleOwnerB: () =>
      Effect.sync(() => (ownerB = ForwardOwnerAdmission.PreparingForwardOwner({ kind: "InterruptibleBoundary" }))),
    registerOwnerA: () =>
      Effect.sync(() => {
        const kind = ownerA._tag === "PreparingForwardOwner" ? ownerA.kind : undefined
        ownerA = registerOwner(ownerA)
        if (kind === "AuthorizedRunTerminationAppend" && ownerIsRegistered(ownerA, kind)) {
          durable.runTerminationAuthorized = true
        }
      }),
    registerOwnerB: () => Effect.sync(() => (ownerB = registerOwner(ownerB))),
    startAttemptA: () =>
      Effect.sync(() => {
        attemptA = "AttemptRunning"
        attemptAPositionHeld = true
      }),
    startAttemptB: () =>
      Effect.sync(() => {
        attemptB = "AttemptRunning"
        attemptBPositionHeld = true
      }),
    produceJournalWrite: () => Effect.sync(() => (write = "ProducedWritePending")),
    holdReservation: () => Effect.sync(() => (reservationHeld = true)),
    openFiber: () => Effect.sync(() => (fiberOpen = true)),
    applyPauseBeforeCutoff: () => Effect.sync(() => (durable.pauseApplied = true)),
    acceptExit: () =>
      Effect.sync(() => {
        const decision = closeApplicationExitAdmission([ownerA, ownerB])
        const [closedOwnerA, closedOwnerB] = decision.owners
        if (closedOwnerA === undefined || closedOwnerB === undefined) {
          throw new Error("application Exit cutoff lost one controlled owner slot")
        }
        phase = "Draining"
        tick = decision.tick
        cutoffCount = 1
        requestCount = 1
        result = "NoExitResult"
        requestedStatus = "NoRequestedStatus"
        ownerA = closedOwnerA
        ownerB = closedOwnerB
      }),
    joinExit: () =>
      Effect.sync(() => {
        const joined = joinApplicationExitDrain(ApplicationExitDrainTick.make(tick))
        requestCount = 2
        tick = joined.tick
      }),
    observeOwnerAKnownResult: () =>
      Effect.sync(() => {
        const decision = boundaryRelease(ownerA, durable.ownerAIntentAcknowledged, "KnownResult")
        ownerA = decision.owner
        durable.ownerAKnownObservationRecorded = decision.recordKnown
      }),
    observeOwnerBKnownResult: () =>
      Effect.sync(() => {
        const decision = boundaryRelease(ownerB, durable.ownerBIntentAcknowledged, "KnownResult")
        ownerB = decision.owner
        durable.ownerBKnownObservationRecorded = decision.recordKnown
      }),
    interruptOwnerAWithRecoverableAmbiguity: () =>
      Effect.sync(() => {
        const decision = boundaryRelease(ownerA, durable.ownerAIntentAcknowledged, "Ambiguous")
        ownerA = decision.owner
        ownerAAmbiguous = decision.ambiguous
      }),
    interruptOwnerBWithRecoverableAmbiguity: () =>
      Effect.sync(() => {
        const decision = boundaryRelease(ownerB, durable.ownerBIntentAcknowledged, "Ambiguous")
        ownerB = decision.owner
        ownerBAmbiguous = decision.ambiguous
      }),
    finishAtomicOwnerA: () =>
      Effect.sync(() => {
        ownerA = ForwardOwnerAdmission.NoForwardOwner()
      }),
    finishAuthorizedTerminationAppendA: () =>
      Effect.sync(() => {
        if (durable.runTerminationAuthorized) {
          ownerA = ForwardOwnerAdmission.NoForwardOwner()
          durable.runTerminated = true
        }
      }),
    recordAttemptASuspensionIntent: () =>
      Effect.sync(() => {
        attemptA = "SuspensionIntentRecorded"
        durable.attemptASuspensionIntentAcknowledged = true
      }),
    recordAttemptBSuspensionIntent: () =>
      Effect.sync(() => {
        attemptB = "SuspensionIntentRecorded"
        durable.attemptBSuspensionIntentAcknowledged = true
      }),
    callFastSuspensionA: () =>
      Effect.sync(() => {
        attemptA = "FastSuspensionCalled"
      }),
    callFastSuspensionB: () =>
      Effect.sync(() => {
        attemptB = "FastSuspensionCalled"
      }),
    reportAttemptASafelySuspended: () =>
      Effect.sync(() => {
        const report = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation: correlationA })
        if (reportExecutor(correlationA, report)) {
          attemptA = "AttemptSafelySuspended"
          attemptAPositionHeld = false
        }
      }),
    reportAttemptBSafelySuspended: () =>
      Effect.sync(() => {
        const report = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation: correlationB })
        if (reportExecutor(correlationB, report)) {
          attemptB = "AttemptSafelySuspended"
          attemptBPositionHeld = false
        }
      }),
    reportAttemptATerminal: () =>
      Effect.sync(() => {
        const report = PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: correlationA,
          result: { _tag: "Completed" }
        })
        if (reportExecutor(correlationA, report)) {
          attemptA = "AttemptTerminal"
          attemptAPositionHeld = false
        }
      }),
    reportAttemptBTerminal: () =>
      Effect.sync(() => {
        const report = PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: correlationB,
          result: { _tag: "Completed" }
        })
        if (reportExecutor(correlationB, report)) {
          attemptB = "AttemptTerminal"
          attemptBPositionHeld = false
        }
      }),
    failFastSuspensionA: () =>
      Effect.sync(() => {
        attemptA = "SuspensionCallFailed"
        failureDiagnosticRetained = true
      }),
    acknowledgeProducedWrite: () =>
      Effect.sync(() => {
        write = "ProducedWriteAcknowledged"
      }),
    failProducedWrite: () =>
      Effect.sync(() => {
        write = "ProducedWriteFailed"
        failureDiagnosticRetained = true
      }),
    releaseReservation: () =>
      Effect.sync(() => {
        reservationHeld = false
      }),
    closeFiber: () =>
      Effect.sync(() => {
        fiberOpen = false
      }),
    releaseCoordinatorLock: () =>
      Effect.sync(() => {
        coordinatorLockHeld = false
      }),
    reportSuccess: () =>
      Effect.sync(() => {
        const decision = decideApplicationExitDrain(drainSnapshot())
        if (decision._tag === "ReportSucceeded") {
          phase = "SuccessReported"
          result = "Succeeded"
          requestedStatus = "ZeroStatus"
        }
      }),
    reportFailure: () =>
      Effect.sync(() => {
        const decision = decideApplicationExitDrain(drainSnapshot())
        if (decision._tag === "ReportFailed") {
          phase = "FailureReported"
          result = "Failed"
          requestedStatus = "NonzeroStatus"
        }
      }),
    advanceTick: () =>
      Effect.sync(() => {
        const decision = advanceApplicationExitTick(
          ApplicationExitDrainTick.make(tick),
          failureDiagnosticRetained ? [failureDiagnostic] : []
        )
        if (decision._tag === "AdvanceToTick") tick = decision.tick
        if (decision._tag === "ForceTimedOut") {
          phase = "ProcessGoneTimeout"
          tick = decision.tick
          result = "TimedOut"
          requestedStatus = "NonzeroStatus"
          forcedTerminationRequested = true
        }
      }),
    stopAfterSuccess: () =>
      Effect.sync(() => {
        if (result !== "Succeeded") return
        const decision = decideApplicationProcessEnd({ _tag: "Succeeded", requestedStatus: 0 })
        if (decision._tag === "RequestGracefulTermination") {
          phase = "ProcessGoneGraceful"
          gracefulTerminationRequested = true
        }
      }),
    forceAfterFailure: () =>
      Effect.sync(() => {
        if (result !== "Failed") return
        const decision = decideApplicationProcessEnd({
          _tag: "Failed",
          diagnostics: [failureDiagnostic],
          requestedStatus: 1
        })
        if (decision._tag === "RequestForcedTermination") {
          phase = "ProcessGoneFailure"
          forcedTerminationRequested = true
        }
      }),
    unexpectedDeath: () =>
      Effect.sync(() => {
        phase = "ProcessGoneUnexpected"
        result = "NoExitResult"
        requestedStatus = "NoRequestedStatus"
        clearProcessLocalStateAfterDeath()
        unexpectedDeathObserved = true
      }),
    restartApplication: () =>
      Effect.sync(() => {
        const fresh = freshApplicationExitState()
        phase = "Serving"
        tick = fresh.tick
        cutoffCount = 0
        requestCount = 0
        result = "NoExitResult"
        requestedStatus = "NoRequestedStatus"
        ownerA = ForwardOwnerAdmission.NoForwardOwner()
        ownerB = ForwardOwnerAdmission.NoForwardOwner()
        attemptA = "AttemptNotStarted"
        attemptB = "AttemptNotStarted"
        attemptAPositionHeld = false
        attemptBPositionHeld = false
        write = "NoProducedWrite"
        reservationHeld = false
        fiberOpen = false
        coordinatorLockHeld = true
        failureDiagnosticRetained = false
        ownerAAmbiguous = false
        ownerBAmbiguous = false
        restarted = true
        restartClearedLifecycle = true
      }),
    getState: () =>
      Effect.sync(() => {
        const liveOwnerCount = [ownerA, ownerB].filter((owner) => ownerIsRegistered(owner)).length
        ApplicationExitLiveForwardOwnerCount.make(liveOwnerCount)
        return {
          phase,
          tick,
          cutoffCount,
          requestCount,
          result,
          requestedStatus,
          ownerA: ownerKey(ownerA),
          ownerB: ownerKey(ownerB),
          attemptA,
          attemptB,
          attemptAPositionHeld,
          attemptBPositionHeld,
          write,
          reservationHeld,
          fiberOpen,
          coordinatorLockHeld,
          failureDiagnosticRetained,
          ownerAAmbiguous,
          ownerBAmbiguous,
          durable: { ...durable },
          trace: {
            postCutoffForwardRegistrations: 0,
            ambiguousReleasesWithoutIntent: 0,
            foreignExecutorReleases: 0,
            timerResets: 0,
            tickRegressions: 0,
            joinedResultMismatches: 0,
            llmRequests: 0,
            freshReconciliationReads: 0,
            stabilizationReads: 0,
            durableCleanupCalls: 0,
            attemptReplacements: 0,
            postCutoffControlApplications: 0,
            postCutoffTerminationStarts: 0,
            manufacturedWorkflowOutcomes: 0,
            gracefulTerminationRequested,
            forcedTerminationRequested,
            unexpectedDeathObserved,
            restarted,
            restartClearedLifecycle
          }
        }
      })
  }
})

quintIt(
  it.effect,
  "replays application Exit decisions through the production lifecycle kernel",
  {
    backend: "typescript",
    driverFactory: applicationExitDriver,
    maxSteps: 30,
    nTraces: 200,
    seed: "203",
    spec: "specs/applicationExit.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            phase: variantTag(state.phase),
            tick: Number(state.tick),
            cutoffCount: Number(state.cutoffCount),
            requestCount: Number(state.requestCount),
            result: variantTag(state.result),
            requestedStatus: variantTag(state.requestedStatus),
            ownerA: normalizedOwner(state.ownerA),
            ownerB: normalizedOwner(state.ownerB),
            attemptA: variantTag(state.attemptA),
            attemptB: variantTag(state.attemptB),
            write: variantTag(state.write),
            durable: { ...state.durable, workflowExitRecords: Number(state.durable.workflowExitRecords) },
            trace: {
              ...state.trace,
              postCutoffForwardRegistrations: Number(state.trace.postCutoffForwardRegistrations),
              ambiguousReleasesWithoutIntent: Number(state.trace.ambiguousReleasesWithoutIntent),
              foreignExecutorReleases: Number(state.trace.foreignExecutorReleases),
              timerResets: Number(state.trace.timerResets),
              tickRegressions: Number(state.trace.tickRegressions),
              joinedResultMismatches: Number(state.trace.joinedResultMismatches),
              llmRequests: Number(state.trace.llmRequests),
              freshReconciliationReads: Number(state.trace.freshReconciliationReads),
              stabilizationReads: Number(state.trace.stabilizationReads),
              durableCleanupCalls: Number(state.trace.durableCleanupCalls),
              attemptReplacements: Number(state.trace.attemptReplacements),
              postCutoffControlApplications: Number(state.trace.postCutoffControlApplications),
              postCutoffTerminationStarts: Number(state.trace.postCutoffTerminationStarts),
              manufacturedWorkflowOutcomes: Number(state.trace.manufacturedWorkflowOutcomes)
            }
          })),
          Effect.orDie
        ),
      (spec, implementation) => JSON.stringify(spec) === JSON.stringify(implementation)
    )
  },
  120_000
)
