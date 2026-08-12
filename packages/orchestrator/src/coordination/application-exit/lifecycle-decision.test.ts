import {
  AttemptId,
  PlannedAttemptExecutorReport,
  RunId,
  type PlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { describe, expect, it } from "vitest"
import {
  ApplicationExitDiagnostic,
  type ApplicationExitDrainSnapshot,
  ApplicationExitDrainTick,
  ApplicationExitExecutorAttemptEvidence,
  ApplicationExitLiveForwardOwnerCount,
  ApplicationExitProducedWriteEvidence,
  ApplicationExitResult,
  ForwardOwnerAdmission,
  advanceApplicationExitTick,
  closeApplicationExitAdmission,
  decideApplicationExitDrain,
  decideApplicationProcessEnd,
  decideExecutorPosition,
  decideForwardOwnerRegistration,
  decideInterruptibleOwnerRelease,
  finalApplicationExitDrainTick,
  freshApplicationExitState,
  initialApplicationExitDrainTick,
  joinApplicationExitDrain
} from "./lifecycle-decision.js"

const expectedCorrelation: PlannedAttemptExecutorCorrelation = {
  attemptId: AttemptId.make("application-exit-attempt-A"),
  runId: RunId.make("application-exit-run")
}

const foreignCorrelation: PlannedAttemptExecutorCorrelation = {
  attemptId: AttemptId.make("application-exit-attempt-B"),
  runId: RunId.make("application-exit-run")
}

const diagnostic = ApplicationExitDiagnostic.make("journal write failed")

const successfulSnapshot: ApplicationExitDrainSnapshot = {
  attempts: [
    ApplicationExitExecutorAttemptEvidence.NotStarted(),
    ApplicationExitExecutorAttemptEvidence.SafelySuspended()
  ],
  coordinatorLockHeld: false,
  fiberOpen: false,
  liveForwardOwnerCount: ApplicationExitLiveForwardOwnerCount.make(0),
  producedWrite: ApplicationExitProducedWriteEvidence.Acknowledged(),
  reservationHeld: false,
  tick: initialApplicationExitDrainTick
}

describe("application Exit lifecycle decisions", () => {
  it("closes admission by rolling back preparation and preserving an earlier registered owner", () => {
    const decision = closeApplicationExitAdmission([
      ForwardOwnerAdmission.NoForwardOwner(),
      ForwardOwnerAdmission.PreparingForwardOwner({ kind: "AtomicBoundary" }),
      ForwardOwnerAdmission.RegisteredForwardOwner({ kind: "InterruptibleBoundary" })
    ])

    expect(decision).toMatchObject({
      cutoffClosed: true,
      owners: [
        { _tag: "NoForwardOwner" },
        { _tag: "NoForwardOwner" },
        { _tag: "RegisteredForwardOwner", kind: "InterruptibleBoundary" }
      ],
      tick: 0
    })
  })

  it("rejects registration after cutoff with typed ApplicationExiting", () => {
    expect(decideForwardOwnerRegistration(false, "AtomicBoundary")).toMatchObject({
      _tag: "ForwardOwnerRegistered",
      kind: "AtomicBoundary"
    })
    expect(decideForwardOwnerRegistration(true, "AtomicBoundary")).toMatchObject({
      _tag: "ForwardOwnerRejected",
      error: { _tag: "ApplicationExiting" }
    })
  })

  it("joins the original drain without changing its tick", () => {
    expect(joinApplicationExitDrain(ApplicationExitDrainTick.make(3))).toEqual({ joined: true, tick: 3 })
  })

  it("releases an ambiguous interruptible owner only behind acknowledged intent", () => {
    expect(decideInterruptibleOwnerRelease(false, "Ambiguous")._tag).toBe("RetainOwnerForMissingIntent")
    expect(decideInterruptibleOwnerRelease(true, "Ambiguous")._tag).toBe("ReleaseRecoverableAmbiguity")
    expect(decideInterruptibleOwnerRelease(true, "KnownResult")._tag).toBe("RecordKnownObservationAndRelease")
  })

  it("releases a task-work position only for exact safe-or-terminal evidence", () => {
    const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation: expectedCorrelation })
    const suspended = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation: expectedCorrelation })
    const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({
      correlation: expectedCorrelation,
      result: { _tag: "Completed" }
    })
    const foreign = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation: foreignCorrelation })

    expect(decideExecutorPosition(expectedCorrelation, undefined)).toMatchObject({
      _tag: "RetainPosition",
      reason: "NoEvidence"
    })
    expect(decideExecutorPosition(expectedCorrelation, running)).toMatchObject({
      _tag: "RetainPosition",
      reason: "RunningIsUnsafe"
    })
    expect(decideExecutorPosition(expectedCorrelation, foreign)).toMatchObject({
      _tag: "RetainPosition",
      reason: "ForeignCorrelation"
    })
    expect(decideExecutorPosition(expectedCorrelation, suspended)).toMatchObject({
      _tag: "ReleasePosition",
      evidence: "SafelySuspended"
    })
    expect(decideExecutorPosition(expectedCorrelation, terminal)).toMatchObject({
      _tag: "ReleasePosition",
      evidence: "Terminal"
    })
  })

  it("reports success only after every recoverability condition is satisfied", () => {
    expect(decideApplicationExitDrain(successfulSnapshot)).toMatchObject({
      _tag: "ReportSucceeded",
      result: { _tag: "Succeeded", requestedStatus: 0 }
    })
    expect(
      decideApplicationExitDrain({
        ...successfulSnapshot,
        attempts: [
          ApplicationExitExecutorAttemptEvidence.Running(),
          ApplicationExitExecutorAttemptEvidence.SafelySuspended()
        ]
      })._tag
    ).toBe("ContinueDraining")
    expect(decideApplicationExitDrain({ ...successfulSnapshot, coordinatorLockHeld: true })._tag).toBe(
      "ContinueDraining"
    )
  })

  it("reports conclusive failure only after useful quick work settles", () => {
    expect(
      decideApplicationExitDrain({
        ...successfulSnapshot,
        attempts: [ApplicationExitExecutorAttemptEvidence.SuspensionCallFailed({ diagnostic })]
      })
    ).toMatchObject({ _tag: "ReportFailed", result: { _tag: "Failed", diagnostics: [diagnostic] } })
    expect(
      decideApplicationExitDrain({
        ...successfulSnapshot,
        attempts: [ApplicationExitExecutorAttemptEvidence.Running()],
        producedWrite: ApplicationExitProducedWriteEvidence.Failed({ diagnostic })
      })._tag
    ).toBe("ContinueDraining")
  })

  it("classifies every executor and produced-write evidence variant", () => {
    const attemptEvidence = [
      ApplicationExitExecutorAttemptEvidence.FastSuspensionCalled(),
      ApplicationExitExecutorAttemptEvidence.NotStarted(),
      ApplicationExitExecutorAttemptEvidence.Running(),
      ApplicationExitExecutorAttemptEvidence.SafelySuspended(),
      ApplicationExitExecutorAttemptEvidence.SuspensionCallFailed({ diagnostic }),
      ApplicationExitExecutorAttemptEvidence.SuspensionIntentRecorded(),
      ApplicationExitExecutorAttemptEvidence.Terminal()
    ]

    for (const attempt of attemptEvidence) {
      expect(
        decideApplicationExitDrain({
          ...successfulSnapshot,
          attempts: [attempt],
          producedWrite: ApplicationExitProducedWriteEvidence.Failed({ diagnostic })
        })._tag
      ).not.toBe("ReportSucceeded")
      expect(
        decideApplicationExitDrain({
          ...successfulSnapshot,
          attempts: [attempt],
          producedWrite: ApplicationExitProducedWriteEvidence.None()
        })._tag
      ).toBeDefined()
    }

    expect(
      decideApplicationExitDrain({
        ...successfulSnapshot,
        attempts: [],
        producedWrite: ApplicationExitProducedWriteEvidence.Pending()
      })._tag
    ).toBe("ContinueDraining")
  })

  it("gives the fifth tick precedence and retains earlier diagnostics", () => {
    expect(
      decideApplicationExitDrain({
        ...successfulSnapshot,
        attempts: [ApplicationExitExecutorAttemptEvidence.SuspensionCallFailed({ diagnostic })],
        tick: finalApplicationExitDrainTick
      })
    ).toMatchObject({ _tag: "ForceTimedOut", result: { _tag: "TimedOut", diagnostics: [diagnostic] } })
  })

  it("advances monotonically and makes the fifth tick an atomic timeout", () => {
    expect(advanceApplicationExitTick(initialApplicationExitDrainTick, [])).toMatchObject({
      _tag: "AdvanceToTick",
      tick: 1
    })
    expect(advanceApplicationExitTick(ApplicationExitDrainTick.make(4), [diagnostic])).toMatchObject({
      _tag: "ForceTimedOut",
      result: { _tag: "TimedOut", diagnostics: [diagnostic], requestedStatus: 1 },
      tick: 5
    })
    expect(advanceApplicationExitTick(finalApplicationExitDrainTick, [])._tag).toBe("AlreadyTimedOut")
  })

  it("maps success to graceful zero and failure or timeout to forced nonzero termination", () => {
    expect(decideApplicationProcessEnd(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))).toEqual({
      _tag: "RequestGracefulTermination",
      status: 0
    })
    expect(
      decideApplicationProcessEnd(
        ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
    ).toEqual({ _tag: "RequestForcedTermination", status: 1 })
    expect(
      decideApplicationProcessEnd(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
    ).toEqual({ _tag: "RequestForcedTermination", status: 1 })
  })

  it("starts every process with no restored application Exit lifecycle state", () => {
    expect(freshApplicationExitState()).toEqual({ cutoffClosed: false, result: undefined, tick: 0 })
  })

  it("brands a nonnegative owner count without importing the model's fixed slot bound", () => {
    expect(ApplicationExitLiveForwardOwnerCount.make(0)).toBe(0)
    expect(ApplicationExitLiveForwardOwnerCount.make(2)).toBe(2)
    expect(ApplicationExitLiveForwardOwnerCount.make(3)).toBe(3)
    expect(() => ApplicationExitLiveForwardOwnerCount.make(-1)).toThrow()
  })
})
