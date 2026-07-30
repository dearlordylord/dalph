// @effect-diagnostics multipleEffectProvide:off
import { Effect, Layer, Option, Ref, Result, Schema } from "effect"
import { expect, it } from "vitest"
import { RunId, TaskId, TaskRevision } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { taskTrackerReadIntent } from "../registry/event.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { deriveRunRecoveryFrontier } from "../../coordination/frontier/recovery-frontier.js"
import { reduceWorkflowJournalHistory } from "../../coordination/reconstruction/history.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsObservedEvent,
  taskTrackerFactsObservedEvent
} from "./observation.js"
import {
  makeTaskWorkSpecification,
  TaskWorkSpecification
} from "../../authorities/task-tracker/task-work-specification.js"
import { makeTaskTrackerFactsObservedFromRead } from "../protocols/task-tracker-read/protocol.js"
import {
  reconstructedTaskGraphFor,
  reconstructedTaskWorkSpecificationFor
} from "../../coordination/reconstruction/graph-knowledge.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import {
  TestTrackerGraphReader,
  TrackerGraphReader,
  trackerGraphReaderTestLayer
} from "../../authorities/task-tracker/graph-reader.js"
import {
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../registry/operation.js"
import { deterministicTestWorkflowInterpreterLayer } from "../interpretation/layers.js"
import { WorkflowInterpreter } from "../interpretation/interpreter.js"

const snapshot = (revision: string, aLifecycle: "Open" | "CompletedSuccessfully") => {
  const projected = projectTrackerSnapshot({
    revision: TrackerRevision.make(revision),
    tasks: [
      { id: TaskId.make("A"), lifecycle: { _tag: aLifecycle }, parentTaskId: null, prerequisiteIds: [] },
      {
        id: TaskId.make("B"),
        lifecycle: { _tag: "Open" },
        parentTaskId: TaskId.make("A"),
        prerequisiteIds: [TaskId.make("A")]
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
  expect(
    deriveRunRecoveryFrontier([
      {
        event: taskTrackerReadIntent(operation),
        key: intentRecordKey(operation.operationId),
        position: JournalPosition.make(1),
        runId: RunId.make("cyclic-frontier")
      },
      {
        event: cyclic,
        key: outcomeRecordKey(operation.operationId),
        position: JournalPosition.make(2),
        runId: RunId.make("cyclic-frontier")
      }
    ]).entries
  ).toEqual([])
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
      readTrackerGraph: () => Effect.succeed(providerSnapshot),
      readTaskWorkSpecification: () => Effect.die("unused"),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalStoreLayer))

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
  }).pipe(Effect.provide(Layer.merge(journaled, memoryJournalStoreLayer)), Effect.runPromise)

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
      readTrackerGraph: () => Effect.die("replay must not call the graph provider"),
      readTaskWorkSpecification: () => Effect.die("replay must not call the focused provider"),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const store = memoryJournalStoreLayer
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
  const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalStoreLayer))

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
  }).pipe(Effect.provide(Layer.merge(journaled, memoryJournalStoreLayer)), Effect.runPromise)

  expect(result.first).toEqual(specification)
  expect(result.replayed).toEqual(specification)
  expect(result.events.map(({ _tag }) => _tag)).toEqual(["TaskTrackerReadIntentRecorded", "TaskTrackerFactsObserved"])
})

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
