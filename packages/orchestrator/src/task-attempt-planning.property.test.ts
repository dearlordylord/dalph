import { it } from "@effect/vitest"
import { Effect, Encoding, Result, Schema } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  deterministicPlannedTaskAttemptLayer,
  GitCommitSha,
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation,
  OperationId,
  PlannedTaskAttempt,
  PlannedTaskAttemptPlanner,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  taskRevisionFor,
  TaskWorkSessionLocator,
  TrackerTask,
  WorkflowOperation,
  workflowOperationId,
  WorktreeLocator
} from "./index.js"
import { samePlannedTaskAttempt } from "./planned-task-attempt.js"

const nonEmpty = fc.string({ minLength: 1, maxLength: 40 })
const plannedTaskAttemptEncodedArbitrary = fc.record({
  attemptId: nonEmpty,
  branch: fc.stringMatching(/^refs\/heads\/[a-z]{1,20}$/),
  executor: nonEmpty,
  runId: nonEmpty,
  session: nonEmpty,
  taskId: nonEmpty,
  taskRevision: nonEmpty,
  worktree: nonEmpty
}).map((fields) => ({
  ...fields,
  baseSha: "0123456789abcdef0123456789abcdef01234567"
}))

it.each([
  "main",
  "refs/heads/",
  "refs/heads/a..b",
  "refs/heads/a//b",
  "refs/heads/a.lock",
  "refs/heads/a@{b",
  "refs/heads/.hidden",
  "refs/heads/trailing/",
  "refs/heads/trailing.",
  "refs/heads/space name",
  "refs/heads/caret^name"
])("rejects Git-invalid task branch ref %s", (branch) => {
  expect(() => Schema.decodeUnknownSync(TaskBranchRef)(branch)).toThrow()
})

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
    const plan = yield* planner.plan(task)
    const retryPlan = yield* planner.plan(task)

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

it("roundtrips arbitrary valid planned task attempts through the persisted Schema boundary", () => {
  fc.assert(fc.property(
    plannedTaskAttemptEncodedArbitrary,
    (encoded) => {
      expect(
        Schema.encodeUnknownSync(PlannedTaskAttempt)(
          Schema.decodeUnknownSync(PlannedTaskAttempt)(encoded)
        )
      ).toEqual(encoded)
    }
  ))
})

it("satisfies the planned-attempt equivalence laws for arbitrary valid plans", () => {
  const decode = Schema.decodeUnknownSync(PlannedTaskAttempt)
  const copy = (plan: PlannedTaskAttempt) => decode(Schema.encodeUnknownSync(PlannedTaskAttempt)(plan))

  fc.assert(fc.property(
    plannedTaskAttemptEncodedArbitrary,
    plannedTaskAttemptEncodedArbitrary,
    (leftEncoded, rightEncoded) => {
      const left = decode(leftEncoded)
      const right = decode(rightEncoded)
      const middle = copy(left)
      const end = copy(middle)

      expect(samePlannedTaskAttempt(left, left)).toBe(true)
      expect(samePlannedTaskAttempt(left, right))
        .toBe(samePlannedTaskAttempt(right, left))
      expect(
        samePlannedTaskAttempt(left, middle)
          && samePlannedTaskAttempt(middle, end)
      ).toBe(true)
      expect(samePlannedTaskAttempt(left, end)).toBe(true)
    }
  ))
})

it("derives the task revision (fingerprint) inside the planner", () =>
  Effect.gen(function*() {
    const task = Schema.decodeUnknownSync(TrackerTask)({
      id: "task-44",
      lifecycle: { _tag: "Open" },
      parentTaskId: null,
      prerequisiteIds: ["task-41", "task-43"]
    })
    const planner = yield* PlannedTaskAttemptPlanner

    expect((yield* planner.plan(task)).taskRevision).toBe(taskRevisionFor(task))
  }).pipe(Effect.provide(deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
    executor: TaskExecutorLocator.make("executor:deterministic"),
    runId: RunId.make("run-44"),
    sessionRoot: TaskWorkSessionLocator.make("sessions/run-44"),
    worktreeRoot: WorktreeLocator.make("/worktrees/run-44")
  }))))

it("keeps the task revision fingerprint opaque and diagnostically reversible", () => {
  const task = Schema.decodeUnknownSync(TrackerTask)({
    id: "task-44",
    lifecycle: { _tag: "Open" },
    parentTaskId: null,
    prerequisiteIds: ["task-43"]
  })
  const fingerprint = taskRevisionFor(task)

  expect(fingerprint.startsWith("tr1.")).toBe(true)
  expect(JSON.parse(Result.getOrThrow(
    Encoding.decodeBase64UrlString(fingerprint.slice("tr1.".length))
  ))).toEqual({
    id: "task-44",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["task-43"]
  })
})

it("changes a task revision (fingerprint) when any normalized task field changes", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/),
    (suffix) => {
      const task = (input: unknown) => Schema.decodeUnknownSync(TrackerTask)(input)
      const baseline = {
        id: `task-${suffix}-left`,
        lifecycle: { _tag: "Open" },
        parentTaskId: `parent-${suffix}-left`,
        prerequisiteIds: [`prerequisite-${suffix}-left`]
      }
      const baselineRevision = taskRevisionFor(task(baseline))
      const variants = [
        { ...baseline, id: `task-${suffix}-right` },
        { ...baseline, lifecycle: { _tag: "CompletedSuccessfully" } },
        { ...baseline, parentTaskId: `parent-${suffix}-right` },
        { ...baseline, prerequisiteIds: [`prerequisite-${suffix}-right`] }
      ]

      expect(variants.map((variant) => taskRevisionFor(task(variant))))
        .not.toContain(baselineRevision)
    }
  ))
})

it("makes task revision (fingerprint) independent of prerequisite order", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), { minLength: 1, maxLength: 8 }),
    (prerequisiteIds) => {
      const makeTask = (ids: ReadonlyArray<string>) =>
        Schema.decodeUnknownSync(TrackerTask)({
          id: "task-44",
          lifecycle: { _tag: "Open" },
          parentTaskId: null,
          prerequisiteIds: ids
        })
      expect(taskRevisionFor(makeTask(prerequisiteIds)))
        .toBe(taskRevisionFor(makeTask([...prerequisiteIds].reverse())))
    }
  ))
})

it("compares decoded plans structurally and observes every planned field", () => {
  const baseline = {
    attemptId: "attempt-1",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "refs/heads/task-1",
    executor: "executor-1",
    runId: "run-1",
    session: "session-1",
    taskId: "task-1",
    taskRevision: "revision-1",
    worktree: "/worktree-1"
  }
  const decode = Schema.decodeUnknownSync(PlannedTaskAttempt)
  const equalCopy = decode(Schema.encodeUnknownSync(PlannedTaskAttempt)(decode(baseline)))
  expect(samePlannedTaskAttempt(decode(baseline), equalCopy)).toBe(true)

  const variants = [
    { ...baseline, attemptId: "attempt-2" },
    { ...baseline, baseSha: "1123456789abcdef0123456789abcdef01234567" },
    { ...baseline, branch: "refs/heads/task-2" },
    { ...baseline, executor: "executor-2" },
    { ...baseline, runId: "run-2" },
    { ...baseline, session: "session-2" },
    { ...baseline, taskId: "task-2" },
    { ...baseline, taskRevision: "revision-2" },
    { ...baseline, worktree: "/worktree-2" }
  ]
  expect(variants.every((variant) => !samePlannedTaskAttempt(decode(baseline), decode(variant))))
    .toBe(true)
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

it("projects worktree operation identity and rejects self-causality", () => {
  const operationId = OperationId.make("worktree-operation")
  const plan = Schema.decodeUnknownSync(PlannedTaskAttempt)({
    attemptId: "attempt",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "refs/heads/task",
    executor: "executor",
    runId: "run",
    session: "session",
    taskId: "task",
    taskRevision: "revision",
    worktree: "/worktree"
  })
  const operation = makeTaskWorktreeReconciliationOperation({
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
