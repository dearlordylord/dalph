import { expect, it } from "vitest"
import {
  completionTaskCandidateAncestryReadOperationIdFor,
  completionTaskRequestLookupOperationIdFor
} from "../workflow/protocols/integration-finality/completion-task-operation-identity.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../authorities/task-tracker/claim-mutation.js"
import {
  makeCompletionTaskFactsObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../workflow/registry/operation.js"
import {
  TaskClaimReleasedEvent,
  TaskClaimReleaseIntendedEvent,
  taskTrackerReadIntent
} from "../workflow/registry/event.js"
import {
  TaskTrackerFactsObservedEvent,
  makeFocusedTaskWorkSpecificationFactsObserved
} from "../workflow/task-tracker-facts/observation.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import {
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequestOrdinal
} from "../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import { JournalPosition, JournalRecordKey } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  journalEvidenceBefore,
  journalEvidenceFrom,
  journalOperationById,
  journalRetainedExecutorResponsibilitySubjects,
  journalRecordByPosition,
  journalRestartReadIntents,
  journalRecordsForOperationId,
  journalRecordsForOperationIdKind,
  journalRecordsForTask,
  journalRecordsForTaskKind,
  journalRecordsOfKind
} from "./record-evidence.js"
import { observeRetainedExecutorResponsibilityProjection } from "./retained-executor-responsibility.js"
import { observeJournalRecordSequenceOperations } from "./record-sequence.js"

it("indexes a completion tracker read by its exact nested request operation without scanning unrelated records", () => {
  const request = integrationFinalityFixture.completionRequest
  const purpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
    authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
  })
  const focusedOperation = makeCompletionTaskFactsObservationOperation(
    request,
    integrationFinalityFixture.target,
    purpose
  )
  const focusedEvent = taskTrackerReadIntent(focusedOperation)
  const focusedRecord = (position: number, key: JournalRecordKey = describeJournalEvent(focusedEvent).expectedKey) => ({
    event: focusedEvent,
    key,
    position: JournalPosition.make(position),
    runId: integrationFinalityFixture.runId
  })
  const unrelatedRecord = (position: number): JournalRecord => {
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`nested-completion-unrelated-${position}`),
      integrationFinalityFixture.target
    )
    const event = taskTrackerReadIntent(operation)
    return {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(position),
      runId: integrationFinalityFixture.runId
    }
  }

  const visits = [64, 256].map((size) => {
    const records = [...Array.from({ length: size }, (_, index) => unrelatedRecord(index + 1)), focusedRecord(size + 1)]
    const indexed = journalEvidenceFrom(records)
    const operations: Array<Parameters<Parameters<typeof observeJournalRecordSequenceOperations>[0]>[0]> = []
    const stop = observeJournalRecordSequenceOperations((operation) => operations.push(operation))
    try {
      expect(Array.from(journalRecordsForOperationId(indexed, request.operationId))).toEqual([records.at(-1)])
    } finally {
      stop()
    }
    return operations
  })

  expect(visits[0]).toEqual(visits[1])
  expect(visits[0]).toEqual([{ _tag: "IndexedRecordVisit" }])

  const ancestryOperationId = completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
  const indexed = journalEvidenceFrom([focusedRecord(1)])
  expect(
    Array.from(journalRecordsForOperationIdKind(indexed, ancestryOperationId, "TaskTrackerReadIntentRecorded"))
  ).toEqual([focusedRecord(1)])
  expect(
    Array.from(journalRecordsForOperationIdKind(indexed, ancestryOperationId, "TaskTrackerFactsObserved"))
  ).toEqual([])
  expect(
    Array.from(
      journalRecordsForOperationIdKind(
        indexed,
        completionTaskRequestLookupOperationIdFor(request, CompletionTaskRequestOrdinal.make(1)),
        "TaskTrackerReadIntentRecorded"
      )
    )
  ).toEqual([])
})

it("keeps nested completion request correlations exact across malformed identities, collisions, and duplicate keys", () => {
  const request = integrationFinalityFixture.completionRequest
  const purpose = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
    authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
  })
  const exactOperation = makeCompletionTaskFactsObservationOperation(
    request,
    integrationFinalityFixture.target,
    purpose
  )
  const exactEvent: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
    readonly operation: typeof exactOperation
  } = { _tag: "TaskTrackerReadIntentRecorded", operation: exactOperation, version: workflowJournalEventVersion }
  const malformedRequestOperationId = OperationId.make("nested-completion-malformed-request")
  const malformedEvent: JournalRecord["event"] = {
    ...exactEvent,
    operation: {
      ...exactEvent.operation,
      request: { ...exactEvent.operation.request, operationId: malformedRequestOperationId }
    }
  }
  const collidingOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    request.operationId,
    integrationFinalityFixture.target
  )
  const collidingEvent = taskTrackerReadIntent(collidingOperation)
  const duplicateKey = JournalRecordKey.make("nested-completion-duplicate-key")
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: exactEvent,
      key: duplicateKey,
      position: JournalPosition.make(1),
      runId: integrationFinalityFixture.runId
    },
    {
      event: malformedEvent,
      key: duplicateKey,
      position: JournalPosition.make(2),
      runId: integrationFinalityFixture.runId
    },
    {
      event: collidingEvent,
      key: describeJournalEvent(collidingEvent).expectedKey,
      position: JournalPosition.make(3),
      runId: integrationFinalityFixture.runId
    }
  ]
  const indexed = journalEvidenceFrom(records)

  expect(Array.from(journalRecordsForOperationId(indexed, request.operationId))).toEqual(
    Array.from(journalRecordsForOperationId(records, request.operationId))
  )
  expect(Array.from(journalRecordsForOperationId(indexed, request.operationId))).toEqual([records[0], records[2]])
  expect(Array.from(journalRecordsForOperationId(indexed, malformedRequestOperationId))).toEqual([records[1]])
  expect(Array.from(journalRecordsForOperationId(indexed, exactOperation.operationId))).toEqual([
    records[0],
    records[1]
  ])
  for (const operationId of [request.operationId, malformedRequestOperationId, exactOperation.operationId]) {
    expect(Array.from(journalRecordsForOperationIdKind(indexed, operationId, "TaskTrackerReadIntentRecorded"))).toEqual(
      Array.from(journalRecordsForOperationIdKind(records, operationId, "TaskTrackerReadIntentRecorded"))
    )
  }
  expect(
    Array.from(journalRecordsForOperationIdKind(indexed, request.operationId, "TaskTrackerFactsObserved"))
  ).toEqual([])
  expect(
    Array.from(
      journalRecordsForOperationIdKind(
        indexed,
        completionTaskCandidateAncestryReadOperationIdFor(request, purpose),
        "TaskTrackerReadIntentRecorded"
      )
    )
  ).toEqual([records[0]])
})

it("indexes a release intent by its nested claim operation at every safe cutoff", () => {
  const runId = RunId.make("nested-release-correlation-run")
  const claimOperationId = OperationId.make("nested-release-claim-operation")
  const release = TaskClaimRelease.make({
    claim: ActiveTaskClaim.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make("nested-release-owner"),
      taskId: TaskId.make("nested-release-task"),
      token: ClaimToken.make("nested-release-token")
    }),
    operationId: OperationId.make("nested-release-operation")
  })
  const operation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [claimOperationId],
    release
  })
  const intent = {
    event: TaskClaimReleaseIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
    key: JournalRecordKey.make("nested-release-intent"),
    position: JournalPosition.make(1),
    runId
  }
  const later = { ...intent, key: JournalRecordKey.make("nested-release-later"), position: JournalPosition.make(2) }
  const complete = journalEvidenceFrom([intent, later])
  const earlier = journalEvidenceBefore(complete, JournalPosition.make(2))

  expect(Array.from(journalRecordsForOperationId(earlier, claimOperationId))).toEqual([intent])
  expect(Array.from(journalRecordsForOperationId(complete, claimOperationId))).toEqual([intent, later])
})

it("indexes a released claim by both exact operation identities without scanning unrelated releases", () => {
  const runId = RunId.make("nested-released-correlation-run")
  const releaseRecord = (
    position: number,
    claimOperationId: OperationId,
    releaseOperationId: OperationId,
    key: JournalRecordKey
  ): JournalRecord => {
    const claim = ActiveTaskClaim.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make(`nested-released-owner:${position}`),
      taskId: TaskId.make(`nested-released-task:${position}`),
      token: ClaimToken.make(`nested-released-token:${position}`)
    })
    return {
      event: TaskClaimReleasedEvent.make({
        release: TaskClaimRelease.make({ claim, operationId: releaseOperationId }),
        version: workflowJournalEventVersion
      }),
      key,
      position: JournalPosition.make(position),
      runId
    }
  }
  const exactClaimOperationId = OperationId.make("nested-released-exact-claim")
  const exactReleaseOperationId = OperationId.make("nested-released-exact-release")
  const visits = [64, 256].map((size) => {
    const duplicateKey = JournalRecordKey.make(`nested-released-duplicate-key:${size}`)
    const records = [
      ...Array.from({ length: size }, (_, index) =>
        releaseRecord(
          index + 1,
          OperationId.make(`nested-released-foreign-claim:${index}`),
          OperationId.make(`nested-released-foreign-release:${index}`),
          duplicateKey
        )
      ),
      releaseRecord(size + 1, exactClaimOperationId, exactReleaseOperationId, duplicateKey)
    ]
    const indexed = journalEvidenceFrom(records)
    for (const operationId of [exactClaimOperationId, exactReleaseOperationId]) {
      expect(Array.from(journalRecordsForOperationId(indexed, operationId))).toEqual(
        Array.from(journalRecordsForOperationId(records, operationId))
      )
    }
    expect(Array.from(journalRecordsForOperationId(indexed, OperationId.make("nested-released-absent")))).toEqual([])
    const operations: Array<string> = []
    const stop = observeJournalRecordSequenceOperations((operation) => operations.push(operation._tag))
    try {
      expect(Array.from(journalRecordsForOperationId(indexed, exactReleaseOperationId))).toEqual([records.at(-1)])
      expect(Array.from(journalRecordsForOperationId(indexed, exactClaimOperationId))).toEqual([records.at(-1)])
    } finally {
      stop()
    }
    return operations
  })

  expect(visits).toEqual([
    ["IndexedRecordVisit", "IndexedRecordVisit"],
    ["IndexedRecordVisit", "IndexedRecordVisit"]
  ])
})

it("indexes promotion success by its nested planned-attempt task with constant exact lookup work", () => {
  const success = integrationFinalityFixture.promotionSuccess
  const exactTaskId = success.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId
  const promotionFor = (taskId: TaskId, position: number, key: JournalRecordKey): JournalRecord => ({
    event: {
      ...success,
      correlation: {
        ...success.correlation,
        qualifiedCandidate: {
          ...success.correlation.qualifiedCandidate,
          run: {
            ...success.correlation.qualifiedCandidate.run,
            session: {
              ...success.correlation.qualifiedCandidate.run.session,
              plannedAttempt: { ...success.correlation.qualifiedCandidate.run.session.plannedAttempt, taskId }
            }
          }
        }
      }
    },
    key,
    position: JournalPosition.make(position),
    runId: integrationFinalityFixture.runId
  })
  const visits = [64, 256].map((size) => {
    const duplicateKey = JournalRecordKey.make(`nested-promotion-task-key:${size}`)
    const records = [
      ...Array.from({ length: size }, (_, index) =>
        promotionFor(TaskId.make(`nested-promotion-foreign-task:${index}`), index + 1, duplicateKey)
      ),
      promotionFor(exactTaskId, size + 1, duplicateKey)
    ]
    const indexed = journalEvidenceFrom(records)
    expect(Array.from(journalRecordsForTaskKind(indexed, exactTaskId, "TargetPromotionObservedSuccess"))).toEqual(
      Array.from(journalRecordsForTaskKind(records, exactTaskId, "TargetPromotionObservedSuccess"))
    )
    const operations: Array<string> = []
    const stop = observeJournalRecordSequenceOperations((operation) => operations.push(operation._tag))
    try {
      expect(Array.from(journalRecordsForTaskKind(indexed, exactTaskId, "TargetPromotionObservedSuccess"))).toEqual([
        records.at(-1)
      ])
    } finally {
      stop()
    }
    return operations
  })

  expect(visits[0]).toEqual(visits[1])
  expect(visits[0]).toEqual(["IndexedRecordVisit"])
})

it("indexes restart read intents by request and phase", () => {
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("attempt-restart:request%3Aone:graph:after:7"),
    FixtureTarget.make("restart-read-target")
  )
  const record = {
    event: taskTrackerReadIntent(operation),
    key: JournalRecordKey.make("restart-read-intent"),
    position: JournalPosition.make(1),
    runId: RunId.make("restart-read-run")
  }
  const indexed = journalEvidenceFrom([record])

  expect(Array.from(journalRestartReadIntents(indexed, "request:one", "graph"))).toEqual([record])
  expect(Array.from(journalRestartReadIntents(indexed, "request:one", "claim"))).toEqual([])
})

it("an earlier evidence window still finds the operation before a later repeated occurrence", () => {
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("window-operation"),
    FixtureTarget.make("window-target")
  )
  const records = [1, 2].map((position) => ({
    event: taskTrackerReadIntent(operation),
    key: JournalRecordKey.make(`window-${position}`),
    position: JournalPosition.make(position),
    runId: RunId.make("window-run")
  }))
  const complete = journalEvidenceFrom(records)
  const earlier = journalEvidenceBefore(complete, JournalPosition.make(2))
  expect(journalOperationById(earlier, operation.operationId)).toEqual(operation)
  expect(journalRecordByPosition(earlier, JournalPosition.make(2))).toBeUndefined()
  expect(Array.from(journalRecordsOfKind(earlier, "TaskTrackerReadIntentRecorded"))).toEqual([records[0]])
  expect(Array.from(journalRecordsOfKind(complete, "TaskTrackerReadIntentRecorded"))).toEqual(records)
})

it("indexes an operation's exact task without visiting another task's records", () => {
  const runId = RunId.make("task-index-run")
  const target = FixtureTarget.make("task-index-target")
  const taskA = TaskId.make("task-index-a")
  const taskB = TaskId.make("task-index-b")
  const operations = [taskA, taskB].map((taskId, index) =>
    makeTaskWorkSpecificationObservationOperation(OperationId.make(`task-index-${index}`), target, taskId)
  )
  const records = operations.map((operation, index) => ({
    event: taskTrackerReadIntent(operation),
    key: JournalRecordKey.make(`task-index-${index}`),
    position: JournalPosition.make(index + 1),
    runId
  }))
  const evidence = journalEvidenceFrom(records)

  expect(Array.from(journalRecordsForTask(evidence, taskA))).toEqual([records[0]])
  expect(Array.from(journalRecordsForTask(evidence, taskB))).toEqual([records[1]])
})

it("indexes a focused observation by its covered task identity", () => {
  const runId = RunId.make("focused-task-index-run")
  const taskId = TaskId.make("focused-task-index")
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("focused-task-index-operation"),
    FixtureTarget.make("focused-task-index-target"),
    taskId
  )
  const specification = makeTaskWorkSpecification({ body: "Indexed instructions.", taskId, title: "Indexed" })
  const record = {
    event: TaskTrackerFactsObservedEvent.make({
      observation: makeFocusedTaskWorkSpecificationFactsObserved(operation, specification),
      operationId: operation.operationId,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("focused-task-index-record"),
    position: JournalPosition.make(1),
    runId
  }

  expect(Array.from(journalRecordsForTask(journalEvidenceFrom([record]), taskId))).toEqual([record])
  expect(Array.from(journalRecordsForTask([record], taskId))).toEqual([record])
})

it("keeps the aggregate retained-subject query bounded after 64 and 256 retired executor responsibilities", () => {
  const runId = RunId.make("retained-aggregate-run")
  const plan = (id: number) =>
    PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`retained-aggregate-${id}`),
      baseSha: GitCommitSha.make("1".repeat(40)),
      branch: TaskBranchRef.make(`refs/heads/retained-aggregate-${id}`),
      executor: TaskExecutorLocator.make("executor:retained-aggregate"),
      runId,
      taskId: TaskId.make(`retained-aggregate-task-${id}`),
      taskRevision: TaskRevision.make("retained-aggregate-revision"),
      worktree: WorktreeLocator.make(`/worktrees/retained-aggregate-${id}`)
    })
  const record = (event: JournalRecord["event"], position: number): JournalRecord => ({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId
  })
  const visits = [64, 256].map((size) => {
    const retained = plan(0)
    const records: Array<JournalRecord> = [
      record(
        PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: retained,
          version: workflowJournalEventVersion
        }),
        1
      )
    ]
    for (let id = 1; id <= size; id += 1) {
      const retired = plan(id)
      records.push(
        record(
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt: retired,
            version: workflowJournalEventVersion
          }),
          records.length + 1
        ),
        record(
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
            report: {
              _tag: "ExecutorWorkTerminal",
              correlation: plannedAttemptExecutorCorrelation(retired),
              result: { _tag: "Completed" }
            },
            version: workflowJournalEventVersion
          }),
          records.length + 2
        )
      )
    }
    const evidence = journalEvidenceFrom(records)
    let count = 0
    const stop = observeRetainedExecutorResponsibilityProjection(() => {
      count += 1
    })
    try {
      expect(journalRetainedExecutorResponsibilitySubjects(evidence, runId)).toEqual([
        { beganAt: JournalPosition.make(1), plannedAttempt: retained }
      ])
    } finally {
      stop()
    }
    return count
  })
  expect(visits).toEqual([2, 2])
})
