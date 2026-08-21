import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path, Schema } from "effect"
import {
  JournalDatabaseLocator,
  InRunJournal,
  JournalRecord,
  JournalStore,
  WorkflowOccurrenceProjection,
  memoryJournalStoreLayer,
  projectWorkflowOccurrences,
  reduceWorkflowJournalHistory,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import type { RecoveryPrefixCutLabel } from "./recovery-prefix-contract.js"

/** The two physical journal-store executions required for each retained prefix. */
export type RecoveryStoreLane = "memory" | "sqlite"

export interface RecoveryPrefix {
  readonly cut: RecoveryPrefixCutLabel
  readonly endpoint: string
  readonly records: readonly [JournalRecord, ...Array<JournalRecord>]
}

export type RecoveryPrefixResume = (context: {
  readonly inRunJournal: InRunJournal["Service"]
  readonly journal: JournalStore["Service"]
}) => Effect.Effect<unknown, unknown>

export interface RecoveryStoreReplay {
  readonly decodedRecords: ReadonlyArray<JournalRecord>
  readonly historyTag: "ValidWorkflowJournalHistory" | "InvalidWorkflowJournalHistory"
  readonly projection: Schema.Schema.Type<typeof WorkflowOccurrenceProjection>
  /** Durable state reread, reduced, and projected after the optional resume. */
  readonly finalDecodedRecords?: ReadonlyArray<JournalRecord>
  readonly finalHistoryTag?: "ValidWorkflowJournalHistory" | "InvalidWorkflowJournalHistory"
  readonly finalProjection?: Schema.Schema.Type<typeof WorkflowOccurrenceProjection>
  readonly resumption?: unknown
}

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const canonical = (value: unknown): string => JSON.stringify(value)

/** Encodes decoded journal envelopes so memory and SQLite are compared at one boundary representation. */
const canonicalDecodedJournalHistory = (records: ReadonlyArray<JournalRecord>): string =>
  canonical(records.map((record) => Schema.encodeUnknownSync(JournalRecord)(record)))

/** Encodes the production semantic projection without comparing implementation-only object identity. */
const canonicalSemanticProjection = (projection: Schema.Schema.Type<typeof WorkflowOccurrenceProjection>): string =>
  canonical(Schema.encodeUnknownSync(WorkflowOccurrenceProjection)(projection))

const appendRetainedPrefix = Effect.fn("RecoveryStoreLanes.appendRetainedPrefix")(function* (
  journal: JournalStore["Service"],
  prefix: RecoveryPrefix["records"]
) {
  const first = prefix[0]
  if (first.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("recovery prefix must retain its WorkflowRunBegan record")
  }
  const runId = first.runId
  yield* journal.beginRun(runId, first.event.target, first.event.initialControlPolicy)
  for (const record of prefix.slice(1)) {
    if (record.event._tag === "WorkflowRunBegan") {
      return yield* Effect.die("recovery prefix cannot contain a second WorkflowRunBegan record")
    }
    if (record.event._tag === "WorkflowRunTerminated") {
      yield* journal.terminateRun(runId)
    } else {
      yield* journal.append(runId, record.key, record.event)
    }
  }
})

const inspectJournal = Effect.fn("RecoveryStoreLanes.inspectJournal")(function* (
  prefix: RecoveryPrefix["records"],
  journal: JournalStore["Service"],
  resume?: RecoveryPrefixResume
) {
  yield* appendRetainedPrefix(journal, prefix)
  const replay = yield* inspectExisting(prefix, journal)
  if (resume === undefined) {
    return {
      ...replay,
      finalDecodedRecords: replay.decodedRecords,
      finalHistoryTag: replay.historyTag,
      finalProjection: replay.projection
    }
  }
  const inRunJournal = InRunJournal.of({ append: journal.append, read: journal.read })
  const resumption = yield* resume({ inRunJournal, journal })
  const final = yield* inspectExisting(prefix, journal)
  return {
    ...replay,
    finalDecodedRecords: final.decodedRecords,
    finalHistoryTag: final.historyTag,
    finalProjection: final.projection,
    resumption
  }
})

const inspectExisting = Effect.fn("RecoveryStoreLanes.inspectExisting")(function* (
  prefix: RecoveryPrefix["records"],
  journal: JournalStore["Service"]
) {
  const runId = prefix[0].runId
  const decodedRecords = yield* journal.read(runId)
  const history = reduceWorkflowJournalHistory(runId, decodedRecords)
  const projection = yield* projectWorkflowOccurrences(decodedRecords)
  return { decodedRecords, historyTag: history._tag, projection }
})

const inspectExistingWithResume = Effect.fn("RecoveryStoreLanes.inspectExistingWithResume")(function* (
  prefix: RecoveryPrefix["records"],
  journal: JournalStore["Service"],
  resume?: RecoveryPrefixResume
) {
  const replay = yield* inspectExisting(prefix, journal)
  if (resume === undefined) {
    return {
      ...replay,
      finalDecodedRecords: replay.decodedRecords,
      finalHistoryTag: replay.historyTag,
      finalProjection: replay.projection
    }
  }
  const inRunJournal = InRunJournal.of({ append: journal.append, read: journal.read })
  const resumption = yield* resume({ inRunJournal, journal })
  const final = yield* inspectExisting(prefix, journal)
  return {
    ...replay,
    finalDecodedRecords: final.decodedRecords,
    finalHistoryTag: final.historyTag,
    finalProjection: final.projection,
    resumption
  }
})

const replayMemory = Effect.fn("RecoveryStoreLanes.replayMemory")(function* (
  prefix: RecoveryPrefix["records"],
  resume?: RecoveryPrefixResume
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      return yield* inspectJournal(prefix, journal, resume)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
})

const replaySqlite = Effect.fn("RecoveryStoreLanes.replaySqlite")(function* (
  prefix: RecoveryPrefix["records"],
  resume?: RecoveryPrefixResume
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-recovery-prefix-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))

      yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* inspectJournal(prefix, journal)
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          return yield* inspectExistingWithResume(prefix, journal, resume)
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )
    }).pipe(Effect.provide(nodePathAndFileSystemLayer))
  )
})

/** Replays one retained prefix through exactly one fresh physical store lane. */
export const replayRecoveryPrefix = (
  prefix: RecoveryPrefix,
  lane: RecoveryStoreLane,
  resume?: RecoveryPrefixResume
): Effect.Effect<RecoveryStoreReplay, unknown> =>
  (lane === "memory" ? replayMemory : replaySqlite)(prefix.records, resume)

/** Returns a lane-qualified diagnostic when decoded history or semantic projection diverges. */
export const recoveryPrefixMismatch = (
  cut: RecoveryPrefixCutLabel,
  lane: RecoveryStoreLane,
  expected: RecoveryStoreReplay,
  actual: RecoveryStoreReplay
): string | undefined => {
  if (expected.historyTag !== actual.historyTag) {
    return `recovery prefix ${cut} / ${lane}: decoded history validity differs`
  }
  if (
    canonicalDecodedJournalHistory(expected.decodedRecords) !== canonicalDecodedJournalHistory(actual.decodedRecords)
  ) {
    return `recovery prefix ${cut} / ${lane}: canonical decoded history differs`
  }
  if (canonicalSemanticProjection(expected.projection) !== canonicalSemanticProjection(actual.projection)) {
    return `recovery prefix ${cut} / ${lane}: production semantic projection differs`
  }
  if (
    expected.finalHistoryTag !== undefined ||
    expected.finalDecodedRecords !== undefined ||
    expected.finalProjection !== undefined
  ) {
    if (expected.finalHistoryTag === undefined || actual.finalHistoryTag === undefined) {
      return `recovery prefix ${cut} / ${lane}: resumed history validity is missing`
    }
    if (expected.finalHistoryTag !== actual.finalHistoryTag) {
      return `recovery prefix ${cut} / ${lane}: resumed history validity differs`
    }
    if (expected.finalDecodedRecords !== undefined) {
      if (
        actual.finalDecodedRecords === undefined ||
        canonicalDecodedJournalHistory(expected.finalDecodedRecords) !==
          canonicalDecodedJournalHistory(actual.finalDecodedRecords)
      ) {
        return `recovery prefix ${cut} / ${lane}: resumed decoded history differs`
      }
    }
    if (expected.finalProjection !== undefined) {
      if (
        actual.finalProjection === undefined ||
        canonicalSemanticProjection(expected.finalProjection) !== canonicalSemanticProjection(actual.finalProjection)
      ) {
        return `recovery prefix ${cut} / ${lane}: resumed production semantic projection differs`
      }
    }
  }
  return undefined
}

/** Computes the expected decoded history and production projection once per source prefix. */
export const expectedRecoveryPrefix = Effect.fn("RecoveryStoreLanes.expectedRecoveryPrefix")(function* (
  prefix: RecoveryPrefix
) {
  const runId = prefix.records[0].runId
  const history = reduceWorkflowJournalHistory(runId, prefix.records)
  const projection = yield* projectWorkflowOccurrences(prefix.records)
  return { decodedRecords: prefix.records, historyTag: history._tag, projection }
})

/** Builds one prefix record from an endpoint in a production-produced chronology. */
export const prefixThrough = (
  records: ReadonlyArray<JournalRecord>,
  cut: RecoveryPrefixCutLabel,
  endpoint: string,
  position: number
): RecoveryPrefix | undefined => {
  const retained = records.slice(0, position + 1)
  const first = retained[0]
  return first === undefined ? undefined : { cut, endpoint, records: [first, ...retained.slice(1)] }
}
