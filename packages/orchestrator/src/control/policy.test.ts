import { Schema } from "effect"
import { expect, it } from "vitest"
import { InitialControlPolicy } from "./policy.js"

it("decodes the task-work capacity used when Dalph creates a fresh coordinator", () => {
  expect(Schema.decodeUnknownSync(InitialControlPolicy)({ taskExecutionCapacity: 1 })).toEqual({
    taskExecutionCapacity: 1
  })
  expect(() => Schema.decodeUnknownSync(InitialControlPolicy)({ taskExecutionCapacity: 0 })).toThrow()
})
