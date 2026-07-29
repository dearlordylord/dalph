import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import {
  AuthenticatedOperatorIdentity,
  ControlCommand,
  ControlCommandId,
  ControlCommandRecordedEvent,
  describeJournalEvent,
  JournalPosition,
  makeTaskWorkSpecification,
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
const singletonBaseSha = "1111111111111111111111111111111111111111"
const singletonBranch = "refs/heads/dalph/attempt-A-0"
const singletonWorktree = "/dalph/cassettes/attempt-A-0"
const singletonSpecification = {
  body: "Implement the accepted singleton behavior.",
  taskId: "A",
  title: "Implement singleton"
}
const singletonTaskRevision = makeTaskWorkSpecification({
  ...singletonSpecification,
  taskId: TaskId.make(singletonSpecification.taskId)
}).fingerprint
const singletonExpectedOutcomes = [
  { _tag: "DalphObservesTaskTrackerGraph", graph, observationCount: 3, target: "cassette-target" },
  { _tag: "DalphClaimsTask", owner: "cassette-owner", taskId: "A" },
  {
    _tag: "DalphRecordsTaskAttemptPlan",
    attemptId: correlation.attemptId,
    baseSha: singletonBaseSha,
    branch: singletonBranch,
    executor: "executor:controlled-fake",
    runId: correlation.runId,
    taskId: "A",
    taskRevision: singletonTaskRevision,
    worktree: singletonWorktree
  },
  {
    _tag: "GitShowsWorktreeReadyForAttempt",
    attemptId: correlation.attemptId,
    proof: {
      _tag: "PlannedWorktreeReady",
      baseSha: singletonBaseSha,
      branch: singletonBranch,
      headSha: singletonBaseSha,
      worktree: singletonWorktree
    },
    taskId: "A"
  },
  {
    _tag: "DalphRecordsExecutorReportsForAttempt",
    attemptId: correlation.attemptId,
    reports: [
      { _tag: "Running", correlation },
      { _tag: "Terminal", correlation, result: { _tag: "Completed" } }
    ]
  },
  { _tag: "DalphReconstructsValidWorkflowJournalHistory" }
]
const singletonForbiddenOutcomes = [
  { _tag: "DalphMustNotRecordControlCommand" },
  { _tag: "DalphMustNotClaimAnyOtherTask", allowedTaskIds: ["A"] },
  { _tag: "DalphMustNotRecordAnyOtherTaskAttemptPlan", allowedAttemptIds: [correlation.attemptId] },
  { _tag: "DalphMustNotReconcileAnyOtherAttemptWorktree", allowedAttemptIds: [correlation.attemptId] },
  {
    _tag: "DalphMustNotAssumeExecutorWorkResponsibilityForAnyOtherAttempt",
    allowedAttemptIds: [correlation.attemptId]
  },
  { _tag: "DalphMustNotRecordExecutorReportsForAnyOtherAttempt", allowedAttemptIds: [correlation.attemptId] }
]
const singletonCassette = {
  _tag: "AuthoredScenarioCassette",
  actorCommands: [
    {
      _tag: "RunCoordinator",
      baseSha: singletonBaseSha,
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
  expectedOutcomes: singletonExpectedOutcomes,
  forbiddenOutcomes: singletonForbiddenOutcomes,
  lifecycleEvents: [],
  name: "one open task completes its executor work",
  outsideOccurrences: [
    { _tag: "TrackerGraphReadReturned", graph },
    { _tag: "TrackerGraphReadReturned", graph },
    { _tag: "TrackerGraphReadReturned", graph },
    { _tag: "TaskWorkSpecificationReadReturned", ...singletonSpecification },
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
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [singletonSpecification],
    trackerGraph: graph,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  }
}

const recoveryCassette = {
  ...singletonCassette,
  expectedDecisions: [...singletonCassette.expectedDecisions, { _tag: "ReadTrackerGraph", target: "cassette-target" }],
  expectedOutcomes: singletonCassette.expectedOutcomes.map((outcome) =>
    outcome._tag === "DalphObservesTaskTrackerGraph" ? { ...outcome, observationCount: 4 } : outcome
  ),
  lifecycleEvents: [{ _tag: "CoordinatorProcessDies" }],
  name: "one open task survives coordinator death and startup recovery",
  outsideOccurrences: [...singletonCassette.outsideOccurrences, { _tag: "TrackerGraphReadReturned", graph }]
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
const representativeSpecification = {
  body: "Implement the active task in the representative graph.",
  taskId: representativeActiveTaskId,
  title: "Implement representative active task"
}
const representativeTaskRevision = makeTaskWorkSpecification({
  ...representativeSpecification,
  taskId: TaskId.make(representativeSpecification.taskId)
}).fingerprint
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
  expectedOutcomes: singletonCassette.expectedOutcomes.map((outcome) => {
    const attemptId = representativeCorrelation.attemptId
    const resourceSegment = `attempt-${representativeActiveTaskId}-0`
    const branch = `refs/heads/dalph/${resourceSegment}`
    const worktree = `/dalph/cassettes/${resourceSegment}`
    switch (outcome._tag) {
      case "DalphObservesTaskTrackerGraph":
        return { ...outcome, graph: representativeGraph, target: "representative-cassette-target" }
      case "DalphClaimsTask":
        return { ...outcome, taskId: representativeActiveTaskId }
      case "DalphRecordsTaskAttemptPlan":
        return {
          ...outcome,
          attemptId,
          branch,
          runId: representativeCorrelation.runId,
          taskId: representativeActiveTaskId,
          taskRevision: representativeTaskRevision,
          worktree
        }
      case "GitShowsWorktreeReadyForAttempt":
        return {
          ...outcome,
          attemptId,
          proof: { ...outcome.proof, branch, worktree },
          taskId: representativeActiveTaskId
        }
      case "DalphRecordsExecutorReportsForAttempt":
        return {
          ...outcome,
          attemptId,
          reports: [
            { _tag: "Running", correlation: representativeCorrelation },
            { _tag: "Terminal", correlation: representativeCorrelation, result: { _tag: "Completed" } }
          ]
        }
      case "DalphReconstructsValidWorkflowJournalHistory":
        return outcome
    }
  }),
  forbiddenOutcomes: singletonCassette.forbiddenOutcomes.map((outcome) => {
    switch (outcome._tag) {
      case "DalphMustNotRecordControlCommand":
        return outcome
      case "DalphMustNotClaimAnyOtherTask":
        return { ...outcome, allowedTaskIds: [representativeActiveTaskId] }
      case "DalphMustNotRecordAnyOtherTaskAttemptPlan":
      case "DalphMustNotReconcileAnyOtherAttemptWorktree":
      case "DalphMustNotAssumeExecutorWorkResponsibilityForAnyOtherAttempt":
      case "DalphMustNotRecordExecutorReportsForAnyOtherAttempt":
        return { ...outcome, allowedAttemptIds: [representativeCorrelation.attemptId] }
    }
  }),
  name: "one open task in a representative repeatedly refreshed graph",
  outsideOccurrences: [
    { _tag: "TrackerGraphReadReturned", graph: representativeGraph },
    { _tag: "TrackerGraphReadReturned", graph: representativeGraph },
    { _tag: "TrackerGraphReadReturned", graph: representativeGraph },
    { _tag: "TaskWorkSpecificationReadReturned", ...representativeSpecification },
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
    ...singletonCassette.startingFacts,
    taskWorkSpecifications: [representativeSpecification],
    trackerGraph: representativeGraph
  }
}

it.effect("runs an authored cassette through the production loop and matches its declared decisions", () =>
  Effect.gen(function* () {
    const result = yield* runAuthoredScenarioCassette(singletonCassette)

    expect(result.decisions).toEqual(result.cassette.expectedDecisions)
    expect(result.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(result.verifiedExpectedOutcomes).toEqual(result.cassette.expectedOutcomes)
    expect(result.verifiedForbiddenOutcomes).toEqual(result.cassette.forbiddenOutcomes)
    expect(renderAuthoredCassetteLyrics(result.cassette)).toContain(
      "Dalph must not record an operator control command."
    )
    expect(renderAuthoredCassetteLyrics(result.cassette)).toContain(
      "Dalph is expected to decide to acquire the claim for task A."
    )
    expect(result.records.map(({ event }) => event._tag)).toContain("PlannedAttemptExecutorWorkResponsibilityBegan")
    expect(result.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
  })
)

it.effect("runs one authored recovery cassette across coordinator death and startup recovery", () =>
  Effect.gen(function* () {
    const result = yield* runAuthoredScenarioCassette(recoveryCassette)

    expect(result.activationKinds).toEqual(["Fresh", "StartupRecovery"])
    expect(result.completedLifecycleEvents).toEqual(result.cassette.lifecycleEvents)
    expect(result.history._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("does not journal the cassette coordinator-death lifecycle event", () =>
  Effect.gen(function* () {
    const result = yield* runAuthoredScenarioCassette(recoveryCassette)
    const recorded = yield* projectRecordedCassette(result.records)

    expect(result.records.map(({ event }) => event._tag)).not.toContain("CoordinatorProcessDies")
    expect(recorded.entries.map(({ _tag }) => _tag)).not.toContain("CoordinatorProcessDies")
    expect(renderAuthoredCassetteLyrics(result.cassette)).toContain(
      "The coordinator process dies after Dalph records executor-work responsibility."
    )
  })
)

it.effect("continues the same planned attempt only after current claim and worktree checks", () =>
  Effect.gen(function* () {
    const result = yield* runAuthoredScenarioCassette(recoveryCassette)
    const plannedAttempts = result.records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
    )
    const executorResponsibilities = result.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt] : []
    )
    const trackerReadOperationIds = result.records.flatMap(({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" ? [event.operation.operationId] : []
    )

    expect(plannedAttempts).toHaveLength(1)
    expect(executorResponsibilities.map(({ attemptId }) => attemptId)).toEqual([correlation.attemptId])
    expect(result.recoveryAuthorityVerifiedAttemptIds).toEqual([correlation.attemptId, correlation.attemptId])
    expect(trackerReadOperationIds.at(-1)).toBe("cassette:cassette-singleton:startup-recovery:operation:0")
    expect(
      result.records
        .filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
        .map(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId)
    ).toEqual([correlation.attemptId, correlation.attemptId])
  })
)

it.effect("requires Dalph handling rather than provider input to satisfy outcome assertions", () =>
  Effect.gen(function* () {
    const unobservedGraph = {
      revision: "provider-return-never-read",
      tasks: [{ id: "B", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    }
    const failure = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      expectedOutcomes: [
        ...singletonCassette.expectedOutcomes,
        {
          _tag: "DalphObservesTaskTrackerGraph",
          graph: unobservedGraph,
          observationCount: 1,
          target: "cassette-target"
        }
      ],
      outsideOccurrences: [
        ...singletonCassette.outsideOccurrences,
        { _tag: "TrackerGraphReadReturned", graph: unobservedGraph }
      ]
    }).pipe(Effect.flip)

    expect(failure._tag).toBe("AuthoredCassetteOutcomeAssertionMismatch")
    if (failure._tag === "AuthoredCassetteOutcomeAssertionMismatch") {
      expect(failure.unsatisfiedExpectedOutcomes).toEqual([
        {
          _tag: "DalphObservesTaskTrackerGraph",
          graph: unobservedGraph,
          observationCount: 1,
          target: "cassette-target"
        }
      ])
    }
  })
)

it.effect("matches every normalized tracker graph fact in an outcome assertion", () =>
  Effect.gen(function* () {
    const changedGraph = {
      ...graph,
      tasks: graph.tasks.map((task) => ({ ...task, lifecycle: { _tag: "CompletedSuccessfully" } }))
    }
    const failure = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      expectedOutcomes: singletonCassette.expectedOutcomes.map((outcome) =>
        outcome._tag === "DalphObservesTaskTrackerGraph" ? { ...outcome, graph: changedGraph } : outcome
      )
    }).pipe(Effect.flip)

    expect(failure._tag).toBe("AuthoredCassetteOutcomeAssertionMismatch")
    if (failure._tag === "AuthoredCassetteOutcomeAssertionMismatch") {
      expect(failure.unsatisfiedExpectedOutcomes).toMatchObject([
        { _tag: "DalphObservesTaskTrackerGraph", graph: changedGraph }
      ])
    }
  })
)

it.effect("accepts generated identities only through one consistent renaming", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singletonCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      attemptIds: [{ from: "attempt:A:0", to: "renamed-attempt-A" }],
      claimTokens: [{ from: "cassette-claim:A:cassette:cassette-singleton:operation:2", to: "renamed-claim-token-A" }],
      controlCommandIds: [{ from: "rename-command", to: "renamed-command" }],
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
    const command = ControlCommand.cases.RequestRunPause.make({
      commandId: ControlCommandId.make("rename-command"),
      operatorId: AuthenticatedOperatorIdentity.make("rename-operator"),
      runId: recorded.runId
    })
    const renamedWithCommand = yield* renameRecordedCassette(
      RecordedCassette.make({
        ...recorded,
        entries: [{ _tag: "ControlCommandRecorded", command }, ...recorded.entries]
      }),
      renaming
    )
    const renamedCommand = renamedWithCommand.entries[0]
    expect(renamedCommand?._tag).toBe("ControlCommandRecorded")
    if (renamedCommand?._tag === "ControlCommandRecorded") {
      expect(renamedCommand.command.commandId).toBe("renamed-command")
    }
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

it.effect("fails typed authored boundaries and outcome assertion mismatches", () =>
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

    const existingClaim = {
      _tag: "ActiveTaskClaim",
      operationId: "existing-claim-operation",
      owner: "another-owner",
      taskId: "A",
      token: "existing-claim-token"
    }
    const duplicateStartingClaim = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      startingFacts: { ...singletonCassette.startingFacts, taskClaims: [existingClaim, existingClaim] }
    }).pipe(Effect.flip)
    expect(duplicateStartingClaim._tag).toBe("SchemaError")

    const claimConflict = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      startingFacts: { ...singletonCassette.startingFacts, taskClaims: [existingClaim] }
    }).pipe(Effect.flip)
    expect(claimConflict._tag).toBe("TrackerMutation.TaskClaimConflict")

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

    const outcomeMismatch = yield* runAuthoredScenarioCassette({
      ...singletonCassette,
      expectedOutcomes: singletonCassette.expectedOutcomes.map((outcome) =>
        outcome._tag === "DalphRecordsTaskAttemptPlan"
          ? { ...outcome, taskRevision: "different-task-revision" }
          : outcome
      )
    }).pipe(Effect.flip)
    expect(outcomeMismatch._tag).toBe("AuthoredCassetteOutcomeAssertionMismatch")
    if (outcomeMismatch._tag === "AuthoredCassetteOutcomeAssertionMismatch") {
      expect(outcomeMismatch.unsatisfiedExpectedOutcomes).toMatchObject([
        { _tag: "DalphRecordsTaskAttemptPlan", taskRevision: "different-task-revision" }
      ])
    }

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
