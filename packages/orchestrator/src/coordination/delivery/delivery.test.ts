/* eslint-disable import/no-nodejs-modules -- This file also guards the accepted literal source shape. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
  RunId,
  TaskId
} from "@dalph/contracts"
import { Effect, Exit, Schema, Stream } from "effect"
import { expect } from "vitest"
import { TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { delivery } from "./delivery.js"
import {
  currentSignalOf,
  makeInMemoryDeliveryRelationsLayer,
  PlannedAttemptExecutorTerminalEvidence,
  TrackerGraphState,
  type TicketDelivery
} from "./relations.js"

const taskA = TaskId.make("task-A")
const terminalReport = PlannedAttemptExecutorReport.cases.Terminal.make({
  correlation: { attemptId: AttemptId.make("attempt-A"), runId: RunId.make("run-A") },
  result: PlannedAttemptExecutorResult.cases.Accepted.make({
    acceptedResult: { commit: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567") }
  })
})
const terminalDelivery: TicketDelivery = {
  _tag: "TicketDelivery",
  evidence: [PlannedAttemptExecutorTerminalEvidence.make({ report: terminalReport })],
  taskId: taskA
}

it.effect("assembles the literal delivery relation without treating executor Terminal as settlement", () =>
  Effect.gen(function* () {
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      executorResponsibilities: () => [terminalDelivery]
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.current.changes))
    const second = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(first[0]?.source.source.deliveries).toEqual([terminalDelivery])
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
      executorResponsibilities: () => [terminalDelivery]
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))
    const second = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))

    expect(first).toEqual([[]])
    expect(second).toEqual(first)
  })
)

it.effect("preserves each causal graph revision through final reflection", () =>
  Effect.gen(function* () {
    const graphOne = TrackerGraphState.cases.GraphEstablished.make({
      snapshot: TrackerSnapshot.make({ revision: TrackerRevision.make("graph-1"), tasks: [] })
    })
    const graphTwo = TrackerGraphState.cases.GraphEstablished.make({
      snapshot: TrackerSnapshot.make({ revision: TrackerRevision.make("graph-2"), tasks: [] })
    })
    const layer = makeInMemoryDeliveryRelationsLayer({
      graph: { changes: Stream.fromIterable([graphOne, graphTwo]) },
      executorResponsibilities: () => []
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ source }) => source.source.source.source.source)).toEqual([graphOne, graphTwo])
  })
)

it("keeps the production delivery Effect flat and free of runtime-coloured coordination", () => {
  const deliverySource = readFileSync(fileURLToPath(new URL("./delivery.ts", import.meta.url)), "utf8")
  const relationSource = readFileSync(fileURLToPath(new URL("./relations.ts", import.meta.url)), "utf8")

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

  const completeDeliverySource = `${deliverySource}\n${relationSource}`
  const importedModules = Array.from(
    completeDeliverySource.matchAll(/^import\s+(?:(?:.|\n)*?\s+from\s+)?"([^"]+)"\s*$/gm),
    ([, moduleName]) => moduleName
  )
  expect(importedModules).toEqual([
    "effect",
    "./relations.js",
    "@dalph/contracts",
    "effect",
    "../../authorities/task-tracker/task.js"
  ])
  expect(completeDeliverySource).not.toMatch(
    /\b(?:JournalStore|WorkflowInterpreter|RunRecoveryActivation|makeActivationCoordinator|Queue|Ref|Semaphore|fork|runDeliveryActivation)\b/
  )
})
