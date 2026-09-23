import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, FileSystem, HashSet, Layer, Path, Ref, Stream, type Scope } from "effect"
import { expect } from "vitest"
import { RemoteBaselineGit } from "../../workflow/protocols/direct-publication/baseline-events.js"
import { RemotePublicationGit } from "../../workflow/protocols/direct-publication/events.js"
import { JournalDatabaseLocator } from "../../workflow-journal/identity.js"
import { JournalStore, type JournalRecord } from "../../workflow-journal/store.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../../workflow-journal/adapters/sqlite-store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { makeSuccessorPrefix } from "../../../test/support/automatic-successor-history.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { DeliveryActionProposal, IdentityFreeDeliveryProposal } from "./delivery-action-proposal.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import { journalLayer, type JournalStorageBoundary } from "./journal.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type IdentityFreeTransition = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "AuthorizeIntegratorCompetingHeadSuccessor" }
>

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const inertLease: DeliveryActionExecutionLease = {
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    isActive: () => Effect.succeed(false),
    isHeld: () => Effect.succeed(false),
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilities: [], heldResponsibilities: [] }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("automatic authorization does not use the attempt protocol")
}

const unusedRemotePublicationGit = RemotePublicationGit.of({
  admit: () => Effect.die("authorization recovery does not publish"),
  observe: () => Effect.die("authorization recovery does not publish"),
  prepareSenderCustody: () => Effect.die("authorization recovery does not publish"),
  push: () => Effect.die("authorization recovery does not publish"),
  reconcileSenderCustody: () => Effect.die("authorization recovery does not publish")
})

const seedRecords = Effect.fn("AutomaticSuccessorAuthorizationRecovery.seedRecords")(function* (
  store: JournalStore["Service"],
  runId: JournalRecord["runId"],
  records: ReadonlyArray<JournalRecord>
) {
  const [beginning, ...remaining] = records
  if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("accepted history must begin the Run")
  yield* store.beginRun(
    runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of remaining) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("authorization prefix may not contain another Run lifecycle event")
    }
    yield* store.append(runId, record.key, record.event)
  }
})

it.effect(
  "recovers a lost automatic authorization acknowledgement without another Git read across memory and reopened SQLite",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const authorized = fixture
          .records()
          .find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        if (authorized?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized") {
          return yield* Effect.die("fixture must contain its exact accepted automatic authorization")
        }
        const seed = fixture.records().filter(({ position }) => Number(position) < Number(authorized.position))
        const authorization: IdentityFreeTransition =
          RunnableFrontierTransition.AuthorizeIntegratorCompetingHeadSuccessor({
            authorizationId: authorized.event.authorizationId,
            correlation: authorized.event.correlation,
            mergeBase: authorized.event.mergeBase,
            remoteHead: authorized.event.remoteHead,
            remotePublicationRetainedAt: authorized.event.remotePublicationRetainedAt,
            responsibility: fixture.accepted.responsibility
          })
        const proposals = deliveryProposalsOf({
          acceptedOperationIds: HashSet.empty(),
          fresh: [],
          integrationResponsibilities: [fixture.accepted.responsibility],
          responsibilities: [],
          runId: fixture.runId,
          transitions: [authorization]
        })
        const proposal = [...proposals.ticketDelivery, ...proposals.deliverySettlement][0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
          return yield* Effect.die("exact automatic authorization must have an identity-free action")
        }
        const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }

        const appendCalls = yield* Ref.make(0)
        const gitCalls = yield* Ref.make(0)
        const loseMemoryAcknowledgement = yield* Ref.make(false)
        const remoteBaselineGit = RemoteBaselineGit.of({
          catchUp: () =>
            Ref.update(gitCalls, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("authorization must not catch up"))
            ),
          observe: () =>
            Ref.update(gitCalls, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("authorization must not read Git"))
            ),
          reconcileCatchUp: () =>
            Ref.update(gitCalls, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("authorization must not reconcile Git"))
            )
        })

        const storageBoundary = (
          store: JournalStore["Service"],
          loseAcknowledgementAfterCommit: Ref.Ref<boolean> | undefined,
          failBeforeCommit: boolean
        ): JournalStorageBoundary => ({
          append: (runId, key, event) =>
            Ref.update(appendCalls, (count) => count + 1).pipe(
              Effect.andThen(
                failBeforeCommit && key === authorized.key
                  ? Effect.die("process stopped before automatic authorization append committed")
                  : store.append(runId, key, event)
              ),
              Effect.flatMap((record) => {
                if (loseAcknowledgementAfterCommit === undefined || key !== authorized.key)
                  return Effect.succeed(record)
                return Ref.modify(loseAcknowledgementAfterCommit, (alreadyLost): [boolean, boolean] => [
                  alreadyLost,
                  true
                ]).pipe(
                  Effect.flatMap((alreadyLost) =>
                    alreadyLost
                      ? Effect.succeed(record)
                      : Effect.die("process lost after automatic authorization committed")
                  )
                )
              })
            ),
          read: store.read,
          terminateRun: store.terminateRun
        })

        const runProcess = (
          store: JournalStore["Service"],
          loseAcknowledgementAfterCommit?: Ref.Ref<boolean>,
          failBeforeCommit = false
        ) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(`reopened authorization prefix is invalid: ${JSON.stringify(history.issues)}`)
              }
              return yield* executeIntegrationAction(
                action,
                authorization,
                inertLease,
                fixture.accepted.trackerTarget
              ).pipe(
                Effect.provide(
                  journalLayer(
                    fixture.runId,
                    fixture.accepted.trackerTarget,
                    history,
                    storageBoundary(store, loseAcknowledgementAfterCommit, failBeforeCommit)
                  )
                ),
                Effect.provideService(RemoteBaselineGit, remoteBaselineGit),
                Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
              )
            })
          )

        const expectExactAuthorization = (records: ReadonlyArray<JournalRecord>) => {
          const persisted = records.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          expect(persisted).toHaveLength(1)
          expect(persisted[0]?.key).toBe(authorized.key)
          expect(persisted[0]?.event).toEqual(authorized.event)
          expect(persisted[0]?.position).toBe(authorized.position)
          expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        }

        const expectNoAuthorizationEffects = (records: ReadonlyArray<JournalRecord>) => {
          expect(
            records.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          ).toHaveLength(0)
          expect(records.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(0)
          expect(records.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(0)
          expect(records.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(0)
          expect(records.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(0)
          expect(records.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(
            0
          )
          expect(records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
          expect(records.filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
          expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        }

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore, fixture.runId, seed)
        const memoryPrecommitFailure = yield* Effect.exit(runProcess(memoryStore, undefined, true))
        expect(memoryPrecommitFailure._tag).toBe("Failure")
        expectNoAuthorizationEffects(yield* memoryStore.read(fixture.runId))
        expect(yield* Ref.get(gitCalls)).toBe(0)
        expect(yield* Ref.get(appendCalls)).toBe(1)

        const memoryInterrupted = yield* Effect.exit(runProcess(memoryStore, loseMemoryAcknowledgement))
        expect(memoryInterrupted._tag).toBe("Failure")
        expectExactAuthorization(yield* memoryStore.read(fixture.runId))
        expect(yield* Ref.get(appendCalls)).toBe(2)
        expect(yield* runProcess(memoryStore)).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
        expectExactAuthorization(yield* memoryStore.read(fixture.runId))
        expect(yield* Ref.get(appendCalls)).toBe(2)
        expect(yield* Ref.get(gitCalls)).toBe(0)

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "dalph-automatic-authorization-recovery-"
        })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          failure?: "BeforeCommit" | "AfterCommit"
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                failure === "BeforeCommit"
                  ? sqliteJournalTestLayer({
                      filename,
                      onAppendKeyLookup: (_runId, key) =>
                        key === authorized.key
                          ? Effect.die("process stopped before automatic authorization insert")
                          : Effect.void
                    })
                  : failure === "AfterCommit"
                    ? sqliteJournalTestLayer({
                        filename,
                        afterAppendCommit: () => Effect.fail("simulated lost authorization acknowledgement")
                      })
                    : sqliteJournalStoreLayer({ filename })
              )
            )
          )

        yield* openSqlite((store) => seedRecords(store, fixture.runId, seed))
        const sqlitePrecommitFailure = yield* Effect.exit(openSqlite((store) => runProcess(store), "BeforeCommit"))
        expect(sqlitePrecommitFailure._tag).toBe("Failure")
        expectNoAuthorizationEffects(yield* openSqlite((store) => store.read(fixture.runId)))
        expect(yield* Ref.get(gitCalls)).toBe(0)
        expect(yield* Ref.get(appendCalls)).toBe(3)

        const sqliteInterrupted = yield* Effect.exit(openSqlite((store) => runProcess(store), "AfterCommit"))
        expect(sqliteInterrupted._tag).toBe("Failure")
        expectExactAuthorization(yield* openSqlite((store) => store.read(fixture.runId)))
        expect(yield* Ref.get(appendCalls)).toBe(4)
        expect(yield* openSqlite((store) => runProcess(store))).toMatchObject({
          _tag: "ActionCompleted",
          proposalId: proposal.id
        })
        expectExactAuthorization(yield* openSqlite((store) => store.read(fixture.runId)))
        expect(yield* Ref.get(appendCalls)).toBe(4)
        expect(yield* Ref.get(gitCalls)).toBe(0)
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)
