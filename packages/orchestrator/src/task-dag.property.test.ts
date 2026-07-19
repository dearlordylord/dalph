import * as fc from "fast-check"
import { expect, it } from "vitest"
import { TaskId } from "./domain.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "./task-dag.js"

const open = { _tag: "Open" } as const

const validSnapshot = (input: unknown): TaskDagSnapshot => {
  const result = projectTrackerSnapshot(input)
  if (result._tag === "Invalid") {
    return expect.fail(`invalid test snapshot: ${JSON.stringify(result.issues)}`)
  }
  return result.snapshot
}

const dagSnapshotArbitrary = fc.integer({ min: 0, max: 8 }).chain((taskCount) => {
  const possibleEdgeCount = (taskCount * (taskCount - 1)) / 2
  return fc
    .array(fc.boolean(), {
      minLength: possibleEdgeCount,
      maxLength: possibleEdgeCount
    })
    .map((edges) => {
      let edgeIndex = 0
      return {
        revision: "bounded-property-v1",
        tasks: Array.from({ length: taskCount }, (_, dependantIndex) => {
          const prerequisiteIds: Array<string> = []
          for (
            let prerequisiteIndex = 0;
            prerequisiteIndex < dependantIndex;
            prerequisiteIndex++
          ) {
            if (edges[edgeIndex] === true) {
              prerequisiteIds.push(`task-${prerequisiteIndex}`)
            }
            edgeIndex++
          }
          return {
            id: `task-${dependantIndex}`,
            lifecycle: open,
            parentTaskId: null,
            prerequisiteIds
          }
        })
      }
    })
})

it("preserves canonical construction and traversal laws across bounded DAGs", () => {
  fc.assert(
    fc.property(dagSnapshotArbitrary, (wire) => {
      const graph = validSnapshot(wire)
      const reversed = validSnapshot({
        ...wire,
        tasks: [...wire.tasks].reverse()
      })
      const roundTripped = validSnapshot(JSON.parse(graph.canonicalJson()))
      const positions = new Map(
        graph.topologicalOrder().map((taskId, position) => [taskId, position])
      )

      expect(graph.taskIds()).toEqual(wire.tasks.map((task) => task.id))
      expect(reversed.canonicalJson()).toBe(graph.canonicalJson())
      expect(roundTripped.canonicalJson()).toBe(graph.canonicalJson())
      for (const task of wire.tasks) {
        const dependantPosition = positions.get(TaskId.make(task.id))
        expect(dependantPosition).toBeDefined()
        if (dependantPosition === undefined) return
        for (const prerequisite of task.prerequisiteIds) {
          expect(positions.get(TaskId.make(prerequisite))).toBeLessThan(
            dependantPosition
          )
        }
      }
    }),
    { numRuns: 100 }
  )
})
