import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import { FixtureTarget, OperationId } from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem, AuthoredCausalWindow } from "../../src/cassettes/authored-domain.js"
import { AuthoredCausalSelectionFailure, makeStoryCursor } from "../../src/cassettes/authored-cursor.js"

const taskId = TaskId.make("A")
const target = FixtureTarget.make("capstone-entry")
const claim = { _tag: "AcquireTaskClaim" as const, taskId }
const graph = { _tag: "ReadTrackerGraph" as const, target }
const story = [claim, graph].map((operation) =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
    operation._tag === "ReadTrackerGraph"
      ? { _tag: "DalphSelects", operation, causal: { occurrenceRole: "empty-graph", predecessorRoles: [] } }
      : { _tag: "DalphSelects", operation }
  )
)
const window = Schema.decodeUnknownSync(AuthoredCausalWindow)({
  startIndex: 0,
  endIndex: 2,
  occurrences: [
    { id: "claim", storyIndex: 0, predecessorIds: [] },
    {
      id: "empty-graph",
      storyIndex: 1,
      predecessorIds: [],
      graphReadCause: "WorkflowEstablishment",
      graphReadExplicitTaskIds: []
    }
  ]
})
const claimContext = { operationId: OperationId.make("claim:A"), predecessorOperationIds: [] }
const graphContext = {
  operationId: OperationId.make("graph:empty"),
  predecessorOperationIds: [],
  graphReadCause: "WorkflowEstablishment" as const,
  graphReadExplicitTaskIds: []
}
for (const graphFirst of [true, false]) {
  it.effect(`accepts independent empty-task graph ${graphFirst ? "before" : "after"} A claim`, () =>
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor(story, { causalWindows: [window] })
      if (graphFirst) {
        yield* cursor.consumeDalphSelectionFor(graph, graphContext)
        yield* cursor.consumeDalphSelectionFor(claim, claimContext)
      } else {
        yield* cursor.consumeDalphSelectionFor(claim, claimContext)
        yield* cursor.consumeDalphSelectionFor(graph, graphContext)
      }
      expect(yield* cursor.storyPosition).toBe(story.length)
    })
  )
}
it.effect("rejects a fabricated claim predecessor on the independent empty-task graph", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(story, { causalWindows: [window] })
    yield* cursor.consumeDalphSelectionFor(claim, claimContext)
    const failure = yield* Effect.flip(
      cursor.consumeDalphSelectionFor(graph, { ...graphContext, predecessorOperationIds: [claimContext.operationId] })
    )
    expect(failure).toBeInstanceOf(AuthoredCausalSelectionFailure)
  })
)

it.effect("assigns exact read owners without assigning read owners to entry executor reports", () =>
  Effect.gen(function* () {
    const { deliveryStoryCapstoneAuthoredCassette } = yield* Effect.promise(
      () => import("../../src/cassettes/delivery-story-capstone.js")
    )
    const window = deliveryStoryCapstoneAuthoredCassette.causalWindows?.[0]
    expect(window).toBeDefined()
    for (const node of window?.occurrences ?? []) {
      const item = deliveryStoryCapstoneAuthoredCassette.story[node.storyIndex]
      if (item?._tag === "PlannedAttemptExecutorWorkReported") {
        expect(node.ownerRole).toBeUndefined()
        expect(node.predecessorIds).toHaveLength(1)
      }
      if (item?._tag === "TrackerGraphReadReturned" || item?._tag === "TaskWorkSpecificationReadReturned") {
        expect(node.ownerRole).toBeDefined()
        const owner = window?.occurrences.find((candidate) => candidate.id === node.ownerRole)
        const selected = owner === undefined ? undefined : deliveryStoryCapstoneAuthoredCassette.story[owner.storyIndex]
        expect(selected?._tag).toBe("DalphSelects")
        if (selected?._tag === "DalphSelects") {
          expect(selected.operation._tag).toBe(
            item._tag === "TrackerGraphReadReturned" ? "ReadTrackerGraph" : "ReadTaskWorkSpecification"
          )
        }
      }
    }
  })
)

it.effect("declares exact graph roles and claim predecessors for every entry graph", () =>
  Effect.gen(function* () {
    const { deliveryStoryCapstoneAuthoredCassette: cassette } = yield* Effect.promise(
      () => import("../../src/cassettes/delivery-story-capstone.js")
    )
    const window = cassette.causalWindows?.[0]
    const graphNodes = (window?.occurrences ?? []).filter((node) => {
      const item = cassette.story[node.storyIndex]
      return item?._tag === "DalphSelects" && item.operation._tag === "ReadTrackerGraph"
    })
    expect(
      graphNodes.map((node) => [node.id, node.graphReadCause, node.graphReadExplicitTaskIds, node.predecessorIds])
    ).toEqual([
      ["A-establishment", "WorkflowEstablishment", ["A"], []],
      ["B-establishment", "WorkflowEstablishment", ["B"], []],
      ["C-establishment", "WorkflowEstablishment", ["C"], []],
      ["empty-establishment", "WorkflowEstablishment", [], []],
      ["A-post-claim", "WorkflowEstablishment", ["A"], ["entry-12"]],
      ["C-post-claim", "WorkflowEstablishment", ["C"], ["entry-19"]],
      ["B-post-claim", "WorkflowEstablishment", ["B"], ["entry-23"]]
    ])
    for (const node of graphNodes.filter((node) => node.predecessorIds.length > 0)) {
      const predecessor = window?.occurrences.find((candidate) => candidate.id === node.predecessorIds[0])
      const item = predecessor === undefined ? undefined : cassette.story[predecessor.storyIndex]
      expect(item?._tag).toBe("DalphSelects")
      if (item?._tag === "DalphSelects")
        expect(item.operation).toMatchObject({ _tag: "AcquireTaskClaim", taskId: node.graphReadExplicitTaskIds?.[0] })
    }
  })
)
