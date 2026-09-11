import { expect, it } from "vitest"
import fc from "fast-check"
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
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { OperationId } from "../workflow/identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  AttemptChoiceRequestId,
  AttemptImplementationAbandonedEvent
} from "../workflow/protocols/attempt-choice/events.js"
import { PlannedAttemptReplacedEvent } from "../workflow/protocols/attempt-choice/replacement-events.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import { makeTaskAttemptPlanOperation } from "../workflow/registry/operation.js"
import { currentAcceptedPlannedAttemptExecutorLifecycleFor } from "../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendRetainedExecutorResponsibilitySubjects,
  emptyRetainedExecutorResponsibilitySubjects,
  inspectRetainedExecutorResponsibilityStorage,
  observeRetainedExecutorResponsibilityProjection,
  retainedExecutorResponsibilitySubjectsAt
} from "./retained-executor-responsibility.js"

const runId = RunId.make("retained-subjects")
const foreignRun = RunId.make("retained-foreign")
const planFor = (id: number, run = runId): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`retained-${id}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/retained-${id}`),
    executor: TaskExecutorLocator.make(`executor:retained-${id}`),
    runId: run,
    taskId: TaskId.make(`retained-task-${id}`),
    taskRevision: TaskRevision.make("retained-specification"),
    worktree: WorktreeLocator.make(`/worktrees/retained-${id}`)
  })
const claimFor = (plan: PlannedTaskAttempt) =>
  ActiveTaskClaim.make({
    operationId: OperationId.make(`retained-claim-${plan.attemptId}`),
    owner: ClaimOwner.make("dalph"),
    taskId: plan.taskId,
    token: ClaimToken.make(`token-${plan.attemptId}`)
  })
type Kind = "Began" | "Executing" | "Safe" | "Terminal" | "Ambiguous" | "ObservedTerminal" | "Abandoned"
const occurrence = (kind: Kind, plan: PlannedTaskAttempt, position: number): JournalRecord => {
  const correlation = plannedAttemptExecutorCorrelation(plan)
  const version = workflowJournalEventVersion
  const event =
    kind === "Began"
      ? PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt: plan, version })
      : kind === "Abandoned"
        ? AttemptImplementationAbandonedEvent.make({
            expectedClaim: claimFor(plan),
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
            requestId: AttemptChoiceRequestId.make({ runId: plan.runId, nonce: `abandoned-${position}` }),
            subject: {
              plannedAttempt: plan,
              observedTaskRevision: TaskRevision.make("changed-retained-specification")
            },
            version
          })
        : kind === "Ambiguous" || kind === "ObservedTerminal"
          ? PlannedAttemptExecutorStateObservedEvent.make({
              observation:
                kind === "Ambiguous"
                  ? { _tag: "ExecutorStateUnreadable" }
                  : {
                      _tag: "ExactExecutorReport",
                      report: { _tag: "ExecutorWorkTerminal", correlation, result: { _tag: "Completed" } }
                    },
              occurrenceClassification: "NonActionOccurrence",
              ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(position),
              plannedAttempt: plan,
              version
            })
          : PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: PlannedAttemptExecutorReportOrdinal.make(position),
              report:
                kind === "Executing"
                  ? { _tag: "ExecutorWorkExecuting", correlation }
                  : kind === "Safe"
                    ? { _tag: "ExecutorWorkSafelySuspended", correlation }
                    : { _tag: "ExecutorWorkTerminal", correlation, result: { _tag: "Completed" } },
              version
            })
  return {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId: plan.runId
  }
}
const appendAll = (records: ReadonlyArray<JournalRecord>) =>
  records.reduce(appendRetainedExecutorResponsibilitySubjects, emptyRetainedExecutorResponsibilitySubjects())
const idsAt = (index: ReturnType<typeof appendAll>, throughPosition: number, run = runId) =>
  retainedExecutorResponsibilitySubjectsAt(index, { runId: run, throughPosition }).map(
    ({ plannedAttempt }) => plannedAttempt.attemptId
  )

it("keeps Safe and ambiguous responsibilities but removes accepted Terminal or abandonment", () => {
  const plan = planFor(0)
  const kinds: ReadonlyArray<Kind> = ["Began", "Executing", "Safe", "Ambiguous", "ObservedTerminal", "Terminal"]
  const records = kinds.map((kind, offset) => occurrence(kind, plan, offset + 1))
  const index = appendAll(records)
  for (const cutoff of [1, 2, 3, 4, 5]) expect(idsAt(index, cutoff)).toEqual([plan.attemptId])
  expect(idsAt(index, 6)).toEqual([])
  const refreshingAt = (cutoff: number) =>
    retainedExecutorResponsibilitySubjectsAt(index, { runId, throughPosition: cutoff }).filter(
      ({ plannedAttempt }) =>
        currentAcceptedPlannedAttemptExecutorLifecycleFor(records.slice(0, cutoff), plannedAttempt)._tag === "Executing"
    )
  expect(refreshingAt(2).map(({ plannedAttempt }) => plannedAttempt.attemptId)).toEqual([plan.attemptId])
  expect(refreshingAt(3)).toEqual([])
  // Historical origin remains in the journal, but no longer appears in this current-subject query.
  expect(records[0]?.event._tag).toBe("PlannedAttemptExecutorWorkResponsibilityBegan")
  expect(idsAt(appendAll([occurrence("Began", plan, 1), occurrence("Abandoned", plan, 2)]), 2)).toEqual([])
})

it("removes only the replaced responsibility and does not begin its successor implicitly", () => {
  const plan = planFor(0)
  const claim = claimFor(plan)
  const successor = PlannedTaskAttempt.make({
    ...planFor(1),
    taskId: plan.taskId,
    taskRevision: TaskRevision.make("changed-retained-specification")
  })
  const witnesses = {
    claimObservationOperationId: OperationId.make("replacement-claim"),
    graphObservationOperationId: OperationId.make("replacement-graph"),
    oldWorktreeObservationOperationId: OperationId.make("replacement-worktree"),
    specificationObservationOperationId: OperationId.make("replacement-specification"),
    targetLineageObservationOperationId: OperationId.make("replacement-target")
  }
  const event = PlannedAttemptReplacedEvent.make({
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    requestId: AttemptChoiceRequestId.make({ runId, nonce: "retained-replacement" }),
    subject: { plannedAttempt: plan, observedTaskRevision: successor.taskRevision },
    successorPlan: makeTaskAttemptPlanOperation({
      operationId: OperationId.make("retained-successor-plan"),
      plannedAttempt: successor,
      predecessorOperationIds: [claim.operationId, ...Object.values(witnesses)]
    }),
    version: workflowJournalEventVersion,
    witness: {
      ...witnesses,
      expectedClaim: claim,
      oldWorktreeProof: {
        _tag: "PlannedWorktreeReady",
        baseSha: plan.baseSha,
        branch: plan.branch,
        headSha: plan.baseSha,
        worktree: plan.worktree
      },
      quiescenceProof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
      targetHeadSha: successor.baseSha
    }
  })
  const replacement: JournalRecord = {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(2),
    runId
  }
  const index = appendAll([occurrence("Began", plan, 1), replacement, occurrence("Began", successor, 3)])
  expect(idsAt(index, 1)).toEqual([plan.attemptId])
  expect(idsAt(index, 2)).toEqual([])
  expect(idsAt(index, 3)).toEqual([successor.attemptId])
})

it("matches an independent chronological ownership oracle at older cutoffs and across runs", () => {
  const kind = fc.constantFrom<Kind>(
    "Began",
    "Executing",
    "Safe",
    "Terminal",
    "Ambiguous",
    "ObservedTerminal",
    "Abandoned"
  )
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          kind,
          id: fc.integer({ min: 0, max: 4 }),
          foreign: fc.boolean(),
          mismatchedEnvelope: fc.boolean()
        }),
        { maxLength: 80 }
      ),
      fc.nat(80),
      (steps, cutoff) => {
        const records = steps.map((step, offset) => {
          const record = occurrence(step.kind, planFor(step.id, step.foreign ? foreignRun : runId), offset + 1)
          return step.mismatchedEnvelope ? { ...record, runId: step.foreign ? runId : foreignRun } : record
        })
        const index = appendAll(records)
        for (const run of [runId, foreignRun]) {
          const retained = new Map<number, { id: AttemptId; beganAt: number }>()
          steps.slice(0, cutoff).forEach((step, offset) => {
            if (step.mismatchedEnvelope || (step.foreign ? foreignRun : runId) !== run) return
            if (step.kind === "Began")
              retained.set(step.id, { id: planFor(step.id, run).attemptId, beganAt: offset + 1 })
            if (step.kind === "Terminal" || step.kind === "Abandoned") retained.delete(step.id)
          })
          const expected = [...retained.values()]
            .sort((left, right) => left.beganAt - right.beganAt)
            .map(({ id }) => id)
          expect(idsAt(index, cutoff, run)).toEqual(expected)
          expect(idsAt(appendAll(records.slice(0, cutoff)), cutoff, run)).toEqual(expected)
        }
      }
    )
  )
})

it.each([64, 256])("bounds a warm current-subject query after %i settled responsibilities", (size) => {
  const records = Array.from({ length: size }, (_, id) => [
    occurrence("Began", planFor(id), id * 2 + 1),
    occurrence("Terminal", planFor(id), id * 2 + 2)
  ]).flat()
  const retainedPlan = planFor(size)
  const index = appendAll([
    ...records,
    occurrence("Began", retainedPlan, size * 2 + 1),
    occurrence("Safe", retainedPlan, size * 2 + 2)
  ])
  const operations: Array<string> = []
  const stop = observeRetainedExecutorResponsibilityProjection((operation) => operations.push(operation))
  try {
    expect(idsAt(index, size * 2 + 2)).toEqual([retainedPlan.attemptId])
  } finally {
    stop()
  }
  expect(operations).toEqual(["TimelineVisit", "SubjectVisit"])
  expect(inspectRetainedExecutorResponsibilityStorage(index).length).toBeGreaterThan(0)
})

it("structurally shares cutoff snapshots instead of copying all retained subjects per event", () => {
  const countSlots = (size: number) => {
    const index = appendAll(Array.from({ length: size }, (_, id) => occurrence("Began", planFor(id), id + 1)))
    const visited = new Set<object>()
    let slots = 0
    const visit = (value: unknown): void => {
      if (typeof value !== "object" || value === null || visited.has(value)) return
      visited.add(value)
      const keys = Reflect.ownKeys(value)
      slots += keys.length
      for (const key of keys) visit(Reflect.get(value, key))
    }
    for (const root of inspectRetainedExecutorResponsibilityStorage(index)) visit(root)
    return slots
  }
  expect(countSlots(256)).toBeLessThan(countSlots(64) * 6)
})
