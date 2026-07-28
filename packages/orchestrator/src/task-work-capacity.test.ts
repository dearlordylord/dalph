import { Schema } from "effect"
import { expect, it } from "vitest"
import { defaultTaskWorkCapacity, maximumTaskWorkCapacityValue, TaskWorkCapacity } from "./domain.js"
import { taskWorkCapacityRequirementFor } from "./task-work-capacity.js"

it("bounds task-work capacity from one through eight", () => {
  expect(defaultTaskWorkCapacity).toBe(2)
  expect(maximumTaskWorkCapacityValue).toBe(8)
  expect(Schema.decodeUnknownSync(TaskWorkCapacity)(1)).toBe(1)
  expect(Schema.decodeUnknownSync(TaskWorkCapacity)(8)).toBe(8)
  expect(() => Schema.decodeUnknownSync(TaskWorkCapacity)(9)).toThrow()
})

it("defines the task-work capacity policy once for every executor activity", () => {
  expect(taskWorkCapacityRequirementFor("TaskExecution")._tag)
    .toBe("OneTaskWorkPosition")
  expect(taskWorkCapacityRequirementFor("ImplementationReview")._tag)
    .toBe("OneTaskWorkPosition")
  expect(taskWorkCapacityRequirementFor("ReviewFindingsHandback")._tag)
    .toBe("OneTaskWorkPosition")
  expect(taskWorkCapacityRequirementFor("ImplementationEvidenceSealing")._tag)
    .toBe("NoTaskWorkPosition")
  expect(taskWorkCapacityRequirementFor("ImplementationDisposition")._tag)
    .toBe("NoTaskWorkPosition")
})
