// @effect-diagnostics multipleEffectProvide:off
import { Cause, Effect, Layer, Option, Ref, Result, Schema } from "effect"
import { it as effectIt } from "@effect/vitest"
import { expect, it } from "vitest"
import { RunId, TaskId, TaskRevision, makeTaskWorkSpecification, TaskWorkSpecification } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import {
  InRunJournal,
  JournalStorageUnavailable,
  JournalStore,
  type JournalRecord
} from "../../workflow-journal/store.js"
import { taskTrackerReadIntent } from "../registry/event.js"
import { completionTaskIntentRecordKey, intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { reduceWorkflowJournalHistory } from "../../coordination/reconstruction/history.js"
import type { TaskTrackerFactsReadUnavailable } from "./observation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsReadFailed,
  TaskTrackerFactsObservedEvent,
  taskTrackerFactsObservedEvent
} from "./observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../protocols/task-tracker-read/protocol.js"
import {
  reconstructedTaskGraphFromEvents,
  reconstructedTaskGraphFor,
  reconstructedTaskWorkSpecificationFor
} from "../../coordination/reconstruction/graph-knowledge.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import {
  TestTrackerGraphReader,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerReadError,
  TrackerGraphReader,
  trackerGraphReaderTestLayer
} from "../../authorities/task-tracker/graph-reader.js"
import {
  makeCompletionTaskFactsObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../registry/operation.js"
import { deterministicTestWorkflowInterpreterLayer } from "../interpretation/layers.js"
import { WorkflowInterpreter } from "../interpretation/interpreter.js"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"
import { CompletionTaskIntendedEvent } from "../protocols/integration-finality/events.js"
import { journaledIntegrationEvidenceOf } from "../../coordination/delivery/delivery-evidence.js"
import { workflowJournalEventVersion } from "../kernel/event.js"

const snapshot = (
  revision: string,
  aLifecycle: "Open" | "CompletedSuccessfully",
  prerequisiteTaskId = TaskId.make("A")
) => {
  const projected = projectTrackerSnapshot({
    revision: TrackerRevision.make(revision),
    tasks: [
      { id: prerequisiteTaskId, lifecycle: { _tag: aLifecycle }, parentTaskId: null, prerequisiteIds: [] },
      {
        id: TaskId.make("B"),
        lifecycle: { _tag: "Open" },
        parentTaskId: prerequisiteTaskId,
        prerequisiteIds: [prerequisiteTaskId]
      }
    ]
  })
  if (projected._tag === "Invalid") throw new Error("test graph must be valid")
  return projected.snapshot
}

it("a crash before append authorizes no work; restart after append reconstructs facts and only a later observed completion releases B", () => {
  const runId = RunId.make("journal-first-tracker-facts")
  const target = FixtureTarget.make("target")
  const beforeCompletion = makeTrackerGraphObservationOperation(OperationId.make("read-before-completion"), target)
  const intent = {
    event: taskTrackerReadIntent(beforeCompletion),
    key: intentRecordKey(beforeCompletion.operationId),
    position: JournalPosition.make(1),
    runId
  } as const

  const beforeAppend = reduceWorkflowJournalHistory(runId, [intent])
  expect(beforeAppend._tag).toBe("ValidWorkflowJournalHistory")
  if (beforeAppend._tag !== "ValidWorkflowJournalHistory") return
  expect(Option.isNone(reconstructedTaskGraphFor(beforeAppend.runState.graphKnowledge, target))).toBe(true)

  const observedBeforeCompletion = makeCompleteTaskTrackerFactsObserved(
    beforeCompletion,
    snapshot("before-completion", "Open")
  )
  const firstRecords = [
    intent,
    {
      event: taskTrackerFactsObservedEvent(beforeCompletion.operationId, observedBeforeCompletion),
      key: outcomeRecordKey(beforeCompletion.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ] as const
  const reopenedBeforeCompletion = reduceWorkflowJournalHistory(runId, firstRecords)
  expect(reopenedBeforeCompletion._tag).toBe("ValidWorkflowJournalHistory")
  if (reopenedBeforeCompletion._tag !== "ValidWorkflowJournalHistory") return
  const blockedGraph = Option.getOrThrow(
    reconstructedTaskGraphFor(reopenedBeforeCompletion.runState.graphKnowledge, target)
  )
  expect(blockedGraph.eligibleTaskIds()).toEqual([TaskId.make("A")])
  expect(blockedGraph.prerequisitesOf(TaskId.make("B"))).toEqual([TaskId.make("A")])
  expect(blockedGraph.parentTaskIdOf(TaskId.make("B"))).toEqual(Option.some(TaskId.make("A")))

  const completionMutationAcknowledgement = { accepted: true, taskId: TaskId.make("A") } as const
  expect(completionMutationAcknowledgement.accepted).toBe(true)
  const reopenedAfterAcknowledgement = reduceWorkflowJournalHistory(runId, firstRecords)
  expect(reopenedAfterAcknowledgement._tag).toBe("ValidWorkflowJournalHistory")
  if (reopenedAfterAcknowledgement._tag !== "ValidWorkflowJournalHistory") return
  expect(
    Option.getOrThrow(reconstructedTaskGraphFor(reopenedAfterAcknowledgement.runState.graphKnowledge, target))
      .eligibleTaskIds()
      .map(String)
  ).toEqual(["A"])

  const afterCompletion = makeTrackerGraphObservationOperation(OperationId.make("read-after-completion"), target, [
    beforeCompletion.operationId
  ])
  const observedAfterCompletion = makeCompleteTaskTrackerFactsObserved(
    afterCompletion,
    snapshot("after-completion", "CompletedSuccessfully")
  )
  const finalRecords = [
    ...firstRecords,
    {
      event: taskTrackerReadIntent(afterCompletion),
      key: intentRecordKey(afterCompletion.operationId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(afterCompletion.operationId, observedAfterCompletion),
      key: outcomeRecordKey(afterCompletion.operationId),
      position: JournalPosition.make(4),
      runId
    }
  ] as const
  const reopenedAfterCompletion = reduceWorkflowJournalHistory(runId, finalRecords)
  expect(reopenedAfterCompletion._tag).toBe("ValidWorkflowJournalHistory")
  if (reopenedAfterCompletion._tag !== "ValidWorkflowJournalHistory") return
  expect(
    Option.getOrThrow(reconstructedTaskGraphFor(reopenedAfterCompletion.runState.graphKnowledge, target))
      .eligibleTaskIds()
      .map(String)
  ).toEqual(["B"])
})

it("a potentially mixed-time complete read is schedulable only when every fact family is complete and consistent", () => {
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make("incomplete-read"),
    FixtureTarget.make("target")
  )
  const event = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeCompleteTaskTrackerFactsObserved(operation, snapshot("incomplete-read", "Open"))
  )
  const encoded = Schema.encodeUnknownSync(TaskTrackerFactsObservedEvent)(event)
  if (encoded.observation._tag !== "CompleteTaskTrackerFacts") {
    throw new Error("expected complete graph facts")
  }
  const incomplete = {
    ...encoded,
    observation: {
      ...encoded.observation,
      factFamilies: encoded.observation.factFamilies.map((family) =>
        family._tag === "TaskLifecycles" ? { ...family, lifecycles: family.lifecycles.slice(1) } : family
      )
    }
  }

  expect(Result.isFailure(Schema.decodeUnknownResult(TaskTrackerFactsObservedEvent)(incomplete))).toBe(true)
  const factFamilies = encoded.observation.factFamilies
  const invalidEvidenceVariants: ReadonlyArray<unknown> = [
    {
      ...encoded,
      observation: {
        ...encoded.observation,
        factFamilies: factFamilies.map((family) =>
          family._tag === "TaskIdentities"
            ? { ...family, freshness: { ...family.freshness, operationId: OperationId.make("wrong-read") } }
            : family
        )
      }
    },
    {
      ...encoded,
      observation: {
        ...encoded.observation,
        factFamilies: factFamilies.map((family) =>
          family._tag === "TaskGroupings"
            ? { ...family, coverage: { ...family.coverage, explicitlyCoveredTaskIds: [TaskId.make("A")] } }
            : family
        )
      }
    },
    {
      ...encoded,
      observation: {
        ...encoded.observation,
        factFamilies: factFamilies.map((family) =>
          family._tag === "TaskLifecycles"
            ? { ...family, contentIdentity: TrackerRevision.make("wrong-content") }
            : family
        )
      }
    },
    {
      ...encoded,
      observation: {
        ...encoded.observation,
        factFamilies: factFamilies.map((family) =>
          family._tag === "TaskPrerequisites"
            ? { ...family, coverage: { ...family.coverage, target: FixtureTarget.make("wrong-coverage") } }
            : family
        )
      }
    },
    {
      ...encoded,
      observation: {
        ...encoded.observation,
        factFamilies: factFamilies.map((family) =>
          family._tag === "TaskIdentities" ? { ...family, target: FixtureTarget.make("wrong-subject") } : family
        )
      }
    },
    {
      ...encoded,
      observation: {
        ...encoded.observation,
        factFamilies: factFamilies.map((family) =>
          family._tag === "TaskPrerequisites"
            ? {
                ...family,
                prerequisites: family.prerequisites.map((row) =>
                  row.taskId === TaskId.make("B")
                    ? { ...row, prerequisiteTaskIds: [TaskId.make("unknown-prerequisite")] }
                    : row
                )
              }
            : family
        )
      }
    },
    { ...encoded, operationId: OperationId.make("wrong-event-operation") }
  ]
  for (const invalid of invalidEvidenceVariants) {
    expect(Result.isFailure(Schema.decodeUnknownResult(TaskTrackerFactsObservedEvent)(invalid))).toBe(true)
  }
  const absentTaskId = TaskId.make("removed-from-target")
  const absenceSensitiveRead = makeTrackerGraphObservationOperation(
    OperationId.make("absence-sensitive-read"),
    operation.target,
    [],
    [absentTaskId]
  )
  const absenceObservation = makeCompleteTaskTrackerFactsObserved(
    absenceSensitiveRead,
    snapshot("absence-sensitive-read", "Open")
  )
  expect(
    absenceObservation.factFamilies.every(({ coverage }) => coverage.explicitlyCoveredTaskIds.includes(absentTaskId))
  ).toBe(true)
  expect(absenceObservation.factFamilies[0].taskIds).not.toContain(absentTaskId)
  const cyclic = Schema.decodeUnknownSync(TaskTrackerFactsObservedEvent)({
    ...encoded,
    observation: {
      ...encoded.observation,
      factFamilies: factFamilies.map((family) =>
        family._tag === "TaskPrerequisites"
          ? {
              ...family,
              prerequisites: family.prerequisites.map((row) => ({
                ...row,
                prerequisiteTaskIds: [row.taskId === TaskId.make("A") ? TaskId.make("B") : TaskId.make("A")]
              }))
            }
          : family
      )
    }
  })
  expect(reconstructedTaskGraphFor({ taskTrackerFacts: [cyclic.observation] }, operation.target)).toEqual(Option.none())
})

it("rejects canonical facts whose target contradicts the initiating logical read", () => {
  const runId = RunId.make("mismatched-tracker-read")
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make("mismatched-target-read"),
    FixtureTarget.make("intended-target")
  )
  const contradictoryOperation = makeTrackerGraphObservationOperation(
    operation.operationId,
    FixtureTarget.make("observed-other-target")
  )
  const history = reduceWorkflowJournalHistory(runId, [
    {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(contradictoryOperation, snapshot("contradictory-target", "Open"))
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ])

  expect(history._tag).toBe("InvalidWorkflowJournalHistory")
  if (history._tag !== "InvalidWorkflowJournalHistory") return
  expect(history.issues).toContainEqual(expect.objectContaining({ _tag: "WorkflowJournalHistoryIdentityIssue" }))

  const focusedOperation = makeTaskWorkSpecificationObservationOperation(
    operation.operationId,
    operation.target,
    TaskId.make("A")
  )
  const focusedObservation = makeFocusedTaskWorkSpecificationFactsObserved(
    focusedOperation,
    makeTaskWorkSpecification({ body: "body", taskId: TaskId.make("A"), title: "title" })
  )
  const mismatchedShape = reduceWorkflowJournalHistory(runId, [
    {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(operation.operationId, focusedObservation),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(mismatchedShape._tag).toBe("InvalidWorkflowJournalHistory")

  const wrongFocusedSubject = makeTaskWorkSpecificationObservationOperation(
    operation.operationId,
    operation.target,
    TaskId.make("B")
  )
  const mismatchedFocusedSubject = reduceWorkflowJournalHistory(runId, [
    {
      event: taskTrackerReadIntent(wrongFocusedSubject),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(operation.operationId, focusedObservation),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(mismatchedFocusedSubject._tag).toBe("InvalidWorkflowJournalHistory")

  const graphFactsForFocusedRead = reduceWorkflowJournalHistory(runId, [
    {
      event: taskTrackerReadIntent(focusedOperation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, snapshot("graph-for-focused-read", "Open"))
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(graphFactsForFocusedRead._tag).toBe("InvalidWorkflowJournalHistory")

  const explicitlyCoveredRead = makeTrackerGraphObservationOperation(
    operation.operationId,
    operation.target,
    [],
    [TaskId.make("A")]
  )
  const mismatchedCoverage = reduceWorkflowJournalHistory(runId, [
    {
      event: taskTrackerReadIntent(explicitlyCoveredRead),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, snapshot("mismatched-coverage", "Open"))
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ])
  expect(mismatchedCoverage._tag).toBe("InvalidWorkflowJournalHistory")
})

it("a fresh unchanged read records later freshness compactly and restart reuses the earlier full facts", () => {
  const runId = RunId.make("unchanged-reconfirmation")
  const target = FixtureTarget.make("target")
  const firstRead = makeTrackerGraphObservationOperation(OperationId.make("first-read"), target)
  const unchangedRead = makeTrackerGraphObservationOperation(OperationId.make("unchanged-read"), target, [
    firstRead.operationId
  ])
  const unchangedSnapshot = snapshot("unchanged-content", "Open")
  const firstObservation = makeCompleteTaskTrackerFactsObserved(firstRead, unchangedSnapshot)
  const priorRecords = [
    {
      event: taskTrackerReadIntent(firstRead),
      key: intentRecordKey(firstRead.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(firstRead.operationId, firstObservation),
      key: outcomeRecordKey(firstRead.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ] as const

  const reconfirmation = makeTaskTrackerFactsObservedFromRead(priorRecords, unchangedRead, unchangedSnapshot)
  expect(reconfirmation.observation._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
  expect(reconfirmation).toMatchObject({
    observation: { priorFullObservationOperationId: firstRead.operationId, operationId: unchangedRead.operationId }
  })
  expect(JSON.stringify(reconfirmation)).not.toContain("lifecycles")
  const encodedReconfirmation = Schema.encodeUnknownSync(TaskTrackerFactsObservedEvent)(reconfirmation)
  if (encodedReconfirmation.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") {
    throw new Error("expected unchanged reconfirmation")
  }
  const reconfirmedFamilies = encodedReconfirmation.observation.factFamilies
  const invalidReconfirmations: ReadonlyArray<unknown> = [
    {
      ...encodedReconfirmation,
      observation: { ...encodedReconfirmation.observation, priorFullObservationOperationId: unchangedRead.operationId }
    },
    {
      ...encodedReconfirmation,
      observation: {
        ...encodedReconfirmation.observation,
        factFamilies: reconfirmedFamilies.map((family) =>
          family._tag === "TaskIdentitiesReconfirmed"
            ? { ...family, freshness: { ...family.freshness, operationId: OperationId.make("wrong-freshness") } }
            : family
        )
      }
    },
    {
      ...encodedReconfirmation,
      observation: {
        ...encodedReconfirmation.observation,
        factFamilies: reconfirmedFamilies.map((family) =>
          family._tag === "TaskGroupingsReconfirmed"
            ? {
                ...family,
                coverage: { ...family.coverage, explicitlyCoveredTaskIds: [TaskId.make("different-coverage")] }
              }
            : family
        )
      }
    },
    {
      ...encodedReconfirmation,
      observation: {
        ...encodedReconfirmation.observation,
        factFamilies: reconfirmedFamilies.map((family) =>
          family._tag === "TaskLifecyclesReconfirmed"
            ? { ...family, contentIdentity: TrackerRevision.make("wrong-content") }
            : family
        )
      }
    },
    {
      ...encodedReconfirmation,
      observation: {
        ...encodedReconfirmation.observation,
        factFamilies: reconfirmedFamilies.map((family) =>
          family._tag === "TaskPrerequisitesReconfirmed"
            ? { ...family, coverage: { ...family.coverage, target: FixtureTarget.make("wrong-coverage") } }
            : family
        )
      }
    },
    {
      ...encodedReconfirmation,
      observation: {
        ...encodedReconfirmation.observation,
        factFamilies: reconfirmedFamilies.map((family) =>
          family._tag === "TaskGroupingsReconfirmed"
            ? { ...family, subjectTaskIds: [TaskId.make("different-subject")] }
            : family
        )
      }
    },
    {
      ...encodedReconfirmation,
      observation: {
        ...encodedReconfirmation.observation,
        factFamilies: reconfirmedFamilies.map((family) =>
          family._tag === "TaskTargetMembershipReconfirmed"
            ? { ...family, target: FixtureTarget.make("wrong-membership-target") }
            : family
        )
      }
    }
  ]
  for (const invalid of invalidReconfirmations) {
    expect(Result.isFailure(Schema.decodeUnknownResult(TaskTrackerFactsObservedEvent)(invalid))).toBe(true)
  }

  const reopened = reduceWorkflowJournalHistory(runId, [
    ...priorRecords,
    {
      event: taskTrackerReadIntent(unchangedRead),
      key: intentRecordKey(unchangedRead.operationId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: reconfirmation,
      key: outcomeRecordKey(unchangedRead.operationId),
      position: JournalPosition.make(4),
      runId
    }
  ])
  expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
  if (reopened._tag !== "ValidWorkflowJournalHistory") return
  expect(
    Option.getOrThrow(reconstructedTaskGraphFor(reopened.runState.graphKnowledge, target)).eligibleTaskIds()
  ).toEqual([TaskId.make("A")])
  expect(reopened.runState.graphKnowledge.taskTrackerFacts.at(-1)?._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
  if (reconfirmation.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return
  const decodeReconfirmation = (observation: unknown) =>
    Schema.decodeUnknownSync(TaskTrackerFactsObservedEvent)({ ...reconfirmation, observation }).observation
  const missingPrior = decodeReconfirmation({
    ...reconfirmation.observation,
    priorFullObservationOperationId: OperationId.make("missing-full-observation")
  })
  const changedContent = TrackerRevision.make("different-reconfirmed-content")
  const mismatchedContent = decodeReconfirmation({
    ...reconfirmation.observation,
    factFamilies: reconfirmation.observation.factFamilies.map((family) => ({
      ...family,
      contentIdentity: changedContent
    }))
  })
  const mismatchedSubjects = decodeReconfirmation({
    ...reconfirmation.observation,
    factFamilies: reconfirmation.observation.factFamilies.map((family) =>
      "subjectTaskIds" in family ? { ...family, subjectTaskIds: [TaskId.make("A")] } : family
    )
  })
  const otherTarget = FixtureTarget.make("different-reconfirmed-target")
  const mismatchedTarget = decodeReconfirmation({
    ...reconfirmation.observation,
    target: otherTarget,
    factFamilies: reconfirmation.observation.factFamilies.map((family) => ({
      ...family,
      ...("target" in family ? { target: otherTarget } : {}),
      coverage: { ...family.coverage, target: otherTarget }
    }))
  })
  for (const observation of [missingPrior, mismatchedContent, mismatchedSubjects]) {
    expect(reconstructedTaskGraphFor({ taskTrackerFacts: [firstObservation, observation] }, target)).toEqual(
      Option.none()
    )
  }
  expect(reconstructedTaskGraphFor({ taskTrackerFacts: [firstObservation, mismatchedTarget] }, otherTarget)).toEqual(
    Option.none()
  )

  const invalidHistoryFor = (observation: typeof missingPrior, operation = unchangedRead) =>
    reduceWorkflowJournalHistory(runId, [
      ...priorRecords,
      {
        event: taskTrackerReadIntent(operation),
        key: intentRecordKey(operation.operationId),
        position: JournalPosition.make(3),
        runId
      },
      {
        event: taskTrackerFactsObservedEvent(operation.operationId, observation),
        key: outcomeRecordKey(operation.operationId),
        position: JournalPosition.make(4),
        runId
      }
    ])

  const invalidHistories = [
    invalidHistoryFor(missingPrior),
    invalidHistoryFor(mismatchedContent),
    invalidHistoryFor(mismatchedSubjects),
    invalidHistoryFor(
      mismatchedTarget,
      makeTrackerGraphObservationOperation(unchangedRead.operationId, otherTarget, [firstRead.operationId])
    )
  ]
  for (const history of invalidHistories) {
    expect(history._tag).toBe("InvalidWorkflowJournalHistory")
    expect("runState" in history).toBe(false)
  }

  const futureFullRead = makeTrackerGraphObservationOperation(OperationId.make("future-full-read"), target, [
    unchangedRead.operationId
  ])
  const forwardReference = decodeReconfirmation({
    ...reconfirmation.observation,
    priorFullObservationOperationId: futureFullRead.operationId
  })
  const forwardHistory = reduceWorkflowJournalHistory(runId, [
    ...priorRecords,
    {
      event: taskTrackerReadIntent(unchangedRead),
      key: intentRecordKey(unchangedRead.operationId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(unchangedRead.operationId, forwardReference),
      key: outcomeRecordKey(unchangedRead.operationId),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: taskTrackerReadIntent(futureFullRead),
      key: intentRecordKey(futureFullRead.operationId),
      position: JournalPosition.make(5),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        futureFullRead.operationId,
        makeCompleteTaskTrackerFactsObserved(futureFullRead, unchangedSnapshot)
      ),
      key: outcomeRecordKey(futureFullRead.operationId),
      position: JournalPosition.make(6),
      runId
    }
  ])
  expect(forwardHistory._tag).toBe("InvalidWorkflowJournalHistory")
  expect("runState" in forwardHistory).toBe(false)
})

it("appends one canonical observation for each logical provider read", async () => {
  const runId = RunId.make("journaled-provider-read")
  const target = FixtureTarget.make("target")
  const providerSnapshot = snapshot("same-provider-content", "Open")
  const provider = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused"),
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: () => Effect.succeed(providerSnapshot),
      readTaskWorkSpecification: () => Effect.die("unused"),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalTestLayer))

  const events = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    const first = makeTrackerGraphObservationOperation(OperationId.make("journaled-first"), target)
    const second = makeTrackerGraphObservationOperation(OperationId.make("journaled-second"), target)
    const third = makeTrackerGraphObservationOperation(OperationId.make("journaled-third"), target)
    yield* interpreter.readTrackerGraph(first)
    yield* interpreter.readTrackerGraph(second)
    yield* interpreter.readTrackerGraph(third)
    yield* interpreter.readTrackerGraph(first)
    return (yield* journal.read(runId)).map(({ event }) => event)
  }).pipe(Effect.provide(Layer.merge(journaled, memoryJournalTestLayer)), Effect.runPromise)

  expect(events.map(({ _tag }) => _tag)).toEqual([
    "TaskTrackerReadIntentRecorded",
    "TaskTrackerFactsObserved",
    "TaskTrackerReadIntentRecorded",
    "TaskTrackerFactsObserved",
    "TaskTrackerReadIntentRecorded",
    "TaskTrackerFactsObserved"
  ])
  expect(events.at(1)).toMatchObject({ observation: { _tag: "CompleteTaskTrackerFacts" } })
  expect(events.at(3)).toMatchObject({ observation: { _tag: "UnchangedTaskTrackerFactsReconfirmed" } })
  expect(events.at(5)).toMatchObject({ observation: { _tag: "UnchangedTaskTrackerFactsReconfirmed" } })
})

it("restarts from a durable unreadable graph read without calling the tracker again", async () => {
  const runId = RunId.make("journaled-unreadable-graph-read")
  const target = FixtureTarget.make("target")
  const operation = makeTrackerGraphObservationOperation(OperationId.make("unreadable-graph-read"), target)
  const unreadable = TaskTrackerFactsReadFailed.make({
    completeness: "Unreadable",
    failure: {
      _tag: "TrackerAdapterReadError",
      detail: "the tracker returned an incomplete target closure",
      reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
    },
    operationId: operation.operationId,
    target
  })
  const provider = Layer.mock(WorkflowInterpreter, {
    readTrackerGraph: () => Effect.die("replay must not call the tracker")
  })
  const store = memoryJournalTestLayer
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(store))

  const failure = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(operation.operationId, unreadable)
    )
    return yield* interpreter.readTrackerGraph(operation).pipe(Effect.flip)
  }).pipe(Effect.provide(Layer.merge(journaled, store)), Effect.runPromise)

  expect(failure).toMatchObject({
    _tag: "TaskTrackerFactsReadUnavailable",
    observation: {
      _tag: "TaskTrackerFactsReadFailed",
      completeness: "Unreadable",
      failure: {
        _tag: "TrackerAdapterReadError",
        detail: "the tracker returned an incomplete target closure",
        reason: { _tag: "IncompleteSnapshot" }
      },
      operationId: operation.operationId,
      target
    }
  } satisfies Partial<TaskTrackerFactsReadUnavailable>)
})

it("a lost post-success graph response authorizes no dependant and resumes only that read", async () => {
  const fixture = integrationFinalityFixture
  const runId = fixture.runId
  const target = fixture.target
  const oldRead = makeTrackerGraphObservationOperation(OperationId.make("old-open-graph"), target)
  const laterRead = makeTrackerGraphObservationOperation(OperationId.make("later-completed-graph"), target, [
    oldRead.operationId
  ])
  const focusedRead = makeCompletionTaskFactsObservationOperation(
    fixture.completionRequest,
    target,
    fixture.focusedSuccessFactsEvent.observation.purpose
  )
  const records = await Effect.runPromise(Ref.make<ReadonlyArray<JournalRecord>>([]))
  const failNextOutcome = await Effect.runPromise(Ref.make(false))
  const providerReads = await Effect.runPromise(Ref.make<ReadonlyArray<OperationId>>([]))
  const journal = Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (appendedRunId, key, event) =>
        Effect.gen(function* () {
          const existing = (yield* Ref.get(records)).find((record) => record.key === key)
          if (existing !== undefined) return existing
          if (event._tag === "TaskTrackerFactsObserved" && (yield* Ref.getAndSet(failNextOutcome, false))) {
            return yield* new JournalStorageUnavailable({
              detail: "controlled process loss before graph observation append",
              operation: "JournalStore.append"
            })
          }
          return yield* Ref.modify(records, (current) => {
            const appended: JournalRecord = {
              event,
              key,
              position: JournalPosition.make(current.length + 1),
              runId: appendedRunId
            }
            return [appended, [...current, appended]] as const
          })
        }),
      read: () => Ref.get(records)
    })
  )
  const provider = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused"),
      readTaskClaim: () => Effect.die("unused"),
      readTaskWorktree: () => Effect.die("unused"),
      readTargetLineage: () => Effect.die("unused"),
      readTrackerGraph: (operation) =>
        Ref.update(providerReads, (current) => [...current, operation.operationId]).pipe(
          Effect.as(
            operation.operationId === oldRead.operationId
              ? snapshot("old-open-graph", "Open", fixture.taskId)
              : snapshot("later-completed-graph", "CompletedSuccessfully", fixture.taskId)
          )
        ),
      readTaskWorkSpecification: () => Effect.die("unused"),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(journal))

  const result = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const inRunJournal = yield* InRunJournal
    yield* interpreter.readTrackerGraph(oldRead)
    yield* inRunJournal.append(
      runId,
      completionTaskIntentRecordKey(fixture.completionRequest),
      CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
    )
    yield* inRunJournal.append(runId, intentRecordKey(focusedRead.operationId), taskTrackerReadIntent(focusedRead))
    yield* inRunJournal.append(runId, outcomeRecordKey(focusedRead.operationId), fixture.focusedSuccessFactsEvent)
    yield* Ref.set(failNextOutcome, true)
    const beforeAppend = yield* interpreter.readTrackerGraph(laterRead).pipe(Effect.result)
    const retainedPrefix = yield* Ref.get(records)
    const beforeRestart = Option.getOrThrow(
      reconstructedTaskGraphFromEvents(
        retainedPrefix.map(({ event }) => event),
        target
      )
    )
    const retainedCompletion = journaledIntegrationEvidenceOf(retainedPrefix).find(
      (evidence) => evidence._tag === "FocusedTaskCompletionSuccess"
    )
    yield* interpreter.readTrackerGraph(laterRead)
    const afterRestart = Option.getOrThrow(
      reconstructedTaskGraphFromEvents(
        (yield* Ref.get(records)).map(({ event }) => event),
        target
      )
    )
    return { afterRestart, beforeAppend, beforeRestart, retainedCompletion }
  }).pipe(Effect.provide(Layer.merge(journaled, journal)), Effect.runPromise)

  expect(result.beforeAppend._tag).toBe("Failure")
  expect(result.retainedCompletion).toMatchObject({
    observed: { operationId: focusedRead.operationId },
    recordedAt: JournalPosition.make(5)
  })
  expect(result.beforeRestart.eligibleTaskIds()).toEqual([fixture.taskId])
  expect(result.afterRestart.eligibleTaskIds().map(String)).toEqual(["B"])
  expect(await Effect.runPromise(Ref.get(providerReads))).toEqual([
    oldRead.operationId,
    laterRead.operationId,
    laterRead.operationId
  ])
})

it("an invalid post-success graph read keeps the focused success and B blocked without busy-looping", async () => {
  const fixture = integrationFinalityFixture
  const runId = fixture.runId
  const target = fixture.target
  const oldRead = makeTrackerGraphObservationOperation(OperationId.make("invalid-graph-old-open"), target)
  const invalidRead = makeTrackerGraphObservationOperation(OperationId.make("invalid-post-success-graph"), target, [
    oldRead.operationId
  ])
  const focusedRead = makeCompletionTaskFactsObservationOperation(
    fixture.completionRequest,
    target,
    fixture.focusedSuccessFactsEvent.observation.purpose
  )
  const providerReads = await Effect.runPromise(Ref.make<ReadonlyArray<OperationId>>([]))
  const provider = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused"),
      readTaskClaim: () => Effect.die("unused"),
      readTaskWorktree: () => Effect.die("unused"),
      readTargetLineage: () => Effect.die("unused"),
      readTrackerGraph: (operation) =>
        Ref.update(providerReads, (current) => [...current, operation.operationId]).pipe(
          Effect.andThen(
            operation.operationId === oldRead.operationId
              ? Effect.succeed(snapshot("invalid-graph-old-open", "Open", fixture.taskId))
              : Effect.fail(
                  new TrackerReadError({
                    detail: "controlled invalid post-success graph payload",
                    operation: "TrackerGraphReader.decode"
                  })
                )
          )
        ),
      readTaskWorkSpecification: () => Effect.die("unused"),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const store = memoryJournalTestLayer
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(store))

  const result = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    yield* interpreter.readTrackerGraph(oldRead)
    yield* journal.append(
      runId,
      completionTaskIntentRecordKey(fixture.completionRequest),
      CompletionTaskIntendedEvent.make({ request: fixture.completionRequest, version: workflowJournalEventVersion })
    )
    yield* journal.append(runId, intentRecordKey(focusedRead.operationId), taskTrackerReadIntent(focusedRead))
    yield* journal.append(runId, outcomeRecordKey(focusedRead.operationId), fixture.focusedSuccessFactsEvent)
    const failure = yield* interpreter.readTrackerGraph(invalidRead).pipe(Effect.flip)
    const records = yield* journal.read(runId)
    return {
      failure,
      focusedEvidence: journaledIntegrationEvidenceOf(records).filter(
        (evidence) => evidence._tag === "FocusedTaskCompletionSuccess"
      ),
      graph: Option.getOrThrow(
        reconstructedTaskGraphFromEvents(
          records.map(({ event }) => event),
          target
        )
      ),
      outcomeCount: records.filter(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === invalidRead.operationId
      ).length
    }
  }).pipe(Effect.provide(Layer.merge(journaled, store)), Effect.runPromise)

  expect(result.failure).toMatchObject({
    _tag: "TrackerGraphReader.TrackerReadError",
    operation: "TrackerGraphReader.decode"
  })
  expect(result.focusedEvidence).toHaveLength(1)
  expect(result.graph.eligibleTaskIds()).toEqual([fixture.taskId])
  expect(result.outcomeCount).toBe(1)
  expect(result.failure._tag).toBe("TrackerGraphReader.TrackerReadError")
  expect(await Effect.runPromise(Ref.get(providerReads))).toEqual([oldRead.operationId, invalidRead.operationId])
})

it("fails replay with a typed error when recorded facts cannot reconstruct the promised knowledge", async () => {
  const runId = RunId.make("unavailable-reconstructed-knowledge")
  const target = FixtureTarget.make("target")
  const graphRead = makeTrackerGraphObservationOperation(OperationId.make("invalid-replayed-graph"), target)
  const validGraphEvent = taskTrackerFactsObservedEvent(
    graphRead.operationId,
    makeCompleteTaskTrackerFactsObserved(graphRead, snapshot("invalid-replayed-graph", "Open"))
  )
  const encodedGraphEvent = Schema.encodeUnknownSync(TaskTrackerFactsObservedEvent)(validGraphEvent)
  if (encodedGraphEvent.observation._tag !== "CompleteTaskTrackerFacts") {
    throw new Error("expected complete graph facts")
  }
  const invalidGraphEvent = Schema.decodeUnknownSync(TaskTrackerFactsObservedEvent)({
    ...encodedGraphEvent,
    observation: {
      ...encodedGraphEvent.observation,
      factFamilies: encodedGraphEvent.observation.factFamilies.map((family) =>
        family._tag === "TaskPrerequisites"
          ? {
              ...family,
              prerequisites: family.prerequisites.map((row) => ({
                ...row,
                prerequisiteTaskIds: [row.taskId === TaskId.make("A") ? TaskId.make("B") : TaskId.make("A")]
              }))
            }
          : family
      )
    }
  })
  const focusedRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("invalid-replayed-focused"),
    target,
    TaskId.make("A")
  )
  const wrongFocusedRead = makeTaskWorkSpecificationObservationOperation(
    focusedRead.operationId,
    target,
    TaskId.make("B")
  )
  const wrongFocusedEvent = taskTrackerFactsObservedEvent(
    focusedRead.operationId,
    makeFocusedTaskWorkSpecificationFactsObserved(
      wrongFocusedRead,
      makeTaskWorkSpecification({ body: "body", taskId: TaskId.make("B"), title: "title" })
    )
  )
  const provider = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused"),
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: () => Effect.die("replay must not call the graph provider"),
      readTaskWorkSpecification: () => Effect.die("replay must not call the focused provider"),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const store = memoryJournalTestLayer
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(store))
  const failures = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(runId, outcomeRecordKey(graphRead.operationId), invalidGraphEvent)
    const graphFailure = yield* interpreter.readTrackerGraph(graphRead).pipe(Effect.flip)
    yield* journal.append(runId, intentRecordKey(focusedRead.operationId), taskTrackerReadIntent(focusedRead))
    yield* journal.append(runId, outcomeRecordKey(focusedRead.operationId), wrongFocusedEvent)
    const focusedFailure = yield* interpreter.readTaskWorkSpecification(focusedRead).pipe(Effect.flip)
    return [graphFailure, focusedFailure]
  }).pipe(Effect.provide(Layer.merge(journaled, store)), Effect.runPromise)

  expect(failures).toEqual([
    expect.objectContaining({ _tag: "TaskTrackerKnowledgeUnavailable", knowledge: "TaskGraph" }),
    expect.objectContaining({ _tag: "TaskTrackerKnowledgeUnavailable", knowledge: "TaskWorkSpecification" })
  ])
})

it("replays a focused read from its canonical journal observation without calling the provider again", async () => {
  const runId = RunId.make("journaled-focused-read")
  const target = FixtureTarget.make("target")
  const taskId = TaskId.make("A")
  const specification = makeTaskWorkSpecification({ body: "Exact body", taskId, title: "Exact title" })
  const provider = Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const focusedReads = yield* Ref.make(0)
      return WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () =>
          Effect.gen(function* () {
            const ordinal = yield* Ref.getAndUpdate(focusedReads, (current) => current + 1)
            if (ordinal > 0) return yield* Effect.die("focused provider read repeated")
            return specification
          }),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    })
  )
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalTestLayer))

  const result = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    const operation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("journaled-focused"),
      target,
      taskId
    )
    const first = yield* interpreter.readTaskWorkSpecification(operation)
    const replayed = yield* interpreter.readTaskWorkSpecification(operation)
    return { events: (yield* journal.read(runId)).map(({ event }) => event), first, replayed }
  }).pipe(Effect.provide(Layer.merge(journaled, memoryJournalTestLayer)), Effect.runPromise)

  expect(result.first).toEqual(specification)
  expect(result.replayed).toEqual(specification)
  expect(result.events.map(({ _tag }) => _tag)).toEqual(["TaskTrackerReadIntentRecorded", "TaskTrackerFactsObserved"])
})

effectIt.effect("reuses one acknowledged focused-read intent after a lost provider response", () =>
  Effect.gen(function* () {
    const runId = RunId.make("journaled-focused-read-lost-response")
    const target = FixtureTarget.make("target")
    const taskId = TaskId.make("A")
    const operation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("journaled-focused-lost-response"),
      target,
      taskId
    )
    const specification = makeTaskWorkSpecification({ body: "Recovered body", taskId, title: "Recovered title" })
    const providerReads = yield* Ref.make(0)
    const provider = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unused"),
        readTaskWorktree: () => Effect.die("unused"),
        readTargetLineage: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () =>
          Ref.getAndUpdate(providerReads, (current) => current + 1).pipe(
            Effect.flatMap((ordinal) =>
              ordinal === 0
                ? Effect.fail(
                    new TrackerAdapterReadError({
                      context: TrackerAdapterReadContext.cases.Github.make({
                        operation: "GithubTrackerGraphReader.readTaskWorkSpecification"
                      }),
                      detail: "the focused read response was lost",
                      reason: TrackerAdapterReadFailureReason.cases.Transport.make({})
                    })
                  )
                : Effect.succeed(specification)
            )
          ),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalTestLayer))
    const result = yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const journal = yield* JournalStore
      const first = yield* Effect.exit(interpreter.readTaskWorkSpecification(operation))
      const recovered = yield* interpreter.readTaskWorkSpecification(operation)
      return { events: (yield* journal.read(runId)).map(({ event }) => event), first, recovered }
    }).pipe(Effect.provide(Layer.merge(journaled, memoryJournalTestLayer)))

    expect(result.first._tag).toBe("Failure")
    if (result.first._tag === "Failure") {
      expect(Cause.findErrorOption(result.first.cause)).toMatchObject({
        _tag: "Some",
        value: { reason: { _tag: "Transport" } }
      })
    }
    expect(result.recovered).toEqual(specification)
    expect(yield* Ref.get(providerReads)).toBe(2)
    expect(result.events.map(({ _tag }) => _tag)).toEqual(["TaskTrackerReadIntentRecorded", "TaskTrackerFactsObserved"])
  })
)

it("the controlled reader exposes focused specification updates and typed absence", async () => {
  const target = FixtureTarget.make("controlled-target")
  const taskId = TaskId.make("A")
  const initial = snapshot("controlled-initial", "Open")
  const replacement = snapshot("controlled-replacement", "CompletedSuccessfully")
  const specification = makeTaskWorkSpecification({ body: "Controlled body", taskId, title: "Controlled title" })

  const result = await Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const control = yield* TestTrackerGraphReader
    const absent = yield* reader
      .readTaskWorkSpecification(target, TaskId.make("missing-controlled-specification"))
      .pipe(Effect.result)
    yield* control.setTaskWorkSpecification(specification)
    yield* control.setSnapshot(replacement)
    return {
      absent,
      graph: yield* reader.read(target),
      requestedTargets: yield* control.requestedTargets(),
      specification: yield* reader.readTaskWorkSpecification(target, taskId)
    }
  }).pipe(Effect.provide(trackerGraphReaderTestLayer(initial, [specification])), Effect.runPromise)

  expect(result.absent).toMatchObject({ _tag: "Failure" })
  expect(result.graph.revision).toBe(replacement.revision)
  expect(result.specification).toEqual(specification)
  expect(result.requestedTargets).toEqual([target, target])
})

it("the live workflow interpreter delegates the focused read through its tracker boundary", async () => {
  const target = FixtureTarget.make("delegated-focused-target")
  const taskId = TaskId.make("A")
  const specification = makeTaskWorkSpecification({ body: "Delegated body", taskId, title: "Delegated title" })
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("delegated-focused-operation"),
    target,
    taskId
  )

  const observed = await Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    return yield* interpreter.readTaskWorkSpecification(operation)
  }).pipe(
    Effect.provide(deterministicTestWorkflowInterpreterLayer),
    Effect.provide(trackerGraphReaderTestLayer(snapshot("delegated-graph", "Open"), [specification])),
    Effect.runPromise
  )

  expect(observed).toEqual(specification)
})

it("records exact normalized title and body only through the focused attempt read", () => {
  const target = FixtureTarget.make("target")
  const graphRead = makeTrackerGraphObservationOperation(OperationId.make("graph-read"), target)
  const graphObservation = makeCompleteTaskTrackerFactsObserved(graphRead, snapshot("graph-only", "Open"))
  expect(JSON.stringify(graphObservation)).not.toContain("title")
  expect(JSON.stringify(graphObservation)).not.toContain("body")

  const taskId = TaskId.make("A")
  const focusedRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("focused-attempt-read"),
    target,
    taskId,
    [graphRead.operationId]
  )
  const specification = makeTaskWorkSpecification({
    body: "First line\n\nSecond line",
    taskId,
    title: "Implement journal-first tracker observations"
  })
  const focusedObservation = makeFocusedTaskWorkSpecificationFactsObserved(focusedRead, specification)
  expect(focusedObservation).toMatchObject({
    factFamily: { body: "First line\n\nSecond line", taskId, title: "Implement journal-first tracker observations" }
  })
  expect(focusedObservation.factFamily.fingerprint).toMatch(/^tr1\./)
  const focusedEvent = taskTrackerFactsObservedEvent(focusedRead.operationId, focusedObservation)
  expect(
    Result.isFailure(
      Schema.decodeUnknownResult(TaskTrackerFactsObservedEvent)({
        ...focusedEvent,
        observation: {
          ...focusedObservation,
          factFamily: { ...focusedObservation.factFamily, contentIdentity: TaskRevision.make("wrong-focused-content") }
        }
      })
    )
  ).toBe(true)
  for (const invalid of [
    {
      ...focusedObservation,
      factFamily: {
        ...focusedObservation.factFamily,
        freshness: {
          ...focusedObservation.factFamily.freshness,
          operationId: OperationId.make("wrong-focused-freshness")
        }
      }
    },
    {
      ...focusedObservation,
      factFamily: {
        ...focusedObservation.factFamily,
        coverage: { ...focusedObservation.factFamily.coverage, taskId: TaskId.make("wrong-focused-task") }
      }
    }
  ]) {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(TaskTrackerFactsObservedEvent)({ ...focusedEvent, observation: invalid })
      )
    ).toBe(true)
  }
  expect(
    Result.isFailure(
      Schema.decodeUnknownResult(TaskWorkSpecification)({
        ...specification,
        fingerprint: TaskRevision.make("wrong-authored-content")
      })
    )
  ).toBe(true)
  expect(
    reconstructedTaskWorkSpecificationFor({ taskTrackerFacts: [graphObservation, focusedObservation] }, taskId)
  ).toEqual(Option.some(specification))
  expect(reconstructedTaskWorkSpecificationFor({ taskTrackerFacts: [graphObservation] }, taskId)).toEqual(Option.none())
})
