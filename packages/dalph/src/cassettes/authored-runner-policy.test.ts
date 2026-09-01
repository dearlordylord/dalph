import { it as effectIt } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Queue } from "effect"
import { expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import { AuthoredCassetteInteractionMismatch } from "./authored-cursor.js"
import {
  authoredInteractionMismatchFrom,
  awaitReactivationOwnerProcessOutcome,
  pauseObservationResultOf
} from "./authored-runner.js"

effectIt.effect("ends one reactivation-owner generation at terminal assertions", () =>
  Effect.gen(function* () {
    const terminal = yield* Deferred.make<void>()
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    yield* Deferred.succeed(terminal, undefined)

    expect(yield* awaitReactivationOwnerProcessOutcome(Deferred.await(terminal), processDeaths, failure)).toBe(
      "TerminalAssertions"
    )
  })
)

effectIt.effect("ends one reactivation-owner generation at an authored process death", () =>
  Effect.gen(function* () {
    const terminal = yield* Deferred.make<void>()
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    yield* Queue.offer(processDeaths, undefined)

    expect(yield* awaitReactivationOwnerProcessOutcome(Deferred.await(terminal), processDeaths, failure)).toBe(
      "CoordinatorProcessDied"
    )
  })
)

effectIt.effect("propagates one reactivation-owner failure as the same defect", () =>
  Effect.gen(function* () {
    const terminal = yield* Deferred.make<void>()
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    const sentinel = { _tag: "ReactivationOwnerFailureSentinel" }
    yield* Deferred.succeed(failure, sentinel)

    const exit = yield* awaitReactivationOwnerProcessOutcome(Deferred.await(terminal), processDeaths, failure).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1)
      expect(exit.cause.reasons.every(Cause.isDieReason)).toBe(true)
      const defects = exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))
      expect(defects).toEqual([sentinel])
    }
  })
)

effectIt.effect("prefers an owner defect when all reactivation-owner outcomes are already ready", () =>
  Effect.gen(function* () {
    const terminal = yield* Deferred.make<void>()
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    const sentinel = { _tag: "SimultaneousReactivationOwnerFailureSentinel" }
    yield* Deferred.succeed(terminal, undefined)
    yield* Queue.offer(processDeaths, undefined)
    yield* Deferred.succeed(failure, sentinel)

    const exit = yield* awaitReactivationOwnerProcessOutcome(Deferred.await(terminal), processDeaths, failure).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1)
      expect(exit.cause.reasons.every(Cause.isDieReason)).toBe(true)
      const defects = exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))
      expect(defects).toEqual([sentinel])
    }
    expect(yield* Queue.size(processDeaths)).toBe(1)
  })
)

effectIt.effect("prefers authored process death when death and terminal assertions are already ready", () =>
  Effect.gen(function* () {
    const terminal = yield* Deferred.make<void>()
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    yield* Deferred.succeed(terminal, undefined)
    yield* Queue.offer(processDeaths, undefined)

    expect(yield* awaitReactivationOwnerProcessOutcome(Deferred.await(terminal), processDeaths, failure)).toBe(
      "CoordinatorProcessDied"
    )
    expect(yield* Queue.size(processDeaths)).toBe(0)
  })
)

effectIt.effect("prefers an owner defect that becomes ready with the terminal wake", () =>
  Effect.gen(function* () {
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    const sentinel = { _tag: "PostWakeReactivationOwnerFailureSentinel" }
    const terminalWake = Deferred.succeed(failure, sentinel).pipe(Effect.asVoid)

    const exit = yield* awaitReactivationOwnerProcessOutcome(terminalWake, processDeaths, failure).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons).toHaveLength(1)
      expect(exit.cause.reasons.every(Cause.isDieReason)).toBe(true)
      const defects = exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))
      expect(defects).toEqual([sentinel])
    }
  })
)

effectIt.effect("prefers authored process death that becomes ready with the terminal wake", () =>
  Effect.gen(function* () {
    const processDeaths = yield* Queue.unbounded<void>()
    const failure = yield* Deferred.make<unknown>()
    const terminalWake = Queue.offer(processDeaths, undefined).pipe(Effect.asVoid)

    expect(yield* awaitReactivationOwnerProcessOutcome(terminalWake, processDeaths, failure)).toBe(
      "CoordinatorProcessDied"
    )
    expect(yield* Queue.size(processDeaths)).toBe(0)
  })
)

it("extracts only the authored interaction mismatch from an Effect exit", () => {
  const mismatch = new AuthoredCassetteInteractionMismatch({ actual: "actual", expected: "expected", storyPosition: 1 })
  expect(authoredInteractionMismatchFrom(Exit.succeed(undefined))).toBeUndefined()
  expect(authoredInteractionMismatchFrom(Exit.fail("ordinary failure"))).toBeUndefined()
  expect(authoredInteractionMismatchFrom(Exit.die("defect"))).toBeUndefined()
  expect(authoredInteractionMismatchFrom(Exit.fail(mismatch))).toBe(mismatch)
})

it("projects every workflow safe-boundary responsibility into authored Pause output", () => {
  const plannedAttempt = { attemptId: "attempt:A:0", runId: "run:projection", taskId: "A" }
  const coverage = { _tag: "RunPauseCoverage" }
  const taskId = "A"
  const responsibilities = [
    {
      _tag: "PauseAcceptedIntegrationResponsibility",
      coverage,
      taskId,
      obligation: { _tag: "AcceptedAwaitingIntegration", accepted: { plannedAttempt, terminalAt: 11 } }
    },
    {
      _tag: "PauseQueuedIntegrationResponsibility",
      coverage,
      taskId,
      obligation: { _tag: "QueuedIntegration", responsibility: { plannedAttempt, queuedAt: 12 } }
    },
    {
      _tag: "PauseWorkflowOperationResponsibility",
      coverage,
      taskId,
      obligation: {
        _tag: "WorkflowResponsibility",
        responsibility: {
          _tag: "TaskClaimResponsibility",
          acquisition: { operationId: "run:projection:claim" },
          beganAt: 13
        }
      }
    },
    {
      _tag: "PauseWorkflowOperationResponsibility",
      coverage,
      taskId,
      obligation: {
        _tag: "WorkflowResponsibility",
        responsibility: {
          _tag: "TaskClaimReleaseResponsibility",
          operation: { release: { operationId: "run:projection:release" } },
          beganAt: 14
        }
      }
    }
  ]
  const projected = pauseObservationResultOf(
    {
      _tag: "PauseConfirmed",
      atBoundary: responsibilities.map((responsibility) => ({ _tag: "PauseResponsibilityAtBoundary", responsibility })),
      subject: { _tag: "Run" }
    } as never,
    RunId.make("run:projection")
  )

  expect(projected).toMatchObject({
    _tag: "PauseConfirmed",
    atBoundary: [
      { _tag: "AcceptedAwaitingIntegration", terminalAt: 11 },
      { _tag: "QueuedIntegration", queuedAt: 12 },
      { _tag: "WorkflowOperation", operationId: "$authored-run:claim" },
      { _tag: "WorkflowOperation", operationId: "$authored-run:release" }
    ]
  })
})

it("projects every task-bearing delivery route and correlation shape into authored Pause output", () => {
  const taskId = "A"
  const plannedAttempt = { attemptId: "attempt:A:0", runId: "run:projection", taskId }
  const order = { _tag: "FreshWorkflowOrder", frontierOrdinal: 0, step: "controlled", taskId }
  const noAdmission = {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
    taskWorkPosition: { _tag: "NoTaskWorkPosition" }
  }
  const protocolAdmission = {
    ...noAdmission,
    plannedAttemptProtocol: {
      _tag: "PlannedAttemptProtocolRequired",
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId }
    }
  }
  const integrationAdmission = {
    ...noAdmission,
    integrationTarget: {
      _tag: "IntegrationTargetResourceRequired",
      access: "UseHeld",
      integrationTarget: { owner: "controlled", ref: "refs/heads/master", repository: "/repo" },
      queuedAt: 21
    }
  }
  const proposals = [
    { route: { _tag: "FreshWorkflowRoute", step: { _tag: "ReadTaskClaim" } }, admission: noAdmission, order },
    {
      route: { _tag: "RecoveredNewActionRoute", action: { _tag: "ReadTaskClaim", taskId } },
      admission: noAdmission,
      order
    },
    {
      route: { _tag: "RecoveredNewActionRoute", action: { _tag: "ReadTaskClaim", plannedAttempt: null, taskId } },
      admission: noAdmission,
      order
    },
    {
      route: { _tag: "AcceptedWorkflowRoute", transition: { _tag: "ObserveClaim", operationId: "run:projection:1" } },
      admission: noAdmission,
      order
    },
    {
      route: {
        _tag: "AcceptedWorkflowRoute",
        transition: {
          _tag: "ReleaseClaim",
          operation: { _tag: "ReleaseTaskClaim", release: { operationId: "run:projection:2" } }
        }
      },
      admission: noAdmission,
      order
    },
    {
      route: {
        _tag: "AcceptedWorkflowRoute",
        transition: {
          _tag: "ObserveWorktree",
          operation: { _tag: "ReadTaskWorktree", operationId: "run:projection:3" }
        }
      },
      admission: noAdmission,
      order
    },
    {
      route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "ReadTaskClaim" } },
      admission: noAdmission,
      order
    },
    {
      route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "Integrate" } },
      admission: integrationAdmission,
      order
    },
    {
      route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "SuspendPlannedAttemptExecutorWork" } },
      admission: protocolAdmission,
      order
    }
  ]
  const projected = proposals.map((proposal) =>
    pauseObservationResultOf(
      {
        _tag: "PauseWaiting",
        atBoundary: [],
        preventing: [
          {
            _tag: "PauseResponsibilityPreventingBoundary",
            blockers: [{ _tag: "ProposedDeliveryAction", proposal }],
            responsibility: {
              _tag: "PauseDeliveryActionResponsibility",
              coverage: { _tag: "RunPauseCoverage" },
              proposal,
              taskId
            }
          }
        ],
        subject: { _tag: "Run" }
      } as never,
      RunId.make("run:projection")
    )
  )

  expect(projected.every((result) => result._tag === "PauseWaiting")).toBe(true)
})

it("projects settled live delivery owners without losing their exact authored state", () => {
  const taskId = "A"
  const proposal = {
    route: { _tag: "FreshWorkflowRoute", step: { _tag: "ReadTaskClaim" } },
    admission: {
      integrationTarget: { _tag: "NoIntegrationTargetResource" },
      plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
      taskWorkPosition: { _tag: "NoTaskWorkPosition" }
    },
    order: { _tag: "FreshWorkflowOrder", frontierOrdinal: 0, step: "controlled", taskId }
  }
  const secondProposal = {
    ...proposal,
    route: { _tag: "RecoveredNewActionRoute", action: { _tag: "ReadTaskClaim", plannedAttempt: null, taskId } }
  }
  const responsibility = {
    _tag: "PauseDeliveryActionResponsibility",
    coverage: { _tag: "RunPauseCoverage" },
    proposal,
    taskId
  }
  const settledOwners = [
    { _tag: "SettledBeforeMaterialization", proposal },
    {
      _tag: "SettledMaterializedDeliveryAction",
      intent: "IntentRecorded",
      operationId: "run:projection:settled",
      proposal: secondProposal
    }
  ]

  const projected = pauseObservationResultOf(
    {
      _tag: "PauseWaiting",
      atBoundary: [],
      preventing: settledOwners.map((owner, index) => ({
        _tag: "PauseResponsibilityPreventingBoundary",
        blockers: [{ _tag: "LiveDeliveryAction", owner }],
        responsibility: index === 0 ? responsibility : { ...responsibility, proposal: secondProposal }
      })),
      subject: { _tag: "Run" }
    } as never,
    RunId.make("run:projection")
  )

  expect(projected).toMatchObject({
    _tag: "PauseWaiting",
    preventing: [
      { blockers: [{ _tag: "LiveDeliveryAction", owner: { _tag: "SettledBeforeMaterialization" } }] },
      {
        blockers: [
          {
            _tag: "LiveDeliveryAction",
            owner: {
              _tag: "SettledMaterializedDeliveryAction",
              intent: "IntentRecorded",
              operationId: "$authored-run:settled"
            }
          }
        ]
      }
    ]
  })
})
