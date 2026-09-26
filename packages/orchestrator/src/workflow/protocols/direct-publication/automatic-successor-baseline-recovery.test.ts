import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { type GitCommitSha, GitCommitSha as GitCommitShaSchema } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Path, Ref, type Scope } from "effect"
import { makeSuccessorPrefix } from "../../../../test/support/automatic-successor-history.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator, JournalPosition } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import { projectWorkflowOccurrences } from "../../registry/occurrence-projection.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineFailure,
  RemoteBaselineObservation,
  RemoteBaselineObservedEvent,
  RemoteBaselineRound,
  RemoteBaselineReadIntendedEvent,
  type RemoteBaselineCorrelation,
  type RemoteBaselineGitService,
  automaticCompetingHeadRemoteBaselineCorrelationFor,
  initialAutomaticCompetingHeadBaselineRound
} from "./baseline-events.js"
import { establishRemoteBaseline } from "./baseline-protocol-engine.js"
import { validateRemoteBaselineState } from "./baseline-transition-journal.js"
import type { RemoteBaselineState } from "./baseline-state.js"
import {
  integratorAutomaticSuccessorPreparationIsCurrent,
  prepareIntegratorAutomaticSuccessorSessionAppend
} from "../integrator/automatic-successor-session.js"
import { automaticRemoteBaselineRoundsFor } from "./baseline-rounds.js"

it.effect("retains unsafe automatic S2 catch-up evidence without moving the target or fixing a successor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const unsafeObservations = [
        RemoteBaselineObservation.cases.LocalAhead.make({
          localHead: GitCommitShaSchema.make("7".repeat(40)),
          remoteHead: GitCommitShaSchema.make("6".repeat(40))
        }),
        RemoteBaselineObservation.cases.Diverged.make({
          localHead: GitCommitShaSchema.make("7".repeat(40)),
          remoteHead: GitCommitShaSchema.make("6".repeat(40))
        })
      ] as const

      const seedS2Baseline = Effect.fn("AutomaticSuccessorUnsafeCatchUp.seedS2Baseline")(function* (
        store: JournalStore["Service"],
        runId: typeof integrationFinalityFixture.runId,
        records: ReadonlyArray<JournalRecord>,
        baselineIntent: JournalRecord
      ) {
        const [beginning, ...remaining] = records
        if (beginning?.event._tag !== "WorkflowRunBegan") {
          return yield* Effect.die("automatic S2 prefix must begin with its original Run pin")
        }
        yield* store.beginRun(
          runId,
          beginning.event.target,
          beginning.event.initialControlPolicy,
          beginning.event.remotePublicationTarget
        )
        for (const record of [...remaining, baselineIntent]) {
          if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
            return yield* Effect.die("automatic S2 baseline prefix may not contain another Run lifecycle event")
          }
          yield* store.append(runId, record.key, record.event)
        }
      })

      const activate = (
        store: JournalStore["Service"],
        runId: typeof integrationFinalityFixture.runId,
        target: typeof integrationFinalityFixture.target,
        correlation: RemoteBaselineCorrelation,
        git: RemoteBaselineGitService
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const stored = yield* store.read(runId)
            const history = reduceWorkflowJournalHistory(runId, stored)
            if (history._tag === "InvalidWorkflowJournalHistory") {
              return yield* Effect.die(`automatic S2 test prefix is invalid: ${JSON.stringify(history.issues)}`)
            }
            return yield* establishRemoteBaseline(correlation).pipe(
              Effect.provide(journalLayer(runId, target, history, store)),
              Effect.provideService(RemoteBaselineGit, git)
            )
          })
        )

      for (const observation of unsafeObservations) {
        const successor = makeSuccessorPrefix()
        const records = successor.records()
        const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        const baselineIntent = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          baselineIntent?.event._tag !== "RemoteBaselineReadIntended"
        ) {
          return yield* Effect.die("accepted S2 prefix must contain one exact authorization-scoped baseline intent")
        }
        const correlation = baselineIntent.event.correlation
        if (
          correlation._tag !== "AutomaticCompetingHead" ||
          correlation.authorizationAt !== authorization.position ||
          Number(authorization.position) !== Number(successor.input.authorizationAt)
        ) {
          return yield* Effect.die("baseline correlation must bind the exact S2 authorization position")
        }
        const seed = records.filter(({ position }) => Number(position) < Number(baselineIntent.position))
        const context = yield* Layer.build(memoryJournalStoreLayer)
        const store = Context.get(context, JournalStore)
        yield* seedS2Baseline(store, successor.runId, seed, baselineIntent)
        const gitTimeline = yield* Ref.make<ReadonlyArray<string>>([])
        const localState = yield* Ref.make({
          head: successor.input.predecessor.expectedTargetHead,
          index: "exact-index-before-S2",
          worktree: "exact-worktree-before-S2"
        })
        const git = RemoteBaselineGit.of({
          observe: (observedCorrelation) =>
            Effect.gen(function* () {
              expect(observedCorrelation).toEqual(correlation)
              yield* Ref.update(gitTimeline, (entries) => [...entries, "observe"])
              return observation
            }),
          catchUp: () =>
            Ref.update(gitTimeline, (entries) => [...entries, "catch-up"]).pipe(
              Effect.andThen(Effect.die("unsafe ahead/divergent S2 state must not attempt catch-up"))
            ),
          reconcileCatchUp: () =>
            Ref.update(gitTimeline, (entries) => [...entries, "reconcile-catch-up"]).pipe(
              Effect.andThen(Effect.die("unsafe ahead/divergent S2 state must not reconcile catch-up"))
            )
        })
        const before = yield* Ref.get(localState)
        const state = yield* activate(store, successor.runId, integrationFinalityFixture.target, correlation, git)
        expect(state).toMatchObject({ _tag: "Retained", cause: { _tag: "UnsafeObservation", observation } })
        expect(yield* Ref.get(localState)).toEqual(before)
        expect(yield* Ref.get(gitTimeline)).toEqual(["observe"])
        const persisted = yield* store.read(successor.runId)
        expect(
          persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
        ).toHaveLength(1)
        expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
        expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toMatchObject([
          { event: { observation } }
        ])
        expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(0)
        expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(0)
        expect(persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(
          0
        )
      }

      const successor = makeSuccessorPrefix()
      const records = successor.records()
      const baselineIntent = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
      if (baselineIntent?.event._tag !== "RemoteBaselineReadIntended") {
        return yield* Effect.die("accepted S2 prefix must contain its exact baseline intent")
      }
      const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      if (authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized") {
        return yield* Effect.die("accepted S2 prefix must contain its exact successor authorization")
      }
      const correlation = baselineIntent.event.correlation
      const seed = records.filter(({ position }) => Number(position) < Number(baselineIntent.position))
      const context = yield* Layer.build(memoryJournalStoreLayer)
      const store = Context.get(context, JournalStore)
      yield* seedS2Baseline(store, successor.runId, seed, baselineIntent)
      const gitTimeline = yield* Ref.make<ReadonlyArray<string>>([])
      const localState = yield* Ref.make({
        head: successor.input.predecessor.expectedTargetHead,
        index: "exact-index-before-S2",
        worktree: "exact-worktree-before-S2"
      })
      const localAncestor = RemoteBaselineObservation.cases.LocalAncestor.make({
        localHead: successor.input.predecessor.expectedTargetHead,
        remoteHead: authorization.event.remoteHead
      })
      const git = RemoteBaselineGit.of({
        observe: (observedCorrelation) =>
          Effect.gen(function* () {
            expect(observedCorrelation).toEqual(correlation)
            yield* Ref.update(gitTimeline, (entries) => [...entries, "observe"])
            return localAncestor
          }),
        catchUp: (observedCorrelation, expectedLocalHead, remoteHead) =>
          Effect.gen(function* () {
            expect(observedCorrelation).toEqual(correlation)
            expect(expectedLocalHead).toBe(localAncestor.localHead)
            expect(remoteHead).toBe(localAncestor.remoteHead)
            yield* Ref.update(gitTimeline, (entries) => [...entries, "catch-up"])
            return yield* Effect.fail(new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
          }),
        reconcileCatchUp: (observedCorrelation, expectedLocalHead, remoteHead) =>
          Effect.gen(function* () {
            expect(observedCorrelation).toEqual(correlation)
            expect(expectedLocalHead).toBe(localAncestor.localHead)
            expect(remoteHead).toBe(localAncestor.remoteHead)
            yield* Ref.update(gitTimeline, (entries) => [...entries, "reconcile-catch-up"])
            return yield* Effect.fail(new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
          })
      })
      const before = yield* Ref.get(localState)
      expect((yield* activate(store, successor.runId, integrationFinalityFixture.target, correlation, git))._tag).toBe(
        "CatchUpRequired"
      )
      expect((yield* activate(store, successor.runId, integrationFinalityFixture.target, correlation, git))._tag).toBe(
        "CatchUpPending"
      )
      const retained = yield* activate(store, successor.runId, integrationFinalityFixture.target, correlation, git)
      expect(retained).toMatchObject({
        _tag: "Retained",
        cause: { _tag: "CatchUpUnavailable", reason: "TargetUnreadable" },
        correlation
      })
      expect(yield* Ref.get(localState)).toEqual(before)
      expect(yield* Ref.get(gitTimeline)).toEqual(["observe", "catch-up", "reconcile-catch-up"])
      const persisted = yield* store.read(successor.runId)
      expect(persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toEqual([
        authorization
      ])
      expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(1)
      expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toMatchObject([
        {
          event: {
            correlation,
            expectedLocalHead: localAncestor.localHead,
            remoteHead: localAncestor.remoteHead,
            result: { _tag: "Unavailable", reason: "TargetUnreadable" }
          }
        }
      ])
      expect(persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(0)
      expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
    })
  )
)

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
      if (correlation._tag !== "AutomaticCompetingHead" || correlation.authorizationAt !== authorization.position) {
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
  "uses the first automatic-successor baseline read after remote H3 advances under the same authorization",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const acceptedRecords = fixture.records()
        const authorization = acceptedRecords.find(
          ({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
        )
        const firstBaselineIntent = acceptedRecords.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          firstBaselineIntent?.event._tag !== "RemoteBaselineReadIntended"
        ) {
          return yield* Effect.die("accepted successor fixture must contain its exact H2 authorization")
        }
        const correlation = firstBaselineIntent.event.correlation
        if (correlation._tag !== "AutomaticCompetingHead") {
          return yield* Effect.die("first successor baseline read must use its tagged automatic correlation")
        }
        expect(correlation.authorizationAt).toBe(authorization.position)
        const prefix = acceptedRecords.filter(({ position }) => Number(position) < Number(firstBaselineIntent.position))
        const h3 = GitCommitShaSchema.make("8".repeat(40))
        const localHead = fixture.input.predecessor.expectedTargetHead
        const timeline = yield* Ref.make<ReadonlyArray<string>>([])
        const currentHead = yield* Ref.make(localHead)
        const git = RemoteBaselineGit.of({
          observe: (receivedCorrelation) =>
            Effect.gen(function* () {
              yield* Ref.update(timeline, (entries) => [...entries, "observe"])
              expect(receivedCorrelation).toEqual(correlation)
              return RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead: h3 })
            }),
          catchUp: (receivedCorrelation, expectedLocalHead, remoteHead) =>
            Effect.gen(function* () {
              yield* Ref.update(timeline, (entries) => [...entries, "catch-up"])
              expect(receivedCorrelation).toEqual(correlation)
              expect(expectedLocalHead).toBe(localHead)
              expect(remoteHead).toBe(h3)
              const current = yield* Ref.get(currentHead)
              if (current !== localHead) return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: current })
              yield* Ref.set(currentHead, h3)
              return LocalTargetCatchUpResult.cases.Applied.make({ newHead: h3 })
            }),
          reconcileCatchUp: () => Effect.die("first H3 baseline round has no pending catch-up intent to reconcile")
        })
        const context = yield* Layer.build(memoryJournalStoreLayer)
        const store = Context.get(context, JournalStore)
        const [beginning, ...remaining] = prefix
        if (beginning?.event._tag !== "WorkflowRunBegan")
          return yield* Effect.die("H3 baseline prefix must begin with Run")
        yield* store.beginRun(
          fixture.runId,
          beginning.event.target,
          beginning.event.initialControlPolicy,
          beginning.event.remotePublicationTarget
        )
        for (const record of remaining) {
          if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
            return yield* Effect.die("H3 authorization prefix may not contain another Run lifecycle event")
          }
          yield* store.append(fixture.runId, record.key, record.event)
        }

        const storedBeforeRead = yield* store.read(fixture.runId)
        const historyBeforeRead = reduceWorkflowJournalHistory(fixture.runId, storedBeforeRead)
        if (historyBeforeRead._tag === "InvalidWorkflowJournalHistory") {
          return yield* Effect.die(`H3 authorization prefix is invalid: ${JSON.stringify(historyBeforeRead.issues)}`)
        }
        const readState = yield* establishRemoteBaseline(correlation).pipe(
          Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, historyBeforeRead, store)),
          Effect.provideService(RemoteBaselineGit, git)
        )
        expect(readState).toMatchObject({ _tag: "CatchUpRequired", expectedLocalHead: localHead, remoteHead: h3 })

        const storedAfterRead = yield* store.read(fixture.runId)
        const historyAfterRead = reduceWorkflowJournalHistory(fixture.runId, storedAfterRead)
        if (historyAfterRead._tag === "InvalidWorkflowJournalHistory") {
          return yield* Effect.die(
            `recorded H3 baseline observation is invalid: ${JSON.stringify(historyAfterRead.issues)}`
          )
        }
        const state = yield* establishRemoteBaseline(correlation).pipe(
          Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, historyAfterRead, store)),
          Effect.provideService(RemoteBaselineGit, git)
        )
        expect(state).toMatchObject({ _tag: "Ready", remoteHead: h3 })
        expect(yield* Ref.get(currentHead)).toBe(h3)
        expect(yield* Ref.get(timeline)).toEqual(["observe", "catch-up"])
        const stored = yield* store.read(fixture.runId)
        expect(stored.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toHaveLength(
          1
        )
        expect(stored.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(1)
        expect(stored.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toMatchObject([
          { event: { correlation, observation: { _tag: "LocalAncestor", localHead, remoteHead: h3 } } }
        ])
        const rounds = automaticRemoteBaselineRoundsFor(stored, correlation)
        expect(rounds).toHaveLength(1)
        expect(rounds[0]?.state).toMatchObject({ _tag: "Ready", remoteHead: h3 })
        const projection = yield* projectWorkflowOccurrences(stored)
        expect(
          projection.occurrences.filter(({ _tag }) => _tag === "IntegratorCompetingHeadSuccessorAuthorized")
        ).toHaveLength(1)
      })
    )
)

it.effect("retains an H3 refresh when the exact local ref changes before the catch-up CAS", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = makeSuccessorPrefix()
      const prefix = fixture.records()
      const authorization = prefix.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      const firstRead = prefix.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
      if (
        authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
        firstRead?.event._tag !== "RemoteBaselineReadIntended" ||
        firstRead.event.correlation._tag !== "AutomaticCompetingHead"
      ) {
        return yield* Effect.die("accepted H2 prefix must contain its exact automatic authorization and baseline")
      }

      const h2 = authorization.event.mergeBase
      const h3 = GitCommitShaSchema.make("8".repeat(40))
      const observedH4 = GitCommitShaSchema.make("9".repeat(40))
      const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
        fixture.runId,
        firstRead.event.correlation.responsibility,
        firstRead.event.correlation.localTarget,
        firstRead.event.correlation.remoteTarget,
        authorization.position,
        RemoteBaselineRound.make(2)
      )
      const context = yield* Layer.build(memoryJournalStoreLayer)
      const store = Context.get(context, JournalStore)
      const [beginning, ...remaining] = prefix
      if (beginning?.event._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("H2 prefix must begin with its exact pinned Run")
      }
      yield* store.beginRun(
        fixture.runId,
        beginning.event.target,
        beginning.event.initialControlPolicy,
        beginning.event.remotePublicationTarget
      )
      for (const record of remaining) {
        if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
          return yield* Effect.die("H2 prefix may not contain another Run lifecycle event")
        }
        yield* store.append(fixture.runId, record.key, record.event)
      }

      const timeline = yield* Ref.make<ReadonlyArray<string>>([])
      const localRef = yield* Ref.make(observedH4)
      const git = RemoteBaselineGit.of({
        observe: (correlation) =>
          Effect.gen(function* () {
            yield* Ref.update(timeline, (items) => [...items, "observe"])
            expect(correlation).toEqual(roundTwo)
            return RemoteBaselineObservation.cases.LocalAncestor.make({ localHead: h2, remoteHead: h3 })
          }),
        catchUp: (correlation, expectedLocalHead, remoteHead) =>
          Effect.gen(function* () {
            yield* Ref.update(timeline, (items) => [...items, "catch-up-cas"])
            expect(correlation).toEqual(roundTwo)
            expect(expectedLocalHead).toBe(h2)
            expect(remoteHead).toBe(h3)
            const observedHead = yield* Ref.get(localRef)
            expect(observedHead).toBe(observedH4)
            return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead })
          }),
        reconcileCatchUp: () => Effect.die("the exact round-two catch-up intent has not been attempted yet")
      })
      const activate = () =>
        Effect.scoped(
          Effect.gen(function* () {
            const stored = yield* store.read(fixture.runId)
            const history = reduceWorkflowJournalHistory(fixture.runId, stored)
            if (history._tag === "InvalidWorkflowJournalHistory") {
              return yield* Effect.die(`H3 catch-up race history is invalid: ${JSON.stringify(history.issues)}`)
            }
            return yield* establishRemoteBaseline(roundTwo).pipe(
              Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, store)),
              Effect.provideService(RemoteBaselineGit, git)
            )
          })
        )

      expect(yield* activate()).toMatchObject({ _tag: "CatchUpRequired", expectedLocalHead: h2, remoteHead: h3 })
      const retained = yield* activate()
      expect(retained).toMatchObject({
        _tag: "Retained",
        cause: { _tag: "CatchUpChanged", expectedLocalHead: h2, observedLocalHead: observedH4, remoteHead: h3 },
        correlation: roundTwo
      })
      expect(yield* Ref.get(localRef)).toBe(observedH4)
      expect(yield* Ref.get(timeline)).toEqual(["observe", "catch-up-cas"])

      const persisted = yield* store.read(fixture.runId)
      expect(persisted.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toHaveLength(
        1
      )
      expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(2)
      expect(persisted.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(2)
      expect(persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(2)
      const catchUpResults = persisted.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
      expect(catchUpResults).toHaveLength(2)
      expect(catchUpResults[1]?.event).toMatchObject({
        _tag: "LocalTargetCatchUpObserved",
        correlation: roundTwo,
        expectedLocalHead: h2,
        remoteHead: h3,
        result: { _tag: "Rejected", observedHead: observedH4 }
      })
      const rounds = automaticRemoteBaselineRoundsFor(persisted, firstRead.event.correlation)
      expect(rounds).toHaveLength(2)
      expect(rounds[1]?.state).toMatchObject({
        _tag: "Retained",
        cause: { _tag: "CatchUpChanged", expectedLocalHead: h2, observedLocalHead: observedH4, remoteHead: h3 }
      })
      expect(persisted.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(0)
      expect(persisted.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
      const projection = yield* projectWorkflowOccurrences(persisted)
      expect(
        projection.occurrences.filter(
          (occurrence) =>
            occurrence._tag === "LocalTargetCatchUpObserved" &&
            occurrence.correlation._tag === "AutomaticCompetingHead" &&
            Number(occurrence.correlation.baselineRound) === 2
        )
      ).toMatchObject([
        { result: { _tag: "Rejected", observedHead: observedH4 }, expectedLocalHead: h2, remoteHead: h3 }
      ])
    })
  )
)

it.effect(
  "reconciles the same H3 refresh catch-up after memory and reopened SQLite process loss without another read",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const initialRecords = fixture.records()
        const authorization = initialRecords.find(
          ({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
        )
        const firstRead = initialRecords.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          firstRead?.event._tag !== "RemoteBaselineReadIntended"
        ) {
          return yield* Effect.die("accepted H2 prefix must contain its exact authorization and baseline")
        }
        const h2 = authorization.event.remoteHead
        const h3 = GitCommitShaSchema.make("8".repeat(40))
        const firstRoundCorrelation = firstRead.event.correlation
        const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
          fixture.runId,
          firstRoundCorrelation.responsibility,
          firstRoundCorrelation.localTarget,
          firstRoundCorrelation.remoteTarget,
          authorization.position,
          RemoteBaselineRound.make(2)
        )
        fixture.append(
          RemoteBaselineReadIntendedEvent.make({
            correlation: roundTwo,
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
        )
        fixture.append(
          RemoteBaselineObservedEvent.make({
            correlation: roundTwo,
            observation: RemoteBaselineObservation.cases.LocalAncestor.make({ localHead: h2, remoteHead: h3 }),
            occurrenceClassification: "NonActionOccurrence",
            version: workflowJournalEventVersion
          })
        )
        fixture.append(
          LocalTargetCatchUpIntendedEvent.make({
            correlation: roundTwo,
            expectedLocalHead: h2,
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            remoteHead: h3,
            version: workflowJournalEventVersion
          })
        )

        const seedRecords = (store: JournalStore["Service"]) =>
          Effect.gen(function* () {
            const [beginning, ...remaining] = fixture.records()
            if (beginning?.event._tag !== "WorkflowRunBegan") {
              return yield* Effect.die("H3 refresh prefix must begin with its pinned Run")
            }
            yield* store.beginRun(
              fixture.runId,
              beginning.event.target,
              beginning.event.initialControlPolicy,
              beginning.event.remotePublicationTarget
            )
            for (const record of remaining) {
              if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
                return yield* Effect.die("H3 refresh prefix may not contain another Run lifecycle event")
              }
              yield* store.append(fixture.runId, record.key, record.event)
            }
          })
        const timeline = yield* Ref.make<ReadonlyArray<string>>([])
        const localHead = yield* Ref.make(h3)
        const git = RemoteBaselineGit.of({
          observe: () =>
            Ref.update(timeline, (entries) => [...entries, "observe"]).pipe(
              Effect.andThen(Effect.die("pending H3 catch-up must reuse its read intent without another remote read"))
            ),
          catchUp: () =>
            Ref.update(timeline, (entries) => [...entries, "catch-up"]).pipe(
              Effect.andThen(Effect.die("applied H3 catch-up must be reconciled, not applied twice"))
            ),
          reconcileCatchUp: (correlation, expectedLocalHead, remoteHead) =>
            Effect.gen(function* () {
              yield* Ref.update(timeline, (entries) => [...entries, "reconcile-catch-up"])
              expect(correlation).toEqual(roundTwo)
              expect(expectedLocalHead).toBe(h2)
              expect(remoteHead).toBe(h3)
              const currentHead = yield* Ref.get(localHead)
              expect(currentHead).toBe(h3)
              return LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead })
            })
        })
        const resume = (store: JournalStore["Service"]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const stored = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, stored)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(`H3 refresh recovery prefix is invalid: ${JSON.stringify(history.issues)}`)
              }
              return yield* establishRemoteBaseline(roundTwo).pipe(
                Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, store)),
                Effect.provideService(RemoteBaselineGit, git)
              )
            })
          )
        const assertReadyHistory = (stored: ReadonlyArray<JournalRecord>) => {
          expect(
            stored.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
          ).toHaveLength(1)
          expect(stored.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")).toHaveLength(2)
          expect(stored.filter(({ event }) => event._tag === "RemoteBaselineObserved")).toHaveLength(2)
          expect(stored.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")).toHaveLength(2)
          expect(stored.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")).toHaveLength(2)
          const history = reduceWorkflowJournalHistory(fixture.runId, stored)
          if (history._tag === "InvalidWorkflowJournalHistory") {
            throw new Error(`reconciled H3 refresh history is invalid: ${JSON.stringify(history.issues)}`)
          }
          const initialBaselineRead = stored.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
          if (initialBaselineRead?.event._tag !== "RemoteBaselineReadIntended") {
            throw new Error("reconciled H3 refresh history must preserve the initial read intent")
          }
          const reconstructedFirstRound = automaticCompetingHeadRemoteBaselineCorrelationFor(
            fixture.runId,
            initialBaselineRead.event.correlation.responsibility,
            initialBaselineRead.event.correlation.localTarget,
            initialBaselineRead.event.correlation.remoteTarget,
            authorization.position,
            initialAutomaticCompetingHeadBaselineRound
          )
          const rounds = automaticRemoteBaselineRoundsFor(history.prefix, reconstructedFirstRound)
          expect(rounds.map(({ state }) => state._tag)).toEqual(["Ready", "Ready"])
          expect(rounds.at(-1)?.state).toMatchObject({ _tag: "Ready", remoteHead: h3 })
        }

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* seedRecords(memoryStore)
        expect((yield* resume(memoryStore))._tag).toBe("Ready")
        expect(yield* Ref.get(timeline)).toEqual(["reconcile-catch-up"])
        assertReadyHistory(yield* memoryStore.read(fixture.runId))

        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-h3-refresh-recovery-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>) =>
          Effect.scoped(
            Effect.gen(function* () {
              return yield* use(yield* JournalStore)
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
          )
        yield* openSqlite(seedRecords)
        expect((yield* openSqlite(resume))._tag).toBe("Ready")
        expect(yield* Ref.get(timeline)).toEqual(["reconcile-catch-up", "reconcile-catch-up"])
        assertReadyHistory(yield* openSqlite((store) => store.read(fixture.runId)))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it("rejects an automatic-successor baseline refresh beyond the two-round bound", () => {
  const fixture = makeSuccessorPrefix()
  const records = fixture.records()
  const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
  const firstRead = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
  if (
    authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
    firstRead?.event._tag !== "RemoteBaselineReadIntended"
  ) {
    throw new Error("accepted automatic-successor prefix must contain its authorization and first baseline read")
  }
  const roundThree = automaticCompetingHeadRemoteBaselineCorrelationFor(
    fixture.runId,
    firstRead.event.correlation.responsibility,
    firstRead.event.correlation.localTarget,
    firstRead.event.correlation.remoteTarget,
    authorization.position,
    RemoteBaselineRound.make(3)
  )
  fixture.append(
    RemoteBaselineReadIntendedEvent.make({
      correlation: roundThree,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )

  const rounds = automaticRemoteBaselineRoundsFor(fixture.records(), firstRead.event.correlation)
  expect(rounds.map(({ state }) => state._tag)).toEqual(["Contradiction", "Contradiction"])
  expect(integratorAutomaticSuccessorPreparationIsCurrent(fixture.records(), fixture.input)).toBe(false)
  expect(
    fixture.records().filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
  ).toHaveLength(0)
})

it("contradicts a round-two read intent that predates the ready round-one completion", () => {
  const fixture = makeSuccessorPrefix()
  const initialRecords = fixture.records()
  const authorization = initialRecords.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
  const firstRead = initialRecords.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
  if (
    authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
    firstRead?.event._tag !== "RemoteBaselineReadIntended"
  ) {
    throw new Error("accepted automatic-successor prefix must contain its authorization and first baseline read")
  }
  const firstRound = automaticRemoteBaselineRoundsFor(initialRecords, firstRead.event.correlation)[0]
  if (firstRound?.state._tag !== "Ready") throw new Error("accepted first round must be Ready")
  const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
    fixture.runId,
    firstRead.event.correlation.responsibility,
    firstRead.event.correlation.localTarget,
    firstRead.event.correlation.remoteTarget,
    authorization.position,
    RemoteBaselineRound.make(2)
  )
  const intent = RemoteBaselineReadIntendedEvent.make({
    correlation: roundTwo,
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    version: workflowJournalEventVersion
  })
  const appended = fixture.append(intent)
  const outOfOrder = fixture
    .records()
    .map((record) =>
      record.key === appended.key
        ? { ...record, position: JournalPosition.make(Number(firstRound.state.completedAt) - 1) }
        : record
    )

  const rounds = automaticRemoteBaselineRoundsFor(outOfOrder, firstRead.event.correlation)
  expect(rounds.map(({ state }) => state._tag)).toEqual(["Ready", "Contradiction"])
})

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
        if (correlation._tag !== "AutomaticCompetingHead" || correlation.authorizationAt !== authorization.position) {
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

it.effect("refreshes Ready H2 to H3 under one authorization and reopens the exact successor in memory and SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fixture = makeSuccessorPrefix()
      const records = fixture.records()
      const auth = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      const first = records.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
      if (
        auth?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
        first?.event._tag !== "RemoteBaselineReadIntended"
      )
        return yield* Effect.die("fixture must contain the H2 authorization and first Ready baseline")
      const h2 = auth.event.remoteHead
      const h3 = GitCommitShaSchema.make("8".repeat(40))
      const round2 = automaticCompetingHeadRemoteBaselineCorrelationFor(
        fixture.runId,
        first.event.correlation.responsibility,
        first.event.correlation.localTarget,
        first.event.correlation.remoteTarget,
        auth.position,
        RemoteBaselineRound.make(2)
      )
      fixture.append(
        RemoteBaselineReadIntendedEvent.make({
          correlation: round2,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        })
      )
      fixture.append(
        RemoteBaselineObservedEvent.make({
          correlation: round2,
          observation: RemoteBaselineObservation.cases.LocalAncestor.make({ localHead: h2, remoteHead: h3 }),
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      fixture.append(
        LocalTargetCatchUpIntendedEvent.make({
          correlation: round2,
          expectedLocalHead: h2,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          remoteHead: h3,
          version: workflowJournalEventVersion
        })
      )
      fixture.append(
        LocalTargetCatchUpObservedEvent.make({
          correlation: round2,
          expectedLocalHead: h2,
          occurrenceClassification: "NonActionOccurrence",
          remoteHead: h3,
          result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: h3 }),
          version: workflowJournalEventVersion
        })
      )
      const operation = makeTargetLineageObservationOperation({
        integrationTarget: fixture.accepted.integrationTarget,
        operationId: OperationId.make("automatic-successor-H3-lineage"),
        plannedAttempt: fixture.input.predecessor.plannedAttempt,
        predecessorOperationIds: [fixture.accepted.targetLineageOperation.operationId]
      })
      const observation = TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: fixture.input.predecessor.plannedAttempt.baseSha,
        targetHeadSha: h3
      })
      fixture.append(
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation,
          version: workflowJournalEventVersion
        })
      )
      const lineage = fixture.append(
        TargetLineageObservedEvent.make({
          observation,
          occurrenceClassification: "NonActionOccurrence",
          operationId: operation.operationId,
          plannedAttempt: fixture.input.predecessor.plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const input = { ...fixture.input, targetLineage: observation, targetLineageObservedAt: lineage.position }
      const history = reduceWorkflowJournalHistory(fixture.runId, fixture.records())
      if (history._tag === "InvalidWorkflowJournalHistory")
        return yield* Effect.die("H3 refresh chronology must be valid")
      expect(integratorAutomaticSuccessorPreparationIsCurrent(history.prefix, fixture.input)).toBe(false)
      expect(integratorAutomaticSuccessorPreparationIsCurrent(history.prefix, input)).toBe(true)
      const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(input, history.prefix)
      if (prepared._tag !== "Append") return yield* Effect.die("fresh H3 evidence must prepare one successor")
      expect(prepared.event.authorizationAt).toBe(auth.position)
      expect(prepared.event.successor.expectedTargetHead).toBe(h3)
      expect(prepared.event.successor.acceptedResult).toEqual(fixture.input.predecessor.acceptedResult)
      expect(prepared.event.successor.plannedAttempt).toEqual(fixture.input.predecessor.plannedAttempt)
      fixture.append(prepared.event)

      const seed = (store: JournalStore["Service"]) =>
        Effect.gen(function* () {
          const [began, ...rest] = fixture.records()
          if (began?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("history must begin with Run")
          yield* store.beginRun(
            fixture.runId,
            began.event.target,
            began.event.initialControlPolicy,
            began.event.remotePublicationTarget
          )
          for (const record of rest) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
              return yield* Effect.die("history may not contain another Run lifecycle event")
            }
            yield* store.append(fixture.runId, record.key, record.event)
          }
        })
      const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
      const memory = Context.get(memoryContext, JournalStore)
      yield* seed(memory)
      const memoryRecords = yield* memory.read(fixture.runId)
      expect(
        memoryRecords.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
      ).toHaveLength(1)

      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-h3-round-reopen-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const openSqlite = <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>) =>
        Effect.scoped(
          Effect.gen(function* () {
            return yield* use(yield* JournalStore)
          }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
        )
      yield* openSqlite(seed)
      const reopened = yield* openSqlite((store) => store.read(fixture.runId))
      expect(reopened.filter(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")).toHaveLength(
        1
      )
      expect(reopened.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toEqual([
        expect.objectContaining({ event: prepared.event })
      ])
      expect(
        reopened.flatMap(({ event }) =>
          event._tag === "RemoteBaselineReadIntended" && event.correlation._tag === "AutomaticCompetingHead"
            ? [Number(event.correlation.baselineRound)]
            : []
        )
      ).toEqual([1, 2])
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
)

it.effect(
  "reconciles a pending H3 refresh catch-up through ResponseDeadline before one CAS in memory and reopened SQLite",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = makeSuccessorPrefix()
        const initialRecords = fixture.records()
        const authorization = initialRecords.find(
          ({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
        )
        const firstRead = initialRecords.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
        if (
          authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
          firstRead?.event._tag !== "RemoteBaselineReadIntended"
        ) {
          return yield* Effect.die("accepted H2 prefix must contain its exact authorization and baseline")
        }
        const h2 = authorization.event.remoteHead
        const h3 = GitCommitShaSchema.make("8".repeat(40))
        const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
          fixture.runId,
          firstRead.event.correlation.responsibility,
          firstRead.event.correlation.localTarget,
          firstRead.event.correlation.remoteTarget,
          authorization.position,
          RemoteBaselineRound.make(2)
        )
        fixture.append(
          RemoteBaselineReadIntendedEvent.make({
            correlation: roundTwo,
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
        )
        const roundTwoRead = fixture.records().at(-1)
        if (roundTwoRead?.event._tag !== "RemoteBaselineReadIntended") {
          return yield* Effect.die("H3 refresh prefix must end at its exact read intent")
        }

        const currentLocalHead = yield* Ref.make(h2)
        const timeline = yield* Ref.make<ReadonlyArray<string>>([])
        const remoteReadCount = yield* Ref.make(0)
        const catchUpEntryCount = yield* Ref.make(0)
        const reconciliationCount = yield* Ref.make(0)
        const casCount = yield* Ref.make(0)
        type Phase = "ObserveH3" | "StopBeforeCas" | "ResponseDeadline" | "Apply"
        const makeGit = (phase: Phase): RemoteBaselineGitService =>
          RemoteBaselineGit.of({
            observe: (receivedCorrelation) =>
              Effect.gen(function* () {
                expect(phase).toBe("ObserveH3")
                expect(receivedCorrelation).toEqual(roundTwo)
                yield* Ref.update(timeline, (items) => [...items, "observe-H3"])
                yield* Ref.update(remoteReadCount, (count) => count + 1)
                return RemoteBaselineObservation.cases.LocalAncestor.make({ localHead: h2, remoteHead: h3 })
              }),
            catchUp: (receivedCorrelation, expectedLocalHead, remoteHead) =>
              Effect.gen(function* () {
                expect(phase).toBe("StopBeforeCas")
                expect(receivedCorrelation).toEqual(roundTwo)
                expect(expectedLocalHead).toBe(h2)
                expect(remoteHead).toBe(h3)
                expect(yield* Ref.get(currentLocalHead)).toBe(h2)
                yield* Ref.update(timeline, (items) => [...items, "catch-up-intent-before-CAS"])
                yield* Ref.update(catchUpEntryCount, (count) => count + 1)
                return yield* Effect.die("process stopped after the exact catch-up intent and before CAS")
              }),
            reconcileCatchUp: (receivedCorrelation, expectedLocalHead, remoteHead) =>
              Effect.gen(function* () {
                expect(phase === "ResponseDeadline" || phase === "Apply").toBe(true)
                expect(receivedCorrelation).toEqual(roundTwo)
                expect(expectedLocalHead).toBe(h2)
                expect(remoteHead).toBe(h3)
                expect(yield* Ref.get(currentLocalHead)).toBe(h2)
                yield* Ref.update(timeline, (items) => [...items, `reconcile-${phase}`])
                yield* Ref.update(reconciliationCount, (count) => count + 1)
                if (phase === "ResponseDeadline") {
                  return yield* Effect.fail(new RemoteBaselineFailure({ reason: "ResponseDeadline" }))
                }
                yield* Ref.update(casCount, (count) => count + 1)
                yield* Ref.set(currentLocalHead, h3)
                return LocalTargetCatchUpResult.cases.Applied.make({ newHead: h3 })
              })
          })

        const seedRecords = (store: JournalStore["Service"]) =>
          Effect.gen(function* () {
            const [beginning, ...remaining] = fixture.records()
            if (beginning?.event._tag !== "WorkflowRunBegan") {
              return yield* Effect.die("H3 refresh prefix must begin with its pinned Run")
            }
            yield* store.beginRun(
              fixture.runId,
              beginning.event.target,
              beginning.event.initialControlPolicy,
              beginning.event.remotePublicationTarget
            )
            for (const record of remaining) {
              if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
                return yield* Effect.die("H3 refresh prefix may not contain another Run lifecycle event")
              }
              yield* store.append(fixture.runId, record.key, record.event)
            }
          })
        const activate = (store: JournalStore["Service"], phase: Phase) =>
          Effect.scoped(
            Effect.gen(function* () {
              const records = yield* store.read(fixture.runId)
              const history = reduceWorkflowJournalHistory(fixture.runId, records)
              if (history._tag === "InvalidWorkflowJournalHistory") {
                return yield* Effect.die(`reopened H3 pending prefix is invalid: ${JSON.stringify(history.issues)}`)
              }
              return yield* establishRemoteBaseline(roundTwo).pipe(
                Effect.provide(journalLayer(fixture.runId, fixture.accepted.trackerTarget, history, store)),
                Effect.provideService(RemoteBaselineGit, makeGit(phase))
              )
            })
          )
        const assertExactPendingIntent = (records: ReadonlyArray<JournalRecord>) => {
          const authorizations = records.filter(
            ({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
          )
          expect(authorizations).toEqual([authorization])
          const reads = records.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")
          expect(reads).toHaveLength(2)
          expect(reads[1]).toEqual(roundTwoRead)
          const observations = records.filter(({ event }) => event._tag === "RemoteBaselineObserved")
          expect(observations).toHaveLength(2)
          expect(observations[1]?.event).toMatchObject({
            correlation: roundTwo,
            observation: { _tag: "LocalAncestor", localHead: h2, remoteHead: h3 }
          })
          const catchUpIntents = records.filter(({ event }) => event._tag === "LocalTargetCatchUpIntended")
          expect(catchUpIntents).toHaveLength(2)
          expect(catchUpIntents[1]?.event).toMatchObject({
            correlation: roundTwo,
            expectedLocalHead: h2,
            remoteHead: h3
          })
          expect(records.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(
            0
          )
          return catchUpIntents[1]
        }
        const exercise = (
          seed: Effect.Effect<unknown, unknown>,
          runActivation: (phase: Phase) => Effect.Effect<RemoteBaselineState, unknown>,
          read: () => Effect.Effect<ReadonlyArray<JournalRecord>, unknown>
        ) =>
          Effect.gen(function* () {
            yield* seed
            expect((yield* runActivation("ObserveH3"))._tag).toBe("CatchUpRequired")
            const interrupted = yield* Effect.exit(runActivation("StopBeforeCas"))
            expect(interrupted._tag).toBe("Failure")
            expect(yield* Ref.get(currentLocalHead)).toBe(h2)
            expect(yield* Ref.get(casCount)).toBe(0)
            const pendingBeforeDeadline = yield* read()
            const expectedCatchUpIntent = assertExactPendingIntent(pendingBeforeDeadline)
            expect(
              pendingBeforeDeadline.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
            ).toHaveLength(1)

            expect((yield* runActivation("ResponseDeadline"))._tag).toBe("CatchUpPending")
            const pendingAfterDeadline = yield* read()
            expect(assertExactPendingIntent(pendingAfterDeadline)).toEqual(expectedCatchUpIntent)
            expect(
              pendingAfterDeadline.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
            ).toHaveLength(1)
            expect(yield* Ref.get(currentLocalHead)).toBe(h2)
            expect(yield* Ref.get(casCount)).toBe(0)

            expect((yield* runActivation("Apply"))._tag).toBe("Ready")
            const settled = yield* read()
            expect(assertExactPendingIntent(settled)).toEqual(expectedCatchUpIntent)
            const results = settled.filter(({ event }) => event._tag === "LocalTargetCatchUpObserved")
            expect(results).toHaveLength(2)
            expect(results[1]?.event).toMatchObject({
              correlation: roundTwo,
              expectedLocalHead: h2,
              remoteHead: h3,
              result: { _tag: "Applied", newHead: h3 }
            })
            expect(yield* Ref.get(currentLocalHead)).toBe(h3)
            expect(yield* Ref.get(remoteReadCount)).toBe(1)
            expect(yield* Ref.get(catchUpEntryCount)).toBe(1)
            expect(yield* Ref.get(reconciliationCount)).toBe(2)
            expect(yield* Ref.get(casCount)).toBe(1)
          })

        const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
        const memoryStore = Context.get(memoryContext, JournalStore)
        yield* exercise(
          seedRecords(memoryStore),
          (phase) => activate(memoryStore, phase),
          () => memoryStore.read(fixture.runId)
        )

        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-h3-catch-up-deadline-" })
        const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
        const openSqlite = <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown, Scope.Scope>) =>
          Effect.scoped(
            Effect.gen(function* () {
              const store = yield* JournalStore
              return yield* use(store)
            }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
          )
        yield* Ref.set(currentLocalHead, h2)
        yield* Ref.set(timeline, [])
        yield* Ref.set(remoteReadCount, 0)
        yield* Ref.set(catchUpEntryCount, 0)
        yield* Ref.set(reconciliationCount, 0)
        yield* Ref.set(casCount, 0)
        yield* exercise(
          openSqlite(seedRecords),
          (phase) => openSqlite((store) => activate(store, phase)),
          () => openSqlite((store) => store.read(fixture.runId))
        )
        expect(yield* Ref.get(timeline)).toEqual([
          "observe-H3",
          "catch-up-intent-before-CAS",
          "reconcile-ResponseDeadline",
          "reconcile-Apply"
        ])
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    )
)

it.effect("rejects a fresh automatic-successor baseline round after session fixation", () =>
  Effect.gen(function* () {
    const fixture = makeSuccessorPrefix()
    const initialHistory = reduceWorkflowJournalHistory(fixture.runId, fixture.records())
    if (initialHistory._tag === "InvalidWorkflowJournalHistory") {
      return yield* Effect.die("accepted successor prefix must reduce before fixation")
    }
    const fixed = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, initialHistory.prefix)
    if (fixed._tag !== "Append") return yield* Effect.die("ready H2 baseline must prepare the initial successor")
    fixture.append(fixed.event)
    const fixedProjection = yield* projectWorkflowOccurrences(fixture.records())
    expect(fixedProjection.occurrences.some(({ _tag }) => _tag === "IntegratorAutomaticSuccessorSessionFixed")).toBe(
      true
    )

    const authorization = fixture
      .records()
      .find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
    const firstBaseline = fixture.records().find(({ event }) => event._tag === "RemoteBaselineReadIntended")
    if (
      authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
      firstBaseline?.event._tag !== "RemoteBaselineReadIntended"
    ) {
      return yield* Effect.die("fixed successor history must preserve its exact authorization and baseline")
    }
    const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
      fixture.runId,
      firstBaseline.event.correlation.responsibility,
      firstBaseline.event.correlation.localTarget,
      firstBaseline.event.correlation.remoteTarget,
      authorization.position,
      RemoteBaselineRound.make(2)
    )
    fixture.append(
      RemoteBaselineReadIntendedEvent.make({
        correlation: roundTwo,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )

    const afterLateRefresh = yield* Effect.exit(projectWorkflowOccurrences(fixture.records()))
    expect(afterLateRefresh._tag).toBe("Failure")
  })
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
        if (correlation._tag !== "AutomaticCompetingHead" || correlation.authorizationAt !== authorization.position) {
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
        if (correlation._tag !== "AutomaticCompetingHead" || correlation.authorizationAt !== authorization.position) {
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
        if (correlation._tag !== "AutomaticCompetingHead" || correlation.authorizationAt !== authorization.position) {
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
        if (correlation._tag !== "AutomaticCompetingHead" || correlation.authorizationAt !== authorization.position) {
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
