import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { makeTaskWorkSpecification, type GitCommitSha } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Path, Ref, type Scope } from "effect"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorResponsibilityFactsFor } from "../integrator/state.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineFailure,
  RemoteBaselineObservation,
  type RemoteBaselineGitService,
  remoteBaselineCorrelationFor
} from "./baseline-events.js"
import { establishRemoteBaseline } from "./baseline-protocol-engine.js"

const fixture = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Recover one exact remote baseline across process loss.",
  taskId: fixture.taskId,
  title: "Remote baseline recovery"
})
const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
const accepted = makeAcceptedIntegrationHistory({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: fixture.activeClaim,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt,
  runId: fixture.runId,
  targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: specification,
  trackerTarget: fixture.target
})
const runId = accepted.runId
const target = remotePublicationTargetForTest
const correlation = remoteBaselineCorrelationFor(
  runId,
  integratorResponsibilityFactsFor(accepted.responsibility),
  accepted.integrationTarget,
  target
)
const localHead = accepted.targetLineage.targetHeadSha
const remoteHead = fixture.qualifiedCandidate.candidateCommit

type AppendCut = Readonly<{
  event:
    | "RemoteBaselineReadIntended"
    | "RemoteBaselineObserved"
    | "LocalTargetCatchUpIntended"
    | "LocalTargetCatchUpObserved"
  timing: "before" | "after"
}>

interface Calls {
  readonly catches: ReadonlyArray<string>
  readonly observations: number
  readonly reconciliations: ReadonlyArray<string>
  readonly timeline: ReadonlyArray<string>
}

const emptyCalls = (): Calls => ({ catches: [], observations: 0, reconciliations: [], timeline: [] })
const casKey = (expected: GitCommitSha, remote: GitCommitSha): string => `${expected}->${remote}`

const seedAcceptedHistory = Effect.fn("RemoteBaselineRecovery.seedAcceptedHistory")(function* (
  store: JournalStore["Service"]
) {
  const [beginning, ...records] = accepted.records
  if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("accepted history must begin the Run")
  yield* store.beginRun(
    runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of records) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated")
      return yield* Effect.die("unexpected lifecycle event in accepted prefix")
    yield* store.append(runId, record.key, record.event)
  }
})

const faultingBoundary = (store: JournalStore["Service"], cut: AppendCut | undefined): JournalStorageBoundary => {
  let unused = cut !== undefined
  return {
    append: (requestedRunId, key, event) => {
      if (!unused || event._tag !== cut?.event) return store.append(requestedRunId, key, event)
      unused = false
      if (cut.timing === "before") return Effect.die(`process lost before ${event._tag} append`)
      return store
        .append(requestedRunId, key, event)
        .pipe(Effect.flatMap(() => Effect.die(`process lost after ${event._tag} append`)))
    },
    read: store.read,
    terminateRun: store.terminateRun
  }
}

const runProcess = Effect.fn("RemoteBaselineRecovery.runProcess")(function* (
  store: JournalStore["Service"],
  git: RemoteBaselineGitService,
  cut?: AppendCut
) {
  const records = yield* store.read(runId)
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.die(`invalid retained baseline prefix: ${JSON.stringify(history.issues)}`)
  }
  return yield* establishRemoteBaseline(correlation).pipe(
    Effect.flatMap((state) =>
      state._tag === "CatchUpRequired" ? establishRemoteBaseline(correlation) : Effect.succeed(state)
    ),
    Effect.provide(
      journalLayer(runId, accepted.trackerTarget, history, faultingBoundary(store, cut), () => Effect.void)
    ),
    Effect.provideService(RemoteBaselineGit, git)
  )
})

const makeGit = Effect.fn("RemoteBaselineRecovery.makeGit")(function* (
  currentLocalHead: Ref.Ref<GitCommitSha>,
  options?: {
    readonly observation?: "aligned" | "ancestor" | "diverged" | "unavailable"
    readonly catchUp?: "applied" | "lost-applied" | "lost-unapplied" | "unavailable"
    readonly reconcile?: "unavailable" | "deadline"
  }
) {
  const calls = yield* Ref.make(emptyCalls())
  const update = (f: (current: Calls) => Calls) => Ref.update(calls, f)
  const observation = options?.observation ?? "ancestor"
  const catchUp = options?.catchUp ?? "applied"
  const reconcile = options?.reconcile
  const git = RemoteBaselineGit.of({
    observe: () =>
      update((current) => ({
        ...current,
        observations: current.observations + 1,
        timeline: [...current.timeline, "observe"]
      })).pipe(
        Effect.andThen(
          observation === "unavailable"
            ? Effect.fail(new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
            : Effect.succeed<RemoteBaselineObservation>(
                observation === "aligned"
                  ? RemoteBaselineObservation.cases.Aligned.make({ localHead, remoteHead: localHead })
                  : observation === "diverged"
                    ? RemoteBaselineObservation.cases.Diverged.make({ localHead, remoteHead })
                    : RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead })
              )
        )
      ),
    catchUp: (_correlation, expectedLocalHead, observedRemoteHead) =>
      update((current) => ({
        ...current,
        catches: [...current.catches, casKey(expectedLocalHead, observedRemoteHead)],
        timeline: [...current.timeline, "catch-up"]
      })).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const current = yield* Ref.get(currentLocalHead)
            if (current !== expectedLocalHead) {
              return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: current })
            }
            if (catchUp === "unavailable") return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
            if (catchUp === "lost-unapplied") return yield* Effect.die("process lost before catch-up applied")
            yield* Ref.set(currentLocalHead, observedRemoteHead)
            if (catchUp === "lost-applied") return yield* Effect.die("process lost after catch-up applied")
            return LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead })
          })
        )
      ),
    reconcileCatchUp: (_correlation, expectedLocalHead, observedRemoteHead) =>
      update((current) => ({
        ...current,
        reconciliations: [...current.reconciliations, casKey(expectedLocalHead, observedRemoteHead)],
        timeline: [...current.timeline, "reconcile-catch-up"]
      })).pipe(
        Effect.andThen(
          reconcile === "deadline"
            ? Effect.fail(new RemoteBaselineFailure({ reason: "ResponseDeadline" }))
            : reconcile === "unavailable"
              ? Effect.fail(new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
              : Effect.gen(function* () {
                  const current = yield* Ref.get(currentLocalHead)
                  if (current === observedRemoteHead) {
                    return LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: current })
                  }
                  if (current !== expectedLocalHead) {
                    return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: current })
                  }
                  yield* Ref.set(currentLocalHead, observedRemoteHead)
                  return LocalTargetCatchUpResult.cases.Applied.make({ newHead: observedRemoteHead })
                })
        )
      )
  })
  return { calls, git }
})

const expectProcessLoss = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
  Effect.exit(effect).pipe(
    Effect.tap((exit) => Effect.sync(() => expect(exit._tag).toBe("Failure"))),
    Effect.asVoid
  )

const assertNoRemoteEffects = Effect.fn("RemoteBaselineRecovery.assertNoRemoteEffects")(function* (
  calls: Ref.Ref<Calls>
) {
  expect(yield* Ref.get(calls)).toEqual(emptyCalls())
})

const exerciseRecoveryCuts = Effect.fn("RemoteBaselineRecovery.exerciseCuts")(function* (
  lane: "memory" | "sqlite",
  fresh: <A>(
    use: (
      open: <B>(
        process: (store: JournalStore["Service"]) => Effect.Effect<B, unknown>,
        afterAppendCommit?: () => Effect.Effect<void, string>
      ) => Effect.Effect<B, unknown>
    ) => Effect.Effect<A, unknown>
  ) => Effect.Effect<A, unknown, Scope.Scope>
) {
  const cutForLane = (cut: AppendCut): AppendCut | undefined => (lane === "memory" ? cut : undefined)
  const appendCommitLossAt = (appendNumber: number) => {
    let count = 0
    return () =>
      Effect.sync(() => {
        count += 1
        return count
      }).pipe(
        Effect.flatMap((current) =>
          current === appendNumber ? Effect.die("process lost after append COMMIT") : Effect.void
        )
      )
  }

  // The coordinator loses the read intent before its durable append, so no Git read is allowed.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local)
      yield* expectProcessLoss(
        open((store) => runProcess(store, first.git, { event: "RemoteBaselineReadIntended", timing: "before" }))
      )
      yield* assertNoRemoteEffects(first.calls)
      const recovery = yield* makeGit(local)
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Ready")
      expect((yield* Ref.get(recovery.calls)).timeline).toEqual(["observe", "catch-up"])
    })
  )

  // A committed read observation survives a lost acknowledgement and requires no new read.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local, { observation: "aligned" })
      yield* expectProcessLoss(
        open(
          (store) => runProcess(store, first.git, cutForLane({ event: "RemoteBaselineObserved", timing: "after" })),
          lane === "sqlite" ? appendCommitLossAt(2) : undefined
        )
      )
      const recovery = yield* makeGit(local, { observation: "aligned" })
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Ready")
      yield* assertNoRemoteEffects(recovery.calls)
    })
  )

  // A committed catch-up intent is reconciled before any fresh mutation call.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local)
      yield* expectProcessLoss(
        open(
          (store) => runProcess(store, first.git, cutForLane({ event: "LocalTargetCatchUpIntended", timing: "after" })),
          lane === "sqlite" ? appendCommitLossAt(3) : undefined
        )
      )
      expect((yield* Ref.get(first.calls)).timeline).toEqual(["observe"])
      const recovery = yield* makeGit(local)
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Ready")
      expect((yield* Ref.get(recovery.calls)).timeline).toEqual(["reconcile-catch-up"])
      expect(yield* Ref.get(recovery.calls)).toMatchObject({
        catches: [],
        reconciliations: [casKey(localHead, remoteHead)]
      })
    })
  )

  // A lost response after applying the CAS is reconciled as AlreadyCurrent without a duplicate CAS.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local, { catchUp: "lost-applied" })
      yield* expectProcessLoss(open((store) => runProcess(store, first.git)))
      const recovery = yield* makeGit(local)
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Ready")
      expect(yield* Ref.get(first.calls)).toMatchObject({ catches: [casKey(localHead, remoteHead)] })
      expect(yield* Ref.get(recovery.calls)).toMatchObject({
        catches: [],
        reconciliations: [casKey(localHead, remoteHead)]
      })
    })
  )

  // A lost response before the CAS is applied lets the reconciliation operation retry that exact CAS safely.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local, { catchUp: "lost-unapplied" })
      yield* expectProcessLoss(open((store) => runProcess(store, first.git)))
      const recovery = yield* makeGit(local)
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Ready")
      expect(yield* Ref.get(recovery.calls)).toMatchObject({
        catches: [],
        reconciliations: [casKey(localHead, remoteHead)]
      })
      expect(yield* Ref.get(local)).toBe(remoteHead)
    })
  )

  // A committed catch-up observation survives a lost acknowledgement and performs no further effects.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local)
      yield* expectProcessLoss(
        open(
          (store) => runProcess(store, first.git, cutForLane({ event: "LocalTargetCatchUpObserved", timing: "after" })),
          lane === "sqlite" ? appendCommitLossAt(4) : undefined
        )
      )
      const recovery = yield* makeGit(local)
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Ready")
      yield* assertNoRemoteEffects(recovery.calls)
    })
  )

  // A divergent baseline is retained as an unsafe observation and never attempts local catch-up on recovery.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local, { observation: "diverged" })
      expect((yield* open((store) => runProcess(store, first.git)))._tag).toBe("Retained")
      const recovery = yield* makeGit(local)
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("Retained")
      yield* assertNoRemoteEffects(recovery.calls)
    })
  )

  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const unavailable = yield* makeGit(local, { observation: "unavailable" })
      expect((yield* open((store) => runProcess(store, unavailable.git)))._tag).toBe("Retained")
    })
  )

  yield* fresh((open) =>
    Effect.gen(function* () {
      const local = yield* Ref.make(localHead)
      const first = yield* makeGit(local, { catchUp: "unavailable" })
      expect((yield* open((store) => runProcess(store, first.git)))._tag).toBe("CatchUpPending")
      const recovery = yield* makeGit(local, { reconcile: "deadline" })
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("CatchUpPending")
      const retained = yield* makeGit(local, { reconcile: "unavailable" })
      expect((yield* open((store) => runProcess(store, retained.git)))._tag).toBe("Retained")
    })
  )
})

it.effect("recovers the initial remote baseline across memory and reopened SQLite journals", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const memoryFresh = <A>(
        use: (
          open: <B>(
            process: (store: JournalStore["Service"]) => Effect.Effect<B, unknown>,
            afterAppendCommit?: () => Effect.Effect<void, string>
          ) => Effect.Effect<B, unknown>
        ) => Effect.Effect<A, unknown>
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(memoryJournalStoreLayer)
            const store = Context.get(context, JournalStore)
            yield* seedAcceptedHistory(store)
            return yield* use((process) => process(store))
          })
        )
      yield* exerciseRecoveryCuts("memory", memoryFresh)

      const sqliteFresh = <A>(
        use: (
          open: <B>(
            process: (store: JournalStore["Service"]) => Effect.Effect<B, unknown>,
            afterAppendCommit?: () => Effect.Effect<void, string>
          ) => Effect.Effect<B, unknown>
        ) => Effect.Effect<A, unknown>
      ) =>
        Effect.gen(function* () {
          const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-baseline-recovery-" })
          const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
          const open = <B>(
            process: (store: JournalStore["Service"]) => Effect.Effect<B, unknown>,
            afterAppendCommit?: () => Effect.Effect<void, string>
          ) =>
            Effect.scoped(
              Effect.gen(function* () {
                const store = yield* JournalStore
                return yield* process(store)
              }).pipe(
                Effect.provide(
                  afterAppendCommit === undefined
                    ? sqliteJournalStoreLayer({ filename })
                    : sqliteJournalTestLayer({ afterAppendCommit, filename })
                )
              )
            )
          yield* open(seedAcceptedHistory)
          return yield* use(open)
        })
      yield* exerciseRecoveryCuts("sqlite", sqliteFresh)
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
)
