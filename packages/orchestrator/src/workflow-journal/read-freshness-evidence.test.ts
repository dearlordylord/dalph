import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation,
  makeTargetLineageObservationOperation
} from "../workflow/registry/operation.js"
import { GitReadIntentRecordedEvent, taskTrackerReadIntent } from "../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { observeJournalRecordSequenceOperations } from "./record-sequence.js"
import {
  appendReadFreshnessEvidence,
  emptyReadFreshnessEvidence,
  latestTaskObservationAt,
  latestTaskReadAt,
  latestAttemptReadAt
} from "./read-freshness-evidence.js"

const taskId = TaskId.make("freshness-task")
const target = FixtureTarget.make("freshness-target")
const runId = RunId.make("freshness-run")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("freshness-attempt"),
  taskId,
  runId,
  taskRevision: TaskRevision.make("freshness-revision"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/freshness"),
  executor: TaskExecutorLocator.make("executor:freshness"),
  worktree: WorktreeLocator.make("/worktrees/freshness")
})
const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  position: JournalPosition.make(position),
  event,
  key: describeJournalEvent(event).expectedKey,
  runId
})
const specificationRead = (id: number) =>
  makeTaskWorkSpecificationObservationOperation(OperationId.make(`spec-${id}`), target, taskId, [])
const worktreeRead = (id: number) =>
  makeTaskWorktreeObservationOperation({
    operationId: OperationId.make(`worktree-${id}`),
    plannedAttempt: attempt,
    predecessorOperationIds: []
  })
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/freshness.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const targetRead = (id: number) =>
  makeTargetLineageObservationOperation({
    operationId: OperationId.make(`target-${id}`),
    plannedAttempt: attempt,
    integrationTarget,
    predecessorOperationIds: []
  })
const gitReadIntent = (operation: ReturnType<typeof worktreeRead> | ReturnType<typeof targetRead>) =>
  GitReadIntentRecordedEvent.make({
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    operation,
    version: workflowJournalEventVersion
  })

it("keeps older task/read/attempt windows visible after later mixed-family refreshes", () => {
  const first = specificationRead(1)
  const facts = record(
    2,
    taskTrackerFactsObservedEvent(
      first.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(
        first,
        makeTaskWorkSpecification({ taskId, title: "first", body: "first" })
      )
    )
  )
  const graph = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("graph"),
    target,
    [],
    [taskId]
  )
  const records = [
    record(1, taskTrackerReadIntent(first)),
    facts,
    record(3, taskTrackerReadIntent(specificationRead(3))),
    record(4, taskTrackerReadIntent(graph)),
    record(5, gitReadIntent(worktreeRead(5))),
    record(6, gitReadIntent(worktreeRead(6)))
  ]
  const index = records.reduce(appendReadFreshnessEvidence, emptyReadFreshnessEvidence())
  expect(latestTaskReadAt(index, { taskId, target, kind: "ReadTaskWorkSpecification", throughPosition: 2 })).toBe(
    records[0]
  )
  expect(latestTaskReadAt(index, { taskId, target, kind: "ReadTaskWorkSpecification", throughPosition: 6 })).toBe(
    records[2]
  )
  expect(
    latestTaskObservationAt(index, { taskId, target, kind: "FocusedTaskWorkSpecificationFacts", throughPosition: 6 })
  ).toBe(facts)
  expect(
    latestTaskObservationAt(index, {
      taskId,
      target: FixtureTarget.make("foreign"),
      kind: "FocusedTaskWorkSpecificationFacts",
      throughPosition: 6
    })
  ).toBeUndefined()
  expect(latestAttemptReadAt(index, { plannedAttempt: attempt, kind: "ReadTaskWorktree", throughPosition: 5 })).toBe(
    records[4]
  )
  expect(
    latestAttemptReadAt(index, {
      plannedAttempt: { ...attempt, taskRevision: TaskRevision.make("different") },
      kind: "ReadTaskWorktree",
      throughPosition: 6
    })
  ).toBeUndefined()
})

it("keeps warm lookup bounded over 64 and 256 mixed task refreshes", () => {
  const counts = [64, 256].map((size) => {
    let index = emptyReadFreshnessEvidence()
    for (let offset = 0; offset < size; offset += 1) {
      index = appendReadFreshnessEvidence(
        index,
        record(offset * 3 + 1, taskTrackerReadIntent(specificationRead(offset)))
      )
      index = appendReadFreshnessEvidence(index, record(offset * 3 + 2, gitReadIntent(worktreeRead(offset))))
      index = appendReadFreshnessEvidence(index, record(offset * 3 + 3, gitReadIntent(targetRead(offset))))
    }
    let visits = 0
    const stop = observeJournalRecordSequenceOperations((operation) => {
      expect(operation._tag).toBe("IndexedRecordVisit")
      visits += 1
    })
    try {
      expect(
        latestTaskReadAt(index, { taskId, target, kind: "ReadTaskWorkSpecification", throughPosition: size * 3 })
      ).toBeDefined()
      expect(
        latestAttemptReadAt(index, { plannedAttempt: attempt, kind: "ReadTaskWorktree", throughPosition: size * 3 })
      ).toBeDefined()
    } finally {
      stop()
    }
    return visits
  })
  expect(counts).toEqual([2, 2])
})
