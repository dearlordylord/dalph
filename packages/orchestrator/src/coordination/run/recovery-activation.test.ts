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
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { validSnapshot } from "../../../test/task-dag.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { safelySuspendedAttemptMayContinue, taskPauseSuspensionIsOwed } from "./recovery-activation.js"
import { ReconstructedPauseState } from "../reconstruction/state.js"

it("suspends a running grouping descendant and reopens it after current facts move it outside the parent", () => {
  const runId = RunId.make("grouping-descendant-suspension-run")
  const descendantTaskId = TaskId.make("D")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("grouping-descendant-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/grouping-descendant-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: descendantTaskId,
    taskRevision: TaskRevision.make("grouping-descendant-revision"),
    worktree: WorktreeLocator.make("/dalph/grouping-descendant-attempt")
  })
  const graph = validSnapshot({
    revision: "running-grouping-descendant-v1",
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: [] }
    ]
  })
  const graphRead = makeTrackerGraphObservationOperation(
    OperationId.make("grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const records = [
    {
      position: JournalPosition.make(1),
      event: taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, graph)
      )
    },
    {
      position: JournalPosition.make(3),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    {
      position: JournalPosition.make(4),
      event: ControlDirectionAppliedEvent.make({
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(1),
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") },
        version: workflowJournalEventVersion
      })
    }
  ]

  expect(taskPauseSuspensionIsOwed(records, plannedAttempt, JournalPosition.make(2), graph)).toBe(true)

  const regrouped = validSnapshot({
    revision: "regrouped-descendant-v2",
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  const pause = ReconstructedPauseState.make({
    run: { _tag: "RunUnpaused" },
    tasks: { _tag: "TaskPauses", taskIds: [TaskId.make("A")] }
  })
  expect(safelySuspendedAttemptMayContinue(pause, plannedAttempt, graph)).toBe(false)
  expect(safelySuspendedAttemptMayContinue(pause, plannedAttempt, regrouped)).toBe(true)
  expect(taskPauseSuspensionIsOwed(records, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(true)

  const lateGroupingGraphRead = makeTrackerGraphObservationOperation(
    OperationId.make("late-grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const reconfirmedGroupingGraphRead = makeTrackerGraphObservationOperation(
    OperationId.make("reconfirmed-grouping-descendant-graph-read"),
    FixtureTarget.make("grouping-descendant-target")
  )
  const lateGroupingGraphEvent = taskTrackerFactsObservedEvent(
    lateGroupingGraphRead.operationId,
    makeCompleteTaskTrackerFactsObserved(lateGroupingGraphRead, graph)
  )
  const reconfirmedGroupingGraphEvent = makeTaskTrackerFactsObservedFromRead(
    [{ event: lateGroupingGraphEvent }],
    reconfirmedGroupingGraphRead,
    graph
  )
  const responsibilityBegan = records[1]
  const taskPaused = records[2]
  if (responsibilityBegan === undefined || taskPaused === undefined) return expect.fail("expected pause records")
  const lateGroupingRecords = [
    {
      position: JournalPosition.make(1),
      event: taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, regrouped)
      )
    },
    responsibilityBegan,
    taskPaused,
    {
      position: JournalPosition.make(5),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    {
      position: JournalPosition.make(6),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      })
    },
    { position: JournalPosition.make(7), event: lateGroupingGraphEvent },
    { position: JournalPosition.make(8), event: reconfirmedGroupingGraphEvent },
    {
      position: JournalPosition.make(9),
      event: ControlDirectionAppliedEvent.make({
        direction: "Unpause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(2),
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") },
        version: workflowJournalEventVersion
      })
    }
  ]
  expect(taskPauseSuspensionIsOwed(lateGroupingRecords, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(true)

  const activePauseWithoutGraph = [responsibilityBegan, taskPaused]
  expect(taskPauseSuspensionIsOwed(activePauseWithoutGraph, plannedAttempt, JournalPosition.make(2), graph)).toBe(true)
  expect(taskPauseSuspensionIsOwed(activePauseWithoutGraph, plannedAttempt, JournalPosition.make(2), regrouped)).toBe(
    false
  )
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...activePauseWithoutGraph,
        { position: JournalPosition.make(9), event: lateGroupingRecords.at(-1)?.event ?? taskPaused.event }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  const lostSuspensionCommand = PlannedAttemptExecutorCommandIntendedEvent.make({
    command: "Suspend",
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const exactSafeProjection = PlannedAttemptExecutorCommandProjectionObservedEvent.make({
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      })
    }),
    occurrenceClassification: "NonActionOccurrence",
    plannedAttempt,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
    version: workflowJournalEventVersion
  })
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...records,
        { position: JournalPosition.make(5), event: lostSuspensionCommand },
        { position: JournalPosition.make(6), event: exactSafeProjection }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  expect(
    taskPauseSuspensionIsOwed(
      [
        ...records,
        {
          position: JournalPosition.make(5),
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
            }),
            version: workflowJournalEventVersion
          })
        }
      ],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  expect(
    taskPauseSuspensionIsOwed(
      [{ position: JournalPosition.make(1), event: taskPaused.event }],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(false)
  const exactTaskPause = ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: ControlDirectionApplicationOrdinal.make(2),
    subject: { _tag: "Task", runId, taskId: descendantTaskId },
    version: workflowJournalEventVersion
  })
  expect(
    taskPauseSuspensionIsOwed(
      [responsibilityBegan, { position: JournalPosition.make(4), event: exactTaskPause }],
      plannedAttempt,
      JournalPosition.make(2),
      undefined
    )
  ).toBe(true)
  expect(
    taskPauseSuspensionIsOwed(
      [responsibilityBegan, taskPaused, { position: JournalPosition.make(5), event: reconfirmedGroupingGraphEvent }],
      plannedAttempt,
      JournalPosition.make(2),
      graph
    )
  ).toBe(true)
})
