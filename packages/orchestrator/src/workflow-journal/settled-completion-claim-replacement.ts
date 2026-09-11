import { HashMap, Option, Schema } from "effect"
import { CompletionTaskClaim, completionTaskClaimEquals } from "../workflow/protocols/integration-finality/events.js"
import type { JournalRecord } from "./store.js"

const SettledCompletionClaimReplacementEvidenceTypeId: unique symbol = Symbol(
  "SettledCompletionClaimReplacementEvidence"
)

/**
 * A prior replacement intent and its exact later outcome establish that one
 * promoted completion claim was installed. Reacquired original claims for the
 * same promotion remain distinct. This immutable journal-derived evidence does
 * not assert that the tracker still holds the claim and is never persisted.
 * Settlement existence is monotonic: retaining its first occurrence supports
 * every earlier cutoff without a chain of predecessor projections.
 */
export interface SettledCompletionClaimReplacementEvidence {
  readonly [SettledCompletionClaimReplacementEvidenceTypeId]: true
}
type ReplacementIntent = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplacementIntended" }>
}
type ReplacementOutcome = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "CompletionClaimReplaced" }>
}
const isReplacementIntent = (record: JournalRecord): record is ReplacementIntent =>
  record.event._tag === "CompletionClaimReplacementIntended"
const isReplacementOutcome = (record: JournalRecord): record is ReplacementOutcome =>
  record.event._tag === "CompletionClaimReplaced"

/** Exact chronological pair, including an arbitrary recorded replacement operation identity. */
export interface SettledCompletionClaimReplacement {
  readonly intent: ReplacementIntent
  readonly outcome: ReplacementOutcome
}
interface Roots {
  readonly intents: HashMap.HashMap<string, ReplacementIntent>
  readonly settled: HashMap.HashMap<string, SettledCompletionClaimReplacement>
}
const rootsByEvidence = new WeakMap<SettledCompletionClaimReplacementEvidence, Roots>()
const rootsOf = (evidence: SettledCompletionClaimReplacementEvidence): Roots =>
  Option.getOrThrow(Option.fromUndefinedOr(rootsByEvidence.get(evidence)))
const retain = (roots: Roots): SettledCompletionClaimReplacementEvidence => {
  const evidence: SettledCompletionClaimReplacementEvidence = {
    [SettledCompletionClaimReplacementEvidenceTypeId]: true
  }
  rootsByEvidence.set(evidence, roots)
  return evidence
}
const encodeClaim = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(CompletionTaskClaim)))
/** In-memory exact schema identity, not the tracker's durable authority fingerprint. */
const claimKey = (claim: CompletionTaskClaim): string =>
  JSON.stringify([claim.promotionCorrelation.requestId, encodeClaim(claim)])
const operationKey = (record: ReplacementIntent | ReplacementOutcome): string =>
  JSON.stringify([record.runId, record.event.operationId])

export const emptySettledCompletionClaimReplacements = (): SettledCompletionClaimReplacementEvidence =>
  retain({ intents: HashMap.empty(), settled: HashMap.empty() })

/** Only an earlier exact intent can explain an outcome; future or foreign-run records cannot supply it. */
export const appendSettledCompletionClaimReplacementEvidence = (
  evidence: SettledCompletionClaimReplacementEvidence,
  record: JournalRecord
): SettledCompletionClaimReplacementEvidence => {
  const event = record.event
  if (event._tag !== "CompletionClaimReplacementIntended" && event._tag !== "CompletionClaimReplaced") return evidence
  if (event.claim.plannedAttempt.runId !== record.runId) return evidence
  const roots = rootsOf(evidence)
  if (isReplacementIntent(record)) {
    return retain({ ...roots, intents: HashMap.set(roots.intents, operationKey(record), record) })
  }
  if (!isReplacementOutcome(record)) return evidence
  const outcome = record
  const intent = Option.getOrUndefined(HashMap.get(roots.intents, operationKey(outcome)))
  if (
    intent === undefined ||
    intent.position >= record.position ||
    !completionTaskClaimEquals(intent.event.claim, event.claim)
  ) {
    return evidence
  }
  const key = claimKey(event.claim)
  if (HashMap.has(roots.settled, key)) return evidence
  return retain({ ...roots, settled: HashMap.set(roots.settled, key, { intent, outcome }) })
}

const observers = new Set<(event: "SettlementLookup") => void>()
/** Test-only deterministic lookup observer; never exported from the production barrel. */
export const observeSettledCompletionClaimReplacementLookup = (observer: (event: "SettlementLookup") => void) => {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}

/** Looks up the exact claim, not merely its promotion; older windows cannot see a later settlement. */
export const settledCompletionClaimReplacementAt = (
  evidence: SettledCompletionClaimReplacementEvidence,
  query: { readonly claim: CompletionTaskClaim; readonly throughPosition: number }
): SettledCompletionClaimReplacement | undefined => {
  for (const observer of observers) observer("SettlementLookup")
  const settled = Option.getOrUndefined(HashMap.get(rootsOf(evidence).settled, claimKey(query.claim)))
  return settled !== undefined &&
    settled.outcome.position <= query.throughPosition &&
    completionTaskClaimEquals(settled.outcome.event.claim, query.claim)
    ? settled
    : undefined
}

/** Includes both persistent maps and all retained record pairs; no predecessor evidence is retained. */
export const inspectSettledCompletionClaimReplacementStorage = (
  evidence: SettledCompletionClaimReplacementEvidence
): ReadonlyArray<object> => {
  const roots = rootsOf(evidence)
  return [roots.intents, roots.settled]
}
