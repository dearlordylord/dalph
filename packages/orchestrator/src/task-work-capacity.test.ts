import { Schema } from "effect"
import { expect, it } from "vitest"
import { defaultTaskWorkCapacity, maximumTaskWorkCapacityValue, TaskWorkCapacity } from "./domain.js"

it("bounds task-work capacity from one through eight", () => {
  expect(defaultTaskWorkCapacity).toBe(2)
  expect(maximumTaskWorkCapacityValue).toBe(8)
  expect(Schema.decodeUnknownSync(TaskWorkCapacity)(1)).toBe(1)
  expect(Schema.decodeUnknownSync(TaskWorkCapacity)(8)).toBe(8)
  expect(() => Schema.decodeUnknownSync(TaskWorkCapacity)(9)).toThrow()
})
