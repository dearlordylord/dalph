import { RunId, TaskId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import {
  RunFinalityEvidence,
  RunFinalityReadShape,
  requiredRunFinalityFactFamilies
} from "../coordination/frontier/run-finality.js"
import { OperationId } from "../workflow/identity.js"
import { TrackerRevision } from "../authorities/task-tracker/task.js"
import { JournalPosition } from "./identity.js"
import { intentRecordKey, outcomeRecordKey, runCancellationAppliedRecordKey } from "./record-key.js"
import { RunCancellationAppliedEvent } from "../workflow/protocols/run-cancellation/events.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { validSnapshot } from "../../test/task-dag.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import { decideWorkflowRunTermination, makeWorkflowRunBeganRecord } from "./run-lifecycle.js"

const runId = RunId.make("lifecycle-evidence-run")
const target = FixtureTarget.make("lifecycle-evidence-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const evidence = (overrides: Partial<RunFinalityEvidence> = {}): RunFinalityEvidence =>
  RunFinalityEvidence.make({
    blockedTaskIds: [],
    complete: true,
    contentIdentity: TrackerRevision.make("lifecycle-revision"),
    coverage: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [TaskId.make("root")], target },
    graphOutcome: "AllTasksSucceeded",
    operationId: OperationId.make("lifecycle-read"),
    readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [TaskId.make("root")] }),
    requiredFactFamilies: requiredRunFinalityFactFamilies,
    rootTaskId: TaskId.make("root"),
    runId,
    target,
    terminalTaskIds: [],
    observedAt: JournalPosition.make(2),
    ...overrides
  })

it("rejects terminal storage when evidence names another Run", () => {
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const decision = decideWorkflowRunTermination(
    [began],
    runId,
    "Completed",
    evidence({ runId: RunId.make("foreign-run") })
  )

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("journal Run")
    })
  }
})

it("rejects terminal storage when the exact graph read is absent", () => {
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const decision = decideWorkflowRunTermination([began], runId, "Completed", evidence())

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("complete or unchanged tracker observation")
    })
  }
})

it("rejects Cancelled termination evidence observed before cancellation", () => {
  const operation = makeTrackerGraphObservationOperation(OperationId.make("cancelled-finality"), target)
  const snapshot = validSnapshot({
    revision: "cancelled-finality",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const fixture = {
    evidence: RunFinalityEvidence.make({
      blockedTaskIds: [],
      complete: true,
      contentIdentity: snapshot.revision,
      coverage: { ...operation.readShape, target },
      graphOutcome: "Unsettled" as const,
      operationId: operation.operationId,
      readShape: RunFinalityReadShape.make(operation.readShape),
      requiredFactFamilies: requiredRunFinalityFactFamilies,
      rootTaskId: TaskId.make("root"),
      runId,
      target,
      terminalTaskIds: [],
      observedAt: JournalPosition.make(3)
    }),
    intent: taskTrackerReadIntent(operation),
    observation: taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, snapshot)
    ),
    operation
  }
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const cancellation = {
    event: RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    key: runCancellationAppliedRecordKey,
    position: JournalPosition.make(4),
    runId
  }
  const decision = decideWorkflowRunTermination(
    [
      began,
      {
        event: fixture.intent,
        key: intentRecordKey(fixture.operation.operationId),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: fixture.observation,
        key: outcomeRecordKey(fixture.operation.operationId),
        position: JournalPosition.make(3),
        runId
      },
      cancellation
    ],
    runId,
    "Cancelled",
    fixture.evidence
  )

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("after RunCancellationApplied")
    })
  }
})

it("rejects stale Completed evidence when cancellation was applied after the observation", () => {
  const fixture = completedRunFinalityFixture({ runId, target })
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const cancellation = {
    event: RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    key: runCancellationAppliedRecordKey,
    position: JournalPosition.make(4),
    runId
  }
  const decision = decideWorkflowRunTermination(
    [
      began,
      {
        event: fixture.intent,
        key: intentRecordKey(fixture.operation.operationId),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: fixture.observation,
        key: outcomeRecordKey(fixture.operation.operationId),
        position: JournalPosition.make(3),
        runId
      },
      cancellation
    ],
    runId,
    "Completed",
    fixture.evidence
  )

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("after RunCancellationApplied")
    })
  }
})

it("accepts Completed when termination wins before cancellation is applied", () => {
  const fixture = completedRunFinalityFixture({ runId, target })
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const decision = decideWorkflowRunTermination(
    [
      began,
      {
        event: fixture.intent,
        key: intentRecordKey(fixture.operation.operationId),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: fixture.observation,
        key: outcomeRecordKey(fixture.operation.operationId),
        position: JournalPosition.make(3),
        runId
      }
    ],
    runId,
    "Completed",
    fixture.evidence
  )

  expect(decision._tag).toBe("LifecycleTransitionAccepted")
})

it("rejects a different parentless task standing in for the selected Run root", () => {
  const operation = makeTrackerGraphObservationOperation(OperationId.make("exact-root-finality"), target)
  const snapshot = validSnapshot({
    revision: "exact-root-finality",
    rootTaskId: "root",
    tasks: [
      { id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
      {
        id: "foreign-parentless",
        lifecycle: { _tag: "CompletedSuccessfully" },
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const observation = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeCompleteTaskTrackerFactsObserved(operation, snapshot)
  )
  const validEvidence = RunFinalityEvidence.make({
    ...makeRunFinalityEvidenceForTest(operation, snapshot),
    observedAt: JournalPosition.make(3)
  })
  const evidenceWithWrongRoot = RunFinalityEvidence.make({
    ...validEvidence,
    rootTaskId: TaskId.make("foreign-parentless")
  })
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const decision = decideWorkflowRunTermination(
    [
      began,
      {
        event: taskTrackerReadIntent(operation),
        key: intentRecordKey(operation.operationId),
        position: JournalPosition.make(2),
        runId
      },
      { event: observation, key: outcomeRecordKey(operation.operationId), position: JournalPosition.make(3), runId }
    ],
    runId,
    "Completed",
    evidenceWithWrongRoot
  )

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("exact tracker-selected Run root")
    })
  }
})

const makeRunFinalityEvidenceForTest = (
  operation: ReturnType<typeof makeTrackerGraphObservationOperation>,
  snapshot: ReturnType<typeof validSnapshot>
) =>
  RunFinalityEvidence.make({
    blockedTaskIds: [],
    complete: true,
    contentIdentity: snapshot.revision,
    coverage: { ...operation.readShape, target },
    graphOutcome: "AllTasksSucceeded",
    operationId: operation.operationId,
    readShape: RunFinalityReadShape.make(operation.readShape),
    requiredFactFamilies: requiredRunFinalityFactFamilies,
    rootTaskId: TaskId.make("root"),
    runId,
    target,
    terminalTaskIds: [],
    observedAt: JournalPosition.make(3)
  })
