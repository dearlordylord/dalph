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
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Exit } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "./events.js"
import {
  currentAcceptedPlannedAttemptExecutorLifecycleFor,
  latestAcceptedPlannedAttemptExecutorEvidence,
  latestPlannedAttemptExecutorEvidence,
  plannedAttemptExecutorEvidence,
  plannedAttemptExecutorRequestFor
} from "./evidence.js"

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
    observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: { attemptId: AttemptId.make("foreign-evidence-attempt"), runId: plannedAttempt.runId }
    })
  }),
  PlannedAttemptExecutorStateObservation.cases.ExecutorInitialReportCausalityContradiction.make({
    observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    })
  }),
  PlannedAttemptExecutorStateObservation.cases.ExecutorLifecycleTransitionContradiction.make({
    accepted: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    }),
    observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    })
  })
])("invalidates older exact authority after a newer $._tag projection until an exact reread", (issue) => {
  const exact = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
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

it.each([
  {
    expected: "Executing",
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    })
  },
  {
    expected: "Settled",
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    })
  },
  {
    expected: "Settled",
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId },
      result: { _tag: "Completed" }
    })
  }
])("classifies current exact $report._tag lifecycle authority as $expected", ({ expected, report }) => {
  const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const accepted = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report,
    version: workflowJournalEventVersion
  })
  const records = [
    { event: responsibility, position: JournalPosition.make(1) },
    { event: accepted, position: JournalPosition.make(2) }
  ]

  expect(currentAcceptedPlannedAttemptExecutorLifecycleFor(records, report.correlation)._tag).toBe(expected)
})

it("keeps missing or invalidated exact lifecycle authority ambiguous", () => {
  const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
  const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const executing = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
    version: workflowJournalEventVersion
  })
  const unavailable = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })

  expect(currentAcceptedPlannedAttemptExecutorLifecycleFor([], correlation)).toEqual({ _tag: "Ambiguous" })
  expect(
    currentAcceptedPlannedAttemptExecutorLifecycleFor(
      [
        { event: responsibility, position: JournalPosition.make(1) },
        { event: executing, position: JournalPosition.make(2) },
        { event: unavailable, position: JournalPosition.make(3) }
      ],
      correlation
    )
  ).toEqual({ _tag: "Ambiguous" })
})

it("does not fall back to an older accepted report when a distinct exact report still awaits acceptance", () => {
  const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
  const acceptedSafe = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }),
    version: workflowJournalEventVersion
  })
  const observedTerminal = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation,
        result: { _tag: "Completed" }
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const records = [
    { event: acceptedSafe, position: JournalPosition.make(1) },
    { event: observedTerminal, position: JournalPosition.make(2) }
  ]

  expect(latestPlannedAttemptExecutorEvidence(records, plannedAttempt)).toMatchObject({
    observedAt: 2,
    source: { _tag: "StateProjection" }
  })
  expect(latestAcceptedPlannedAttemptExecutorEvidence(records, plannedAttempt)).toBeUndefined()
  expect(
    currentAcceptedPlannedAttemptExecutorLifecycleFor(
      [
        {
          event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt,
            version: workflowJournalEventVersion
          }),
          position: JournalPosition.make(1)
        },
        ...records.map(({ event, position }) => ({ event, position: JournalPosition.make(Number(position) + 1) }))
      ],
      correlation
    )
  ).toEqual({ _tag: "Ambiguous" })
})

it("retains accepted authority after an unchanged exact passive replay", () => {
  const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
  const acceptedSafe = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }),
    version: workflowJournalEventVersion
  })
  const replayedSafe = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: acceptedSafe.report }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const records = [
    { event: acceptedSafe, position: JournalPosition.make(1) },
    { event: replayedSafe, position: JournalPosition.make(2) }
  ]

  expect(latestAcceptedPlannedAttemptExecutorEvidence(records, plannedAttempt)).toMatchObject({
    observedAt: 1,
    source: { _tag: "AcceptedReport" }
  })
})

it("restores accepted authority when an unchanged exact reread follows a lifecycle contradiction", () => {
  const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
  const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
  const acceptedSafe = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: safe,
    version: workflowJournalEventVersion
  })
  const contradiction = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExecutorLifecycleTransitionContradiction.make({
      accepted: safe,
      observed: executing
    }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const reread = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: safe }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(2),
    plannedAttempt,
    version: workflowJournalEventVersion
  })

  expect(
    latestAcceptedPlannedAttemptExecutorEvidence(
      [
        { event: acceptedSafe, position: JournalPosition.make(1) },
        { event: contradiction, position: JournalPosition.make(2) },
        { event: reread, position: JournalPosition.make(3) }
      ],
      plannedAttempt
    )
  ).toMatchObject({ observedAt: 1, source: { _tag: "AcceptedReport" } })
})

it("classifies selected and journal-derived task work specifications exactly", async () => {
  const wrongTask = makeTaskWorkSpecification({ body: "wrong", taskId: TaskId.make("other"), title: "wrong" })
  const stale = makeTaskWorkSpecification({ body: "stale", taskId: plannedAttempt.taskId, title: "stale" })
  const exact = makeTaskWorkSpecification({ body: "exact", taskId: plannedAttempt.taskId, title: "exact" })
  const exactAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, taskRevision: exact.fingerprint })

  expect(
    Exit.isFailure(await Effect.runPromiseExit(plannedAttemptExecutorRequestFor([], plannedAttempt, wrongTask)))
  ).toBe(true)
  expect(Exit.isFailure(await Effect.runPromiseExit(plannedAttemptExecutorRequestFor([], plannedAttempt, stale)))).toBe(
    true
  )
  expect(Exit.isFailure(await Effect.runPromiseExit(plannedAttemptExecutorRequestFor([], plannedAttempt)))).toBe(true)
  expect(
    Exit.isFailure(await Effect.runPromiseExit(plannedAttemptExecutorRequestFor([], plannedAttempt, undefined)))
  ).toBe(true)
  expect(Exit.isSuccess(await Effect.runPromiseExit(plannedAttemptExecutorRequestFor([], exactAttempt, exact)))).toBe(
    true
  )
})

it("applies the executor-evidence position cutoff inclusively", () => {
  const event = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const records = [{ event, position: JournalPosition.make(2) }]
  expect(plannedAttemptExecutorEvidence(records, plannedAttempt, JournalPosition.make(2))).toEqual([])
  expect(plannedAttemptExecutorEvidence(records, plannedAttempt, JournalPosition.make(1))).toHaveLength(1)
})
