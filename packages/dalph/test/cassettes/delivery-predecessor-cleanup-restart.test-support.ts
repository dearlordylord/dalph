import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref } from "effect"
import {
  branchCleanupTestLayer,
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupObservation,
  type IntegratorCandidateResourceLocator,
  type IntegratorSessionId,
  JournalDatabaseLocator,
  JournalStore,
  journalLayer,
  makeDispositionCleanupActivation,
  reduceWorkflowJournalHistory,
  sqliteJournalStoreLayer,
  worktreeCleanupTestLayer,
  type JournalRecord
} from "@dalph/orchestrator"
import { prefixThrough } from "../conformance/recovery-store-lanes.js"

const presentEvidenceOrdinal = 7
const absentEvidenceOrdinal = 8
const presentEvidenceRevision = IntegratorCandidateCleanupEvidenceRevision.make(presentEvidenceOrdinal)
const absentEvidenceRevision = IntegratorCandidateCleanupEvidenceRevision.make(absentEvidenceOrdinal)

/** The provider keeps its removed resource while fresh SQLite/application layers reopen the retained exact A prefix. */
export const restartPredecessorCleanupAfterRemoval = (history: ReadonlyArray<JournalRecord>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const source = prefixThrough(history, "BeforeCleanup", "A fixed successor before cleanup", history.length - 1)
      if (source === undefined) return yield* Effect.die("missing A source history")
      const beginning = source.records[0]
      if (beginning.event._tag !== "WorkflowRunBegan") return yield* Effect.die("missing Run beginning")
      const target = beginning.event.target
      const initialPolicy = beginning.event.initialControlPolicy
      const runId = beginning.runId
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-A-cleanup-restart-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const removed = yield* Ref.make(false)
      const reached = yield* Deferred.make<void>()
      const calls = yield* Ref.make<
        ReadonlyArray<{
          readonly tag: "Observe" | "Remove"
          readonly locator: IntegratorCandidateResourceLocator
          readonly sessionId: IntegratorSessionId
        }>
      >([])
      const boundary = IntegratorCandidateCleanupBoundary.of({
        readEvidenceRevision: () => Effect.succeed(presentEvidenceRevision),
        observe: (authorization) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (values) => [
              ...values,
              { tag: "Observe", locator: authorization.locator, sessionId: authorization.owner.sessionId }
            ])
            return (yield* Ref.get(removed))
              ? IntegratorCandidateCleanupObservation.cases.Absent.make({
                  locator: authorization.locator,
                  revision: absentEvidenceRevision
                })
              : IntegratorCandidateCleanupObservation.cases.Present.make({
                  locator: authorization.locator,
                  revision: authorization.evidenceRevision,
                  sessionId: authorization.owner.sessionId,
                  writerQuiescent: true
                })
          }),
        remove: (authorization) =>
          Ref.update(calls, (values) => [
            ...values,
            { tag: "Remove", locator: authorization.locator, sessionId: authorization.owner.sessionId }
          ]).pipe(
            Effect.andThen(Ref.set(removed, true)),
            Effect.andThen(Deferred.succeed(reached, undefined)),
            Effect.andThen(Effect.never.pipe(Effect.interruptible))
          )
      })
      const boundaries = Layer.mergeAll(
        Layer.succeed(IntegratorCandidateCleanupBoundary, boundary),
        worktreeCleanupTestLayer({ observations: [] }),
        branchCleanupTestLayer({ observations: [] })
      )
      const prefixRecords = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.beginRun(runId, target, initialPolicy)
          for (const record of source.records.slice(1)) {
            if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated")
              return yield* Effect.die("cleanup source is not one unfinished Run")
            yield* journal.append(runId, record.key, record.event)
          }
          const historyState = reduceWorkflowJournalHistory(runId, source.records)
          if (historyState._tag !== "ValidWorkflowJournalHistory")
            return yield* Effect.die("invalid exact A source prefix")
          const first = yield* makeDispositionCleanupActivation(runId).pipe(
            Effect.flatMap((activation) => activation.run),
            Effect.provide(Layer.merge(journalLayer(runId, target, historyState, journal), boundaries)),
            Effect.forkScoped
          )
          yield* Deferred.await(reached).pipe(
            Effect.raceFirst(Fiber.join(first).pipe(Effect.andThen(Effect.die("cleanup ended before removal cut"))))
          )
          const retained = yield* journal.read(runId)
          yield* Fiber.interrupt(first)
          return retained
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )
      const prefix = prefixThrough(
        prefixRecords,
        "RemovalBeforeResponse",
        "A cleanup mutation applied before response",
        prefixRecords.length - 1
      )
      if (prefix === undefined) return yield* Effect.die("missing cleanup mutation prefix")
      const recovered = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          const reopened = yield* journal.read(runId)
          const historyState = reduceWorkflowJournalHistory(runId, reopened)
          if (historyState._tag !== "ValidWorkflowJournalHistory")
            return yield* Effect.die("invalid reopened A mutation prefix")
          const result = yield* makeDispositionCleanupActivation(runId).pipe(
            Effect.flatMap((activation) => activation.run),
            Effect.provide(Layer.merge(journalLayer(runId, target, historyState, journal), boundaries))
          )
          return { reopened, result, records: yield* journal.read(runId) }
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )
      return { prefix: prefixRecords, ...recovered, calls: yield* Ref.get(calls) }
    })
  ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
