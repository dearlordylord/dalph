import { Effect, Layer, Ref } from "effect"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import {
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationIntendedEvent,
  RemotePublicationObservationFailure,
  RemotePublicationProofBasis,
  RemotePublicationPushFailure,
  RemotePublicationPushResult,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "./events.js"
import { makeRemotePublicationEngine } from "./protocol-engine.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

const candidate = integrationFinalityFixture.qualifiedCandidate
const correlation = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)

const pendingPublicationRecords = (attemptOrdinal: RemotePublicationAttemptOrdinal): ReadonlyArray<JournalRecord> => [
  {
    event: RemotePublicationIntendedEvent.make({
      correlation,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    key: "remote-publication-intended:test" as JournalRecord["key"],
    position: JournalPosition.make(1),
    runId: candidate.run.session.plannedAttempt.runId
  },
  {
    event: RemotePublicationAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(correlation.qualifiedCandidate.candidateCommit, correlation.target.branch),
      version: workflowJournalEventVersion
    }),
    key: "remote-publication-attempt:test:1" as JournalRecord["key"],
    position: JournalPosition.make(2),
    runId: candidate.run.session.plannedAttempt.runId
  }
]

const journalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (runId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const record = { event, key, position: JournalPosition.make(current.length + 1), runId }
          return [Effect.succeed(record), [...current, record]] as const
        }).pipe(Effect.flatten),
      read: () => Ref.get(records)
    })
  )

it.effect("publishes when the pinned remote head is an ancestor of M", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const pushes = yield* Ref.make(0)
    const observations = yield* Ref.make(0)
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Ref.update(observations, (count) => count + 1).pipe(
          Effect.as(
            RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
              remoteHead: candidate.run.session.expectedTargetHead
            })
          )
        ),
      push: ({ candidateCommit }) =>
        Ref.update(pushes, (count) => count + 1).pipe(
          Effect.as(RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidateCommit }))
        )
    })
    // Accepted-history publication may lag this action's acknowledged appends.
    // The engine must advance from its own append result within the same action.
    const engine = makeRemotePublicationEngine(() => Effect.succeed([]))
    const result = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(result._tag).toBe("PublicationSucceeded")
    expect(yield* Ref.get(pushes)).toBe(1)
    const appendedRecords = yield* Ref.get(records)
    expect(appendedRecords.map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationSucceeded"
    ])
    const attemptIntent = appendedRecords.find(({ event }) => event._tag === "RemotePublicationAttemptIntended")
    expect(attemptIntent?.event).toMatchObject({
      refspec: remotePublicationRefspecFor(candidate.candidateCommit, remotePublicationTargetForTest.branch)
    })
  })
)

it.effect("reconciles a pending numbered intent without repeating a conclusive push", () =>
  Effect.gen(function* () {
    const attemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
    const custodyReconciliations = yield* Ref.make(0)
    const records = yield* Ref.make(pendingPublicationRecords(attemptOrdinal))
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Ref.update(custodyReconciliations, (count) => count + 1),
      observe: ({ candidateCommit }) =>
        Effect.succeed(RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: candidateCommit })),
      push: () => Effect.die("a conclusive reconciliation must not repeat the push")
    })
    const engine = makeRemotePublicationEngine(() => Ref.get(records))
    const result = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(result).toMatchObject({
      _tag: "PublicationSucceeded",
      proof: RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
        attemptOrdinal,
        remoteHead: candidate.candidateCommit
      })
    })
    expect(yield* Ref.get(custodyReconciliations)).toBe(1)
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationSucceeded"
    ])
  })
)

it.effect("does not observe or push when prior sender custody cannot be proved stopped", () =>
  Effect.gen(function* () {
    const attemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
    const records = yield* Ref.make(pendingPublicationRecords(attemptOrdinal))
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      observe: () => Effect.die("unproven prior sender custody forbids remote observation"),
      prepareSenderCustody: () => Effect.void,
      push: () => Effect.die("unproven prior sender custody forbids another push"),
      reconcileSenderCustody: () =>
        Effect.fail(
          new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: remotePublicationTargetForTest })
        )
    })
    const result = yield* makeRemotePublicationEngine(() => Ref.get(records))
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(result).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "PushCustodyUnproven" } })
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationRetained"
    ])
  })
)

it.effect("reserves sender custody before journaling a numbered attempt", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      observe: () =>
        Effect.succeed(
          RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
            remoteHead: candidate.run.session.expectedTargetHead
          })
        ),
      prepareSenderCustody: () =>
        Effect.fail(
          new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: remotePublicationTargetForTest })
        ),
      push: () => Effect.die("failed sender reservation forbids a push"),
      reconcileSenderCustody: () => Effect.die("a fresh publication has no prior sender to reconcile")
    })
    const result = yield* makeRemotePublicationEngine(() => Ref.get(records))
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(result).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "PushCustodyUnproven" } })
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationRetained"
    ])
  })
)

it.effect("retains an exact competing head without attempting a push", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Effect.succeed(
          RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
            mergeBase: candidate.run.session.expectedTargetHead,
            remoteHead: candidate.run.session.acceptedResult.commit
          })
        ),
      push: () => Effect.die("a competing head must retain work before push")
    })
    const result = yield* makeRemotePublicationEngine(() => Ref.get(records))
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(result).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "CompatibleCompetingHead" } })
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationRetained"
    ])
  })
)

it.effect("retains exact exhaustion without an ungranted fourth push intent", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const pushes = yield* Ref.make(0)
    const observations = yield* Ref.make(0)
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Ref.update(observations, (count) => count + 1).pipe(
          Effect.as(
            RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
              remoteHead: candidate.run.session.expectedTargetHead
            })
          )
        ),
      push: () =>
        Ref.update(pushes, (count) => count + 1).pipe(
          Effect.as(RemotePublicationPushResult.cases.RejectedNonFastForward.make({}))
        )
    })
    const engine = makeRemotePublicationEngine(() => Ref.get(records))
    let result = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    for (let activation = 1; activation <= 3; activation += 1) {
      result = yield* engine
        .runRemotePublication(candidate, remotePublicationTargetForTest, {
          runObservation: (phase) => phase,
          runSender: (phase) => phase
        })
        .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    }
    expect(result).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "AttemptsExhausted" } })
    expect(yield* Ref.get(observations)).toBe(4)
    expect(yield* Ref.get(pushes)).toBe(3)
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationRetained"
    ])
  })
)

const retainsConclusivePushResultAcrossRestart = (
  result: typeof RemotePublicationPushResult.Type,
  expectedCause: string
) =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const pushes = yield* Ref.make(0)
    const observations = yield* Ref.make(0)
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Ref.update(observations, (count) => count + 1).pipe(
          Effect.as(
            RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
              remoteHead: candidate.run.session.expectedTargetHead
            })
          )
        ),
      push: () => Ref.update(pushes, (count) => count + 1).pipe(Effect.as(result))
    })
    const engine = makeRemotePublicationEngine(() => Ref.get(records))
    const first = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    const restarted = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(first).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: expectedCause } })
    expect(restarted).toEqual(first)
    expect(yield* Ref.get(observations)).toBe(1)
    expect(yield* Ref.get(pushes)).toBe(1)
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "RemotePublicationIntended",
      "RemotePublicationAttemptIntended",
      "RemotePublicationRetained"
    ])
  })

it.effect("does not retry a durable throttled publication after restart", () =>
  retainsConclusivePushResultAcrossRestart(RemotePublicationPushResult.cases.Throttled.make({}), "Throttled")
)

it.effect("does not retry a durable policy denial after restart", () =>
  retainsConclusivePushResultAcrossRestart(
    RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Policy" }),
    "PolicyDenied"
  )
)

it.effect("retains a redacted ancestry-observation wait without automatic reread", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const observations = yield* Ref.make(0)
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Ref.update(observations, (count) => count + 1).pipe(
          Effect.andThen(
            Effect.fail(
              new RemotePublicationObservationFailure({
                reason: "AncestryUnavailable",
                target: remotePublicationTargetForTest
              })
            )
          )
        ),
      push: () => Effect.die("an unavailable ancestry read must not send")
    })
    const engine = makeRemotePublicationEngine(() => Ref.get(records))
    const first = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    const restarted = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(first).toMatchObject({
      _tag: "PublicationRetained",
      cause: { _tag: "ObservationUnavailable", reason: "AncestryUnavailable" }
    })
    expect(restarted).toEqual(first)
    expect(yield* Ref.get(observations)).toBe(1)
  })
)

it.effect("retains unproven push custody without a later observe or send", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const observations = yield* Ref.make(0)
    const pushes = yield* Ref.make(0)
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Ref.update(observations, (count) => count + 1).pipe(
          Effect.as(
            RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
              remoteHead: candidate.run.session.expectedTargetHead
            })
          )
        ),
      push: () =>
        Ref.update(pushes, (count) => count + 1).pipe(
          Effect.andThen(
            Effect.fail(
              new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: remotePublicationTargetForTest })
            )
          )
        )
    })
    const engine = makeRemotePublicationEngine(() => Ref.get(records))
    const first = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    const restarted = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(first).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "PushCustodyUnproven" } })
    expect(restarted).toEqual(first)
    expect(yield* Ref.get(observations)).toBe(1)
    expect(yield* Ref.get(pushes)).toBe(1)
  })
)

const reconcilesStoppedAmbiguousPush = (reason: "ResponseDeadline" | "TransportUnavailable") =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const observations = yield* Ref.make(0)
    const pushes = yield* Ref.make(0)
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("admission is outside the candidate publication protocol"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () =>
        Ref.modify(observations, (count) => [count, count + 1] as const).pipe(
          Effect.map((count) =>
            count === 0
              ? RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
                  remoteHead: candidate.run.session.expectedTargetHead
                })
              : RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: candidate.candidateCommit })
          )
        ),
      push: () =>
        Ref.update(pushes, (count) => count + 1).pipe(
          Effect.andThen(
            Effect.fail(new RemotePublicationPushFailure({ reason, target: remotePublicationTargetForTest }))
          )
        )
    })
    const engine = makeRemotePublicationEngine(() => Ref.get(records))
    const pending = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(pending).toMatchObject({ _tag: "PublicationPending" })
    const result = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provide(journalLayer(records)), Effect.provideService(RemotePublicationGit, git))
    expect(result).toMatchObject({ _tag: "PublicationSucceeded" })
    expect(yield* Ref.get(observations)).toBe(2)
    expect(yield* Ref.get(pushes)).toBe(1)
  })

it.effect("reconciles a response deadline only after the adapter proved sender stop", () =>
  reconcilesStoppedAmbiguousPush("ResponseDeadline")
)

it.effect("reconciles an ambiguous stopped transport failure before any repeated send", () =>
  reconcilesStoppedAmbiguousPush("TransportUnavailable")
)
