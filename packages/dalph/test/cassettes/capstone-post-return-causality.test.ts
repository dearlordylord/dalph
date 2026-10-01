import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { TaskId, AttemptId } from "@dalph/contracts"
import { FixtureTarget, OperationId } from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem, AuthoredCausalWindow } from "../../src/cassettes/authored-domain.js"
import { AuthoredCausalSelectionFailure, makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
const target = FixtureTarget.make("post-return")
const a = TaskId.make("A")
const b = TaskId.make("B")
const graph = { _tag: "ReadTrackerGraph" as const, target }
const spec = (taskId: TaskId) => ({ _tag: "ReadTaskWorkSpecification" as const, taskId })
const selection = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)
const story = [a, b].map((taskId) =>
  selection({
    _tag: "DalphSelects",
    causalAnchor: { occurrenceRole: `plan:${taskId}` },
    operation: { _tag: "RecordTaskAttemptPlan", taskId, attemptId: AttemptId.make(`attempt:${taskId}:0`) }
  })
)
story.push(selection({ _tag: "DalphSelects", operation: graph, causalAnchor: { occurrenceRole: "graph" } }))
for (const taskId of [a, b])
  story.push(
    selection({
      _tag: "DalphSelects",
      operation: spec(taskId),
      causal: { occurrenceRole: `spec:${taskId}`, predecessorRoles: [`plan:${taskId}`, "graph"] }
    })
  )
const window = Schema.decodeUnknownSync(AuthoredCausalWindow)({
  startIndex: 3,
  endIndex: 5,
  occurrences: [
    { id: "spec:A", storyIndex: 3, predecessorIds: [] },
    { id: "spec:B", storyIndex: 4, predecessorIds: [] }
  ]
})
const context = (id: string, predecessors: Array<string> = []) => ({
  operationId: OperationId.make(id),
  predecessorOperationIds: predecessors.map((value) => OperationId.make(value))
})
for (const order of [
  [a, b],
  [b, a]
])
  it.effect(`accepts authorized post-return specs ${order.join(" then ")}`, () =>
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor(story, { causalWindows: [window] })
      for (const taskId of [a, b])
        yield* cursor.consumeDalphSelectionFor(
          { _tag: "RecordTaskAttemptPlan", taskId, attemptId: AttemptId.make(`attempt:${taskId}:0`) },
          context(`plan:${taskId}`)
        )
      yield* cursor.consumeDalphSelectionFor(graph, context("graph"))
      for (const taskId of order)
        yield* cursor.consumeDalphSelectionFor(spec(taskId), context(`spec:${taskId}`, [`plan:${taskId}`, "graph"]))
      expect(yield* cursor.storyPosition).toBe(story.length)
    })
  )
it.effect("rejects B specification without the accepted graph predecessor", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(story, { causalWindows: [window] })
    for (const taskId of [a, b])
      yield* cursor.consumeDalphSelectionFor(
        { _tag: "RecordTaskAttemptPlan", taskId, attemptId: AttemptId.make(`attempt:${taskId}:0`) },
        context(`plan:${taskId}`)
      )
    yield* cursor.consumeDalphSelectionFor(graph, context("graph"))
    expect(yield* Effect.flip(cursor.consumeDalphSelectionFor(spec(b), context("spec:B", ["plan:B"])))).toBeInstanceOf(
      AuthoredCausalSelectionFailure
    )
  })
)

it.effect("bounds generalized continuation windows before control and lifecycle barriers", () =>
  Effect.gen(function* () {
    const { deliveryStoryCapstoneAuthoredCassette: cassette } = yield* Effect.promise(
      () => import("../../src/cassettes/delivery-story-capstone.js")
    )
    const windows = (cassette.causalWindows?.slice(1) ?? []).filter((window) =>
      window.occurrences.some((node) => String(node.id).startsWith("continuation-"))
    )
    expect(
      windows.filter((window) => window.occurrences.some((node) => String(node.id).startsWith("continuation-")))
    ).toHaveLength(5)
    expect(
      windows.map((window) => {
        const tasks = window.occurrences.flatMap((node) => {
          const item = cassette.story[node.storyIndex]
          return item?._tag === "DalphSelects" && item.operation._tag === "ReadTaskWorkSpecification"
            ? [item.operation.taskId]
            : []
        })
        const barrier = cassette.story[window.endIndex]
        expect([
          "PlannedAttemptExecutorWorkReported",
          "CoordinatorActivationReturned",
          "PlannedAttemptExecutorPassiveLifecycleChanged"
        ]).toContain(barrier?._tag)
        return tasks
      })
    ).toEqual([["A", "B", "C"], ["A", "D"], ["B", "D"], ["C"], ["B", "C", "D"]])
  })
)

it.effect(
  "rejects successor reconciliation before A terminal and accepts its exact Begin across independent graph reads",
  () =>
    Effect.gen(function* () {
      const { deliveryStoryCapstoneAuthoredCassette: cassette } = yield* Effect.promise(
        () => import("../../src/cassettes/delivery-story-capstone.js")
      )
      const window = cassette.causalWindows?.find((candidate) =>
        candidate.occurrences.some((node) => node.directGraphRole === "B-restart-authority")
      )
      if (window === undefined) return yield* Effect.die("Restart window absent")
      const localStory = cassette.story.slice(window.startIndex, window.endIndex)
      const localWindow = yield* Schema.decodeUnknownEffect(AuthoredCausalWindow)({
        ...window,
        startIndex: 0,
        endIndex: localStory.length,
        occurrences: window.occurrences.map((node) => ({ ...node, storyIndex: node.storyIndex - window.startIndex }))
      })
      const cursor = yield* makeStoryCursor(localStory, { causalWindows: [localWindow] })
      const acceptedRole = localWindow.occurrences.flatMap((node) => node.acceptedPlanPredecessorRoles ?? [])[0]
      if (acceptedRole === undefined) return yield* Effect.die("exact accepted successor prerequisite absent")
      yield* cursor.registerAcceptedReplacementPlan(acceptedRole, {
        operationId: OperationId.make("accepted-B-successor-plan"),
        predecessorOperationIds: []
      })
      const reconcile = {
        _tag: "ReconcileTaskWorktree" as const,
        taskId: TaskId.make("B"),
        attemptId: AttemptId.make("attempt:B:replacement:1")
      }
      const reconcileContext = {
        operationId: OperationId.make("B-successor-reconcile"),
        predecessorOperationIds: [OperationId.make("accepted-B-successor-plan")]
      }
      expect(yield* Effect.flip(cursor.consumeDalphSelectionFor(reconcile, reconcileContext))).toBeInstanceOf(
        AuthoredCausalSelectionFailure
      )
      // Consume the real direct Restart responses before the exact barrier item.
      for (const node of localWindow.occurrences) {
        const item = localStory[node.storyIndex]
        if (node.directGraphRole !== undefined) {
          yield* cursor.consumeTrackerGraphFor(FixtureTarget.make("delivery-capstone-target"), {
            operationId: OperationId.make(node.directGraphRole),
            predecessorOperationIds: [],
            graphReadCause: "AttemptRestartAuthorityCheck",
            graphReadExplicitTaskIds: [TaskId.make("B")]
          })
        } else if (node.directFocusedRead !== undefined) {
          const direct = node.directFocusedRead
          const context = {
            operationId: OperationId.make(direct.role),
            predecessorOperationIds: direct.predecessorRoles.map((role) => OperationId.make(role)),
            operationKind: direct.kind,
            taskId: direct.taskId
          }
          if (direct.kind === "ReadTaskWorkSpecification")
            yield* cursor.consumeTaskWorkSpecificationFor(direct.taskId, context)
          else yield* cursor.consumeTaskClaimReadFor(direct.taskId, context)
        } else if (node.directGitRead !== undefined) {
          const direct = node.directGitRead
          const context = {
            operationId: OperationId.make(direct.role),
            predecessorOperationIds: direct.predecessorRoles.map((role) => OperationId.make(role)),
            operationKind: direct.kind,
            taskId: direct.taskId,
            attemptId: direct.attemptId
          }
          if (item?._tag === "DirectGitWorktreeReadReturned")
            yield* cursor.observeDirectGitWorktreeResult(direct.taskId, direct.attemptId, item.observation, context)
          else if (item?._tag === "DirectGitTargetLineageReadReturned")
            yield* cursor.observeDirectGitTargetLineageResult(
              direct.taskId,
              direct.attemptId,
              item.observation,
              context
            )
        }
      }
      const barrier = yield* cursor.consumeFreshAttemptCapacityPublication
      expect(barrier).toMatchObject({
        taskId: "B",
        heldPassiveAttemptId: "attempt:A:0",
        graphRevision: "G2",
        capacity: 2
      })
      yield* cursor.completeFreshAttemptCapacityPublication(AttemptId.make("attempt:A:0"))
      const queueHold = yield* cursor.consumeAcceptedResultQueueHold
      expect(queueHold).toMatchObject({ queuedAttemptId: "attempt:A:0", releasedByAttemptId: reconcile.attemptId })
      const terminal = yield* cursor.consumePassiveExecutorLifecycleChangeFor(AttemptId.make("attempt:A:0"))
      expect(terminal._tag).toBe("Some")
      yield* cursor.consumeDalphSelectionFor(reconcile, reconcileContext)
      const begin = yield* cursor.consumeExecutorReportFor("Begin", reconcile.attemptId)
      expect(begin).toMatchObject({
        request: "Begin",
        report: { attemptId: reconcile.attemptId, _tag: "ExecutorWorkExecuting" }
      })
      expect(yield* cursor.storyPosition).toBe(localStory.length)
    })
)

it.effect("retains C continuation authority across the capacity marker and rejects the later independent graph", () =>
  Effect.gen(function* () {
    const { deliveryStoryCapstoneAuthoredCassette: cassette } = yield* Effect.promise(
      () => import("../../src/cassettes/delivery-story-capstone.js")
    )
    const markerIndex = cassette.story.findIndex(
      (item) => item._tag === "CassetteAwaitsSafeContinuationRevalidationPublication"
    )
    const authority = cassette.story[markerIndex - 2]
    const nextSpec = cassette.story
      .slice(markerIndex)
      .find(
        (item) =>
          item._tag === "DalphSelects" &&
          item.operation._tag === "ReadTaskWorkSpecification" &&
          item.operation.taskId === "C"
      )
    expect(authority?._tag).toBe("DalphSelects")
    expect(nextSpec?._tag).toBe("DalphSelects")
    if (authority?._tag !== "DalphSelects" || nextSpec?._tag !== "DalphSelects") return
    expect(nextSpec.causal?.predecessorRoles).toContain(authority.causalAnchor?.occurrenceRole)
    const plan = cassette.story.find(
      (item) =>
        item._tag === "DalphSelects" && item.operation._tag === "RecordTaskAttemptPlan" && item.operation.taskId === "C"
    )
    if (plan?._tag !== "DalphSelects") return
    const planRole = nextSpec.causal?.predecessorRoles.find((role) => role !== authority.causalAnchor?.occurrenceRole)
    const controlledStory = yield* Schema.decodeUnknownEffect(Schema.Array(AuthoredCassetteStoryItem))([
      { ...plan, causalAnchor: { occurrenceRole: planRole } },
      authority,
      nextSpec
    ])
    for (const wrongGraph of [true, false]) {
      const cursor = yield* makeStoryCursor(controlledStory)
      const planContext = context("accepted:C:plan")
      const authorityContext = context("continuation:C:graph", ["accepted:C:plan"])
      yield* cursor.consumeDalphSelectionFor(plan.operation, planContext)
      yield* cursor.consumeDalphSelectionFor(authority.operation, authorityContext)
      const read = cursor.consumeDalphSelectionFor(
        nextSpec.operation,
        context("C:spec", ["accepted:C:plan", wrongGraph ? "independent:graph" : "continuation:C:graph"])
      )
      if (wrongGraph) expect(yield* Effect.flip(read)).toBeInstanceOf(AuthoredCausalSelectionFailure)
      else yield* read
    }
  })
)

it.effect("keeps B finality authority before claim replacement and continues with focused completion afterward", () =>
  Effect.gen(function* () {
    const { deliveryStoryCapstoneAuthoredCassette: cassette } = yield* Effect.promise(
      () => import("../../src/cassettes/delivery-story-capstone.js")
    )
    const replacement = cassette.story.findIndex(
      (item) => item._tag === "CompletionClaimReplacementApplied" && item.taskId === "B"
    )
    expect(replacement).toBeGreaterThan(0)
    expect(cassette.story[replacement + 1]?._tag).toBe("CompletionTaskFocusedReadReturned")
    const before = cassette.story.slice(0, replacement)
    const lastClaim = before.at(-1)
    expect(lastClaim).toMatchObject({ _tag: "TaskClaimCurrentReadReturned", taskId: "B" })
    expect(
      before.some(
        (item) =>
          item._tag === "TaskWorkSpecificationReadReturned" && item.taskId === "B" && item.title === "Implement B F2"
      )
    ).toBe(true)
  })
)
