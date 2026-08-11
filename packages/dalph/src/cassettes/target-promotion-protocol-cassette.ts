import { Deferred, Effect, Match, Ref } from "effect"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId
} from "@dalph/contracts"
import {
  EvidenceDigest,
  EvidenceReference,
  InRunJournal,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  JournalPosition,
  JournalRecord,
  makeIntegrationTargetResourceController,
  runTargetPromotion,
  TargetPromotionCompareAndSetResult,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  TargetVerificationCandidate,
  TargetVerificationPlanId,
  TargetVerificationState,
  targetVerificationCorrelationFor,
  type IntegrationTargetResourceController,
  type TargetPromotionGitService
} from "@dalph/orchestrator"

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
const candidateConstructedPositionOffset = 2
const expectedHead = GitCommitSha.make("1".repeat(gitCommitShaLength))
const candidateCommit = GitCommitSha.make("c".repeat(gitCommitShaLength))

const targetFor = (owner: PromotionOwner) =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(`/repositories/${owner.toLowerCase()}.git`),
    ref: IntegrationTargetRef.make("refs/heads/main")
  })

const preparedPromotion = (participant: PromotionParticipant) => {
  const { owner, queuedAt } = participant
  const runId = RunId.make(`target-promotion-protocol-cassette-${owner}`)
  const target = targetFor(owner)
  const candidate = TargetVerificationCandidate.make({
    candidateCommit,
    constructedAt: JournalPosition.make(queuedAt + candidateConstructedPositionOffset),
    correlation: {
      acceptanceManifest: EvidenceReference.make({
        byteLength: 1,
        digest: EvidenceDigest.make("a".repeat(evidenceDigestLength))
      }),
      acceptedResultCommit: GitCommitSha.make("a".repeat(gitCommitShaLength)),
      attemptId: AttemptId.make(`target-promotion-protocol-${owner}`),
      candidateId: IntegrationCandidateId.make(`target-promotion-protocol-candidate-${owner}`),
      candidateResource: IntegrationCandidateResourceLocator.make(`/candidates/${owner}`),
      expectedTargetHead: expectedHead,
      integrationSessionId: IntegrationSessionId.make(`target-promotion-protocol-session-${owner}`),
      integrationTarget: target,
      runId
    },
    reviewManifest: EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("b".repeat(evidenceDigestLength))
    })
  })
  const correlation = targetVerificationCorrelationFor(
    candidate,
    TargetVerificationPlanId.make(`target-promotion-protocol-plan-${owner}`)
  )
  return {
    candidate,
    responsibility: { integrationTarget: target, queuedAt },
    runId,
    verification: TargetVerificationState.cases.VerificationPassed.make({
      correlation,
      manifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("d".repeat(evidenceDigestLength)) })
    })
  }
}

interface ExactTargetResponsibility {
  readonly integrationTarget: IntegrationTarget
  readonly queuedAt: JournalPosition
}

const makeJournal = Effect.fn("TargetPromotionProtocolCassette.makeJournal")(function* () {
  const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
  return {
    records,
    service: InRunJournal.of({
      append: (runId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          /* v8 ignore next -- @preserve A closed protocol cassette invokes each stable intent/terminal append once; production idempotency is covered by protocol restart tests. */
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const record = JournalRecord.make({ event, key, position: JournalPosition.make(current.length + 1), runId })
          return [Effect.succeed(record), [...current, record]] as const
        }).pipe(Effect.flatten),
      read: () => Ref.get(records)
    })
  }
})

interface ParticipantRuntime {
  readonly blocked: Deferred.Deferred<void>
  readonly boundaryResults: Ref.Ref<ReadonlyArray<PromotionBoundaryResult>>
  readonly compareAndSetCount: Ref.Ref<number>
  readonly journal: {
    readonly records: Ref.Ref<ReadonlyArray<JournalRecord>>
    readonly service: InRunJournal["Service"]
  }
  readonly owner: PromotionOwner
  readonly prepared: ReturnType<typeof preparedPromotion>
  readonly release: Deferred.Deferred<void>
  readonly settled: Deferred.Deferred<string | null>
}

const makeParticipantRuntime = Effect.fn("TargetPromotionProtocolCassette.makeParticipantRuntime")(function* (
  participant: PromotionParticipant
) {
  return {
    blocked: yield* Deferred.make<void>(),
    boundaryResults: yield* Ref.make(participant.boundaryResults),
    compareAndSetCount: yield* Ref.make(0),
    journal: yield* makeJournal(),
    owner: participant.owner,
    prepared: preparedPromotion(participant),
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
  const action = runTargetPromotion(runtime.prepared.candidate, runtime.prepared.verification).pipe(
    Effect.provideService(InRunJournal, runtime.journal.service),
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
    active: [...snapshot.activeResponsibilityPositions],
    held: [...snapshot.heldResponsibilityPositions],
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
  const records = yield* Ref.get(runtime.journal.records)
  const actual = TerminalExpectation.make({
    compareAndSetCount: yield* Ref.get(runtime.compareAndSetCount),
    failureTag,
    journalTags: records.map(({ event }) => event._tag)
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
  const calls = yield* Ref.make<ReadonlyArray<BoundaryCall>>([])
  const leaseObservations = yield* Ref.make<ReadonlyArray<LeaseObservation>>([])
  const resources = yield* makeIntegrationTargetResourceController()
  const runtimes = yield* Effect.forEach(cassette.participants, makeParticipantRuntime)
  const state = { calls, leaseObservations, resources, runtimes }
  yield* Effect.forEach(cassette.story, (item) => interpretStoryItem(state, item), { discard: true })
  const records = yield* Effect.forEach(runtimes, ({ journal }) => Ref.get(journal.records)).pipe(
    Effect.map((all) => all.flat())
  )
  const compareAndSetCount = yield* Effect.forEach(runtimes, ({ compareAndSetCount }) =>
    Ref.get(compareAndSetCount)
  ).pipe(Effect.map((counts) => counts.reduce((total, count) => total + count, 0)))
  const failureTags = yield* Effect.forEach(runtimes, ({ settled }) => Deferred.await(settled))
  return TargetPromotionProtocolCassetteRun.make({
    boundaryCalls: yield* Ref.get(calls),
    compareAndSetCount,
    failureTag: failureTags.find((tag) => tag !== null) ?? null,
    leaseObservations: yield* Ref.get(leaseObservations),
    records
  })
})
