/* eslint-disable import/no-nodejs-modules -- the lease adapter owns the native descriptor lock. */
/* eslint-disable max-lines -- The private snapshot and crash-recoverable lease share one durable authority. */
import type { FileHandle } from "node:fs/promises"
import nodeFs, { type Stats } from "node:fs"
import { createHash } from "node:crypto"
import {
  AttemptId,
  EvidenceReference,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  samePlannedTaskAttempt,
  WorktreeLocator,
  evidenceReferenceEquals
} from "@dalph/contracts"
import { Config, Context, Effect, Layer, Option, Path, Ref, Result, Schema, Semaphore, type Crypto } from "effect"
import {
  CodexAttemptStoreNative,
  nodeCodexAttemptStoreNativeLayer,
  nodeCodexAttemptStoreNativeService,
  type CodexAttemptStoreNativeService
} from "./codex-attempt-store-native.js"

/** The opaque identity returned by one persisted Codex app-server thread. */
export const CodexThreadId = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadId"))
export type CodexThreadId = typeof CodexThreadId.Type

/** A private marker that binds one Integrator thread allocation to its recorded request. */
export const CodexThreadOwnershipToken = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadOwnershipToken"))
export type CodexThreadOwnershipToken = typeof CodexThreadOwnershipToken.Type

/** The opaque identity returned by one Codex turn. */
export const CodexTurnId = Schema.NonEmptyString.pipe(Schema.brand("CodexTurnId"))
export type CodexTurnId = typeof CodexTurnId.Type

/** A fresh private token Dalph puts in one turn's user input to identify that owned turn after restart. */
export const CodexOwnedTurnToken = Schema.NonEmptyString.pipe(Schema.brand("CodexOwnedTurnToken"))
export type CodexOwnedTurnToken = typeof CodexOwnedTurnToken.Type

/** Stable operator request identity for replacing one purged provider work unit. */
export const CodexReplacementRequestId = Schema.NonEmptyString.pipe(Schema.brand("CodexReplacementRequestId"))
export type CodexReplacementRequestId = typeof CodexReplacementRequestId.Type

/** SHA-256 content identity of the complete decoded replacement request. */
export const CodexReplacementRequestDigest = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value) ? undefined : "replacement request digest must be SHA-256 hex"
  )
).pipe(Schema.brand("CodexReplacementRequestDigest"))
export type CodexReplacementRequestDigest = typeof CodexReplacementRequestDigest.Type

const hexadecimalRadix = 16
const hexadecimalByteLength = 2

/** Computes the stable request content identity from a canonical request encoding. */
export const codexReplacementRequestDigestFromCanonical = (crypto: Crypto.Crypto, canonical: string) =>
  crypto
    .digest("SHA-256", new TextEncoder().encode(canonical))
    .pipe(
      Effect.map((digest) =>
        CodexReplacementRequestDigest.make(
          [...digest].map((byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteLength, "0")).join("")
        )
      )
    )

/** Fresh private operation identity allocated once replacement intent becomes durable. */
export const CodexReplacementOperationId = Schema.NonEmptyString.pipe(Schema.brand("CodexReplacementOperationId"))
export type CodexReplacementOperationId = typeof CodexReplacementOperationId.Type

/** Identifies one launch incarnation of the application-owned app-server child. */
export const CodexServerIncarnation = Schema.NonEmptyString.pipe(Schema.brand("CodexServerIncarnation"))
export type CodexServerIncarnation = typeof CodexServerIncarnation.Type

/** Exact process-start identity persisted with a crash-recoverable server lease. */
export const CodexProcessIdentity = Schema.NonEmptyString.pipe(Schema.brand("CodexProcessIdentity"))
export type CodexProcessIdentity = typeof CodexProcessIdentity.Type

/** Fresh lease incarnation distinguishing one owner acquisition from its predecessors. */
export const CodexServerLeaseIncarnation = Schema.NonEmptyString.pipe(Schema.brand("CodexServerLeaseIncarnation"))
export type CodexServerLeaseIncarnation = typeof CodexServerLeaseIncarnation.Type

/** A sealed private terminal result; the generic executor deliberately has no Completed state here. */
export const CodexSealedTerminal = Schema.TaggedUnion({
  Accepted: { commit: GitCommitSha, evidenceManifest: EvidenceReference },
  Failed: {}
})
export type CodexSealedTerminal = typeof CodexSealedTerminal.Type

/** Evidence that a readable retained thread omitted a turn previously observed by Dalph. */
export const CodexPurgedWorkUnitEvidence = Schema.Struct({
  predecessorToken: CodexOwnedTurnToken,
  predecessorTurnId: CodexTurnId,
  threadId: CodexThreadId,
  worktree: WorktreeLocator
})
export type CodexPurgedWorkUnitEvidence = typeof CodexPurgedWorkUnitEvidence.Type

/** Append-only private facts for one purged predecessor and its replacement operation. */
export const CodexReplacementHistoryEntry = Schema.TaggedUnion({
  Purged: { evidence: CodexPurgedWorkUnitEvidence },
  IntentRecorded: {
    operationId: CodexReplacementOperationId,
    requestDigest: CodexReplacementRequestDigest,
    requestId: CodexReplacementRequestId
  },
  TurnIntentRecorded: { operationId: CodexReplacementOperationId, replacementToken: CodexOwnedTurnToken },
  TurnBoundaryCrossingBegan: { operationId: CodexReplacementOperationId, replacementToken: CodexOwnedTurnToken },
  TurnObserved: {
    operationId: CodexReplacementOperationId,
    replacementToken: CodexOwnedTurnToken,
    replacementTurnId: CodexTurnId
  },
  Sealed: {
    operationId: CodexReplacementOperationId,
    replacementToken: CodexOwnedTurnToken,
    replacementTurnId: CodexTurnId
  }
})
export type CodexReplacementHistoryEntry = typeof CodexReplacementHistoryEntry.Type

const replacementIntentIndex = 1
const replacementTurnIntentIndex = 2
const replacementTurnBoundaryIndex = 3
const replacementTurnObservedIndex = 4
const replacementSealedIndex = 5
const replacementMinimumHistoryLength = replacementTurnIntentIndex
const replacementMaximumHistoryLength = replacementSealedIndex + 1
const lastElementOffset = -1

const replacementHistoryTagFailure = (history: ReadonlyArray<CodexReplacementHistoryEntry>): string | undefined => {
  const expected: ReadonlyArray<CodexReplacementHistoryEntry["_tag"]> = [
    "Purged",
    "IntentRecorded",
    "TurnIntentRecorded",
    "TurnBoundaryCrossingBegan",
    "TurnObserved",
    "Sealed"
  ]
  for (const [index, entry] of history.entries()) {
    if (entry._tag !== expected[index]) return `replacement history has an invalid phase at ${index}`
  }
  return undefined
}

const replacementHistoryShapeFailure = (history: ReadonlyArray<CodexReplacementHistoryEntry>): string | undefined => {
  const first = history[0]
  /* v8 ignore next -- @preserve The ledger-level purge filter and NonEmptyArray schema reject this before history validation. */
  if (first === undefined || first._tag !== "Purged") return "replacement history must begin with purge evidence"
  /* v8 ignore next -- @preserve The ledger-level intent filter rejects a missing second entry before history validation. */
  if (history.length < replacementMinimumHistoryLength)
    /* v8 ignore next -- @preserve Covered by the preceding schema-ordering guard. */
    return "replacement ledger must retain operator intent with purge evidence"
  if (history.length > replacementMaximumHistoryLength)
    return "replacement history contains more than one replacement operation"
  return replacementHistoryTagFailure(history)
}

const replacementPhaseTagMismatch = (
  entry: CodexReplacementHistoryEntry | undefined,
  expected: CodexReplacementHistoryEntry["_tag"]
): boolean => entry !== undefined && entry._tag !== expected

const replacementHistoryPhaseFailure = (
  turnIntent: CodexReplacementHistoryEntry | undefined,
  turnCalled: CodexReplacementHistoryEntry | undefined,
  observed: CodexReplacementHistoryEntry | undefined,
  sealed: CodexReplacementHistoryEntry | undefined
): string | undefined => {
  /* v8 ignore next -- @preserve The earlier exact tag-sequence validation rejects every phase-position mismatch. */
  if (replacementPhaseTagMismatch(turnIntent, "TurnIntentRecorded")) return "replacement turn intent is malformed"
  /* v8 ignore next -- @preserve The earlier exact tag-sequence validation rejects every phase-position mismatch. */
  if (replacementPhaseTagMismatch(turnCalled, "TurnBoundaryCrossingBegan")) return "replacement turn call is malformed"
  /* v8 ignore next -- @preserve The earlier exact tag-sequence validation rejects every phase-position mismatch. */
  if (replacementPhaseTagMismatch(observed, "TurnObserved")) return "replacement observation is malformed"
  /* v8 ignore next -- @preserve The earlier exact tag-sequence validation rejects every phase-position mismatch. */
  if (replacementPhaseTagMismatch(sealed, "Sealed")) return "replacement seal is malformed"
  return undefined
}

const replacementHistoryOperationFailure = (
  history: ReadonlyArray<CodexReplacementHistoryEntry>,
  operationId: CodexReplacementOperationId
): string | undefined => {
  for (const entry of history.slice(replacementTurnIntentIndex)) {
    if (entry._tag !== "Purged" && entry.operationId !== operationId) {
      return "replacement history phases must retain one operation identity"
    }
  }
  return undefined
}

const replacementHistoryTokenFailure = (
  turnIntent: CodexReplacementHistoryEntry | undefined,
  turnCalled: CodexReplacementHistoryEntry | undefined,
  observed: CodexReplacementHistoryEntry | undefined,
  sealed: CodexReplacementHistoryEntry | undefined
): string | undefined => {
  if (turnIntent === undefined || turnIntent._tag !== "TurnIntentRecorded") return undefined
  if (replacementCallTokenMismatch(turnCalled, turnIntent.replacementToken)) {
    return "replacement call must retain its turn token"
  }
  if (replacementObservedTokenMismatch(observed, turnIntent.replacementToken)) {
    return "replacement observation must retain its turn token"
  }
  if (replacementSealTokenMismatch(sealed, turnIntent.replacementToken)) {
    return "replacement seal must retain its turn token"
  }
  return undefined
}

const replacementCallTokenMismatch = (
  entry: CodexReplacementHistoryEntry | undefined,
  expected: CodexOwnedTurnToken
): boolean => entry !== undefined && entry._tag === "TurnBoundaryCrossingBegan" && entry.replacementToken !== expected

const replacementObservedTokenMismatch = (
  entry: CodexReplacementHistoryEntry | undefined,
  expected: CodexOwnedTurnToken
): boolean => entry !== undefined && entry._tag === "TurnObserved" && entry.replacementToken !== expected

const replacementSealTokenMismatch = (
  entry: CodexReplacementHistoryEntry | undefined,
  expected: CodexOwnedTurnToken
): boolean => entry !== undefined && entry._tag === "Sealed" && entry.replacementToken !== expected

const replacementHistorySealFailure = (
  predecessorTurnId: CodexTurnId,
  observed: CodexReplacementHistoryEntry | undefined,
  sealed: CodexReplacementHistoryEntry | undefined
): string | undefined => {
  if (observed === undefined || observed._tag !== "TurnObserved") return undefined
  if (sealed === undefined || sealed._tag !== "Sealed") return undefined
  if (observed.replacementTurnId !== sealed.replacementTurnId) return "replacement seal must retain its turn id"
  if (observed.replacementTurnId === predecessorTurnId) {
    return "replacement turn must be distinct from its purged predecessor"
  }
  return undefined
}

const replacementHistoryFailure = (history: ReadonlyArray<CodexReplacementHistoryEntry>): string | undefined => {
  const shapeFailure = replacementHistoryShapeFailure(history)
  if (shapeFailure !== undefined) return shapeFailure
  const first = history[0]
  const intent = history[replacementIntentIndex]
  /* v8 ignore next -- @preserve Successful shape validation proves the first entry is Purged. */
  if (first === undefined || first._tag !== "Purged") return "replacement history must begin with purge evidence"
  /* v8 ignore next -- @preserve Successful shape validation proves the second entry is IntentRecorded. */
  if (intent === undefined || intent._tag !== "IntentRecorded") return "replacement intent phase is malformed"
  const turnIntent = history[replacementTurnIntentIndex]
  const turnCalled = history[replacementTurnBoundaryIndex]
  const observed = history[replacementTurnObservedIndex]
  const sealed = history[replacementSealedIndex]
  const failures = [
    replacementHistoryPhaseFailure(turnIntent, turnCalled, observed, sealed),
    replacementHistoryOperationFailure(history, intent.operationId),
    replacementHistoryTokenFailure(turnIntent, turnCalled, observed, sealed),
    replacementHistorySealFailure(first.evidence.predecessorTurnId, observed, sealed)
  ]
  return failures.find((failure): failure is string => failure !== undefined)
}

type CodexPurgedWorkUnitReplacementLedgerShape = {
  readonly history: ReadonlyArray<CodexReplacementHistoryEntry>
  readonly operationId: CodexReplacementOperationId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly requestId: CodexReplacementRequestId
}

const replacementLedgerPurgeEvidenceFailure = (
  ledger: CodexPurgedWorkUnitReplacementLedgerShape
): string | undefined => {
  const first = ledger.history[0]
  if (first === undefined || first._tag !== "Purged") {
    return "replacement ledger must retain exact predecessor purge evidence"
  }
  return first.evidence.worktree !== ledger.plannedAttempt.worktree
    ? "replacement purge evidence must retain the planned attempt worktree"
    : undefined
}

const replacementLedgerIntentFailure = (ledger: CodexPurgedWorkUnitReplacementLedgerShape): string | undefined => {
  const intent = ledger.history[replacementIntentIndex]
  if (intent === undefined || intent._tag !== "IntentRecorded") {
    return "replacement intent must retain exact request and operation identities"
  }
  return intent.operationId !== ledger.operationId || intent.requestId !== ledger.requestId
    ? "replacement intent must retain exact request and operation identities"
    : undefined
}

const replacementLedgerFailure = (ledger: CodexPurgedWorkUnitReplacementLedgerShape): string | undefined =>
  replacementLedgerPurgeEvidenceFailure(ledger) ??
  replacementLedgerIntentFailure(ledger) ??
  replacementHistoryFailure(ledger.history)

/** Immutable ledger retaining the exact planned attempt and U1 purge evidence. */
export const CodexPurgedWorkUnitReplacementLedger = Schema.Struct({
  history: Schema.NonEmptyArray(CodexReplacementHistoryEntry),
  operationId: CodexReplacementOperationId,
  plannedAttempt: PlannedTaskAttempt,
  requestId: CodexReplacementRequestId
}).check(Schema.makeFilter(replacementLedgerFailure))
export type CodexPurgedWorkUnitReplacementLedger = typeof CodexPurgedWorkUnitReplacementLedger.Type

/** Explicit representation of one append-only ledger write outcome. */
type CodexReplacementLedgerMerge =
  | { readonly _tag: "Inserted"; readonly ledger: CodexPurgedWorkUnitReplacementLedger }
  | { readonly _tag: "Appended"; readonly ledger: CodexPurgedWorkUnitReplacementLedger }
  | { readonly _tag: "Idempotent"; readonly ledger: CodexPurgedWorkUnitReplacementLedger }
  | { readonly _tag: "Contradiction"; readonly detail: string }

const sameReplacementIntent = (
  left: CodexPurgedWorkUnitReplacementLedger,
  right: CodexPurgedWorkUnitReplacementLedger
): boolean => {
  const leftIntent = left.history[1]
  const rightIntent = right.history[1]
  /* v8 ignore next -- @preserve Both operands have already decoded as ledgers whose second entry is IntentRecorded. */
  if (
    leftIntent === undefined ||
    rightIntent === undefined ||
    leftIntent._tag !== "IntentRecorded" ||
    rightIntent._tag !== "IntentRecorded"
  ) {
    return false
  }
  return (
    left.requestId === right.requestId &&
    left.operationId === right.operationId &&
    leftIntent.requestDigest === rightIntent.requestDigest
  )
}

const sameReplacementPlannedSubject = (
  left: CodexPurgedWorkUnitReplacementLedger,
  right: CodexPurgedWorkUnitReplacementLedger
): boolean => samePlannedTaskAttempt(left.plannedAttempt, right.plannedAttempt)

const sameReplacementPurgeSubject = (
  left: CodexPurgedWorkUnitReplacementLedger,
  right: CodexPurgedWorkUnitReplacementLedger
): boolean => {
  const leftPurge = left.history[0]
  const rightPurge = right.history[0]
  /* v8 ignore next -- @preserve Both operands have already decoded as ledgers whose first entry is Purged. */
  if (leftPurge._tag !== "Purged" || rightPurge._tag !== "Purged") return false
  return (
    leftPurge.evidence.threadId === rightPurge.evidence.threadId &&
    leftPurge.evidence.worktree === rightPurge.evidence.worktree &&
    leftPurge.evidence.predecessorTurnId === rightPurge.evidence.predecessorTurnId &&
    leftPurge.evidence.predecessorToken === rightPurge.evidence.predecessorToken
  )
}

const sameReplacementLedgerSubject = (
  left: CodexPurgedWorkUnitReplacementLedger,
  right: CodexPurgedWorkUnitReplacementLedger
): boolean =>
  sameReplacementIntent(left, right) &&
  sameReplacementPlannedSubject(left, right) &&
  sameReplacementPurgeSubject(left, right)

const replacementHistoryEquivalence = Schema.toEquivalence(CodexReplacementHistoryEntry)
const replacementLedgerEquivalence = Schema.toEquivalence(CodexPurgedWorkUnitReplacementLedger)
const isHistoryPrefix = (
  prefix: ReadonlyArray<CodexReplacementHistoryEntry>,
  value: ReadonlyArray<CodexReplacementHistoryEntry>
): boolean =>
  prefix.every((entry, index) => value[index] !== undefined && replacementHistoryEquivalence(entry, value[index]))

/** Merges one candidate ledger without permitting request-subject or history mutation. */
export const mergeCodexReplacementLedger = (
  current: CodexPurgedWorkUnitReplacementLedger | undefined,
  next: CodexPurgedWorkUnitReplacementLedger
): CodexReplacementLedgerMerge => {
  if (current === undefined) return { _tag: "Inserted", ledger: next }
  if (!sameReplacementLedgerSubject(current, next)) {
    return { _tag: "Contradiction", detail: "replacement request identity was reused for another subject" }
  }
  if (replacementLedgerEquivalence(current, next)) return { _tag: "Idempotent", ledger: current }
  if (next.history.length === current.history.length + 1 && isHistoryPrefix(current.history, next.history)) {
    return { _tag: "Appended", ledger: next }
  }
  return { _tag: "Contradiction", detail: "replacement history is not one append-only successor" }
}

/** Appends one private replacement phase, retaining every predecessor entry. */
export const appendCodexReplacementHistory = (
  ledger: CodexPurgedWorkUnitReplacementLedger,
  entry: CodexReplacementHistoryEntry
): CodexReplacementLedgerMerge => {
  const last = ledger.history.at(lastElementOffset)
  if (last !== undefined && replacementHistoryEquivalence(last, entry)) return { _tag: "Idempotent", ledger }
  const candidate = Schema.decodeUnknownResult(CodexPurgedWorkUnitReplacementLedger)({
    ...ledger,
    history: [...ledger.history, entry]
  })
  if (candidate._tag === "Failure") {
    return { _tag: "Contradiction", detail: String(candidate.failure) }
  }
  return mergeCodexReplacementLedger(ledger, candidate.success)
}

export const encodeCodexPurgedWorkUnitReplacementLedger = (ledger: CodexPurgedWorkUnitReplacementLedger): string =>
  JSON.stringify(Schema.encodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)(ledger))

export const decodeCodexPurgedWorkUnitReplacementLedger = (encoded: string): CodexPurgedWorkUnitReplacementLedger =>
  Schema.decodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)(JSON.parse(encoded))

const invalidCodexAttemptCorrelation = (attemptId: AttemptId, correlationAttemptId: AttemptId): string | undefined =>
  attemptId !== correlationAttemptId
    ? "private association attempt and correlation attempt must be identical"
    : undefined

const invalidCodexTerminalEvidence = (
  terminal: CodexSealedTerminal,
  evidenceManifest: EvidenceReference | null
): string | undefined => {
  if (terminal._tag === "Accepted" && evidenceManifest === null) {
    return "an accepted terminal attempt must retain its evidence reference"
  }
  if (terminal._tag === "Failed" && evidenceManifest !== null) {
    return "a failed terminal attempt cannot retain accepted evidence"
  }
  if (
    terminal._tag === "Accepted" &&
    evidenceManifest !== null &&
    !evidenceReferenceEquals(terminal.evidenceManifest, evidenceManifest)
  ) {
    return "the sealed and top-level evidence references must agree"
  }
  return undefined
}

/**
 * Exact durable attempt/thread state. Each tag carries only the fields that
 * are valid at that boundary, so an unresolved turn always retains its fresh
 * token and its previous owned turn separately from a newly observed id.
 */
export const CodexAttemptRecord = Schema.TaggedUnion({
  /** The thread allocation intent before Codex returns a thread id. */
  EmptyPreTurn: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    worktree: WorktreeLocator
  },
  /** A returned idle thread is durably associated before any turn is sent. */
  AssociatedPreTurn: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** A fresh token authorizes one first or continuation turn crossing. */
  TurnIntentRecorded: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The app-server returned or later exposed this exact token-to-turn pair. */
  TurnObserved: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The exact owned turn remains active and retains its previous owned id. */
  Running: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The exact owned turn and every owned activity are quiescent. */
  SafelySuspended: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The exact owned turn has one sealed terminal result and correlation. */
  Terminal: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    evidenceManifest: Schema.NullOr(EvidenceReference),
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    terminal: CodexSealedTerminal,
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  }
}).check(
  Schema.makeFilter((record) => {
    const correlationFailure = invalidCodexAttemptCorrelation(record.attemptId, record.correlationAttemptId)
    if (correlationFailure !== undefined) return correlationFailure
    return record._tag === "Terminal"
      ? invalidCodexTerminalEvidence(record.terminal, record.evidenceManifest)
      : undefined
  })
)
export type CodexAttemptRecord = typeof CodexAttemptRecord.Type

const keyOf = (runId: RunId, attemptId: AttemptId): string => `${runId}\u0000${attemptId}`

/** Durable ownership intent and observation for one application-scoped app-server child. */
export const CodexServerLaunchRecord = Schema.Struct({
  command: Schema.Array(Schema.NonEmptyString),
  incarnation: CodexServerIncarnation,
  phase: Schema.Literals(["Launching", "Spawned", "Live"]),
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
}).check(
  Schema.makeFilter((record) =>
    record.phase === "Launching" && record.pid !== null
      ? "a launching server cannot claim a process identity"
      : (record.phase === "Spawned" || record.phase === "Live") && record.pid === null
        ? "a live server must claim a process identity"
        : undefined
  )
)
export type CodexServerLaunchRecord = typeof CodexServerLaunchRecord.Type

/** Durable identity of the process holding the app-server admission lease. */
export const CodexServerLeaseRecord = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  processIdentity: CodexProcessIdentity,
  incarnation: CodexServerLeaseIncarnation
})
export type CodexServerLeaseRecord = typeof CodexServerLeaseRecord.Type

/** Execution-substrate result used while deciding whether a prior lease is stale. */
export type CodexServerLeaseOwnerProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive" }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** One private store snapshot. It is intentionally separate from the workflow Journal. */
const CodexAttemptStoreSnapshot = Schema.Struct({
  attempts: Schema.Array(CodexAttemptRecord),
  serverLaunch: Schema.NullOr(CodexServerLaunchRecord),
  replacements: Schema.Array(CodexPurgedWorkUnitReplacementLedger)
}).check(
  Schema.makeFilter((snapshot) => {
    const keys = new Set(snapshot.attempts.map((record) => keyOf(record.correlationRunId, record.correlationAttemptId)))
    if (keys.size !== snapshot.attempts.length) return "private attempt snapshot contains duplicate correlations"
    const associatedAttempts = snapshot.attempts.filter(
      (record): record is Exclude<CodexAttemptRecord, { readonly _tag: "EmptyPreTurn" }> =>
        record._tag !== "EmptyPreTurn"
    )
    const threadIds = new Set(associatedAttempts.map((record) => record.threadId))
    if (threadIds.size !== associatedAttempts.length)
      return "private attempt snapshot aliases one Codex thread to multiple attempts"
    const replacements = snapshot.replacements
    const requestIds = new Set(replacements.map((replacement) => replacement.requestId))
    return requestIds.size === replacements.length
      ? undefined
      : "private replacement snapshot contains duplicate requests"
  })
)
type CodexAttemptStoreSnapshot = typeof CodexAttemptStoreSnapshot.Type

/** A private store operation could not prove its exact previous or next value. */
const CodexAttemptStoreOperation = Schema.Literals([
  "configure",
  "readAttempt",
  "writeAttempt",
  "readServerLaunch",
  "writeServerLaunch",
  "clearServerLaunch",
  "readReplacementLedger",
  "appendReplacementLedger",
  "acquireServerLease",
  "releaseServerLease"
])
type CodexAttemptStoreOperation = typeof CodexAttemptStoreOperation.Type

export class CodexAttemptStoreFailure extends Schema.TaggedError<CodexAttemptStoreFailure>()(
  "CodexAttemptStoreFailure",
  { detail: Schema.String, operation: CodexAttemptStoreOperation }
) {}

/** Captures a native filesystem failure before the private-store adapter classifies it. */
export class CodexAttemptStoreNativeFailure extends Schema.TaggedError<CodexAttemptStoreNativeFailure>()(
  "CodexAttemptStoreNativeFailure",
  { cause: Schema.Defect() }
) {}

const nativeFailure = (cause: unknown): CodexAttemptStoreNativeFailure => new CodexAttemptStoreNativeFailure({ cause })

/** Retains the detail text previously produced by wrapping native failures in Error. */
export const nativeFailureDetail = (failure: CodexAttemptStoreNativeFailure): string =>
  `Error: ${String(failure.cause)}`

/** Private durable state authority for Codex associations and app-server ownership. */
export interface CodexAttemptStoreService {
  readonly readAttempt: (
    runId: RunId,
    attemptId: AttemptId
  ) => Effect.Effect<Option.Option<CodexAttemptRecord>, CodexAttemptStoreFailure>
  readonly writeAttempt: (record: CodexAttemptRecord) => Effect.Effect<void, CodexAttemptStoreFailure>
  readonly readServerLaunch: () => Effect.Effect<Option.Option<CodexServerLaunchRecord>, CodexAttemptStoreFailure>
  readonly writeServerLaunch: (record: CodexServerLaunchRecord) => Effect.Effect<void, CodexAttemptStoreFailure>
  readonly clearServerLaunch: (incarnation: CodexServerIncarnation) => Effect.Effect<void, CodexAttemptStoreFailure>
  /** Reads one private replacement operation by its stable operator request identity. */
  readonly readReplacementLedger: (
    requestId: CodexReplacementRequestId
  ) => Effect.Effect<Option.Option<CodexPurgedWorkUnitReplacementLedger>, CodexAttemptStoreFailure>
  /** Appends exactly one replacement phase or accepts an exact idempotent redelivery. */
  readonly appendReplacementLedger: (
    ledger: CodexPurgedWorkUnitReplacementLedger
  ) => Effect.Effect<void, CodexAttemptStoreFailure>
  /** Cross-process exclusive admission lease for the application child. */
  readonly acquireServerLease: (
    owner: CodexServerLeaseRecord,
    observe: (owner: CodexServerLeaseRecord) => Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure>
  ) => Effect.Effect<void, CodexAttemptStoreFailure>
  readonly releaseServerLease: (owner: CodexServerLeaseRecord) => Effect.Effect<void, CodexAttemptStoreFailure>
}

export class CodexAttemptStore extends Context.Service<CodexAttemptStore, CodexAttemptStoreService>()(
  "@dalph/CodexAttemptStore"
) {}

const emptySnapshot: CodexAttemptStoreSnapshot = { attempts: [], serverLaunch: null, replacements: [] }

export const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

const memoryStore = (initial: CodexAttemptStoreSnapshot = emptySnapshot) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const attempts = yield* Ref.make<ReadonlyMap<string, CodexAttemptRecord>>(
        new Map(initial.attempts.map((record) => [keyOf(record.correlationRunId, record.correlationAttemptId), record]))
      )
      const launch = yield* Ref.make<Option.Option<CodexServerLaunchRecord>>(
        initial.serverLaunch === null ? Option.none() : Option.some(initial.serverLaunch)
      )
      const replacements = yield* Ref.make<ReadonlyMap<string, CodexPurgedWorkUnitReplacementLedger>>(
        new Map(initial.replacements.map((ledger) => [ledger.requestId, ledger]))
      )
      const snapshotGate = yield* Semaphore.make(1)
      const readAttempt = Effect.fn("CodexAttemptStore.Memory.readAttempt")(function* (
        runId: RunId,
        attemptId: AttemptId
      ) {
        const value = (yield* Ref.get(attempts)).get(keyOf(runId, attemptId))
        return value === undefined ? Option.none() : Option.some(value)
      })
      const writeAttempt = Effect.fn("CodexAttemptStore.Memory.writeAttempt")(function* (record: CodexAttemptRecord) {
        yield* snapshotGate.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(attempts)
            const next = new Map([
              ...current,
              [keyOf(record.correlationRunId, record.correlationAttemptId), record] as const
            ])
            yield* validateSnapshot(next, yield* Ref.get(launch), yield* Ref.get(replacements), "writeAttempt")
            yield* Ref.set(attempts, next)
          })
        )
      })
      const readServerLaunch = () => Ref.get(launch)
      const writeServerLaunch = Effect.fn("CodexAttemptStore.Memory.writeServerLaunch")(function* (
        record: CodexServerLaunchRecord
      ) {
        yield* snapshotGate.withPermit(
          Effect.gen(function* () {
            const next = Option.some(record)
            yield* validateSnapshot(yield* Ref.get(attempts), next, yield* Ref.get(replacements), "writeServerLaunch")
            yield* Ref.set(launch, next)
          })
        )
      })
      const clearServerLaunch = Effect.fn("CodexAttemptStore.Memory.clearServerLaunch")(function* (
        incarnation: CodexServerIncarnation
      ) {
        yield* Ref.update(launch, (current) =>
          Option.isSome(current) && current.value.incarnation === incarnation ? Option.none() : current
        )
      })
      const readReplacementLedger: NonNullable<CodexAttemptStoreService["readReplacementLedger"]> = (requestId) =>
        Ref.get(replacements).pipe(
          Effect.map((current) => {
            const value = current.get(requestId)
            return value === undefined ? Option.none() : Option.some(value)
          })
        )
      const appendReplacementLedger: NonNullable<CodexAttemptStoreService["appendReplacementLedger"]> = (ledger) =>
        snapshotGate.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(replacements)
            const merged = mergeCodexReplacementLedger(current.get(ledger.requestId), ledger)
            if (merged._tag === "Contradiction") {
              return yield* new CodexAttemptStoreFailure({
                detail: merged.detail,
                operation: "appendReplacementLedger"
              })
            }
            if (merged._tag === "Idempotent") return
            const next = new Map([...current, [ledger.requestId, merged.ledger] as const])
            yield* validateSnapshot(yield* Ref.get(attempts), yield* Ref.get(launch), next, "appendReplacementLedger")
            yield* Ref.set(replacements, next)
          })
        )
      const lease = yield* Ref.make<Option.Option<CodexServerLeaseRecord>>(Option.none())
      const leaseGate = yield* Semaphore.make(1)
      const sameLeaseOwner = (left: CodexServerLeaseRecord, right: CodexServerLeaseRecord) =>
        left.pid === right.pid &&
        left.processIdentity === right.processIdentity &&
        left.incarnation === right.incarnation
      const acquireServerLease = Effect.fn("CodexAttemptStore.Memory.acquireServerLease")(function* (
        owner: CodexServerLeaseRecord,
        observe: (
          owner: CodexServerLeaseRecord
        ) => Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure>
      ) {
        yield* leaseGate.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(lease)
            if (Option.isNone(current)) {
              yield* Ref.set(lease, Option.some(owner))
              return
            }
            if (sameLeaseOwner(current.value, owner)) return
            const projection = yield* observe(current.value)
            if (projection._tag === "Absent") {
              yield* Ref.set(lease, Option.some(owner))
              return
            }
            return yield* new CodexAttemptStoreFailure({
              detail:
                projection._tag === "ExactLive"
                  ? "server lease is held by a live owner"
                  : `server lease owner cannot be reclaimed: ${projection.detail}`,
              operation: "acquireServerLease"
            })
          })
        )
      })
      const releaseServerLease = Effect.fn("CodexAttemptStore.Memory.releaseServerLease")(function* (
        owner: CodexServerLeaseRecord
      ) {
        const current = yield* Ref.get(lease)
        if (Option.isNone(current)) return
        if (!sameLeaseOwner(current.value, owner)) {
          return yield* new CodexAttemptStoreFailure({
            detail: "server lease is owned by another process",
            operation: "releaseServerLease"
          })
        }
        yield* Ref.set(lease, Option.none())
      })
      return Context.make(CodexAttemptStore, {
        readAttempt,
        writeAttempt,
        readServerLaunch,
        writeServerLaunch,
        clearServerLaunch,
        readReplacementLedger,
        appendReplacementLedger,
        acquireServerLease,
        releaseServerLease
      })
    })
  )

/** In-memory private state used by controlled app-server tests and dry compositions. */
export const memoryCodexAttemptStoreLayer = memoryStore

/**
 * Configuration for the private Codex state directory. The path is decoded
 * at the node boundary; callers cannot supply an arbitrary file locator or
 * bypass the private filename and filesystem ownership checks.
 */
export interface CodexAttemptStoreConfig {
  /** Absolute private state directory. Omit to read DALPH_STATE_DIRECTORY. */
  readonly stateDirectory?: string
}

/** Explicit service-level default; no HOME or ambient process environment is inferred. */
export const defaultCodexStateDirectory = "/var/lib/dalph"
const privateStateFilename = "executor-private-state.json"
const privateDirectoryMode = 0o700
const privateFileMode = 0o600
const privatePermissionMask = 0o077
const privateReadOnlyFlags = nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW
const privateAppendFlags =
  nodeFs.constants.O_RDWR | nodeFs.constants.O_APPEND | nodeFs.constants.O_CREAT | nodeFs.constants.O_NOFOLLOW
const privateAppendCreateFlags = privateAppendFlags | nodeFs.constants.O_EXCL
const privateLeaseFlags = nodeFs.constants.O_RDWR | nodeFs.constants.O_NOFOLLOW
const privateLeaseCreateFlags = privateLeaseFlags | nodeFs.constants.O_CREAT | nodeFs.constants.O_EXCL

/** Validated absolute file locator for the one private Codex state record. */
const CodexAttemptStoreLocator = Schema.String.pipe(Schema.brand("CodexAttemptStoreLocator"))
type CodexAttemptStoreLocator = typeof CodexAttemptStoreLocator.Type

const configurationFailure = (detail: string): CodexAttemptStoreFailure =>
  new CodexAttemptStoreFailure({ detail, operation: "configure" })

export const configurationFailureFromUnknown = (error: unknown): CodexAttemptStoreFailure =>
  configurationFailure(String(error))

export const configurationFailureFromDescriptor = (error: { readonly detail: string }): CodexAttemptStoreFailure =>
  configurationFailure(error.detail)

export const acquireDescriptorFailure = (error: { readonly message: string }): CodexAttemptStoreFailure =>
  new CodexAttemptStoreFailure({ detail: error.message, operation: "acquireServerLease" })

export const releaseLeaseNativeFailure = (error: CodexAttemptStoreNativeFailure): CodexAttemptStoreFailure =>
  new CodexAttemptStoreFailure({ detail: String(error.cause), operation: "releaseServerLease" })

/** Unlocks and closes one lease descriptor, retaining both native failures when cleanup compounds. */
export const closeLeaseDescriptor = (
  unlock: Effect.Effect<void, { readonly cause: unknown }>,
  close: Effect.Effect<void, CodexAttemptStoreFailure>
): Effect.Effect<void, CodexAttemptStoreFailure> =>
  unlock.pipe(
    Effect.matchEffect({
      onFailure: (unlockFailure) =>
        close.pipe(
          Effect.matchEffect({
            onFailure: (closeFailure) =>
              Effect.fail(
                new CodexAttemptStoreFailure({
                  detail: `lease unlock failed: ${String(unlockFailure.cause)}; close failed: ${String(closeFailure)}`,
                  operation: "releaseServerLease"
                })
              ),
            onSuccess: () =>
              Effect.fail(
                new CodexAttemptStoreFailure({
                  detail: `lease unlock failed: ${String(unlockFailure.cause)}`,
                  operation: "releaseServerLease"
                })
              )
          })
        ),
      onSuccess: () => close
    })
  )

/** Compensates a failed lease acquisition and reports both the acquisition and unlock failures. */
export const releaseAfterAcquireFailure = (
  failure: CodexAttemptStoreFailure,
  unlock: Effect.Effect<void, { readonly cause: unknown }>
): Effect.Effect<never, CodexAttemptStoreFailure> =>
  unlock.pipe(
    Effect.matchEffect({
      onFailure: (cleanupFailure) =>
        Effect.fail(
          new CodexAttemptStoreFailure({
            detail: `${failure.detail}; lease unlock failed: ${String(cleanupFailure.cause)}`,
            operation: "acquireServerLease"
          })
        ),
      onSuccess: () => Effect.fail(failure)
    })
  )

export const acquireLeaseReadFailure = (error: unknown): CodexAttemptStoreFailure =>
  error instanceof CodexAttemptStoreFailure
    ? error
    : new CodexAttemptStoreFailure({
        detail: error instanceof CodexAttemptStoreNativeFailure ? nativeFailureDetail(error) : String(error),
        operation: "acquireServerLease"
      })

export const leaseLockIsContended = (code: string): boolean =>
  code === "EACCES" || code === "EAGAIN" || code === "EWOULDBLOCK"

export const storeOperationFailure = (
  operation: CodexAttemptStoreOperation,
  error: unknown
): CodexAttemptStoreFailure =>
  error instanceof CodexAttemptStoreFailure
    ? error
    : new CodexAttemptStoreFailure({
        detail: error instanceof CodexAttemptStoreNativeFailure ? nativeFailureDetail(error) : String(error),
        operation
      })

const rememberStoreFailure = (
  loadFailure: Ref.Ref<Option.Option<CodexAttemptStoreFailure>>,
  operation: CodexAttemptStoreOperation,
  error: unknown
): Effect.Effect<void> => Ref.set(loadFailure, Option.some(storeOperationFailure(operation, error)))

export const processUid = (
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): number | undefined => native.processUid()

export const nativeErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

type PrivateFilesystemObservation =
  | { readonly _tag: "Present" }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Failure"; readonly detail: string }

export const invalidStateDirectory = (
  raw: string,
  path: Pick<Path.Path, "basename" | "isAbsolute" | "normalize">
): boolean =>
  raw.length === 0 ||
  raw.trim() !== raw ||
  raw.includes("\u0000") ||
  !path.isAbsolute(raw) ||
  path.normalize(raw) !== raw ||
  path.basename(raw) === "." ||
  path.basename(raw) === ".."

const ensurePrivateDirectoryComponent = async (
  parent: string,
  component: string,
  isFinal: boolean,
  uid: number | undefined,
  native: CodexAttemptStoreNativeService
): Promise<{ readonly current: string; readonly observation: PrivateFilesystemObservation }> => {
  const current = native.path.join(parent, component)
  let stat
  try {
    stat = await native.lstat(current)
  } catch (error) {
    if (nativeErrorCode(error) !== "ENOENT") return { current, observation: { _tag: "Failure", detail: String(error) } }
    await native.mkdir(current, { mode: privateDirectoryMode })
    stat = await native.lstat(current)
  }
  const failure = privateDirectoryStatFailure(stat, current, isFinal, uid)
  return failure === undefined
    ? { current, observation: { _tag: "Present" } }
    : { current, observation: { _tag: "Failure", detail: failure } }
}

export const privateDirectoryStatFailure = (
  stat: Stats,
  current: string,
  isFinal: boolean,
  uid: number | undefined
): string | undefined => {
  if (stat.isSymbolicLink()) return `private state path is a symlink: ${current}`
  if (!stat.isDirectory()) return `private state path is not a directory: ${current}`
  if (isFinal && uid !== undefined && stat.uid !== uid) return `private state directory is foreign: ${current}`
  if (isFinal && (stat.mode & privatePermissionMask) !== 0)
    return `private state directory is not owner-only: ${current}`
  return undefined
}

/**
 * The node adapter owns the exact path authority. It rejects traversal and
 * canonicalization changes before touching the host filesystem; the
 * platform Path service remains the source of path semantics at this
 * configuration boundary.
 */
const decodeStateDirectory = (raw: string, path: Path.Path): Effect.Effect<string, CodexAttemptStoreFailure> => {
  if (invalidStateDirectory(raw, path)) {
    return Effect.fail(
      configurationFailure("Codex private state directory must be an absolute, normalized path without traversal")
    )
  }
  return Effect.succeed(raw)
}

const decodeStateFileLocator = (
  stateDirectory: string,
  path: Path.Path
): Effect.Effect<CodexAttemptStoreLocator, CodexAttemptStoreFailure> =>
  Effect.succeed(CodexAttemptStoreLocator.make(path.join(stateDirectory, privateStateFilename)))

export const ensurePrivateDirectory = async (
  directory: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Promise<PrivateFilesystemObservation> => {
  try {
    const parsed = native.path.parse(directory)
    const components = directory
      .slice(parsed.root.length)
      .split(native.path.sep)
      .filter((component) => component.length > 0)
    if (components.length === 0)
      return { _tag: "Failure", detail: "private state directory cannot be a filesystem root" }
    let current = parsed.root
    const uid = processUid(native)
    for (const [index, component] of components.entries()) {
      const result = await ensurePrivateDirectoryComponent(
        current,
        component,
        index === components.length - 1,
        uid,
        native
      )
      if (result.observation._tag === "Failure") return result.observation
      current = result.current
    }
    return { _tag: "Present" }
  } catch (error) {
    return { _tag: "Failure", detail: String(error) }
  }
}

export const privateFileStatFailure = (stat: Stats, filename: string, uid: number | undefined): string | undefined => {
  if (stat.isSymbolicLink()) return `private state file is a symlink: ${filename}`
  if (!stat.isFile()) return `private state path is not a regular file: ${filename}`
  if (uid !== undefined && stat.uid !== uid) return `private state file is foreign: ${filename}`
  if ((stat.mode & privatePermissionMask) !== 0) return `private state file is not owner-only: ${filename}`
  return undefined
}

export const inspectPrivateFile = async (
  filename: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Promise<PrivateFilesystemObservation> => {
  try {
    const stat = await native.lstat(filename)
    const uid = processUid(native)
    const failure = privateFileStatFailure(stat, filename, uid)
    return failure === undefined ? { _tag: "Present" } : { _tag: "Failure", detail: failure }
  } catch (error) {
    return nativeErrorCode(error) === "ENOENT" ? { _tag: "Absent" } : { _tag: "Failure", detail: String(error) }
  }
}

/** Observes the descriptor opened with O_NOFOLLOW, never a second path lookup. */
export const inspectPrivateDescriptor = async (
  file: FileHandle,
  filename: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Promise<PrivateFilesystemObservation> => {
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return { _tag: "Failure", detail: `private state path is not a regular file: ${filename}` }
    const uid = processUid(native)
    if (uid !== undefined && stat.uid !== uid) {
      return { _tag: "Failure", detail: `private state file is foreign: ${filename}` }
    }
    if ((stat.mode & privatePermissionMask) !== 0) {
      return { _tag: "Failure", detail: `private state file is not owner-only: ${filename}` }
    }
    return { _tag: "Present" }
  } catch (error) {
    return { _tag: "Failure", detail: String(error) }
  }
}

/** Converts descriptor observation into one typed private-store failure. */
export const validatePrivateDescriptor = (
  file: FileHandle,
  filename: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Effect.Effect<void, CodexAttemptStoreFailure> =>
  Effect.promise(() => inspectPrivateDescriptor(file, filename, native)).pipe(
    Effect.flatMap((observation) =>
      observation._tag === "Failure" ? Effect.fail(configurationFailure(observation.detail)) : Effect.void
    )
  )

/** Opens the private snapshot once; an existing file is reopened only with O_NOFOLLOW. */
export const openPrivateAppendDescriptor = async (
  filename: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Promise<FileHandle> => {
  try {
    return await native.open(filename, privateAppendCreateFlags, privateFileMode)
  } catch (error) {
    return nativeErrorCode(error) === "EEXIST"
      ? await native.open(filename, privateAppendFlags)
      : await Promise.reject(error)
  }
}

/** Opens the crash-recoverable lease once; creation and every reopen reject symlinks. */
export const openPrivateLeaseDescriptor = async (
  filename: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Promise<FileHandle> => {
  try {
    return await native.open(filename, privateLeaseCreateFlags, privateFileMode)
  } catch (error) {
    return nativeErrorCode(error) === "EEXIST"
      ? await native.open(filename, privateLeaseFlags)
      : await Promise.reject(error)
  }
}

/** Reads a retained descriptor from offset zero without resolving its path again. */
export const readPrivateDescriptor = async (file: FileHandle): Promise<string> => {
  const size = (await file.stat()).size
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const result = await file.read(bytes, offset, size - offset, offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return bytes.subarray(0, offset).toString("utf8")
}

/** Reads one private file through the no-follow descriptor that owns the read. */
export const readPrivateFile = (
  filename: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
): Effect.Effect<string, CodexAttemptStoreNativeFailure> =>
  Effect.tryPromise({
    try: async () => {
      const file = await native.open(filename, privateReadOnlyFlags)
      try {
        const observation = await inspectPrivateDescriptor(file, filename, native)
        return observation._tag === "Failure"
          ? { _tag: "Failure" as const, detail: observation.detail }
          : { _tag: "Read" as const, text: await file.readFile("utf8") }
      } finally {
        await file.close()
      }
    },
    catch: nativeFailure
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail(new CodexAttemptStoreNativeFailure({ cause: result.detail }))
        : Effect.succeed(result.text)
    )
  )

/** Appends one checksummed complete snapshot; a torn final line leaves the prior record readable. */
export const appendPrivateSnapshot = (
  file: Pick<FileHandle, "writeFile" | "chmod" | "sync">,
  payload: string
): Effect.Effect<void, CodexAttemptStoreNativeFailure> =>
  Effect.tryPromise({
    try: async () => {
      const digest = createHash("sha256").update(payload, "utf8").digest("hex")
      await file.writeFile(`\n${JSON.stringify({ digest, formatVersion: 1, payload })}\n`, "utf8")
      await file.chmod(privateFileMode)
      await file.sync()
    },
    catch: nativeFailure
  })

const validatePrivateFilesystem = (
  parent: string,
  filename: string,
  temporary: string,
  lease: string,
  native: CodexAttemptStoreNativeService = nodeCodexAttemptStoreNativeService
) =>
  Effect.tryPromise({
    try: async () => {
      const directory = await ensurePrivateDirectory(parent, native)
      if (directory._tag === "Failure") return directory
      const main = await inspectPrivateFile(filename, native)
      if (main._tag === "Failure") return main
      const next = await inspectPrivateFile(temporary, native)
      if (next._tag === "Failure") return next
      const leaseFile = await inspectPrivateFile(lease, native)
      if (leaseFile._tag === "Failure") return leaseFile
      return { _tag: "Valid" as const, mainExists: main._tag === "Present", temporaryExists: next._tag === "Present" }
    },
    catch: configurationFailureFromUnknown
  }).pipe(
    Effect.flatMap((observation) =>
      observation._tag === "Failure"
        ? Effect.fail(configurationFailure(observation.detail))
        : Effect.succeed(observation)
    )
  )

const parseSnapshot = (text: string): CodexAttemptStoreSnapshot => {
  const parsed: unknown = JSON.parse(text)
  return Schema.decodeUnknownSync(CodexAttemptStoreSnapshot)(parsed)
}

type ChecksummedSnapshotRecord = { readonly formatVersion: 1; readonly payload: string; readonly digest: string }

const isChecksummedSnapshotRecord = (parsed: unknown): parsed is ChecksummedSnapshotRecord => {
  if (typeof parsed !== "object" || parsed === null) return false
  if (!("formatVersion" in parsed) || parsed.formatVersion !== 1) return false
  if (!("payload" in parsed) || typeof parsed.payload !== "string") return false
  return "digest" in parsed && typeof parsed.digest === "string"
}

const checksummedPayload = (parsed: unknown): string | undefined => {
  if (!isChecksummedSnapshotRecord(parsed)) return undefined
  return createHash("sha256").update(parsed.payload, "utf8").digest("hex") === parsed.digest
    ? parsed.payload
    : undefined
}

const parseChecksummedSnapshotLine = (line: string): CodexAttemptStoreSnapshot | undefined => {
  try {
    const payload = checksummedPayload(JSON.parse(line))
    return payload === undefined ? undefined : parseSnapshot(payload)
  } catch {
    return undefined
  }
}

const parseSnapshotDocument = (text: string): CodexAttemptStoreSnapshot => {
  const lines = text.split("\n").filter((line) => line.trim().length > 0)
  for (const line of [...lines].reverse()) {
    const snapshot = parseChecksummedSnapshotLine(line)
    if (snapshot !== undefined) return snapshot
  }
  return parseSnapshot(text)
}

const encodeSnapshot = (
  attempts: ReadonlyMap<string, CodexAttemptRecord>,
  serverLaunch: Option.Option<CodexServerLaunchRecord>,
  replacements: ReadonlyMap<string, CodexPurgedWorkUnitReplacementLedger>
): string =>
  JSON.stringify({
    attempts: [...attempts.values()],
    serverLaunch: Option.isSome(serverLaunch) ? serverLaunch.value : null,
    replacements: [...replacements.values()]
  })

/** Validates the complete next snapshot before one store operation crosses persistence. */
const validateSnapshot = (
  attempts: ReadonlyMap<string, CodexAttemptRecord>,
  serverLaunch: Option.Option<CodexServerLaunchRecord>,
  replacements: ReadonlyMap<string, CodexPurgedWorkUnitReplacementLedger>,
  operation: CodexAttemptStoreOperation
): Effect.Effect<void, CodexAttemptStoreFailure> =>
  Effect.try({
    try: () => {
      Schema.decodeUnknownSync(CodexAttemptStoreSnapshot)({
        attempts: [...attempts.values()],
        serverLaunch: Option.isSome(serverLaunch) ? serverLaunch.value : null,
        replacements: [...replacements.values()]
      })
    },
    catch: (error) => new CodexAttemptStoreFailure({ detail: String(error), operation })
  }).pipe(Effect.asVoid)

/**
 * Node filesystem implementation. Writes append one checksummed complete
 * record through an O_NOFOLLOW descriptor, so a restart can retain the last
 * complete record even when a process dies during a later append.
 */
const codexAttemptStoreLayer = (config: CodexAttemptStoreConfig = {}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const native = yield* CodexAttemptStoreNative
      const path = yield* Path.Path
      const stateDirectory = yield* decodeStateDirectory(
        config.stateDirectory ??
          (yield* Config.string("DALPH_STATE_DIRECTORY").pipe(Config.withDefault(defaultCodexStateDirectory))),
        path
      )
      const filename = yield* decodeStateFileLocator(stateDirectory, path)
      const temporary = `${filename}.next`
      const leaseFilename = `${filename}.lease`
      const parent = stateDirectory
      const privateFiles = yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename, native)
      const snapshotFile = yield* Effect.tryPromise({
        try: () => openPrivateAppendDescriptor(filename, native),
        catch: configurationFailureFromUnknown
      })
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => snapshotFile.close(),
          /* v8 ignore next -- @preserve Finalizer close is deliberately best-effort after all durable descriptor work has settled. */
          catch: () => undefined
        }).pipe(Effect.orDie)
      )
      yield* validatePrivateDescriptor(snapshotFile, filename, native).pipe(
        Effect.mapError(configurationFailureFromDescriptor)
      )
      const initial = yield* Effect.gen(function* () {
        if (privateFiles.mainExists) {
          const text = yield* Effect.tryPromise({
            try: () => readPrivateDescriptor(snapshotFile),
            catch: nativeFailure
          })
          return text.trim().length === 0 ? JSON.stringify(emptySnapshot) : text
        }
        return privateFiles.temporaryExists ? yield* readPrivateFile(temporary, native) : JSON.stringify(emptySnapshot)
      }).pipe(
        Effect.map((text) => {
          try {
            return { snapshot: parseSnapshotDocument(text), failure: Option.none<CodexAttemptStoreFailure>() }
          } catch (error) {
            return {
              snapshot: emptySnapshot,
              failure: Option.some(
                new CodexAttemptStoreFailure({ detail: String(error), operation: "readAttempt" as const })
              )
            }
          }
        }),
        Effect.mapError(storeOperationFailure.bind(undefined, "readAttempt"))
      )
      const attempts = yield* Ref.make<ReadonlyMap<string, CodexAttemptRecord>>(
        new Map(
          initial.snapshot.attempts.map((record) => [
            keyOf(record.correlationRunId, record.correlationAttemptId),
            record
          ])
        )
      )
      const launch = yield* Ref.make<Option.Option<CodexServerLaunchRecord>>(
        initial.snapshot.serverLaunch === null ? Option.none() : Option.some(initial.snapshot.serverLaunch)
      )
      const replacements = yield* Ref.make<ReadonlyMap<string, CodexPurgedWorkUnitReplacementLedger>>(
        new Map(initial.snapshot.replacements.map((ledger) => [ledger.requestId, ledger]))
      )
      const loadFailure = yield* Ref.make<Option.Option<CodexAttemptStoreFailure>>(initial.failure)
      const persistence = yield* Semaphore.make(1)
      const guard = <A>(
        operation: CodexAttemptStoreOperation,
        effect: Effect.Effect<A, CodexAttemptStoreFailure>
      ): Effect.Effect<A, CodexAttemptStoreFailure> =>
        Ref.get(loadFailure).pipe(
          Effect.flatMap((failure) =>
            Option.isSome(failure)
              ? Effect.fail(new CodexAttemptStoreFailure({ detail: failure.value.detail, operation }))
              : effect
          )
        )
      const persist = (operation: CodexAttemptStoreOperation) =>
        persistence.withPermit(
          guard(
            operation,
            Effect.gen(function* () {
              yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename, native)
              const text = encodeSnapshot(
                yield* Ref.get(attempts),
                yield* Ref.get(launch),
                yield* Ref.get(replacements)
              )
              // The private state file is an append-only checksummed boundary.
              // It never re-resolves a validated temporary path for rename;
              // O_NOFOLLOW + one descriptor owns the write and fsync.
              yield* appendPrivateSnapshot(snapshotFile, text)
            }).pipe(Effect.mapError(storeOperationFailure.bind(undefined, operation)))
          )
        )
      const readAttempt: CodexAttemptStoreService["readAttempt"] = (runId, attemptId) =>
        guard(
          "readAttempt",
          Ref.get(attempts).pipe(
            Effect.map((current) => {
              const value = current.get(keyOf(runId, attemptId))
              return value === undefined ? Option.none<CodexAttemptRecord>() : Option.some(value)
            })
          )
        )
      const writeAttempt: CodexAttemptStoreService["writeAttempt"] = (record) =>
        guard(
          "writeAttempt",
          Effect.gen(function* () {
            const current = yield* Ref.get(attempts)
            const next = new Map([
              ...current,
              [keyOf(record.correlationRunId, record.correlationAttemptId), record] as const
            ])
            yield* validateSnapshot(next, yield* Ref.get(launch), yield* Ref.get(replacements), "writeAttempt")
            yield* Ref.set(attempts, next)
          })
        ).pipe(
          Effect.andThen(persist("writeAttempt")),
          Effect.tapError(rememberStoreFailure.bind(undefined, loadFailure, "writeAttempt"))
        )
      const readServerLaunch: CodexAttemptStoreService["readServerLaunch"] = () =>
        guard("readServerLaunch", Ref.get(launch))
      const writeServerLaunch: CodexAttemptStoreService["writeServerLaunch"] = (record) =>
        guard(
          "writeServerLaunch",
          Effect.gen(function* () {
            const next = Option.some(record)
            yield* validateSnapshot(yield* Ref.get(attempts), next, yield* Ref.get(replacements), "writeServerLaunch")
            yield* Ref.set(launch, next)
          })
        ).pipe(
          Effect.andThen(persist("writeServerLaunch")),
          Effect.tapError(rememberStoreFailure.bind(undefined, loadFailure, "writeServerLaunch"))
        )
      const clearServerLaunch: CodexAttemptStoreService["clearServerLaunch"] = (incarnation) =>
        guard(
          "clearServerLaunch",
          Ref.update(launch, (current) =>
            Option.isSome(current) && current.value.incarnation === incarnation ? Option.none() : current
          )
        ).pipe(
          Effect.andThen(persist("clearServerLaunch")),
          Effect.tapError(rememberStoreFailure.bind(undefined, loadFailure, "clearServerLaunch"))
        )
      const readReplacementLedger: NonNullable<CodexAttemptStoreService["readReplacementLedger"]> = (requestId) =>
        guard(
          "readReplacementLedger",
          Ref.get(replacements).pipe(
            Effect.map((current) => {
              const value = current.get(requestId)
              return value === undefined ? Option.none<CodexPurgedWorkUnitReplacementLedger>() : Option.some(value)
            })
          )
        )
      const appendReplacementLedger: NonNullable<CodexAttemptStoreService["appendReplacementLedger"]> = (ledger) =>
        guard(
          "appendReplacementLedger",
          Effect.gen(function* () {
            const current = yield* Ref.get(replacements)
            const merged = mergeCodexReplacementLedger(current.get(ledger.requestId), ledger)
            if (merged._tag === "Contradiction") {
              return yield* new CodexAttemptStoreFailure({
                detail: merged.detail,
                operation: "appendReplacementLedger"
              })
            }
            if (merged._tag === "Idempotent") return
            const next = new Map([...current, [ledger.requestId, merged.ledger] as const])
            yield* validateSnapshot(yield* Ref.get(attempts), yield* Ref.get(launch), next, "appendReplacementLedger")
            yield* Ref.set(replacements, next)
          })
        ).pipe(
          Effect.andThen(persist("appendReplacementLedger")),
          Effect.tapError(rememberStoreFailure.bind(undefined, loadFailure, "appendReplacementLedger"))
        )
      const heldLease = yield* Ref.make<
        Option.Option<{ readonly file: FileHandle; readonly owner: CodexServerLeaseRecord }>
      >(Option.none())
      const sameLeaseOwner = (left: CodexServerLeaseRecord, right: CodexServerLeaseRecord) =>
        left.pid === right.pid &&
        left.processIdentity === right.processIdentity &&
        left.incarnation === right.incarnation
      const nativeLock = (
        file: FileHandle,
        flags: Parameters<CodexAttemptStoreNativeService["lock"]>[1]
      ): Effect.Effect<void, CodexAttemptStoreNativeFailure> =>
        Effect.tryPromise({ try: () => native.lock(file, flags), catch: nativeFailure })
      const closeDescriptor = (file: FileHandle, operation: CodexAttemptStoreOperation) =>
        Effect.tryPromise({ try: () => file.close(), catch: nativeFailure }).pipe(
          Effect.mapError(storeOperationFailure.bind(undefined, operation))
        )
      const closeLeaseFile = (file: FileHandle) =>
        closeLeaseDescriptor(nativeLock(file, "un"), closeDescriptor(file, "releaseServerLease"))
      const leaseFile = yield* Effect.tryPromise({
        try: () => openPrivateLeaseDescriptor(leaseFilename, native),
        catch: configurationFailureFromUnknown
      })
      yield* Effect.addFinalizer(() => closeLeaseFile(leaseFile).pipe(Effect.orDie))
      yield* validatePrivateDescriptor(leaseFile, leaseFilename, native).pipe(
        Effect.mapError(configurationFailureFromDescriptor)
      )
      const readLeaseRecord = (file: FileHandle) =>
        Effect.tryPromise({ try: () => readPrivateDescriptor(file), catch: nativeFailure }).pipe(
          Effect.flatMap((text) => {
            if (text.trim().length === 0) return Effect.succeed(Option.none<CodexServerLeaseRecord>())
            try {
              return Effect.succeed(Option.some(Schema.decodeUnknownSync(CodexServerLeaseRecord)(JSON.parse(text))))
            } catch (error) {
              return Effect.fail(
                new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
              )
            }
          }),
          Effect.mapError(acquireLeaseReadFailure)
        )
      const writeLeaseRecord = (file: FileHandle, owner: CodexServerLeaseRecord) =>
        Effect.tryPromise({
          try: async () => {
            const bytes = Buffer.from(JSON.stringify(owner), "utf8")
            await file.truncate(0)
            await file.write(bytes, 0, bytes.byteLength, 0)
            await file.chmod(privateFileMode)
            await file.sync()
          },
          catch: nativeFailure
        }).pipe(Effect.mapError(storeOperationFailure.bind(undefined, "acquireServerLease")))
      const releaseAfterAcquireFailureForFile = (
        file: FileHandle,
        failure: CodexAttemptStoreFailure
      ): Effect.Effect<never, CodexAttemptStoreFailure> => releaseAfterAcquireFailure(failure, nativeLock(file, "un"))
      const handleLockedLease = (
        file: FileHandle,
        observe: (
          owner: CodexServerLeaseRecord
        ) => Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure>,
        lockFailure: CodexAttemptStoreFailure
      ) =>
        Effect.gen(function* () {
          const existing = yield* readLeaseRecord(file).pipe(Effect.result)
          yield* closeDescriptor(file, "acquireServerLease")
          if (Result.isFailure(existing)) return yield* existing.failure
          if (Option.isNone(existing.success)) {
            return yield* new CodexAttemptStoreFailure({
              detail: "server lease is locked but has no readable owner",
              operation: "acquireServerLease"
            })
          }
          const projection = yield* observe(existing.success.value)
          return yield* new CodexAttemptStoreFailure({
            detail:
              projection._tag === "ExactLive"
                ? "server lease is held by a live owner"
                : projection._tag === "Absent"
                  ? "server lease lock is held by an absent owner"
                  : `server lease owner cannot be reclaimed: ${projection.detail}`,
            operation: lockFailure.operation
          })
        })
      const inspectUnlockedLease = (
        file: FileHandle,
        owner: CodexServerLeaseRecord,
        observe: (
          owner: CodexServerLeaseRecord
        ) => Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure>
      ) =>
        Effect.gen(function* () {
          const existing = yield* readLeaseRecord(file)
          if (Option.isNone(existing)) {
            yield* writeLeaseRecord(file, owner)
          } else {
            const projection = yield* observe(existing.value)
            if (projection._tag === "Absent") {
              yield* writeLeaseRecord(file, owner)
            } else if (!(projection._tag === "ExactLive" && sameLeaseOwner(existing.value, owner))) {
              return yield* new CodexAttemptStoreFailure({
                detail:
                  projection._tag === "ExactLive"
                    ? "server lease is held by a live owner"
                    : `server lease owner cannot be reclaimed: ${projection.detail}`,
                operation: "acquireServerLease"
              })
            }
          }
          yield* Ref.set(heldLease, Option.some({ file, owner }))
        }).pipe(Effect.result)
      const heldLeaseDisposition = (
        held: Option.Option<{ readonly file: FileHandle; readonly owner: CodexServerLeaseRecord }>,
        owner: CodexServerLeaseRecord
      ): "Acquire" | "Reenter" | "Conflict" =>
        Option.isNone(held) ? "Acquire" : sameLeaseOwner(held.value.owner, owner) ? "Reenter" : "Conflict"
      const acquireServerLease: CodexAttemptStoreService["acquireServerLease"] = (owner, observe) =>
        guard(
          "acquireServerLease",
          Effect.gen(function* () {
            const held = yield* Ref.get(heldLease)
            const disposition = heldLeaseDisposition(held, owner)
            if (disposition === "Reenter") return
            if (disposition === "Conflict") {
              return yield* new CodexAttemptStoreFailure({
                detail: "server lease is already held by this process for another incarnation",
                operation: "acquireServerLease"
              })
            }
            yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename, native)
            const file = leaseFile
            yield* validatePrivateDescriptor(file, leaseFilename, native).pipe(
              Effect.mapError(acquireDescriptorFailure)
            )
            const lock = yield* nativeLock(file, "exnb").pipe(Effect.result)
            if (Result.isFailure(lock)) {
              const lockCode = errorCode(lock.failure.cause)
              const lockFailure = new CodexAttemptStoreFailure({
                detail: `server lease lock failed: ${String(lock.failure.cause)}`,
                operation: "acquireServerLease"
              })
              if (!leaseLockIsContended(lockCode)) {
                return yield* releaseAfterAcquireFailureForFile(file, lockFailure)
              }
              return yield* handleLockedLease(file, observe, lockFailure)
            }
            const inspected = yield* inspectUnlockedLease(file, owner, observe)
            if (Result.isFailure(inspected)) return yield* releaseAfterAcquireFailureForFile(file, inspected.failure)
          })
        )
      const releaseServerLease: CodexAttemptStoreService["releaseServerLease"] = (owner) =>
        Effect.gen(function* () {
          const held = yield* Ref.get(heldLease)
          if (Option.isNone(held)) return
          if (!sameLeaseOwner(held.value.owner, owner)) {
            return yield* new CodexAttemptStoreFailure({
              detail: "server lease is owned by another process",
              operation: "releaseServerLease"
            })
          }
          yield* nativeLock(held.value.file, "un").pipe(Effect.mapError(releaseLeaseNativeFailure))
          yield* Ref.set(heldLease, Option.none())
        })
      return Context.make(CodexAttemptStore, {
        readAttempt,
        writeAttempt,
        readServerLaunch,
        writeServerLaunch,
        clearServerLaunch,
        readReplacementLedger,
        appendReplacementLedger,
        acquireServerLease,
        releaseServerLease
      })
    })
  )

/** Production private-store composition with the Node native filesystem and lease adapter selected. */
export const nodeCodexAttemptStoreLayer = (config: CodexAttemptStoreConfig = {}) =>
  codexAttemptStoreLayer(config).pipe(Layer.provide(nodeCodexAttemptStoreNativeLayer))
