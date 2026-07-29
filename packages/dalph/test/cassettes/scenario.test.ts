import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  AuthenticatedOperatorIdentity,
  ControlCommand,
  ControlCommandId,
  ControlCommandRecordedEvent,
  describeJournalEvent,
  JournalPosition,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  AuthoredScenarioCassette,
  CassetteIdentityRenaming,
  compareRecordedCassetteCheckpoints,
  foldRecordedCassette,
  invertCassetteIdentityRenaming,
  maintainedAuthoredCassetteCatalog,
  measureTrackerObservationEncoding,
  projectRecordedCassette,
  RecordedCassette,
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

it.effect("runs the maintained singleton through production activation and stops at terminal executor work", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.singletonTaskCompletes)
    const encoded = yield* Schema.encodeUnknownEffect(AuthoredScenarioCassette)(run.cassette)
    const terminalAssertions = run.cassette.story.at(-1)
    const lastEvent = run.records.at(-1)?.event

    expect(JSON.stringify(encoded)).not.toContain("runId")
    expect(run.runId).toMatch(/^workflow:"cassette-target":/)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.observedOutcomes).toEqual(
      terminalAssertions?._tag === "ExpectedObservedOutcomes" ? terminalAssertions.expected : []
    )
    expect(run.records.at(-1)?.event._tag).toBe("PlannedAttemptExecutorWorkReported")
    expect(lastEvent?._tag === "PlannedAttemptExecutorWorkReported" ? lastEvent.report._tag : undefined).toBe(
      "Terminal"
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("The story requires 5 outcomes and forbids 1.")
  })
)

it.effect("assigns a fresh exact run identity each time the same tracker target starts", () =>
  Effect.gen(function* () {
    const first = yield* runAuthoredScenarioCassette(singleton)
    const second = yield* runAuthoredScenarioCassette(singleton)

    expect(first.runId).not.toBe(second.runId)
    expect(first.runId).toMatch(/^workflow:"cassette-target":/)
    expect(second.runId).toMatch(/^workflow:"cassette-target":/)
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
      story: singleton.story.filter((item) => item._tag !== "ExpectedObservedOutcomes")
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
    if (assertions?._tag !== "ExpectedObservedOutcomes") return yield* Effect.die("missing singleton assertions")
    const duplicateExpected = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        { ...assertions, expected: [...assertions.expected, assertions.expected[0]] }
      ]
    }
    expect((yield* runAuthoredScenarioCassette(duplicateExpected).pipe(Effect.flip))._tag).toBe("SchemaError")
    const duplicateForbidden = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        { ...assertions, forbidden: [...assertions.forbidden, assertions.forbidden[0]] }
      ]
    }
    expect((yield* runAuthoredScenarioCassette(duplicateForbidden).pipe(Effect.flip))._tag).toBe("SchemaError")
    const contradictory = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        { ...assertions, forbidden: [...assertions.forbidden, assertions.expected[0]] }
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

it.effect("fails at an unsupported chronological capacity change without changing production admission", () =>
  Effect.gen(function* () {
    const withUnsupportedChange = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, 2),
        { _tag: "SetTaskExecutionCapacity", capacity: 2 },
        ...singleton.story.slice(2)
      ]
    }
    const failure = yield* runAuthoredScenarioCassette(withUnsupportedChange).pipe(Effect.flip)
    expect(failure._tag).toBe("TraceOutput.TraceOutputError")
    expect("detail" in failure ? failure.detail : "").toContain("UnsupportedAuthoredCapacityChange")
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

it.effect("derives failed and safely-suspended executor outcomes only from recorded handling", () =>
  Effect.gen(function* () {
    const failed = {
      ...singleton,
      story: singleton.story.map((item) => {
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal") {
          return { ...item, report: { ...item.report, result: { _tag: "Failed" } } }
        }
        if (item._tag === "ExpectedObservedOutcomes") {
          return {
            ...item,
            expected: item.expected.map((outcome) =>
              outcome._tag === "ExecutorReported" && outcome.report === "TerminalCompleted"
                ? { ...outcome, report: "TerminalFailed" }
                : outcome
            )
          }
        }
        return item
      })
    }
    const failedRun = yield* runAuthoredScenarioCassette(failed)
    expect(failedRun.observedOutcomes).toContainEqual({
      _tag: "ExecutorReported",
      attemptId: "attempt:A:0",
      report: "TerminalFailed"
    })

    const safelySuspended = {
      ...singleton,
      story: singleton.story.reduce<ReadonlyArray<unknown>>((story, item) => {
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running") {
          return [...story, { ...item, report: { _tag: "SafelySuspended", attemptId: item.report.attemptId } }]
        }
        if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal") return story
        if (item._tag === "ExpectedObservedOutcomes") {
          return [
            ...story,
            {
              ...item,
              expected: [
                ...item.expected.filter((outcome) => outcome._tag !== "ExecutorReported"),
                { _tag: "ExecutorReported", attemptId: "attempt:A:0", report: "SafelySuspended" }
              ]
            }
          ]
        }
        return [...story, item]
      }, [])
    }
    const suspendedRun = yield* runAuthoredScenarioCassette(safelySuspended)
    expect(suspendedRun.observedOutcomes).toContainEqual({
      _tag: "ExecutorReported",
      attemptId: "attempt:A:0",
      report: "SafelySuspended"
    })
  })
)

it.effect("fails typed observed-outcome assertions and renders the unsupported capacity item", () =>
  Effect.gen(function* () {
    const wrongOutcomes = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedObservedOutcomes" ? { ...item, expected: [] } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongOutcomes).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteOutcomeMismatch"
    )

    const decoded = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...singleton,
      story: [
        ...singleton.story.slice(0, 2),
        { _tag: "SetTaskExecutionCapacity", capacity: 2 },
        ...singleton.story.slice(2)
      ]
    })
    expect(renderAuthoredCassetteLyrics(decoded)).toContain(
      "The unsupported story asks Dalph to change task-execution capacity to 2."
    )
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
      const records = [
        ...run.records,
        {
          event: commandEvent,
          key: describeJournalEvent(commandEvent).expectedKey,
          position: JournalPosition.make(run.records.length + 1),
          runId: run.runId
        }
      ]
      const recorded = yield* projectRecordedCassette(records)
      const encodedBefore = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded))
      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: "attempt:A:0", to: "renamed-attempt-A" }],
        claimTokens: [{ from: `cassette-claim:A:cassette:${run.runId}:operation:2`, to: "renamed-claim-token-A" }],
        controlCommandIds: [{ from: "rename-command", to: "renamed-command" }],
        operationIds: Array.from({ length: 7 }, (_unused, ordinal) => ({
          from: `cassette:${run.runId}:operation:${ordinal}`,
          to: `renamed-operation:${ordinal}`
        })),
        runIds: [{ from: run.runId, to: "renamed-run" }],
        taskBranchRefs: [{ from: "refs/heads/dalph/attempt-A-0", to: "refs/heads/dalph/renamed-attempt-A" }],
        worktreeLocators: [{ from: "/dalph/cassettes/attempt-A-0", to: "/dalph/cassettes/renamed-attempt-A" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const checkpoints = yield* verifyRecordedCassetteRoundTripWithRenaming(
        records,
        renamed,
        invertCassetteIdentityRenaming(renaming)
      )
      const encodedAfter = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(renamed))

      expect(checkpoints.every((checkpoint) => checkpoint.workflowHistoryEquivalent)).toBe(true)
      expect(encodedAfter).toContain("renamed-run")
      expect(encodedAfter).toContain("renamed-attempt-A")
      expect(encodedAfter).toContain("renamed-command")
      expect(encodedAfter).toContain("renamed-claim-token-A")
      expect(encodedAfter).toContain("renamed-operation:0")
      expect(encodedAfter).toContain("1111111111111111111111111111111111111111")
      expect(encodedAfter).toContain("singleton-revision")
      expect(encodedBefore).toContain("singleton-revision")
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
    const withCommand = yield* projectRecordedCassette([
      ...run.records,
      {
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(run.records.length + 1),
        runId: run.runId
      }
    ])
    expect(renderRecordedCassetteLyrics(withCommand)).toContain(
      "Dalph recorded the operator's RequestRunPause command."
    )
    expect(foldRecordedCassette(withCommand)._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("labels the 100-task three-read encoding experiment as a baseline", () =>
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
      name: "100-task three-read encoded-size baseline",
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
        if (item._tag === "ExpectedObservedOutcomes") {
          return {
            ...item,
            expected: item.expected.map((outcome) => {
              switch (outcome._tag) {
                case "TaskClaimed":
                  return { ...outcome, taskId: replaceTask(outcome.taskId) }
                case "ExecutorReported":
                  return { ...outcome, attemptId: `attempt:${activeTaskId}:0` }
                case "TaskAttemptPrepared":
                case "TaskWorktreeReady":
                  return { ...outcome, attemptId: `attempt:${activeTaskId}:0`, taskId: replaceTask(outcome.taskId) }
              }
            }),
            forbidden: []
          }
        }
        return item
      })
    }
    const run = yield* runAuthoredScenarioCassette(input)
    const recorded = yield* projectRecordedCassette(run.records)
    const measurement = measureTrackerObservationEncoding(run.records, recorded)

    expect(measurement.changedGraphObservations.occurrenceCount).toBe(1)
    expect(measurement.unchangedGraphReconfirmations.occurrenceCount).toBe(2)
    expect(measurement.changedGraphObservations.journalBytes).toBeGreaterThan(0)
  })
)
