import { Effect, Schema } from "effect"
import type { JournalEventKind } from "../workflow/kernel/event.js"

const Payload = Schema.Record(Schema.String, Schema.Json)
const CompactPayload = Schema.TaggedStruct("DalphJournalCompactPayloadV1", { payload: Payload })

const isObject = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
const isArray = (value: Schema.Json): value is Schema.JsonArray => Array.isArray(value)
const field = (value: Schema.Json | undefined, key: string): Schema.Json | undefined =>
  isObject(value) ? value[key] : undefined

const promotionPlan = (claim: Schema.JsonObject): Schema.Json | undefined =>
  field(field(field(field(claim["promotionCorrelation"], "qualifiedCandidate"), "run"), "session"), "plannedAttempt")

const sameCopy = (left: Schema.Json | undefined, right: Schema.Json | undefined): boolean =>
  left !== undefined && right !== undefined && JSON.stringify(left) === JSON.stringify(right)

const hasSuccessClaimCopy = (kind: JournalEventKind): boolean =>
  kind === "CompletionClaimDeletionIntended" ||
  kind === "CompletionClaimDeletionAttemptIntended" ||
  kind === "CompletionClaimDeleted" ||
  kind === "IntegrationFinalitySettled"

/** The nested promotion already carries this same immutable plan; unequal copies remain evidence. */
const compactValue = (value: Schema.Json): Schema.Json => {
  if (isArray(value)) return value.map(compactValue)
  if (!isObject(value)) return value
  const object =
    value["_tag"] === "CompletionTaskClaim" && sameCopy(value["plannedAttempt"], promotionPlan(value))
      ? (({ plannedAttempt: _copy, ...retained }) => retained)(value)
      : value
  return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, compactValue(child)]))
}

/** Restores only the named copy, from this row's own promotion, before the complete event decoder runs. */
const expandValue = (value: Schema.Json): Schema.Json => {
  if (isArray(value)) return value.map(expandValue)
  if (!isObject(value)) return value
  const object = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expandValue(child)]))
  const plan = promotionPlan(object)
  return object["_tag"] === "CompletionTaskClaim" && object["plannedAttempt"] === undefined && plan !== undefined
    ? { ...object, plannedAttempt: plan }
    : object
}

const compactClaim = (payload: Schema.JsonObject): Schema.JsonObject =>
  sameCopy(payload["claim"], field(payload["successObservation"], "claim"))
    ? (({ claim: _copy, ...retained }) => retained)(payload)
    : payload

const expandClaim = (payload: Schema.JsonObject): Schema.JsonObject => {
  const claim = field(payload["successObservation"], "claim")
  return payload["claim"] === undefined && claim !== undefined ? { ...payload, claim } : payload
}

/** Pure storage encoding: it never changes semantic versions or refers to another row. */
export const encodeJournalStoragePayload = (kind: JournalEventKind, payload: Schema.JsonObject): string => {
  const request = payload["request"]
  const withoutOuterCopy = hasSuccessClaimCopy(kind)
    ? compactClaim(payload)
    : kind === "CompletionClaimDeletionReadObserved" && isObject(request)
      ? { ...payload, request: compactClaim(request) }
      : payload
  const compact = compactValue(withoutOuterCopy)
  const fullJson = JSON.stringify(payload)
  return JSON.stringify(compact) === fullJson
    ? fullJson
    : JSON.stringify(CompactPayload.make({ payload: Schema.decodeUnknownSync(Payload)(compact) }))
}

/** Untagged current full rows remain explicit inputs; missing copies are restored only inside V1. */
export const decodeJournalStoragePayload = Effect.fn("WorkflowJournal.decodeStoragePayload")(function* (
  kind: JournalEventKind,
  payload: Schema.JsonObject
) {
  if (payload["_tag"] === undefined) return payload
  const compact = yield* Schema.decodeUnknownEffect(CompactPayload)(payload, { onExcessProperty: "error" })
  const expanded = yield* Schema.decodeUnknownEffect(Payload)(expandValue(compact.payload))
  const request = expanded["request"]
  return hasSuccessClaimCopy(kind)
    ? expandClaim(expanded)
    : kind === "CompletionClaimDeletionReadObserved" && isObject(request)
      ? { ...expanded, request: expandClaim(request) }
      : expanded
})
