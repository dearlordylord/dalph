import type { TaskId } from "@dalph/contracts"
import { exactTaskIdSetKey } from "../../authorities/task-tracker/target.js"

export const reconfirmedGraphSubjectIssue = (input: {
  readonly groupingTaskIds: ReadonlyArray<TaskId>
  readonly lifecycleTaskIds: ReadonlyArray<TaskId>
  readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
  readonly rootTaskId: TaskId | undefined
}): string | undefined => {
  const subjectKey = exactTaskIdSetKey(input.lifecycleTaskIds)
  const subjectsDiffer =
    exactTaskIdSetKey(input.prerequisiteTaskIds) !== subjectKey ||
    exactTaskIdSetKey(input.groupingTaskIds) !== subjectKey
  return subjectsDiffer
    ? "every reconfirmed graph fact family must name the same task subjects"
    : input.rootTaskId !== undefined && !input.lifecycleTaskIds.includes(input.rootTaskId)
      ? "the selected tracker root must belong to the reconfirmed graph subjects"
      : undefined
}
