/* eslint-disable import/no-nodejs-modules -- This file also guards the accepted literal source shape. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Exit, Schema, Stream } from "effect"
import { expect } from "vitest"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import { delivery } from "./delivery.js"
import { currentSignalOf, PlannedAttemptExecutorTerminalEvidence, TrackerGraphState } from "./relations.js"
import { makeInMemoryDeliveryRelationsLayer } from "./in-memory-relations.js"

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})

const acceptedGraph = (revision: string, taskIds: ReadonlyArray<TaskId> = []) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(revision),
      tasks: taskIds.map((id) => ({
        id,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }))
    })
  )
  if (projected._tag === "Invalid") return expect.fail("test graph must be valid")
  return projected.snapshot
}

const exactAttemptEvidence = (taskId: TaskId) => ({
  _tag: "ResponsibilityFacts" as const,
  facts: {
    _tag: "PlannedAttemptExecutorFreshFacts" as const,
    disposition: ResponsibilityDisposition.Ready(),
    responsibility: {
      _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
      beganAt: JournalPosition.make(2),
      plannedAttempt: PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`attempt:${taskId}`),
        baseSha: GitCommitSha.make("1".repeat(40)),
        branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
        executor: TaskExecutorLocator.make("executor:fake"),
        runId: RunId.make("run-reactive-delivery"),
        taskId,
        taskRevision: TaskRevision.make(`revision:${taskId}`),
        worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
      })
    }
  }
})
it.effect("assembles the literal delivery relation with honestly empty settlements", () =>
  Effect.gen(function* () {
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.current.changes))
    const second = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(first[0]?.source.source.deliveries).toEqual([])
    expect(first[0]?.source.settlements).toEqual([])
  })
)

it.effect("rejects nonterminal executor reports as terminal delivery evidence", () =>
  Effect.gen(function* () {
    const correlation = { attemptId: AttemptId.make("attempt-A"), runId: RunId.make("run-A") }
    const reports = [
      PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    ]

    for (const report of reports) {
      const decoded = yield* Effect.exit(
        Schema.decodeUnknownEffect(PlannedAttemptExecutorTerminalEvidence)({
          _tag: "PlannedAttemptExecutorTerminal",
          report
        })
      )
      expect(Exit.isFailure(decoded)).toBe(true)
    }
  })
)

it.effect("keeps every descriptive subscription action-free", () =>
  Effect.gen(function* () {
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))
    const second = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))

    expect(first).toEqual([[]])
    expect(second).toEqual(first)
  })
)

it.effect("keeps empty settlements action-free after reconstructing the relation on restart", () =>
  Effect.gen(function* () {
    const input = {
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    }
    const evaluate = Effect.gen(function* () {
      const relation = yield* delivery.pipe(Effect.provide(makeInMemoryDeliveryRelationsLayer(input)))
      return {
        actions: Array.from(yield* Stream.runCollect(relation.proposedActions.changes)),
        current: Array.from(yield* Stream.runCollect(relation.current.changes))
      }
    })

    const beforeStop = yield* evaluate
    const afterRestart = yield* evaluate

    expect(beforeStop.actions).toEqual([[]])
    expect(afterRestart).toEqual(beforeStop)
    expect(afterRestart.current[0]?.source.settlements).toEqual([])
  })
)

it.effect("preserves each causal graph revision through final reflection", () =>
  Effect.gen(function* () {
    const graphOne = TrackerGraphState.cases.GraphEstablished.make({ snapshot: acceptedGraph("graph-1") })
    const graphTwo = TrackerGraphState.cases.GraphEstablished.make({ snapshot: acceptedGraph("graph-2") })
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: { changes: Stream.fromIterable([graphOne, graphTwo]) },
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ source }) => source.source.source.source.source)).toEqual([graphOne, graphTwo])
  })
)

it.effect("recomputes the same flat relation when the current policy changes", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const capacityTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: currentSignalOf(
        TrackerGraphState.cases.GraphEstablished.make({ snapshot: acceptedGraph("graph-policy", [taskA, taskB]) })
      ),
      exactEvidence: currentSignalOf([]),
      policy: { changes: Stream.make(policy, capacityTwo).pipe(Stream.rechunk(1)) }
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ source }) => source.source.deliveries.map(({ taskId }) => taskId))).toEqual([
      [taskA],
      [taskA, taskB]
    ])
  })
)

it.effect("recomputes the same flat relation when exact responsibility evidence changes", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: currentSignalOf(
        TrackerGraphState.cases.GraphEstablished.make({ snapshot: acceptedGraph("graph-evidence", [taskA, taskB]) })
      ),
      exactEvidence: { changes: Stream.make([], [exactAttemptEvidence(taskB)]).pipe(Stream.rechunk(1)) },
      policy: currentSignalOf(policy)
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ source }) => source.source.deliveries.map(({ taskId }) => taskId))).toEqual([
      [taskA],
      [taskA, taskB]
    ])
    expect(reflections[1]?.source.source.deliveries.find(({ taskId }) => taskId === taskB)?.placement._tag).toBe(
      "EligibleOutsideBound"
    )
  })
)

it("keeps the production delivery Effect flat and free of runtime-coloured coordination", () => {
  const deliverySource = readFileSync(fileURLToPath(new URL("./delivery.ts", import.meta.url)), "utf8")
  const relationSource = readFileSync(fileURLToPath(new URL("./relations.ts", import.meta.url)), "utf8")
  const projectionSource = readFileSync(
    fileURLToPath(new URL("./ticket-delivery-projection.ts", import.meta.url)),
    "utf8"
  )

  const outerEffect = deliverySource.slice(deliverySource.indexOf("export const delivery"))
  expect(outerEffect).toBe(`export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
`)

  const completeDeliverySource = `${deliverySource}\n${relationSource}\n${projectionSource}`
  const importedModules = Array.from(
    deliverySource.matchAll(/^import\s+(?:(?:.|\n)*?\s+from\s+)?"([^"]+)"\s*$/gm),
    ([, moduleName]) => moduleName
  )
  expect(importedModules).toEqual(["effect", "./relations.js", "./ticket-delivery-projection.js"])
  expect(completeDeliverySource).not.toMatch(
    /\b(?:JournalStore|WorkflowInterpreter|RunRecoveryActivation|TaskAdmissionController|makeActivationCoordinator|Queue|Ref|Semaphore|fork|runDeliveryActivation)\b/
  )
  expect(projectionSource).not.toMatch(/coordination\/(?:admission|frontier|run)/)
})
