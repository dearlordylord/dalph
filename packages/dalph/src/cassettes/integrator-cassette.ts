/* eslint-disable max-lines -- The maintained cassette keeps its canonical accepted bootstrap beside the protocol replay it owns. */
import { PlannedAttemptExecutorReport } from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitReadIntentRecordedEvent,
  InitialControlPolicy,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  InRunJournal,
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  IntegratorGitObservation,
  IntegratorGitReadFailure,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorResult,
  JournalPosition,
  JournalRecord,
  JournalStore,
  OperationId,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedWorktreeReady,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisition,
  TaskClaimAcquisitionIntendedEvent,
  TaskLifecycle,
  TaskWorkCapacity,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TargetLineageObservedEvent,
  TrackerRevision,
  WorkflowActor,
  WorkflowRunBeganEvent,
  deriveIntegratorRunState,
  describeJournalEvent,
  integratorCorrelationFor,
  journalLayer,
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeTargetLineageObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  prepareIntegrationCandidateRun,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  workflowJournalEventVersion,
  type IntegratorCandidateText,
  type IntegratorRequest
} from "@dalph/orchestrator"
import {
  AuthoredIntegratorCassette,
  IntegratorCassetteRun,
  IntegratorCassetteTerminalExpectation,
  RecordedIntegratorOutcome,
  integratorPreparationInputFor,
  maintainedIntegratorTaskSpecification,
  recordedIntegratorCassetteFor,
  type AuthoredIntegratorGitResult,
  type AuthoredIntegratorResult,
  type AuthoredIntegratorStoryItem,
  type AuthoredIntegratorStartingFacts,
  type IntegratorCassetteInput,
  type IntegratorCassettePublicResult,
  type IntegratorCassetteRequest,
  type IntegratorCassetteRun as IntegratorCassetteRunType,
  type RecordedIntegratorCassette
} from "./integrator-cassette-domain.js"
export * from "./integrator-cassette-domain.js"
export * from "./integrator-cassette-stories.js"

interface IntegratorCassetteRuntime {
  readonly cassette: AuthoredIntegratorCassette
  readonly gitCandidates: Ref.Ref<ReadonlyArray<IntegratorCandidateText>>
  readonly gitResults: Ref.Ref<ReadonlyArray<AuthoredIntegratorGitResult>>
  readonly gitCalls: Ref.Ref<number>
  readonly integratorCalls: Ref.Ref<ReadonlyArray<IntegratorRequest>>
  readonly integratorResults: Ref.Ref<ReadonlyArray<AuthoredIntegratorResult>>
  readonly input: IntegratorCassetteInput
}

const acceptedExecutorReportOrdinal = 2
const cassetteTarget = FixtureTarget.make("integrator-maintained-target")

const appendRecord = (
  records: ReadonlyArray<JournalRecord>,
  runId: IntegratorCassetteInput["responsibility"]["plannedAttempt"]["runId"],
  event: JournalRecord["event"]
) => {
  const record = JournalRecord.make({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(records.length + 1),
    runId
  })
  return { record, records: [...records, record] }
}

/** Builds the actual accepted attempt chronology that owns the cassette's integration responsibility. */
const acceptedSetupFor = (cassette: AuthoredIntegratorCassette) => {
  const authored = cassette.startingFacts
  const { acceptedResult, integrationTarget, plannedAttempt } = authored.responsibility
  const runId = plannedAttempt.runId
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make(`integrator-cassette-claim:${plannedAttempt.attemptId}`),
    owner: ClaimOwner.make("integrator-cassette-coordinator"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make(`integrator-cassette-token:${plannedAttempt.attemptId}`)
  })
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make(claim),
    predecessorOperationIds: []
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make(`${claim.operationId}:graph`),
    cassetteTarget,
    [claim.operationId],
    [plannedAttempt.taskId]
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make(`${claim.operationId}:specification`),
    cassetteTarget,
    plannedAttempt.taskId,
    [graphOperation.operationId]
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`${claim.operationId}:plan`),
    plannedAttempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make(`${claim.operationId}:worktree`),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const graph = Option.getOrThrow(
    Option.fromUndefinedOr(
      (() => {
        const projection = projectTrackerSnapshot({
          revision: TrackerRevision.make("integrator-maintained-graph"),
          tasks: [
            {
              id: plannedAttempt.taskId,
              lifecycle: TaskLifecycle.cases.Open.make({}),
              parentTaskId: null,
              prerequisiteIds: []
            }
          ]
        })
        return projection._tag === "Valid" ? projection.snapshot : undefined
      })()
    )
  )
  const targetLineageOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make(`${claim.operationId}:target-lineage`),
    plannedAttempt,
    predecessorOperationIds: [worktreeOperation.operationId]
  })
  const runBegan = WorkflowRunBeganEvent.make({
    initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    target: cassetteTarget,
    version: workflowJournalEventVersion
  })
  let records: ReadonlyArray<JournalRecord> = [
    JournalRecord.make({
      event: runBegan,
      key: describeJournalEvent(runBegan).expectedKey,
      position: JournalPosition.make(1),
      runId
    })
  ]
  const append = (event: JournalRecord["event"]) => {
    const next = appendRecord(records, runId, event)
    records = next.records
    return next.record
  }
  const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId }
  })
  const acceptedReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    result: { _tag: "Accepted", acceptedResult }
  })
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)

  return {
    append,
    authored,
    commandOrdinal,
    graph,
    graphOperation,
    acceptedReport,
    claim,
    claimOperation,
    executingReport,
    integrationTarget,
    planOperation,
    plannedAttempt,
    records: () => records,
    specificationOperation,
    targetLineageOperation,
    worktreeOperation
  }
}

const materializeAcceptedSetup = (cassette: AuthoredIntegratorCassette) => {
  const setup = acceptedSetupFor(cassette)
  const {
    acceptedReport,
    append,
    authored,
    claim,
    claimOperation,
    commandOrdinal,
    executingReport,
    graph,
    graphOperation,
    integrationTarget,
    plannedAttempt,
    planOperation,
    specificationOperation,
    targetLineageOperation,
    worktreeOperation
  } = setup
  append(TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }))
  append(TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }))
  append(taskTrackerReadIntent(graphOperation))
  append(
    taskTrackerFactsObservedEvent(
      graphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(graphOperation, graph)
    )
  )
  append(taskTrackerReadIntent(specificationOperation))
  append(
    taskTrackerFactsObservedEvent(
      specificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, maintainedIntegratorTaskSpecification)
    )
  )
  append(TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }))
  append(
    TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: workflowJournalEventVersion })
  )
  append(
    TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  append(
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report: executingReport,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: executingReport,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: acceptedReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(acceptedExecutorReportOrdinal),
      report: acceptedReport,
      version: workflowJournalEventVersion
    })
  )
  const queued = append(
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: authored.responsibility.acceptedResult,
      integrationTarget,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const started = append(
    IntegrationStartedEvent.make({
      acceptedResult: authored.responsibility.acceptedResult,
      integrationTarget,
      plannedAttempt,
      responsibilityBeganAt: queued.position,
      version: workflowJournalEventVersion
    })
  )
  append(
    GitReadIntentRecordedEvent.make({
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operation: targetLineageOperation,
      version: workflowJournalEventVersion
    })
  )
  const lineage = append(
    TargetLineageObservedEvent.make({
      observation: authored.targetLineage,
      occurrenceClassification: "NonActionOccurrence",
      operationId: targetLineageOperation.operationId,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  return {
    records: setup.records(),
    startingFacts: {
      responsibility: { ...authored.responsibility, queuedAt: queued.position, startedAt: started.position },
      targetLineage: authored.targetLineage,
      targetLineageObservedAt: lineage.position
    },
    target: cassetteTarget
  }
}

const takeScripted = <A>(script: Ref.Ref<ReadonlyArray<A>>, label: string): Effect.Effect<A> =>
  Effect.gen(function* () {
    const next = yield* Ref.modify(script, (remaining) => [remaining[0], remaining.slice(1)] as const)
    if (next === undefined) return yield* Effect.die(`maintained Integrator cassette exhausted ${label} results`)
    return next
  })

const makeRuntime = Effect.fn("IntegratorCassette.makeRuntime")(function* (
  cassette: AuthoredIntegratorCassette,
  startingFacts: AuthoredIntegratorStartingFacts
) {
  return {
    cassette,
    gitCandidates: yield* Ref.make<ReadonlyArray<IntegratorCandidateText>>([]),
    gitResults: yield* Ref.make(cassette.gitResults),
    gitCalls: yield* Ref.make(0),
    integratorCalls: yield* Ref.make<ReadonlyArray<IntegratorRequest>>([]),
    integratorResults: yield* Ref.make(cassette.integratorResults),
    input: integratorPreparationInputFor(startingFacts)
  } satisfies IntegratorCassetteRuntime
})

const integratorCassetteJournalLayer = (setup: ReturnType<typeof materializeAcceptedSetup>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const storage = yield* JournalStore
      const began = setup.records[0]
      if (began?.event._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("maintained Integrator cassette accepted setup lacks its Run beginning")
      }
      yield* storage.beginRun(began.runId, began.event.target, began.event.initialControlPolicy)
      for (const record of setup.records.slice(1)) {
        if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
          return yield* Effect.die("maintained Integrator cassette setup contains an unexpected lifecycle record")
        }
        yield* storage.append(record.runId, record.key, record.event)
      }
      const initial = reduceWorkflowJournalHistory(began.runId, yield* storage.read(began.runId))
      if (initial._tag === "InvalidWorkflowJournalHistory") {
        return yield* Effect.die(
          `maintained Integrator cassette accepted setup is invalid: ${JSON.stringify(initial.issues)}`
        )
      }
      return journalLayer(began.runId, setup.target, initial, storage)
    })
  ).pipe(Layer.provideMerge(memoryJournalStoreLayer))

const integratorServiceFor = (runtime: IntegratorCassetteRuntime): Integrator["Service"] => ({
  prepare: (request) =>
    Effect.gen(function* () {
      yield* Ref.update(runtime.integratorCalls, (calls) => [...calls, request])
      const scripted = yield* takeScripted(runtime.integratorResults, "outer Integrator")
      if (scripted._tag === "ProcessLost") {
        return yield* new IntegratorCallFailure({ correlation: request.correlation, detail: scripted.detail })
      }
      if (scripted._tag === "NotPrepared") {
        return IntegratorResult.cases.NotPrepared.make({ correlation: request.correlation, detail: scripted.detail })
      }
      return IntegratorResult.cases.PreparedCandidate.make({
        candidateText: scripted.candidateText,
        correlation: request.correlation
      })
    })
})

const gitServiceFor = (runtime: IntegratorCassetteRuntime): IntegratorGit["Service"] => ({
  readCandidate: (target, candidateText) =>
    Effect.gen(function* () {
      yield* Ref.update(runtime.gitCalls, (calls) => calls + 1)
      yield* Ref.update(runtime.gitCandidates, (candidates) => [...candidates, candidateText])
      const scripted = yield* takeScripted(runtime.gitResults, "candidate Git")
      if (scripted._tag === "ReadLost") {
        return yield* new IntegratorGitReadFailure({ candidateText, detail: scripted.detail, target })
      }
      if (scripted._tag === "Missing") {
        return IntegratorGitObservation.cases.Missing.make({ candidateText: scripted.candidateText })
      }
      if (scripted._tag === "NonCommit") {
        return IntegratorGitObservation.cases.NonCommit.make({
          candidateText: scripted.candidateText,
          objectType: scripted.objectType
        })
      }
      return IntegratorGitObservation.cases.Commit.make({
        candidateText: scripted.candidateText,
        commit: scripted.commit,
        directParents: scripted.directParents
      })
    })
})

const outcomeFor = (result: IntegratorCassettePublicResult): RecordedIntegratorOutcome => {
  if (result._tag === "PreparedCandidate") {
    return RecordedIntegratorOutcome.cases.PreparedCandidate.make({
      candidateCommit: result.candidateCommit,
      candidateText: result.candidateText,
      directParents: result.observation.directParents
    })
  }
  if (result._tag === "NotPrepared") {
    return RecordedIntegratorOutcome.cases.NotPrepared.make({ detail: result.detail })
  }
  return RecordedIntegratorOutcome.cases.CandidateRejected.make({
    candidateText: result.candidateText,
    observation: result.observation
  })
}

const initialRunFor = (input: IntegratorCassetteInput): IntegratorRunCorrelation =>
  IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: integratorCorrelationFor(input) })

const currentStateFor = (records: ReadonlyArray<JournalRecord>, input: IntegratorCassetteInput) =>
  deriveIntegratorRunState(records, input.responsibility, initialRunFor(input))

const runOne = Effect.fn("IntegratorCassette.runOne")(function* (runtime: IntegratorCassetteRuntime) {
  const result = yield* prepareIntegrationCandidateRun({
    preparation: runtime.input,
    run: initialRunFor(runtime.input)
  }).pipe(
    Effect.result,
    Effect.provideService(Integrator, Integrator.of(integratorServiceFor(runtime))),
    Effect.provideService(IntegratorGit, IntegratorGit.of(gitServiceFor(runtime)))
  )
  return result._tag === "Failure"
    ? RecordedIntegratorOutcome.cases.Failure.make({ tag: result.failure._tag })
    : outcomeFor(result.success)
})

const terminalObservationFor = Effect.fn("IntegratorCassette.terminalObservationFor")(function* (
  runtime: IntegratorCassetteRuntime,
  outcomes: ReadonlyArray<RecordedIntegratorOutcome>,
  expected: IntegratorCassetteTerminalExpectation
) {
  const records = yield* (yield* InRunJournal).read(runtime.input.responsibility.plannedAttempt.runId)
  const recorded = recordedIntegratorCassetteFor(runtime.cassette.name, records)
  const focusedRecords = records.slice(
    records.findIndex(({ event }) => event._tag === "IntegrationResponsibilityBegan")
  )
  const requests = yield* Ref.get(runtime.integratorCalls)
  const sessionIds = requests.map(({ correlation }) => correlation.session.sessionId)
  const candidateResources = requests.map(({ correlation }) => correlation.session.candidateResource)
  const actual = IntegratorCassetteTerminalExpectation.make({
    candidateResourcePrefixes: candidateResources.map((resource) => resource.slice(0, "integrator-resource:".length)),
    gitCandidates: yield* Ref.get(runtime.gitCandidates),
    gitCalls: yield* Ref.get(runtime.gitCalls),
    integratorCalls: requests.length,
    journalTags: focusedRecords.map(({ event }) => event._tag),
    outcomes,
    recordedTags: recorded.entries.map(({ _tag }) => _tag),
    sessionIdPrefixes: sessionIds.map((session) => session.slice(0, "integrator-session:".length)),
    stateTag: currentStateFor(records, runtime.input)._tag
  })
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return yield* Effect.die(
      `maintained Integrator cassette ${runtime.cassette.name} terminal mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    )
  }
  return { actual, recorded, records: focusedRecords }
})

const interpretStoryItem = Effect.fn("IntegratorCassette.interpretStoryItem")(function* (
  runtime: IntegratorCassetteRuntime,
  outcomes: Ref.Ref<ReadonlyArray<RecordedIntegratorOutcome>>,
  item: AuthoredIntegratorStoryItem
) {
  if (item._tag === "Assert") {
    return yield* terminalObservationFor(runtime, yield* Ref.get(outcomes), item.expected)
  }
  const outcome = yield* runOne(runtime)
  yield* Ref.update(outcomes, (current) => [...current, outcome])
  return undefined
})

/** Replays a maintained authored story through the real outer Integrator protocol and its durable journal. */
const runMaintainedIntegratorCassetteInJournal = Effect.fn("IntegratorCassette.runMaintainedInJournal")(function* (
  cassette: AuthoredIntegratorCassette,
  startingFacts: AuthoredIntegratorStartingFacts
) {
  const replayedCassette = AuthoredIntegratorCassette.make({ ...cassette, startingFacts })
  const runtime = yield* makeRuntime(replayedCassette, startingFacts)
  const outcomes = yield* Ref.make<ReadonlyArray<RecordedIntegratorOutcome>>([])
  let terminal:
    | { readonly recorded: RecordedIntegratorCassette; readonly records: ReadonlyArray<JournalRecord> }
    | undefined
  for (const item of cassette.story) {
    const observed = yield* interpretStoryItem(runtime, outcomes, item)
    if (observed !== undefined) terminal = observed
  }
  if (terminal === undefined) return yield* Effect.die("maintained Integrator cassette has no terminal assertion")
  const records = terminal.records
  const recorded = terminal.recorded
  const requests = yield* Ref.get(runtime.integratorCalls)
  return IntegratorCassetteRun.make({
    cassette: replayedCassette,
    candidateResources: requests.map(({ correlation }) => correlation.session.candidateResource),
    gitCandidates: yield* Ref.get(runtime.gitCandidates),
    gitCalls: yield* Ref.get(runtime.gitCalls),
    integratorCalls: requests.length,
    journalTags: records.map(({ event }) => event._tag),
    outcomes: yield* Ref.get(outcomes),
    records,
    recorded,
    sessionIds: requests.map(({ correlation }) => correlation.session.sessionId),
    state: currentStateFor(records, integratorPreparationInputFor(startingFacts))
  })
})

export const runMaintainedIntegratorCassette = Effect.fn("IntegratorCassette.runMaintained")(function* (
  cassette: AuthoredIntegratorCassette
) {
  const setup = materializeAcceptedSetup(cassette)
  return yield* runMaintainedIntegratorCassetteInJournal(cassette, setup.startingFacts).pipe(
    Effect.provide(integratorCassetteJournalLayer(setup))
  )
})

/** Short alias used by maintained-cassette tests and future catalog tooling. */
export const runIntegratorCassette = runMaintainedIntegratorCassette

export type MaintainedIntegratorCassetteRun = IntegratorCassetteRunType
export type MaintainedIntegratorCassetteInput = IntegratorCassetteInput
export type MaintainedIntegratorCassetteRequest = IntegratorCassetteRequest
