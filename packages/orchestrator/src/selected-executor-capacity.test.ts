import { Schema } from "effect"
import { expect, it } from "vitest"
import { defaultTaskWorkCapacity, maximumTaskWorkCapacityValue, TaskWorkCapacity } from "./domain.js"
import { selectedExecutorCapacityRequirementFor } from "./selected-executor-capacity.js"

it("bounds task-work capacity from one through eight", () => {
  expect(defaultTaskWorkCapacity).toBe(2)
  expect(maximumTaskWorkCapacityValue).toBe(8)
  expect(Schema.decodeUnknownSync(TaskWorkCapacity)(1)).toBe(1)
  expect(Schema.decodeUnknownSync(TaskWorkCapacity)(8)).toBe(8)
  expect(() => Schema.decodeUnknownSync(TaskWorkCapacity)(9)).toThrow()
})

it("defines the task-work capacity policy once for every executor activity", () => {
  expect(selectedExecutorCapacityRequirementFor("TaskExecution")._tag)
    .toBe("OneTaskWorkPosition")
  expect(selectedExecutorCapacityRequirementFor("ImplementationReview")._tag)
    .toBe("OneTaskWorkPosition")
  expect(selectedExecutorCapacityRequirementFor("ReviewFindingsHandback")._tag)
    .toBe("OneTaskWorkPosition")
  expect(selectedExecutorCapacityRequirementFor("ImplementationEvidenceSealing")._tag)
    .toBe("NoTaskWorkPosition")
  expect(selectedExecutorCapacityRequirementFor("ImplementationDisposition")._tag)
    .toBe("NoTaskWorkPosition")
})
