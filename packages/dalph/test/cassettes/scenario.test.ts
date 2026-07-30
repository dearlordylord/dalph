import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { PlannedAttemptExecutorReport, TaskId } from "@dalph/contracts"
import {
  AuthenticatedOperatorIdentity,
  ControlCommand,
  ControlCommandId,
  ControlCommandRecordedEvent,
  decodeFreshWorkflowRunIdForDiagnostics,
  describeJournalEvent,
  JournalPosition,
  RunPolicyRevision,
  TaskWorkCapacity,
  type JournalRecord,
  type TaskTrackerFactsObservation,
  type WorkflowJournalEvent,
  type WorkflowOperation,
  WorkflowRunTerminatedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  AuthoredScenarioCassette,
  CassetteIdentityRenaming,
  compareRecordedCassetteCheckpoints,
  dependentTasksCompleteInOneRunAuthoredCassette,
  foldRecordedCassette,
  invertCassetteIdentityRenaming,
  maintainedAuthoredCassetteCatalog,
  measureTrackerObservationEncoding,
  projectRecordedCassette,
  RecordedCassette,
  type RecordedCassetteEntry,
  renameRecordedCassette,
  renderAuthoredCassetteLyrics,
  renderRecordedCassetteLyrics,
  runAuthoredScenarioCassette as runAuthoredScenarioCassetteWithCrypto,
  singletonTaskCompletesAuthoredCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

const singleton = singletonTaskCompletesAuthoredCassette
const runAuthoredScenarioCassette = (input: unknown) =>
  runAuthoredScenarioCassetteWithCrypto(input).pipe(Effect.provide(NodeCrypto.layer))

it.effect("continues the same run with B only after a recorded refresh reports A completed", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(dependentTasksCompleteInOneRunAuthoredCassette)
    const executorResponsibilities = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt.taskId] : []
    )

    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
      { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
    ])
    expect(executorResponsibilities).toEqual(["A", "B"])
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies[1].lifecycles.some(
            ({ lifecycle, taskId }) => taskId === TaskId.make("A") && lifecycle._tag === "CompletedSuccessfully"
          )
      )
    ).toBe(true)
  })
)

it.effect("returns control after one unchanged refresh without terminating the unsettled Run", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singleton)
    const graphObservations = run.records.flatMap(({ event }) =>
      event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []
    )

    expect(graphObservations.at(-1)?._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
    expect(run.records.at(-1)?.event._tag).toBe("TaskTrackerFactsObserved")
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A"])
  })
)

it.effect("an invalid quiescent refresh authorizes no new work", () =>
  Effect.gen(function* () {
    const lastGraphReturn = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const invalidRefresh = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === lastGraphReturn && item._tag === "TrackerGraphReadReturned"
          ? {
              ...item,
              graph: {
                revision: "contradictory-quiescent-refresh",
                tasks: [
                  { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
                  { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
                ]
              }
            }
          : item
      )
    }

    expect((yield* runAuthoredScenarioCassette(invalidRefresh).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )
  })
)

it.effect("an incomplete quiescent refresh authorizes no new work", () =>
  Effect.gen(function* () {
    const lastGraphReturn = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const incompleteRefresh = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === lastGraphReturn ? { _tag: "TrackerGraphReadFailed", reason: "IncompleteSnapshot" } : item
      )
    }

    const failure = yield* runAuthoredScenarioCassette(incompleteRefresh).pipe(Effect.flip)
    expect(failure._tag).toBe("TrackerGraphReader.AdapterReadError")
    expect("detail" in failure ? failure.detail : "").toContain("IncompleteSnapshot")
    expect(
      renderAuthoredCassetteLyrics(yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(incompleteRefresh))
    ).toContain("The task tracker fails the logical graph read because IncompleteSnapshot.")
  })
)

it.effect("later complete reads add newly selected D and keep removed unstarted C from responsibility", () =>
  Effect.gen(function* () {
    const target = "changed-membership-cassette-target"
    const initialGraph = {
      revision: "changed-membership-before",
      tasks: [
        { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const changedGraph = {
      revision: "changed-membership-after",
      tasks: [
        { id: "A", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const membershipChangedGraph = {
      revision: "changed-membership-before-A-completes",
      tasks: [
        { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const read = (graph: typeof initialGraph) => [
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
      { _tag: "TrackerGraphReadReturned", graph }
    ]
    const changedMembership = {
      _tag: "AuthoredScenarioCassette",
      name: "a complete refresh removes unstarted C and adds D",
      schemaVersion: 1,
      startingFacts: {
        executorWork: "NoPriorReport",
        journal: "Empty",
        taskClaims: [],
        taskWorkSpecifications: [
          { body: "Complete A.", taskId: "A", title: "Complete A" },
          { body: "Complete D.", taskId: "D", title: "Complete D" }
        ],
        trackerGraph: initialGraph,
        worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
      },
      story: [
        { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
        {
          _tag: "RunCoordinator",
          baseSha: "3333333333333333333333333333333333333333",
          claimOwner: "changed-membership-owner",
          claimTokenPrefix: "changed-membership-claim",
          executor: "executor:controlled-fake",
          target,
          worktreeRoot: "/dalph/cassettes/changed-membership"
        },
        ...read(initialGraph),
        ...read(initialGraph),
        ...read(membershipChangedGraph),
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
        ...read(membershipChangedGraph),
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
        { _tag: "TaskWorkSpecificationReadReturned", body: "Complete A.", taskId: "A", title: "Complete A" },
        { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Running", attemptId: "attempt:A:0" },
          request: "StartOrContinue"
        },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
          request: "StartOrContinue"
        },
        ...read(changedGraph),
        ...read(changedGraph),
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "D" } },
        ...read(changedGraph),
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "D" } },
        { _tag: "TaskWorkSpecificationReadReturned", body: "Complete D.", taskId: "D", title: "Complete D" },
        { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:D:1", taskId: "D" } },
        { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:D:1", taskId: "D" } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Running", attemptId: "attempt:D:1" },
          request: "StartOrContinue"
        },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Terminal", attemptId: "attempt:D:1", result: { _tag: "Completed" } },
          request: "StartOrContinue"
        },
        ...read(changedGraph),
        {
          _tag: "ExpectedBehavior",
          orchestration: null,
          protocol: null,
          taskWork: {
            absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "C" }],
            results: [
              { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
              { _tag: "PlannedWorkForTaskCompleted", taskId: "D" }
            ]
          }
        }
      ]
    }

    const run = yield* runAuthoredScenarioCassette(changedMembership)
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A", "D"])
  })
)

const insertBeforeRunTermination = (
  records: ReadonlyArray<JournalRecord>,
  event: WorkflowJournalEvent
): ReadonlyArray<JournalRecord> => {
  const terminationIndex = records.findIndex(({ event: recorded }) => recorded._tag === "WorkflowRunTerminated")
  const insertionIndex = terminationIndex < 0 ? records.length : terminationIndex
  const runId = records[0]?.runId
  if (runId === undefined) return records
  return [
    ...records.slice(0, insertionIndex),
    { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(insertionIndex + 1), runId },
    ...records.slice(insertionIndex)
  ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
}

it.effect("runs the maintained singleton through production activation and describes only its task-work result", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singleton)
    const expected = singleton.story.at(-1)

    expect(run.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }])
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A"])
    expect(run.observedBehavior.orchestrationEvidence).toBeNull()
    expect(run.observedBehavior.protocolEvidence).toBeNull()
    expect(expected?._tag === "ExpectedBehavior" ? expected.orchestration : undefined).toBeNull()
    expect(expected?._tag === "ExpectedBehavior" ? expected.protocol : undefined).toBeNull()
    expect(JSON.stringify(expected)).not.toContain("attempt:A:0")
  })
)

it.effect("keeps the maintained singleton Run active while its tracker task remains open", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.singletonTaskCompletes)
    const encoded = yield* Schema.encodeUnknownEffect(AuthoredScenarioCassette)(run.cassette)
    const terminalAssertions = run.cassette.story.at(-1)
    const terminalExecutorReport = run.records.findLast(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"
    )?.event

    expect(JSON.stringify(encoded)).not.toContain("runId")
    expect(run.runId).not.toContain("cassette-target")
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.observedBehavior.taskWorkResults).toEqual(
      terminalAssertions?._tag === "ExpectedBehavior" ? terminalAssertions.taskWork.results : []
    )
    expect(run.records.at(-1)?.event._tag).toBe("TaskTrackerFactsObserved")
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    expect(
      terminalExecutorReport?._tag === "PlannedAttemptExecutorWorkReported"
        ? terminalExecutorReport.report._tag
        : undefined
    ).toBe("Terminal")
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects the planned work for task A to complete."
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects Dalph not to assume executor-work responsibility for any planned attempt belonging to task B."
    )
  })
)

it.effect("assigns a fresh exact run identity each time the same tracker target starts", () =>
  Effect.gen(function* () {
    const first = yield* runAuthoredScenarioCassette(singleton)
    const second = yield* runAuthoredScenarioCassette(singleton)
    const command = singleton.story.find((item) => item._tag === "RunCoordinator")
    if (command?._tag !== "RunCoordinator") return yield* Effect.die("maintained story has no coordinator command")

    expect(first.runId).not.toBe(second.runId)
    expect(first.runId).not.toContain("cassette-target")
    expect(second.runId).not.toContain("cassette-target")
    expect((yield* decodeFreshWorkflowRunIdForDiagnostics(first.runId)).target).toEqual(command.target)
    expect((yield* decodeFreshWorkflowRunIdForDiagnostics(second.runId)).target).toEqual(command.target)

    const correlatedRunIds = first.records.flatMap(({ event, runId }) => {
      if (event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended") {
        return [runId, event.operation.plannedAttempt.runId]
      }
      if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
        return [runId, event.plannedAttempt.runId]
      }
      if (event._tag === "PlannedAttemptExecutorWorkReported") {
        return [runId, event.report.correlation.runId]
      }
      return [runId]
    })
    expect(new Set(correlatedRunIds)).toEqual(new Set([first.runId]))
  })
)

it.effect("runs another story with a different initial task-execution capacity", () =>
  Effect.gen(function* () {
    const capacityTwo = {
      ...singleton,
      name: "the singleton starts with two task-work positions",
      story: singleton.story.map((item) =>
        item._tag === "InitialControlPolicy" ? { ...item, policy: { taskExecutionCapacity: 2 } } : item
      )
    }
    const run = yield* runAuthoredScenarioCassette(capacityTwo)

    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.cassette.story[0]).toEqual({ _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 2 } })
  })
)

it.effect("requires one terminal assertion group and one owner for every decoded story item", () =>
  Effect.gen(function* () {
    const withoutAssertions = {
      ...singleton,
      story: singleton.story.filter((item) => item._tag !== "ExpectedBehavior")
    }
    expect((yield* runAuthoredScenarioCassette(withoutAssertions).pipe(Effect.flip))._tag).toBe("SchemaError")

    const duplicateAssertions = { ...singleton, story: [...singleton.story, singleton.story.at(-1)] }
    expect((yield* runAuthoredScenarioCassette(duplicateAssertions).pipe(Effect.flip))._tag).toBe("SchemaError")

    const nonTerminalAssertions = {
      ...singleton,
      story: [...singleton.story.slice(0, -2), singleton.story.at(-1), singleton.story.at(-2)]
    }
    expect((yield* runAuthoredScenarioCassette(nonTerminalAssertions).pipe(Effect.flip))._tag).toBe("SchemaError")

    const assertions = singleton.story.at(-1)
    if (assertions?._tag !== "ExpectedBehavior") return yield* Effect.die("missing singleton assertions")
    const duplicateAbsence = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          ...assertions,
          taskWork: {
            ...assertions.taskWork,
            absences: [...assertions.taskWork.absences, assertions.taskWork.absences[0]]
          }
        }
      ]
    }
    expect((yield* runAuthoredScenarioCassette(duplicateAbsence).pipe(Effect.flip))._tag).toBe("SchemaError")
    const contradictory = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          ...assertions,
          taskWork: { ...assertions.taskWork, absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "A" }] }
        }
      ]
    }
    expect((yield* runAuthoredScenarioCassette(contradictory).pipe(Effect.flip))._tag).toBe("SchemaError")

    const noOwner = yield* assertExactlyOneAuthoredCassetteStoryItemOwner("UnknownTag").pipe(Effect.flip)
    expect(noOwner).toMatchObject({ _tag: "AuthoredCassetteStoryItemOwnerContradiction", registrations: [] })
    const duplicateOwner = yield* assertExactlyOneAuthoredCassetteStoryItemOwner("DalphSelects", {
      First: ["DalphSelects"],
      Second: ["DalphSelects"]
    }).pipe(Effect.flip)
    expect(duplicateOwner).toMatchObject({
      _tag: "AuthoredCassetteStoryItemOwnerContradiction",
      registrations: ["First", "Second"],
      tag: "DalphSelects"
    })
  })
)

it.effect("lowers capacity while A holds a position and admits B only after A releases it", () =>
  Effect.gen(function* () {
    const firstRunning = dependentTasksCompleteInOneRunAuthoredCassette.story.findIndex(
      (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running"
    )
    const withAppliedChange = {
      ...dependentTasksCompleteInOneRunAuthoredCassette,
      story: dependentTasksCompleteInOneRunAuthoredCassette.story.flatMap((item, index) => [
        ...(index === 0 && item._tag === "InitialControlPolicy"
          ? [{ ...item, policy: { taskExecutionCapacity: 2 } }]
          : [item]),
        ...(index === firstRunning ? [{ _tag: "SetTaskExecutionCapacity", capacity: 1 } as const] : [])
      ])
    }
    const run = yield* runAuthoredScenarioCassette(withAppliedChange)
    const recordedLyrics = renderRecordedCassetteLyrics(yield* projectRecordedCassette(run.records))
    const changedAt = run.records.findIndex(({ event }) => event._tag === "TaskWorkCapacityChanged")
    const aTerminalAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "Terminal" &&
        event.report.correlation.attemptId === "attempt:A:0"
    )
    const bResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.taskId === TaskId.make("B")
    )

    expect(changedAt).toBeGreaterThan(0)
    expect(aTerminalAt).toBeGreaterThan(changedAt)
    expect(bResponsibilityAt).toBeGreaterThan(aTerminalAt)
    expect(recordedLyrics).toContain("Operator changed task-work capacity to 1 at policy revision 2.")
    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
      { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
    ])
  })
)

it.effect("rejects cassette-local contradictions and leaves an authority mismatch to its ordinary boundary", () =>
  Effect.gen(function* () {
    const inconsistentGraph = {
      ...singleton,
      startingFacts: {
        ...singleton.startingFacts,
        trackerGraph: { ...singleton.startingFacts.trackerGraph, revision: "not-the-first-return" }
      }
    }
    expect((yield* runAuthoredScenarioCassette(inconsistentGraph).pipe(Effect.flip))._tag).toBe("SchemaError")

    const authorityMismatch = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "TaskWorkSpecificationReadReturned" ? { ...item, taskId: "B" } : item
      ),
      startingFacts: {
        ...singleton.startingFacts,
        taskWorkSpecifications: [{ ...singleton.startingFacts.taskWorkSpecifications[0], taskId: "B" }]
      }
    }
    expect((yield* runAuthoredScenarioCassette(authorityMismatch).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )
  })
)

it.effect("reports mismatches through the surface that owns the current story item", () =>
  Effect.gen(function* () {
    const existingClaim = {
      _tag: "ActiveTaskClaim",
      operationId: "existing-claim-operation",
      owner: "another-owner",
      taskId: "A",
      token: "existing-claim-token"
    }
    const duplicateClaims = {
      ...singleton,
      startingFacts: { ...singleton.startingFacts, taskClaims: [existingClaim, existingClaim] }
    }
    expect((yield* runAuthoredScenarioCassette(duplicateClaims).pipe(Effect.flip))._tag).toBe("SchemaError")

    const wrongExpectedAction = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === 2 && item._tag === "DalphSelects"
          ? { ...item, operation: { _tag: "ReadTrackerGraph", target: "wrong-target" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongExpectedAction).pipe(Effect.flip))._tag).toBe(
      "TraceOutput.TraceOutputError"
    )

    const wrongTrackerItem = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === 3
          ? { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongTrackerItem).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )

    const wrongSpecificationItem = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "TaskWorkSpecificationReadReturned"
          ? { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongSpecificationItem).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )

    const invalidGraph = {
      revision: "invalid-duplicate-task",
      tasks: [singleton.startingFacts.trackerGraph.tasks[0], singleton.startingFacts.trackerGraph.tasks[0]]
    }
    const invalidGraphStory = {
      ...singleton,
      startingFacts: { ...singleton.startingFacts, trackerGraph: invalidGraph },
      story: singleton.story.map((item) =>
        item._tag === "TrackerGraphReadReturned" ? { ...item, graph: invalidGraph } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(invalidGraphStory).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )

    const wrongExecutorItem = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === 13 ? { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongExecutorItem).pipe(Effect.flip))._tag).toBe(
      "ControlledFakeExecutorMismatch"
    )

    const wrongAttempt = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "PlannedAttemptExecutorWorkReported"
          ? { ...item, report: { ...item.report, attemptId: "another-attempt" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongAttempt).pipe(Effect.flip))._tag).toBe(
      "ControlledFakeExecutorMismatch"
    )
  })
)

it.effect("derives failed task-work results and safely suspended orchestration evidence from recorded handling", () =>
  Effect.gen(function* () {
    const failed = {
      ...singleton,
      story: singleton.story.map((item) => {
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal") {
          return { ...item, report: { ...item.report, result: { _tag: "Failed" } } }
        }
        if (item._tag === "ExpectedBehavior") {
          return {
            ...item,
            taskWork: { ...item.taskWork, results: [{ _tag: "PlannedWorkForTaskFailed", taskId: "A" }] }
          }
        }
        return item
      })
    }
    const failedRun = yield* runAuthoredScenarioCassette(failed)
    expect(failedRun.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskFailed", taskId: "A" }])
    expect(renderAuthoredCassetteLyrics(failedRun.cassette)).toContain(
      "The story expects the planned work for task A to fail."
    )

    const safelySuspended = {
      ...singleton,
      story: singleton.story.reduce<ReadonlyArray<unknown>>((story, item) => {
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running") {
          return [...story, { ...item, report: { _tag: "SafelySuspended", attemptId: item.report.attemptId } }]
        }
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal") return story
        if (item._tag === "ExpectedBehavior") {
          return [
            ...story,
            {
              ...item,
              orchestration: [
                { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" }
              ],
              taskWork: { ...item.taskWork, results: [] }
            }
          ]
        }
        return [...story, item]
      }, [])
    }
    const suspendedRun = yield* runAuthoredScenarioCassette(safelySuspended)
    expect(suspendedRun.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "SafelySuspended"
    })
  })
)

it.effect("fails typed expected-behavior assertions and renders the applied capacity item", () =>
  Effect.gen(function* () {
    const wrongOutcomes = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior" ? { ...item, taskWork: { ...item.taskWork, results: [] } } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongOutcomes).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteBehaviorMismatch"
    )

    const decoded = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...singleton,
      story: [
        ...singleton.story.slice(0, 2),
        { _tag: "SetTaskExecutionCapacity", capacity: 2 },
        ...singleton.story.slice(2)
      ]
    })
    expect(renderAuthoredCassetteLyrics(decoded)).toContain("Operator applies task-execution capacity 2 to the Run.")
  })
)

it.effect("matches optional orchestration and protocol evidence in exact order", () =>
  Effect.gen(function* () {
    const withEvidence = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              orchestration: [
                { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
                { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalCompleted" }
              ],
              protocol: [
                { _tag: "TaskClaimAcquired", taskId: "A" },
                { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" }
              ]
            }
          : item
      )
    }
    const run = yield* runAuthoredScenarioCassette(withEvidence)

    expect(run.observedBehavior.orchestrationEvidence).toHaveLength(3)
    expect(run.observedBehavior.protocolEvidence).toHaveLength(3)
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects Dalph to assume executor-work responsibility for task A, attempt attempt:A:0."
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects Dalph to acquire the claim for task A."
    )
  })
)

it.effect("requires orchestration evidence when task-work results cannot distinguish attempts", () =>
  Effect.gen(function* () {
    const ambiguousResults = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? { ...item, taskWork: { ...item.taskWork, results: [...item.taskWork.results, ...item.taskWork.results] } }
          : item
      )
    }

    expect((yield* runAuthoredScenarioCassette(ambiguousResults).pipe(Effect.flip))._tag).toBe("SchemaError")
  })
)

it.effect("rejects missing, reordered, or additional evidence within either present authored assertion lens", () =>
  Effect.gen(function* () {
    const completeOrchestration = [
      { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
      { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
      { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalCompleted" }
    ]
    const completeProtocol = [
      { _tag: "TaskClaimAcquired", taskId: "A" },
      { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
      { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" }
    ]
    const withEvidence = (lens: "orchestration" | "protocol", evidence: ReadonlyArray<unknown>) => ({
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              orchestration: lens === "orchestration" ? evidence : null,
              protocol: lens === "protocol" ? evidence : null
            }
          : item
      )
    })

    yield* Effect.forEach(
      [
        withEvidence("orchestration", completeOrchestration.slice(0, -1)),
        withEvidence("orchestration", [...completeOrchestration].reverse()),
        withEvidence("orchestration", [...completeOrchestration, completeOrchestration[0]]),
        withEvidence("protocol", completeProtocol.slice(0, -1)),
        withEvidence("protocol", [...completeProtocol].reverse()),
        withEvidence("protocol", [...completeProtocol, completeProtocol[0]])
      ],
      (input) =>
        runAuthoredScenarioCassette(input).pipe(
          Effect.flip,
          Effect.tap((failure) => Effect.sync(() => expect(failure._tag).toBe("AuthoredCassetteBehaviorMismatch")))
        ),
      { discard: true }
    )
  })
)

it.effect("rejects no-work-undertaken when Dalph assumed executor-work responsibility for that task", () =>
  Effect.gen(function* () {
    const contradictedAbsence = {
      ...singleton,
      story: singleton.story.reduce<ReadonlyArray<unknown>>((story, item) => {
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running") {
          return [...story, { ...item, report: { _tag: "SafelySuspended", attemptId: item.report.attemptId } }]
        }
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal") return story
        if (item._tag === "ExpectedBehavior") {
          return [
            ...story,
            { ...item, taskWork: { absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "A" }], results: [] } }
          ]
        }
        return [...story, item]
      }, [])
    }

    expect((yield* runAuthoredScenarioCassette(contradictedAbsence).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteBehaviorMismatch"
    )
  })
)

it.effect("keeps explicit story interactions chronological when lower-level evidence is omitted", () =>
  Effect.gen(function* () {
    const firstSelection = singleton.story[2]
    const firstResponse = singleton.story[3]
    const outOfOrder = {
      ...singleton,
      story: [singleton.story[0], singleton.story[1], firstResponse, firstSelection, ...singleton.story.slice(4)]
    }

    expect((yield* runAuthoredScenarioCassette(outOfOrder).pipe(Effect.flip))._tag).toBe("TraceOutput.TraceOutputError")
  })
)

it.effect(
  "projects every occurrence and checks state, history, position, and selection after every non-empty prefix",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singleton)
      const recorded = yield* projectRecordedCassette(run.records)
      const checkpoints = verifyRecordedCassetteRoundTrip(run.records, recorded)
      const encoded = yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded)

      expect(recorded.entries).toHaveLength(run.records.length)
      expect(JSON.stringify(Reflect.get(encoded, "entries"))).not.toMatch(/"key"|"position"|"version"/)
      expect(checkpoints).toHaveLength(run.records.length)
      expect(
        checkpoints.every(
          (checkpoint) =>
            checkpoint.operationalStateEquivalent &&
            checkpoint.workflowHistoryEquivalent &&
            checkpoint.appliedOccurrencePositionEquivalent &&
            checkpoint.pureSelectionEquivalent
        )
      ).toBe(true)
      expect(renderRecordedCassetteLyrics(recorded)).toContain(
        "Dalph coordinator began executor-work responsibility for task A, attempt attempt:A:0."
      )
    })
)

it.effect(
  "alpha-renames every Dalph-generated identity and preserves tracker revisions, task revisions, and Git SHAs",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singleton)
      const command = ControlCommand.cases.RequestRunPause.make({
        commandId: ControlCommandId.make("rename-command"),
        operatorId: AuthenticatedOperatorIdentity.make("cassette-operator"),
        runId: run.runId
      })
      const commandEvent = ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
      const recordsWithCommand = insertBeforeRunTermination(run.records, commandEvent)
      const terminationEvent = WorkflowRunTerminatedEvent.make({
        disposition: "Completed",
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
      const records = [
        ...recordsWithCommand,
        {
          event: terminationEvent,
          key: describeJournalEvent(terminationEvent).expectedKey,
          position: JournalPosition.make(recordsWithCommand.length + 1),
          runId: run.runId
        }
      ]
      const projected = yield* projectRecordedCassette(records)
      const executorReportEntry = projected.entries.find((entry) => entry._tag === "PlannedAttemptExecutorWorkReported")
      if (executorReportEntry?._tag !== "PlannedAttemptExecutorWorkReported") {
        return yield* Effect.die("missing executor report entry")
      }
      const additionalCommands: ReadonlyArray<RecordedCassetteEntry> = [
        {
          _tag: "ControlCommandRecorded",
          command: ControlCommand.cases.RequestRunUnpause.make({
            commandId: ControlCommandId.make("rename-run-unpause-command"),
            operatorId: AuthenticatedOperatorIdentity.make("cassette-operator"),
            runId: run.runId
          })
        },
        {
          _tag: "ControlCommandRecorded",
          command: ControlCommand.cases.RequestTaskPause.make({
            commandId: ControlCommandId.make("rename-task-pause-command"),
            operatorId: AuthenticatedOperatorIdentity.make("cassette-operator"),
            runId: run.runId,
            taskId: TaskId.make("A")
          })
        },
        {
          _tag: "ControlCommandRecorded",
          command: ControlCommand.cases.RequestTaskUnpause.make({
            commandId: ControlCommandId.make("rename-task-unpause-command"),
            operatorId: AuthenticatedOperatorIdentity.make("cassette-operator"),
            runId: run.runId,
            taskId: TaskId.make("A")
          })
        }
      ]
      const entriesWithSuspension = projected.entries.map((entry) =>
        entry === executorReportEntry
          ? {
              _tag: "PlannedAttemptExecutorWorkReported" as const,
              occurrenceClassification: "NonActionOccurrence" as const,
              ordinal: executorReportEntry.ordinal,
              report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
                correlation: executorReportEntry.report.correlation
              })
            }
          : entry
      )
      const terminationIndex = entriesWithSuspension.findIndex((entry) => entry._tag === "WorkflowRunTerminated")
      const insertionIndex = terminationIndex < 0 ? entriesWithSuspension.length : terminationIndex
      const recorded = RecordedCassette.make({
        ...projected,
        entries: [
          ...entriesWithSuspension.slice(0, insertionIndex),
          ...additionalCommands,
          {
            _tag: "TaskWorkCapacityChanged",
            capacity: TaskWorkCapacity.make(2),
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            previousRevision: RunPolicyRevision.make(1),
            revision: RunPolicyRevision.make(2)
          },
          ...entriesWithSuspension.slice(insertionIndex)
        ]
      })
      const encodedBefore = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded))
      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: "attempt:A:0", to: "renamed-attempt-A" }],
        claimTokens: [{ from: `cassette-claim:A:cassette:${run.runId}:operation:2`, to: "renamed-claim-token-A" }],
        controlCommandIds: [
          { from: "rename-command", to: "renamed-command" },
          { from: "rename-run-unpause-command", to: "renamed-run-unpause-command" },
          { from: "rename-task-pause-command", to: "renamed-task-pause-command" },
          { from: "rename-task-unpause-command", to: "renamed-task-unpause-command" }
        ],
        operationIds: Array.from({ length: 7 }, (_unused, ordinal) => ({
          from: `cassette:${run.runId}:operation:${ordinal}`,
          to: `renamed-operation:${ordinal}`
        })),
        runIds: [{ from: run.runId, to: "renamed-run" }],
        taskBranchRefs: [{ from: "refs/heads/dalph/attempt-A-0", to: "refs/heads/dalph/renamed-attempt-A" }],
        worktreeLocators: [{ from: "/dalph/cassettes/attempt-A-0", to: "/dalph/cassettes/renamed-attempt-A" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const recordedHistory = foldRecordedCassette(recorded)
      if (recordedHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("alpha-renaming fixture must remain valid before renaming")
      }
      const checkpoints = yield* verifyRecordedCassetteRoundTripWithRenaming(
        recordedHistory.records,
        renamed,
        invertCassetteIdentityRenaming(renaming)
      )
      const encodedAfter = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(renamed))
      const allRenamings = [
        ...renaming.attemptIds,
        ...renaming.claimTokens,
        ...renaming.controlCommandIds,
        ...renaming.operationIds,
        ...renaming.runIds,
        ...renaming.taskBranchRefs,
        ...renaming.worktreeLocators
      ]
      const entryVariants = {
        ControlCommandRecorded: true,
        PlannedAttemptExecutorWorkReported: true,
        PlannedAttemptExecutorWorkResponsibilityBegan: true,
        TaskAttemptPlanned: true,
        TaskClaimAcquired: true,
        TaskClaimAcquisitionIntended: true,
        TaskTrackerFactsObserved: true,
        TaskTrackerReadInitiated: true,
        TaskWorktreeReady: true,
        TaskWorktreeReconciliationIntended: true,
        TaskWorkCapacityChanged: true,
        WorkflowRunBegan: true,
        WorkflowRunTerminated: true
      } satisfies Record<RecordedCassetteEntry["_tag"], true>
      const operationVariants = {
        AcquireTaskClaim: true,
        ReadTaskWorkSpecification: true,
        ReadTrackerGraph: true,
        RecordTaskAttemptPlan: true,
        ReconcileTaskWorktree: true
      } satisfies Record<WorkflowOperation["_tag"], true>
      const observationVariants = {
        CompleteTaskTrackerFacts: true,
        FocusedTaskWorkSpecificationFacts: true,
        UnchangedTaskTrackerFactsReconfirmed: true
      } satisfies Record<TaskTrackerFactsObservation["_tag"], true>

      expect(checkpoints.every((checkpoint) => checkpoint.workflowHistoryEquivalent)).toBe(true)
      for (const { from, to } of allRenamings) {
        expect(encodedAfter).not.toContain(`"${from}"`)
        expect(encodedAfter).toContain(`"${to}"`)
      }
      expect(new Set(recorded.entries.map(({ _tag }) => _tag))).toEqual(new Set(Object.keys(entryVariants)))
      expect(
        new Set(recorded.entries.flatMap((entry) => ("operation" in entry ? [entry.operation._tag] : [])))
      ).toEqual(new Set(Object.keys(operationVariants)))
      expect(
        new Set(
          recorded.entries.flatMap((entry) => (entry._tag === "TaskTrackerFactsObserved" ? [entry.evidence._tag] : []))
        )
      ).toEqual(new Set(Object.keys(observationVariants)))
      expect(encodedAfter).toContain("1111111111111111111111111111111111111111")
      expect(encodedAfter).toContain("singleton-revision")
      expect(encodedBefore).toContain("singleton-revision")
      expect(renderRecordedCassetteLyrics(recorded)).toContain("Dalph terminated the Run with disposition Completed.")
    })
)

it.effect("rejects identity renaming that repeats a source or destination", () =>
  Effect.gen(function* () {
    const otherwiseEmptyRenaming = {
      claimTokens: [],
      controlCommandIds: [],
      operationIds: [],
      runIds: [],
      taskBranchRefs: [],
      worktreeLocators: []
    }
    const repeatedSource = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      ...otherwiseEmptyRenaming,
      attemptIds: [
        { from: "attempt-A", to: "renamed-A" },
        { from: "attempt-A", to: "renamed-B" }
      ]
    }).pipe(Effect.flip)
    const repeatedDestination = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      ...otherwiseEmptyRenaming,
      attemptIds: [
        { from: "attempt-A", to: "renamed-A" },
        { from: "attempt-B", to: "renamed-A" }
      ]
    }).pipe(Effect.flip)

    expect(String(repeatedSource)).toContain("identity renaming must be one-to-one")
    expect(String(repeatedDestination)).toContain("identity renaming must be one-to-one")
  })
)

it.effect("has no recording for an empty unidentified journal", () =>
  Effect.gen(function* () {
    const empty = yield* projectRecordedCassette([]).pipe(Effect.flip)
    expect(empty._tag).toBe("EmptyJournalCannotBeRecorded")

    const run = yield* runAuthoredScenarioCassette(singleton)
    const recorded = yield* projectRecordedCassette(run.records)
    const malformed = RecordedCassette.make({
      ...recorded,
      entries: recorded.entries.filter((entry) => entry._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan")
    })
    expect(
      verifyRecordedCassetteRoundTrip(run.records, malformed).some(
        (checkpoint) =>
          !checkpoint.operationalStateEquivalent &&
          !checkpoint.workflowHistoryEquivalent &&
          !checkpoint.appliedOccurrencePositionEquivalent
      )
    ).toBe(true)
  })
)

it.effect(
  "detects responsibility and Running before worktree readiness even when final operational state converges",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singleton)
      const expected = yield* projectRecordedCassette(run.records)
      const responsibility = expected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      const running = expected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorWorkReported" && entry.report._tag === "Running"
      )
      expect(responsibility?._tag).toBe("PlannedAttemptExecutorWorkResponsibilityBegan")
      expect(running?._tag).toBe("PlannedAttemptExecutorWorkReported")
      if (
        responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan" ||
        running?._tag !== "PlannedAttemptExecutorWorkReported"
      )
        return

      const remaining = expected.entries.filter((entry) => entry !== responsibility && entry !== running)
      const planIndex = remaining.findIndex((entry) => entry._tag === "TaskAttemptPlanned")
      const actual = RecordedCassette.make({
        ...expected,
        entries: [...remaining.slice(0, planIndex + 1), responsibility, running, ...remaining.slice(planIndex + 1)]
      })
      const checkpoints = compareRecordedCassetteCheckpoints(expected, actual)

      expect(foldRecordedCassette(expected)._tag).toBe("ValidWorkflowJournalHistory")
      expect(foldRecordedCassette(actual)._tag).toBe("ValidWorkflowJournalHistory")
      expect(checkpoints.at(-1)?.operationalStateEquivalent).toBe(true)
      expect(checkpoints.at(-1)?.workflowHistoryEquivalent).toBe(false)
      expect(checkpoints.some((checkpoint) => !checkpoint.pureSelectionEquivalent)).toBe(true)
    })
)

it.effect("renders a recorded operator command from its structured occurrence", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singleton)
    const command = ControlCommand.cases.RequestRunPause.make({
      commandId: ControlCommandId.make("cassette-pause"),
      operatorId: AuthenticatedOperatorIdentity.make("cassette-operator"),
      runId: run.runId
    })
    const event = ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
    const withCommand = yield* projectRecordedCassette(insertBeforeRunTermination(run.records, event))
    expect(renderRecordedCassetteLyrics(withCommand)).toContain(
      "Dalph recorded the operator's RequestRunPause command."
    )
    expect(foldRecordedCassette(withCommand)._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("labels the 100-task four-read encoding experiment as a baseline", () =>
  Effect.gen(function* () {
    const taskIds = Array.from({ length: 100 }, (_unused, index) => `task-${index.toString().padStart(3, "0")}`)
    const activeTaskId = taskIds[99] ?? "task-099"
    const graph = {
      revision: "size-baseline-revision",
      tasks: taskIds.map((id, index) => ({
        id,
        lifecycle: { _tag: id === activeTaskId ? "Open" : "CompletedSuccessfully" },
        parentTaskId: null,
        prerequisiteIds: index === 0 ? [] : [taskIds[index - 1]]
      }))
    }
    const replaceTask = (value: string) => (value === "A" ? activeTaskId : value)
    const input = {
      ...singleton,
      name: "100-task four-read encoded-size baseline",
      startingFacts: {
        ...singleton.startingFacts,
        taskWorkSpecifications: [
          { body: "Measure the maintained encoding.", taskId: activeTaskId, title: "Measure encoding" }
        ],
        trackerGraph: graph
      },
      story: singleton.story.map((item) => {
        if (item._tag === "TrackerGraphReadReturned") return { ...item, graph }
        if (item._tag === "TaskWorkSpecificationReadReturned") {
          return { ...item, body: "Measure the maintained encoding.", taskId: activeTaskId, title: "Measure encoding" }
        }
        if (item._tag === "DalphSelects" && "taskId" in item.operation) {
          if (item.operation._tag === "AcquireTaskClaim" || item.operation._tag === "ReadTaskWorkSpecification") {
            return { ...item, operation: { ...item.operation, taskId: replaceTask(item.operation.taskId) } }
          }
          return {
            ...item,
            operation: {
              ...item.operation,
              attemptId: `attempt:${activeTaskId}:0`,
              taskId: replaceTask(item.operation.taskId)
            }
          }
        }
        if (item._tag === "PlannedAttemptExecutorWorkReported") {
          return { ...item, report: { ...item.report, attemptId: `attempt:${activeTaskId}:0` } }
        }
        if (item._tag === "ExpectedBehavior") {
          return {
            ...item,
            taskWork: {
              absences: [],
              results: item.taskWork.results.map((result) => ({ ...result, taskId: replaceTask(result.taskId) }))
            }
          }
        }
        return item
      })
    }
    const run = yield* runAuthoredScenarioCassette(input)
    const recorded = yield* projectRecordedCassette(run.records)
    const measurement = measureTrackerObservationEncoding(run.records, recorded)

    expect(measurement.changedGraphObservations.occurrenceCount).toBe(1)
    expect(measurement.unchangedGraphReconfirmations.occurrenceCount).toBe(3)
    expect(measurement.changedGraphObservations.journalBytes).toBeGreaterThan(0)
  })
)
