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
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { expect } from "vitest"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import {
  makeTrackerGraphObservationOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../workflow/registry/operation.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { latestRunningExecutorReportRecordFor, responsibilityStillOwnsTask } from "./fresh-workflow.js"
import { specificationReadRequiredAfterProgressGraph } from "./fresh-workflow-progress.js"

const runId = RunId.make("fresh-workflow-no-successor-run")
const taskId = TaskId.make("fresh-workflow-no-successor-task")
const plannedSpecification = makeTaskWorkSpecification({ body: "planned body", taskId, title: "planned title" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("fresh-workflow-no-successor-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/fresh-workflow-no-successor"),
  executor: TaskExecutorLocator.make("executor:fresh-workflow-no-successor"),
  runId,
  taskId,
  taskRevision: plannedSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/fresh-workflow-no-successor")
})

it("models a missing positioned Running report as absence instead of inventing journal position zero", () => {
  expect(latestRunningExecutorReportRecordFor([], plannedAttempt)).toBeUndefined()

  const record = {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: PlannedAttemptExecutorReport.cases.Running.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      }),
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("fresh-workflow-positioned-running-report"),
    position: JournalPosition.make(1),
    runId
  }

  expect(latestRunningExecutorReportRecordFor([record], plannedAttempt)?.position).toBe(JournalPosition.make(1))
})

it("keeps a Running responsibility in the current-facts chain after a progress graph observation", () => {
  const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  const report = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    }),
    version: workflowJournalEventVersion
  })
  const target = FixtureTarget.make("fresh-workflow-progress-target")
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("fresh-workflow-progress-graph"),
    target,
    [],
    [taskId]
  )
  const graph = projectTrackerSnapshot({ revision: "fresh-workflow-progress-revision", tasks: [] })
  expect(graph._tag).toBe("Valid")
  if (graph._tag === "Invalid") return
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-progress-specification"),
    target,
    taskId
  )
  const specification = makeTaskWorkSpecification({ body: "old body", taskId, title: "old title" })
  const records = [
    {
      event: report,
      key: JournalRecordKey.make("fresh-workflow-progress-report"),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      key: JournalRecordKey.make("fresh-workflow-progress-specification"),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, graph.snapshot)
      ),
      key: JournalRecordKey.make("fresh-workflow-progress-graph"),
      position: JournalPosition.make(5),
      runId
    }
  ]

  expect(responsibilityStillOwnsTask(responsibility, records, new Set())).toBe(true)
})

it("requires a focused specification intent after the progress graph and its exact predecessor", () => {
  const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  const report = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    }),
    version: workflowJournalEventVersion
  })
  const target = FixtureTarget.make("fresh-workflow-causal-order-target")
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("fresh-workflow-causal-order-graph"),
    target,
    [],
    [taskId]
  )
  const graph = projectTrackerSnapshot({ revision: "fresh-workflow-causal-order-revision", tasks: [] })
  expect(graph._tag).toBe("Valid")
  if (graph._tag === "Invalid") return
  const staleSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-causal-order-stale-specification"),
    target,
    taskId
  )
  const specification = plannedSpecification
  const staleRecords = [
    {
      event: report,
      key: JournalRecordKey.make("fresh-workflow-causal-order-report"),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerReadIntent(staleSpecificationOperation),
      key: JournalRecordKey.make("fresh-workflow-causal-order-stale-intent"),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerReadIntent(graphOperation),
      key: JournalRecordKey.make("fresh-workflow-causal-order-graph-intent"),
      position: JournalPosition.make(5),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, graph.snapshot)
      ),
      key: JournalRecordKey.make("fresh-workflow-causal-order-graph-observation"),
      position: JournalPosition.make(6),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        staleSpecificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(staleSpecificationOperation, specification)
      ),
      key: JournalRecordKey.make("fresh-workflow-causal-order-stale-observation"),
      position: JournalPosition.make(7),
      runId
    }
  ]

  // The observation finished after G1, but the tracker call began before it;
  // it cannot authorize a continuation from the post-G1 facts chain.
  expect(responsibilityStillOwnsTask(responsibility, staleRecords, new Set())).toBe(true)

  const freshSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("fresh-workflow-causal-order-fresh-specification"),
    target,
    taskId,
    [graphOperation.operationId]
  )
  const freshRecords = [
    ...staleRecords.slice(0, 4),
    {
      event: taskTrackerReadIntent(freshSpecificationOperation),
      key: JournalRecordKey.make("fresh-workflow-causal-order-fresh-intent"),
      position: JournalPosition.make(7),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        freshSpecificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(freshSpecificationOperation, specification)
      ),
      key: JournalRecordKey.make("fresh-workflow-causal-order-fresh-observation"),
      position: JournalPosition.make(8),
      runId
    }
  ]

  expect(responsibilityStillOwnsTask(responsibility, freshRecords, new Set())).toBe(false)
})

it("does not use an unrelated later B-only graph read as A's focused-specification predecessor", () => {
  const report = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    }),
    version: workflowJournalEventVersion
  })
  const target = FixtureTarget.make("fresh-workflow-unrelated-graph-target")
  const taskB = TaskId.make("fresh-workflow-unrelated-task-B")
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("fresh-workflow-unrelated-graph"),
    target,
    [],
    [taskB]
  )
  const graph = projectTrackerSnapshot({ revision: "fresh-workflow-unrelated-graph-revision", tasks: [] })
  expect(graph._tag).toBe("Valid")
  if (graph._tag === "Invalid") return
  const records = [
    {
      event: report,
      key: JournalRecordKey.make("fresh-workflow-unrelated-report-A"),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerReadIntent(graphOperation),
      key: JournalRecordKey.make("fresh-workflow-unrelated-graph-intent-B"),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, graph.snapshot)
      ),
      key: JournalRecordKey.make("fresh-workflow-unrelated-graph-observation-B"),
      position: JournalPosition.make(5),
      runId
    }
  ]

  expect(specificationReadRequiredAfterProgressGraph(records, plannedAttempt, JournalPosition.make(3))).toBeUndefined()
})

it.each([
  ["NoCurrentReport", PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})],
  ["TemporarilyUnavailable", PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})],
  ["Unreadable", PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({})],
  [
    "CorrelationContradiction",
    PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
      observed: PlannedAttemptExecutorReport.cases.Running.make({
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
