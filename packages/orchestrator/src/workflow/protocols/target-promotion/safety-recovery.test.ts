import { NodeFileSystem } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import { AcceptedResultEvidenceManifest, makeTaskWorkSpecification, WorktreeLocator } from "@dalph/contracts"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorCorrelationFor } from "../integrator/session.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import {
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushResult,
  PublishedIntegratorRunQualifiedCandidate
} from "../direct-publication/events.js"
import { runRemotePublication } from "../direct-publication/protocol-engine.js"
import { runTargetPromotion } from "./protocol.js"
import {
  TargetPromotionGit,
  TargetPromotionGitReadObservation,
  TargetPromotionCompareAndSetResult,
  TargetPromotionSafetyFailure,
  targetPromotionCorrelationFor
} from "./events.js"

import { EvidenceStore } from "../evidence-store.js"
import {
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  CompletionTaskClaim,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor
} from "../integration-finality/events.js"
import {
  authorizeCompletionTaskAttempt,
  runCompletionTaskProtocol
} from "../integration-finality/completion-task-protocol.js"
import { CompletionClaimBoundary, type CompletionClaimObservation } from "../integration-finality/completion-claim.js"
import { runCompletionClaimReplacementProtocol } from "../integration-finality/protocol.js"

const fixture = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Preserve publication and work across an occupied local integration target.",
  taskId: fixture.taskId,
  title: "Occupied integration target recovery"
})
const accepted = makeAcceptedIntegrationHistory({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: fixture.activeClaim,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: { ...fixture.plannedAttempt, taskRevision: specification.fingerprint },
  runId: fixture.runId,
  targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: specification,
  trackerTarget: fixture.target
})
const qualified = makePromotedIntegrationHistory({
  candidateCommit: fixture.qualifiedCandidate.candidateCommit,
  candidateText: fixture.qualifiedCandidate.candidateText,
  originalClaim: accepted.activeClaim,
  records: accepted.records,
  session: integratorCorrelationFor(accepted)
})
const candidate = qualified.qualifiedCandidate
const runId = candidate.run.session.plannedAttempt.runId

const seed = Effect.fn("PromotionSafetyRecovery.seed")(function* (store: JournalStore["Service"]) {
  const [beginning, ...records] = qualified.qualifiedRecords
  if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("missing qualified Run beginning")
  yield* store.beginRun(
    runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of records) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("unexpected terminal qualification prefix")
    }
    yield* store.append(runId, record.key, record.event)
  }
})

for (const lane of ["memory", "sqlite"] as const) {
  it.effect(
    `retains remote proof across an occupied target refusal and promotes after explicit checkout resolution in ${lane}`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-promotion-safety-recovery-" })
          const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
          const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
          const open = <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>) =>
            lane === "memory"
              ? use(memory)
              : Effect.scoped(
                  Effect.gen(function* () {
                    return yield* use(yield* JournalStore)
                  }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
                )
          yield* open(seed)
          const pushes = yield* Ref.make(0)
          const updates = yield* Ref.make(0)
          const occupied = yield* Ref.make(true)
          const applied = yield* Ref.make(false)
          const remote = RemotePublicationGit.of({
            admit: () => Effect.die("admission already retained"),
            prepareSenderCustody: () => Effect.void,
            reconcileSenderCustody: () => Effect.void,
            observe: () =>
              Effect.succeed(
                RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
                  remoteHead: candidate.run.session.expectedTargetHead
                })
              ),
            push: () =>
              Ref.update(pushes, (value) => value + 1).pipe(
                Effect.as(RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidate.candidateCommit }))
              )
          })
          const refusal = new TargetPromotionSafetyFailure({
            candidateCommit: candidate.candidateCommit,
            expectedHead: candidate.run.session.expectedTargetHead,
            target: candidate.run.session.integrationTarget,
            refusal: { _tag: "OccupiedWorktree", worktree: WorktreeLocator.make("/Alice/retained-work") }
          })
          const currentRefusal = yield* Ref.make(refusal)
          const promotion = TargetPromotionGit.of({
            read: () =>
              Effect.gen(function* () {
                if (yield* Ref.get(applied))
                  return TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
                    currentHeadSha: candidate.candidateCommit
                  })
                if (yield* Ref.get(occupied)) return yield* yield* Ref.get(currentRefusal)
                return TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                  currentHeadSha: candidate.run.session.expectedTargetHead
                })
              }),
            compareAndSet: () =>
              Effect.gen(function* () {
                if (yield* Ref.get(occupied)) return yield* yield* Ref.get(currentRefusal)
                yield* Ref.update(updates, (value) => value + 1)
                yield* Ref.set(applied, true)
                return TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidate.candidateCommit })
              })
          })
          const withJournal = <A, E, R>(
            store: JournalStore["Service"],
            effect: Effect.Effect<A, E, R>,
            storage: JournalStorageBoundary = store
          ) =>
            Effect.gen(function* () {
              const history = reduceWorkflowJournalHistory(runId, yield* store.read(runId))
              if (history._tag === "InvalidWorkflowJournalHistory")
                return yield* Effect.die("invalid retained promotion prefix")
              return yield* effect.pipe(Effect.provide(journalLayer(runId, fixture.target, history, storage)))
            })
          const published = yield* open((store) =>
            withJournal(
              store,
              runRemotePublication(candidate, remotePublicationTargetForTest, {
                runObservation: (phase) => phase,
                runSender: (phase) => phase
              }).pipe(Effect.provideService(RemotePublicationGit, remote))
            )
          )
          if (published._tag !== "PublicationSucceeded")
            return yield* Effect.die("controlled remote publication did not succeed")
          const publication = (yield* open((store) => store.read(runId))).find(
            ({ event }) => event._tag === "RemotePublicationSucceeded"
          )?.event
          if (publication?._tag !== "RemotePublicationSucceeded")
            return yield* Effect.die("missing durable remote publication proof")
          const handoff = PublishedIntegratorRunQualifiedCandidate.make({ candidate, publication })
          const promote = runTargetPromotion(handoff).pipe(Effect.provideService(TargetPromotionGit, promotion))
          // A failed append cannot become an invisible successful refusal or authorize CAS.
          const refusalAppendLoss = yield* open((store) =>
            withJournal(store, promote, {
              ...store,
              append: (id, key, event) =>
                event._tag === "TargetPromotionSafetyRefused"
                  ? Effect.die("controlled safety observation append loss")
                  : store.append(id, key, event)
            }).pipe(Effect.exit)
          )
          expect(refusalAppendLoss._tag).toBe("Failure")
          expect(yield* Ref.get(updates)).toBe(0)
          const blocked = yield* open((store) => withJournal(store, promote))
          expect(blocked).toMatchObject({ _tag: "PromotionSafetyRefused", refusal: refusal.refusal })
          const retained = yield* open((store) => store.read(runId))
          expect(retained.filter(({ event }) => event._tag === "RemotePublicationSucceeded")).toHaveLength(1)
          expect(retained.some(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toBe(false)
          expect(
            retained.some(
              ({ event }) => event._tag === "CompletionTaskIntended" || event._tag === "CompletionClaimReplaced"
            )
          ).toBe(false)
          expect(yield* Ref.get(updates)).toBe(0)
          // A new process reopens the same prefix while the same authority blocker remains.
          expect(yield* open((store) => withJournal(store, promote))).toMatchObject({
            _tag: "PromotionSafetyRefused",
            refusal: refusal.refusal
          })
          expect(yield* open((store) => store.read(runId))).toEqual(retained)
          // Changed boundary evidence gets a new observation identity, never a conflicting reuse of its key.
          yield* Ref.set(
            currentRefusal,
            new TargetPromotionSafetyFailure({
              candidateCommit: refusal.candidateCommit,
              expectedHead: refusal.expectedHead,
              target: refusal.target,
              refusal: { _tag: "InventoryUnreadable", detail: "controlled unreadable inventory" }
            })
          )
          expect(yield* open((store) => withJournal(store, promote))).toMatchObject({
            _tag: "PromotionSafetyRefused",
            observationOrdinal: 2,
            refusal: { _tag: "InventoryUnreadable" }
          })
          yield* Ref.set(currentRefusal, refusal)
          expect(yield* open((store) => withJournal(store, promote))).toMatchObject({
            _tag: "PromotionSafetyRefused",
            observationOrdinal: 3,
            refusal: refusal.refusal
          })
          yield* Ref.set(occupied, false)
          // A checkout appears after numbered intent but before the actual mutation boundary.
          const mutationRefusal = yield* open((store) =>
            withJournal(store, promote, {
              ...store,
              append: (id, key, event) =>
                store
                  .append(id, key, event)
                  .pipe(
                    Effect.tap(() =>
                      event._tag === "TargetPromotionAttemptIntended" ? Ref.set(occupied, true) : Effect.void
                    )
                  )
            })
          )
          expect(mutationRefusal).toMatchObject({ _tag: "PromotionSafetyRefused", refusal: refusal.refusal })
          expect(yield* Ref.get(updates)).toBe(0)
          const pending = yield* open((store) => store.read(runId))
          expect(pending.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
          expect(yield* open((store) => withJournal(store, promote))).toMatchObject({
            _tag: "PromotionSafetyRefused",
            refusal: refusal.refusal
          })
          const readRefused = yield* open((store) => store.read(runId))
          expect(readRefused.filter(({ event }) => event._tag === "TargetPromotionSafetyRefused")).toHaveLength(5)
          expect(yield* open((store) => withJournal(store, promote))).toMatchObject({
            _tag: "PromotionSafetyRefused",
            boundary: "ReconciliationRead"
          })
          expect(yield* open((store) => store.read(runId))).toEqual(readRefused)
          yield* Ref.set(occupied, false)
          // Lose the observation append after CAS applied. Recovery must read M, even if a checkout then appears.
          const loss = yield* open((store) =>
            withJournal(store, promote, {
              ...store,
              append: (id, key, event) =>
                event._tag === "TargetPromotionObservedSuccess"
                  ? Effect.die("process lost after applied CAS before observation")
                  : store.append(id, key, event)
            }).pipe(Effect.exit)
          )
          expect(loss._tag).toBe("Failure")
          yield* Ref.set(occupied, true)
          expect((yield* open((store) => withJournal(store, promote)))._tag).toBe("PromotionSucceeded")
          expect(yield* Ref.get(updates)).toBe(1)
          expect(yield* Ref.get(pushes)).toBe(1)
          const final = yield* open((store) => store.read(runId))
          expect(final.filter(({ event }) => event._tag === "TargetPromotionIntended")).toHaveLength(1)
          expect(final.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
          expect(final.filter(({ event }) => event._tag === "RemotePublicationSucceeded")).toHaveLength(1)
          const completionRequest = completionTaskRequestFor(
            CompletionTaskClaim.make({
              originalClaim: accepted.activeClaim,
              plannedAttempt: candidate.run.session.plannedAttempt,
              promotionCorrelation: targetPromotionCorrelationFor(candidate)
            })
          )
          const currentClaim = yield* Ref.make<CompletionClaimObservation>(accepted.activeClaim)
          const completionCalls = yield* Ref.make(0)
          const replacementBoundary = CompletionClaimBoundary.of({
            readOriginalTaskClaim: () => Effect.succeed(accepted.activeClaim),
            readTaskClaim: () => Ref.get(currentClaim),
            readCompletionClaimMarker: () => Effect.die("replacement does not read a completion marker"),
            replaceTaskClaim: (value) => Ref.set(currentClaim, value.claim).pipe(Effect.as(value.claim)),
            deleteTaskClaim: () => Effect.die("replacement does not delete the claim"),
            releaseOriginalTaskClaim: () => Effect.die("replacement does not release the original claim")
          })
          expect(
            (yield* open((store) =>
              withJournal(
                store,
                runCompletionClaimReplacementProtocol(
                  replacementBoundary,
                  completionClaimReplacementRequestFor(completionRequest.claim)
                )
              )
            ))._tag
          ).toBe("CompletionClaimReplaced")
          const manifest = AcceptedResultEvidenceManifest.make({
            commit: candidate.run.session.acceptedResult.commit,
            correlation: { attemptId: candidate.run.session.plannedAttempt.attemptId, runId },
            formatVersion: 1,
            outcome: "Accepted",
            predecessor: null
          })
          const evidence = EvidenceStore.of({
            put: () => Effect.die("finality only reads accepted evidence"),
            read: () => Effect.succeed(new TextEncoder().encode(JSON.stringify(manifest)))
          })
          const completionBoundary = CompletionTaskBoundary.of({
            completeTask: (value) =>
              Ref.update(completionCalls, (count) => count + 1).pipe(
                Effect.as(CompletionTaskAcknowledgement.make({ operationId: value.operationId, taskId: value.taskId }))
              ),
            readCompletionRequest: () => Effect.die("fresh completion does not require request lookup"),
            readFocusedTaskCompletion: ({ operationId }) =>
              Effect.succeed({
                ...fixture.focusedSuccessFactsEvent.observation.facts,
                currentClaim: completionRequest.claim,
                lifecycle: "Open" as const,
                taskRevision: candidate.run.session.plannedAttempt.taskRevision,
                operationId
              })
          })
          yield* open((store) =>
            withJournal(
              store,
              runCompletionTaskProtocol(completionBoundary, completionRequest, fixture.target, (ordinal) =>
                authorizeCompletionTaskAttempt(completionBoundary, completionRequest, fixture.target, ordinal)
              ).pipe(
                Effect.provideService(TargetPromotionGit, promotion),
                Effect.provideService(EvidenceStore, evidence)
              )
            )
          )
          expect(yield* Ref.get(completionCalls)).toBe(1)
          const completed = yield* open((store) => store.read(runId))
          const promotedAt = completed.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.position
          const completedAt = completed.find(({ event }) => event._tag === "CompletionTaskAcknowledged")?.position
          if (promotedAt === undefined) return yield* Effect.die("missing promotion before tracker completion")
          expect(completedAt).toBeGreaterThan(promotedAt)
        })
      ).pipe(Effect.provide(NodeFileSystem.layer))
  )
}
