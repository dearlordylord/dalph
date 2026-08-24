import { Effect, Ref } from "effect"
import {
  GitReadIntentRecordedEvent,
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
  OperationId,
  TargetLineageObservedEvent,
  WorkflowActor,
  deriveIntegratorRunState,
  describeJournalEvent,
  integratorCorrelationFor,
  makeTargetLineageObservationOperation,
  prepareIntegrationCandidateRun,
  workflowJournalEventVersion,
  type IntegratorCandidateText,
  type IntegratorRequest,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import {
  IntegratorCassetteRun,
  IntegratorCassetteTerminalExpectation,
  RecordedIntegratorOutcome,
  integratorPreparationInputFor,
  recordedIntegratorCassetteFor,
  type AuthoredIntegratorCassette,
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

const initialLineageIntentPosition = 3

type AppendableWorkflowJournalEvent = Exclude<
  WorkflowJournalEvent,
  { readonly _tag: "WorkflowRunBegan" | "WorkflowRunTerminated" }
>

interface IntegratorCassetteJournal {
  readonly records: Ref.Ref<ReadonlyArray<JournalRecord>>
  readonly service: InRunJournal["Service"]
}

interface IntegratorCassetteRuntime {
  readonly cassette: AuthoredIntegratorCassette
  readonly gitCandidates: Ref.Ref<ReadonlyArray<IntegratorCandidateText>>
  readonly gitResults: Ref.Ref<ReadonlyArray<AuthoredIntegratorGitResult>>
  readonly gitCalls: Ref.Ref<number>
  readonly integratorCalls: Ref.Ref<ReadonlyArray<IntegratorRequest>>
  readonly integratorResults: Ref.Ref<ReadonlyArray<AuthoredIntegratorResult>>
  readonly journal: IntegratorCassetteJournal
  readonly input: IntegratorCassetteInput
}

const journalRecordFor = (
  runId: IntegratorCassetteInput["responsibility"]["plannedAttempt"]["runId"],
  position: number,
  event: AppendableWorkflowJournalEvent
): JournalRecord =>
  JournalRecord.make({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId
  })

const initialRecordsFor = (startingFacts: AuthoredIntegratorStartingFacts): ReadonlyArray<JournalRecord> => {
  const { responsibility, targetLineage, targetLineageObservedAt } = startingFacts
  const began = IntegrationResponsibilityBeganEvent.make({
    acceptedResult: responsibility.acceptedResult,
    integrationTarget: responsibility.integrationTarget,
    plannedAttempt: responsibility.plannedAttempt,
    version: workflowJournalEventVersion
  })
  const started = IntegrationStartedEvent.make({
    acceptedResult: responsibility.acceptedResult,
    integrationTarget: responsibility.integrationTarget,
    plannedAttempt: responsibility.plannedAttempt,
    responsibilityBeganAt: responsibility.queuedAt,
    version: workflowJournalEventVersion
  })
  const lineageOperationId = OperationId.make(`integrator-cassette-lineage:${responsibility.plannedAttempt.attemptId}`)
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: responsibility.integrationTarget,
    operationId: lineageOperationId,
    plannedAttempt: responsibility.plannedAttempt,
    predecessorOperationIds: []
  })
  const lineageIntent = GitReadIntentRecordedEvent.make({
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    operation: lineageOperation,
    version: workflowJournalEventVersion
  })
  const lineage = TargetLineageObservedEvent.make({
    observation: targetLineage,
    occurrenceClassification: "NonActionOccurrence",
    operationId: lineageOperationId,
    plannedAttempt: responsibility.plannedAttempt,
    version: workflowJournalEventVersion
  })
  return [
    journalRecordFor(responsibility.plannedAttempt.runId, responsibility.queuedAt, began),
    journalRecordFor(responsibility.plannedAttempt.runId, responsibility.startedAt, started),
    journalRecordFor(responsibility.plannedAttempt.runId, initialLineageIntentPosition, lineageIntent),
    journalRecordFor(responsibility.plannedAttempt.runId, targetLineageObservedAt, lineage)
  ]
}

const makeJournal = Effect.fn("IntegratorCassette.makeJournal")(function* (
  initialRecords: ReadonlyArray<JournalRecord>
) {
  const records = yield* Ref.make(initialRecords)
  const service = InRunJournal.of({
    append: (runId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((record) => record.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current] as const
        const largestPosition = current.reduce((largest, record) => Math.max(largest, record.position), 0)
        const appended = JournalRecord.make({ event, key, position: JournalPosition.make(largestPosition + 1), runId })
        return [Effect.succeed(appended), [...current, appended]] as const
      }).pipe(Effect.flatten),
    read: (runId) => Ref.get(records).pipe(Effect.map((current) => current.filter((record) => record.runId === runId)))
  })
  return { records, service } satisfies IntegratorCassetteJournal
})

const takeScripted = <A>(script: Ref.Ref<ReadonlyArray<A>>, label: string): Effect.Effect<A> =>
  Effect.gen(function* () {
    const next = yield* Ref.modify(script, (remaining) => [remaining[0], remaining.slice(1)] as const)
    if (next === undefined) return yield* Effect.die(`maintained Integrator cassette exhausted ${label} results`)
    return next
  })

const makeRuntime = Effect.fn("IntegratorCassette.makeRuntime")(function* (cassette: AuthoredIntegratorCassette) {
  return {
    cassette,
    gitCandidates: yield* Ref.make<ReadonlyArray<IntegratorCandidateText>>([]),
    gitResults: yield* Ref.make(cassette.gitResults),
    gitCalls: yield* Ref.make(0),
    integratorCalls: yield* Ref.make<ReadonlyArray<IntegratorRequest>>([]),
    integratorResults: yield* Ref.make(cassette.integratorResults),
    journal: yield* makeJournal(initialRecordsFor(cassette.startingFacts)),
    input: integratorPreparationInputFor(cassette.startingFacts)
  } satisfies Omit<IntegratorCassetteRuntime, "journal" | "input"> & {
    readonly journal: IntegratorCassetteJournal
    readonly input: IntegratorCassetteInput
  }
})

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
    Effect.provideService(InRunJournal, runtime.journal.service),
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
  const records = yield* Ref.get(runtime.journal.records)
  const recorded = recordedIntegratorCassetteFor(runtime.cassette.name, records)
  const requests = yield* Ref.get(runtime.integratorCalls)
  const sessionIds = requests.map(({ correlation }) => correlation.session.sessionId)
  const candidateResources = requests.map(({ correlation }) => correlation.session.candidateResource)
  const actual = IntegratorCassetteTerminalExpectation.make({
    candidateResourcePrefixes: candidateResources.map((resource) => resource.slice(0, "integrator-resource:".length)),
    gitCandidates: yield* Ref.get(runtime.gitCandidates),
    gitCalls: yield* Ref.get(runtime.gitCalls),
    integratorCalls: requests.length,
    journalTags: records.map(({ event }) => event._tag),
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
  return { actual, recorded, records }
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
export const runMaintainedIntegratorCassette = Effect.fn("IntegratorCassette.runMaintained")(function* (
  cassette: AuthoredIntegratorCassette
) {
  const runtime = yield* makeRuntime(cassette)
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
    cassette,
    candidateResources: requests.map(({ correlation }) => correlation.session.candidateResource),
    gitCandidates: yield* Ref.get(runtime.gitCandidates),
    gitCalls: yield* Ref.get(runtime.gitCalls),
    integratorCalls: requests.length,
    journalTags: records.map(({ event }) => event._tag),
    outcomes: yield* Ref.get(outcomes),
    records,
    recorded,
    sessionIds: requests.map(({ correlation }) => correlation.session.sessionId),
    state: currentStateFor(records, integratorPreparationInputFor(cassette.startingFacts))
  })
})

/** Short alias used by maintained-cassette tests and future catalog tooling. */
export const runIntegratorCassette = runMaintainedIntegratorCassette

export type MaintainedIntegratorCassetteRun = IntegratorCassetteRunType
export type MaintainedIntegratorCassetteInput = IntegratorCassetteInput
export type MaintainedIntegratorCassetteRequest = IntegratorCassetteRequest
