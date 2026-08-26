import { describe, expect, it } from "vitest"
import {
  AttemptId,
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  RunId,
  TaskId
} from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  executorProgressGraphReadInputOf,
  executorProgressGraphReadRequirementOf,
  type ExecutorProgressCommand,
  type ExecutorProgressGraphRead
} from "./executor-progress-graph-read.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  taskTrackerFactsObservedEvent,
  makeCompleteTaskTrackerFactsObserved
} from "../../workflow/task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"

const runId = RunId.make("executor-progress-requirement-test")
const target = FixtureTarget.make("executor-progress-requirement-target")
const correlationFor = (attemptId: string) =>
  PlannedAttemptExecutorCorrelation.make({ runId, attemptId: AttemptId.make(attemptId) })
const reportAt = (attemptId: string, acceptedAt: number, report: "Running" | "SafelySuspended") => ({
  acceptedAt: JournalPosition.make(acceptedAt),
  correlation: correlationFor(attemptId),
  report:
    report === "Running"
      ? PlannedAttemptExecutorReport.cases.Running.make({ correlation: correlationFor(attemptId) })
      : PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation: correlationFor(attemptId) }),
  taskId: TaskId.make(attemptId)
})

const readAt = (
  operationId: string,
  intentAt: number,
  observedAt: number | null,
  observation: "Complete" | "Unchanged" | "Failed" | null = "Complete",
  explicitlyCoveredTaskIds: ReadonlyArray<TaskId> = [TaskId.make("A"), TaskId.make("B"), TaskId.make("C")]
): ExecutorProgressGraphRead => ({
  explicitlyCoveredTaskIds,
  intentAt: JournalPosition.make(intentAt),
  observation:
    observedAt === null
      ? { _tag: "Unresolved" }
      : { _tag: "Observed", outcome: observation ?? "Failed", observedAt: JournalPosition.make(observedAt) },
  operationId: OperationId.make(operationId),
  runId,
  target
})

const commandAt = (attemptId: string, command: ExecutorProgressCommand["command"], intendedAt: number) => ({
  command,
  correlation: correlationFor(attemptId),
  intendedAt: JournalPosition.make(intendedAt)
})

const inputOf = (
  reports: ReadonlyArray<ReturnType<typeof reportAt>>,
  graphReads: ReadonlyArray<ExecutorProgressGraphRead> = [],
  commands: ReadonlyArray<ExecutorProgressCommand> = []
) => ({ commands, graphReads, reports, runId, target })

const foreignRunId = RunId.make("foreign-executor-progress-run")

describe("executor progress graph-read requirement", () => {
  it("coalesces three pending Running reports into one requirement", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf([reportAt("A", 1, "Running"), reportAt("B", 2, "Running"), reportAt("C", 3, "Running")])
    )

    expect(requirement?.pendingReports).toHaveLength(3)
    expect(requirement?.explicitlyCoveredTaskIds).toEqual([TaskId.make("A"), TaskId.make("B"), TaskId.make("C")])
    expect(requirement?.unresolvedReadOperationId).toBeNull()
  })

  it("covers all pending reports with one later complete graph read", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf(
        [reportAt("A", 1, "Running"), reportAt("B", 2, "Running"), reportAt("C", 3, "Running")],
        [readAt("progress-read", 4, 5)]
      )
    )

    expect(requirement).toBeUndefined()
  })

  it("keeps A pending when a later complete graph read explicitly covers only B", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf(
        [reportAt("A", 1, "Running"), reportAt("B", 2, "Running")],
        [readAt("B-only-progress-read", 3, 4, "Complete", [TaskId.make("B")])]
      )
    )

    expect(requirement?.pendingReports).toEqual([
      { acceptedAt: JournalPosition.make(1), correlation: correlationFor("A"), taskId: TaskId.make("A") }
    ])
    expect(requirement?.explicitlyCoveredTaskIds).toEqual([TaskId.make("A")])
  })

  it("does not reread unchanged facts until another Running report is accepted", () => {
    const reports: ReadonlyArray<ReturnType<typeof reportAt>> = [reportAt("A", 1, "Running")]
    const read = readAt("unchanged-read", 2, 3, "Unchanged")

    expect(executorProgressGraphReadRequirementOf(inputOf(reports, [read]))).toBeUndefined()
    expect(
      executorProgressGraphReadRequirementOf(inputOf([...reports, reportAt("A", 4, "Running")], [read]))?.pendingReports
    ).toEqual([{ acceptedAt: JournalPosition.make(4), correlation: correlationFor("A"), taskId: TaskId.make("A") }])
  })

  it("preserves the durable continuation limit and does not require a graph read after exhaustion", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf(
        [reportAt("A", 4, "Running")],
        [],
        [
          commandAt("A", "StartOrContinue", 1),
          commandAt("A", "StartOrContinue", 2),
          commandAt("A", "StartOrContinue", 3)
        ]
      )
    )

    expect(requirement).toBeUndefined()
  })

  it("retains an unresolved read for restart reconciliation without treating it as coverage", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf([reportAt("A", 1, "Running")], [readAt("unresolved-read", 2, null, null)])
    )

    expect(requirement?.pendingReports).toHaveLength(1)
    expect(requirement?.unresolvedReadOperationId).toBe(OperationId.make("unresolved-read"))
  })

  it("selects the latest unresolved operation by journal position across pending reports", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf(
        [reportAt("A", 1, "Running"), reportAt("B", 5, "Running")],
        [readAt("older-read", 2, null, null), readAt("latest-read", 4, null, null)]
      )
    )

    expect(requirement?.unresolvedReadOperationId).toBe(OperationId.make("latest-read"))
  })

  it("does not derive a requirement from another run's report or command", () => {
    const foreignCorrelation = PlannedAttemptExecutorCorrelation.make({
      attemptId: AttemptId.make("foreign-attempt"),
      runId: foreignRunId
    })
    const foreignReport = {
      acceptedAt: JournalPosition.make(1),
      correlation: foreignCorrelation,
      report: PlannedAttemptExecutorReport.cases.Running.make({ correlation: foreignCorrelation }),
      taskId: TaskId.make("foreign-task")
    }
    const foreignCommand = {
      command: "StartOrContinue" as const,
      correlation: foreignCorrelation,
      intendedAt: JournalPosition.make(2)
    }

    expect(executorProgressGraphReadRequirementOf(inputOf([foreignReport], [], [foreignCommand]))).toBeUndefined()
  })

  it("does not reuse a failed read as the unresolved operation", () => {
    const requirement = executorProgressGraphReadRequirementOf(
      inputOf([reportAt("A", 1, "Running")], [readAt("failed-read", 2, 3, "Failed")])
    )

    expect(requirement?.pendingReports).toHaveLength(1)
    expect(requirement?.unresolvedReadOperationId).toBeNull()
  })

  it("keeps a foreign-run observation with the same operation ID unresolved", () => {
    const operation = makeTrackerGraphObservationOperation(
      OperationId.make("shared-progress-read"),
      target,
      [],
      [TaskId.make("A")]
    )
    const graph = projectTrackerSnapshot({ revision: "foreign-progress-graph", tasks: [] })
    expect(graph._tag).toBe("Valid")
    if (graph._tag === "Invalid") return

    const derived = executorProgressGraphReadInputOf(
      [
        { event: taskTrackerReadIntent(operation), position: JournalPosition.make(2), runId },
        {
          event: taskTrackerFactsObservedEvent(
            operation.operationId,
            makeCompleteTaskTrackerFactsObserved(operation, graph.snapshot)
          ),
          position: JournalPosition.make(3),
          runId: foreignRunId
        }
      ],
      runId,
      target
    )

    expect(derived.graphReads[0]?.observation).toEqual({ _tag: "Unresolved" })
    const requirement = executorProgressGraphReadRequirementOf({ ...derived, reports: [reportAt("A", 1, "Running")] })
    expect(requirement?.unresolvedReadOperationId).toBe(OperationId.make("shared-progress-read"))
  })

  it("ignores an intent whose exact journal envelope belongs to another run", () => {
    const operation = makeTrackerGraphObservationOperation(
      OperationId.make("foreign-run-progress-intent"),
      target,
      [],
      [TaskId.make("A")]
    )

    const derived = executorProgressGraphReadInputOf(
      [{ event: taskTrackerReadIntent(operation), position: JournalPosition.make(2), runId: foreignRunId }],
      runId,
      target
    )

    expect(derived.graphReads).toEqual([])
  })
})
