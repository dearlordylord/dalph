import { Exit } from "effect"
import { expect, it } from "vitest"
import { AuthoredCassetteInteractionMismatch } from "./authored-cursor.js"
import { authoredInteractionMismatchFrom } from "./authored-runner.js"

it("extracts only the authored interaction mismatch from an Effect exit", () => {
  const mismatch = new AuthoredCassetteInteractionMismatch({ actual: "actual", expected: "expected", storyPosition: 1 })
  expect(authoredInteractionMismatchFrom(Exit.succeed(undefined))).toBeUndefined()
  expect(authoredInteractionMismatchFrom(Exit.fail("ordinary failure"))).toBeUndefined()
  expect(authoredInteractionMismatchFrom(Exit.die("defect"))).toBeUndefined()
  expect(authoredInteractionMismatchFrom(Exit.fail(mismatch))).toBe(mismatch)
})
