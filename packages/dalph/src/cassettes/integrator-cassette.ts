import { Context, Effect, Layer, Ref } from "effect"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  IntegratorGitObservation,
  IntegratorGitReadFailure,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorResult,
  Journal,
  deriveIntegratorRunState,
  integratorCorrelationFor,
  liveJournalTestLayer,
  prepareIntegrationCandidateRun,
  type IntegratorCandidateText,
  type IntegratorRequest,
  type AcceptedJournalReader,
  type InRunJournal,
  type JournalRecord,
  type TrackerTarget
} from "@dalph/orchestrator"
import {
  IntegratorCassetteRun,
  IntegratorCassetteTerminalExpectation,
  RecordedIntegratorOutcome,
  recordedIntegratorCassetteFor,
  type AuthoredIntegratorCassette,
  type AuthoredIntegratorGitResult,
  type AuthoredIntegratorResult,
  type AuthoredIntegratorStoryItem,
  type IntegratorCassetteInput,
  type IntegratorCassettePublicResult,
  type IntegratorCassetteRequest,
  type IntegratorCassetteRun as IntegratorCassetteRunType,
  type RecordedIntegratorCassette
} from "./integrator-cassette-domain.js"
import { coherentHistoryFor, type CoherentIntegratorHistory } from "./integrator-cassette-history.js"
export * from "./integrator-cassette-domain.js"
export * from "./integrator-cassette-stories.js"

interface IntegratorCassetteJournal {
  readonly context: Context.Context<AcceptedJournalReader | Journal | InRunJournal>
  readonly journal: Journal["Service"]
  readonly outputRecords: (records: ReadonlyArray<JournalRecord>) => ReadonlyArray<JournalRecord>
  readonly target: TrackerTarget
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

const outputRecordsFor = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<JournalRecord> =>
  records.filter(({ event }) =>
    [
      "GitReadIntentRecorded",
      "IntegrationResponsibilityBegan",
      "IntegrationStarted",
      "TargetLineageObserved",
      "IntegratorSessionFixed",
      "IntegratorRunStarted",
      "IntegratorRunResultRecorded",
      "IntegratorRunCandidateGitReadIntended",
      "IntegratorRunCandidateGitObserved"
    ].includes(event._tag)
  )

const makeJournal = Effect.fn("IntegratorCassette.makeJournal")(function* (history: CoherentIntegratorHistory) {
  const context = yield* Layer.build(
    liveJournalTestLayer({
      records: history.records,
      runId: history.input.responsibility.plannedAttempt.runId,
      target: history.target
    })
  )
  const journal = Context.get(context, Journal)
  return {
    context,
    journal,
    outputRecords: outputRecordsFor,
    target: history.target
  } satisfies IntegratorCassetteJournal
})

const takeScripted = <A>(script: Ref.Ref<ReadonlyArray<A>>, label: string): Effect.Effect<A> =>
  Effect.gen(function* () {
    const next = yield* Ref.modify(script, (remaining) => [remaining[0], remaining.slice(1)] as const)
    if (next === undefined) return yield* Effect.die(`maintained Integrator cassette exhausted ${label} results`)
    return next
  })

const makeRuntime = Effect.fn("IntegratorCassette.makeRuntime")(function* (cassette: AuthoredIntegratorCassette) {
  const history = yield* coherentHistoryFor(cassette)
  return {
    cassette,
    gitCandidates: yield* Ref.make<ReadonlyArray<IntegratorCandidateText>>([]),
    gitResults: yield* Ref.make(cassette.gitResults),
    gitCalls: yield* Ref.make(0),
    integratorCalls: yield* Ref.make<ReadonlyArray<IntegratorRequest>>([]),
    integratorResults: yield* Ref.make(cassette.integratorResults),
    journal: yield* makeJournal(history),
    input: history.input
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
    Effect.provide(runtime.journal.context),
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
  const allRecords = yield* runtime.journal.journal.read(runtime.input.responsibility.plannedAttempt.runId)
  const records = runtime.journal.outputRecords(allRecords)
  const recorded = recordedIntegratorCassetteFor(runtime.cassette.name, allRecords)
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
    stateTag: currentStateFor(allRecords, runtime.input)._tag
  })
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return yield* Effect.die(
      `maintained Integrator cassette ${runtime.cassette.name} terminal mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    )
  }
  return { actual, allRecords, recorded, records }
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
    | {
        readonly allRecords: ReadonlyArray<JournalRecord>
        readonly recorded: RecordedIntegratorCassette
        readonly records: ReadonlyArray<JournalRecord>
      }
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
    state: currentStateFor(terminal.allRecords, runtime.input)
  })
})

/** Short alias used by maintained-cassette tests and future catalog tooling. */
export const runIntegratorCassette = runMaintainedIntegratorCassette

export type MaintainedIntegratorCassetteRun = IntegratorCassetteRunType
export type MaintainedIntegratorCassetteInput = IntegratorCassetteInput
export type MaintainedIntegratorCassetteRequest = IntegratorCassetteRequest
