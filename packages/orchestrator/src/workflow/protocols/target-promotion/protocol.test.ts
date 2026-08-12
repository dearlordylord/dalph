import { it } from "@effect/vitest"
import { acceptedResultFixture, evidenceReferenceFixture } from "../../../../test/support/evidence.js"
import { Deferred, Effect, Fiber, Layer, Ref, Schema } from "effect"
import { expect } from "vitest"
import type { InterruptibleWorkflowBoundaryExecution } from "../../interpretation/interpreter.js"
import {
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  AttemptId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition, type JournalRecordKey } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  TargetPromotionCompareAndSetFailure,
  TargetPromotionCompareAndSetResult,
  TargetPromotionCorrelation,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  TargetPromotionVerification,
  targetPromotionRequestFor,
  type TargetPromotionGitService
} from "./events.js"
import {
  deriveTargetPromotionState,
  runTargetPromotion,
  TargetPromotionPremiseContradiction,
  TargetPromotionResultContradiction,
  TargetPromotionVerificationRequired
} from "./protocol.js"
import type { TargetPromotionState } from "./protocol.js"
import {
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../integration-candidate-construction/events.js"
import {
  TargetVerificationCandidate,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../target-verification/events.js"
import { EvidenceReference, EvidenceDigest } from "../target-verification/evidence-store.js"
import { TargetVerificationState } from "../target-verification/protocol.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { deliveryProposalsOf } from "../../../coordination/delivery/delivery-proposal-derivation.js"
import { executeIntegrationAction } from "../../../coordination/delivery/integration-delivery-action-adapter.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import { TargetPromotionRuntime } from "./runtime.js"
import { TargetPromotionRuntimeUnavailable } from "../../../coordination/delivery/target-promotion-boundary.js"
import type {
  DeliveryActionProposal,
  IdentityFreeDeliveryProposal
} from "../../../coordination/delivery/delivery-action-proposal.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"

const uninterruptedBoundary: InterruptibleWorkflowBoundaryExecution = {
  run: (_intent, call, recordResult) => Effect.flatMap(call, recordResult)
}

const runId = RunId.make("target-promotion-test-run")
const trackerTarget = FixtureTarget.make("target-promotion-tracker-target")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/promotion.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const expectedHead = GitCommitSha.make("2".repeat(40))
const acceptedResult = GitCommitSha.make("3".repeat(40))
const candidateCommit = GitCommitSha.make("4".repeat(40))
const laterHead = GitCommitSha.make("5".repeat(40))
const candidate = TargetVerificationCandidate.make({
  candidateCommit,
  constructedAt: JournalPosition.make(11),
  correlation: {
    acceptanceManifest: evidenceReferenceFixture,
    acceptedResultCommit: acceptedResult,
    attemptId: AttemptId.make("target-promotion-attempt"),
    candidateId: IntegrationCandidateId.make("target-promotion-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("/candidate/promotion"),
    expectedTargetHead: expectedHead,
    integrationSessionId: IntegrationSessionId.make("target-promotion-session"),
    integrationTarget: target,
    runId
  },
  reviewManifest: evidenceReferenceFixture
})
const verificationCorrelation = targetVerificationCorrelationFor(
  candidate,
  TargetVerificationPlanId.make("public-promotion-plan")
)
const manifest = EvidenceReference.make({ byteLength: 17, digest: EvidenceDigest.make("a".repeat(64)) })
const verification = TargetVerificationState.cases.VerificationPassed.make({
  correlation: verificationCorrelation,
  manifest
})
const request = targetPromotionRequestFor(
  candidate,
  TargetPromotionVerification.make({ correlation: verificationCorrelation, manifest })
)
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: candidate.correlation.attemptId,
  baseSha: expectedHead,
  branch: TaskBranchRef.make("refs/heads/dalph/target-promotion"),
  executor: TaskExecutorLocator.make("executor:target-promotion"),
  runId,
  taskId: TaskId.make("target-promotion-task"),
  taskRevision: TaskRevision.make("target-promotion-revision"),
  worktree: WorktreeLocator.make("/worktrees/target-promotion")
})
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: acceptedResultFixture(acceptedResult),
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(8),
  startedAt: JournalPosition.make(9)
})

type CasStep = TargetPromotionCompareAndSetResult | TargetPromotionCompareAndSetFailure
type ReadStep = TargetPromotionGitReadObservation | TargetPromotionGitReadFailure

const compareAndSetFailure = () =>
  new TargetPromotionCompareAndSetFailure({
    candidateCommit,
    detail: "promotion response was lost",
    expectedHead,
    target
  })

const readFailure = () =>
  new TargetPromotionGitReadFailure({ candidateCommit, detail: "target ref could not be read", target })

const makeGitLayer = (
  casSteps: ReadonlyArray<CasStep>,
  readSteps: ReadonlyArray<ReadStep>,
  casCalls: Ref.Ref<number>,
  readCalls: Ref.Ref<number>
) =>
  Layer.effect(
    TargetPromotionGit,
    Effect.gen(function* () {
      const cas = yield* Ref.make(casSteps)
      const reads = yield* Ref.make(readSteps)
      const nextCas = Effect.fn("TargetPromotionTest.nextCas")(function* () {
        yield* Ref.update(casCalls, (count) => count + 1)
        const step = yield* Ref.modify(cas, (remaining) => [remaining[0], remaining.slice(1)] as const)
        if (step === undefined) return yield* compareAndSetFailure()
        return step
      })
      const nextRead = Effect.fn("TargetPromotionTest.nextRead")(function* () {
        yield* Ref.update(readCalls, (count) => count + 1)
        const step = yield* Ref.modify(reads, (remaining) => [remaining[0], remaining.slice(1)] as const)
        if (step === undefined) return yield* readFailure()
        return step
      })
      const service: TargetPromotionGitService = {
        compareAndSet: () =>
          nextCas().pipe(
            Effect.flatMap((step) =>
              step._tag === "TargetPromotionCompareAndSetFailure" ? Effect.fail(step) : Effect.succeed(step)
            )
          ),
        read: () =>
          nextRead().pipe(
            Effect.flatMap((step) =>
              step._tag === "TargetPromotionGitReadFailure" ? Effect.fail(step) : Effect.succeed(step)
            )
          )
      }
      return TargetPromotionGit.of(service)
    })
  )

const makeJournalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (requestedRunId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const record = { event, key, position: JournalPosition.make(current.length + 1), runId: requestedRunId }
          return [Effect.succeed(record), [...current, record]] as const
        }).pipe(Effect.flatten),
      read: () => Ref.get(records)
    })
  )

const withHarness = <A>(
  casSteps: ReadonlyArray<CasStep>,
  readSteps: ReadonlyArray<ReadStep>,
  use: (
    invoke: () => Effect.Effect<TargetPromotionState, unknown, InRunJournal | TargetPromotionGit>,
    records: Ref.Ref<ReadonlyArray<JournalRecord>>,
    casCalls: Ref.Ref<number>,
    readCalls: Ref.Ref<number>
  ) => Generator<Effect.Effect<unknown, unknown, InRunJournal | TargetPromotionGit>, A, never>,
  verificationInput: TargetVerificationState = verification
) =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const casCalls = yield* Ref.make(0)
    const readCalls = yield* Ref.make(0)
    const gitLayer = makeGitLayer(casSteps, readSteps, casCalls, readCalls)
    const journalLayer = makeJournalLayer(records)
    const invoke = () => runTargetPromotion(candidate, verificationInput)
    const useEffect = Effect.gen(() => use(invoke, records, casCalls, readCalls))
    return yield* useEffect.pipe(Effect.provide(Layer.mergeAll(gitLayer, journalLayer)))
  })

const eventTags = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> =>
  records.map(({ event }) => event._tag)

const promotionRecord = (position: number, key: JournalRecordKey, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key,
  position: JournalPosition.make(position),
  runId
})

const promotionIntentRecord = (position: number): JournalRecord =>
  promotionRecord(
    position,
    targetPromotionIntentRecordKey(request.requestId),
    TargetPromotionIntendedEvent.make({ correlation: request, version: workflowJournalEventVersion })
  )

const promotionAttemptRecord = (ordinal: number, position: number): JournalRecord =>
  promotionRecord(
    position,
    targetPromotionAttemptIntentRecordKey(request.requestId, TargetPromotionAttemptOrdinal.make(ordinal)),
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
      correlation: request,
      reason:
        ordinal === 1
          ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead })
          : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
              observedHeadSha: expectedHead,
              previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
            }),
      version: workflowJournalEventVersion
    })
  )

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

it("rejects a promotion correlation that contradicts its exact candidate", () => {
  expect(Schema.is(TargetPromotionCorrelation)({ ...request, candidateCommit: laterHead })).toBe(false)
})

it.effect("rejects non-passing or contradictory verification premises before Git", () =>
  Effect.gen(function* () {
    yield* withHarness(
      [],
      [],
      function* (invoke, records, casCalls, readCalls) {
        expect(yield* invoke().pipe(Effect.flip)).toBeInstanceOf(TargetPromotionVerificationRequired)
        expect(yield* Ref.get(records)).toEqual([])
        expect(yield* Ref.get(casCalls)).toBe(0)
        expect(yield* Ref.get(readCalls)).toBe(0)
      },
      TargetVerificationState.cases.VerificationStopped.make({
        correlation: verificationCorrelation,
        manifest,
        outcome: "Failed"
      })
    )
    yield* withHarness(
      [],
      [],
      function* (invoke, records) {
        expect(yield* invoke().pipe(Effect.flip)).toBeInstanceOf(TargetPromotionPremiseContradiction)
        expect(yield* Ref.get(records)).toEqual([])
      },
      TargetVerificationState.cases.VerificationPassed.make({
        correlation: { ...verificationCorrelation, candidateCommit: laterHead },
        manifest
      })
    )
  })
)

const promotionActionFor = (started: StartedIntegrationResponsibility) => {
  const transition = RunnableFrontierTransition.RunTargetPromotion({ candidate, responsibility: started, verification })
  const contributions = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities: [started],
    runId,
    transitions: [transition]
  })
  const proposal = contributions.deliverySettlement[0] ?? contributions.ticketDelivery[0]
  if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
    throw new Error("target promotion must derive one identity-free proposal")
  }
  return { action: { _tag: "IdentityFreeAction" as const, proposal }, transition }
}

it.effect("reports a typed failure when target-promotion runtime services are unavailable", () =>
  Effect.gen(function* () {
    const resources = yield* makeIntegrationTargetResourceController()
    const { action, transition } = promotionActionFor(responsibility)
    const poisonJournal = InRunJournal.of({
      append: () => Effect.die("missing runtime must fail before appending"),
      read: () => Effect.die("missing runtime must fail before reading")
    })
    const failure = yield* executeIntegrationAction(
      action,
      transition,
      {
        acceptIntegrationTargetOwnership: Effect.void,
        bindPlannedAttemptPosition: () => Effect.void,
        integrationTargets: resources,
        interruptibleBoundary: uninterruptedBoundary,
        recordIntent: () => Effect.void,
        releasePlannedAttemptPosition: () => Effect.void,
        withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol")
      },
      trackerTarget
    ).pipe(Effect.provideService(InRunJournal, poisonJournal), Effect.flip)
    expect(failure).toBeInstanceOf(TargetPromotionRuntimeUnavailable)
  })
)

it.effect("allows a different target while the exact promotion permit is active", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const compareAndSetStarted = yield* Deferred.make<void>()
      const finishCompareAndSet = yield* Deferred.make<void>()
      const resources = yield* makeIntegrationTargetResourceController()
      yield* resources.acquire(responsibility)
      yield* resources.publishAcceptedOwnership(responsibility)
      const git = TargetPromotionGit.of({
        compareAndSet: () =>
          Deferred.succeed(compareAndSetStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishCompareAndSet)),
            Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
          ),
        read: () =>
          Effect.succeed(
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
          )
      })
      const { action, transition } = promotionActionFor(responsibility)
      const running = yield* executeIntegrationAction(
        action,
        transition,
        {
          acceptIntegrationTargetOwnership: Effect.void,
          bindPlannedAttemptPosition: () => Effect.void,
          integrationTargets: resources,
          interruptibleBoundary: uninterruptedBoundary,
          recordIntent: () => Effect.void,
          releasePlannedAttemptPosition: () => Effect.void,
          withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol")
        },
        trackerTarget
      ).pipe(
        Effect.provide(makeJournalLayer(records)),
        Effect.provideService(TargetPromotionRuntime, TargetPromotionRuntime.of({ git })),
        Effect.forkScoped
      )
      yield* Deferred.await(compareAndSetStarted)

      const other = StartedIntegrationResponsibility.make({
        ...responsibility,
        integrationTarget: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/repositories/other-promotion.git"),
          ref: IntegrationTargetRef.make("refs/heads/main")
        }),
        queuedAt: JournalPosition.make(20),
        startedAt: JournalPosition.make(21)
      })
      yield* resources.acquire(other)
      yield* resources.publishAcceptedOwnership(other)
      const laterSameTarget = StartedIntegrationResponsibility.make({
        ...responsibility,
        queuedAt: JournalPosition.make(30),
        startedAt: JournalPosition.make(31)
      })
      expect((yield* resources.acquire(laterSameTarget).pipe(Effect.flip))._tag).toBe(
        "IntegrationTargetResourceUnavailable"
      )

      yield* Deferred.succeed(finishCompareAndSet, undefined)
      yield* Fiber.join(running)
      const snapshot = yield* resources.snapshot
      expect(snapshot.heldResponsibilityPositions.has(responsibility.queuedAt)).toBe(false)
      expect(snapshot.heldResponsibilityPositions.has(other.queuedAt)).toBe(true)
      expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toContain("TargetPromotionObservedSuccess")
    })
  )
)

it.effect("restart reconciles promotion intent before another compare-and-set", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      yield* Ref.set(records, [promotionIntentRecord(1)])
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionSucceeded")
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).toEqual([
        "TargetPromotionIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionObservedSuccess"
      ])
    }
  )
)

it.effect("restart records M already in the target ancestry without another compare-and-set", () =>
  withHarness(
    [],
    [TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: candidateCommit })],
    function* (invoke, records, casCalls, readCalls) {
      yield* Ref.set(records, [promotionIntentRecord(1)])
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionSucceeded")
      if (state._tag !== "PromotionSucceeded") return
      expect(state.basis).toEqual({ _tag: "BeforeFirstAttempt" })
      expect(state.observation).toEqual({
        _tag: "ReconciledCandidateCurrent",
        candidateAncestry: "Current",
        targetHeadSha: candidateCommit
      })
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(yield* Ref.get(casCalls)).toBe(0)
      expect(eventTags(yield* Ref.get(records))).toEqual(["TargetPromotionIntended", "TargetPromotionObservedSuccess"])
    }
  )
)

it.effect("restart records stale H2 without another compare-and-set", () =>
  withHarness(
    [],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: laterHead })],
    function* (invoke, records, casCalls, readCalls) {
      yield* Ref.set(records, [promotionIntentRecord(1)])
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionStale")
      if (state._tag !== "PromotionStale") return
      expect(state.basis).toEqual({ _tag: "BeforeFirstAttempt" })
      expect(state.observation).toEqual({ _tag: "ReconciledCandidateNotInAncestry", observedHeadSha: laterHead })
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(yield* Ref.get(casCalls)).toBe(0)
      expect(eventTags(yield* Ref.get(records))).toEqual(["TargetPromotionIntended", "TargetPromotionStale"])
    }
  )
)

it.effect("rejects a Git read that claims M is an ancestor of its own first parent", () =>
  withHarness(
    [],
    [TargetPromotionGitReadObservation.cases.CandidateAncestor.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      const failure = yield* invoke().pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TargetPromotionResultContradiction)
      expect(yield* Ref.get(casCalls)).toBe(0)
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).toEqual(["TargetPromotionIntended"])
    }
  )
)

it.effect("rejects contradictory current and non-current Git classifications", () =>
  Effect.gen(function* () {
    for (const observation of [
      TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: laterHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: candidateCommit })
    ]) {
      yield* withHarness([], [observation], function* (invoke, records) {
        expect(yield* invoke().pipe(Effect.flip)).toBeInstanceOf(TargetPromotionResultContradiction)
        expect(eventTags(yield* Ref.get(records))).toEqual(["TargetPromotionIntended"])
      })
    }
  })
)

it.effect("rejects a compare-and-set success that reports another commit", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: laterHead })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls) {
      expect(yield* invoke().pipe(Effect.flip)).toBeInstanceOf(TargetPromotionResultContradiction)
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).toEqual(["TargetPromotionIntended", "TargetPromotionAttemptIntended"])
    }
  )
)

it.effect("promotes exact M once and records its sealed evidence and ancestry", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionSucceeded")
      if (state._tag !== "PromotionSucceeded") return
      expect(state.basis).toEqual({ _tag: "AfterAttempt", attemptOrdinal: 1 })
      expect(state.correlation).toEqual(request)
      expect(state.observation).toEqual({
        _tag: "CompareAndSetApplied",
        candidateAncestry: "Current",
        targetHeadSha: candidateCommit
      })
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).toEqual([
        "TargetPromotionIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionObservedSuccess"
      ])
      const stored = yield* Ref.get(records)
      const success = stored.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")
      expect(success?.event).toMatchObject({ correlation: request, observation: { targetHeadSha: candidateCommit } })
      expect(yield* invoke()).toEqual(state)
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(1)
    }
  )
)

it.effect("records stale H2 and never overwrites it", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({ observedHeadSha: laterHead })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionStale")
      if (state._tag !== "PromotionStale") return
      expect(state.basis).toEqual({ _tag: "AfterAttempt", attemptOrdinal: 1 })
      expect(state.observation).toEqual({ _tag: "CompareAndSetRejected", observedHeadSha: laterHead })
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).not.toContain("TargetPromotionObservedSuccess")
    }
  )
)

it.effect("records M from a rejected compare-and-set as current promotion success", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({ observedHeadSha: candidateCommit })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionSucceeded")
      if (state._tag !== "PromotionSucceeded") return
      expect(state.observation).toEqual({
        _tag: "ReconciledCandidateCurrent",
        candidateAncestry: "Current",
        targetHeadSha: candidateCommit
      })
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).toContain("TargetPromotionObservedSuccess")
    }
  )
)

it.effect("rejects a compare-and-set response that still reports the expected H", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({ observedHeadSha: expectedHead })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      const failure = yield* invoke().pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TargetPromotionResultContradiction)
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(eventTags(yield* Ref.get(records))).toEqual(["TargetPromotionIntended", "TargetPromotionAttemptIntended"])
    }
  )
)

it.effect("discovers M in current target ancestry after losing the promotion response", () =>
  withHarness(
    [compareAndSetFailure()],
    [
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateAncestor.make({ currentHeadSha: laterHead })
    ],
    function* (invoke, records, casCalls, readCalls) {
      const first = yield* invoke()
      expect(first._tag).toBe("PromotionPending")
      const settled = yield* invoke()
      expect(settled._tag).toBe("PromotionSucceeded")
      if (settled._tag !== "PromotionSucceeded") return
      expect(settled.observation).toEqual({
        _tag: "ReconciledCandidateAncestor",
        candidateAncestry: "Ancestor",
        targetHeadSha: laterHead
      })
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(2)
      expect(eventTags(yield* Ref.get(records))).toEqual([
        "TargetPromotionIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionObservedSuccess"
      ])
    }
  )
)

it.effect("retries only after H is freshly observed and stops after three ambiguous attempts", () =>
  withHarness(
    [compareAndSetFailure(), compareAndSetFailure(), compareAndSetFailure()],
    [
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
    ],
    function* (invoke, records, casCalls, readCalls) {
      expect((yield* invoke())._tag).toBe("PromotionPending")
      expect((yield* invoke())._tag).toBe("PromotionPending")
      expect((yield* invoke())._tag).toBe("PromotionPending")
      const exhausted = yield* invoke()
      expect(exhausted._tag).toBe("PromotionNonConvergent")
      if (exhausted._tag !== "PromotionNonConvergent") return
      expect(exhausted.attemptOrdinal).toBe(3)
      expect(exhausted.attemptLimit).toBe(3)
      expect(exhausted.lastObservation).toEqual({ _tag: "ExpectedHeadStillObserved", observedHeadSha: expectedHead })
      expect(yield* Ref.get(casCalls)).toBe(3)
      expect(yield* Ref.get(readCalls)).toBe(4)
      const attempts = (yield* Ref.get(records)).filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
      expect(attempts).toHaveLength(3)
      expect(attempts[0]?.event).toMatchObject({ reason: { _tag: "Initial", observedHeadSha: expectedHead } })
      expect(attempts[1]?.event).toMatchObject({
        reason: { _tag: "ReconciledExpectedHead", observedHeadSha: expectedHead, previousAttemptOrdinal: 1 }
      })
    }
  )
)

it.effect("records nonconvergence after attempt three when the final Git read is unreadable", () =>
  withHarness(
    [compareAndSetFailure(), compareAndSetFailure(), compareAndSetFailure()],
    [
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      readFailure()
    ],
    function* (invoke, records, casCalls, readCalls) {
      expect((yield* invoke())._tag).toBe("PromotionPending")
      expect((yield* invoke())._tag).toBe("PromotionPending")
      expect((yield* invoke())._tag).toBe("PromotionPending")
      const exhausted = yield* invoke()
      expect(exhausted._tag).toBe("PromotionNonConvergent")
      if (exhausted._tag !== "PromotionNonConvergent") return
      expect(exhausted.attemptOrdinal).toBe(3)
      expect(exhausted.attemptLimit).toBe(3)
      expect(exhausted.lastObservation).toEqual({ _tag: "TargetReadFailed", detail: "target ref could not be read" })
      expect(yield* Ref.get(casCalls)).toBe(3)
      expect(yield* Ref.get(readCalls)).toBe(4)
      expect(eventTags(yield* Ref.get(records))).toEqual([
        "TargetPromotionIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionNonConvergence"
      ])
    }
  )
)

it.effect("crash after retry attempt record but before response never issues a duplicate numbered attempt", () =>
  withHarness(
    [TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })],
    [TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })],
    function* (invoke, records, casCalls, readCalls) {
      yield* Ref.set(records, [promotionIntentRecord(1), promotionAttemptRecord(1, 2), promotionAttemptRecord(2, 3)])
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionSucceeded")
      expect(yield* Ref.get(readCalls)).toBe(1)
      expect(yield* Ref.get(casCalls)).toBe(1)
      const attempts = (yield* Ref.get(records)).filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
      expect(attempts.map(({ key }) => key)).toEqual([
        targetPromotionAttemptIntentRecordKey(request.requestId, TargetPromotionAttemptOrdinal.make(1)),
        targetPromotionAttemptIntentRecordKey(request.requestId, TargetPromotionAttemptOrdinal.make(2)),
        targetPromotionAttemptIntentRecordKey(request.requestId, TargetPromotionAttemptOrdinal.make(3))
      ])
    }
  )
)

it.effect("waits without another request when Git cannot be read", () =>
  withHarness(
    [compareAndSetFailure()],
    [
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      readFailure()
    ],
    function* (invoke, records, casCalls, readCalls) {
      expect((yield* invoke())._tag).toBe("PromotionPending")
      const failure = yield* invoke().pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TargetPromotionGitReadFailure)
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(2)
      const state = deriveTargetPromotionState(yield* Ref.get(records), request)
      expect(state?._tag).toBe("PromotionPending")
    }
  )
)

it.effect("rejects equivalent content without exact M ancestry", () =>
  withHarness(
    [compareAndSetFailure()],
    [
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: laterHead })
    ],
    function* (invoke, records, casCalls, readCalls) {
      expect((yield* invoke())._tag).toBe("PromotionPending")
      const state = yield* invoke()
      expect(state._tag).toBe("PromotionStale")
      if (state._tag !== "PromotionStale") return
      expect(state.observation).toEqual({ _tag: "ReconciledCandidateNotInAncestry", observedHeadSha: laterHead })
      expect(yield* Ref.get(casCalls)).toBe(1)
      expect(yield* Ref.get(readCalls)).toBe(2)
      expect(eventTags(yield* Ref.get(records))).toEqual([
        "TargetPromotionIntended",
        "TargetPromotionAttemptIntended",
        "TargetPromotionStale"
      ])
    }
  )
)
