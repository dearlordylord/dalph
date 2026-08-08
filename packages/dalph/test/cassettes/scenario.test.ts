import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Option, Schema } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  AttemptWorktreeLost,
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  ClaimOwner,
  ClaimToken,
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent,
  ContradictoryWorktreeState,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskClaim,
  completionClaimReplacementOperationIdFor,
  decodeFreshWorkflowRunIdForDiagnostics,
  deriveIntegrationFrontier,
  deriveRunnableFrontier,
  describeJournalEvent,
  ForeignWorktreeRegistration,
  JournalPosition,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateGitValidationAttemptOrdinal,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeCompleteTaskTrackerFactsObserved,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorktreeObservationOperation,
  OperationId,
  originatingActionForTargetLineageObservation,
  PlannedAttemptExecutorReportOrdinal,
  PlannedWorktreeReady,
  projectWorkflowOccurrences,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  RunPolicyRevision,
  TrackerRevision,
  TaskWorkCapacity,
  TaskClaimReacquisitionRequestId,
  TaskLifecycle,
  TaskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  UntrackedWorktreePath,
  UnclaimedTask,
  WorktreeBaseMismatch,
  type JournalRecord,
  type TaskTrackerFactsObservation,
  type WorkflowJournalEvent,
  type WorkflowOperation,
  WorkflowRunTerminatedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"

import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  acceptedResultRestartsIntoIntegrationAuthoredCassette,
  AuthoredScenarioCassette,
  CassetteIdentityRenaming,
  compareRecordedCassetteCheckpoints,
  compatibleTargetAdvanceContinuesAuthoredCassette,
  dependentTasksCompleteInOneRunAuthoredCassette,
  foldRecordedCassette,
  invertCassetteIdentityRenaming,
  incompatibleTargetRewriteSafelySuspendsAuthoredCassette,
  maintainedIntegrationFinalityProtocolCassetteCatalog,
  IntegrationFinalityProtocolCassette,
  lostPlannedWorktreeSafelySuspendsAuthoredCassette,
  maintainedAuthoredCassetteCatalog,
  measureTrackerObservationEncoding,
  projectRecordedCassette,
  ProtocolStoryItem,
  RecordedCassette,
  recordedCassetteVersion,
  type RecordedCassetteEntry,
  renameRecordedCassette,
  renderAuthoredCassetteLyrics,
  renderRecordedCassetteLyrics,
  runTargetPromotionProtocolCassette,
  runIntegrationFinalityProtocolCassette,
  runIntegrationFinalityProtocolCassetteFromPromotedRecords,
  runPauseRestartsPassivelyAuthoredCassette,
  runPauseSafelySuspendsAuthoredCassette,
  runUnpauseAfterSafeSuspensionAuthoredCassette,
  runUnpauseDuringSuspensionRestartsAuthoredCassette,
  taskPauseCoversGroupingChildAuthoredCassette,
  taskPauseFinishesHeldIntegrationAuthoredCassette,
  taskPauseLetsIndependentTaskContinueAuthoredCassette,
  taskUnpauseAfterSafeSuspensionAuthoredCassette,
  taskUnpauseDuringSuspensionRestartsAuthoredCassette,
  runAuthoredScenarioCassette as runAuthoredScenarioCassetteWithCrypto,
  singletonTaskCompletesAuthoredCassette,
  staleTaskPauseRejectedAuthoredCassette,
  targetPromotionConcurrentTargetsProtocolCassette,
  TargetPromotionProtocolCassette,
  targetPromotionUnreadableProtocolCassette,
  unreadableTaskUnpauseRejectedAuthoredCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

it("renders every maintained authored cassette from its structured story", () => {
  for (const cassette of Object.values(maintainedAuthoredCassetteCatalog)) {
    expect(renderAuthoredCassetteLyrics(cassette)).toContain(`Scenario: ${cassette.name}.`)
  }
})

const exactClaimAuthorities = (...attemptIds: ReadonlyArray<AttemptId>) =>
  new Map(attemptIds.map((attemptId) => [attemptId, { _tag: "Exact" as const }]))

const singleton = singletonTaskCompletesAuthoredCassette
const runAuthoredScenarioCassette = (input: unknown) =>
  runAuthoredScenarioCassetteWithCrypto(input).pipe(Effect.provide(NodeCrypto.layer))

it.effect("rejects a stale task after a fresh read without selecting task work", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(staleTaskPauseRejectedAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)

    expect(tags).toContain("TaskTrackerReadIntentRecorded")
    expect(tags).toContain("TaskTrackerFactsObserved")
    expect(tags).not.toContain("ControlDirectionApplied")
    expect(tags).not.toContain("TaskClaimAcquisitionIntended")
    expect(tags).not.toContain("PlannedAttemptExecutorWorkResponsibilityBegan")
    expect(renderAuthoredCassetteLyrics(staleTaskPauseRejectedAuthoredCassette)).toContain(
      "Dalph rejects Operator Pause for task A: OutsideCurrentTargetClosure."
    )

    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries.some(({ _tag }) => _tag === "ControlDirectionApplied")).toBe(false)
    expect(recorded.entries.some(({ _tag }) => _tag === "TaskTrackerFactsObserved")).toBe(true)
  })
)

it.effect("shows an incomplete control read without recording a direction", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(unreadableTaskUnpauseRejectedAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)

    expect(tags.filter((tag) => tag === "TaskTrackerReadIntentRecorded")).toHaveLength(3)
    expect(tags.filter((tag) => tag === "TaskTrackerFactsObserved")).toHaveLength(2)
    expect(tags).not.toContain("ControlDirectionApplied")
    expect(renderAuthoredCassetteLyrics(unreadableTaskUnpauseRejectedAuthoredCassette)).toContain(
      "Dalph rejects Operator Unpause for task A: IncompleteSnapshot."
    )
  })
)

it.effect("pauses A and its grouping child while recording only A's direction", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseCoversGroupingChildAuthoredCassette)

    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "ControlDirectionApplied" ? [{ direction: event.direction, subject: event.subject }] : []
      )
    ).toEqual([{ direction: "Pause", subject: { _tag: "Task", runId: run.runId, taskId: "A" } }])
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A"])
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "SafelySuspended"
    })
  })
)

it.effect("lets independent B use capacity only after paused A confirms suspension", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseLetsIndependentTaskContinueAuthoredCassette)
    const aSuspendedAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:A:0" &&
        event.report._tag === "SafelySuspended"
    )
    const bResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.attemptId === "attempt:B:1"
    )

    expect(aSuspendedAt).toBeGreaterThan(0)
    expect(bResponsibilityAt).toBeGreaterThan(aSuspendedAt)
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A", "B"])
  })
)

it.effect("finishes an already-held integration boundary after task Pause without later cleanup", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseFinishesHeldIntegrationAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)
    const pauseAt = tags.indexOf("ControlDirectionApplied")
    const intentAt = tags.indexOf("IntegrationCandidateConstructionIntended")
    const constructedAt = tags.indexOf("IntegrationCandidateConstructed")

    expect(pauseAt).toBeGreaterThan(0)
    expect(pauseAt).toBeGreaterThan(intentAt)
    expect(constructedAt).toBeGreaterThan(pauseAt)
    expect(tags.slice(pauseAt + 1)).not.toContain("TaskClaimReleaseIntended")
    if (run.history._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("held-integration pause cassette must retain valid journal history")
    }
    const integrationBeganAt = run.records.find(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan"
    )?.position
    if (integrationBeganAt === undefined) return yield* Effect.die("expected held integration responsibility")
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set([integrationBeganAt]),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).transitions
    ).toContainEqual(
      expect.objectContaining({
        _tag: "ReleaseStartedIntegrationTarget",
        responsibility: expect.objectContaining({ queuedAt: integrationBeganAt })
      })
    )
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).transitions
    ).toEqual([])
  })
)

it.effect("freshly rereads preserved task authorities before resuming after task Unpause", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskUnpauseAfterSafeSuspensionAuthoredCassette)
    const unpauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" &&
        event.direction === "Unpause" &&
        event.subject._tag === "Task" &&
        event.subject.taskId === "A"
    )
    const afterUnpause = run.records.slice(unpauseAt + 1)
    const suspendedAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "SafelySuspended"
    )
    const resumedAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Terminal"
    )

    expect(unpauseAt).toBeGreaterThan(0)
    expect(suspendedAt).toBeGreaterThanOrEqual(0)
    expect(resumedAt).toBeGreaterThan(suspendedAt)
    expect(afterUnpause.slice(suspendedAt + 1, resumedAt).map(({ event }) => event._tag)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "GitReadIntentRecorded",
      "PlannedAttemptWorktreeObserved",
      "GitReadIntentRecorded",
      "TargetLineageObserved"
    ])
  })
)

it.effect("reopens after task Unpause and finishes suspension before executor work", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskUnpauseDuringSuspensionRestartsAuthoredCassette)

    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
      )
    ).toEqual(["Running", "SafelySuspended", "Terminal"])
  })
)

it.effect("stops before the next forward operation after Alice pauses the Run", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseSafelySuspendsAuthoredCassette)
    const pauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
    )
    const afterPause = run.records.slice(pauseAt + 1)

    expect(pauseAt).toBeGreaterThan(0)
    expect(
      run.records.some(
        ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === TaskId.make("B")
      )
    ).toBe(true)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          event.plannedAttempt.taskId === TaskId.make("B")
      )
    ).toBe(false)
    expect(
      afterPause.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
      )
    ).toEqual(["Running", "SafelySuspended"])
    expect(afterPause.some(({ event }) => event._tag === "TaskTrackerFactsObserved")).toBe(false)
    expect(afterPause.some(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toBe(false)
    expect(run.history).toMatchObject({
      _tag: "ValidWorkflowJournalHistory",
      runState: { pause: { run: { _tag: "RunPaused" }, tasks: { _tag: "NoTaskPauses" } } }
    })
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
  })
)

it.effect("restarts a confirmed paused Run without selecting new forward progress", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseRestartsPassivelyAuthoredCassette)
    const pauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
    )
    const afterPause = run.records.slice(pauseAt + 1)

    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(pauseAt).toBeGreaterThan(0)
    expect(afterPause.some(({ event }) => event._tag === "TaskTrackerFactsObserved")).toBe(false)
    expect(
      afterPause.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
      )
    ).toEqual(["Running", "SafelySuspended"])
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
  })
)

it.effect("finishes the exact safe suspension before fresh reads after Unpause", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runUnpauseAfterSafeSuspensionAuthoredCassette)
    const unpauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Unpause" && event.subject._tag === "Run"
    )
    const afterUnpause = run.records.slice(unpauseAt + 1)
    const tags = afterUnpause.map(({ event }) => event._tag)
    const safelySuspendedAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "SafelySuspended"
    )
    const graphAt = tags.indexOf("TaskTrackerFactsObserved")
    const specificationAt = afterUnpause.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
    )
    const claimAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
    )
    const worktreeAt = tags.indexOf("PlannedAttemptWorktreeObserved")
    const targetLineageAt = tags.indexOf("TargetLineageObserved")
    const terminalAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Terminal"
    )

    expect(unpauseAt).toBeGreaterThan(0)
    expect(safelySuspendedAt).toBe(0)
    expect(graphAt).toBeGreaterThan(safelySuspendedAt)
    expect(specificationAt).toBeGreaterThan(graphAt)
    expect(claimAt).toBeGreaterThan(specificationAt)
    expect(worktreeAt).toBeGreaterThan(claimAt)
    expect(targetLineageAt).toBeGreaterThan(worktreeAt)
    expect(terminalAt).toBeGreaterThan(targetLineageAt)
    expect(run.history).toMatchObject({
      _tag: "ValidWorkflowJournalHistory",
      runState: { pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } } }
    })
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
  })
)

it.effect("recovers Unpause during safe suspension without competing executor work", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette)
    const reports = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
    )

    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(reports).toEqual(["Running", "SafelySuspended", "Terminal"])
  })
)

it.effect("applies an authored operator direction through the production control boundary", () =>
  Effect.gen(function* () {
    const firstRunning = singleton.story.findIndex(
      (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running"
    )
    const cassetteWith = (subject: { readonly _tag: "Run" } | { readonly _tag: "Task"; readonly taskId: TaskId }) => ({
      ...singleton,
      name: `the operator applies a ${subject._tag.toLowerCase()} unpause direction`,
      story: singleton.story.flatMap((item, index) => {
        const withExpectedProtocol =
          item._tag === "ExpectedBehavior"
            ? {
                ...item,
                protocol: [
                  { _tag: "TaskClaimAcquired" as const, taskId: TaskId.make("A") },
                  {
                    _tag: "TaskAttemptPlanned" as const,
                    attemptId: AttemptId.make("attempt:A:0"),
                    taskId: TaskId.make("A")
                  },
                  {
                    _tag: "TaskWorktreeReady" as const,
                    attemptId: AttemptId.make("attempt:A:0"),
                    taskId: TaskId.make("A")
                  },
                  { _tag: "ControlDirectionApplied" as const, direction: "Unpause" as const, subject }
                ]
              }
            : item
        return [
          withExpectedProtocol,
          ...(index === firstRunning
            ? [
                { _tag: "OperatorAppliesControlDirection" as const, direction: "Unpause" as const, subject },
                ...(subject._tag === "Task"
                  ? [
                      {
                        _tag: "DalphSelects" as const,
                        operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
                      },
                      { _tag: "TrackerGraphReadReturned" as const, graph: singleton.startingFacts.trackerGraph }
                    ]
                  : [])
              ]
            : [])
        ]
      })
    })
    const run = yield* runAuthoredScenarioCassette(cassetteWith({ _tag: "Run" }))
    expect(run.records).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          _tag: "ControlDirectionApplied",
          direction: "Unpause",
          initiatedBy: { _tag: "Operator" },
          subject: { _tag: "Run", runId: run.runId }
        })
      })
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("Operator applies Unpause to the Run.")

    const taskRun = yield* runAuthoredScenarioCassette(cassetteWith({ _tag: "Task", taskId: TaskId.make("A") }))
    expect(taskRun.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "ControlDirectionApplied",
      direction: "Unpause",
      subject: { _tag: "Task", taskId: "A" }
    })
    expect(renderAuthoredCassetteLyrics(taskRun.cassette)).toContain("Operator applies Unpause to task A.")
  })
)

it.effect("recovers an accepted result in journal order and crosses its integration cutoff once", () =>
  Effect.gen(function* () {
    const lyrics = renderAuthoredCassetteLyrics(acceptedResultRestartsIntoIntegrationAuthoredCassette)
    expect(lyrics).toContain(
      "The story expects task A to produce accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa."
    )
    expect(lyrics).toContain(
      "The story expects Dalph to queue accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa from attempt attempt:A:0."
    )
    expect(lyrics).toContain(
      "The story expects Dalph to start integrating accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa from attempt attempt:A:0."
    )
    const run = yield* runAuthoredScenarioCassette(acceptedResultRestartsIntoIntegrationAuthoredCassette)
    const integrationRecords = run.records.filter(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted"
    )

    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(integrationRecords.map(({ event }) => event._tag)).toEqual([
      "IntegrationResponsibilityBegan",
      "IntegrationStarted"
    ])
    expect(integrationRecords[0]?.position).toBeLessThan(integrationRecords[1]?.position ?? 0)
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "Terminal" &&
          event.report.result._tag === "Accepted"
      )
    ).toHaveLength(1)
    expect(JSON.stringify(run.records)).not.toContain("queueOrdinal")
    if (run.history._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("accepted-result cassette must retain valid journal history")
    }
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).explanations
    ).toContainEqual(
      expect.objectContaining({
        _tag: "IntegrationDependencyWait",
        prerequisiteTaskIds: ["C"],
        wakeCondition: "TaskTrackerFactsObserved"
      })
    )
    const integrationBeganAt = integrationRecords.find(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan"
    )?.position
    if (integrationBeganAt === undefined) return yield* Effect.die("expected integration responsibility")
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set([integrationBeganAt]),
        integrationTarget: Option.some(
          IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/dalph/cassettes/integration.git"),
            ref: IntegrationTargetRef.make("refs/heads/master")
          })
        ),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).transitions
    ).toContainEqual(
      expect.objectContaining({
        _tag: "ReleaseStartedIntegrationTarget",
        responsibility: expect.objectContaining({ queuedAt: integrationBeganAt })
      })
    )
    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "A" }
    ])

    const withoutAcceptedTerminal = run.records.filter(
      ({ event }) =>
        !(
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "Terminal" &&
          event.report.result._tag === "Accepted"
        )
    )
    expect((yield* projectRecordedCassette(withoutAcceptedTerminal).pipe(Effect.flip))._tag).toBe(
      "InvalidWorkflowJournalHistory"
    )

    const recorded = yield* projectRecordedCassette(run.records)
    const withoutIntegrationOrigin = RecordedCassette.make({
      ...recorded,
      entries: recorded.entries.filter(({ _tag }) => _tag !== "IntegrationResponsibilityBegan")
    })
    expect(foldRecordedCassette(withoutIntegrationOrigin)._tag).toBe("InvalidWorkflowJournalHistory")

    const candidateRun = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateConflictRecovery)
    const candidateRecorded = yield* projectRecordedCassette(candidateRun.records)

    for (const omitted of [
      "IntegrationCandidateConstructionIntended",
      "IntegrationCandidateAgentReported",
      "IntegrationCandidateGitObserved"
    ] as const) {
      expect(
        foldRecordedCassette(
          RecordedCassette.make({
            ...candidateRecorded,
            entries: candidateRecorded.entries.filter(({ _tag }) => _tag !== omitted)
          })
        )._tag
      ).toBe("InvalidWorkflowJournalHistory")
    }

    const foreignRunId = RunId.make("foreign-candidate-run")
    for (const mismatchTag of [
      "IntegrationCandidateConstructionIntended",
      "IntegrationCandidateAgentReported",
      "IntegrationCandidateGitObserved"
    ] as const) {
      const mismatched = RecordedCassette.make({
        ...candidateRecorded,
        entries: candidateRecorded.entries.map((entry) => {
          if (entry._tag !== mismatchTag) return entry
          if (entry._tag === "IntegrationCandidateConstructionIntended") {
            return {
              ...entry,
              correlation: { ...entry.correlation, runId: foreignRunId },
              plannedAttempt: { ...entry.plannedAttempt, runId: foreignRunId }
            }
          }
          if (entry._tag === "IntegrationCandidateAgentReported") {
            return { ...entry, expectedCorrelation: { ...entry.expectedCorrelation, runId: foreignRunId } }
          }
          return { ...entry, correlation: { ...entry.correlation, runId: foreignRunId } }
        })
      })
      expect(foldRecordedCassette(mismatched)._tag).toBe("InvalidWorkflowJournalHistory")
    }
    const mismatchedIntentCorrelation = RecordedCassette.make({
      ...candidateRecorded,
      entries: candidateRecorded.entries.map((entry) =>
        entry._tag === "IntegrationCandidateConstructionIntended"
          ? { ...entry, correlation: { ...entry.correlation, attemptId: AttemptId.make("foreign-candidate-attempt") } }
          : entry
      )
    })
    expect(foldRecordedCassette(mismatchedIntentCorrelation)._tag).toBe("InvalidWorkflowJournalHistory")
  })
)

it.effect("rejects every mismatched candidate report expectation during reconstruction", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateConflictRecovery)
    const recorded = yield* projectRecordedCassette(run.records)
    const intent = recorded.entries.find(({ _tag }) => _tag === "IntegrationCandidateConstructionIntended")
    if (intent?._tag !== "IntegrationCandidateConstructionIntended") {
      return yield* Effect.die("candidate cassette must contain its construction intent")
    }
    const mismatches = [
      { ...intent.correlation, acceptedResultCommit: GitCommitSha.make("d".repeat(40)) },
      { ...intent.correlation, attemptId: AttemptId.make("foreign-candidate-attempt") },
      { ...intent.correlation, candidateId: IntegrationCandidateId.make("foreign-candidate") },
      {
        ...intent.correlation,
        candidateResource: IntegrationCandidateResourceLocator.make("foreign-candidate-resource")
      },
      { ...intent.correlation, expectedTargetHead: GitCommitSha.make("e".repeat(40)) },
      { ...intent.correlation, integrationSessionId: IntegrationSessionId.make("foreign-session") },
      {
        ...intent.correlation,
        integrationTarget: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/foreign-repository/.git"),
          ref: IntegrationTargetRef.make("refs/heads/foreign")
        })
      },
      { ...intent.correlation, runId: RunId.make("foreign-candidate-run") }
    ]
    const reportAt = recorded.entries.findIndex(({ _tag }) => _tag === "IntegrationCandidateAgentReported")
    const reportPrefix = recorded.entries.slice(0, reportAt + 1)

    for (const expectedCorrelation of mismatches) {
      expect(
        foldRecordedCassette(
          RecordedCassette.make({
            ...recorded,
            entries: reportPrefix.map((entry) =>
              entry._tag === "IntegrationCandidateAgentReported" ? { ...entry, expectedCorrelation } : entry
            )
          })
        )._tag
      ).toBe("InvalidWorkflowJournalHistory")
    }
  })
)

it.effect("round-trips pending Git failure and correction-limit candidate evidence", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateConflictRecovery)
    const recorded = yield* projectRecordedCassette(run.records)
    const normalizedRecorded = RecordedCassette.make({
      ...recorded,
      entries: recorded.entries
        .filter((entry) => entry._tag !== "IntegrationCandidateAgentReported" || entry.report._tag !== "Conflict")
        .map((entry) =>
          entry._tag === "IntegrationCandidateAgentReported"
            ? { ...entry, ordinal: IntegrationCandidateAgentReportOrdinal.make(1) }
            : entry
        )
    })
    const intent = normalizedRecorded.entries.find(({ _tag }) => _tag === "IntegrationCandidateConstructionIntended")
    const report = normalizedRecorded.entries.find(
      (entry) => entry._tag === "IntegrationCandidateAgentReported" && entry.report._tag === "Submitted"
    )
    const observed = normalizedRecorded.entries.find(({ _tag }) => _tag === "IntegrationCandidateGitObserved")
    if (
      intent?._tag !== "IntegrationCandidateConstructionIntended" ||
      report?._tag !== "IntegrationCandidateAgentReported" ||
      report.report._tag !== "Submitted" ||
      observed?._tag !== "IntegrationCandidateGitObserved"
    )
      return yield* Effect.die("accepted-result fixture must construct one candidate")

    const withoutCandidateOutcome = normalizedRecorded.entries.filter(
      ({ _tag }) => _tag !== "IntegrationCandidateGitObserved" && _tag !== "IntegrationCandidateConstructed"
    )
    const pending = RecordedCassette.make({
      ...normalizedRecorded,
      entries: [
        ...withoutCandidateOutcome,
        {
          _tag: "IntegrationCandidateGitValidationFailed",
          attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal.make(1),
          candidateCommit: report.report.candidateCommit,
          correlation: intent.correlation,
          detail: "repository temporarily unreadable",
          occurrenceClassification: "NonActionOccurrence"
        }
      ]
    })
    expect(foldRecordedCassette(pending)._tag).toBe("ValidWorkflowJournalHistory")
    expect(renderRecordedCassetteLyrics(pending)).toContain("Git could not validate submitted commit")

    const correctedCommit = GitCommitSha.make("c".repeat(40))
    const limited = RecordedCassette.make({
      ...normalizedRecorded,
      entries: [
        ...withoutCandidateOutcome,
        { ...observed, observation: { _tag: "Missing" } },
        {
          _tag: "IntegrationCandidateAgentReported",
          expectedCorrelation: intent.correlation,
          occurrenceClassification: "NonActionOccurrence",
          ordinal: IntegrationCandidateAgentReportOrdinal.make(2),
          report: { _tag: "Submitted", candidateCommit: correctedCommit, correlation: intent.correlation }
        },
        { ...observed, candidateCommit: correctedCommit, observation: { _tag: "Commit", directParents: [] } },
        {
          _tag: "IntegrationCandidateCorrectionLimitReached",
          correctionCount: 1,
          correctionLimit: CandidateCorrectionLimit.make(1),
          correlation: intent.correlation,
          occurrenceClassification: "NonActionOccurrence"
        }
      ]
    })
    const limitedHistory = foldRecordedCassette(limited)
    expect(limitedHistory._tag).toBe("ValidWorkflowJournalHistory")
    expect(renderRecordedCassetteLyrics(limited)).toContain("stopped after 1 correction attempts")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...limited,
          entries: limited.entries.filter(({ _tag }) => _tag !== "IntegrationCandidateGitObserved")
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...limited,
          entries: limited.entries.flatMap(
            (entry): ReadonlyArray<RecordedCassetteEntry> =>
              entry._tag === "IntegrationCandidateConstructionIntended"
                ? [
                    entry,
                    {
                      ...entry,
                      correlation: {
                        ...entry.correlation,
                        candidateId: IntegrationCandidateId.make("second-candidate"),
                        candidateResource: IntegrationCandidateResourceLocator.make("second-candidate-resource"),
                        integrationSessionId: IntegrationSessionId.make("second-session")
                      }
                    }
                  ]
                : [entry]
          )
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...limited,
          entries: limited.entries.map((entry) =>
            entry._tag === "IntegrationCandidateConstructionIntended"
              ? { ...entry, correctionLimit: CandidateCorrectionLimit.make(2) }
              : entry
          )
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...limited,
          entries: limited.entries.map((entry) =>
            entry._tag === "IntegrationCandidateCorrectionLimitReached"
              ? { ...entry, correctionLimit: CandidateCorrectionLimit.make(2) }
              : entry
          )
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...limited,
          entries: limited.entries.map((entry) =>
            entry._tag === "IntegrationCandidateGitObserved" && entry.candidateCommit === correctedCommit
              ? {
                  ...entry,
                  observation: {
                    _tag: "Commit" as const,
                    directParents: [intent.correlation.expectedTargetHead, intent.correlation.acceptedResultCommit]
                  }
                }
              : entry
          )
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")

    const candidateIntentOnly = normalizedRecorded.entries.filter(
      (entry) =>
        !entry._tag.startsWith("IntegrationCandidate") || entry._tag === "IntegrationCandidateConstructionIntended"
    )
    const continuationLimited = RecordedCassette.make({
      ...normalizedRecorded,
      entries: [
        ...candidateIntentOnly,
        {
          _tag: "IntegrationCandidateAgentReported",
          expectedCorrelation: intent.correlation,
          occurrenceClassification: "NonActionOccurrence",
          ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
          report: { _tag: "Working", correlation: intent.correlation }
        },
        {
          _tag: "IntegrationCandidateAgentReported",
          expectedCorrelation: intent.correlation,
          occurrenceClassification: "NonActionOccurrence",
          ordinal: IntegrationCandidateAgentReportOrdinal.make(2),
          report: { _tag: "Conflict", correlation: intent.correlation }
        },
        {
          _tag: "IntegrationCandidateContinuationLimitReached",
          continuationCount: 2,
          continuationLimit: CandidateContinuationLimit.make(2),
          correlation: intent.correlation,
          occurrenceClassification: "NonActionOccurrence"
        }
      ]
    })
    const continuationHistory = foldRecordedCassette(continuationLimited)
    expect(continuationHistory._tag).toBe("ValidWorkflowJournalHistory")
    expect(renderRecordedCassetteLyrics(continuationLimited)).toContain("2 automatic agent continuations")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...continuationLimited,
          entries: continuationLimited.entries.map((entry) =>
            entry._tag === "IntegrationCandidateContinuationLimitReached" ? { ...entry, continuationCount: 1 } : entry
          )
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")
    expect(
      foldRecordedCassette(
        RecordedCassette.make({
          ...continuationLimited,
          entries: continuationLimited.entries.map((entry) =>
            entry._tag === "IntegrationCandidateConstructionIntended"
              ? { ...entry, continuationLimit: CandidateContinuationLimit.make(3) }
              : entry
          )
        })
      )._tag
    ).toBe("InvalidWorkflowJournalHistory")

    const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      attemptIds: [],
      claimTokens: [],
      integrationCandidateIds: [{ from: intent.correlation.candidateId, to: "renamed-candidate" }],
      integrationCandidateResourceLocators: [
        { from: intent.correlation.candidateResource, to: "renamed-candidate-resource" }
      ],
      integrationSessionIds: [{ from: intent.correlation.integrationSessionId, to: "renamed-session" }],
      operationIds: [],
      runIds: [],
      taskBranchRefs: [],
      worktreeLocators: []
    })
    const renamed = yield* renameRecordedCassette(limited, renaming)
    expect(foldRecordedCassette(yield* renameRecordedCassette(normalizedRecorded, renaming))._tag).toBe(
      "ValidWorkflowJournalHistory"
    )
    expect(foldRecordedCassette(yield* renameRecordedCassette(pending, renaming))._tag).toBe(
      "ValidWorkflowJournalHistory"
    )
    if (limitedHistory._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die("fixture must remain valid")
    const checkpoints = yield* verifyRecordedCassetteRoundTripWithRenaming(
      limitedHistory.records,
      renamed,
      invertCassetteIdentityRenaming(renaming)
    )
    expect(checkpoints.every(({ workflowHistoryEquivalent }) => workflowHistoryEquivalent)).toBe(true)
    if (continuationHistory._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("continuation fixture must remain valid")
    }
    const renamedContinuation = yield* renameRecordedCassette(continuationLimited, renaming)
    const continuationCheckpoints = yield* verifyRecordedCassetteRoundTripWithRenaming(
      continuationHistory.records,
      renamedContinuation,
      invertCassetteIdentityRenaming(renaming)
    )
    expect(continuationCheckpoints.every(({ workflowHistoryEquivalent }) => workflowHistoryEquivalent)).toBe(true)
  })
)

it.effect("runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories", () =>
  Effect.gen(function* () {
    const conflict = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateConflictRecovery)
    const conflictRecorded = yield* projectRecordedCassette(conflict.records)
    expect(
      conflictRecorded.entries
        .filter(({ _tag }) => _tag === "IntegrationCandidateAgentReported")
        .map((entry) => (entry._tag === "IntegrationCandidateAgentReported" ? entry.report._tag : "unreachable"))
    ).toEqual(["Conflict", "Submitted"])
    expect(conflictRecorded.entries.some(({ _tag }) => _tag === "IntegrationCandidateConstructed")).toBe(true)

    const corrected = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.candidateCorrectionAfterUnreadableGit
    )
    const correctedRecorded = yield* projectRecordedCassette(corrected.records)
    expect(correctedRecorded.entries.filter(({ _tag }) => _tag === "IntegrationCandidateAgentReported")).toHaveLength(2)
    expect(
      correctedRecorded.entries.filter(({ _tag }) => _tag === "IntegrationCandidateGitValidationFailed")
    ).toHaveLength(1)
    expect(correctedRecorded.entries.find(({ _tag }) => _tag === "IntegrationCandidateConstructed")).toMatchObject({
      candidateCommit: "cccccccccccccccccccccccccccccccccccccccc"
    })
    expect(renderRecordedCassetteLyrics(correctedRecorded)).toContain("Git could not validate submitted commit")

    const exhausted = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.candidateCorrectionExhaustion
    )
    const exhaustedRecorded = yield* projectRecordedCassette(exhausted.records)
    expect(exhaustedRecorded.entries.some(({ _tag }) => _tag === "IntegrationCandidateCorrectionLimitReached")).toBe(
      true
    )
    expect(exhaustedRecorded.entries.some(({ _tag }) => _tag === "IntegrationCandidateConstructed")).toBe(false)
    expect(renderRecordedCassetteLyrics(exhaustedRecorded)).toContain("stopped after 1 correction attempts")

    const contradiction = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.candidateCorrelationContradiction
    )
    const contradictionRecorded = yield* projectRecordedCassette(contradiction.records)
    const contradictoryReport = contradictionRecorded.entries.find(
      ({ _tag }) => _tag === "IntegrationCandidateAgentReported"
    )
    expect(contradictoryReport).toMatchObject({ report: { _tag: "Working" } })
    expect(contradictionRecorded.entries.some(({ _tag }) => _tag === "IntegrationCandidateGitObserved")).toBe(false)
    expect(renderRecordedCassetteLyrics(contradictionRecorded)).toContain("infrastructure correlation contradiction")
  })
)

it.effect("runs only the selected public wrapper and seals passing evidence for exact M", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationPassed)
    const tags = run.records.map(({ event }) => event._tag)
    expect(tags).toContain("TargetVerificationIntended")
    expect(tags).toContain("TargetVerificationEvidenceSealed")
    expect(run.records.some(({ event }) => event._tag === "TargetVerificationCorrelationContradicted")).toBe(false)
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "TargetVerificationPassed",
      candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
      planId: "public-checks-v1",
      taskId: "A"
    })
    const authoredLyrics = renderAuthoredCassetteLyrics(run.cassette)
    expect(authoredLyrics).toContain("integration agent reports")
    expect(authoredLyrics).toContain("Git cannot validate")
    expect(authoredLyrics).toContain("Git returns Commit")
    expect(authoredLyrics).toContain("public verification wrapper returns Passed")
    expect(authoredLyrics).toContain("candidate cccccccccccccccccccccccccccccccccccccccc")
    expect(authoredLyrics).toContain("public verification plan public-checks-v1 to pass")
    const recorded = yield* projectRecordedCassette(run.records)
    expect(renderRecordedCassetteLyrics(recorded)).toContain("returned Passed for candidate")
  })
)

it.effect("promotes verified M by exact compare-and-set and records exact ancestry", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const attempts = run.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    const success = run.records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")

    expect(attempts).toHaveLength(1)
    expect(success?.event).toMatchObject({
      _tag: "TargetPromotionObservedSuccess",
      basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
      correlation: {
        candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
        expectedTargetHead: "1111111111111111111111111111111111111111"
      },
      observation: {
        _tag: "CompareAndSetApplied",
        candidateAncestry: "Current",
        targetHeadSha: "cccccccccccccccccccccccccccccccccccccccc"
      }
    })
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionStale")).toBe(false)
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual(
      expect.objectContaining({
        _tag: "TargetPromotionSucceeded",
        basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
        taskId: "A"
      })
    )

    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries.map(({ _tag }) => _tag)).toContain("TargetPromotionObservedSuccess")
    expect(renderRecordedCassetteLyrics(recorded)).toContain("established candidate")
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        ({ workflowHistoryEquivalent }) => workflowHistoryEquivalent
      )
    ).toBe(true)
    const promotionIntent = recorded.entries.find(({ _tag }) => _tag === "TargetPromotionIntended")
    if (promotionIntent?._tag !== "TargetPromotionIntended") {
      return yield* Effect.die("promotion cassette must contain its exact intent")
    }
    const renamed = yield* renameRecordedCassette(
      recorded,
      CassetteIdentityRenaming.make({
        attemptIds: [],
        claimTokens: [],
        integrationCandidateIds: [
          {
            from: promotionIntent.correlation.candidateCorrelation.candidateId,
            to: IntegrationCandidateId.make("renamed-promotion-candidate")
          }
        ],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [],
        worktreeLocators: []
      })
    )
    expect(foldRecordedCassette(renamed)._tag).toBe("ValidWorkflowJournalHistory")
    expect(renamed.entries.find(({ _tag }) => _tag === "TargetPromotionObservedSuccess")).toMatchObject({
      correlation: { candidateCorrelation: { candidateId: "renamed-promotion-candidate" } }
    })
  })
)

it.effect("records completion finality after valid candidate verification and promotion history", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const finalized = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFreshTrackerSuccess,
      promoted.records
    )
    expect(finalized.records.map(({ event }) => event._tag)).toContain("IntegrationFinalitySettled")
    const recorded = yield* projectRecordedCassette(finalized.records)
    expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
    expect(
      verifyRecordedCassetteRoundTrip(finalized.records, recorded).every(
        ({ workflowHistoryEquivalent }) => workflowHistoryEquivalent
      )
    ).toBe(true)
    expect(renderRecordedCassetteLyrics(recorded)).toContain("completion claim")
    const renamed = yield* renameRecordedCassette(
      recorded,
      CassetteIdentityRenaming.make({
        attemptIds: [],
        claimTokens: [],
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [],
        worktreeLocators: []
      })
    )
    expect(foldRecordedCassette(renamed)._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("preserves promoted M across a post-promotion blocker and resumes its same finality proof after clear", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const promotion = promoted.records.findLast(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.event
    const graph = promoted.records.findLast(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
    )?.event
    if (
      promotion?._tag !== "TargetPromotionObservedSuccess" ||
      graph?._tag !== "TaskTrackerFactsObserved" ||
      graph.observation._tag !== "CompleteTaskTrackerFacts"
    ) {
      return yield* Effect.die("promotion blocker cassette requires exact promotion and tracker history")
    }
    const plannedAttempt = promoted.records.findLast(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        event.operation.plannedAttempt.attemptId === promotion.correlation.candidateCorrelation.attemptId
    )?.event
    if (plannedAttempt?._tag !== "TaskAttemptPlanned") return yield* Effect.die("missing promoted attempt")
    const activeClaim = promoted.records.findLast(
      ({ event }) =>
        event._tag === "TaskClaimAcquired" && event.claim.taskId === plannedAttempt.operation.plannedAttempt.taskId
    )?.event
    if (activeClaim?._tag !== "TaskClaimAcquired") return yield* Effect.die("missing promoted task claim")
    const taskId = plannedAttempt.operation.plannedAttempt.taskId
    const blockerId = TaskId.make("post-promotion-blocker")
    const unrelatedTaskId = TaskId.make("post-promotion-unrelated-B")
    const appendGraph = (
      records: ReadonlyArray<JournalRecord>,
      revision: string,
      blockerLifecycle: "Open" | "CompletedSuccessfully"
    ) => {
      const operation = makeTrackerGraphObservationOperation(
        OperationId.make(`post-promotion-blocker:${revision}`),
        graph.observation.target,
        [],
        [taskId, blockerId, unrelatedTaskId]
      )
      const projected = projectTrackerSnapshot({
        revision: TrackerRevision.make(revision),
        tasks: [
          {
            id: taskId,
            lifecycle: TaskLifecycle.cases.Open.make({}),
            parentTaskId: null,
            prerequisiteIds: [blockerId]
          },
          {
            id: blockerId,
            lifecycle:
              blockerLifecycle === "Open"
                ? TaskLifecycle.cases.Open.make({})
                : TaskLifecycle.cases.CompletedSuccessfully.make({}),
            parentTaskId: null,
            prerequisiteIds: []
          },
          { id: unrelatedTaskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      if (projected._tag !== "Valid") throw new Error("post-promotion blocker graph must be valid")
      const intent = taskTrackerReadIntent(operation)
      const outcome = TaskTrackerFactsObservedEvent.make({
        observation: makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot),
        operationId: operation.operationId,
        version: workflowJournalEventVersion
      })
      return [intent, outcome].reduce<ReadonlyArray<JournalRecord>>(
        (current, event) => [
          ...current,
          {
            event,
            key: describeJournalEvent(event).expectedKey,
            position: JournalPosition.make(current.length + 1),
            runId: plannedAttempt.operation.plannedAttempt.runId
          }
        ],
        records
      )
    }
    const blockedRecords = appendGraph(promoted.records, "post-promotion-blocked", "Open")
    const blockedHistory = reduceWorkflowJournalHistory(plannedAttempt.operation.plannedAttempt.runId, blockedRecords)
    if (blockedHistory._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(blockedHistory)
    const facts = {
      activeClaimByAttemptId: new Map([[plannedAttempt.operation.plannedAttempt.attemptId, activeClaim.claim]]),
      currentTrackerTaskIds: new Set([taskId, blockerId, unrelatedTaskId]),
      heldResponsibilityPositions: new Set<JournalPosition>(),
      integrationFinalityConfigured: true,
      integrationTarget: Option.none(),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(plannedAttempt.operation.plannedAttempt.attemptId)
    }
    expect(deriveIntegrationFrontier(blockedHistory.runState, facts).transitions).toEqual([])
    expect(
      deriveRunnableFrontier({
        freshEligibleTasks: [
          { taskId: unrelatedTaskId, taskRevision: TaskRevision.make("post-promotion-unrelated-revision") }
        ],
        responsibility: { entries: [] },
        responsibilityFacts: []
      }).transitions
    ).toContainEqual(expect.objectContaining({ _tag: "CommitFreshTaskClaimIntent", taskId: unrelatedTaskId }))

    const clearRecords = appendGraph(blockedRecords, "post-promotion-clear", "CompletedSuccessfully")
    const clearHistory = reduceWorkflowJournalHistory(plannedAttempt.operation.plannedAttempt.runId, clearRecords)
    if (clearHistory._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(clearHistory)
    expect(deriveIntegrationFrontier(clearHistory.runState, facts).transitions).toContainEqual(
      expect.objectContaining({
        _tag: "ReplacePromotedTaskClaim",
        request: expect.objectContaining({
          claim: expect.objectContaining({ promotionCorrelation: promotion.correlation })
        })
      })
    )
    expect(clearRecords.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(clearRecords.filter(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")).toHaveLength(
      1
    )

    const claim = CompletionTaskClaim.make({
      originalClaim: activeClaim.claim,
      plannedAttempt: plannedAttempt.operation.plannedAttempt,
      promotionCorrelation: promotion.correlation
    })
    const replacementOperationId = completionClaimReplacementOperationIdFor(claim)
    const withReplacement = [
      CompletionClaimReplacementIntendedEvent.make({
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      CompletionClaimReplacedEvent.make({
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      })
    ].reduce<ReadonlyArray<JournalRecord>>(
      (records, event) => [
        ...records,
        {
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: plannedAttempt.operation.plannedAttempt.runId
        }
      ],
      clearRecords
    )
    const blockedWithCompletionClaim = appendGraph(
      withReplacement,
      "post-promotion-blocked-with-completion-claim",
      "Open"
    )
    const completionClaimBlockedHistory = reduceWorkflowJournalHistory(
      plannedAttempt.operation.plannedAttempt.runId,
      blockedWithCompletionClaim
    )
    if (completionClaimBlockedHistory._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die(completionClaimBlockedHistory)
    }
    expect(deriveIntegrationFrontier(completionClaimBlockedHistory.runState, facts).transitions).toEqual([])
    expect(
      completionClaimBlockedHistory.records.filter(({ event }) => event._tag === "CompletionClaimReplaced")
    ).toHaveLength(1)
  })
)

it.effect("reconciles a lost promotion response and never sends a fourth request", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionAmbiguityExhaustion)
    const attempts = run.records.flatMap(({ event }) =>
      event._tag === "TargetPromotionAttemptIntended" ? [event.attemptOrdinal] : []
    )
    const terminal = run.records.find(({ event }) => event._tag === "TargetPromotionNonConvergence")

    expect(attempts).toEqual([1, 2, 3])
    expect(terminal?.event).toMatchObject({
      _tag: "TargetPromotionNonConvergence",
      attemptLimit: 3,
      attemptOrdinal: 3,
      correlation: { candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" },
      lastObservation: {
        _tag: "ExpectedHeadStillObserved",
        observedHeadSha: "1111111111111111111111111111111111111111"
      }
    })
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionStale")).toBe(false)
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual(
      expect.objectContaining({ _tag: "TargetPromotionNonConvergent", attemptOrdinal: 3, taskId: "A" })
    )

    const recorded = yield* projectRecordedCassette(run.records)
    expect(renderRecordedCassetteLyrics(recorded)).toContain("after 3 ambiguous compare-and-set attempts")
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        ({ workflowHistoryEquivalent }) => workflowHistoryEquivalent
      )
    ).toBe(true)
  })
)

it.effect("records stale H2 and never overwrites it", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.targetPromotionStaleBeforeCompareAndSet
    )
    expect(run.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(0)
    expect(run.records.find(({ event }) => event._tag === "TargetPromotionStale")?.event).toMatchObject({
      _tag: "TargetPromotionStale",
      basis: { _tag: "BeforeFirstAttempt" },
      correlation: {
        candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
        expectedTargetHead: "1111111111111111111111111111111111111111"
      },
      observation: {
        _tag: "ReconciledCandidateNotInAncestry",
        observedHeadSha: "2222222222222222222222222222222222222222"
      }
    })
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual(
      expect.objectContaining({
        _tag: "TargetPromotionStale",
        basis: { _tag: "BeforeFirstAttempt" },
        observedTargetHead: "2222222222222222222222222222222222222222"
      })
    )
    const recorded = yield* projectRecordedCassette(run.records)
    expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
    expect(renderRecordedCassetteLyrics(recorded)).toContain("preserved a different target head")
  })
)

it.effect("discovers M in current target ancestry after losing the promotion response", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.targetPromotionLostResponseDiscoversCurrentCandidate
    )
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "TargetPromotionAttemptIntended" ? [event.attemptOrdinal] : []
      )
    ).toEqual([1])
    expect(run.records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.event).toMatchObject({
      _tag: "TargetPromotionObservedSuccess",
      basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
      observation: {
        _tag: "ReconciledCandidateCurrent",
        candidateAncestry: "Current",
        targetHeadSha: "cccccccccccccccccccccccccccccccccccccccc"
      }
    })
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionStale")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionNonConvergence")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        ({ workflowHistoryEquivalent }) => workflowHistoryEquivalent
      )
    ).toBe(true)
  })
)

it.effect("keeps another target usable while M promotion waits and releases only M when it settles", () =>
  Effect.gen(function* () {
    const run = yield* runTargetPromotionProtocolCassette(targetPromotionConcurrentTargetsProtocolCassette)
    const replay = yield* runTargetPromotionProtocolCassette(targetPromotionConcurrentTargetsProtocolCassette)
    const tags = run.records.map(({ event }) => event._tag)

    expect(run).toEqual(replay)
    expect(run.boundaryCalls).toEqual(["T1.read", "T1.compareAndSet", "T2.read", "T2.compareAndSet"])
    expect(run.compareAndSetCount).toBe(2)
    expect(tags.filter((tag) => tag === "TargetPromotionIntended")).toHaveLength(2)
    expect(tags.filter((tag) => tag === "TargetPromotionAttemptIntended")).toHaveLength(2)
    expect(tags.filter((tag) => tag === "TargetPromotionObservedSuccess")).toHaveLength(2)
    expect(run.leaseObservations).toEqual([
      { active: [8], held: [8], moment: "T1WaitingBeforeT2" },
      { active: [8], held: [8, 28], moment: "T2AcquiredWhileT1Waiting" },
      { active: [8], held: [8], moment: "T2Settled" },
      { active: [], held: [], moment: "AllSettled" }
    ])
  })
)

it.effect("waits without another request when Git cannot be read", () =>
  Effect.gen(function* () {
    const run = yield* runTargetPromotionProtocolCassette(targetPromotionUnreadableProtocolCassette)
    const replay = yield* runTargetPromotionProtocolCassette(targetPromotionUnreadableProtocolCassette)

    expect(run).toEqual(replay)
    expect(run.boundaryCalls).toEqual(["T1.read"])
    expect(run.compareAndSetCount).toBe(0)
    expect(run.failureTag).toBe("TargetPromotionGitReadFailure")
    expect(run.records.map(({ event }) => event._tag)).toEqual(["TargetPromotionIntended"])
    expect(run.leaseObservations).toEqual([{ active: [], held: [], moment: "AllSettled" }])
  })
)

it("rejects protocol cassettes with duplicate, missing, or unsettled participants", () => {
  const participant = targetPromotionUnreadableProtocolCassette.participants[0]
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      name: "empty promotion protocol cassette",
      participants: [],
      story: []
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionUnreadableProtocolCassette,
      participants: [participant, participant]
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionConcurrentTargetsProtocolCassette,
      participants: [targetPromotionConcurrentTargetsProtocolCassette.participants[0]]
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionUnreadableProtocolCassette,
      story: targetPromotionUnreadableProtocolCassette.story.filter((item) => item._tag !== "StartPromotion")
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionConcurrentTargetsProtocolCassette,
      story: targetPromotionConcurrentTargetsProtocolCassette.story.filter(
        (item) => item._tag !== "ReleaseBlockedBoundary"
      )
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionUnreadableProtocolCassette,
      story: [
        ...targetPromotionUnreadableProtocolCassette.story,
        ProtocolStoryItem.cases.AwaitBlockedBoundary.make({ owner: "T1" })
      ]
    })
  ).toBe(false)
})

it.effect("preserves exact M and stops before promotion when selected checks fail", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationFailure)
    const sealed = run.records.find(({ event }) => event._tag === "TargetVerificationEvidenceSealed")
    if (sealed?.event._tag !== "TargetVerificationEvidenceSealed") {
      return yield* Effect.die("failed verification cassette must seal its diagnostic manifest")
    }
    expect(sealed.event.terminal).toBe("Failed")
    expect(run.records.some(({ event }) => event._tag === "TargetVerificationCorrelationContradicted")).toBe(false)
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "TargetVerificationStopped",
      candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
      outcome: "Failed",
      planId: "public-checks-v1",
      taskId: "A"
    })
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("public verification plan public-checks-v1 to stop")
    expect(run.records.some(({ event }) => event._tag.includes("Promot"))).toBe(false)
  })
)

it.effect("seals every non-passing public-wrapper terminal without promoting M", () =>
  Effect.forEach(["Killed", "Partial", "TimedOut"] as const, (outcome) =>
    Effect.gen(function* () {
      const source = maintainedAuthoredCassetteCatalog.candidateVerificationFailure
      const input = {
        ...source,
        name: `selected public verification returns ${outcome}`,
        story: source.story.map((item) => {
          if (item._tag === "TargetVerificationReturned") {
            return { _tag: "TargetVerificationReturned", result: { _tag: outcome, artifacts: [] } }
          }
          if (item._tag !== "ExpectedBehavior" || item.orchestration === null) return item
          return {
            ...item,
            orchestration: item.orchestration.map((evidence) =>
              evidence._tag === "TargetVerificationStopped" ? { ...evidence, outcome } : evidence
            )
          }
        })
      }
      const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(input)
      const run = yield* runAuthoredScenarioCassette(cassette)
      const sealed = run.records.find(({ event }) => event._tag === "TargetVerificationEvidenceSealed")
      expect(sealed?.event).toEqual(expect.objectContaining({ terminal: outcome }))
      expect(run.records.some(({ event }) => event._tag.includes("Promot"))).toBe(false)
    })
  ).pipe(Effect.asVoid)
)

it.effect("records and alpha-renames verification terminal and contradiction occurrences", () =>
  Effect.gen(function* () {
    const passed = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationPassed)
    const recorded = yield* projectRecordedCassette(passed.records)
    expect(recorded.entries.map(({ _tag }) => _tag)).toContain("TargetVerificationIntended")
    expect(recorded.entries.map(({ _tag }) => _tag)).toContain("TargetVerificationEvidenceSealed")
    const intent = recorded.entries.find(({ _tag }) => _tag === "TargetVerificationIntended")
    if (intent?._tag !== "TargetVerificationIntended") return yield* Effect.die("verification intent is required")
    const renamed = yield* renameRecordedCassette(
      recorded,
      yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [],
        claimTokens: [],
        integrationCandidateIds: [
          { from: intent.correlation.candidateCorrelation.candidateId, to: "renamed-candidate" }
        ],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [],
        worktreeLocators: []
      })
    )
    expect(foldRecordedCassette(renamed)._tag).toBe("ValidWorkflowJournalHistory")
    expect(
      verifyRecordedCassetteRoundTrip(passed.records, recorded).every(
        ({ workflowHistoryEquivalent }) => workflowHistoryEquivalent
      )
    ).toBe(true)

    const contradiction = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.candidateVerificationContradiction
    )
    const contradictoryRecorded = yield* projectRecordedCassette(contradiction.records)
    expect(contradictoryRecorded.entries.some(({ _tag }) => _tag === "TargetVerificationCorrelationContradicted")).toBe(
      true
    )
    expect(renderRecordedCassetteLyrics(contradictoryRecorded)).toContain("foreign correlation")
  })
)

it.effect("round-trips every non-submitting integration-agent report", () =>
  Effect.gen(function* () {
    for (const reportTag of ["Conflict", "ExitedWithoutCandidate", "Working"] as const) {
      let replacedReport = false
      const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
        ...maintainedAuthoredCassetteCatalog.candidateConflictRecovery,
        name: `accepted result reports ${reportTag}`,
        story: maintainedAuthoredCassetteCatalog.candidateConflictRecovery.story.flatMap(
          (item): ReadonlyArray<unknown> => {
            if (item._tag === "IntegrationCandidateGitValidationReturned") return []
            if (item._tag === "IntegrationCandidateAgentReported") {
              if (replacedReport) return []
              replacedReport = true
              return [
                { ...item, report: { _tag: reportTag } },
                { ...item, report: { _tag: reportTag } }
              ]
            }
            if (item._tag === "ExpectedBehavior") {
              return [
                {
                  ...item,
                  orchestration:
                    item.orchestration?.filter(({ _tag }) => _tag !== "IntegrationCandidateConstructed") ?? null
                }
              ]
            }
            return [item]
          }
        )
      })
      const run = yield* runAuthoredScenarioCassette(cassette)
      const recorded = yield* projectRecordedCassette(run.records)
      const report = recorded.entries.find(({ _tag }) => _tag === "IntegrationCandidateAgentReported")
      if (report?._tag !== "IntegrationCandidateAgentReported") {
        return yield* Effect.die(`fixture must record ${reportTag}`)
      }
      expect(report.report._tag).toBe(reportTag)
      expect(renderRecordedCassetteLyrics(recorded)).toContain(`reported ${reportTag}`)

      const renamed = yield* renameRecordedCassette(
        recorded,
        yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
          attemptIds: [],
          claimTokens: [],
          integrationCandidateIds: [{ from: report.report.correlation.candidateId, to: `renamed-${reportTag}` }],
          integrationCandidateResourceLocators: [
            { from: report.report.correlation.candidateResource, to: `renamed-resource-${reportTag}` }
          ],
          integrationSessionIds: [
            { from: report.report.correlation.integrationSessionId, to: `renamed-session-${reportTag}` }
          ],
          operationIds: [],
          runIds: [],
          taskBranchRefs: [],
          worktreeLocators: []
        })
      )
      expect(foldRecordedCassette(renamed)._tag).toBe("ValidWorkflowJournalHistory")
    }

    let reportOrdinal = 0
    const exhaustedCassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...maintainedAuthoredCassetteCatalog.candidateConflictRecovery,
      name: "accepted result exhausts automatic candidate continuation",
      story: maintainedAuthoredCassetteCatalog.candidateConflictRecovery.story.flatMap(
        (item): ReadonlyArray<unknown> => {
          if (item._tag === "IntegrationCandidateGitValidationReturned") return []
          if (item._tag === "IntegrationCandidateAgentReported") {
            reportOrdinal += 1
            return [{ ...item, report: { _tag: reportOrdinal === 1 ? "Conflict" : "Working" } }]
          }
          if (item._tag === "ExpectedBehavior") {
            return [
              {
                ...item,
                orchestration:
                  item.orchestration?.filter(({ _tag }) => _tag !== "IntegrationCandidateConstructed") ?? null
              }
            ]
          }
          return [item]
        }
      )
    })
    const exhaustedRun = yield* runAuthoredScenarioCassette(exhaustedCassette)
    const exhaustedRecorded = yield* projectRecordedCassette(exhaustedRun.records)
    expect(
      exhaustedRecorded.entries.find(({ _tag }) => _tag === "IntegrationCandidateContinuationLimitReached")
    ).toMatchObject({ continuationCount: 2, continuationLimit: 2 })
    expect(renderRecordedCassetteLyrics(exhaustedRecorded)).toContain("2 automatic agent continuations")
  })
)

it.effect("starts a queued accepted result in the same live coordinator process", () =>
  Effect.gen(function* () {
    const source = acceptedResultRestartsIntoIntegrationAuthoredCassette.story
    const deathAt = source.findIndex(({ _tag }) => _tag === "CoordinatorProcessDies")
    const blockedGraphAt = source.findIndex(
      (item) => item._tag === "TrackerGraphReadReturned" && item.graph.revision === "accepted-result-new-blocker"
    )
    const terminal = source.at(-1)
    if (terminal?._tag !== "ExpectedBehavior") return yield* Effect.die("expected terminal assertion")
    const withoutCandidateExpectation = {
      ...terminal,
      orchestration: terminal.orchestration?.filter(({ _tag }) => _tag !== "IntegrationCandidateConstructed") ?? null
    }
    const uninterrupted = AuthoredScenarioCassette.make({
      ...acceptedResultRestartsIntoIntegrationAuthoredCassette,
      name: "accepted result starts without coordinator restart",
      story: [
        ...source.slice(0, deathAt),
        ...source.slice(blockedGraphAt - 1, blockedGraphAt + 1),
        withoutCandidateExpectation
      ]
    })

    const run = yield* runAuthoredScenarioCassette(uninterrupted)

    expect(run.coordinatorActivations).toEqual(["Fresh"])
    expect(run.records.filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
  })
)

it.effect("resumes actions when G2 introduces eligible B", () =>
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

it.effect("restart before first intent recomputes delivery without recovering a proposal", () =>
  Effect.gen(function* () {
    const firstGraphResult = singleton.story.findIndex((item) => item._tag === "TrackerGraphReadReturned")
    const cassette = {
      ...singleton,
      name: "restart before the first claim intent recomputes current delivery",
      story: singleton.story.flatMap((item, index) =>
        index === firstGraphResult
          ? [
              item,
              { _tag: "CoordinatorProcessDies" as const },
              {
                _tag: "DalphSelects" as const,
                operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
              },
              { _tag: "TrackerGraphReadReturned" as const, graph: singleton.startingFacts.trackerGraph }
            ]
          : [item]
      )
    }
    const run = yield* runAuthoredScenarioCassette(cassette)

    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquired")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
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
          integrationTarget: { repository: "/dalph/cassettes/changed-membership.git", ref: "refs/heads/master" },
          target,
          verificationPlanId: null,
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
    expect(run.records.map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorWorkReported",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved"
    ])
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported"
          ? [{ attemptId: event.report.correlation.attemptId, report: event.report._tag }]
          : []
      )
    ).toEqual([
      { attemptId: "attempt:A:0", report: "Running" },
      { attemptId: "attempt:A:0", report: "Terminal" }
    ])
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

    const duplicateCoordinatorDeath = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        { _tag: "CoordinatorProcessDies" },
        { _tag: "CoordinatorProcessDies" },
        singleton.story.at(-1)
      ]
    }
    expect((yield* runAuthoredScenarioCassette(duplicateCoordinatorDeath).pipe(Effect.flip))._tag).toBe("SchemaError")

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

it.effect("restarts after a live capacity decrease and admits B only after recovered A releases its position", () =>
  Effect.gen(function* () {
    const command = dependentTasksCompleteInOneRunAuthoredCassette.story[1]
    if (command?._tag !== "RunCoordinator") return yield* Effect.die("maintained pipeline has no coordinator")
    const target = command.target
    const initialGraph = dependentTasksCompleteInOneRunAuthoredCassette.startingFacts.trackerGraph
    const recoveryGraph = {
      ...initialGraph,
      revision: TrackerRevision.make("pipeline-B-becomes-independent-during-recovery"),
      tasks: initialGraph.tasks.map((task) => (task.id === TaskId.make("B") ? { ...task, prerequisiteIds: [] } : task))
    }
    const firstRunning = dependentTasksCompleteInOneRunAuthoredCassette.story.findIndex(
      (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running"
    )
    const aTerminal = dependentTasksCompleteInOneRunAuthoredCassette.story.findIndex(
      (item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" &&
        item.report._tag === "Terminal" &&
        item.report.attemptId === "attempt:A:0"
    )
    const acquireB = dependentTasksCompleteInOneRunAuthoredCassette.story.findIndex(
      (item) =>
        item._tag === "DalphSelects" && item.operation._tag === "AcquireTaskClaim" && item.operation.taskId === "B"
    )
    const recoveryAttemptId = AttemptId.make("attempt:B:0")
    const restartItem = (item: (typeof dependentTasksCompleteInOneRunAuthoredCassette.story)[number]) => {
      if (
        item._tag === "DalphSelects" &&
        (item.operation._tag === "RecordTaskAttemptPlan" || item.operation._tag === "ReconcileTaskWorktree") &&
        item.operation.attemptId === "attempt:B:1"
      ) {
        return { ...item, operation: { ...item.operation, attemptId: recoveryAttemptId } }
      }
      if (item._tag === "PlannedAttemptExecutorWorkReported" && item.report.attemptId === "attempt:B:1") {
        return { ...item, report: { ...item.report, attemptId: recoveryAttemptId } }
      }
      return item
    }
    const withCoordinatorDeath = {
      ...dependentTasksCompleteInOneRunAuthoredCassette,
      name: "capacity contraction survives coordinator death before later admission",
      story: dependentTasksCompleteInOneRunAuthoredCassette.story
        .filter((_item, index) => index <= aTerminal + 2 || index >= acquireB)
        .flatMap((item, index) => [
          ...(item._tag === "DalphSelects" &&
          item.operation._tag === "AcquireTaskClaim" &&
          item.operation.taskId === TaskId.make("B")
            ? [
                { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } } as const,
                { _tag: "TrackerGraphReadReturned", graph: recoveryGraph } as const
              ]
            : []),
          ...(index === 0 && item._tag === "InitialControlPolicy"
            ? [{ ...item, policy: { taskExecutionCapacity: TaskWorkCapacity.make(2) } }]
            : [item]),
          ...(index === firstRunning
            ? [
                { _tag: "SetTaskExecutionCapacity", capacity: TaskWorkCapacity.make(1) } as const,
                { _tag: "OperatorAppliesControlDirection", direction: "Unpause", subject: { _tag: "Run" } } as const,
                { _tag: "CoordinatorProcessDies" } as const,
                { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } } as const,
                { _tag: "TrackerGraphReadReturned", graph: recoveryGraph } as const,
                {
                  _tag: "DalphSelects",
                  operation: { _tag: "ReadTaskWorkSpecification", taskId: TaskId.make("A") }
                } as const,
                {
                  _tag: "TaskWorkSpecificationReadReturned",
                  body: "Complete task A.",
                  taskId: TaskId.make("A"),
                  title: "Complete A"
                } as const,
                { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: TaskId.make("A") } } as const,
                { _tag: "TaskClaimCurrentReadReturned", taskId: TaskId.make("A") } as const,
                {
                  _tag: "DalphSelects",
                  operation: {
                    _tag: "ReadTaskWorktree",
                    attemptId: AttemptId.make("attempt:A:0"),
                    taskId: TaskId.make("A")
                  }
                } as const,
                {
                  _tag: "DalphSelects",
                  operation: {
                    _tag: "ReadTargetLineage",
                    attemptId: AttemptId.make("attempt:A:0"),
                    taskId: TaskId.make("A")
                  }
                } as const
              ]
            : [])
        ])
        .map(restartItem)
    }

    const run = yield* runAuthoredScenarioCassette(withCoordinatorDeath)
    const recorded = yield* projectRecordedCassette(run.records)
    const reopened = foldRecordedCassette(recorded)
    const eventTags = run.records.map(({ event }) => event._tag)
    const changedAt = eventTags.indexOf("TaskWorkCapacityChanged")
    const aTerminalAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "Terminal" &&
        event.report.correlation.attemptId === "attempt:A:0"
    )
    const bBecameIndependentAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies.some(
          (family) =>
            family._tag === "TaskPrerequisites" &&
            family.prerequisites.some(
              ({ prerequisiteTaskIds, taskId }) => taskId === TaskId.make("B") && prerequisiteTaskIds.length === 0
            )
        )
    )
    const bResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.taskId === TaskId.make("B")
    )

    expect(JSON.stringify(run.records)).not.toContain("CoordinatorProcessDies")
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The coordinator process and its same-process executor session die"
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("Operator applies Unpause to the Run.")
    expect(recorded.entries.some(({ _tag }) => _tag === "ControlDirectionApplied")).toBe(true)
    expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
    if (reopened._tag === "ValidWorkflowJournalHistory") {
      expect(reopened.runState.pause.run).toEqual({ _tag: "RunUnpaused" })
    }
    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          event.plannedAttempt.attemptId === "attempt:A:0"
      )
    ).toHaveLength(1)
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === "attempt:A:0"
          ? [event.report._tag]
          : []
      )
    ).toEqual(["Running", "Terminal"])
    expect(changedAt).toBeGreaterThan(0)
    expect(bBecameIndependentAt).toBeGreaterThan(changedAt)
    expect(aTerminalAt).toBeGreaterThan(bBecameIndependentAt)
    expect(aTerminalAt).toBeGreaterThan(changedAt)
    expect(bResponsibilityAt).toBeGreaterThan(aTerminalAt)
    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
      { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
    ])
  })
)

it.effect(
  "safely suspends changed A while independent B continues for membership, specification, lifecycle, and external success",
  () =>
    Effect.gen(function* () {
      const target = "localized-constraint-target"
      const aAttemptId = AttemptId.make("attempt:A:0")
      const bAttemptId = AttemptId.make("attempt:B:0")
      const initialGraph = {
        revision: TrackerRevision.make("localized-constraint-initial"),
        tasks: [
          { id: TaskId.make("A"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] },
          {
            id: TaskId.make("B"),
            lifecycle: { _tag: "Open" } as const,
            parentTaskId: null,
            prerequisiteIds: [TaskId.make("A")]
          }
        ]
      }
      const localizedGraph = {
        revision: TrackerRevision.make("pipeline-A-left-target"),
        tasks: [{ id: TaskId.make("B"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }]
      }
      const localizedCassette = {
        _tag: "AuthoredScenarioCassette",
        name: "A leaves the target while independent B continues",
        schemaVersion: 1,
        startingFacts: {
          executorWork: "NoPriorReport",
          journal: "Empty",
          taskClaims: [],
          taskWorkSpecifications: [
            { body: "Complete task A.", taskId: TaskId.make("A"), title: "Complete A" },
            { body: "Complete independent task B.", taskId: TaskId.make("B"), title: "Complete B" }
          ],
          trackerGraph: initialGraph,
          worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
        },
        story: [
          { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: TaskWorkCapacity.make(2) } },
          {
            _tag: "RunCoordinator",
            baseSha: "3333333333333333333333333333333333333333",
            claimOwner: "localized-constraint-owner",
            claimTokenPrefix: "localized-constraint-claim",
            executor: "executor:controlled-fake",
            integrationTarget: { repository: "/dalph/cassettes/localized-constraint.git", ref: "refs/heads/master" },
            target,
            verificationPlanId: null,
            worktreeRoot: "/dalph/cassettes/localized-constraint"
          },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: initialGraph },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: initialGraph },
          { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: TaskId.make("A") } },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: initialGraph },
          { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: TaskId.make("A") } },
          {
            _tag: "TaskWorkSpecificationReadReturned",
            body: "Complete task A.",
            taskId: TaskId.make("A"),
            title: "Complete A"
          },
          {
            _tag: "DalphSelects",
            operation: { _tag: "RecordTaskAttemptPlan", attemptId: aAttemptId, taskId: TaskId.make("A") }
          },
          {
            _tag: "DalphSelects",
            operation: { _tag: "ReconcileTaskWorktree", attemptId: aAttemptId, taskId: TaskId.make("A") }
          },
          {
            _tag: "PlannedAttemptExecutorWorkReported",
            report: { _tag: "Running", attemptId: aAttemptId },
            request: "StartOrContinue"
          },
          { _tag: "CoordinatorProcessDies" },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
          {
            _tag: "PlannedAttemptExecutorWorkReported",
            report: { _tag: "SafelySuspended", attemptId: aAttemptId },
            request: "Suspend"
          },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
          { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: TaskId.make("B") } },
          { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
          { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
          { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: TaskId.make("B") } },
          {
            _tag: "TaskWorkSpecificationReadReturned",
            body: "Complete independent task B.",
            taskId: TaskId.make("B"),
            title: "Complete B"
          },
          {
            _tag: "DalphSelects",
            operation: { _tag: "RecordTaskAttemptPlan", attemptId: bAttemptId, taskId: TaskId.make("B") }
          },
          {
            _tag: "DalphSelects",
            operation: { _tag: "ReconcileTaskWorktree", attemptId: bAttemptId, taskId: TaskId.make("B") }
          },
          {
            _tag: "PlannedAttemptExecutorWorkReported",
            report: { _tag: "Running", attemptId: bAttemptId },
            request: "StartOrContinue"
          },
          {
            _tag: "PlannedAttemptExecutorWorkReported",
            report: { _tag: "Terminal", attemptId: bAttemptId, result: { _tag: "Completed" } },
            request: "StartOrContinue"
          },
          {
            _tag: "ExpectedBehavior",
            orchestration: [
              {
                _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
                attemptId: aAttemptId,
                taskId: TaskId.make("A")
              },
              { _tag: "PlannedAttemptExecutorWorkReported", attemptId: aAttemptId, report: "Running" },
              { _tag: "PlannedAttemptExecutorWorkReported", attemptId: aAttemptId, report: "SafelySuspended" },
              {
                _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
                attemptId: bAttemptId,
                taskId: TaskId.make("B")
              },
              { _tag: "PlannedAttemptExecutorWorkReported", attemptId: bAttemptId, report: "Running" },
              { _tag: "PlannedAttemptExecutorWorkReported", attemptId: bAttemptId, report: "TerminalCompleted" }
            ] as const,
            protocol: null,
            taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: TaskId.make("B") }] }
          }
        ]
      }

      const run = yield* runAuthoredScenarioCassette(localizedCassette)
      const recorded = yield* projectRecordedCassette(run.records)
      const membershipObservedAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            (family) =>
              family._tag === "TaskTargetMembership" &&
              family.memberTaskIds.length === 1 &&
              family.memberTaskIds[0] === TaskId.make("B")
          )
      )
      const bResponsibilityAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          event.plannedAttempt.taskId === TaskId.make("B")
      )

      expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
      expect(
        run.records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === aAttemptId
            ? [event.report._tag]
            : []
        )
      ).toEqual(["Running", "SafelySuspended"])
      expect(membershipObservedAt).toBeGreaterThan(0)
      expect(bResponsibilityAt).toBeGreaterThan(membershipObservedAt)
      expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
      expect(
        recorded.entries.some(
          (entry) =>
            entry._tag === "PlannedAttemptExecutorWorkReported" &&
            entry.report.correlation.attemptId === aAttemptId &&
            entry.report._tag === "Terminal"
        )
      ).toBe(false)
      expect(renderRecordedCassetteLyrics(recorded)).toContain(
        `The executor reported Terminal for attempt ${bAttemptId}.`
      )
      expect(run.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "B" }])

      const externallyCompletedGraph = {
        revision: TrackerRevision.make("pipeline-A-completed-externally"),
        tasks: [
          {
            id: TaskId.make("A"),
            lifecycle: { _tag: "CompletedSuccessfully" } as const,
            parentTaskId: null,
            prerequisiteIds: []
          },
          {
            id: TaskId.make("B"),
            lifecycle: { _tag: "Open" } as const,
            parentTaskId: null,
            prerequisiteIds: [TaskId.make("A")]
          }
        ]
      }
      const externalSuccessStory = localizedCassette.story.map((item) =>
        item._tag === "TrackerGraphReadReturned" && item.graph === localizedGraph
          ? { ...item, graph: externallyCompletedGraph }
          : item
      )
      const externalSuspensionAt = externalSuccessStory.findIndex(
        (item) =>
          item._tag === "PlannedAttemptExecutorWorkReported" &&
          "report" in item &&
          item.report._tag === "SafelySuspended" &&
          item.report.attemptId === aAttemptId
      )
      const externalSuccessCassette = {
        ...localizedCassette,
        name: "A completes externally while its exact claim and WIP remain",
        story: [
          ...externalSuccessStory.slice(0, externalSuspensionAt + 1),
          { _tag: "DalphSelects" as const, operation: { _tag: "ReleaseTaskClaim" as const, taskId: TaskId.make("A") } },
          ...externalSuccessStory.slice(externalSuspensionAt + 1)
        ]
      }
      const externalSuccessRun = yield* runAuthoredScenarioCassette(externalSuccessCassette)
      const claimReleaseEvents = externalSuccessRun.records.filter(
        ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
      )
      expect(claimReleaseEvents.map(({ event }) => event._tag)).toEqual([
        "TaskClaimReleaseIntended",
        "TaskClaimReleased"
      ])
      expect(
        externalSuccessRun.records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report.correlation.attemptId === aAttemptId &&
            event.report._tag === "Terminal"
        )
      ).toBe(false)
      expect(
        externalSuccessRun.records.some(
          ({ event }) => event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted"
        )
      ).toBe(false)
      expect(externalSuccessRun.observedBehavior.taskWorkResults).toEqual([
        { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
      ])

      const changedInstructionsGraph = {
        revision: TrackerRevision.make("pipeline-A-instructions-changed"),
        tasks: [
          { id: TaskId.make("A"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] },
          { id: TaskId.make("B"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }
        ]
      }
      const changedGraphStory = localizedCassette.story.map((item) =>
        item._tag === "TrackerGraphReadReturned" && item.graph === localizedGraph
          ? { ...item, graph: changedInstructionsGraph }
          : item
      )
      const firstChangedGraphAt = changedGraphStory.findIndex(
        (item) => item._tag === "TrackerGraphReadReturned" && item.graph === changedInstructionsGraph
      )
      const changedInstructionsCassette = {
        ...localizedCassette,
        name: "A instructions change while independent B continues",
        story: [
          ...changedGraphStory.slice(0, firstChangedGraphAt + 1),
          {
            _tag: "DalphSelects" as const,
            operation: { _tag: "ReadTaskWorkSpecification" as const, taskId: TaskId.make("A") }
          },
          {
            _tag: "TaskWorkSpecificationReadReturned" as const,
            body: "Complete changed task A without pretending the old attempt incorporated this text.",
            taskId: TaskId.make("A"),
            title: "Complete changed A"
          },
          ...changedGraphStory.slice(firstChangedGraphAt + 1)
        ]
      }
      const changedInstructionsRun = yield* runAuthoredScenarioCassette(changedInstructionsCassette)
      expect(
        changedInstructionsRun.records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === aAttemptId
            ? [event.report._tag]
            : []
        )
      ).toEqual(["Running", "SafelySuspended"])
      expect(
        changedInstructionsRun.records.some(
          ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
        )
      ).toBe(false)
      expect(changedInstructionsRun.observedBehavior.taskWorkResults).toEqual([
        { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
      ])

      const terminalWithoutSuccessGraph = {
        revision: TrackerRevision.make("pipeline-A-terminal-without-success"),
        tasks: [
          {
            id: TaskId.make("A"),
            lifecycle: { _tag: "TerminalWithoutSuccess" } as const,
            parentTaskId: null,
            prerequisiteIds: []
          },
          { id: TaskId.make("B"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }
        ]
      }
      const lifecycleCassette = {
        ...localizedCassette,
        name: "A closes without success while independent B continues",
        story: localizedCassette.story.map((item) =>
          item._tag === "TrackerGraphReadReturned" && item.graph === localizedGraph
            ? { ...item, graph: terminalWithoutSuccessGraph }
            : item
        )
      }
      const lifecycleRun = yield* runAuthoredScenarioCassette(lifecycleCassette)
      expect(
        lifecycleRun.records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === aAttemptId
            ? [event.report._tag]
            : []
        )
      ).toEqual(["Running", "SafelySuspended"])
      expect(
        lifecycleRun.records.some(
          ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
        )
      ).toBe(false)
      expect(lifecycleRun.observedBehavior.taskWorkResults).toEqual([
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

    const suspendedRun = yield* runAuthoredScenarioCassette(runPauseSafelySuspendsAuthoredCassette)
    expect(suspendedRun.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "SafelySuspended"
    })
  })
)

it.effect("records a foreign claim from an authored recovery story and safely suspends only its attempt", () =>
  Effect.gen(function* () {
    const foreignClaim = {
      _tag: "ActiveTaskClaim",
      operationId: OperationId.make("foreign-cassette-claim"),
      owner: ClaimOwner.make("another-owner"),
      taskId: TaskId.make("A"),
      token: ClaimToken.make("another-owner-token")
    } as const
    const expected = singleton.story.at(-1)
    if (expected?._tag !== "ExpectedBehavior") return yield* Effect.die("singleton has no terminal assertions")
    const storyBeforeAssertions = singleton.story
      .slice(0, -1)
      .flatMap((item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Terminal"
          ? [{ _tag: "CoordinatorProcessDies" as const }]
          : [item]
      )
    const foreignClaimStory = {
      ...singleton,
      name: "a foreign claim safely suspends the affected recovered attempt",
      story: [
        ...storyBeforeAssertions,
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
        {
          _tag: "TaskWorkSpecificationReadReturned",
          body: "Implement the accepted singleton behavior.",
          taskId: "A",
          title: "Implement singleton"
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        { _tag: "TaskClaimReadReturned", observation: foreignClaim },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
          request: "Suspend"
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: singleton.startingFacts.trackerGraph },
        {
          ...expected,
          orchestration: [
            { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
            { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "Running" },
            { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "SafelySuspended" }
          ],
          protocol: [
            { _tag: "TaskClaimAcquired", taskId: "A" },
            { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
            { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
            { _tag: "TaskClaimObserved", claimState: "Foreign", taskId: "A" }
          ],
          taskWork: { ...expected.taskWork, results: [] }
        }
      ]
    }

    const run = yield* runAuthoredScenarioCassette(foreignClaimStory)
    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(run.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "TaskClaimObserved",
      claimState: "Foreign",
      taskId: "A"
    })
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)

    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "TaskTrackerFactsObserved",
        evidence: expect.objectContaining({ _tag: "FocusedTaskClaimFacts", observation: foreignClaim })
      })
    )
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)

    const unreadableClaimStory = {
      ...foreignClaimStory,
      name: "three unreadable claim responses safely suspend the affected recovered attempt",
      story: foreignClaimStory.story.reduce<ReadonlyArray<unknown>>((story, item) => {
        if (item._tag === "TaskClaimReadReturned") {
          return [
            ...story,
            { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
            { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
            { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" }
          ]
        }
        if (item._tag === "ExpectedBehavior") {
          return [
            ...story,
            {
              ...item,
              protocol: [
                { _tag: "TaskClaimAcquired", taskId: "A" },
                { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskClaimReadExhausted", taskId: "A" }
              ]
            }
          ]
        }
        return [...story, item]
      }, [])
    }
    const unreadableRun = yield* runAuthoredScenarioCassette(unreadableClaimStory)
    expect(unreadableRun.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "TaskClaimReadExhausted",
      taskId: "A"
    })
    expect(unreadableRun.records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
    const unreadableRecorded = yield* projectRecordedCassette(unreadableRun.records)
    expect(unreadableRecorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "TaskTrackerFactsObserved",
        evidence: expect.objectContaining({ _tag: "FocusedTaskClaimFactsUnreadable" })
      })
    )
    expect(
      verifyRecordedCassetteRoundTrip(unreadableRun.records, unreadableRecorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
    expect(renderAuthoredCassetteLyrics(unreadableRun.cassette)).toContain(
      "The task tracker cannot read the claim for task A."
    )

    const requestId = TaskClaimReacquisitionRequestId.make("cassette-reacquire-missing-A")
    const missingClaimStory = {
      ...foreignClaimStory,
      name: "an operator replaces a missing claim with a fresh claim identity",
      story: [
        ...storyBeforeAssertions,
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
        {
          _tag: "TaskWorkSpecificationReadReturned",
          body: "Implement the accepted singleton behavior.",
          taskId: "A",
          title: "Implement singleton"
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        { _tag: "TaskClaimReadReturned", observation: UnclaimedTask.make({ taskId: TaskId.make("A") }) },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
          request: "Suspend"
        },
        { _tag: "OperatorDirectsTaskClaimReacquisition", requestId, taskId: "A" },
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Terminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
          request: "StartOrContinue"
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: singleton.startingFacts.trackerGraph },
        { ...expected, orchestration: null, protocol: null }
      ]
    }
    const decodedMissingClaimStory = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(
      missingClaimStory
    ).pipe(Effect.orDie)
    const reacquiredRun = yield* runAuthoredScenarioCassette(decodedMissingClaimStory)
    const claimIntents = reacquiredRun.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation] : []
    )
    expect(claimIntents).toHaveLength(2)
    expect(claimIntents[1]).toMatchObject({ authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId } })
    expect(claimIntents[1]?.acquisition.operationId).not.toBe(claimIntents[0]?.acquisition.operationId)
    expect(claimIntents[1]?.acquisition.token).not.toBe(claimIntents[0]?.acquisition.token)
    expect(
      reacquiredRun.records.some(
        ({ event }) => event._tag === "TaskClaimReacquisitionDirected" && event.requestId === requestId
      )
    ).toBe(true)
    expect(reacquiredRun.observedBehavior.taskWorkResults).toContainEqual({
      _tag: "PlannedWorkForTaskCompleted",
      taskId: "A"
    })
    expect(renderAuthoredCassetteLyrics(decodedMissingClaimStory)).toContain(
      `Operator request ${requestId} directs Dalph to reacquire the claim for task A.`
    )

    const foreignConflictStory = {
      ...foreignClaimStory,
      name: "an operator request preserves a foreign claim conflict",
      story: [
        ...foreignClaimStory.story.slice(0, -3),
        {
          _tag: "OperatorDirectsTaskClaimReacquisition",
          requestId: TaskClaimReacquisitionRequestId.make("cassette-reacquire-foreign-A"),
          taskId: "A"
        },
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        expected
      ]
    }
    expect(yield* runAuthoredScenarioCassette(foreignConflictStory).pipe(Effect.flip)).toMatchObject({
      _tag: "TrackerMutation.TaskClaimConflict",
      attempted: { taskId: "A" },
      observed: foreignClaim
    })
  })
)

it.effect("records a lost planned worktree in the authored and recorded recovery cassette", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(lostPlannedWorktreeSafelySuspendsAuthoredCassette)

    expect(run.coordinatorActivations).toEqual(["Fresh", "Recovered"])
    expect(run.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "AttemptWorktreeLost",
      attemptId: "attempt:A:0",
      taskId: "A"
    })
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "PlannedAttemptWorktreeObserved",
        observation: expect.objectContaining({ _tag: "AttemptWorktreeLost" })
      })
    )
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "Git changes the planned worktree observation to PlannedWorktreeAbsent."
    )
    expect(renderRecordedCassetteLyrics(recorded)).toContain("Git no longer registered planned worktree")
  })
)

it.effect("records compatible target advancement and isolates a proven target rewrite in maintained cassettes", () =>
  Effect.gen(function* () {
    const compatible = yield* runAuthoredScenarioCassette(compatibleTargetAdvanceContinuesAuthoredCassette)
    const rewritten = yield* runAuthoredScenarioCassette(incompatibleTargetRewriteSafelySuspendsAuthoredCassette)

    expect(compatible.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "CompatibleTargetAdvance",
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "2222222222222222222222222222222222222222",
      taskId: "A"
    })
    expect(compatible.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }])
    expect(rewritten.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "IncompatibleTargetRewrite",
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "3333333333333333333333333333333333333333",
      taskId: "A"
    })
    expect(rewritten.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "SafelySuspended"
    })
    expect(rewritten.observedBehavior.taskWorkResults).toContainEqual({
      _tag: "PlannedWorkForTaskCompleted",
      taskId: "C"
    })
    expect(rewritten.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
    expect(renderAuthoredCassetteLyrics(compatible.cassette)).toContain("descends from Base")
    expect(renderAuthoredCassetteLyrics(rewritten.cassette)).toContain("is outside Base")

    const compatibleRecorded = yield* projectRecordedCassette(compatible.records)
    const rewrittenRecorded = yield* projectRecordedCassette(rewritten.records)
    const rewrittenOccurrences = yield* projectWorkflowOccurrences(rewritten.records)
    const targetLineageOccurrence = rewrittenOccurrences.occurrences.find(
      (occurrence) => occurrence._tag === "TargetLineageObserved"
    )
    if (targetLineageOccurrence?._tag !== "TargetLineageObserved") {
      return yield* Effect.die("missing projected target-lineage occurrence")
    }
    expect(
      Option.isSome(originatingActionForTargetLineageObservation(rewrittenOccurrences, targetLineageOccurrence))
    ).toBe(true)
    expect(renderRecordedCassetteLyrics(compatibleRecorded)).toContain("descended from Base")
    expect(renderRecordedCassetteLyrics(rewrittenRecorded)).toContain("outside Base")
    expect(
      [...compatible.records, ...rewritten.records].some(({ event }) => event._tag === "TargetLineageObserved")
    ).toBe(true)
    expect(
      verifyRecordedCassetteRoundTrip(compatible.records, compatibleRecorded).every(
        (checkpoint) => checkpoint.workflowHistoryEquivalent && checkpoint.operationalStateEquivalent
      )
    ).toBe(true)
    expect(
      verifyRecordedCassetteRoundTrip(rewritten.records, rewrittenRecorded).every(
        (checkpoint) => checkpoint.workflowHistoryEquivalent && checkpoint.operationalStateEquivalent
      )
    ).toBe(true)
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
    const allProtocolCassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...run.cassette,
      story: run.cassette.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              protocol: [
                { _tag: "TaskClaimAcquired", taskId: "A" },
                { _tag: "TaskClaimReleased", taskId: "A" },
                { _tag: "TaskClaimObserved", claimState: "Missing", taskId: "A" },
                { _tag: "TaskClaimReadExhausted", taskId: "A" },
                { _tag: "TaskClaimReacquisitionDirected", requestId: "render-reacquisition", taskId: "A" },
                { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" }
              ]
            }
          : item
      )
    })
    const allProtocolLyrics = renderAuthoredCassetteLyrics(allProtocolCassette)
    expect(allProtocolLyrics).toContain("release its exact claim")
    expect(allProtocolLyrics).toContain("record missing claim authority")
    expect(allProtocolLyrics).toContain("exhaust the bounded claim read")
    expect(allProtocolLyrics).toContain(
      "Operator request render-reacquisition to direct Dalph to reacquire the claim for task A"
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
      ...runPauseSafelySuspendsAuthoredCassette,
      story: runPauseSafelySuspendsAuthoredCassette.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              taskWork: {
                ...item.taskWork,
                absences: [
                  ...item.taskWork.absences,
                  { _tag: "NoPlannedWorkUndertakenForTask" as const, taskId: TaskId.make("A") }
                ]
              }
            }
          : item
      )
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
      const directionEvent = ControlDirectionAppliedEvent.make({
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(1),
        subject: { _tag: "Run", runId: run.runId },
        version: workflowJournalEventVersion
      })
      const recordsWithDirection = insertBeforeRunTermination(run.records, directionEvent)
      const terminationEvent = WorkflowRunTerminatedEvent.make({
        disposition: "Completed",
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
      const records = [
        ...recordsWithDirection,
        {
          event: terminationEvent,
          key: describeJournalEvent(terminationEvent).expectedKey,
          position: JournalPosition.make(recordsWithDirection.length + 1),
          runId: run.runId
        }
      ]
      const projected = yield* projectRecordedCassette(records)
      const executorReportEntry = projected.entries.find((entry) => entry._tag === "PlannedAttemptExecutorWorkReported")
      if (executorReportEntry?._tag !== "PlannedAttemptExecutorWorkReported") {
        return yield* Effect.die("missing executor report entry")
      }
      const executorResponsibilityEntry = projected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      if (executorResponsibilityEntry?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") {
        return yield* Effect.die("missing executor responsibility entry")
      }
      const acquiredClaimEntry = projected.entries.find((entry) => entry._tag === "TaskClaimAcquired")
      if (acquiredClaimEntry?._tag !== "TaskClaimAcquired") {
        return yield* Effect.die("missing acquired claim entry")
      }
      const runBeganEntry = projected.entries.find((entry) => entry._tag === "WorkflowRunBegan")
      if (runBeganEntry?._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("missing workflow run entry")
      }
      const acceptedResult = AcceptedResult.make({
        commit: GitCommitSha.make("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      })
      const integrationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/dalph/cassettes/integration.git"),
        ref: IntegrationTargetRef.make("refs/heads/master")
      })
      const additionalDirections: ReadonlyArray<RecordedCassetteEntry> = [
        {
          _tag: "ControlDirectionApplied",
          direction: "Unpause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(2),
          subject: { _tag: "Run", runId: run.runId }
        },
        {
          _tag: "ControlDirectionApplied",
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(3),
          subject: { _tag: "Task", runId: run.runId, taskId: TaskId.make("A") }
        },
        {
          _tag: "ControlDirectionApplied",
          direction: "Unpause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(4),
          subject: { _tag: "Task", runId: run.runId, taskId: TaskId.make("A") }
        },
        {
          _tag: "TaskClaimReacquisitionDirected",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: TaskClaimReacquisitionRequestId.make("rename-task-claim-reacquisition-request"),
          taskId: TaskId.make("A")
        }
      ]
      const entriesWithAcceptedResult = projected.entries.flatMap((entry) => {
        if (entry === executorReportEntry) {
          return [
            entry,
            {
              _tag: "PlannedAttemptExecutorWorkReported" as const,
              occurrenceClassification: "NonActionOccurrence" as const,
              ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
              report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
                correlation: executorReportEntry.report.correlation
              })
            }
          ]
        }
        return [
          entry._tag === "PlannedAttemptExecutorWorkReported" && entry.report._tag === "Terminal"
            ? {
                ...entry,
                ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
                report: PlannedAttemptExecutorReport.cases.Terminal.make({
                  correlation: entry.report.correlation,
                  result: { _tag: "Accepted", acceptedResult }
                })
              }
            : entry
        ]
      })
      const terminationIndex = entriesWithAcceptedResult.findIndex((entry) => entry._tag === "WorkflowRunTerminated")
      const insertionIndex = terminationIndex < 0 ? entriesWithAcceptedResult.length : terminationIndex
      const integrationEntries = [
        {
          _tag: "IntegrationResponsibilityBegan" as const,
          acceptedResult,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          integrationTarget,
          occurrenceClassification: "InitiatedAction" as const,
          plannedAttempt: executorResponsibilityEntry.plannedAttempt
        },
        {
          _tag: "IntegrationStarted" as const,
          acceptedResult,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          integrationTarget,
          occurrenceClassification: "InitiatedAction" as const,
          plannedAttempt: executorResponsibilityEntry.plannedAttempt
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const claimReleaseOperation = makeTaskClaimReleaseOperation({
        predecessorOperationIds: [acquiredClaimEntry.claim.operationId],
        release: { claim: acquiredClaimEntry.claim, operationId: OperationId.make(`cassette-release:${run.runId}`) }
      })
      const claimReleaseEntries = [
        { _tag: "TaskClaimReleaseIntended" as const, operation: claimReleaseOperation },
        { _tag: "TaskClaimReleased" as const, release: claimReleaseOperation.release }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const rejectedClaimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make(`cassette-rejected-claim:${run.runId}`),
          owner: ClaimOwner.make("cassette-owner"),
          taskId: TaskId.make("A"),
          token: ClaimToken.make(`cassette-rejected-token:${run.runId}`)
        },
        predecessorOperationIds: []
      })
      const rejectedClaimEntries = [
        { _tag: "TaskClaimAcquisitionIntended" as const, operation: rejectedClaimOperation },
        {
          _tag: "TaskClaimAcquisitionRejected" as const,
          observed: {
            _tag: "ActiveTaskClaim" as const,
            operationId: OperationId.make(`cassette-foreign-claim:${run.runId}`),
            owner: ClaimOwner.make("foreign-owner"),
            taskId: TaskId.make("A"),
            token: ClaimToken.make(`cassette-foreign-token:${run.runId}`)
          },
          operationId: rejectedClaimOperation.acquisition.operationId,
          reason: "ForeignClaim" as const
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const claimRead = makeTaskClaimObservationOperation(
        OperationId.make(`cassette-claim-read:${run.runId}`),
        runBeganEntry.target,
        acquiredClaimEntry.claim.taskId,
        [acquiredClaimEntry.claim.operationId]
      )
      const unreadableClaimRead = makeTaskClaimObservationOperation(
        OperationId.make(`cassette-unreadable-claim-read:${run.runId}`),
        runBeganEntry.target,
        acquiredClaimEntry.claim.taskId,
        [claimRead.operationId]
      )
      const unclaimedClaimRead = makeTaskClaimObservationOperation(
        OperationId.make(`cassette-unclaimed-claim-read:${run.runId}`),
        runBeganEntry.target,
        acquiredClaimEntry.claim.taskId,
        [unreadableClaimRead.operationId]
      )
      const claimObservationEntries = [
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: claimRead
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: makeFocusedTaskClaimFactsObserved(claimRead, acquiredClaimEntry.claim),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: claimRead.operationId
        },
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: unreadableClaimRead
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: makeFocusedTaskClaimFactsUnreadable(unreadableClaimRead),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: unreadableClaimRead.operationId
        },
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: unclaimedClaimRead
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: makeFocusedTaskClaimFactsObserved(
            unclaimedClaimRead,
            UnclaimedTask.make({ taskId: acquiredClaimEntry.claim.taskId })
          ),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: unclaimedClaimRead.operationId
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const worktreeObservationOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make(`cassette-worktree-read:${run.runId}`),
        plannedAttempt: executorResponsibilityEntry.plannedAttempt,
        predecessorOperationIds: []
      })
      const worktreeObservationEntries = [
        {
          _tag: "GitReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: worktreeObservationOperation
        },
        {
          _tag: "PlannedAttemptWorktreeObserved" as const,
          observation: AttemptWorktreeLost.make({ plannedAttempt: executorResponsibilityEntry.plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: worktreeObservationOperation.operationId
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const targetLineageOperation = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make(`cassette-target-lineage-read:${run.runId}`),
        plannedAttempt: executorResponsibilityEntry.plannedAttempt,
        predecessorOperationIds: [worktreeObservationOperation.operationId]
      })
      const targetLineageEntries = [
        {
          _tag: "GitReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: targetLineageOperation
        },
        {
          _tag: "TargetLineageObserved" as const,
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: executorResponsibilityEntry.plannedAttempt.baseSha,
            targetHeadSha: executorResponsibilityEntry.plannedAttempt.baseSha
          },
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: targetLineageOperation.operationId,
          plannedAttempt: executorResponsibilityEntry.plannedAttempt
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const recorded = RecordedCassette.make({
        ...projected,
        entries: [
          ...entriesWithAcceptedResult.slice(0, insertionIndex),
          ...additionalDirections,
          {
            _tag: "TaskWorkCapacityChanged",
            capacity: TaskWorkCapacity.make(2),
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            previousRevision: RunPolicyRevision.make(1),
            revision: RunPolicyRevision.make(2)
          },
          ...integrationEntries,
          ...claimReleaseEntries,
          ...rejectedClaimEntries,
          ...claimObservationEntries,
          ...worktreeObservationEntries,
          ...targetLineageEntries,
          ...entriesWithAcceptedResult.slice(insertionIndex)
        ]
      })
      const encodedBefore = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded))
      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: "attempt:A:0", to: "renamed-attempt-A" }],
        claimTokens: [{ from: `cassette-claim:A:cassette:${run.runId}:operation:2`, to: "renamed-claim-token-A" }],
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
        operationIds: [
          ...Array.from({ length: 7 }, (_unused, ordinal) => ({
            from: `cassette:${run.runId}:operation:${ordinal}`,
            to: `renamed-operation:${ordinal}`
          })),
          { from: `cassette-release:${run.runId}`, to: "renamed-operation:claim-release" },
          { from: `cassette-worktree-read:${run.runId}`, to: "renamed-operation:worktree-read" },
          { from: `cassette-target-lineage-read:${run.runId}`, to: "renamed-operation:target-lineage-read" },
          { from: `cassette-unclaimed-claim-read:${run.runId}`, to: "renamed-operation:unclaimed-claim-read" }
        ],
        runIds: [{ from: run.runId, to: "renamed-run" }],
        taskBranchRefs: [{ from: "refs/heads/dalph/attempt-A-0", to: "refs/heads/dalph/renamed-attempt-A" }],
        worktreeLocators: [{ from: "/dalph/cassettes/attempt-A-0", to: "/dalph/cassettes/renamed-attempt-A" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const recordedHistory = foldRecordedCassette(recorded)
      if (recordedHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die(
          `alpha-renaming fixture must remain valid before renaming: ${recordedHistory.issues
            .map((issue) => JSON.stringify(issue))
            .join("; ")}`
        )
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
        ...renaming.integrationCandidateIds,
        ...renaming.integrationSessionIds,
        ...renaming.operationIds,
        ...renaming.runIds,
        ...renaming.taskBranchRefs,
        ...renaming.worktreeLocators
      ]
      const entryVariants = {
        AttemptChoiceApplied: true,
        ControlDirectionApplied: true,
        GitReadInitiated: true,
        IntegrationResponsibilityBegan: true,
        IntegrationStarted: true,
        IntegrationCandidateAgentReported: true,
        IntegrationCandidateConstructed: true,
        IntegrationCandidateConstructionIntended: true,
        IntegrationCandidateGitObserved: true,
        IntegrationCandidateGitValidationFailed: true,
        IntegrationCandidateCorrectionLimitReached: true,
        IntegrationCandidateContinuationLimitReached: true,
        TargetVerificationIntended: true,
        TargetVerificationEvidenceSealed: true,
        TargetVerificationCorrelationContradicted: true,
        TargetPromotionIntended: true,
        TargetPromotionAttemptIntended: true,
        TargetPromotionObservedSuccess: true,
        TargetPromotionStale: true,
        TargetPromotionNonConvergence: true,
        CompletionClaimReplacementIntended: true,
        CompletionClaimReplacementAttemptIntended: true,
        CompletionClaimReplaced: true,
        CompletionClaimDeletionIntended: true,
        CompletionClaimDeletionAttemptIntended: true,
        CompletionClaimDeleted: true,
        IntegrationFinalitySettled: true,
        PlannedAttemptExecutorWorkReported: true,
        PlannedAttemptExecutorWorkResponsibilityBegan: true,
        PlannedAttemptWorktreeObserved: true,
        TargetLineageObserved: true,
        TaskAttemptPlanned: true,
        TaskClaimAcquired: true,
        TaskClaimAcquisitionIntended: true,
        TaskClaimAcquisitionRejected: true,
        TaskClaimReleaseIntended: true,
        TaskClaimReleased: true,
        TaskClaimReacquisitionDirected: true,
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
        ReadTaskClaim: true,
        ReadTargetLineage: true,
        ReadTaskWorktree: true,
        ReleaseTaskClaim: true,
        ReadTaskWorkSpecification: true,
        ReadTrackerGraph: true,
        RecordTaskAttemptPlan: true,
        ReconcileTaskWorktree: true
      } satisfies Record<WorkflowOperation["_tag"], true>
      const observationVariants = {
        CompleteTaskTrackerFacts: true,
        FocusedTaskClaimFacts: true,
        FocusedTaskClaimFactsUnreadable: true,
        FocusedTaskWorkSpecificationFacts: true,
        UnchangedTaskTrackerFactsReconfirmed: true
      } satisfies Record<TaskTrackerFactsObservation["_tag"], true>

      expect(checkpoints.every((checkpoint) => checkpoint.workflowHistoryEquivalent)).toBe(true)
      for (const { from, to } of allRenamings) {
        expect(encodedAfter).not.toContain(`"${from}"`)
        expect(encodedAfter).toContain(`"${to}"`)
      }
      expect(new Set(recorded.entries.map(({ _tag }) => _tag))).toEqual(
        new Set(
          Object.keys(entryVariants).filter(
            (tag) =>
              tag !== "AttemptChoiceApplied" &&
              !tag.startsWith("IntegrationCandidate") &&
              !tag.startsWith("TargetVerification") &&
              !tag.startsWith("TargetPromotion") &&
              !tag.startsWith("CompletionClaim") &&
              tag !== "IntegrationFinalitySettled"
          )
        )
      )
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

it.effect("renames and renders every contradictory planned-worktree observation distinctly", () =>
  Effect.gen(function* () {
    const plannedBranch = TaskBranchRef.make("refs/heads/dalph/planned")
    const observedBranch = TaskBranchRef.make("refs/heads/dalph/observed")
    const plannedWorktree = WorktreeLocator.make("/worktrees/planned")
    const registeredWorktree = WorktreeLocator.make("/worktrees/registered")
    const sha = GitCommitSha.make("9".repeat(40))
    const operationId = OperationId.make("recorded-worktree-variant-read")
    const observations = [
      new CompetingWorktreeRegistrations({
        observedBranchAtPlannedWorktree: observedBranch,
        observedHeadAtPlannedWorktree: sha,
        plannedBranch,
        plannedBranchRegisteredWorktree: registeredWorktree,
        plannedWorktree
      }),
      new ConflictingWorktreeRegistration({
        observedBranch,
        observedHead: sha,
        plannedBranch,
        worktree: plannedWorktree
      }),
      new ContradictoryWorktreeState({ detail: "inconsistent registration", worktree: plannedWorktree }),
      new ForeignWorktreeRegistration({ branch: plannedBranch, plannedWorktree, registeredWorktree }),
      PlannedWorktreeReady.make({ baseSha: sha, branch: plannedBranch, headSha: sha, worktree: plannedWorktree }),
      new UntrackedWorktreePath({ worktree: plannedWorktree }),
      new WorktreeBaseMismatch({ baseSha: sha, branch: plannedBranch, headSha: sha, worktree: plannedWorktree })
    ] as const
    const cassette = RecordedCassette.make({
      _tag: "RecordedCassette",
      entries: observations.map((observation) => ({
        _tag: "PlannedAttemptWorktreeObserved" as const,
        observation,
        occurrenceClassification: "NonActionOccurrence" as const,
        originatingActionOperationId: operationId
      })),
      runId: RunId.make("recorded-worktree-variant-run"),
      schemaVersion: recordedCassetteVersion
    })
    const renamed = yield* renameRecordedCassette(
      cassette,
      yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [],
        claimTokens: [],
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [
          { from: plannedBranch, to: "refs/heads/dalph/renamed-planned" },
          { from: observedBranch, to: "refs/heads/dalph/renamed-observed" }
        ],
        worktreeLocators: [
          { from: plannedWorktree, to: "/worktrees/renamed-planned" },
          { from: registeredWorktree, to: "/worktrees/renamed-registered" }
        ]
      })
    )
    const lyrics = renderRecordedCassetteLyrics(cassette)
    expect(lyrics).toContain("competing registrations")
    expect(lyrics).toContain("contradictory facts")
    expect(lyrics).toContain("foreign worktree")
    expect(lyrics).toContain("did not register")
    expect(lyrics).toContain("outside Base")
    expect(JSON.stringify(renamed)).toContain("/worktrees/renamed-registered")
    expect(JSON.stringify(renamed)).toContain("refs/heads/dalph/renamed-observed")
  })
)

it.effect("rejects identity renaming that repeats a source or destination", () =>
  Effect.gen(function* () {
    const otherwiseEmptyRenaming = {
      claimTokens: [],
      integrationCandidateIds: [],
      integrationCandidateResourceLocators: [],
      integrationSessionIds: [],
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

it.effect("renders a recorded applied operator direction from its structured occurrence", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singleton)
    const event = ControlDirectionAppliedEvent.make({
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      subject: { _tag: "Run", runId: run.runId },
      version: workflowJournalEventVersion
    })
    const withDirection = yield* projectRecordedCassette(insertBeforeRunTermination(run.records, event))
    expect(renderRecordedCassetteLyrics(withDirection)).toContain("Operator applied Pause to the Run.")
    expect(foldRecordedCassette(withDirection)._tag).toBe("ValidWorkflowJournalHistory")
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

const replayIntegrationFinalityCassette = (
  cassette: (typeof maintainedIntegrationFinalityProtocolCassetteCatalog)[keyof typeof maintainedIntegrationFinalityProtocolCassetteCatalog]
) =>
  Effect.gen(function* () {
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const first = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(cassette, promoted.records)
    const second = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(cassette, promoted.records)
    expect(second).toEqual(first)
    return first
  })

it("rejects unclosed, unbounded, and misordered integration-finality protocol stories", () => {
  const valid =
    maintainedIntegrationFinalityProtocolCassetteCatalog.replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim
  const terminal = valid.story.find(({ _tag }) => _tag === "AwaitSettlement")
  if (terminal?._tag !== "AwaitSettlement") return expect.fail("maintained cassette must declare terminal evidence")
  expect(Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, story: [] })).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, story: [...valid.story, { _tag: "RunReplacement" }] })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...valid,
      boundaryResults: [
        { _tag: "ReplacementUnknown" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReplacementUnknown" }
      ]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, boundaryResults: [{ _tag: "ReadActiveClaim" }] })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFreshTrackerSuccess,
      boundaryResults: [{ _tag: "ReadCompletionClaim" }, { _tag: "ReadCompletionClaim" }]
    })
  ).toBe(false)
  const deletion =
    maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFreshTrackerSuccess
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      story: deletion.story.filter(({ _tag }) => _tag !== "RecordFreshSuccess")
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      boundaryResults: [{ _tag: "ReadCompletionClaim" }, { _tag: "DeletionApplied" }],
      story: [{ _tag: "RecordFreshSuccess" }, { _tag: "RunDeletion" }, terminal]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, boundaryResults: [...valid.boundaryResults].reverse() })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...valid,
      boundaryResults: [...valid.boundaryResults, { _tag: "ReadCompletionClaim" }]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...valid,
      boundaryResults: [{ _tag: "ReadActiveClaim" }, { _tag: "ReplacementUnknown" }]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      story: [
        { _tag: "RunReplacement" },
        { _tag: "RecordFreshSuccess" },
        { _tag: "RecordFreshSuccess" },
        { _tag: "RunDeletion" },
        terminal
      ]
    })
  ).toBe(false)
})

it.effect("rejects promoted finality replay without each exact causal premise", () =>
  Effect.gen(function* () {
    const cassette =
      maintainedIntegrationFinalityProtocolCassetteCatalog.replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    for (const omittedTag of [
      "TargetPromotionObservedSuccess",
      "TaskAttemptPlanned",
      "TaskClaimAcquired",
      "TaskTrackerFactsObserved"
    ] as const) {
      const exit = yield* Effect.exit(
        runIntegrationFinalityProtocolCassetteFromPromotedRecords(
          cassette,
          promoted.records.filter(({ event }) => event._tag !== omittedTag)
        )
      )
      expect(exit._tag).toBe("Failure")
    }
  })
)

it.effect("keeps an empty frontier active while claim replacement is non-convergent", () =>
  Effect.gen(function* () {
    const expected = {
      deletionCalls: 0,
      failureTag: "IntegrationFinality.CompletionClaimDidNotConverge",
      journalTags: [
        "CompletionClaimReplacementIntended",
        "CompletionClaimReplacementAttemptIntended",
        "CompletionClaimReplacementAttemptIntended",
        "CompletionClaimReplacementAttemptIntended"
      ],
      readCalls: 4,
      replacementCalls: 3
    }
    const cassette = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" }
      ],
      initialClaim: "Active",
      name: "replacement remains pending at an empty frontier",
      story: [{ _tag: "RunReplacement" }, { _tag: "ObserveEmptyFrontier" }, { _tag: "AwaitSettlement", expected }]
    })
    const run = yield* runIntegrationFinalityProtocolCassette(cassette)
    expect(run.sawEmptyFrontierWhilePending).toBe(true)
  })
)

it.effect("replays definite completion-claim boundary rejections as terminal typed failures", () =>
  Effect.gen(function* () {
    const replacement = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementDefinitelyNotApplied", detail: "tracker rejected replacement" }
      ],
      initialClaim: "Active",
      name: "definite replacement rejection",
      story: [
        { _tag: "RunReplacement" },
        {
          _tag: "AwaitSettlement",
          expected: {
            deletionCalls: 0,
            failureTag: "IntegrationFinality.CompletionClaimReplacementFailure",
            journalTags: ["CompletionClaimReplacementIntended", "CompletionClaimReplacementAttemptIntended"],
            readCalls: 1,
            replacementCalls: 1
          }
        }
      ]
    })
    const deletion = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadCompletionClaim" },
        { _tag: "ReadCompletionClaim" },
        { _tag: "DeletionDefinitelyNotApplied", detail: "tracker rejected deletion" }
      ],
      initialClaim: "Completion",
      name: "definite deletion rejection",
      story: [
        { _tag: "RunReplacement" },
        { _tag: "RecordFreshSuccess" },
        { _tag: "RunDeletion" },
        {
          _tag: "AwaitSettlement",
          expected: {
            deletionCalls: 1,
            failureTag: "IntegrationFinality.CompletionClaimDeletionFailure",
            journalTags: [
              "CompletionClaimReplacementIntended",
              "CompletionClaimReplaced",
              "TaskTrackerReadIntentRecorded",
              "TaskTrackerFactsObserved",
              "CompletionClaimDeletionIntended",
              "CompletionClaimDeletionAttemptIntended"
            ],
            readCalls: 2,
            replacementCalls: 0
          }
        }
      ]
    })
    const ambiguousReplacement = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" }
      ],
      initialClaim: "Active",
      name: "ambiguous replacement exhaustion",
      story: [
        { _tag: "RunReplacement" },
        {
          _tag: "AwaitSettlement",
          expected: {
            deletionCalls: 0,
            failureTag: "IntegrationFinality.CompletionClaimDidNotConverge",
            journalTags: [
              "CompletionClaimReplacementIntended",
              "CompletionClaimReplacementAttemptIntended",
              "CompletionClaimReplacementAttemptIntended",
              "CompletionClaimReplacementAttemptIntended"
            ],
            readCalls: 4,
            replacementCalls: 3
          }
        }
      ]
    })
    expect((yield* runIntegrationFinalityProtocolCassette(replacement)).failureTag).toBe(
      "IntegrationFinality.CompletionClaimReplacementFailure"
    )
    expect((yield* runIntegrationFinalityProtocolCassette(deletion)).failureTag).toBe(
      "IntegrationFinality.CompletionClaimDeletionFailure"
    )
    expect((yield* runIntegrationFinalityProtocolCassette(ambiguousReplacement)).failureTag).toBe(
      "IntegrationFinality.CompletionClaimDidNotConverge"
    )
  })
)

it.effect("replaces the exact active claim with a promotion-bound completion claim", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim
    )
    expect(run.replacementCalls).toBe(1)
    expect(run.deletionCalls).toBe(0)
    expect(run.journalTags.slice(-3)).toEqual([
      "CompletionClaimReplacementIntended",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplaced"
    ])
  })
)

it.effect("restart after promotion resumes completion settlement without another integration agent", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.restartAfterPromotionResumesCompletionSettlementWithoutAnotherIntegrationAgent
    )
    expect(run.replacementCalls).toBe(0)
    expect(run.journalTags).toContain("CompletionClaimReplaced")
    const promotionAt = run.journalTags.lastIndexOf("TargetPromotionObservedSuccess")
    expect(promotionAt).toBeGreaterThan(0)
    expect(run.journalTags.slice(promotionAt + 1)).not.toContain("IntegrationCandidateAgentReported")
  })
)

it.effect("reconciles a lost completion-claim replacement without allocating another claim", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.reconcilesALostCompletionClaimReplacementWithoutAllocatingAnotherClaim
    )
    expect(run.replacementCalls).toBe(1)
    expect(run.journalTags.filter((tag) => tag === "CompletionClaimReplacementIntended")).toHaveLength(1)
    expect(run.journalTags.filter((tag) => tag === "CompletionClaimReplaced")).toHaveLength(1)
  })
)

it.effect("does not mutate a foreign claim while settling a promoted task", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.doesNotMutateAForeignClaimWhileSettlingAPromotedTask
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimOwnershipConflict")
    expect(run.replacementCalls).toBe(0)
    expect(run.deletionCalls).toBe(0)
    expect(run.journalTags).not.toContain("CompletionClaimReplacementAttemptIntended")
  })
)

it.effect("deletes only the exact completion claim after fresh tracker success", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFreshTrackerSuccess
    )
    const replaced = run.records.find(({ event }) => event._tag === "CompletionClaimReplaced")?.event
    const deleted = run.records.find(({ event }) => event._tag === "CompletionClaimDeleted")?.event
    if (replaced?._tag !== "CompletionClaimReplaced" || deleted?._tag !== "CompletionClaimDeleted") {
      return yield* Effect.die("expected exact replacement and deletion outcomes")
    }
    expect(deleted.claim).toEqual(replaced.claim)
    expect(run.deletionCalls).toBe(1)
    expect(run.journalTags).toContain("IntegrationFinalitySettled")
  })
)

it.effect("reconciles a lost completion-claim deletion without reopening success", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess
    )
    expect(run.deletionCalls).toBe(1)
    expect(run.journalTags).toContain("CompletionClaimDeleted")
    expect(run.journalTags).toContain("IntegrationFinalitySettled")
    expect(run.journalTags.filter((tag) => tag === "CompletionClaimReplacementIntended")).toHaveLength(1)
  })
)

it.effect("waits without replacing when the current completion claim cannot be read", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.waitsWithoutReplacingWhenTheCurrentCompletionClaimCannotBeRead
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimReadFailure")
    expect(run.replacementCalls).toBe(0)
    expect(run.deletionCalls).toBe(0)
    expect(run.boundaryCalls).toEqual(["readTaskClaim"])
  })
)

it.effect("keeps successful work final when the completion claim cannot be read before deletion", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.keepsSuccessfulWorkFinalWhenTheCompletionClaimCannotBeReadBeforeDeletion
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimReadFailure")
    expect(run.replacementCalls).toBe(0)
    expect(run.deletionCalls).toBe(0)
    expect(run.journalTags).toContain("TaskTrackerFactsObserved")
    expect(run.journalTags).not.toContain("CompletionClaimDeleted")
  })
)

it.effect("keeps successful work final when completion-claim deletion cannot converge", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.keepsSuccessfulWorkFinalWhenCompletionClaimDeletionCannotConverge
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimDidNotConverge")
    expect(run.deletionCalls).toBe(3)
    expect(run.journalTags).toContain("TaskTrackerFactsObserved")
    expect(run.journalTags).not.toContain("CompletionClaimDeleted")
    expect(run.journalTags).not.toContain("IntegrationFinalitySettled")
  })
)

it.effect("does not terminate an empty frontier while completion settlement is pending", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.doesNotTerminateAnEmptyFrontierWhileCompletionSettlementIsPending
    )
    expect(run.sawEmptyFrontierWhilePending).toBe(true)
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimDidNotConverge")
    expect(run.journalTags).not.toContain("WorkflowRunTerminated")
  })
)
