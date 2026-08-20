import { expect, it } from "vitest"
import { FixtureTarget } from "./fixture/target.js"
import { factFamiliesCoverTarget, taskTrackerTargetKey } from "./target.js"

it("encodes primitive fixture targets without retaining a process-wide target table", () => {
  const targets = Array.from({ length: 128 }, (_unused, index) => FixtureTarget.make(`target-${index}`))
  expect(new Set(targets.map(taskTrackerTargetKey)).size).toBe(targets.length)
  const repeated = FixtureTarget.make("target-17")
  expect(taskTrackerTargetKey(repeated)).toBe(taskTrackerTargetKey(repeated))
  expect(
    factFamiliesCoverTarget(
      targets.map((target) => ({ coverage: { target } })),
      FixtureTarget.make("target-17")
    )
  ).toBe(false)
})
