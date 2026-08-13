import { expect, it } from "vitest"
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
import { latestPlannedAttemptExecutorEvidence, plannedAttemptExecutorEvidence } from "./evidence.js"

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
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateNoCurrentReport.make({}),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
        version: workflowJournalEventVersion
      }),
      position: JournalPosition.make(1)
    },
    {
      event: PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({}),
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

it.each([
  PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({}),
  PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
  PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({}),
  PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
    observed: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: { attemptId: AttemptId.make("foreign-evidence-attempt"), runId: plannedAttempt.runId }
    })
  })
])("invalidates older exact authority after a newer $._tag projection until an exact reread", (issue) => {
  const exact = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const nonExact = PlannedAttemptExecutorStateObservedEvent.make({
    observation: issue,
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(2),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const reread = PlannedAttemptExecutorStateObservedEvent.make({
    observation: exact.observation,
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(3),
    plannedAttempt,
    version: workflowJournalEventVersion
  })

  expect(
    latestPlannedAttemptExecutorEvidence(
      [
        { event: exact, position: JournalPosition.make(1) },
        { event: nonExact, position: JournalPosition.make(2) }
      ],
      plannedAttempt
    )
  ).toBeUndefined()
  expect(
    latestPlannedAttemptExecutorEvidence(
      [
        { event: exact, position: JournalPosition.make(1) },
        { event: nonExact, position: JournalPosition.make(2) },
        { event: reread, position: JournalPosition.make(3) }
      ],
      plannedAttempt
    )?.observedAt
  ).toBe(3)
})
