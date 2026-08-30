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
import type { JournalRecord } from "./store.js"
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
import { makeTaskTrackerFactsObservedFromRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import { decideWorkflowRunTermination, makeWorkflowRunBeganRecord } from "./run-lifecycle.js"
import { hasLaterCompleteObservation } from "./run-termination-freshness.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"

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

it("rejects terminal evidence naming the graph intent position instead of its observation", () => {
  const operation = makeTrackerGraphObservationOperation(OperationId.make("wrong-position-finality"), target)
  const snapshot = validSnapshot({
    revision: "wrong-position-finality",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const records = [
    began,
    {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, snapshot)
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(3),
      runId
    }
  ]
  const evidence = RunFinalityEvidence.make({
    ...makeRunFinalityEvidenceForTest(operation, snapshot),
    observedAt: JournalPosition.make(2)
  })
  const decision = decideWorkflowRunTermination(records, runId, "Completed", evidence)

  expect(decision).toMatchObject({
    _tag: "LifecycleTransitionRejected",
    failure: { _tag: "WorkflowRunTerminationEvidenceInvalid", detail: expect.stringContaining("observation position") }
  })
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

it("rejects every independently mismatched terminal evidence dimension at storage", () => {
  const fixture = completedRunFinalityFixture({ runId, target })
  const records: ReadonlyArray<JournalRecord> = [
    makeWorkflowRunBeganRecord(runId, target, policy),
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
  ]
  const foreignTarget = FixtureTarget.make("lifecycle-evidence-foreign-target")
  const cases: ReadonlyArray<{
    readonly evidence: RunFinalityEvidence
    readonly disposition?: "Blocked" | "Cancelled" | "Completed"
    readonly name: string
  }> = [
    {
      name: "beginning target",
      evidence: {
        ...fixture.evidence,
        coverage: { ...fixture.evidence.coverage, target: foreignTarget },
        target: foreignTarget
      }
    },
    { name: "complete coverage", evidence: { ...fixture.evidence, complete: false } },
    {
      name: "operation identity",
      evidence: { ...fixture.evidence, operationId: OperationId.make("lifecycle-evidence-foreign-operation") }
    },
    {
      name: "read shape",
      evidence: {
        ...fixture.evidence,
        readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [TaskId.make("other")] })
      }
    },
    {
      name: "content identity",
      evidence: { ...fixture.evidence, contentIdentity: TrackerRevision.make("lifecycle-evidence-stale-revision") }
    },
    {
      name: "explicit coverage",
      evidence: {
        ...fixture.evidence,
        coverage: { ...fixture.evidence.coverage, explicitlyCoveredTaskIds: [TaskId.make("other")] }
      }
    },
    {
      name: "fact-family manifest",
      evidence: {
        ...fixture.evidence,
        requiredFactFamilies: [
          fixture.evidence.requiredFactFamilies[1],
          fixture.evidence.requiredFactFamilies[0],
          fixture.evidence.requiredFactFamilies[2],
          fixture.evidence.requiredFactFamilies[3],
          fixture.evidence.requiredFactFamilies[4]
        ]
      }
    },
    { name: "root membership", evidence: { ...fixture.evidence, rootTaskId: TaskId.make("other") } },
    { name: "terminal task set", evidence: { ...fixture.evidence, terminalTaskIds: [TaskId.make("root")] } },
    { name: "blocked task set", evidence: { ...fixture.evidence, blockedTaskIds: [TaskId.make("root")] } },
    {
      name: "blocked graph outcome",
      disposition: "Blocked",
      evidence: { ...fixture.evidence, graphOutcome: "Blocked" }
    },
    { name: "unsettled graph outcome", evidence: { ...fixture.evidence, graphOutcome: "Unsettled" } },
    { name: "blocked disposition", disposition: "Blocked", evidence: fixture.evidence },
    { name: "cancelled disposition", disposition: "Cancelled", evidence: fixture.evidence }
  ]

  for (const testCase of cases) {
    const decision = decideWorkflowRunTermination(
      records,
      runId,
      testCase.disposition ?? "Completed",
      testCase.evidence
    )
    expect(decision, testCase.name).toMatchObject({
      _tag: "LifecycleTransitionRejected",
      failure: { _tag: "WorkflowRunTerminationEvidenceInvalid" }
    })
  }
})

it("rejects finality evidence superseded by a later complete graph observation", () => {
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make("lifecycle-initial-complete-observation"),
    target
  )
  const snapshot = validSnapshot({
    revision: "lifecycle-later-complete-observation",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("lifecycle-later-complete-observation"),
    target,
    [operation.operationId]
  )
  const initialObservation = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeCompleteTaskTrackerFactsObserved(operation, snapshot)
  )
  const records: ReadonlyArray<JournalRecord> = [
    makeWorkflowRunBeganRecord(runId, target, policy),
    {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: initialObservation,
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerReadIntent(laterOperation),
      key: intentRecordKey(laterOperation.operationId),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        laterOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(laterOperation, snapshot)
      ),
      key: outcomeRecordKey(laterOperation.operationId),
      position: JournalPosition.make(5),
      runId
    }
  ]

  expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")

  expect(
    decideWorkflowRunTermination(
      records,
      runId,
      "Completed",
      RunFinalityEvidence.make({
        ...makeRunFinalityEvidenceForTest(operation, snapshot),
        observedAt: JournalPosition.make(3)
      })
    )
  ).toMatchObject({
    _tag: "LifecycleTransitionRejected",
    failure: {
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("latest complete graph observation")
    }
  })
})

it("keeps target-A termination evidence current when a later graph belongs to target B", () => {
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make("lifecycle-target-a-terminal-observation"),
    target
  )
  const snapshot = validSnapshot({
    revision: "lifecycle-target-a-terminal-observation",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const foreignTarget = FixtureTarget.make("lifecycle-target-b-later-observation")
  const foreignOperation = makeTrackerGraphObservationOperation(
    OperationId.make("lifecycle-target-b-later-observation"),
    foreignTarget
  )
  const foreignSnapshot = validSnapshot({
    revision: "lifecycle-target-b-later-observation",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const records: ReadonlyArray<JournalRecord> = [
    makeWorkflowRunBeganRecord(runId, target, policy),
    {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, snapshot)
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerReadIntent(foreignOperation),
      key: intentRecordKey(foreignOperation.operationId),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        foreignOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(foreignOperation, foreignSnapshot)
      ),
      key: outcomeRecordKey(foreignOperation.operationId),
      position: JournalPosition.make(5),
      runId
    }
  ]

  expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  expect(
    decideWorkflowRunTermination(records, runId, "Completed", makeRunFinalityEvidenceForTest(operation, snapshot))._tag
  ).toBe("LifecycleTransitionAccepted")
})

it("does not refresh terminal evidence from a later graph when the Run target was never begun", () => {
  const fixture = completedRunFinalityFixture({ runId, target })
  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("lifecycle-no-begin-later-complete-observation"),
    target,
    [fixture.operation.operationId]
  )
  const laterSnapshot = validSnapshot({
    revision: "lifecycle-no-begin-later-complete-observation",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const records: ReadonlyArray<JournalRecord> = [
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
    {
      event: taskTrackerReadIntent(laterOperation),
      key: intentRecordKey(laterOperation.operationId),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        laterOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(laterOperation, laterSnapshot)
      ),
      key: outcomeRecordKey(laterOperation.operationId),
      position: JournalPosition.make(5),
      runId
    }
  ]

  expect(hasLaterCompleteObservation(records, fixture.evidence, JournalPosition.make(6))).toBe(false)
})

it("rejects unchanged finality evidence whose named complete observation is absent", () => {
  const fullOperation = makeTrackerGraphObservationOperation(OperationId.make("lifecycle-absent-full-read"), target)
  const unchangedOperation = makeTrackerGraphObservationOperation(
    OperationId.make("lifecycle-unfounded-reconfirmation"),
    target,
    [fullOperation.operationId]
  )
  const snapshot = validSnapshot({
    revision: "lifecycle-unfounded-reconfirmation",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const fullObservation = taskTrackerFactsObservedEvent(
    fullOperation.operationId,
    makeCompleteTaskTrackerFactsObserved(fullOperation, snapshot)
  )
  const reconfirmation = makeTaskTrackerFactsObservedFromRead(
    [{ event: taskTrackerReadIntent(fullOperation) }, { event: fullObservation }],
    unchangedOperation,
    snapshot
  )
  const unchangedEvidence = RunFinalityEvidence.make({
    ...makeRunFinalityEvidenceForTest(unchangedOperation, snapshot),
    observedAt: JournalPosition.make(3)
  })
  expect(
    decideWorkflowRunTermination(
      [
        makeWorkflowRunBeganRecord(runId, target, policy),
        {
          event: taskTrackerReadIntent(unchangedOperation),
          key: intentRecordKey(unchangedOperation.operationId),
          position: JournalPosition.make(2),
          runId
        },
        {
          event: reconfirmation,
          key: outcomeRecordKey(unchangedOperation.operationId),
          position: JournalPosition.make(3),
          runId
        }
      ],
      runId,
      "Completed",
      unchangedEvidence
    )
  ).toMatchObject({
    _tag: "LifecycleTransitionRejected",
    failure: { detail: expect.stringContaining("link to its earlier complete tracker observation") }
  })
})
