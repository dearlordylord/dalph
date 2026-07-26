import { it } from "@effect/vitest"
import { Cause, Effect, Exit } from "effect"
import { expect } from "vitest"
import { OperationId, TaskId } from "../../src/domain.js"
import {
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelTaskId,
  frontierRecoveryReconstructionActions,
  frontierRecoveryReconstructionConformanceVersion,
  makeFrontierRecoveryIdentityMapping,
  runFrontierRecoveryReconstructionAction
} from "./frontier-recovery-conformance.js"

const taskA = TaskId.make("frontier-recovery-task-A")
const taskB = TaskId.make("frontier-recovery-task-B")
const operationOne = OperationId.make("frontier-recovery-operation-1")

it("defines the versioned closed M2 reconstruction action map", () => {
  expect(frontierRecoveryReconstructionConformanceVersion).toBe(4)
  expect(frontierRecoveryReconstructionActions).toEqual([
    "init",
    "orchestratorCommitsNextFreshTaskClaimIntent",
    "orchestratorCommitsFreshTaskClaimIntent",
    "taskTrackerReportsProvenAbsenceInTargetClosure",
    "taskTrackerReportsIncomparableTargetClosureMembership",
    "taskTrackerReportsCompatibleTargetClosureReplacement",
    "crash",
    "restart"
  ])
})

it.effect("rejects unknown M2 reconstruction actions before invoking a control", () =>
  Effect.gen(function*() {
    let invocations = 0
    const controls = {
      crash: () => Effect.sync(() => invocations += 1),
      init: () => Effect.sync(() => invocations += 1),
      orchestratorCommitsFreshTaskClaimIntent: () => Effect.sync(() => invocations += 1),
      orchestratorCommitsNextFreshTaskClaimIntent: () => Effect.sync(() => invocations += 1),
      restart: () => Effect.sync(() => invocations += 1),
      taskTrackerReportsCompatibleTargetClosureReplacement: () => Effect.sync(() => invocations += 1),
      taskTrackerReportsIncomparableTargetClosureMembership: () => Effect.sync(() => invocations += 1),
      taskTrackerReportsProvenAbsenceInTargetClosure: () => Effect.sync(() => invocations += 1)
    }
    const exit = yield* runFrontierRecoveryReconstructionAction(
      { _tag: "assignExpectedState" },
      controls
    ).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        _tag: "FrontierRecoveryConformanceIssue",
        reason: "UnknownAction"
      })
    }
    expect(invocations).toBe(0)
  }))

it.effect("round-trips bounded M2 task and operation identities", () =>
  Effect.gen(function*() {
    const mapping = yield* makeFrontierRecoveryIdentityMapping({
      operations: [{
        branded: operationOne,
        model: FrontierRecoveryModelOperationId.make(1n)
      }],
      tasks: [
        { branded: taskA, model: FrontierRecoveryModelTaskId.make(0n) },
        { branded: taskB, model: FrontierRecoveryModelTaskId.make(1n) }
      ]
    })

    expect(
      yield* mapping.taskFromModel(
        FrontierRecoveryModelTaskId.make(0n)
      )
    ).toBe(taskA)
    expect(yield* mapping.taskToModel(taskB)).toBe(1n)
    expect(
      yield* mapping.operationFromModel(
        FrontierRecoveryModelOperationId.make(1n)
      )
    ).toBe(operationOne)
    expect(yield* mapping.operationToModel(operationOne)).toBe(1n)

    const unknown = yield* mapping.taskFromModel(
      FrontierRecoveryModelTaskId.make(99n)
    ).pipe(Effect.exit)
    expect(Exit.isFailure(unknown)).toBe(true)
    if (Exit.isFailure(unknown)) {
      expect(Cause.squash(unknown.cause)).toMatchObject({
        _tag: "FrontierRecoveryConformanceIssue",
        reason: "UnknownModelIdentity"
      })
    }
  }))

it.effect("rejects missing, duplicate, and lossy M2 identity mappings", () =>
  Effect.gen(function*() {
    const cases = [
      {
        expectedReason: "MissingMapping",
        input: { operations: [], tasks: [] }
      },
      {
        expectedReason: "DuplicateModelIdentity",
        input: {
          operations: [{
            branded: operationOne,
            model: FrontierRecoveryModelOperationId.make(1n)
          }],
          tasks: [
            { branded: taskA, model: FrontierRecoveryModelTaskId.make(0n) },
            { branded: taskB, model: FrontierRecoveryModelTaskId.make(0n) }
          ]
        }
      },
      {
        expectedReason: "DuplicateBrandedIdentity",
        input: {
          operations: [{
            branded: operationOne,
            model: FrontierRecoveryModelOperationId.make(1n)
          }],
          tasks: [
            { branded: taskA, model: FrontierRecoveryModelTaskId.make(0n) },
            { branded: taskA, model: FrontierRecoveryModelTaskId.make(1n) }
          ]
        }
      },
      {
        expectedReason: "LossyProjection",
        input: {
          operations: [{
            branded: operationOne,
            model: FrontierRecoveryModelOperationId.make(-1n)
          }],
          tasks: [{
            branded: taskA,
            model: FrontierRecoveryModelTaskId.make(0n)
          }]
        }
      }
    ] as const

    for (const scenario of cases) {
      const exit = yield* makeFrontierRecoveryIdentityMapping(
        scenario.input
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "FrontierRecoveryConformanceIssue",
          reason: scenario.expectedReason
        })
      }
    }
  }))
