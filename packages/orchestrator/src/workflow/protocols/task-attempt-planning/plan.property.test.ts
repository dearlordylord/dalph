import { it } from "@effect/vitest"
import { Effect, Encoding, Result, Schema } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import { validSnapshot } from "../../../../test/task-dag.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  deterministicPlannedTaskAttemptLayer,
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation,
  OperationId,
  PlannedTaskAttemptOrdinal,
  PlannedTaskAttemptPlanRequest,
  PlannedTaskAttemptPlanner,
  taskRevisionFor,
  TrackerTask,
  WorkflowOperation,
  workflowOperationId
} from "../../../index.js"

it.effect("binds every exact attempt identity and resource locator", () =>
  Effect.gen(function* () {
    const snapshot = validSnapshot({
      revision: "attempt-plan-snapshot",
      tasks: [{ id: "task-44", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    const task = snapshot.eligibleTasks()[0]
    if (task === undefined) return expect.fail("expected one eligible task")
    const specification = makeTaskWorkSpecification({
      body: "Implement the planned task",
      taskId: task.id,
      title: "Planned task"
    })
    const taskRevision = specification.fingerprint

    const planner = yield* PlannedTaskAttemptPlanner
    const plan = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification }))
    const retryPlan = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification }))

    expect(plan).toEqual({
      attemptId: AttemptId.make("attempt:task-44:0"),
      baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
      branch: "refs/heads/dalph/attempt-task-44-0",
      executor: "executor:deterministic",
      runId: "run-44",
      taskId: "task-44",
      taskRevision,
      worktree: "/worktrees/run-44/attempt-task-44-0"
    })
    expect(retryPlan.attemptId).not.toBe(plan.attemptId)
    expect(retryPlan.branch).not.toBe(plan.branch)
    expect(retryPlan.worktree).not.toBe(plan.worktree)
  }).pipe(
    Effect.provide(
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
        executor: TaskExecutorLocator.make("executor:deterministic"),
        runId: RunId.make("run-44"),
        worktreeRoot: WorktreeLocator.make("/worktrees/run-44")
      })
    )
  )
)

it.effect("keeps exact replacement Base SHA and ordinal in one indivisible planning request", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10_000 }), async (selectedOrdinal) => {
        const specification = makeTaskWorkSpecification({
          body: "Replacement body",
          taskId: TaskId.make("task-44"),
          title: "Replacement title"
        })
        const selectedBaseSha = GitCommitSha.make(selectedOrdinal.toString(16).padStart(40, "0"))
        const [replacement, fresh] = await Effect.runPromise(
          Effect.gen(function* () {
            const planner = yield* PlannedTaskAttemptPlanner
            const replacement = yield* planner.plan(
              PlannedTaskAttemptPlanRequest.ExactReplacement({
                baseSha: selectedBaseSha,
                ordinal: PlannedTaskAttemptOrdinal.make(selectedOrdinal),
                specification
              })
            )
            const fresh = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification }))
            return [replacement, fresh] as const
          }).pipe(
            Effect.provide(
              deterministicPlannedTaskAttemptLayer({
                baseSha: GitCommitSha.make("f".repeat(40)),
                executor: TaskExecutorLocator.make("executor:deterministic"),
                runId: RunId.make("run-44"),
                worktreeRoot: WorktreeLocator.make("/worktrees/run-44")
              })
            )
          )
        )

        expect(replacement).toMatchObject({
          attemptId: AttemptId.make(`attempt:task-44:${selectedOrdinal}`),
          baseSha: selectedBaseSha,
          branch: `refs/heads/dalph/attempt-task-44-${selectedOrdinal}`,
          worktree: `/worktrees/run-44/attempt-task-44-${selectedOrdinal}`
        })
        expect(fresh.attemptId).toBe(AttemptId.make(`attempt:task-44:${selectedOrdinal + 1}`))
      })
    )
  )
)

it("binds the focused task-work-specification fingerprint inside the planner", () =>
  Effect.gen(function* () {
    const task = Schema.decodeUnknownSync(TrackerTask)({
      id: "task-44",
      lifecycle: { _tag: "Open" },
      parentTaskId: null,
      prerequisiteIds: ["task-41", "task-43"]
    })
    const specification = makeTaskWorkSpecification({ body: "Exact body", taskId: task.id, title: "Exact title" })
    const planner = yield* PlannedTaskAttemptPlanner

    expect((yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification }))).taskRevision).toBe(
      specification.fingerprint
    )
  }).pipe(
    Effect.provide(
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
        executor: TaskExecutorLocator.make("executor:deterministic"),
        runId: RunId.make("run-44"),
        worktreeRoot: WorktreeLocator.make("/worktrees/run-44")
      })
    )
  ))

it("keeps the task revision fingerprint opaque and diagnostically reversible", () => {
  const task = Schema.decodeUnknownSync(TrackerTask)({
    id: "task-44",
    lifecycle: { _tag: "Open" },
    parentTaskId: null,
    prerequisiteIds: ["task-43"]
  })
  const fingerprint = taskRevisionFor(task)

  expect(fingerprint.startsWith("tr1.")).toBe(true)
  expect(JSON.parse(Result.getOrThrow(Encoding.decodeBase64UrlString(fingerprint.slice("tr1.".length))))).toEqual({
    id: "task-44",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["task-43"]
  })
})

it("changes a task revision (fingerprint) when any normalized task field changes", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), (suffix) => {
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

      expect(variants.map((variant) => taskRevisionFor(task(variant)))).not.toContain(baselineRevision)
    })
  )
})

it("makes task revision (fingerprint) independent of prerequisite order", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), { minLength: 1, maxLength: 8 }),
      (prerequisiteIds) => {
        const makeTask = (ids: ReadonlyArray<string>) =>
          Schema.decodeUnknownSync(TrackerTask)({
            id: "task-44",
            lifecycle: { _tag: "Open" },
            parentTaskId: null,
            prerequisiteIds: ids
          })
        expect(taskRevisionFor(makeTask(prerequisiteIds))).toBe(
          taskRevisionFor(makeTask([...prerequisiteIds].reverse()))
        )
      }
    )
  )
})

it("projects plan operation identity and rejects self-causality", () => {
  const operationId = OperationId.make("plan-operation")
  const plan = Schema.decodeUnknownSync(PlannedTaskAttempt)({
    attemptId: "attempt",
    baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
    branch: "refs/heads/task",
    executor: "executor",
    runId: "run",
    taskId: "task",
    taskRevision: "revision",
    worktree: "/worktree"
  })
  const operation = makeTaskAttemptPlanOperation({ operationId, plannedAttempt: plan, predecessorOperationIds: [] })

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
