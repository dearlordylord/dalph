import { it } from "@effect/vitest"
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
  CassetteIdentityRenaming,
  compareRecordedCassetteCheckpoints,
  foldRecordedCassette,
  measureTrackerObservationEncoding,
  projectRecordedCassette,
  RecordedCassette,
  invertCassetteIdentityRenaming,
  renameRecordedCassette,
  renderAuthoredCassetteLyrics,
  renderRecordedCassetteLyrics,
  runAuthoredScenarioCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

const graph = {
  revision: "singleton-revision",
  tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
}
const correlation = { attemptId: "attempt:A:0", runId: "cassette-singleton" }
const singletonCassette = {
  _tag: "AuthoredScenarioCassette",
  actorCommands: [
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      capacity: 1,
      claimOwner: "cassette-owner",
      claimTokenPrefix: "cassette-claim",
      executor: "executor:controlled-fake",
      runId: "cassette-singleton",
      target: "cassette-target",
      worktreeRoot: "/dalph/cassettes"
    }
  ],
  expectedDecisions: [
    { _tag: "ReadTrackerGraph", target: "cassette-target" },
    { _tag: "ReadTrackerGraph", target: "cassette-target" },
    { _tag: "AcquireTaskClaim", taskId: "A" },
    { _tag: "ReadTrackerGraph", target: "cassette-target" },
    { _tag: "ReadTaskWorkSpecification", taskId: "A" },
    { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" },
    { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" }
  ],
  expectedVisibleBehavior: {
    forbiddenJournalOccurrenceTags: ["ControlCommandRecorded"],
    journalHistory: "ValidWorkflowJournalHistory",
    plannedAttemptExecutorReports: [
      { _tag: "Running", correlation },
      { _tag: "Terminal", correlation, result: { _tag: "Completed" } }
    ]
  },
  name: "one open task completes its executor work",
  outsideOccurrences: [
    { _tag: "TrackerGraphReadReturned", graph },
    { _tag: "TrackerGraphReadReturned", graph },
    { _tag: "TrackerGraphReadReturned", graph },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the accepted singleton behavior.",
      taskId: "A",
      title: "Implement singleton"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", correlation },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", correlation, result: { _tag: "Completed" } },
      request: "StartOrContinue"
    }
  ],
  schemaVersion: 1,
  startingFacts: {
    taskWorkSpecifications: [
      { body: "Implement the accepted singleton behavior.", taskId: "A", title: "Implement singleton" }
    ],
    trackerGraph: graph
  }
}

const representativeTaskCount = 100
const representativeTaskIds = Array.from(
  { length: representativeTaskCount },
  (_unused, index) => `task-${index.toString().padStart(3, "0")}`
)
const representativeActiveTaskId = representativeTaskIds.at(-1) ?? "task-099"
const representativeGraph = {
  revision: "representative-graph-revision",
  tasks: representativeTaskIds.map((id, index) => ({
    id,
    lifecycle: { _tag: id === representativeActiveTaskId ? "Open" : "CompletedSuccessfully" },
    parentTaskId: null,
    prerequisiteIds: index === 0 ? [] : [representativeTaskIds[index - 1]]
  }))
}
const representativeCorrelation = {
  attemptId: `attempt:${representativeActiveTaskId}:0`,
  runId: "cassette-representative-graph"
}
const representativeCassette = {
  ...singletonCassette,
  actorCommands: [
    {
      ...singletonCassette.actorCommands[0],
      runId: representativeCorrelation.runId,
      target: "representative-cassette-target"
    }
  ],
  expectedDecisions: singletonCassette.expectedDecisions.map((decision) => {
    if (decision._tag === "ReadTrackerGraph") return { ...decision, target: "representative-cassette-target" }
    if (decision._tag === "AcquireTaskClaim" || decision._tag === "ReadTaskWorkSpecification") {
      return { ...decision, taskId: representativeActiveTaskId }
    }
    return { ...decision, attemptId: representativeCorrelation.attemptId, taskId: representativeActiveTaskId }
  }),
  expectedVisibleBehavior: {
    ...singletonCassette.expectedVisibleBehavior,
    plannedAttemptExecutorReports: [
      { _tag: "Running", correlation: representativeCorrelation },
      { _tag: "Terminal", correlation: representativeCorrelation, result: { _tag: "Completed" } }
    ]
  },
  name: "one open task in a representative repeatedly refreshed graph",
  outsideOccurrences: [
    { _tag: "TrackerGraphReadReturned", graph: representativeGraph },
    { _tag: "TrackerGraphReadReturned", graph: representativeGraph },
    { _tag: "TrackerGraphReadReturned", graph: representativeGraph },
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: "Implement the active task in the representative graph.",
      taskId: representativeActiveTaskId,
      title: "Implement representative active task"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", correlation: representativeCorrelation },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", correlation: representativeCorrelation, result: { _tag: "Completed" } },
      request: "StartOrContinue"
    }
  ],
  startingFacts: {
    taskWorkSpecifications: [
      {
        body: "Implement the active task in the representative graph.",
        taskId: representativeActiveTaskId,
        title: "Implement representative active task"
      }
    ],
    trackerGraph: representativeGraph
  }
}

it.effect("runs an authored cassette through the production loop and matches its declared decisions", () =>
  Effect.gen(function* () {
    const result = yield* runAuthoredScenarioCassette(singletonCassette)

    expect(result.decisions).toEqual(result.cassette.expectedDecisions)
    expect(result.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(result.visibleBehavior.plannedAttemptExecutorReports).toEqual(
      result.cassette.expectedVisibleBehavior.plannedAttemptExecutorReports
    )
    expect(renderAuthoredCassetteLyrics(result.cassette)).toContain(
      "The journal must not contain ControlCommandRecorded."
    )
    expect(result.records.map(({ event }) => event._tag)).toContain("PlannedAttemptExecutorWorkResponsibilityBegan")
    expect(result.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
  })
)

it.effect("accepts generated identities only through one consistent renaming", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singletonCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      attemptIds: [{ from: "attempt:A:0", to: "renamed-attempt-A" }],
      claimTokens: [{ from: "cassette-claim:A:cassette:cassette-singleton:operation:2", to: "renamed-claim-token-A" }],
      operationIds: Array.from({ length: 7 }, (_unused, ordinal) => ({
        from: `cassette:cassette-singleton:operation:${ordinal}`,
        to: `renamed-operation:${ordinal}`
      })),
      runIds: [{ from: "cassette-singleton", to: "renamed-run" }],
      taskBranchRefs: [{ from: "refs/heads/dalph/attempt-A-0", to: "refs/heads/dalph/renamed-attempt-A" }],
      worktreeLocators: [{ from: "/dalph/cassettes/attempt-A-0", to: "/dalph/cassettes/renamed-attempt-A" }]
    })
    const renamed = yield* renameRecordedCassette(recorded, renaming)
    const checkpoints = yield* verifyRecordedCassetteRoundTripWithRenaming(
      run.records,
      renamed,
      invertCassetteIdentityRenaming(renaming)
    )

    expect(renamed.runId).toBe("renamed-run")
    expect(
      checkpoints.every(
        ({ decisionsEquivalent, stateEquivalent, workflowHistoryEquivalent }) =>
          decisionsEquivalent && stateEquivalent && workflowHistoryEquivalent
      )
    ).toBe(true)
    const inconsistent = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      ...renaming,
      operationIds: [
        { from: "operation-a", to: "same-operation" },
        { from: "operation-b", to: "same-operation" }
      ]
    }).pipe(Effect.flip)
    expect(inconsistent._tag).toBe("SchemaError")
  })
)

it.effect("reports encoded journal and cassette sizes for changed and unchanged graph observations", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(representativeCassette)
    const recorded = yield* projectRecordedCassette(run.records)

    expect(measureTrackerObservationEncoding(run.records, recorded)).toMatchInlineSnapshot(`
      {
        "changedGraphObservations": {
          "journalBytes": 24586,
          "occurrenceCount": 1,
          "recordedCassetteBytes": 24593,
        },
        "unchangedGraphReconfirmations": {
          "journalBytes": 11829,
          "occurrenceCount": 2,
          "recordedCassetteBytes": 11747,
        },
      }
    `)
  })
)

it.effect("round-trips every journaled occurrence and preserves state and decisions after every prefix", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singletonCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const encoded = yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded)
    const decoded = yield* Schema.decodeUnknownEffect(RecordedCassette)(encoded)
    const encodedEntries = Reflect.get(encoded, "entries")

    expect(decoded.entries).toHaveLength(run.records.length)
    expect(JSON.stringify(encodedEntries)).not.toMatch(/"key"|"position"|"version"/)
    expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
    expect(verifyRecordedCassetteRoundTrip(run.records, recorded)).toEqual(
      run.records.map((_record, index) => ({
        checkpoint: index + 1,
        decisionsEquivalent: true,
        stateEquivalent: true,
        workflowHistoryEquivalent: true
      }))
    )
    expect(renderRecordedCassetteLyrics(recorded)).toContain(
      "Dalph coordinator began executor-work responsibility for task A, attempt attempt:A:0."
    )
  })
)

it.effect("does not invent an authored outside occurrence that Dalph never observes", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      outsideOccurrences: [
        ...singletonCassette.outsideOccurrences,
        {
          _tag: "TaskWorkSpecificationEditedWithoutDalphObservation",
          body: "This edit happens after Dalph's final read.",
          taskId: "A",
          title: "Unobserved edit"
        }
      ]
    })
    const recorded = yield* projectRecordedCassette(run.records)

    expect(run.cassette.outsideOccurrences.map(({ _tag }) => _tag)).toContain(
      "TaskWorkSpecificationEditedWithoutDalphObservation"
    )
    expect(recorded.entries.map(({ _tag }) => _tag)).not.toContain("TaskWorkSpecificationEditedWithoutDalphObservation")
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "Another person edits task A, but Dalph never observes that edit."
    )
  })
)

it.effect("rejects an executor entry for a different planned attempt", () =>
  Effect.gen(function* () {
    const mismatched = {
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.map((occurrence) =>
        occurrence._tag === "PlannedAttemptExecutorWorkReported" && "report" in occurrence
          ? {
              ...occurrence,
              report: {
                ...occurrence.report,
                correlation: { ...occurrence.report.correlation, attemptId: "another-attempt" }
              }
            }
          : occurrence
      )
    }
    const failure = yield* runAuthoredScenarioCassette(mismatched).pipe(Effect.flip)
    expect(failure._tag).toBe("ControlledFakeExecutorMismatch")
  })
)

it.effect("fails typed authored boundaries and declared behavior mismatches", () =>
  Effect.gen(function* () {
    const inconsistentStartingFacts = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      startingFacts: {
        ...singletonCassette.startingFacts,
        trackerGraph: { ...graph, revision: "not-the-first-return" }
      }
    }).pipe(Effect.flip)
    expect(inconsistentStartingFacts._tag).toBe("SchemaError")

    const duplicateStartingSpecification = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      startingFacts: {
        ...singletonCassette.startingFacts,
        taskWorkSpecifications: [
          ...singletonCassette.startingFacts.taskWorkSpecifications,
          ...singletonCassette.startingFacts.taskWorkSpecifications
        ]
      }
    }).pipe(Effect.flip)
    expect(duplicateStartingSpecification._tag).toBe("SchemaError")

    const onlyOneGraphReturn = {
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.filter(
        (occurrence, index) => occurrence._tag !== "TrackerGraphReadReturned" || index === 0
      )
    }
    const noGraphReturn = yield* runAuthoredScenarioCassette(onlyOneGraphReturn).pipe(Effect.flip)
    expect(noGraphReturn._tag).toBe("TrackerGraphReader.AdapterReadError")

    const invalidGraph = { revision: "invalid-duplicate-task", tasks: [graph.tasks[0], graph.tasks[0]] }
    const invalidGraphReturn = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.map((occurrence) =>
        occurrence._tag === "TrackerGraphReadReturned" ? { ...occurrence, graph: invalidGraph } : occurrence
      ),
      startingFacts: { ...singletonCassette.startingFacts, trackerGraph: invalidGraph }
    }).pipe(Effect.flip)
    expect(invalidGraphReturn._tag).toBe("TrackerGraphReader.AdapterReadError")

    const withoutSpecification = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.filter(
        (occurrence) => occurrence._tag !== "TaskWorkSpecificationReadReturned"
      )
    }).pipe(Effect.flip)
    expect(withoutSpecification._tag).toBe("TrackerGraphReader.AdapterReadError")

    const wrongSpecification = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.map((occurrence) =>
        occurrence._tag === "TaskWorkSpecificationReadReturned" ? { ...occurrence, taskId: "B" } : occurrence
      )
    }).pipe(Effect.flip)
    expect(wrongSpecification._tag).toBe("SchemaError")

    const wrongRuntimeSpecification = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.map((occurrence) =>
        occurrence._tag === "TaskWorkSpecificationReadReturned" ? { ...occurrence, taskId: "B" } : occurrence
      ),
      startingFacts: {
        ...singletonCassette.startingFacts,
        taskWorkSpecifications: [{ ...singletonCassette.startingFacts.taskWorkSpecifications[0], taskId: "B" }]
      }
    }).pipe(Effect.flip)
    expect(wrongRuntimeSpecification._tag).toBe("TrackerGraphReader.AdapterReadError")

    const decisionMismatch = yield* runAuthoredScenarioCassette({ ...singletonCassette, expectedDecisions: [] }).pipe(
      Effect.flip
    )
    expect(decisionMismatch._tag).toBe("AuthoredCassetteDecisionMismatch")

    const visibleBehaviorMismatch = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      expectedVisibleBehavior: { ...singletonCassette.expectedVisibleBehavior, plannedAttemptExecutorReports: [] }
    }).pipe(Effect.flip)
    expect(visibleBehaviorMismatch._tag).toBe("AuthoredCassetteVisibleBehaviorMismatch")

    const suspendStep = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      outsideOccurrences: singletonCassette.outsideOccurrences.map((occurrence) =>
        occurrence._tag === "PlannedAttemptExecutorWorkReported" ? { ...occurrence, request: "Suspend" } : occurrence
      )
    }).pipe(Effect.flip)
    expect(suspendStep._tag).toBe("ControlledFakeExecutorMismatch")
  })
)

it.effect("rejects empty and invalid journals without exposing a partial recording", () =>
  Effect.gen(function* () {
    const empty = yield* projectRecordedCassette([]).pipe(Effect.flip)
    expect(empty._tag).toBe("EmptyJournalCannotBeRecorded")

    const run = yield* runAuthoredScenarioCassette(singletonCassette)
    const withoutExecutorResponsibility = run.records.filter(
      ({ event }) => event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    const invalid = yield* projectRecordedCassette(withoutExecutorResponsibility).pipe(Effect.flip)
    expect(invalid._tag).toBe("InvalidWorkflowJournalHistory")

    const recorded = yield* projectRecordedCassette(run.records)
    const malformed = RecordedCassette.make({
      ...recorded,
      entries: recorded.entries.filter((entry) => entry._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan")
    })
    expect(
      verifyRecordedCassetteRoundTrip(run.records, malformed).some(({ stateEquivalent }) => !stateEquivalent)
    ).toBe(true)
  })
)

it.effect("renders recorded operator commands from their structured entry", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singletonCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const command = ControlCommand.cases.RequestRunPause.make({
      commandId: ControlCommandId.make("cassette-pause"),
      operatorId: AuthenticatedOperatorIdentity.make("cassette-operator"),
      runId: recorded.runId
    })
    const commandEvent = ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
    const commandRecord = {
      event: commandEvent,
      key: describeJournalEvent(commandEvent).expectedKey,
      position: JournalPosition.make(1),
      runId: recorded.runId
    }
    const withCommand = yield* projectRecordedCassette(
      [...run.records, commandRecord].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
    )

    expect(renderRecordedCassetteLyrics(withCommand)).toContain(
      "Dalph recorded the operator's RequestRunPause command."
    )
    expect(renderRecordedCassetteLyrics(withCommand)).toContain(
      "Git showed worktree /dalph/cassettes/attempt-A-0 ready"
    )
    expect(foldRecordedCassette(withCommand)._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("rejects an illegal early start even when the final semantic state agrees", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singletonCassette)
    const expected = yield* projectRecordedCassette(run.records)
    const responsibility = expected.entries.find(
      (entry) => entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    expect(responsibility?._tag).toBe("PlannedAttemptExecutorWorkResponsibilityBegan")
    if (responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return

    const withoutResponsibility = expected.entries.filter((entry) => entry !== responsibility)
    const planIndex = withoutResponsibility.findIndex((entry) => entry._tag === "TaskAttemptPlanned")
    const actual = RecordedCassette.make({
      ...expected,
      entries: [
        ...withoutResponsibility.slice(0, planIndex + 1),
        responsibility,
        ...withoutResponsibility.slice(planIndex + 1)
      ]
    })
    const expectedFinal = foldRecordedCassette(expected)
    const actualFinal = foldRecordedCassette(actual)
    const checkpoints = compareRecordedCassetteCheckpoints(expected, actual)

    expect(expectedFinal._tag).toBe("ValidWorkflowJournalHistory")
    expect(actualFinal._tag).toBe("ValidWorkflowJournalHistory")
    expect(checkpoints.at(-1)?.stateEquivalent).toBe(true)
    expect(checkpoints.at(-1)?.workflowHistoryEquivalent).toBe(false)
    expect(checkpoints.some(({ decisionsEquivalent }) => !decisionsEquivalent)).toBe(true)
  })
)
