import { it } from "@effect/vitest"
import { Effect, Layer, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
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
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorQualifiedCandidate,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  TargetPromotionGit,
  TargetPromotionGitReadObservation,
  TargetPromotionCompareAndSetResult,
  TargetPromotionCompareAndSetFailure,
  targetPromotionCorrelationEquals,
  type TargetPromotionGitService,
  TargetPromotionCorrelation,
  targetPromotionCorrelationFor,
  targetPromotionGitRequestFor
} from "./events.js"
import {
  deriveTargetPromotionState,
  deriveTargetPromotionStateFor,
  runTargetPromotion,
  TargetPromotionCorrelationContradiction
} from "./protocol.js"

const runId = RunId.make("outer-promotion-test-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/outer-promotion.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const expectedHead = GitCommitSha.make("1".repeat(40))
const acceptedCommit = GitCommitSha.make("2".repeat(40))
const candidateCommit = GitCommitSha.make("3".repeat(40))
const candidateText = IntegratorCandidateText.make("refs/candidates/outer-promotion")

const qualifiedCandidate = IntegratorQualifiedCandidate.make({
  candidateCommit,
  candidateText,
  correlation: {
    acceptedResult: acceptedResultFixture(acceptedCommit),
    candidateResource: IntegratorCandidateResourceLocator.make("resource:outer-promotion"),
    expectedTargetHead: expectedHead,
    integrationTarget: target,
    plannedAttempt: PlannedTaskAttempt.make({
      attemptId: AttemptId.make("outer-promotion-attempt"),
      baseSha: expectedHead,
      branch: TaskBranchRef.make("refs/heads/dalph/outer-promotion"),
      executor: TaskExecutorLocator.make("executor:outer-promotion"),
      runId,
      taskId: TaskId.make("outer-promotion-task"),
      taskRevision: TaskRevision.make("outer-promotion-revision"),
      worktree: WorktreeLocator.make("/worktrees/outer-promotion")
    }),
    queuedAt: JournalPosition.make(3),
    sessionId: IntegratorSessionId.make("session:outer-promotion"),
    startedAt: JournalPosition.make(4),
    targetLineageObservedAt: JournalPosition.make(2)
  },
  directParents: [expectedHead, acceptedCommit],
  qualifiedAt: JournalPosition.make(5)
})

const request = targetPromotionCorrelationFor(qualifiedCandidate)

const journalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
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

const gitLayer = (compareAndSet: TargetPromotionGitService["compareAndSet"], read: TargetPromotionGitService["read"]) =>
  Layer.succeed(TargetPromotionGit, TargetPromotionGit.of({ compareAndSet, read }))

const run = (service: TargetPromotionGitService, records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  runFor(qualifiedCandidate, service, records)

const runFor = (
  candidate: IntegratorQualifiedCandidate,
  service: TargetPromotionGitService,
  records: Ref.Ref<ReadonlyArray<JournalRecord>>
) =>
  runTargetPromotion(candidate).pipe(
    Effect.provide(Layer.mergeAll(journalLayer(records), gitLayer(service.compareAndSet, service.read)))
  )

it.effect("promotes exact M once and records its Integrator correlation and ancestry", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const requests = yield* Ref.make<ReadonlyArray<unknown>>([])
    const service: TargetPromotionGitService = {
      compareAndSet: (gitRequest) =>
        Ref.update(requests, (current) => [...current, gitRequest]).pipe(
          Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
        ),
      read: () =>
        Effect.succeed(
          TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
        )
    }

    const state = yield* run(service, records)
    expect(state._tag).toBe("PromotionSucceeded")
    if (state._tag !== "PromotionSucceeded") return
    expect(state.correlation).toEqual(request)
    expect(state.correlation.qualifiedCandidate.candidateCommit).toBe(candidateCommit)
    expect(state.correlation.qualifiedCandidate.candidateText).toBe(candidateText)
    expect(state.correlation.qualifiedCandidate.directParents).toEqual([expectedHead, acceptedCommit])
    expect("verificationManifest" in state.correlation).toBe(false)
    expect(yield* Ref.get(requests)).toEqual([targetPromotionGitRequestFor(request)])
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "TargetPromotionIntended",
      "TargetPromotionAttemptIntended",
      "TargetPromotionObservedSuccess"
    ])
  })
)

it.effect("reads before retrying an ambiguous exact-head promotion and never sends a fourth attempt", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const reads = [
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
    ] as const
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.modify(calls, (current) => {
          const ordinal = current.filter((item) => item === "compare-and-set").length
          return [ordinal, [...current, "compare-and-set"]] as const
        }).pipe(
          Effect.flatMap((ordinal) =>
            ordinal === 0
              ? Effect.fail(
                  new TargetPromotionCompareAndSetFailure({
                    candidateCommit,
                    detail: "promotion response was lost",
                    expectedHead,
                    target
                  })
                )
              : Effect.succeed(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
          )
        ),
      read: () =>
        Ref.modify(calls, (current) => {
          const readOrdinal = current.filter((item) => item === "read").length
          return [readOrdinal, [...current, "read"]] as const
        }).pipe(Effect.map((ordinal) => (ordinal === 0 ? reads[0] : reads[1])))
    }

    const first = yield* run(service, records)
    expect(first._tag).toBe("PromotionPending")
    const second = yield* run(service, records)
    expect(second._tag).toBe("PromotionSucceeded")
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read", "compare-and-set"])
    expect(
      (yield* Ref.get(records)).filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    ).toHaveLength(2)
  })
)

it.effect("records non-convergence after three ambiguous attempts and sends no fourth request", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const calls = yield* Ref.make({ compareAndSet: 0, read: 0 })
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(calls, (current) => ({ ...current, compareAndSet: current.compareAndSet + 1 })).pipe(
          Effect.flatMap(() =>
            Effect.fail(
              new TargetPromotionCompareAndSetFailure({
                candidateCommit,
                detail: "promotion response was lost",
                expectedHead,
                target
              })
            )
          )
        ),
      read: () =>
        Ref.update(calls, (current) => ({ ...current, read: current.read + 1 })).pipe(
          Effect.as(
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
          )
        )
    }

    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect((yield* run(service, records))._tag).toBe("PromotionNonConvergent")
    expect(yield* Ref.get(calls)).toEqual({ compareAndSet: 3, read: 4 })
  })
)

it("process success cannot authorize promotion without an Integrator result", () => {
  expect(
    Schema.is(IntegratorQualifiedCandidate)({
      correlation: qualifiedCandidate.correlation,
      directParents: qualifiedCandidate.directParents,
      qualifiedAt: qualifiedCandidate.qualifiedAt
    })
  ).toBe(false)
})

it("candidate resource HEAD cannot authorize promotion without an Integrator report", () => {
  expect(
    Schema.is(IntegratorQualifiedCandidate)({ candidateCommit, correlation: qualifiedCandidate.correlation })
  ).toBe(false)
  expect(Schema.is(TargetPromotionCorrelation)({ candidateCommit, expectedTargetHead: expectedHead })).toBe(false)
})

it("equivalent content cannot authorize promotion without exact M ancestry", () => {
  expect(
    Schema.is(IntegratorQualifiedCandidate)({ ...qualifiedCandidate, directParents: [acceptedCommit, expectedHead] })
  ).toBe(false)
})

it("legacy target-verification evidence cannot authorize promotion", () => {
  expect(
    Schema.is(TargetPromotionCorrelation)({
      requestId: request.requestId,
      candidateCommit,
      expectedTargetHead: expectedHead,
      verificationManifest: { byteLength: 0, digest: "a".repeat(64) }
    })
  ).toBe(false)
})

it.effect("rejects recovery for a foreign exact promotion correlation sharing the request id", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set"]).pipe(
          Effect.flatMap(() =>
            Effect.fail(
              new TargetPromotionCompareAndSetFailure({
                candidateCommit,
                detail: "promotion response was lost",
                expectedHead,
                target
              })
            )
          )
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "read"]).pipe(
          Effect.as(
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
          )
        )
    }

    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect(deriveTargetPromotionStateFor(yield* Ref.get(records), qualifiedCandidate)?._tag).toBe("PromotionPending")

    const changedHead = GitCommitSha.make("4".repeat(40))
    const changedAcceptedResult = acceptedResultFixture(changedHead)
    const changedTarget = IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/repositories/foreign-outer-promotion.git"),
      ref: IntegrationTargetRef.make("refs/heads/release")
    })
    const foreignCandidates = [
      [
        "H",
        IntegratorQualifiedCandidate.make({
          ...qualifiedCandidate,
          correlation: { ...qualifiedCandidate.correlation, expectedTargetHead: changedHead },
          directParents: [changedHead, acceptedCommit]
        })
      ],
      [
        "C",
        IntegratorQualifiedCandidate.make({
          ...qualifiedCandidate,
          correlation: { ...qualifiedCandidate.correlation, acceptedResult: changedAcceptedResult },
          directParents: [expectedHead, changedHead]
        })
      ],
      [
        "target",
        IntegratorQualifiedCandidate.make({
          ...qualifiedCandidate,
          correlation: { ...qualifiedCandidate.correlation, integrationTarget: changedTarget }
        })
      ],
      [
        "candidate text",
        IntegratorQualifiedCandidate.make({
          ...qualifiedCandidate,
          candidateText: IntegratorCandidateText.make("refs/candidates/foreign-outer-promotion")
        })
      ],
      [
        "qualifiedAt",
        IntegratorQualifiedCandidate.make({ ...qualifiedCandidate, qualifiedAt: JournalPosition.make(6) })
      ]
    ] as const

    for (const [label, foreignCandidate] of foreignCandidates) {
      const foreignRequest = targetPromotionCorrelationFor(foreignCandidate)
      expect(targetPromotionCorrelationEquals(foreignRequest, request), label).toBe(false)
      expect(deriveTargetPromotionState(yield* Ref.get(records), foreignRequest), label).toBeUndefined()
      const failure = yield* Effect.flip(runFor(foreignCandidate, service, records))
      expect(failure, label).toBeInstanceOf(TargetPromotionCorrelationContradiction)
    }
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set"])
  })
)

it("rejects changed ordered parents before a candidate can become a promotion correlation", () => {
  expect(
    Schema.is(IntegratorQualifiedCandidate)({ ...qualifiedCandidate, directParents: [acceptedCommit, expectedHead] })
  ).toBe(false)
})
