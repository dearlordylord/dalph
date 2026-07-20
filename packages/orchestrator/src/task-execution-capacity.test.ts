import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { defaultTaskExecutionCapacity, maximumTaskExecutionCapacity, TaskExecutionCapacity } from "./index.js"

describe("task execution capacity policy", () => {
  it("binds the documented default and maximum to the branded boundary", () => {
    expect(defaultTaskExecutionCapacity).toBe(2)
    expect(maximumTaskExecutionCapacity).toBe(8)
    expect(
      Schema.decodeUnknownSync(TaskExecutionCapacity)(
        defaultTaskExecutionCapacity
      )
    ).toBe(defaultTaskExecutionCapacity)
    expect(
      Schema.decodeUnknownSync(TaskExecutionCapacity)(
        maximumTaskExecutionCapacity
      )
    ).toBe(maximumTaskExecutionCapacity)
    expect(() => Schema.decodeUnknownSync(TaskExecutionCapacity)(9)).toThrow()
  })
})
