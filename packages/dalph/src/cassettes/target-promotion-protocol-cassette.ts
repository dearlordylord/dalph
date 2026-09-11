import { Context, Deferred, Effect, Layer, Match, Ref } from "effect"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  EvidenceDigest,
  EvidenceReference,
  AcceptedJournalReader,
  InRunJournal,
  Integrator,
  IntegratorGit,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorCandidateText,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  StartedIntegrationResponsibility,
  JournalPosition,
  TargetLineageObservation,
  integratorCorrelationFor,
  liveJournalTestLayer,
  makeIntegrationTargetResourceController,
  prepareIntegrationCandidateRun,
  runTargetPromotion,
  TargetPromotionCompareAndSetResult,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  type IntegrationTargetResourceController,
  type TargetPromotionGitService
} from "@dalph/orchestrator"

import { AuthoredIntegratorCassette } from "./integrator-cassette-domain.js"
import { coherentHistoryFor } from "./integrator-cassette-history.js"

import {
  LeaseObservation,
  TargetPromotionProtocolCassetteRun,
  TerminalExpectation,
  type BoundaryCall,
  type PromotionBoundaryResult,
  type PromotionOwner,
  type PromotionParticipant,
  type ProtocolStoryItem,
  type TargetPromotionProtocolCassette
} from "./target-promotion-protocol-cassette-domain.js"

export * from "./target-promotion-protocol-cassette-domain.js"

const gitCommitShaLength = 40
const evidenceDigestLength = 64
const authoredStartingPosition = 1
const authoredStartedPosition = 2
const authoredLineagePosition = 4
const expectedHead = GitCommitSha.make("1".repeat(gitCommitShaLength))
const candidateCommit = GitCommitSha.make("c".repeat(gitCommitShaLength))

const targetFor = (owner: PromotionOwner) =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(`/repositories/${owner.toLowerCase()}.git`),
    ref: IntegrationTargetRef.make("refs/heads/main")
  })

const preparedPromotion = Effect.fn("TargetPromotionProtocolCassette.preparePromotion")(function* (
  participant: PromotionParticipant
) {
  const { owner } = participant
  const runId = RunId.make(`target-promotion-protocol-cassette-${owner}`)
  const target = targetFor(owner)
  const acceptedResult = AcceptedResult.make({
    commit: GitCommitSha.make("a".repeat(gitCommitShaLength)),
    evidenceManifest: EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("a".repeat(evidenceDigestLength))
    })
  })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`target-promotion-protocol-${owner}`),
    baseSha: expectedHead,
    branch: TaskBranchRef.make(`refs/heads/dalph/target-promotion-protocol-${owner.toLowerCase()}`),
    executor: TaskExecutorLocator.make(`executor:target-promotion-protocol-${owner}`),
    runId,
    taskId: TaskId.make(`target-promotion-protocol-task-${owner}`),
    taskRevision: TaskRevision.make(`target-promotion-protocol-revision-${owner}`),
    worktree: WorktreeLocator.make(`/worktrees/target-promotion-protocol-${owner.toLowerCase()}`)
  })
  const startingFacts = {
    responsibility: StartedIntegrationResponsibility.make({
      acceptedResult,
      integrationTarget: target,
      plannedAttempt,
      queuedAt: JournalPosition.make(authoredStartingPosition),
      startedAt: JournalPosition.make(authoredStartedPosition)
    }),
    targetLineage: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: plannedAttempt.baseSha,
      targetHeadSha: expectedHead
    }),
    targetLineageObservedAt: JournalPosition.make(authoredLineagePosition)
  }
  const setup = yield* coherentHistoryFor(
    AuthoredIntegratorCassette.make({
      gitResults: [],
      integratorResults: [],
      name: `target promotion accepted setup ${owner}`,
      startingFacts,
      story: []
    })
  )
  const context = yield* Layer.build(liveJournalTestLayer({ records: setup.records, runId, target: setup.target }))
  const journal = Context.get(context, InRunJournal)
  const accepted = Context.get(context, AcceptedJournalReader)
  const correlation = integratorCorrelationFor(setup.input)
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
  const candidateText = IntegratorCandidateText.make(`refs/heads/target-promotion-protocol-${owner.toLowerCase()}`)
  const result = yield* prepareIntegrationCandidateRun({ preparation: setup.input, run }).pipe(
    Effect.provideService(AcceptedJournalReader, accepted),
    Effect.provideService(InRunJournal, journal),
    Effect.provideService(
      Integrator,
      Integrator.of({
        prepare: ({ correlation: requestedRun }) =>
          Effect.succeed(IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: requestedRun }))
      })
    ),
    Effect.provideService(
      IntegratorGit,
      IntegratorGit.of({
        readCandidate: () =>
          Effect.succeed(
            IntegratorGitObservation.cases.Commit.make({
              candidateText,
              commit: candidateCommit,
              directParents: [expectedHead, acceptedResult.commit]
            })
          )
      })
    )
  )
  if (result._tag !== "PreparedCandidate") {
    return yield* Effect.die(`target promotion ${owner} accepted setup did not qualify its candidate`)
  }
  const records = yield* journal.read(runId)
  const qualifiedAt = records.findLast(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")?.position
  if (qualifiedAt === undefined) return yield* Effect.die(`target promotion ${owner} setup lacks Git evidence`)
  const candidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit: result.candidateCommit,
    candidateText: result.candidateText,
    directParents: result.observation.directParents,
    qualifiedAt,
    run: result.run
  })
  const responsibility = setup.input.responsibility
  if (
    candidate.run.session.plannedAttempt.runId !== responsibility.plannedAttempt.runId ||
    candidate.run.session.queuedAt !== responsibility.queuedAt
  ) {
    return yield* Effect.die(`target promotion ${owner} lease does not name its accepted responsibility`)
  }
  return { accepted, baselineLength: records.length, candidate, journal, responsibility, runId }
})

type ExactTargetResponsibility = Pick<
  StartedIntegrationResponsibility,
  "integrationTarget" | "plannedAttempt" | "queuedAt"
>

interface ParticipantRuntime {
  readonly blocked: Deferred.Deferred<void>
  readonly boundaryResults: Ref.Ref<ReadonlyArray<PromotionBoundaryResult>>
  readonly compareAndSetCount: Ref.Ref<number>
  readonly accepted: AcceptedJournalReader["Service"]
  readonly journal: InRunJournal["Service"]
  readonly owner: PromotionOwner
  readonly prepared: Effect.Success<ReturnType<typeof preparedPromotion>>
  readonly release: Deferred.Deferred<void>
  readonly settled: Deferred.Deferred<string | null>
}

const makeParticipantRuntime = Effect.fn("TargetPromotionProtocolCassette.makeParticipantRuntime")(function* (
  participant: PromotionParticipant
) {
  const prepared = yield* preparedPromotion(participant)
  return {
    accepted: prepared.accepted,
    blocked: yield* Deferred.make<void>(),
    boundaryResults: yield* Ref.make(participant.boundaryResults),
    compareAndSetCount: yield* Ref.make(0),
    journal: prepared.journal,
    owner: participant.owner,
    prepared,
    release: yield* Deferred.make<void>(),
    settled: yield* Deferred.make<string | null>()
  } satisfies ParticipantRuntime
})

const takeBoundaryResult = Effect.fn("TargetPromotionProtocolCassette.takeBoundaryResult")(function* (
  runtime: ParticipantRuntime
) {
  const result = yield* Ref.modify(runtime.boundaryResults, (remaining) => [remaining[0], remaining.slice(1)] as const)
  /* v8 ignore next -- @preserve The cassette Schema requires one complete read/compare-and-set boundary sequence per participant. */
  return result ?? (yield* Effect.die(`missing ${runtime.owner} promotion boundary result`))
})

const compareAndSetCallFor = (owner: PromotionOwner): BoundaryCall =>
  owner === "T1" ? "T1.compareAndSet" : "T2.compareAndSet"

const readCallFor = (owner: PromotionOwner): BoundaryCall => (owner === "T1" ? "T1.read" : "T2.read")

const compareAndSetThrough = Effect.fn("TargetPromotionProtocolCassette.compareAndSet")(function* (
  runtime: ParticipantRuntime,
  calls: Ref.Ref<ReadonlyArray<BoundaryCall>>
) {
  yield* Ref.update(calls, (current) => [...current, compareAndSetCallFor(runtime.owner)])
  yield* Ref.update(runtime.compareAndSetCount, (count) => count + 1)
  const result = yield* takeBoundaryResult(runtime)
  if (result._tag === "CompareAndSetWaitsThenApplies") {
    yield* Deferred.succeed(runtime.blocked, undefined)
    yield* Deferred.await(runtime.release)
  }
  return TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })
})

const readThrough = Effect.fn("TargetPromotionProtocolCassette.read")(function* (
  runtime: ParticipantRuntime,
  calls: Ref.Ref<ReadonlyArray<BoundaryCall>>
) {
  yield* Ref.update(calls, (current) => [...current, readCallFor(runtime.owner)])
  const result = yield* takeBoundaryResult(runtime)
  if (result._tag === "ReadFailed") {
    return yield* new TargetPromotionGitReadFailure({
      candidateCommit,
      detail: result.detail,
      target: runtime.prepared.responsibility.integrationTarget
    })
  }
  /* v8 ignore next -- @preserve The cassette Schema permits only an expected-head return or typed read failure at this position. */
  if (result._tag !== "ReadExpectedHead") {
    return yield* Effect.die(`expected Git read result, received ${result._tag}`)
  }
  return TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
})

const gitServiceFor = (
  runtime: ParticipantRuntime,
  calls: Ref.Ref<ReadonlyArray<BoundaryCall>>
): TargetPromotionGitService => ({
  compareAndSet: () => compareAndSetThrough(runtime, calls),
  read: () => readThrough(runtime, calls)
})

const runtimeFor = (
  runtimes: ReadonlyArray<ParticipantRuntime>,
  owner: PromotionOwner
): Effect.Effect<ParticipantRuntime> => {
  const runtime = runtimes.find((candidate) => candidate.owner === owner)
  /* v8 ignore next -- @preserve Cross-field cassette validation requires every story owner to name one unique participant. */
  return runtime === undefined ? Effect.die(`missing promotion participant ${owner}`) : Effect.succeed(runtime)
}

const acquire = Effect.fn("TargetPromotionProtocolCassette.acquire")(function* (
  resources: IntegrationTargetResourceController,
  responsibility: ExactTargetResponsibility
) {
  yield* resources.acquire(responsibility)
  yield* resources.publishAcceptedOwnership(responsibility)
})

const runWithExactLease = <A, E, R>(
  resources: IntegrationTargetResourceController,
  responsibility: ExactTargetResponsibility,
  effect: Effect.Effect<A, E, R>
) => resources.withPermit(responsibility, effect).pipe(Effect.ensuring(resources.release(responsibility)))

const startPromotion = Effect.fn("TargetPromotionProtocolCassette.startPromotion")(function* (
  resources: IntegrationTargetResourceController,
  runtime: ParticipantRuntime,
  calls: Ref.Ref<ReadonlyArray<BoundaryCall>>
) {
  const action = runTargetPromotion(runtime.prepared.candidate).pipe(
    Effect.provideService(AcceptedJournalReader, runtime.accepted),
    Effect.provideService(InRunJournal, runtime.journal),
    Effect.provideService(TargetPromotionGit, TargetPromotionGit.of(gitServiceFor(runtime, calls))),
    Effect.as(null),
    Effect.catchTag("TargetPromotionGitReadFailure", (failure) => Effect.succeed(failure._tag))
  )
  yield* runWithExactLease(resources, runtime.prepared.responsibility, action).pipe(
    Effect.flatMap((failureTag) => Deferred.succeed(runtime.settled, failureTag)),
    Effect.asVoid,
    Effect.forkChild
  )
})

const observeLeases = Effect.fn("TargetPromotionProtocolCassette.observeLeases")(function* (
  resources: IntegrationTargetResourceController,
  expected: LeaseObservation
) {
  const snapshot = yield* resources.snapshot
  const actual = LeaseObservation.make({
    active: snapshot.activeResponsibilities,
    held: snapshot.heldResponsibilities,
    moment: expected.moment
  })
  /* v8 ignore next -- @preserve Maintained cassette values assert all four exact lease snapshots; this defect is diagnostic for manually forged typed values. */
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return yield* Effect.die(`lease observation ${expected.moment} contradicted its cassette expectation`)
  }
  return actual
})

const observeTerminal = Effect.fn("TargetPromotionProtocolCassette.observeTerminal")(function* (
  runtime: ParticipantRuntime,
  expected: TerminalExpectation
) {
  const failureTag = yield* Deferred.await(runtime.settled)
  const records = yield* runtime.journal.read(runtime.prepared.runId)
  const actual = TerminalExpectation.make({
    compareAndSetCount: yield* Ref.get(runtime.compareAndSetCount),
    failureTag,
    journalTags: records.slice(runtime.prepared.baselineLength).map(({ event }) => event._tag)
  })
  /* v8 ignore next -- @preserve Maintained cassette values assert success and unreadable terminal projections; this defect is diagnostic for manually forged typed values. */
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return yield* Effect.die(`${runtime.owner} terminal observation contradicted its cassette expectation`)
  }
})

interface InterpretationState {
  readonly calls: Ref.Ref<ReadonlyArray<BoundaryCall>>
  readonly leaseObservations: Ref.Ref<ReadonlyArray<LeaseObservation>>
  readonly resources: IntegrationTargetResourceController
  readonly runtimes: ReadonlyArray<ParticipantRuntime>
}

const interpretStoryItem = Effect.fn("TargetPromotionProtocolCassette.interpretStoryItem")(function* (
  state: InterpretationState,
  item: ProtocolStoryItem
) {
  if (item._tag === "ObserveLeases") {
    const observation = yield* observeLeases(state.resources, item.expected)
    return yield* Ref.update(state.leaseObservations, (current) => [...current, observation])
  }
  const runtime = yield* runtimeFor(state.runtimes, item.owner)
  return yield* Match.valueTags(item, {
    Acquire: () => acquire(state.resources, runtime.prepared.responsibility),
    AwaitBlockedBoundary: () => Deferred.await(runtime.blocked),
    AwaitSettlement: (value) => observeTerminal(runtime, value.expected),
    ReleaseBlockedBoundary: () => Deferred.succeed(runtime.release, undefined),
    StartPromotion: () => startPromotion(state.resources, runtime, state.calls)
  })
})

/** Replays declared Git results and observations through the production promotion protocol and exact target leases. */
export const runTargetPromotionProtocolCassette = Effect.fn("TargetPromotionProtocolCassette.run")(function* (
  cassette: TargetPromotionProtocolCassette
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<BoundaryCall>>([])
      const leaseObservations = yield* Ref.make<ReadonlyArray<LeaseObservation>>([])
      const resources = yield* makeIntegrationTargetResourceController()
      const runtimes = yield* Effect.forEach(cassette.participants, makeParticipantRuntime)
      const state = { calls, leaseObservations, resources, runtimes }
      yield* Effect.forEach(cassette.story, (item) => interpretStoryItem(state, item), { discard: true })
      const records = yield* Effect.forEach(runtimes, ({ journal, prepared }) =>
        journal.read(prepared.runId).pipe(Effect.map((accepted) => accepted.slice(prepared.baselineLength)))
      ).pipe(Effect.map((all) => all.flat()))
      const compareAndSetCount = yield* Effect.forEach(runtimes, ({ compareAndSetCount }) =>
        Ref.get(compareAndSetCount)
      ).pipe(Effect.map((counts) => counts.reduce((total, count) => total + count, 0)))
      const failureTags = yield* Effect.forEach(runtimes, ({ settled }) => Deferred.await(settled))
      return TargetPromotionProtocolCassetteRun.make({
        boundaryCalls: yield* Ref.get(calls),
        compareAndSetCount,
        failureTag: failureTags.find((tag) => tag !== null) ?? null,
        leaseObservations: yield* Ref.get(leaseObservations),
        leaseResponsibilities: runtimes.map(({ prepared }) => ({
          queuedAt: prepared.responsibility.queuedAt,
          runId: prepared.responsibility.plannedAttempt.runId
        })),
        records
      })
    })
  )
})
