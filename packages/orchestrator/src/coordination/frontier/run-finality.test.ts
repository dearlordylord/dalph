import { RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { expect, it } from "vitest"
import { validSnapshot } from "../../../test/task-dag.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import {
  makeRunFinalityEvidence,
  runFinalityEvidenceMatches,
  runGraphFactsOutcome,
  runTerminationDispositionOf,
  RunFinalityEvidence,
  RunFinalityReadShape
} from "./run-finality.js"

const target = FixtureTarget.make("run-finality-fixture")
const runId = RunId.make("run-finality-fixture")
const operationId = OperationId.make("finality-read-1")
const observedAt = JournalPosition.make(8)
const readShape = RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [] })

const blockedGraph = validSnapshot({
  revision: "blocked-revision",
  rootTaskId: "root",
  tasks: [
    { id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
    { id: "A", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: "root", prerequisiteIds: [] },
    { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: ["A"] }
  ]
})

it("requires a conclusive dependency closure before classifying a graph Blocked", () => {
  expect(runGraphFactsOutcome(blockedGraph)).toEqual({
    blockedTaskIds: [TaskId.make("A"), TaskId.make("B")],
    graphOutcome: "Blocked",
    terminalTaskIds: [TaskId.make("A")]
  })

  const unrelatedOpenTaskGraph = validSnapshot({
    revision: "unsettled-revision",
    tasks: [
      { id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "A", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: "root", prerequisiteIds: [] },
      { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] }
    ]
  })
  expect(runGraphFactsOutcome(unrelatedOpenTaskGraph).graphOutcome).toBe("Unsettled")
})

it("applies terminal disposition precedence from the graph facts", () => {
  expect(runTerminationDispositionOf("AllTasksSucceeded", true)).toBe("Completed")
  expect(runTerminationDispositionOf("Blocked", true)).toBe("Cancelled")
  expect(runTerminationDispositionOf("Blocked", false)).toBe("Blocked")
  expect(runTerminationDispositionOf("Unsettled", false)).toBeUndefined()
})

it("constructs exact terminal evidence without a default read shape", () => {
  const evidence = makeRunFinalityEvidence({
    observedAt,
    operationId,
    readShape,
    rootTaskId: TaskId.make("root"),
    runId,
    snapshot: blockedGraph,
    target
  })

  expect(evidence).toMatchObject({
    complete: true,
    contentIdentity: TrackerRevision.make("blocked-revision"),
    graphOutcome: "Blocked",
    rootTaskId: TaskId.make("root"),
    runId,
    target,
    terminalTaskIds: [TaskId.make("A")],
    blockedTaskIds: [TaskId.make("A"), TaskId.make("B")],
    observedAt
  })
  expect(
    runFinalityEvidenceMatches(evidence, {
      observedAt,
      operationId,
      readShape,
      revision: TrackerRevision.make("blocked-revision"),
      rootTaskId: TaskId.make("root"),
      runId,
      target
    })
  ).toBe(true)
  expect(
    runFinalityEvidenceMatches(evidence, {
      observedAt: JournalPosition.make(9),
      operationId,
      readShape,
      revision: TrackerRevision.make("blocked-revision"),
      rootTaskId: TaskId.make("root"),
      runId,
      target
    })
  ).toBe(false)
})

it("rejects missing root, incomplete family coverage, and mismatched graph identity", () => {
  const evidence = makeRunFinalityEvidence({
    observedAt,
    operationId,
    readShape,
    rootTaskId: TaskId.make("root"),
    runId,
    snapshot: blockedGraph,
    target
  })

  expect(
    Schema.is(RunFinalityEvidence)({
      ...evidence,
      requiredFactFamilies: [
        "TaskLifecycles",
        "TaskIdentities",
        "TaskPrerequisites",
        "TaskGroupings",
        "TaskTargetMembership"
      ]
    })
  ).toBe(false)
  expect(
    Schema.is(RunFinalityEvidence)({
      ...evidence,
      readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [TaskId.make("different-coverage")] })
    })
  ).toBe(false)
  expect(
    runFinalityEvidenceMatches(evidence, {
      observedAt,
      operationId,
      readShape,
      revision: TrackerRevision.make("different-revision"),
      rootTaskId: TaskId.make("root"),
      runId,
      target
    })
  ).toBe(false)
})
