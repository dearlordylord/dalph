import { expect } from "vitest"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "../src/authorities/task-tracker/graph.js"

export const validSnapshot = (input: unknown): TaskDagSnapshot => {
  const result = projectTrackerSnapshot(input)
  if (result._tag === "Invalid") {
    return expect.fail(`invalid test snapshot: ${JSON.stringify(result.issues)}`)
  }
  return result.snapshot
}
