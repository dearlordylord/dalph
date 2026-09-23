import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { type GitCommitSha } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Path, Ref, type Scope } from "effect"
import { makeSuccessorPrefix } from "../../../../test/support/automatic-successor-history.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineFailure,
  RemoteBaselineObservation,
  type RemoteBaselineGitService
} from "./baseline-events.js"
import { establishRemoteBaseline } from "./baseline-protocol-engine.js"
import { validateRemoteBaselineState } from "./baseline-transition-journal.js"
import type { RemoteBaselineState } from "./baseline-state.js"

it.effect("reconciles one applied automatic-successor catch-up CAS after memory and reopened SQLite process loss", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = makeSuccessorPrefix()
      const records = fixture.records()
      const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      const baselineRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
      if (
        authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
        baselineRead?.event._tag !== "RemoteBaselineReadIntended"
      ) {
        return yield* Effect.die("accepted successor fixture must bind one authorization-scoped baseline")
      }
      const correlation = baselineRead.event.correlation
      if (correlation.automaticCompetingHeadAuthorizationAt !== authorization.position) {
        return yield* Effect.die("successor baseline must carry its exact authorization position")
      }
      const seed = records.filter(({ position }) => Number(position) < Number(baselineRead.position))
      const localHead = fixture.input.predecessor.expectedTargetHead
      const remoteHead = authorization.event.remoteHead

      const seedRecords = Effect.fn("AutomaticSuccessorBaselineRecovery.seedRecords")(function* (
        store: JournalStore["Service"]
      ) {
        const [beginning, ...remaining] = seed
        if (beginning?.event._tag !== "WorkflowRunBegan")
          return yield* Effect.die("accepted history must begin the Run")
        yield* store.beginRun(
          fixture.runId,
          beginning.event.target,
          beginning.event.initialControlPolicy,
          beginning.event.remotePublicationTarget
        )
        for (const record of remaining) {
          if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
            return yield* Effect.die("authorization prefix may not contain another Run lifecycle event")
          }
          yield* store.append(fixture.runId, record.key, record.event)
        }
      })

      const runProcess = (store: JournalStore["Service"], git: RemoteBaselineGitService) =>
        Effect.scoped(
          Effect.gen(function* () {
            const stored = yield* store.read(fixture.runId)
            const history = reduceWorkflowJournalHistory(fixture.runId, stored)
            if (history._tag === "InvalidWorkflowJournalHistory") {
              return yield* Effect.die(
                `reopened successor baseline prefix is invalid: ${JSON.stringify(history.issues)}`
              )
            }
            return yield* establishRemoteBaseline(correlation).pipe(
              Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, store)),
              Effect.provideService(RemoteBaselineGit, git)
            )
          })
        )

      const makeGit = (
        currentLocalHead: Ref.Ref<GitCommitSha>,
        timeline: Ref.Ref<ReadonlyArray<string>>,
        loseAfterAppliedCatchUp: boolean
      ): RemoteBaselineGitService =>
        RemoteBaselineGit.of({
          observe: (observedCorrelation) =>
            Effect.sync(() => expect(observedCorrelation).toEqual(correlation)).pipe(
              Effect.andThen(Ref.update(timeline, (items) => [...items, "observe"])),
              Effect.as(RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead }))
            ),
          catchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
            Effect.gen(function* () {
              yield* Ref.update(timeline, (items) => [...items, "catch-up"])
              expect(receivedCorrelation).toEqual(correlation)
              expect(expectedLocalHead).toBe(localHead)
              expect(observedRemoteHead).toBe(remoteHead)
              const current = yield* Ref.get(currentLocalHead)
              if (current !== expectedLocalHead) {
                return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: current })
              }
              yield* Ref.set(currentLocalHead, observedRemoteHead)
              if (loseAfterAppliedCatchUp)
                return yield* Effect.die("process lost after catch-up CAS before observation append")
              return LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead })
            }),
          reconcileCatchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
            Effect.gen(function* () {
              yield* Ref.update(timeline, (items) => [...items, "reconcile-catch-up"])
              expect(receivedCorrelation).toEqual(correlation)
              expect(expectedLocalHead).toBe(localHead)
              expect(observedRemoteHead).toBe(remoteHead)
              const current = yield* Ref.get(currentLocalHead)
              if (current === observedRemoteHead)
                return LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: current })
              if (current !== expectedLocalHead)
                return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: current })
              yield* Ref.set(currentLocalHead, observedRemoteHead)
              return LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead })
            })
        })

      const expectNoNewAuthorizationOrSuccessor = (persisted: ReadonlyArray<JournalRecord>) => {
        expect(
          persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        ).toHaveLength(1)
        expect(persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(
          0
        )
        expect(persisted.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
        expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
      }

      const expectRecoveredIntent = (persisted: ReadonlyArray<JournalRecord>) => {
        const catchUpIntents = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
        const observations = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        expect(catchUpIntents).toHaveLength(1)
        expect(catchUpIntents[0]?.event).toMatchObject({ correlation, expectedLocalHead: localHead, remoteHead })
        expect(observations).toHaveLength(1)
        expect(observations[0]?.event).toMatchObject({
          correlation,
          expectedLocalHead: localHead,
          remoteHead,
          result: { _tag: "AlreadyCurrent", currentHead: remoteHead }
        })
        expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
        expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(1)
        expectNoNewAuthorizationOrSuccessor(persisted)
      }

      const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
      const memoryStore = Context.get(memoryContext, JournalStore)
      yield* seedRecords(memoryStore)
      const memoryLocal = yield* Ref.make(localHead)
      const memoryTimeline = yield* Ref.make<ReadonlyArray<string>>([])
      const firstMemoryGit = makeGit(memoryLocal, memoryTimeline, false)
      expect((yield* runProcess(memoryStore, firstMemoryGit))._tag).toBe("CatchUpRequired")
      expect(yield* Ref.get(memoryTimeline)).toEqual(["observe"])
      const applyingMemoryGit = makeGit(memoryLocal, memoryTimeline, true)
      const memoryLoss = yield* Effect.exit(runProcess(memoryStore, applyingMemoryGit))
      expect(memoryLoss._tag).toBe("Failure")
      expect(yield* Ref.get(memoryLocal)).toBe(remoteHead)
      expect(
        (yield* memoryStore.read(fixture.runId)).filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
      ).toHaveLength(1)
      expect(
        (yield* memoryStore.read(fixture.runId)).filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
      ).toHaveLength(0)
      const recoveryMemoryGit = makeGit(memoryLocal, memoryTimeline, false)
      expect((yield* runProcess(memoryStore, recoveryMemoryGit))._tag).toBe("Ready")
      expect(yield* Ref.get(memoryTimeline)).toEqual(["observe", "catch-up", "reconcile-catch-up"])
      expectRecoveredIntent(yield* memoryStore.read(fixture.runId))

      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-automatic-baseline-recovery-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const openSqlite = <A>(
        use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>
      ): Effect.Effect<A, unknown, Scope.Scope> =>
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* JournalStore
            return yield* use(store)
          }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
        )

      yield* openSqlite(seedRecords)
      const sqliteLocal = yield* Ref.make(localHead)
      const sqliteTimeline = yield* Ref.make<ReadonlyArray<string>>([])
      expect((yield* openSqlite((store) => runProcess(store, makeGit(sqliteLocal, sqliteTimeline, false))))._tag).toBe(
        "CatchUpRequired"
      )
      expect(yield* Ref.get(sqliteTimeline)).toEqual(["observe"])
      const sqliteLoss = yield* Effect.exit(
        openSqlite((store) => runProcess(store, makeGit(sqliteLocal, sqliteTimeline, true)))
      )
      expect(sqliteLoss._tag).toBe("Failure")
      expect(yield* Ref.get(sqliteLocal)).toBe(remoteHead)
      const durableCut = yield* openSqlite((store) => store.read(fixture.runId))
      expect(durableCut.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(1)
      expect(durableCut.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(0)
      expectNoNewAuthorizationOrSuccessor(durableCut)
      expect((yield* openSqlite((store) => runProcess(store, makeGit(sqliteLocal, sqliteTimeline, false))))._tag).toBe(
        "Ready"
      )
      expect(yield* Ref.get(sqliteTimeline)).toEqual(["observe", "catch-up", "reconcile-catch-up"])
      expectRecoveredIntent(yield* openSqlite((store) => store.read(fixture.runId)))
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
)

it.effect(
  "recovers the exact automatic-successor baseline observation after a lost acknowledgement and then catches up once",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const records = fixture.records()
        const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        const baselineRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        const expectedObservation = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
        const expectedCatchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
        const expectedCatchUpObservation = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          baselineRead?.event._tag !== "RemoteBaselineReadIntended" ||
          expectedObservation?.event._tag !== "RemoteBaselineObserved" ||
          expectedCatchUpIntent?.event._tag !== "LocalTargetCatchUpIntended" ||
          expectedCatchUpObservation?.event._tag !== "LocalTargetCatchUpObserved"
        ) {
          return yield* Effect.die("accepted successor fixture must contain the exact authorized baseline and catch-up")
        }
        const correlation = baselineRead.event.correlation
        if (correlation.automaticCompetingHeadAuthorizationAt !== authorization.position) {
          return yield* Effect.die("successor baseline must carry its exact authorization position")
        }
        const seed = records.filter(({ position }) => Number(position) < Number(baselineRead.position))
        const appendCalls = yield* Ref.make(0)
        const loseMemoryAcknowledgement = yield* Ref.make(false)
        const gitTimeline = yield* Ref.make<ReadonlyArray<string>>([])
        const remoteHead = authorization.event.remoteHead
        const localHead = fixture.input.predecessor.expectedTargetHead

        const seedRecords = Effect.fn("AutomaticSuccessorBaselineObservationRecovery.seedRecords")(function* (
          store: JournalStore["Service"]
        ) {
          const [beginning, ...remaining] = seed
          if (beginning?.event._tag !== "WorkflowRunBegan")
            return yield* Effect.die("accepted history must begin the Run")
          yield* store.beginRun(
            fixture.runId,
            beginning.event.target,
            beginning.event.initialControlPolicy,
            beginning.event.remotePublicationTarget
          )
          for (const record of remaining) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
              return yield* Effect.die("authorization prefix may not contain another Run lifecycle event")
            }
            yield* store.append(fixture.runId, record.key, record.event)
          }
        })

        const storageBoundary = (
          store: JournalStore["Service"],
          loseAcknowledgementAfterCommit?: Ref.Ref<boolean>
        ): JournalStorageBoundary => ({
          append: (runId, key, event) =>
            Ref.update(appendCalls, (count) => count + 1).pipe(
              Effect.andThen(store.append(runId, key, event)),
              Effect.flatMap((record) => {
                if (event._tag !== "RemoteBaselineObserved" || loseAcknowledgementAfterCommit === undefined) {
                  return Effect.succeed(record)
                }
                return Ref.modify(loseAcknowledgementAfterCommit, (lost): [boolean, boolean] => [lost, true]).pipe(
                  Effect.flatMap((lost) =>
                    lost
                      ? Effect.succeed(record)
                      : Effect.die("process lost after auth-scoped baseline observation committed")
                  )
                )
              })
            ),
          read: store.read,
          terminateRun: store.terminateRun
        })

        const git = RemoteBaselineGit.of({
          observe: (observedCorrelation) =>
            Effect.sync(() => expect(observedCorrelation).toEqual(correlation)).pipe(
              Effect.andThen(Ref.update(gitTimeline, (items) => [...items, "observe"])),
              Effect.as(RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead }))
            ),
          catchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
            Effect.sync(() => {
              expect(receivedCorrelation).toEqual(correlation)
              expect(expectedLocalHead).toBe(localHead)
              expect(observedRemoteHead).toBe(remoteHead)
            }).pipe(
              Effect.andThen(Ref.update(gitTimeline, (items) => [...items, "catch-up"])),
              Effect.as(LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead }))
            ),
          reconcileCatchUp: () =>
            Ref.update(gitTimeline, (items) => [...items, "reconcile-catch-up"]).pipe(
              Effect.andThen(Effect.die("observation recovery must stop before catch-up reconciliation"))
            )
        })

        const runObservation = (store: JournalStore["Service"], loseAcknowledgementAfterCommit?: Ref.Ref<boolean>) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(`reopened baseline prefix is invalid: ${JSON.stringify(history.issues)}`)
              }
              return yield* establishRemoteBaseline(correlation).pipe(
                Effect.provide(
                  journalLayer(
                    fixture.runId,
                    fixture.accepted.trackerTarget,
                    history,
                    storageBoundary(store, loseAcknowledgementAfterCommit)
                  )
                ),
                Effect.provideService(RemoteBaselineGit, git)
              )
            })
          )

        const assertExactHistory = (persisted: ReadonlyArray<JournalRecord>, catchUpSettled: boolean) => {
          const readIntents = persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")
          const observations = persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")
          expect(readIntents).toHaveLength(1)
          expect(readIntents[0]?.key).toBe(baselineRead.key)
          expect(readIntents[0]?.event).toEqual(baselineRead.event)
          expect(observations).toHaveLength(1)
          expect(observations[0]?.key).toBe(expectedObservation.key)
          expect(observations[0]?.event).toEqual(expectedObservation.event)
          expect(observations[0]?.position).toBe(expectedObservation.position)
          const catchUpIntents = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
          const catchUpObservations = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
          if (catchUpSettled) {
            expect(catchUpIntents).toHaveLength(1)
            expect(catchUpIntents[0]?.key).toBe(expectedCatchUpIntent.key)
            expect(catchUpIntents[0]?.event).toEqual(expectedCatchUpIntent.event)
            expect(catchUpObservations).toHaveLength(1)
            expect(catchUpObservations[0]?.key).toBe(expectedCatchUpObservation.key)
            expect(catchUpObservations[0]?.event).toEqual(expectedCatchUpObservation.event)
          } else {
            expect(catchUpIntents).toHaveLength(0)
            expect(catchUpObservations).toHaveLength(0)
          }
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          ).toHaveLength(1)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
          ).toHaveLength(0)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
        }

        const assertRecoveredState = (
          persisted: ReadonlyArray<JournalRecord>,
          expectedTag: "CatchUpRequired" | "Ready"
        ) =>
          Effect.gen(function* () {
            const history = reduceWorkflowJournalHistory(fixture.runId, persisted)
            if (history._tag === "InvalidWorkflowJournalHistory") {
              return yield* Effect.die(
                `committed baseline observation must remain accepted: ${JSON.stringify(history.issues)}`
              )
            }
            const state = yield* validateRemoteBaselineState(history.prefix, correlation)
            expect(state._tag).toBe(expectedTag)
            if (expectedTag === "CatchUpRequired") {
              expect(state).toMatchObject({
                _tag: "CatchUpRequired",
                correlation,
                expectedLocalHead: localHead,
                remoteHead
              })
            }
          })

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore)
        const memoryLoss = yield* Effect.exit(runObservation(memoryStore, loseMemoryAcknowledgement))
        expect(memoryLoss._tag).toBe("Failure")
        const memoryAfterCut = yield* memoryStore.read(fixture.runId)
        assertExactHistory(memoryAfterCut, false)
        yield* assertRecoveredState(memoryAfterCut, "CatchUpRequired")
        expect(yield* Ref.get(appendCalls)).toBe(2)
        expect(yield* Ref.get(gitTimeline)).toEqual(["observe"])
        expect((yield* runObservation(memoryStore))._tag).toBe("Ready")
        const memoryRecovered = yield* memoryStore.read(fixture.runId)
        assertExactHistory(memoryRecovered, true)
        yield* assertRecoveredState(memoryRecovered, "Ready")
        expect(yield* Ref.get(appendCalls)).toBe(4)
        expect(yield* Ref.get(gitTimeline)).toEqual(["observe", "catch-up"])

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-automatic-observation-recovery-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const sqliteCommitCount = yield* Ref.make(0)
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          loseObservationAcknowledgement = false
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                loseObservationAcknowledgement
                  ? sqliteJournalTestLayer({
                      filename,
                      afterAppendCommit: () =>
                        Ref.updateAndGet(sqliteCommitCount, (count) => count + 1).pipe(
                          Effect.flatMap((count) =>
                            count === 2 ? Effect.fail("simulated lost observation acknowledgement") : Effect.void
                          )
                        )
                    })
                  : sqliteJournalStoreLayer({ filename })
              )
            )
          )

        yield* Ref.set(appendCalls, 0)
        yield* Ref.set(gitTimeline, [])
        yield* openSqlite(seedRecords)
        const sqliteLoss = yield* Effect.exit(openSqlite((store) => runObservation(store), true))
        expect(sqliteLoss._tag).toBe("Failure")
        const sqliteAfterCut = yield* openSqlite((store) => store.read(fixture.runId))
        assertExactHistory(sqliteAfterCut, false)
        yield* assertRecoveredState(sqliteAfterCut, "CatchUpRequired")
        expect(yield* Ref.get(appendCalls)).toBe(2)
        expect(yield* Ref.get(gitTimeline)).toEqual(["observe"])
        expect((yield* openSqlite((store) => runObservation(store)))._tag).toBe("Ready")
        const sqliteRecovered = yield* openSqlite((store) => store.read(fixture.runId))
        assertExactHistory(sqliteRecovered, true)
        yield* assertRecoveredState(sqliteRecovered, "Ready")
        expect(yield* Ref.get(appendCalls)).toBe(4)
        expect(yield* Ref.get(gitTimeline)).toEqual(["observe", "catch-up"])
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect(
  "recovers precommit automatic-successor baseline intent and observation failures with one read per activation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const records = fixture.records()
        const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        const baselineRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        const expectedObservation = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          baselineRead?.event._tag !== "RemoteBaselineReadIntended" ||
          expectedObservation?.event._tag !== "RemoteBaselineObserved"
        ) {
          return yield* Effect.die("accepted successor fixture must contain its exact auth-scoped baseline")
        }
        const correlation = baselineRead.event.correlation
        if (correlation.automaticCompetingHeadAuthorizationAt !== authorization.position) {
          return yield* Effect.die("baseline read must carry the exact automatic authorization position")
        }
        const seed = records.filter(({ position }) => Number(position) < Number(baselineRead.position))
        const remoteHead = authorization.event.remoteHead
        const localHead = fixture.input.predecessor.expectedTargetHead
        const gitTimeline = yield* Ref.make<ReadonlyArray<string>>([])

        const seedRecords = Effect.fn("AutomaticSuccessorBaselineAppendFailureRecovery.seedRecords")(function* (
          store: JournalStore["Service"]
        ) {
          const [beginning, ...remaining] = seed
          if (beginning?.event._tag !== "WorkflowRunBegan")
            return yield* Effect.die("accepted history must begin the Run")
          yield* store.beginRun(
            fixture.runId,
            beginning.event.target,
            beginning.event.initialControlPolicy,
            beginning.event.remotePublicationTarget
          )
          for (const record of remaining) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
              return yield* Effect.die("automatic baseline prefix may not contain another Run lifecycle event")
            }
            yield* store.append(fixture.runId, record.key, record.event)
          }
        })

        const storageBoundary = (
          store: JournalStore["Service"],
          failBeforeCommit: "ReadIntent" | "Observation" | undefined
        ): JournalStorageBoundary => ({
          append: (runId, key, event) => {
            if (failBeforeCommit === "ReadIntent" && event._tag === "RemoteBaselineReadIntended") {
              return Effect.die("process stopped before automatic baseline read intent committed")
            }
            if (failBeforeCommit === "Observation" && event._tag === "RemoteBaselineObserved") {
              return Effect.die("process stopped before automatic baseline observation committed")
            }
            return store.append(runId, key, event)
          },
          read: store.read,
          terminateRun: store.terminateRun
        })

        const remoteBaselineGit = RemoteBaselineGit.of({
          observe: (receivedCorrelation) =>
            Effect.sync(() => expect(receivedCorrelation).toEqual(correlation)).pipe(
              Effect.andThen(Ref.update(gitTimeline, (calls) => [...calls, "observe"])),
              Effect.as(RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead }))
            ),
          catchUp: () =>
            Ref.update(gitTimeline, (calls) => [...calls, "catch-up"]).pipe(
              Effect.andThen(Effect.die("baseline append recovery must stop at CatchUpRequired"))
            ),
          reconcileCatchUp: () =>
            Ref.update(gitTimeline, (calls) => [...calls, "reconcile-catch-up"]).pipe(
              Effect.andThen(Effect.die("baseline append recovery must not start catch-up"))
            )
        })

        const runProcess = (
          store: JournalStore["Service"],
          failBeforeCommit: "ReadIntent" | "Observation" | undefined
        ): Effect.Effect<RemoteBaselineState, unknown> =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(`reopened baseline history is invalid: ${JSON.stringify(history.issues)}`)
              }
              return yield* establishRemoteBaseline(correlation).pipe(
                Effect.provide(
                  journalLayer(
                    fixture.runId,
                    fixture.accepted.trackerTarget,
                    history,
                    storageBoundary(store, failBeforeCommit)
                  )
                ),
                Effect.provideService(RemoteBaselineGit, remoteBaselineGit)
              )
            })
          )

        const expectHistory = (
          persisted: ReadonlyArray<JournalRecord>,
          hasReadIntent: boolean,
          hasObservation: boolean
        ) => {
          const readIntents = persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")
          const observations = persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")
          expect(readIntents).toHaveLength(hasReadIntent ? 1 : 0)
          if (hasReadIntent) {
            expect(readIntents[0]?.key).toBe(baselineRead.key)
            expect(readIntents[0]?.event).toEqual(baselineRead.event)
            expect(readIntents[0]?.position).toBe(baselineRead.position)
          }
          expect(observations).toHaveLength(hasObservation ? 1 : 0)
          if (hasObservation) {
            expect(observations[0]?.key).toBe(expectedObservation.key)
            expect(observations[0]?.event).toEqual(expectedObservation.event)
            expect(observations[0]?.position).toBe(expectedObservation.position)
          }
          expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(0)
          expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(0)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          ).toHaveLength(1)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
          ).toHaveLength(0)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
        }

        const exercise = <R>(
          open: (fault: "ReadIntent" | "Observation" | undefined) => Effect.Effect<RemoteBaselineState, unknown, R>,
          readCurrent: () => Effect.Effect<ReadonlyArray<JournalRecord>, unknown, R>
        ) =>
          Effect.gen(function* () {
            const intentFailure = yield* Effect.exit(open("ReadIntent"))
            expect(intentFailure._tag).toBe("Failure")
            expect(yield* Ref.get(gitTimeline)).toEqual([])
            expectHistory(yield* readCurrent(), false, false)

            const observationFailure = yield* Effect.exit(open("Observation"))
            expect(observationFailure._tag).toBe("Failure")
            expect(yield* Ref.get(gitTimeline)).toEqual(["observe"])
            expectHistory(yield* readCurrent(), true, false)

            expect((yield* open(undefined))._tag).toBe("CatchUpRequired")
            expect(yield* Ref.get(gitTimeline)).toEqual(["observe", "observe"])
            expectHistory(yield* readCurrent(), true, true)
          })

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore)
        yield* exercise(
          (fault) => runProcess(memoryStore, fault),
          () => memoryStore.read(fixture.runId)
        )

        yield* Ref.set(gitTimeline, [])
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "dalph-automatic-baseline-append-failure-recovery-"
        })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          failBeforeCommit?: "ReadIntent" | "Observation"
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                failBeforeCommit === undefined
                  ? sqliteJournalStoreLayer({ filename })
                  : sqliteJournalTestLayer({
                      filename,
                      onAppendKeyLookup: (_runId, key) =>
                        failBeforeCommit === "ReadIntent" && key === baselineRead.key
                          ? Effect.die("process stopped before automatic baseline read intent insert")
                          : failBeforeCommit === "Observation" && key === expectedObservation.key
                            ? Effect.die("process stopped before automatic baseline observation insert")
                            : Effect.void
                    })
              )
            )
          )

        yield* openSqlite((store) => seedRecords(store))
        yield* exercise(
          (fault) =>
            openSqlite(
              (store) => runProcess(store, undefined),
              fault === "ReadIntent" || fault === "Observation" ? fault : undefined
            ),
          () => openSqlite((store) => store.read(fixture.runId))
        )
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect(
  "keeps an ambiguous ResponseDeadline catch-up pending until a later activation reconciles the exact old head",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const records = fixture.records()
        const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        const baselineRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        const expectedBaselineObservation = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
        const expectedCatchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
        const expectedCatchUpObservation = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          baselineRead?.event._tag !== "RemoteBaselineReadIntended" ||
          expectedBaselineObservation?.event._tag !== "RemoteBaselineObserved" ||
          expectedCatchUpIntent?.event._tag !== "LocalTargetCatchUpIntended" ||
          expectedCatchUpObservation?.event._tag !== "LocalTargetCatchUpObserved"
        ) {
          return yield* Effect.die("accepted fixture must contain one complete automatic baseline and catch-up")
        }
        const correlation = baselineRead.event.correlation
        if (correlation.automaticCompetingHeadAuthorizationAt !== authorization.position) {
          return yield* Effect.die("baseline and catch-up must bind the exact automatic authorization")
        }
        const seed = records.filter(({ position }) => Number(position) < Number(baselineRead.position))
        const localHead = fixture.input.predecessor.expectedTargetHead
        const remoteHead = authorization.event.remoteHead

        const seedRecords = Effect.fn("AutomaticSuccessorCatchUpIntentRecovery.seedRecords")(function* (
          store: JournalStore["Service"]
        ) {
          const [beginning, ...remaining] = seed
          if (beginning?.event._tag !== "WorkflowRunBegan")
            return yield* Effect.die("accepted history must begin the Run")
          yield* store.beginRun(
            fixture.runId,
            beginning.event.target,
            beginning.event.initialControlPolicy,
            beginning.event.remotePublicationTarget
          )
          for (const record of remaining) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
              return yield* Effect.die("authorization prefix may not contain another Run lifecycle event")
            }
            yield* store.append(fixture.runId, record.key, record.event)
          }
        })

        const timeline = yield* Ref.make<ReadonlyArray<string>>([])
        const casCount = yield* Ref.make(0)
        const remoteReadCount = yield* Ref.make(0)
        const initialCatchUpCount = yield* Ref.make(0)
        const reconciliationCount = yield* Ref.make(0)
        const makeGit = (
          currentLocalHead: Ref.Ref<GitCommitSha>,
          phase: "ReadBaseline" | "StopBeforeCas" | "ReconcileDeadline" | "ReconcileAndApply"
        ): RemoteBaselineGitService =>
          RemoteBaselineGit.of({
            observe: (receivedCorrelation) =>
              Effect.sync(() => expect(receivedCorrelation).toEqual(correlation)).pipe(
                Effect.andThen(Ref.update(timeline, (items) => [...items, "remote-read"])),
                Effect.andThen(Ref.update(remoteReadCount, (count) => count + 1)),
                Effect.as(RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead }))
              ),
            catchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
              Effect.gen(function* () {
                yield* Ref.update(timeline, (items) => [...items, "catch-up-before-CAS"])
                yield* Ref.update(initialCatchUpCount, (count) => count + 1)
                expect(phase).toBe("StopBeforeCas")
                expect(receivedCorrelation).toEqual(correlation)
                expect(expectedLocalHead).toBe(localHead)
                expect(observedRemoteHead).toBe(remoteHead)
                expect(yield* Ref.get(currentLocalHead)).toBe(localHead)
                return yield* Effect.die("host stopped before applying the catch-up CAS")
              }),
            reconcileCatchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
              Effect.gen(function* () {
                yield* Ref.update(timeline, (items) => [
                  ...items,
                  phase === "ReconcileDeadline" ? "reconcile-wait" : "reconcile-and-CAS"
                ])
                yield* Ref.update(reconciliationCount, (count) => count + 1)
                expect(phase === "ReconcileDeadline" || phase === "ReconcileAndApply").toBe(true)
                expect(receivedCorrelation).toEqual(correlation)
                expect(expectedLocalHead).toBe(localHead)
                expect(observedRemoteHead).toBe(remoteHead)
                const current = yield* Ref.get(currentLocalHead)
                expect(current).toBe(localHead)
                if (phase === "ReconcileDeadline") {
                  return yield* Effect.fail(new RemoteBaselineFailure({ reason: "ResponseDeadline" }))
                }
                yield* Ref.update(casCount, (count) => count + 1)
                yield* Ref.set(currentLocalHead, observedRemoteHead)
                return LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead })
              })
          })

        const runProcess = (store: JournalStore["Service"], git: RemoteBaselineGitService) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(`reopened catch-up prefix is invalid: ${JSON.stringify(history.issues)}`)
              }
              return yield* establishRemoteBaseline(correlation).pipe(
                Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, store)),
                Effect.provideService(RemoteBaselineGit, git)
              )
            })
          )

        const expectHistory = (persisted: ReadonlyArray<JournalRecord>, phase: "Baseline" | "Intent" | "Settled") => {
          const baselineReads = persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")
          const baselineObservations = persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")
          const catchUpIntents = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
          const catchUpObservations = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
          expect(baselineReads).toHaveLength(1)
          expect(baselineReads[0]?.event).toEqual(baselineRead.event)
          expect(baselineObservations).toHaveLength(1)
          expect(baselineObservations[0]?.key).toBe(expectedBaselineObservation.key)
          expect(baselineObservations[0]?.event).toEqual(expectedBaselineObservation.event)
          expect(catchUpIntents).toHaveLength(phase === "Baseline" ? 0 : 1)
          expect(catchUpObservations).toHaveLength(phase === "Settled" ? 1 : 0)
          if (phase !== "Baseline") {
            expect(catchUpIntents[0]?.key).toBe(expectedCatchUpIntent.key)
            expect(catchUpIntents[0]?.event).toEqual(expectedCatchUpIntent.event)
          }
          if (phase === "Settled") {
            expect(catchUpObservations[0]?.key).toBe(expectedCatchUpObservation.key)
            expect(catchUpObservations[0]?.event).toEqual(expectedCatchUpObservation.event)
          }
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          ).toHaveLength(1)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
          ).toHaveLength(0)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
        }

        const exercise = <R>(
          open: (git: RemoteBaselineGitService) => Effect.Effect<RemoteBaselineState, unknown, R>,
          readCurrent: () => Effect.Effect<ReadonlyArray<JournalRecord>, unknown, R>
        ) =>
          Effect.gen(function* () {
            const currentLocalHead = yield* Ref.make(localHead)
            expect((yield* open(makeGit(currentLocalHead, "ReadBaseline")))._tag).toBe("CatchUpRequired")
            expectHistory(yield* readCurrent(), "Baseline")
            const interrupted = yield* Effect.exit(open(makeGit(currentLocalHead, "StopBeforeCas")))
            expect(interrupted._tag).toBe("Failure")
            expect(yield* Ref.get(currentLocalHead)).toBe(localHead)
            expect(yield* Ref.get(casCount)).toBe(0)
            expectHistory(yield* readCurrent(), "Intent")
            expect((yield* open(makeGit(currentLocalHead, "ReconcileDeadline")))._tag).toBe("CatchUpPending")
            expect(yield* Ref.get(currentLocalHead)).toBe(localHead)
            expect(yield* Ref.get(casCount)).toBe(0)
            expect(yield* Ref.get(reconciliationCount)).toBe(1)
            expectHistory(yield* readCurrent(), "Intent")
            expect((yield* open(makeGit(currentLocalHead, "ReconcileAndApply")))._tag).toBe("Ready")
            expect(yield* Ref.get(currentLocalHead)).toBe(remoteHead)
            expect(yield* Ref.get(casCount)).toBe(1)
            expect(yield* Ref.get(initialCatchUpCount)).toBe(1)
            expect(yield* Ref.get(reconciliationCount)).toBe(2)
            expect(yield* Ref.get(remoteReadCount)).toBe(1)
            expect(yield* Ref.get(timeline)).toEqual([
              "remote-read",
              "catch-up-before-CAS",
              "reconcile-wait",
              "reconcile-and-CAS"
            ])
            expectHistory(yield* readCurrent(), "Settled")
          })

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore)
        yield* exercise(
          (git) => runProcess(memoryStore, git),
          () => memoryStore.read(fixture.runId)
        )

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "dalph-automatic-catch-up-intent-recovery-"
        })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
          )
        yield* openSqlite(seedRecords)
        yield* Ref.set(timeline, [])
        yield* Ref.set(casCount, 0)
        yield* Ref.set(remoteReadCount, 0)
        yield* Ref.set(initialCatchUpCount, 0)
        yield* Ref.set(reconciliationCount, 0)
        yield* exercise(
          (git) => openSqlite((store) => runProcess(store, git)),
          () => openSqlite((store) => store.read(fixture.runId))
        )
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect(
  "recovers a committed automatic-successor catch-up intent after lost acknowledgement with one reconciliation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const records = fixture.records()
        const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        const baselineRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        const expectedBaselineObservation = records.find(({ event }) => event._tag === "RemoteBaselineObserved")
        const expectedCatchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
        const expectedCatchUpObservation = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          baselineRead?.event._tag !== "RemoteBaselineReadIntended" ||
          expectedBaselineObservation?.event._tag !== "RemoteBaselineObserved" ||
          expectedCatchUpIntent?.event._tag !== "LocalTargetCatchUpIntended" ||
          expectedCatchUpObservation?.event._tag !== "LocalTargetCatchUpObserved"
        ) {
          return yield* Effect.die("accepted fixture must contain the exact automatic baseline and catch-up")
        }
        const correlation = baselineRead.event.correlation
        if (correlation.automaticCompetingHeadAuthorizationAt !== authorization.position) {
          return yield* Effect.die("catch-up intent must bind the exact automatic authorization")
        }
        const seed = records.filter(({ position }) => Number(position) < Number(expectedCatchUpIntent.position))
        const localHead = fixture.input.predecessor.expectedTargetHead
        const remoteHead = authorization.event.remoteHead
        const gitCalls = yield* Ref.make<ReadonlyArray<string>>([])
        const localTargetHead = yield* Ref.make(localHead)

        const makeGit = (): RemoteBaselineGitService =>
          RemoteBaselineGit.of({
            observe: () =>
              Ref.update(gitCalls, (calls) => [...calls, "observe"]).pipe(
                Effect.andThen(Effect.die("committed automatic baseline observation must not be reread"))
              ),
            catchUp: () =>
              Ref.update(gitCalls, (calls) => [...calls, "catch-up"]).pipe(
                Effect.andThen(Effect.die("recovery must reconcile the committed intent before a new CAS"))
              ),
            reconcileCatchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
              Effect.gen(function* () {
                yield* Ref.update(gitCalls, (calls) => [...calls, "reconcile-catch-up"])
                expect(receivedCorrelation).toEqual(correlation)
                expect(expectedLocalHead).toBe(localHead)
                expect(observedRemoteHead).toBe(remoteHead)
                expect(yield* Ref.get(localTargetHead)).toBe(localHead)
                yield* Ref.set(localTargetHead, remoteHead)
                return LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead })
              })
          })

        const seedRecords = Effect.fn("AutomaticSuccessorCatchUpIntentAckRecovery.seedRecords")(function* (
          store: JournalStore["Service"]
        ) {
          const [beginning, ...remaining] = seed
          if (beginning?.event._tag !== "WorkflowRunBegan")
            return yield* Effect.die("accepted history must begin the Run")
          yield* store.beginRun(
            fixture.runId,
            beginning.event.target,
            beginning.event.initialControlPolicy,
            beginning.event.remotePublicationTarget
          )
          for (const record of remaining) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
              return yield* Effect.die("automatic catch-up prefix may not contain another Run lifecycle event")
            }
            yield* store.append(fixture.runId, record.key, record.event)
          }
        })

        const boundary = (
          store: JournalStore["Service"],
          loseAcknowledgementAfterCommit: boolean
        ): JournalStorageBoundary => ({
          append: (runId, key, event) =>
            store
              .append(runId, key, event)
              .pipe(
                Effect.flatMap((record) =>
                  loseAcknowledgementAfterCommit && event._tag === "LocalTargetCatchUpIntended"
                    ? Effect.die("process lost after automatic catch-up intent committed")
                    : Effect.succeed(record)
                )
              ),
          read: store.read,
          terminateRun: store.terminateRun
        })

        const runProcess = (
          store: JournalStore["Service"],
          loseAcknowledgementAfterCommit = false
        ): Effect.Effect<RemoteBaselineState, unknown> =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(
                  `reopened catch-up intent history is invalid: ${JSON.stringify(history.issues)}`
                )
              }
              return yield* establishRemoteBaseline(correlation).pipe(
                Effect.provide(
                  journalLayer(
                    fixture.runId,
                    fixture.accepted.trackerTarget,
                    history,
                    boundary(store, loseAcknowledgementAfterCommit)
                  )
                ),
                Effect.provideService(RemoteBaselineGit, makeGit())
              )
            })
          )

        const expectOneExactIntent = (persisted: ReadonlyArray<JournalRecord>) => {
          const intents = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
          expect(intents).toHaveLength(1)
          expect(intents[0]?.key).toBe(expectedCatchUpIntent.key)
          expect(intents[0]?.event).toEqual(expectedCatchUpIntent.event)
          expect(intents[0]?.position).toBe(expectedCatchUpIntent.position)
          expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(1)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          ).toHaveLength(1)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
          ).toHaveLength(0)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
        }

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore)
        const memoryLoss = yield* Effect.exit(runProcess(memoryStore, true))
        expect(memoryLoss._tag).toBe("Failure")
        expect(yield* Ref.get(gitCalls)).toEqual([])
        expectOneExactIntent(yield* memoryStore.read(fixture.runId))
        expect((yield* runProcess(memoryStore))._tag).toBe("Ready")
        expect(yield* Ref.get(gitCalls)).toEqual(["reconcile-catch-up"])
        expect(yield* Ref.get(localTargetHead)).toBe(remoteHead)
        const memorySettled = yield* memoryStore.read(fixture.runId)
        expectOneExactIntent(memorySettled)
        const memoryResult = memorySettled.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        expect(memoryResult).toHaveLength(1)
        expect(memoryResult[0]?.key).toBe(expectedCatchUpObservation.key)
        expect(memoryResult[0]?.event).toEqual(expectedCatchUpObservation.event)
        expect(memoryResult[0]?.position).toBe(expectedCatchUpObservation.position)

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "dalph-automatic-catch-up-intent-ack-recovery-"
        })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        yield* Ref.set(gitCalls, [])
        yield* Ref.set(localTargetHead, localHead)
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          loseAcknowledgementAfterCommit = false
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                loseAcknowledgementAfterCommit
                  ? sqliteJournalTestLayer({
                      filename,
                      afterAppendCommit: () => Effect.fail("simulated lost catch-up intent acknowledgement")
                    })
                  : sqliteJournalStoreLayer({ filename })
              )
            )
          )

        yield* openSqlite(seedRecords)
        const sqliteLoss = yield* Effect.exit(openSqlite((store) => runProcess(store), true))
        expect(sqliteLoss._tag).toBe("Failure")
        expect(yield* Ref.get(gitCalls)).toEqual([])
        expectOneExactIntent(yield* openSqlite((store) => store.read(fixture.runId)))
        expect((yield* openSqlite((store) => runProcess(store)))._tag).toBe("Ready")
        expect(yield* Ref.get(gitCalls)).toEqual(["reconcile-catch-up"])
        expect(yield* Ref.get(localTargetHead)).toBe(remoteHead)
        const sqliteSettled = yield* openSqlite((store) => store.read(fixture.runId))
        expectOneExactIntent(sqliteSettled)
        const sqliteResult = sqliteSettled.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        expect(sqliteResult).toHaveLength(1)
        expect(sqliteResult[0]?.key).toBe(expectedCatchUpObservation.key)
        expect(sqliteResult[0]?.event).toEqual(expectedCatchUpObservation.event)
        expect(sqliteResult[0]?.position).toBe(expectedCatchUpObservation.position)
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect(
  "replays a committed automatic-successor catch-up result after lost acknowledgement without another Git boundary",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const records = fixture.records()
        const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        const baselineRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        const expectedCatchUpIntent = records.find(({ event }) => event._tag === "LocalTargetCatchUpIntended")
        const expectedCatchUpObservation = records.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          baselineRead?.event._tag !== "RemoteBaselineReadIntended" ||
          expectedCatchUpIntent?.event._tag !== "LocalTargetCatchUpIntended" ||
          expectedCatchUpObservation?.event._tag !== "LocalTargetCatchUpObserved"
        ) {
          return yield* Effect.die(
            "accepted successor fixture must contain its exact authorization and catch-up result"
          )
        }
        const correlation = baselineRead.event.correlation
        if (correlation.automaticCompetingHeadAuthorizationAt !== authorization.position) {
          return yield* Effect.die("catch-up result must remain bound to the exact automatic authorization")
        }
        const seed = records.filter(({ position }) => Number(position) < Number(expectedCatchUpObservation.position))
        const localHead = fixture.input.predecessor.expectedTargetHead
        const remoteHead = authorization.event.remoteHead
        const appendCalls = yield* Ref.make(0)
        const gitTimeline = yield* Ref.make<ReadonlyArray<string>>([])
        const casCount = yield* Ref.make(0)

        const seedRecords = Effect.fn("AutomaticSuccessorCatchUpResultRecovery.seedRecords")(function* (
          store: JournalStore["Service"]
        ) {
          const [beginning, ...remaining] = seed
          if (beginning?.event._tag !== "WorkflowRunBegan")
            return yield* Effect.die("accepted history must begin the Run")
          yield* store.beginRun(
            fixture.runId,
            beginning.event.target,
            beginning.event.initialControlPolicy,
            beginning.event.remotePublicationTarget
          )
          for (const record of remaining) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
              return yield* Effect.die("catch-up intent prefix may not contain another Run lifecycle event")
            }
            yield* store.append(fixture.runId, record.key, record.event)
          }
        })

        const storageBoundary = (
          store: JournalStore["Service"],
          loseResultAcknowledgement: boolean
        ): JournalStorageBoundary => ({
          append: (runId, key, event) =>
            Ref.update(appendCalls, (count) => count + 1).pipe(
              Effect.andThen(store.append(runId, key, event)),
              Effect.flatMap((record) =>
                loseResultAcknowledgement && event._tag === "LocalTargetCatchUpObserved"
                  ? Effect.die("process lost after automatic catch-up result committed")
                  : Effect.succeed(record)
              )
            ),
          read: store.read,
          terminateRun: store.terminateRun
        })

        const makeGit = (currentLocalHead: Ref.Ref<GitCommitSha>): RemoteBaselineGitService =>
          RemoteBaselineGit.of({
            observe: (receivedCorrelation) =>
              Effect.gen(function* () {
                yield* Ref.update(gitTimeline, (items) => [...items, "remote-read"])
                expect(receivedCorrelation).toEqual(correlation)
                return yield* Effect.die("a committed baseline observation must not be read again")
              }),
            catchUp: () =>
              Ref.update(gitTimeline, (items) => [...items, "catch-up-CAS"]).pipe(
                Effect.andThen(Effect.die("the exact catch-up intent must reconcile before another CAS"))
              ),
            reconcileCatchUp: (receivedCorrelation, expectedLocalHead, observedRemoteHead) =>
              Effect.gen(function* () {
                yield* Ref.update(gitTimeline, (items) => [...items, "reconcile-and-CAS"])
                yield* Ref.update(casCount, (count) => count + 1)
                expect(receivedCorrelation).toEqual(correlation)
                expect(expectedLocalHead).toBe(localHead)
                expect(observedRemoteHead).toBe(remoteHead)
                expect(yield* Ref.get(currentLocalHead)).toBe(localHead)
                yield* Ref.set(currentLocalHead, observedRemoteHead)
                return LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead })
              })
          })

        const runProcess = (
          store: JournalStore["Service"],
          git: RemoteBaselineGitService,
          loseResultAcknowledgement = false
        ) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(
                  `reopened catch-up result history is invalid: ${JSON.stringify(history.issues)}`
                )
              }
              return yield* establishRemoteBaseline(correlation).pipe(
                Effect.provide(
                  journalLayer(
                    fixture.runId,
                    fixture.accepted.trackerTarget,
                    history,
                    storageBoundary(store, loseResultAcknowledgement)
                  )
                ),
                Effect.provideService(RemoteBaselineGit, git)
              )
            })
          )

        const expectExactResult = (persisted: ReadonlyArray<JournalRecord>) => {
          const authorizations = persisted.filter(
            ({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
          )
          const catchUpIntents = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
          const catchUpObservations = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
          expect(authorizations).toHaveLength(1)
          expect(catchUpIntents).toHaveLength(1)
          expect(catchUpIntents[0]?.key).toBe(expectedCatchUpIntent.key)
          expect(catchUpIntents[0]?.event).toEqual(expectedCatchUpIntent.event)
          expect(catchUpObservations).toHaveLength(1)
          expect(catchUpObservations[0]?.key).toBe(expectedCatchUpObservation.key)
          expect(catchUpObservations[0]?.event).toEqual(expectedCatchUpObservation.event)
          expect(catchUpObservations[0]?.position).toBe(expectedCatchUpObservation.position)
          expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(1)
          expect(
            persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
          ).toHaveLength(0)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
          expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
        }

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore)
        const memoryLocalHead = yield* Ref.make(localHead)
        const memoryGit = makeGit(memoryLocalHead)
        const memoryLoss = yield* Effect.exit(runProcess(memoryStore, memoryGit, true))
        expect(memoryLoss._tag).toBe("Failure")
        expect(yield* Ref.get(memoryLocalHead)).toBe(remoteHead)
        expect(yield* Ref.get(casCount)).toBe(1)
        const memoryCommitted = yield* memoryStore.read(fixture.runId)
        expectExactResult(memoryCommitted)
        expect(yield* Ref.get(appendCalls)).toBe(1)
        expect((yield* runProcess(memoryStore, memoryGit))._tag).toBe("Ready")
        expectExactResult(yield* memoryStore.read(fixture.runId))
        expect(yield* Ref.get(appendCalls)).toBe(1)
        expect(yield* Ref.get(casCount)).toBe(1)
        expect(yield* Ref.get(gitTimeline)).toEqual(["reconcile-and-CAS"])

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "dalph-automatic-catch-up-result-recovery-"
        })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const sqliteCommitCount = yield* Ref.make(0)
        const openSqlite = <A>(
          use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>,
          loseResultAcknowledgement = false
        ): Effect.Effect<A, unknown, Scope.Scope> =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(
              Effect.provide(
                loseResultAcknowledgement
                  ? sqliteJournalTestLayer({
                      filename,
                      afterAppendCommit: () =>
                        Ref.updateAndGet(sqliteCommitCount, (count) => count + 1).pipe(
                          Effect.flatMap((count) =>
                            count === 1 ? Effect.fail("simulated lost catch-up result acknowledgement") : Effect.void
                          )
                        )
                    })
                  : sqliteJournalStoreLayer({ filename })
              )
            )
          )

        yield* openSqlite(seedRecords)
        const sqliteLocalHead = yield* Ref.make(localHead)
        const sqliteGit = makeGit(sqliteLocalHead)
        yield* Ref.set(sqliteCommitCount, 0)
        const sqliteLoss = yield* Effect.exit(openSqlite((store) => runProcess(store, sqliteGit), true))
        expect(sqliteLoss._tag).toBe("Failure")
        expect(yield* Ref.get(sqliteLocalHead)).toBe(remoteHead)
        expect(yield* Ref.get(casCount)).toBe(2)
        const sqliteCommitted = yield* openSqlite((store) => store.read(fixture.runId))
        expectExactResult(sqliteCommitted)
        expect(yield* Ref.get(appendCalls)).toBe(2)
        expect((yield* openSqlite((store) => runProcess(store, sqliteGit)))._tag).toBe("Ready")
        expectExactResult(yield* openSqlite((store) => store.read(fixture.runId)))
        expect(yield* Ref.get(appendCalls)).toBe(2)
        expect(yield* Ref.get(casCount)).toBe(2)
        expect(yield* Ref.get(gitTimeline)).toEqual(["reconcile-and-CAS", "reconcile-and-CAS"])
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)
