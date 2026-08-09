import { Schema } from "effect"
import { expect, it } from "vitest"
import { InitialControlPolicy } from "./policy.js"

it("decodes the initial task-work capacity when Run establishment creates a new Run", () => {
  expect(Schema.decodeUnknownSync(InitialControlPolicy)({ taskExecutionCapacity: 1 })).toEqual({
    taskExecutionCapacity: 1
  })
  expect(() => Schema.decodeUnknownSync(InitialControlPolicy)({ taskExecutionCapacity: 0 })).toThrow()
})
