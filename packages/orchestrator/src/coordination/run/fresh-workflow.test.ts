import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { expect } from "vitest"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { responsibilityStillOwnsTask } from "./fresh-workflow.js"

const runId = RunId.make("fresh-workflow-no-successor-run")
const taskId = TaskId.make("fresh-workflow-no-successor-task")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("fresh-workflow-no-successor-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/fresh-workflow-no-successor"),
  executor: TaskExecutorLocator.make("executor:fresh-workflow-no-successor"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("fresh-workflow-no-successor-revision"),
  worktree: WorktreeLocator.make("/worktrees/fresh-workflow-no-successor")
})

it.each([
  ["NoCurrentReport", PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})],
  ["TemporarilyUnavailable", PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})],
  ["Unreadable", PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({})],
  [
    "CorrelationContradiction",
    PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
      observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: { runId, attemptId: AttemptId.make("foreign-projection-attempt") }
      })
    })
  ]
] as const)("retains the exact task responsibility after a %s executor projection", (_reason, observation) => {
  const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  const projection = PlannedAttemptExecutorStateObservedEvent.make({
    observation,
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })

  expect(responsibilityStillOwnsTask(responsibility, [], new Set())).toBe(false)
  expect(
    responsibilityStillOwnsTask(
      responsibility,
      [
        {
          event: projection,
          key: JournalRecordKey.make("fresh-workflow-projection"),
          position: JournalPosition.make(2),
          runId
        }
      ],
      new Set()
    )
  ).toBe(true)
})
