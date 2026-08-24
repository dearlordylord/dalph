import { Cause, Effect, Match, Schema } from "effect"
import * as SqlError from "effect/unstable/sql/SqlError"
import {
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStoreContradiction,
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan,
  WorkflowRunTargetMismatch,
  WorkflowRunTerminationEvidenceInvalid,
  type JournalStoreOperation,
  type JournalStoreError
} from "../store.js"

const sqliteResultCodeModulus = 256
const sqliteResultCode = {
  accessDenied: 3,
  busy: 5,
  capacityExhausted: 13,
  corrupt: 11,
  locked: 6,
  notADatabase: 26,
  readonly: 8,
  unauthorized: 23
} as const

export type StoreOperation = Exclude<JournalStoreOperation, "JournalStore.migrate" | "JournalStore.open">

const failureDetail = (cause: unknown): string => (Cause.isCause(cause) ? Cause.pretty(cause) : String(cause))

const sqliteCause = (failure: unknown): unknown => {
  const squashed = Cause.isCause(failure) ? Cause.squash(failure) : failure
  return SqlError.isSqlError(squashed) ? squashed.reason.cause : squashed
}

const sqlitePrimaryResultCode = (failure: unknown): number | undefined => {
  const cause = sqliteCause(failure)
  if (typeof cause !== "object" || cause === null) return undefined
  if ("errcode" in cause && typeof cause.errcode === "number") return cause.errcode % sqliteResultCodeModulus
  if ("errno" in cause && typeof cause.errno === "number") return cause.errno % sqliteResultCodeModulus
  return undefined
}

/** Classifies SQLite result codes into recovery-relevant journal failures. */
export const classifyJournalStorageFailure = (
  operation: JournalStorageUnavailable["operation"],
  failure: unknown
): JournalStoreError => {
  const fields = { detail: failureDetail(failure), operation }
  return Match.value(sqlitePrimaryResultCode(failure)).pipe(
    Match.whenOr(sqliteResultCode.busy, sqliteResultCode.locked, () => new JournalStorageLocked(fields)),
    Match.whenOr(
      sqliteResultCode.accessDenied,
      sqliteResultCode.readonly,
      sqliteResultCode.unauthorized,
      () => new JournalStorageAccessDenied(fields)
    ),
    Match.when(sqliteResultCode.capacityExhausted, () => new JournalStorageCapacityExhausted(fields)),
    Match.whenOr(sqliteResultCode.corrupt, sqliteResultCode.notADatabase, () => new JournalDataCorruption(fields)),
    Match.orElse(() => new JournalStorageUnavailable(fields))
  )
}

export function classifyJournalMethodFailure(
  operation: "JournalStore.beginRun",
  cause: unknown
): JournalStoreError | WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed
export function classifyJournalMethodFailure(
  operation: "JournalStore.append",
  cause: unknown
): JournalStoreContradiction | JournalStoreError | WorkflowRunAlreadyTerminated | JournalPartitionContradiction
export function classifyJournalMethodFailure(operation: "JournalStore.read", cause: unknown): JournalStoreError
export function classifyJournalMethodFailure(
  operation: "JournalStore.readRunForRecovery",
  cause: unknown
): JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTargetMismatch
export function classifyJournalMethodFailure(
  operation: "JournalStore.scanHot" | "JournalStore.auditAll",
  cause: unknown
): JournalStoreError | JournalPartitionContradiction
export function classifyJournalMethodFailure(
  operation: "JournalStore.terminateRun",
  cause: unknown
): JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTerminationEvidenceInvalid
export function classifyJournalMethodFailure(
  operation: "JournalStore.retireTerminalRun",
  cause: unknown
): JournalStoreError | WorkflowRunNotBegan | JournalHistoryNotTerminal | JournalPartitionContradiction
export function classifyJournalMethodFailure(operation: StoreOperation, cause: unknown) {
  return Match.value(cause).pipe(
    Match.whenOr(
      Match.instanceOf(JournalStoreContradiction),
      Match.instanceOf(WorkflowRunAlreadyBegan),
      Match.instanceOf(WorkflowRunAlreadyTerminated),
      Match.instanceOf(WorkflowRunIdentityAlreadyUsed),
      Match.instanceOf(WorkflowRunNotBegan),
      Match.instanceOf(WorkflowRunTargetMismatch),
      Match.instanceOf(WorkflowRunTerminationEvidenceInvalid),
      Match.instanceOf(JournalHistoryNotTerminal),
      Match.instanceOf(JournalPartitionContradiction),
      Match.instanceOf(JournalDataCorruption),
      Match.instanceOf(JournalHistoryCorruption),
      Match.instanceOf(JournalSchemaIncompatible),
      Match.instanceOf(JournalStorageAccessDenied),
      Match.instanceOf(JournalStorageCapacityExhausted),
      Match.instanceOf(JournalStorageLocked),
      Match.instanceOf(JournalStorageUnavailable),
      (failure) => failure
    ),
    Match.orElse((failure) => classifyJournalStorageFailure(operation, failure))
  )
}

export const decodeBoundary = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: JournalDataCorruption["operation"]
): Effect.Effect<A, JournalDataCorruption> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) => new JournalDataCorruption({ detail: String(cause), operation }))
  )
