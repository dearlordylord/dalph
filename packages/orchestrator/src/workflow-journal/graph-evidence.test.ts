import { expect, it } from "vitest"
import { Option } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { validSnapshot } from "../../test/task-dag.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import {
  makeTaskAttemptPlanOperation,
  makeTrackerGraphObservationOperation,
  type WorkflowOperation
} from "../workflow/registry/operation.js"
import { taskTrackerReadIntent, TaskAttemptPlannedEvent } from "../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { observeJournalRecordSequenceOperations } from "./record-sequence.js"
import {
  appendGraphEvidence,
  emptyGraphEvidence,
  graphSnapshotForObservation,
  lastGraphObservationAt,
  inspectGraphEvidenceStorage
} from "./graph-evidence.js"
import {
  inspectJournalEvidenceStorage,
  journalEvidenceFrom,
  journalGraphSnapshotForObservation,
  journalGraphObservationAt
} from "./record-evidence.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"

const runId = RunId.make("graph-evidence")
const taskId = TaskId.make("graph-A")
const target = FixtureTarget.make("graph-target")
const otherTarget = FixtureTarget.make("other-graph-target")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("graph-A1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/graph-A1"),
  executor: TaskExecutorLocator.make("executor:graph-A1"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("graph-A1"),
  worktree: WorktreeLocator.make("/worktrees/graph-A1")
})
const plan = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("graph-plan-A1"),
  plannedAttempt: attempt,
  predecessorOperationIds: []
})
const snapshot = validSnapshot({
  revision: "graph-content",
  tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
})
const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId
})
const graphRead = (id: string, readTarget = target) =>
  makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    OperationId.make(id),
    readTarget,
    [plan.operationId],
    [taskId]
  )

it("keeps prior graph windows visible and shares exact unchanged snapshot projections", () => {
  const first = graphRead("graph-first")
  const unchanged = graphRead("graph-unchanged")
  const foreign = graphRead("graph-foreign", otherTarget)
  const full = record(
    2,
    taskTrackerFactsObservedEvent(first.operationId, makeCompleteTaskTrackerFactsObserved(first, snapshot))
  )
  const reconfirmed = record(
    4,
    makeTaskTrackerFactsObservedFromRead([record(1, taskTrackerReadIntent(first)), full], unchanged, snapshot)
  )
  const foreignFull = record(
    6,
    taskTrackerFactsObservedEvent(foreign.operationId, makeCompleteTaskTrackerFactsObserved(foreign, snapshot))
  )
  const operations = new Map<OperationId, WorkflowOperation>(
    [plan, first, unchanged, foreign].map((operation) => [operation.operationId, operation])
  )
  const lookup = (id: OperationId) => operations.get(id)
  const initial = appendGraphEvidence(emptyGraphEvidence(), full, lookup)
  const next = appendGraphEvidence(initial, reconfirmed, lookup)
  const latest = appendGraphEvidence(next, foreignFull, lookup)
  expect(lastGraphObservationAt(latest, { throughPosition: 3, target, plannedAttempt: attempt })).toBe(full)
  expect(lastGraphObservationAt(latest, { throughPosition: 6, target, plannedAttempt: attempt })).toBe(reconfirmed)
  expect(lastGraphObservationAt(latest, { throughPosition: 6 })).toBe(foreignFull)
  expect(lastGraphObservationAt(initial, { throughPosition: 6, target })).toBe(full)
  const projected = Option.getOrThrow(graphSnapshotForObservation(initial, full.position, full.position))
  expect(Option.getOrThrow(graphSnapshotForObservation(next, reconfirmed.position, reconfirmed.position))).toBe(
    projected
  )
  expect(Option.isNone(graphSnapshotForObservation(latest, reconfirmed.position, full.position))).toBe(true)
  expect(projected.eligibleTasks().map(({ id }) => id)).toEqual([taskId])
  expect(inspectGraphEvidenceStorage(latest).length).toBeGreaterThan(0)
  const missingFull = appendGraphEvidence(emptyGraphEvidence(), reconfirmed, lookup)
  expect(Option.isNone(graphSnapshotForObservation(missingFull, reconfirmed.position, reconfirmed.position))).toBe(true)
})

it("does not retroactively give an earlier graph a later plan correlation", () => {
  const first = graphRead("graph-before-plan")
  const full = record(
    2,
    taskTrackerFactsObservedEvent(first.operationId, makeCompleteTaskTrackerFactsObserved(first, snapshot))
  )
  const index = appendGraphEvidence(emptyGraphEvidence(), full, (id) => (id === first.operationId ? first : undefined))
  expect(lastGraphObservationAt(index, { throughPosition: 2, target })).toBe(full)
  expect(lastGraphObservationAt(index, { throughPosition: 2, target, plannedAttempt: attempt })).toBeUndefined()
})

it("exposes cutoff-safe graph evidence through the decoded journal index", () => {
  const read = graphRead("graph-journal-index")
  const full = record(
    3,
    taskTrackerFactsObservedEvent(read.operationId, makeCompleteTaskTrackerFactsObserved(read, snapshot))
  )
  const evidence = journalEvidenceFrom([
    record(1, TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })),
    record(2, taskTrackerReadIntent(read)),
    full
  ])
  expect(journalGraphObservationAt(evidence, { target, plannedAttempt: attempt })).toBe(full)
  expect(Option.getOrThrow(journalGraphSnapshotForObservation(evidence, full.position)).eligibleTasks()).toHaveLength(1)
  expect(inspectJournalEvidenceStorage(evidence).length).toBeGreaterThan(inspectGraphEvidenceStorage(emptyGraphEvidence()).length)
})

const retainedSlots = (roots: ReadonlyArray<object>): number => {
  const seen = new Set<object>()
  let slots = 0
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) return
    seen.add(value)
    const keys = Reflect.ownKeys(value)
    slots += keys.length
    for (const key of keys) visit(Reflect.get(value, key))
  }
  for (const root of roots) visit(root)
  return slots
}

it("keeps warm graph lookup constant and retained prefixes shared across 64 and 256 reconfirmations", () => {
  const measurements = [64, 256].map((size) => {
    const first = graphRead("scaling-full")
    const full = record(
      2,
      taskTrackerFactsObservedEvent(first.operationId, makeCompleteTaskTrackerFactsObserved(first, snapshot))
    )
    const prior = [record(1, taskTrackerReadIntent(first)), full]
    let index = appendGraphEvidence(emptyGraphEvidence(), full, (id) => (id === plan.operationId ? plan : first))
    const projected = Option.getOrThrow(graphSnapshotForObservation(index, full.position, full.position))
    const roots = [...inspectGraphEvidenceStorage(index)]
    let last = full
    for (let offset = 0; offset < size; offset += 1) {
      const operation = graphRead(`scaling-${offset}`)
      last = record(offset + 3, makeTaskTrackerFactsObservedFromRead(prior, operation, snapshot))
      index = appendGraphEvidence(index, last, (id) => (id === plan.operationId ? plan : operation))
      roots.push(...inspectGraphEvidenceStorage(index))
    }
    let indexedVisits = 0
    let materializations = 0
    const stop = observeJournalRecordSequenceOperations((operation) => {
      if (operation._tag === "IndexedRecordVisit") indexedVisits += 1
      else materializations += 1
    })
    try {
      expect(lastGraphObservationAt(index, { throughPosition: last.position, target, plannedAttempt: attempt })).toBe(
        last
      )
      expect(Option.getOrThrow(graphSnapshotForObservation(index, last.position, last.position))).toBe(projected)
      expect(materializations).toBe(0)
      return { indexedVisits, retainedSlots: retainedSlots(roots) }
    } finally {
      stop()
    }
  })
  expect(measurements.map(({ indexedVisits }) => indexedVisits)).toEqual([1, 1])
  expect(measurements[1]?.retainedSlots).toBeLessThan((measurements[0]?.retainedSlots ?? 0) * 6)
})
