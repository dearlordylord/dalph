import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { defaultTaskExecutionCapacity, maximumTaskExecutionCapacityValue, TaskExecutionCapacity } from "./domain.js"

describe("task execution capacity policy", () => {
  it("binds the documented default and maximum to the branded boundary", () => {
    expect(defaultTaskExecutionCapacity).toBe(2)
    expect(maximumTaskExecutionCapacityValue).toBe(8)
    expect(
      Schema.decodeUnknownSync(TaskExecutionCapacity)(
        defaultTaskExecutionCapacity
      )
    ).toBe(defaultTaskExecutionCapacity)
    expect(
      Schema.decodeUnknownSync(TaskExecutionCapacity)(
        maximumTaskExecutionCapacityValue
      )
    ).toBe(maximumTaskExecutionCapacityValue)
    expect(() => Schema.decodeUnknownSync(TaskExecutionCapacity)(9)).toThrow()
  })
})
