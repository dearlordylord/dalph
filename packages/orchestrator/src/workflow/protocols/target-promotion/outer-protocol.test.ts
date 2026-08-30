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
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionReconciliationDeferredRecordKey
} from "../../../workflow-journal/record-key.js"
import { rememberValidatedJournalPrefixSuccessor } from "../../../workflow-journal/prefix-lineage.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorRunStartedEvent,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  TargetPromotionGit,
  TargetPromotionGitReadObservation,
  TargetPromotionCompareAndSetResult,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionGitReadFailure,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  TargetPromotionReconciliationDeferredEvent,
  TargetPromotionReconciliationDeferral,
  targetPromotionCorrelationEquals,
  type TargetPromotionGitService,
  TargetPromotionCorrelation,
  targetPromotionCorrelationFor,
  targetPromotionGitRequestFor
} from "./events.js"
import {
  deriveTargetPromotionState,
  deriveTargetPromotionStateFor,
  reconcileTargetPromotionAttempt,
  runTargetPromotion,
  TargetPromotionCorrelationContradiction,
  TargetPromotionHistoryContradiction,
  TargetPromotionResultContradiction
} from "./protocol.js"
import {
  observeTargetPromotionRead,
  recordTargetPromotionAttemptIntent,
  recordTargetPromotionIntent,
  sendTargetPromotionAttempt,
  settleTargetPromotionAttempt
} from "./transitions.js"
import type { TargetPromotionObservedAttempt } from "./transition-authority.js"
import { targetPromotionContract } from "../../../../test/contracts/target-promotion-contract.js"

const runId = RunId.make("outer-promotion-test-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/outer-promotion.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const expectedHead = GitCommitSha.make("1".repeat(40))
const acceptedCommit = GitCommitSha.make("2".repeat(40))
const candidateCommit = GitCommitSha.make("3".repeat(40))
const changedHead = GitCommitSha.make("4".repeat(40))
const candidateText = IntegratorCandidateText.make("refs/candidates/outer-promotion")

const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
  candidateCommit,
  candidateText,
  run: {
    ordinal: IntegratorRunOrdinal.make(2),
    session: {
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
    }
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

targetPromotionContract({
  expected: TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead }),
  layer: gitLayer(
    () => Effect.succeed(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })),
    () =>
      Effect.succeed(
        TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
      )
  ),
  name: "controlled",
  request: targetPromotionGitRequestFor(request)
})

const run = (service: TargetPromotionGitService, records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  runFor(qualifiedCandidate, service, records)

const runFor = (
  candidate: IntegratorRunQualifiedCandidate,
  service: TargetPromotionGitService,
  records: Ref.Ref<ReadonlyArray<JournalRecord>>
) =>
  runTargetPromotion(candidate).pipe(
    Effect.provide(Layer.mergeAll(journalLayer(records), gitLayer(service.compareAndSet, service.read)))
  )

const reconcile = (service: TargetPromotionGitService, records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  reconcileTargetPromotionAttempt(qualifiedCandidate).pipe(
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
    expect(state.correlation.requestId).toBe(`target-promotion:session:outer-promotion:2:${candidateCommit}`)
    expect("verificationManifest" in state.correlation).toBe(false)
    expect(yield* Ref.get(requests)).toEqual([targetPromotionGitRequestFor(request)])
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "TargetPromotionIntended",
      "TargetPromotionAttemptIntended",
      "TargetPromotionObservedSuccess"
    ])
    expect((yield* run(service, records))._tag).toBe("PromotionSucceeded")
    expect(yield* Ref.get(requests)).toEqual([targetPromotionGitRequestFor(request)])
  })
)

it.effect("consumes one attempt permission and accepts settlement only from its Git response", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const compareAndSetCalls = yield* Ref.make(0)
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(compareAndSetCalls, (count) => count + 1).pipe(
          Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
        ),
      read: () =>
        Effect.succeed(
          TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
        )
    }
    const layer = Layer.mergeAll(journalLayer(records), gitLayer(service.compareAndSet, service.read))

    const readAuthorization = yield* recordTargetPromotionIntent(qualifiedCandidate).pipe(Effect.provide(layer))
    const attemptAuthorization = yield* observeTargetPromotionRead(readAuthorization).pipe(Effect.provide(layer))
    expect(attemptAuthorization._tag).toBe("TargetPromotionAttemptAuthorized")
    if (attemptAuthorization._tag !== "TargetPromotionAttemptAuthorized") return
    const intended = yield* recordTargetPromotionAttemptIntent(attemptAuthorization).pipe(Effect.provide(layer))
    const observed = yield* sendTargetPromotionAttempt(intended).pipe(Effect.provide(layer))
    expect(observed._tag).toBe("TargetPromotionAttemptObserved")
    expect(yield* Ref.get(compareAndSetCalls)).toBe(1)

    const duplicate = yield* sendTargetPromotionAttempt(intended).pipe(Effect.provide(layer), Effect.flip)
    expect(duplicate._tag).toBe("TargetPromotionResultContradiction")
    if (duplicate._tag !== "TargetPromotionResultContradiction") return
    expect(duplicate.detail).toContain("already consumed")
    expect(yield* Ref.get(compareAndSetCalls)).toBe(1)

    const forged = {
      _tag: "TargetPromotionAttemptObserved",
      attemptOrdinal: intended.attemptOrdinal,
      correlation: intended.correlation,
      result: TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })
    } as TargetPromotionObservedAttempt
    const forgedSettlement = yield* settleTargetPromotionAttempt(forged).pipe(Effect.provide(layer), Effect.flip)
    expect(forgedSettlement._tag).toBe("TargetPromotionResultContradiction")
    if (forgedSettlement._tag !== "TargetPromotionResultContradiction") return
    expect(forgedSettlement.detail).toContain("did not originate from the Git boundary")
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "TargetPromotionIntended",
      "TargetPromotionAttemptIntended"
    ])

    if (observed._tag !== "TargetPromotionAttemptObserved") return
    expect((yield* settleTargetPromotionAttempt(observed).pipe(Effect.provide(layer)))._tag).toBe("PromotionSucceeded")
  })
)

it.effect("reconciles an already-current or ancestor candidate without compare-and-set", () =>
  Effect.gen(function* () {
    const observations = [
      TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: candidateCommit }),
      TargetPromotionGitReadObservation.cases.CandidateAncestor.make({ currentHeadSha: changedHead })
    ] as const

    for (const observation of observations) {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const compareAndSetCalls = yield* Ref.make(0)
      const state = yield* run(
        {
          compareAndSet: () =>
            Ref.update(compareAndSetCalls, (count) => count + 1).pipe(
              Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
            ),
          read: () => Effect.succeed(observation)
        },
        records
      )

      expect(state._tag).toBe("PromotionSucceeded")
      expect(yield* Ref.get(compareAndSetCalls)).toBe(0)
    }
  })
)

it.effect("reuses a validated non-promotion prefix and its exact-request cache", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const state = yield* run(
      {
        compareAndSet: () =>
          Effect.succeed(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })),
        read: () =>
          Effect.succeed(
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
          )
      },
      records
    )
    expect(state._tag).toBe("PromotionSucceeded")

    const priorRecords = yield* Ref.get(records)
    const appended: JournalRecord = {
      event: IntegratorRunStartedEvent.make({ run: qualifiedCandidate.run, version: workflowJournalEventVersion }),
      key: JournalRecordKey.make("outer-promotion:unrelated-integrator-run-start"),
      position: JournalPosition.make(priorRecords.length + 1),
      runId
    }
    const successorRecords = [...priorRecords, appended]
    rememberValidatedJournalPrefixSuccessor(
      { records: priorRecords, runId },
      { records: successorRecords, runId },
      appended
    )

    expect(deriveTargetPromotionStateFor(successorRecords, qualifiedCandidate)?._tag).toBe("PromotionSucceeded")
    expect(deriveTargetPromotionStateFor(successorRecords, qualifiedCandidate)?._tag).toBe("PromotionSucceeded")
  })
)

it.effect("records a stale promotion when the first complete read has moved beyond H without M", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const state = yield* run(
      {
        compareAndSet: () =>
          Effect.succeed(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })),
        read: () =>
          Effect.succeed(
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: changedHead })
          )
      },
      records
    )

    expect(state._tag).toBe("PromotionStale")
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "TargetPromotionIntended",
      "TargetPromotionStale"
    ])
  })
)

it.effect("rejects contradictory complete Git read classifications", () =>
  Effect.gen(function* () {
    const observations = [
      TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: changedHead }),
      TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: candidateCommit }),
      TargetPromotionGitReadObservation.cases.CandidateAncestor.make({ currentHeadSha: expectedHead })
    ] as const

    for (const observation of observations) {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const failure = yield* Effect.flip(
        run(
          {
            compareAndSet: () =>
              Effect.succeed(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })),
            read: () => Effect.succeed(observation)
          },
          records
        )
      )

      expect(failure).toBeInstanceOf(TargetPromotionResultContradiction)
      expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual(["TargetPromotionIntended"])
    }
  })
)

it.effect("fails visibly when the first reconciliation read is unavailable", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const failure = new TargetPromotionGitReadFailure({
      candidateCommit,
      detail: "target ref could not be read",
      target
    })
    const observed = yield* Effect.flip(
      run(
        {
          compareAndSet: () =>
            Effect.succeed(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit })),
          read: () => Effect.fail(failure)
        },
        records
      )
    )

    expect(observed).toBe(failure)
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual(["TargetPromotionIntended"])
  })
)

it.effect("classifies every complete compare-and-set rejection before retry", () =>
  Effect.gen(function* () {
    const cases = [
      [candidateCommit, "PromotionSucceeded"],
      [changedHead, "PromotionStale"]
    ] as const

    for (const [observedHeadSha, expectedTag] of cases) {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const state = yield* run(
        {
          compareAndSet: () =>
            Effect.succeed(TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({ observedHeadSha })),
          read: () =>
            Effect.succeed(
              TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
            )
        },
        records
      )
      expect(state._tag).toBe(expectedTag)
    }

    for (const result of [
      TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({ observedHeadSha: expectedHead }),
      TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: changedHead })
    ]) {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const failure = yield* Effect.flip(
        run(
          {
            compareAndSet: () => Effect.succeed(result),
            read: () =>
              Effect.succeed(
                TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
              )
          },
          records
        )
      )
      expect(failure).toBeInstanceOf(TargetPromotionResultContradiction)
    }
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

it.effect("durably waits after an authority-free exact-head reconciliation and resumes without another read", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set"]).pipe(
          Effect.andThen(
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
    const deferred = yield* reconcile(service, records)
    expect(deferred._tag).toBe("PromotionReconciliationDeferred")
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read"])
    expect(
      (yield* Ref.get(records)).filter(({ event }) => event._tag === "TargetPromotionReconciliationDeferred")
    ).toHaveLength(1)
    expect((yield* reconcile(service, records))._tag).toBe("PromotionReconciliationDeferred")
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read"])

    const authorizedService: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "authorized-compare-and-set"]).pipe(
          Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
        ),
      read: service.read
    }
    expect((yield* run(authorizedService, records))._tag).toBe("PromotionSucceeded")
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read", "authorized-compare-and-set"])
  })
)

it.effect("rejects a malformed durable retry-authority head before any restarted Git call", () =>
  Effect.gen(function* () {
    const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
    const seeded: ReadonlyArray<JournalRecord> = [
      {
        event: TargetPromotionIntendedEvent.make({ correlation: request, version: workflowJournalEventVersion }),
        key: targetPromotionIntentRecordKey(request.requestId),
        position: JournalPosition.make(1),
        runId
      },
      {
        event: TargetPromotionAttemptIntendedEvent.make({
          attemptOrdinal,
          correlation: request,
          reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead }),
          version: workflowJournalEventVersion
        }),
        key: targetPromotionAttemptIntentRecordKey(request.requestId, attemptOrdinal),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: TargetPromotionReconciliationDeferredEvent.make({
          afterAttemptOrdinal: attemptOrdinal,
          correlation: request,
          deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({
            observedHeadSha: changedHead
          }),
          version: workflowJournalEventVersion
        }),
        key: targetPromotionReconciliationDeferredRecordKey(request.requestId, attemptOrdinal),
        position: JournalPosition.make(3),
        runId
      }
    ]
    const records = yield* Ref.make(seeded)
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const failure = yield* Effect.flip(
      run(
        {
          compareAndSet: () =>
            Ref.update(calls, (current) => [...current, "compare-and-set"]).pipe(
              Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
            ),
          read: () =>
            Ref.update(calls, (current) => [...current, "read"]).pipe(
              Effect.as(
                TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
              )
            )
        },
        records
      )
    )

    expect(failure).toBeInstanceOf(TargetPromotionHistoryContradiction)
    if (!(failure instanceof TargetPromotionHistoryContradiction)) {
      return yield* Effect.die("malformed retry-authority prefix did not return its typed contradiction")
    }
    expect(failure.detail).toContain("instead of exact expected head")
    expect(yield* Ref.get(calls)).toEqual([])
    expect(yield* Ref.get(records)).toEqual(seeded)
  })
)

it.effect("durably waits after an unreadable reconciliation and rereads before an authorized retry", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const initial: TargetPromotionGitService = {
      compareAndSet: () =>
        Effect.fail(
          new TargetPromotionCompareAndSetFailure({
            candidateCommit,
            detail: "promotion response was lost",
            expectedHead,
            target
          })
        ),
      read: () =>
        Effect.succeed(
          TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
        )
    }
    expect((yield* run(initial, records))._tag).toBe("PromotionPending")
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const unreadable: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set"]).pipe(
          Effect.andThen(Effect.die("read-only reconciliation called compare-and-set"))
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "read"]).pipe(
          Effect.andThen(
            Effect.fail(
              new TargetPromotionGitReadFailure({ candidateCommit, detail: "destination unavailable", target })
            )
          )
        )
    }
    expect((yield* reconcile(unreadable, records))._tag).toBe("PromotionReconciliationDeferred")
    expect((yield* reconcile(unreadable, records))._tag).toBe("PromotionReconciliationDeferred")
    expect(yield* Ref.get(calls)).toEqual(["read"])

    const authorized: TargetPromotionGitService = {
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set"]).pipe(
          Effect.as(TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidateCommit }))
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "authorized-read"]).pipe(
          Effect.as(
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
          )
        )
    }
    expect((yield* run(authorized, records))._tag).toBe("PromotionSucceeded")
    expect(yield* Ref.get(calls)).toEqual(["read", "authorized-read", "compare-and-set"])
  })
)

it.effect("reconciles an ambiguous attempt from each complete Git ancestry result", () =>
  Effect.gen(function* () {
    const cases = [
      [
        TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: candidateCommit }),
        "PromotionSucceeded"
      ],
      [
        TargetPromotionGitReadObservation.cases.CandidateAncestor.make({ currentHeadSha: changedHead }),
        "PromotionSucceeded"
      ],
      [
        TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: changedHead }),
        "PromotionStale"
      ]
    ] as const

    for (const [reconciliationObservation, expectedTag] of cases) {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      const readCount = yield* Ref.make(0)
      const service: TargetPromotionGitService = {
        compareAndSet: () =>
          Effect.fail(
            new TargetPromotionCompareAndSetFailure({
              candidateCommit,
              detail: "promotion response was lost",
              expectedHead,
              target
            })
          ),
        read: () =>
          Ref.getAndUpdate(readCount, (count) => count + 1).pipe(
            Effect.map((count) =>
              count === 0
                ? TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
                : reconciliationObservation
            )
          )
      }

      expect((yield* run(service, records))._tag).toBe("PromotionPending")
      expect((yield* run(service, records))._tag).toBe(expectedTag)
    }
  })
)

it.effect("rejects a contradictory Git classification after an ambiguous attempt", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const readCount = yield* Ref.make(0)
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Effect.fail(
          new TargetPromotionCompareAndSetFailure({
            candidateCommit,
            detail: "promotion response was lost",
            expectedHead,
            target
          })
        ),
      read: () =>
        Ref.getAndUpdate(readCount, (count) => count + 1).pipe(
          Effect.map((count) =>
            count === 0
              ? TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
              : TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: changedHead })
          )
        )
    }

    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect(yield* Effect.flip(run(service, records))).toBeInstanceOf(TargetPromotionResultContradiction)
  })
)

it.effect("propagates a reconciliation-read failure before the bounded attempt limit", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const readCount = yield* Ref.make(0)
    const failure = new TargetPromotionGitReadFailure({
      candidateCommit,
      detail: "reconciliation read unavailable",
      target
    })
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Effect.fail(
          new TargetPromotionCompareAndSetFailure({
            candidateCommit,
            detail: "promotion response was lost",
            expectedHead,
            target
          })
        ),
      read: () =>
        Ref.getAndUpdate(readCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0
              ? Effect.succeed(
                  TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
                )
              : Effect.fail(failure)
          )
        )
    }

    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect(yield* Effect.flip(run(service, records))).toBe(failure)
  })
)

it.effect("records non-convergence when the final reconciliation read is unavailable", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const readCount = yield* Ref.make(0)
    const service: TargetPromotionGitService = {
      compareAndSet: () =>
        Effect.fail(
          new TargetPromotionCompareAndSetFailure({
            candidateCommit,
            detail: "promotion response was lost",
            expectedHead,
            target
          })
        ),
      read: () =>
        Ref.getAndUpdate(readCount, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count < 3
              ? Effect.succeed(
                  TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: expectedHead })
                )
              : Effect.fail(
                  new TargetPromotionGitReadFailure({
                    candidateCommit,
                    detail: "final reconciliation read unavailable",
                    target
                  })
                )
          )
        )
    }

    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect((yield* run(service, records))._tag).toBe("PromotionPending")
    expect((yield* run(service, records))._tag).toBe("PromotionNonConvergent")
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
    Schema.is(IntegratorRunQualifiedCandidate)({
      run: qualifiedCandidate.run,
      directParents: qualifiedCandidate.directParents,
      qualifiedAt: qualifiedCandidate.qualifiedAt
    })
  ).toBe(false)
})

it("candidate resource HEAD cannot authorize promotion without an Integrator report", () => {
  expect(Schema.is(IntegratorRunQualifiedCandidate)({ candidateCommit, run: qualifiedCandidate.run })).toBe(false)
  expect(Schema.is(TargetPromotionCorrelation)({ candidateCommit, expectedTargetHead: expectedHead })).toBe(false)
})

it("equivalent content cannot authorize promotion without exact M ancestry", () => {
  expect(
    Schema.is(IntegratorRunQualifiedCandidate)({ ...qualifiedCandidate, directParents: [acceptedCommit, expectedHead] })
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
        IntegratorRunQualifiedCandidate.make({
          ...qualifiedCandidate,
          run: {
            ...qualifiedCandidate.run,
            session: { ...qualifiedCandidate.run.session, expectedTargetHead: changedHead }
          },
          directParents: [changedHead, acceptedCommit]
        })
      ],
      [
        "C",
        IntegratorRunQualifiedCandidate.make({
          ...qualifiedCandidate,
          run: {
            ...qualifiedCandidate.run,
            session: { ...qualifiedCandidate.run.session, acceptedResult: changedAcceptedResult }
          },
          directParents: [expectedHead, changedHead]
        })
      ],
      [
        "target",
        IntegratorRunQualifiedCandidate.make({
          ...qualifiedCandidate,
          run: {
            ...qualifiedCandidate.run,
            session: { ...qualifiedCandidate.run.session, integrationTarget: changedTarget }
          }
        })
      ],
      [
        "candidate text",
        IntegratorRunQualifiedCandidate.make({
          ...qualifiedCandidate,
          candidateText: IntegratorCandidateText.make("refs/candidates/foreign-outer-promotion")
        })
      ],
      [
        "qualifiedAt",
        IntegratorRunQualifiedCandidate.make({ ...qualifiedCandidate, qualifiedAt: JournalPosition.make(6) })
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

it("rejects swapped or extra ordered parents before a candidate can become a promotion correlation", () => {
  const invalidParentOrders = [
    [acceptedCommit, expectedHead],
    [expectedHead, acceptedCommit, changedHead]
  ] as const

  for (const directParents of invalidParentOrders) {
    expect(Schema.is(IntegratorRunQualifiedCandidate)({ ...qualifiedCandidate, directParents })).toBe(false)
  }
})
