import { it } from "@effect/vitest"
import { Schema } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import { PlannedTaskAttempt, samePlannedTaskAttempt } from "./planned-attempt.js"

const nonEmpty = fc.string({ minLength: 1, maxLength: 40 })
const plannedTaskAttemptEncodedArbitrary = fc
  .record({
    attemptId: nonEmpty,
    branch: fc.stringMatching(/^refs\/heads\/[a-z]{1,20}$/),
    executor: nonEmpty,
    runId: nonEmpty,
    taskId: nonEmpty,
    taskRevision: nonEmpty,
    worktree: nonEmpty
  })
  .map((fields) => ({ ...fields, baseSha: "0123456789abcdef0123456789abcdef01234567" }))

it("roundtrips arbitrary valid planned task attempts through the persisted Schema boundary", () => {
  fc.assert(
    fc.property(plannedTaskAttemptEncodedArbitrary, (encoded) => {
      expect(
        Schema.encodeUnknownSync(PlannedTaskAttempt)(Schema.decodeUnknownSync(PlannedTaskAttempt)(encoded))
      ).toEqual(encoded)
    })
  )
})

it("satisfies the planned-attempt equivalence laws for arbitrary valid plans", () => {
  const decode = Schema.decodeUnknownSync(PlannedTaskAttempt)
  const copy = (plan: PlannedTaskAttempt) => decode(Schema.encodeUnknownSync(PlannedTaskAttempt)(plan))

  fc.assert(
    fc.property(plannedTaskAttemptEncodedArbitrary, plannedTaskAttemptEncodedArbitrary, (leftEncoded, rightEncoded) => {
      const left = decode(leftEncoded)
      const right = decode(rightEncoded)
      const middle = copy(left)
      const end = copy(middle)

      expect(samePlannedTaskAttempt(left, left)).toBe(true)
      expect(samePlannedTaskAttempt(left, right)).toBe(samePlannedTaskAttempt(right, left))
      expect(samePlannedTaskAttempt(left, middle) && samePlannedTaskAttempt(middle, end)).toBe(true)
      expect(samePlannedTaskAttempt(left, end)).toBe(true)
    })
  )
})

it("compares decoded plans structurally and observes every planned field", () => {
  const baseline = {
    attemptId: "attempt-1",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "refs/heads/task-1",
    executor: "executor-1",
    runId: "run-1",
    taskId: "task-1",
    taskRevision: "revision-1",
    worktree: "/worktree-1"
  }
  const decode = Schema.decodeUnknownSync(PlannedTaskAttempt)
  const equalCopy = decode(Schema.encodeUnknownSync(PlannedTaskAttempt)(decode(baseline)))
  expect(samePlannedTaskAttempt(decode(baseline), equalCopy)).toBe(true)

  const variants = [
    { ...baseline, attemptId: "attempt-2" },
    { ...baseline, baseSha: "1123456789abcdef0123456789abcdef01234567" },
    { ...baseline, branch: "refs/heads/task-2" },
    { ...baseline, executor: "executor-2" },
    { ...baseline, runId: "run-2" },
    { ...baseline, taskId: "task-2" },
    { ...baseline, taskRevision: "revision-2" },
    { ...baseline, worktree: "/worktree-2" }
  ]
  expect(variants.every((variant) => !samePlannedTaskAttempt(decode(baseline), decode(variant)))).toBe(true)
})

it("rejects an empty executor locator at the plan boundary", () => {
  const encoded = {
    attemptId: "attempt",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    branch: "refs/heads/task",
    executor: "",
    runId: "run",
    taskId: "task",
    taskRevision: "revision",
    worktree: "/worktree"
  }
  expect(Schema.decodeUnknownResult(PlannedTaskAttempt)(encoded)._tag).toBe("Failure")
})
