import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent
} from "./events.js"
import { plannedAttemptExecutorEvidence } from "./evidence.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("evidence-attempt"),
  baseSha: GitCommitSha.make("4".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/evidence-attempt"),
  executor: TaskExecutorLocator.make("executor:evidence"),
  runId: RunId.make("evidence-run"),
  taskId: TaskId.make("evidence-task"),
  taskRevision: TaskRevision.make("evidence-revision"),
  worktree: WorktreeLocator.make("/worktrees/evidence-attempt")
})

it("does not treat unavailable command or state projections as executor evidence", () => {
  const records = [
    {
      event: PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateUnavailable.make({}),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
        version: workflowJournalEventVersion
      }),
      position: JournalPosition.make(1)
    },
    {
      event: PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnavailable.make({}),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      position: JournalPosition.make(2)
    }
  ]

  expect(plannedAttemptExecutorEvidence(records, plannedAttempt)).toEqual([])
})
