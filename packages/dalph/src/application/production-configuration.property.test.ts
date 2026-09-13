import { RunId, TaskId } from "@dalph/contracts"
import { PlannedTaskAttemptOrdinal } from "@dalph/orchestrator"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  ProductionPlannedAttemptWorktreeRoot,
  deriveProductionPlannedAttemptLocations
} from "./production-configuration.js"

const root = ProductionPlannedAttemptWorktreeRoot.make("/srv/dalph/planned-attempts")

it("recovers every generated scalar-Unicode tuple and keeps extended ordinal leaves disjoint", () => {
  const scalarText = fc
    .array(fc.constantFrom("a", "Z", "0", "-", "/", ":", "?", "*", "\\", "雪", "é", "😀"), {
      minLength: 1,
      maxLength: 150
    })
    .map((characters) => characters.join(""))
  fc.assert(
    fc.property(scalarText, scalarText, fc.integer({ min: 0, max: 1000 }), (run, task, ordinal) => {
      const locations = deriveProductionPlannedAttemptLocations(
        root,
        RunId.make(run),
        TaskId.make(task),
        PlannedTaskAttemptOrdinal.make(ordinal)
      )
      const components = locations.worktree.slice(`${root}/`.length).split("/")
      expect(components.at(-1)).toBe("_leaf")
      const payloads = components.slice(0, -1)
      expect(payloads.every((part) => /^part-[a-z0-9-]{1,128}$/.test(part))).toBe(true)
      expect(payloads.slice(0, -1).every((part) => part.length === 133)).toBe(true)
      expect(payloads.map((part) => part.slice("part-".length)).join("")).toBe(
        locations.attemptId.slice("attempt:".length)
      )
      expect(locations.branch).toBe(`refs/heads/dalph/${components.join("/")}`)
      expect(locations.worktree.startsWith(`${root}/part-`)).toBe(true)
      const first = deriveProductionPlannedAttemptLocations(
        root,
        RunId.make(run),
        TaskId.make(task),
        PlannedTaskAttemptOrdinal.make(1)
      )
      const extended = deriveProductionPlannedAttemptLocations(
        root,
        RunId.make(run),
        TaskId.make(task),
        PlannedTaskAttemptOrdinal.make(10)
      )
      expect(extended.attemptId).toBe(`${first.attemptId}0`)
      expect(extended.worktree.startsWith(`${first.worktree}/`)).toBe(false)
      expect(first.worktree.startsWith(`${extended.worktree}/`)).toBe(false)
      expect(extended.branch.startsWith(`${first.branch}/`)).toBe(false)
      expect(first.branch.startsWith(`${extended.branch}/`)).toBe(false)
    }),
    { numRuns: 100, seed: 339 }
  )
})
