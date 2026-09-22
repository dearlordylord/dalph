import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Path, Ref, type Scope } from "effect"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorCorrelationFor } from "../integrator/session.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import {
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushFailure,
  RemotePublicationPushResult,
  type RemotePublicationAttemptOrdinal,
  type RemotePublicationGitService
} from "./events.js"
import { runRemotePublication } from "./protocol-engine.js"

const fixture = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Recover one exact direct publication across process loss.",
  taskId: fixture.taskId,
  title: "Direct publication recovery"
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
const qualified = makePromotedIntegrationHistory({
  candidateCommit: fixture.qualifiedCandidate.candidateCommit,
  candidateText: fixture.qualifiedCandidate.candidateText,
  originalClaim: accepted.activeClaim,
  records: accepted.records,
  session: integratorCorrelationFor(accepted)
})
const candidate = qualified.qualifiedCandidate
const runId = candidate.run.session.plannedAttempt.runId
const target = remotePublicationTargetForTest

type StoreLane = "memory" | "sqlite"
type AppendCut = Readonly<{
  event:
    | "RemotePublicationIntended"
    | "RemotePublicationAttemptIntended"
    | "RemotePublicationAttemptRejectedNonFastForward"
    | "RemotePublicationSucceeded"
    | "RemotePublicationRetained"
  timing: "before" | "after"
}>

interface Calls {
  readonly custody: number
  readonly observations: number
  readonly preparations: ReadonlyArray<number>
  readonly pushes: ReadonlyArray<number>
  readonly timeline: ReadonlyArray<string>
}

const emptyCalls = (): Calls => ({ custody: 0, observations: 0, preparations: [], pushes: [], timeline: [] })
const ordinalNumber = (ordinal: RemotePublicationAttemptOrdinal): number => Number(ordinal)

const seedQualifiedHistory = Effect.fn("DirectPublicationRecovery.seedQualifiedHistory")(function* (
  store: JournalStore["Service"]
) {
  const [beginning, ...records] = qualified.qualifiedRecords
  if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("qualified history must begin the Run")
  yield* store.beginRun(
    runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of records) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die(`qualified history contains non-appendable ${record.event._tag}`)
    }
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

const runProcess = Effect.fn("DirectPublicationRecovery.runProcess")(function* (
  store: JournalStore["Service"],
  git: RemotePublicationGitService,
  cut?: AppendCut
) {
  const records = yield* store.read(runId)
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.die(`invalid retained publication prefix: ${JSON.stringify(history.issues)}`)
  }
  return yield* runRemotePublication(candidate, target, {
    runObservation: (phase) => phase,
    runSender: (phase) => phase
  }).pipe(
    Effect.provide(journalLayer(runId, fixture.target, history, faultingBoundary(store, cut))),
    Effect.provideService(RemotePublicationGit, git)
  )
})

const recordTags = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> =>
  records.map(({ event }) => event._tag)

const publicationOrdinals = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<number> =>
  records.flatMap(({ event }) =>
    event._tag === "RemotePublicationAttemptIntended" ? [Number(event.attemptOrdinal)] : []
  )

const makeGit = Effect.fn("DirectPublicationRecovery.makeGit")(function* (options?: {
  readonly custody?: "stopped" | "unproven"
  readonly observeApplied?: boolean
  readonly push?: "applied" | "lost-applied" | "lost-unapplied" | "rejected"
}) {
  const calls = yield* Ref.make(emptyCalls())
  const remoteApplied = yield* Ref.make(options?.observeApplied ?? false)
  const update = (f: (current: Calls) => Calls) => Ref.update(calls, f)
  const git = RemotePublicationGit.of({
    admit: () => Effect.die("destination admission precedes this qualified recovery prefix"),
    prepareSenderCustody: (_request, ordinal) =>
      update((current) => ({
        ...current,
        preparations: [...current.preparations, ordinalNumber(ordinal)],
        timeline: [...current.timeline, `prepare:${ordinalNumber(ordinal)}`]
      })),
    reconcileSenderCustody: () =>
      update((current) => ({
        ...current,
        custody: current.custody + 1,
        timeline: [...current.timeline, "custody"]
      })).pipe(
        Effect.andThen(
          options?.custody === "unproven"
            ? Effect.fail(new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target }))
            : Effect.void
        )
      ),
    observe: () =>
      update((current) => ({
        ...current,
        observations: current.observations + 1,
        timeline: [...current.timeline, "observe"]
      })).pipe(
        Effect.andThen(Ref.get(remoteApplied)),
        Effect.map((applied) =>
          applied
            ? RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: candidate.candidateCommit })
            : RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
                remoteHead: candidate.run.session.expectedTargetHead
              })
        )
      ),
    push: (_request, ordinal) =>
      update((current) => ({
        ...current,
        pushes: [...current.pushes, ordinalNumber(ordinal)],
        timeline: [...current.timeline, `push:${ordinalNumber(ordinal)}`]
      })).pipe(
        Effect.andThen(
          options?.push === "rejected"
            ? Effect.succeed<RemotePublicationPushResult>(
                RemotePublicationPushResult.cases.RejectedNonFastForward.make({})
              )
            : options?.push === "lost-applied"
              ? Ref.set(remoteApplied, true).pipe(Effect.andThen(Effect.die("process lost after applied push")))
              : options?.push === "lost-unapplied"
                ? Effect.die("process lost after stopped unapplied push")
                : Ref.set(remoteApplied, true).pipe(
                    Effect.as(RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidate.candidateCommit }))
                  )
        )
      )
  })
  return { calls, git }
})

const assertNoRemoteEffects = Effect.fn("DirectPublicationRecovery.assertNoRemoteEffects")(function* (
  calls: Ref.Ref<Calls>
) {
  expect(yield* Ref.get(calls)).toEqual(emptyCalls())
})

const expectProcessLoss = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
  Effect.exit(effect).pipe(
    Effect.tap((exit) => Effect.sync(() => expect(exit._tag).toBe("Failure"))),
    Effect.asVoid
  )

const exerciseRecoveryCuts = Effect.fn("DirectPublicationRecovery.exerciseCuts")(function* (
  lane: StoreLane,
  fresh: <A>(
    use: (
      open: <B>(
        process: (store: JournalStore["Service"]) => Effect.Effect<B, unknown>,
        afterAppendCommit?: () => Effect.Effect<void, string>
      ) => Effect.Effect<B, unknown>
    ) => Effect.Effect<A, unknown>
  ) => Effect.Effect<A, unknown, Scope.Scope>
) {
  // The process disappears before the outer intent is durable. Recovery starts publication from the qualified prefix.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const rejected = yield* makeGit({ push: "rejected" })
      yield* expectProcessLoss(
        open((store) =>
          runProcess(store, rejected.git, { event: "RemotePublicationAttemptRejectedNonFastForward", timing: "after" })
        )
      )
      const retained = yield* open((store) => store.read(runId))
      expect(recordTags(retained).at(-1)).toBe("RemotePublicationAttemptRejectedNonFastForward")
      expect(publicationOrdinals(retained)).toEqual([1])
      const recovery = yield* makeGit()
      expect((yield* open((store) => runProcess(store, recovery.git)))._tag).toBe("PublicationSucceeded")
      expect((yield* Ref.get(recovery.calls)).timeline).toEqual(["custody", "observe", "prepare:2", "push:2"])
      expect(publicationOrdinals(yield* open((store) => store.read(runId)))).toEqual([1, 2])
    })
  )

  yield* fresh((open) =>
    Effect.gen(function* () {
      const beforeOuter = yield* makeGit()
      yield* expectProcessLoss(
        open((store) => runProcess(store, beforeOuter.git, { event: "RemotePublicationIntended", timing: "before" }))
      )
      yield* assertNoRemoteEffects(beforeOuter.calls)
      const outerRecovery = yield* makeGit()
      expect((yield* open((store) => runProcess(store, outerRecovery.git)))._tag).toBe("PublicationSucceeded")
    })
  )

  // A committed numbered intent denotes a reserved, unsent ordinal. Recovery reconciles it before observation and push.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const unsent = yield* makeGit()
      yield* expectProcessLoss(
        open((store) => runProcess(store, unsent.git, { event: "RemotePublicationAttemptIntended", timing: "after" }))
      )
      expect(yield* Ref.get(unsent.calls)).toMatchObject({ custody: 0, observations: 1, preparations: [1], pushes: [] })
      const unsentRecovery = yield* makeGit()
      expect((yield* open((store) => runProcess(store, unsentRecovery.git)))._tag).toBe("PublicationSucceeded")
      expect(yield* Ref.get(unsentRecovery.calls)).toMatchObject({ custody: 1, observations: 1, pushes: [2] })
      expect((yield* Ref.get(unsentRecovery.calls)).timeline).toEqual(["custody", "observe", "prepare:2", "push:2"])
      expect(publicationOrdinals(yield* open((store) => store.read(runId)))).toEqual([1, 2])
    })
  )

  // The remote accepted the send before the response was lost. Fresh observation proves it without another push.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const appliedLoss = yield* makeGit({ push: "lost-applied" })
      yield* expectProcessLoss(open((store) => runProcess(store, appliedLoss.git)))
      const appliedRecovery = yield* makeGit({ observeApplied: true })
      expect((yield* open((store) => runProcess(store, appliedRecovery.git)))._tag).toBe("PublicationSucceeded")
      expect(yield* Ref.get(appliedRecovery.calls)).toMatchObject({ custody: 1, observations: 1, pushes: [] })
      expect((yield* Ref.get(appliedRecovery.calls)).timeline).toEqual(["custody", "observe"])
    })
  )

  // The stopped sender did not apply the send. Recovery reads first, then spends the remaining ordinal once.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const unappliedLoss = yield* makeGit({ push: "lost-unapplied" })
      yield* expectProcessLoss(open((store) => runProcess(store, unappliedLoss.git)))
      const unappliedRecovery = yield* makeGit()
      expect((yield* open((store) => runProcess(store, unappliedRecovery.git)))._tag).toBe("PublicationSucceeded")
      expect(yield* Ref.get(unappliedRecovery.calls)).toMatchObject({ custody: 1, observations: 1, pushes: [2] })
      expect((yield* Ref.get(unappliedRecovery.calls)).timeline).toEqual(["custody", "observe", "prepare:2", "push:2"])
      expect(publicationOrdinals(yield* open((store) => store.read(runId)))).toEqual([1, 2])
    })
  )

  // Publication success committed before its acknowledgement was lost. A fresh Journal performs no remote work.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const successLoss = yield* makeGit()
      const successCommitCount = yield* Ref.make(0)
      const successHook = () =>
        Ref.updateAndGet(successCommitCount, (count) => count + 1).pipe(
          Effect.flatMap((count) => (count === 3 ? Effect.die("process lost after success COMMIT") : Effect.void))
        )
      yield* expectProcessLoss(
        open(
          (store) =>
            runProcess(
              store,
              successLoss.git,
              lane === "memory" ? { event: "RemotePublicationSucceeded", timing: "after" } : undefined
            ),
          lane === "sqlite" ? successHook : undefined
        )
      )
      expect(recordTags(yield* open((store) => store.read(runId)))).toContain("RemotePublicationSucceeded")
      const successRecovery = yield* makeGit()
      expect((yield* open((store) => runProcess(store, successRecovery.git)))._tag).toBe("PublicationSucceeded")
      yield* assertNoRemoteEffects(successRecovery.calls)
    })
  )

  // A custody-unproven retained result committed before acknowledgement. A fresh Journal remains inert.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const retainedPending = yield* makeGit({ push: "lost-unapplied" })
      yield* expectProcessLoss(open((store) => runProcess(store, retainedPending.git)))
      const retainedLoss = yield* makeGit({ custody: "unproven" })
      yield* expectProcessLoss(
        open(
          (store) =>
            runProcess(
              store,
              retainedLoss.git,
              lane === "memory" ? { event: "RemotePublicationRetained", timing: "after" } : undefined
            ),
          lane === "sqlite" ? () => Effect.die("process lost after retained COMMIT") : undefined
        )
      )
      expect(recordTags(yield* open((store) => store.read(runId)))).toContain("RemotePublicationRetained")
      const retainedRecovery = yield* makeGit()
      expect((yield* open((store) => runProcess(store, retainedRecovery.git)))._tag).toBe("PublicationRetained")
      yield* assertNoRemoteEffects(retainedRecovery.calls)
    })
  )

  // An unreadable prior sender is reconciled at the custody boundary and blocks observation and push.
  yield* fresh((open) =>
    Effect.gen(function* () {
      const unreadablePending = yield* makeGit({ push: "lost-unapplied" })
      yield* expectProcessLoss(open((store) => runProcess(store, unreadablePending.git)))
      const unreadable = yield* makeGit({ custody: "unproven" })
      expect((yield* open((store) => runProcess(store, unreadable.git)))._tag).toBe("PublicationRetained")
      expect(yield* Ref.get(unreadable.calls)).toMatchObject({ custody: 1, observations: 0, pushes: [] })
      expect((yield* Ref.get(unreadable.calls)).timeline).toEqual(["custody"])
    })
  )
})

it.effect("recovers every initial remote delivery boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const memoryFresh = <A, E>(
        use: (
          open: <B, F>(process: (store: JournalStore["Service"]) => Effect.Effect<B, F>) => Effect.Effect<B, F>
        ) => Effect.Effect<A, E>
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(memoryJournalStoreLayer)
            const store = Context.get(context, JournalStore)
            yield* seedQualifiedHistory(store)
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
          const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-direct-publication-recovery-" })
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
          yield* open(seedQualifiedHistory)
          return yield* use(open)
        })
      yield* exerciseRecoveryCuts("sqlite", sqliteFresh)
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
)
