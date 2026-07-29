import { Schema } from "effect"
import { expect, it } from "vitest"
import { TaskBranchRef } from "./git-locator.js"

it.each([
  "main",
  "refs/heads/",
  "refs/heads/a..b",
  "refs/heads/a//b",
  "refs/heads/a.lock",
  "refs/heads/a@{b",
  "refs/heads/.hidden",
  "refs/heads/trailing/",
  "refs/heads/trailing.",
  "refs/heads/space name",
  "refs/heads/caret^name"
])("rejects Git-invalid task branch ref %s", (branch) => {
  expect(() => Schema.decodeUnknownSync(TaskBranchRef)(branch)).toThrow()
})
