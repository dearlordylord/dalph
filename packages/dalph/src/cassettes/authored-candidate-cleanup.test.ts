import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import {
  CoordinatorOwnership,
  IntegratorCandidateCleanupEvidenceSubject,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateResourceLocator,
  JournalStore,
  IntegratorSessionId,
  makeDispositionCleanupActivation,
  liveJournalTestLayer,
  runIntegratorCandidateCleanup
} from "@dalph/orchestrator"
import { authoredCandidateCleanupBoundaryLayer } from "./authored-candidate-cleanup.js"
import { AuthoredCassetteStoryItem } from "./authored-domain.js"
import { makeStoryCursor } from "./authored-cursor.js"
import {
  dispositionCleanupAuthoredCassetteCatalog,
  runDispositionCleanupCassette
} from "./disposition-cleanup-cassette.js"

const isCandidateCleanupEvent = (tag: string): boolean => tag.startsWith("IntegratorCandidateCleanup")

describe("authored candidate cleanup boundary", () => {
  it.effect("reconciles one lost FullRerun predecessor removal through fresh absence and settlement", () =>
    Effect.gen(function* () {
      const fixture = yield* runDispositionCleanupCassette(
        dispositionCleanupAuthoredCassetteCatalog.fullRerunPredecessorCandidate
      )
      const authorizationRecord = fixture.records.find(
        ({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized"
      )
      if (authorizationRecord?.event._tag !== "IntegratorCandidateCleanupAuthorized") {
        return yield* Effect.die("DS14-17 fixture is missing its candidate cleanup authorization")
      }
      const authorization = authorizationRecord.event.authorization
      const upstream = fixture.records.filter(
        ({ event }) => !isCandidateCleanupEvent(event._tag) && event._tag !== "WorkflowRunTerminated"
      )
      const firstRevision = authorization.evidenceRevision
      const absenceRevision = IntegratorCandidateCleanupEvidenceRevision.make(firstRevision + 1)
      const cursor = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.IntegratorCandidateCleanupObservationReturned.make({
          observation: IntegratorCandidateCleanupObservation.cases.Present.make({
            locator: authorization.locator,
            revision: firstRevision,
            sessionId: authorization.owner.sessionId,
            writerQuiescent: true
          })
        }),
        AuthoredCassetteStoryItem.cases.IntegratorCandidateCleanupRemovalReturned.make({
          result: IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: "provider removed C1 but its response was lost",
            locator: authorization.locator,
            sessionId: authorization.owner.sessionId
          })
        }),
        AuthoredCassetteStoryItem.cases.IntegratorCandidateCleanupObservationReturned.make({
          observation: IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: authorization.locator,
            revision: absenceRevision
          })
        })
      ])
      const ownership = Layer.succeed(
        CoordinatorOwnership,
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
      )
      const beginning = upstream[0]
      if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("cleanup fixture lacks Run beginning")
      const journal = liveJournalTestLayer({
        runId: beginning.runId,
        target: beginning.event.target,
        records: upstream
      })
      const cleanup = authoredCandidateCleanupBoundaryLayer(cursor).pipe(Layer.provide(ownership))

      const result = yield* Effect.gen(function* () {
        const first = yield* runIntegratorCandidateCleanup(authorization)
        const second = yield* runIntegratorCandidateCleanup(authorization)
        const records = yield* (yield* JournalStore).read(authorization.disposition.predecessor.plannedAttempt.runId)
        return { first, records, second }
      }).pipe(Effect.provide(Layer.merge(journal, cleanup)))

      expect(result.first._tag).toBe("Pending")
      expect(result.second._tag).toBe("Settled")
      expect(yield* cursor.storyPosition).toBe(3)
      expect(
        result.records.filter(({ event }) => event._tag === "IntegratorCandidateCleanupMutationIntended")
      ).toHaveLength(1)
      expect(
        result.records.some(
          ({ event }) =>
            event._tag === "IntegratorCandidateCleanupAbsenceConfirmed" &&
            event.cause === "MutationResponseReconciliation" &&
            event.observation.locator === authorization.locator
        )
      ).toBe(true)
      expect(result.records.filter(({ event }) => !isCandidateCleanupEvent(event._tag))).toEqual(upstream)
    })
  )

  it.effect("refuses a revision read for a different predecessor session before authorization or mutation", () =>
    Effect.gen(function* () {
      const fixture = yield* runDispositionCleanupCassette(
        dispositionCleanupAuthoredCassetteCatalog.fullRerunPredecessorCandidate
      )
      const authorizationRecord = fixture.records.find(
        ({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized"
      )
      if (authorizationRecord?.event._tag !== "IntegratorCandidateCleanupAuthorized") {
        return yield* Effect.die("DS14-17 fixture is missing its candidate cleanup authorization")
      }
      const authorization = authorizationRecord.event.authorization
      const upstream = fixture.records.filter(
        ({ event }) => !isCandidateCleanupEvent(event._tag) && event._tag !== "WorkflowRunTerminated"
      )
      const predecessor = authorization.disposition.predecessor
      const foreignLocator = IntegratorCandidateResourceLocator.make(
        "candidate:$authored-run:foreign-full-rerun-predecessor"
      )
      const cursor = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.IntegratorCandidateCleanupEvidenceRevisionReturned.make({
          revision: authorization.evidenceRevision,
          subject: IntegratorCandidateCleanupEvidenceSubject.make({
            locator: foreignLocator,
            predecessor: {
              ...predecessor,
              candidateResource: foreignLocator,
              sessionId: IntegratorSessionId.make("session:$authored-run:foreign-full-rerun-predecessor")
            }
          })
        })
      ])
      const ownership = Layer.succeed(
        CoordinatorOwnership,
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
      )
      const beginning = upstream[0]
      if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("cleanup fixture lacks Run beginning")
      const journal = liveJournalTestLayer({
        runId: beginning.runId,
        target: beginning.event.target,
        records: upstream
      })
      const cleanup = authoredCandidateCleanupBoundaryLayer(cursor, predecessor.plannedAttempt.runId).pipe(
        Layer.provide(ownership)
      )

      const records = yield* Effect.gen(function* () {
        const runId = authorization.disposition.predecessor.plannedAttempt.runId
        yield* makeDispositionCleanupActivation(runId).pipe(
          Effect.flatMap((activation) => activation.run),
          Effect.exit
        )
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(Layer.merge(journal, cleanup)))

      expect(yield* cursor.storyPosition).toBe(1)
      expect(records.some(({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized")).toBe(false)
      expect(records.some(({ event }) => event._tag === "IntegratorCandidateCleanupMutationIntended")).toBe(false)
    })
  )
})
