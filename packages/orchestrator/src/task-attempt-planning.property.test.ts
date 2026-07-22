import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  deterministicPlannedTaskAttemptLayer,
  GitCommitSha,
  makeTaskAttemptPlanOperation,
  OperationId,
  PlannedTaskAttempt,
  PlannedTaskAttemptPlanner,
  RunId,
  TaskExecutorLocator,
  taskRevisionFor,
  TaskWorkSessionLocator,
  WorkflowOperation,
  workflowOperationId,
  WorktreeLocator
} from "./index.js"

it.effect("binds every exact attempt identity and resource locator", () =>
  Effect.gen(function*() {
    const snapshot = validSnapshot({
      revision: "attempt-plan-snapshot",
      tasks: [{ id: "task-44", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    const task = snapshot.eligibleTasks()[0]
    if (task === undefined) return expect.fail("expected one eligible task")
    const taskRevision = taskRevisionFor(task)

    const planner = yield* PlannedTaskAttemptPlanner
    const plan = yield* planner.plan(task, taskRevision)
    const retryPlan = yield* planner.plan(task, taskRevision)

    expect(plan).toEqual({
      attemptId: AttemptId.make("attempt:task-44:0"),
      baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
      branch: "refs/heads/dalph/attempt-task-44-0",
      executor: "executor:deterministic",
      runId: "run-44",
      session: "sessions/run-44/attempt-task-44-0",
      taskId: "task-44",
      taskRevision,
      worktree: "/worktrees/run-44/attempt-task-44-0"
    })
    expect(retryPlan.attemptId).not.toBe(plan.attemptId)
    expect(retryPlan.branch).not.toBe(plan.branch)
    expect(retryPlan.session).not.toBe(plan.session)
    expect(retryPlan.worktree).not.toBe(plan.worktree)
  }).pipe(Effect.provide(deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
    executor: TaskExecutorLocator.make("executor:deterministic"),
    runId: RunId.make("run-44"),
    sessionRoot: TaskWorkSessionLocator.make("sessions/run-44"),
    worktreeRoot: WorktreeLocator.make("/worktrees/run-44")
  }))))

it("roundtrips arbitrary valid attempt plans through the persisted Schema boundary", () => {
  const nonEmpty = fc.string({ minLength: 1, maxLength: 40 })
  fc.assert(fc.property(
    fc.record({
      attemptId: nonEmpty,
      branch: nonEmpty,
      executor: nonEmpty,
      runId: nonEmpty,
      session: nonEmpty,
      taskId: nonEmpty,
      taskRevision: nonEmpty,
      worktree: nonEmpty
    }),
    (fields) => {
      const encoded = {
        ...fields,
        baseSha: "0123456789abcdef0123456789abcdef01234567"
      }
      expect(
        Schema.encodeUnknownSync(PlannedTaskAttempt)(
          Schema.decodeUnknownSync(PlannedTaskAttempt)(encoded)
        )
      ).toEqual(encoded)
    }
  ))
})

it("rejects an empty executor or session locator at the plan boundary", () => {
  const encoded = {
    attemptId: "attempt",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "refs/heads/task",
    executor: "",
    runId: "run",
    session: "",
    taskId: "task",
    taskRevision: "revision",
    worktree: "/worktree"
  }
  expect(Schema.decodeUnknownResult(PlannedTaskAttempt)(encoded)._tag).toBe("Failure")
})

it("projects plan operation identity and rejects self-causality", () => {
  const operationId = OperationId.make("plan-operation")
  const plan = Schema.decodeUnknownSync(PlannedTaskAttempt)({
    attemptId: "attempt",
    baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
    branch: "refs/heads/task",
    executor: "executor",
    runId: "run",
    session: "session",
    taskId: "task",
    taskRevision: "revision",
    worktree: "/worktree"
  })
  const operation = makeTaskAttemptPlanOperation({
    operationId,
    plannedAttempt: plan,
    predecessorOperationIds: []
  })

  expect(workflowOperationId(operation)).toBe(operationId)
  expect(
    Schema.decodeUnknownResult(WorkflowOperation)({
      ...Schema.encodeUnknownSync(WorkflowOperation)(operation),
      predecessorOperationIds: [operationId]
    })._tag
  ).toBe("Failure")
})
