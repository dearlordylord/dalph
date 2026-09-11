/* eslint-disable functional/immutable-data -- Process-local memo indexes mutate only private maps; promotion state stays journal-derived. */
import {
  journalRecordsForPromotionRequest,
  type JournalRecordEvidence
} from "../../../workflow-journal/record-evidence.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  targetPromotionCorrelationEquals,
  targetPromotionCorrelationFor,
  type TargetPromotionCorrelation
} from "./events.js"
import { deriveTargetPromotionState, type JournalOccurrence, type TargetPromotionState } from "./state.js"

type PromotionStateCacheEntry = readonly [TargetPromotionCorrelation, TargetPromotionState | undefined]

const promotionStateByPrefix = new WeakMap<object, Array<PromotionStateCacheEntry>>()

export const deriveTargetPromotionStateFor = (
  records: ReadonlyArray<JournalOccurrence> | JournalRecordEvidence,
  candidate: IntegratorRunQualifiedCandidate
): TargetPromotionState | undefined => {
  const request = targetPromotionCorrelationFor(candidate)
  const cachedByRequest = promotionStateByPrefix.get(records)
  const cached = cachedByRequest?.find(([cachedRequest]) => targetPromotionCorrelationEquals(cachedRequest, request))
  if (cached !== undefined) return cached[1]
  // An accepted request has at most three promotion attempts. Its exact bucket
  // includes conflicting correlations without exporting unrelated Run history.
  const relevant =
    "records" in records ? Array.from(journalRecordsForPromotionRequest(records, request.requestId)) : records
  const state = deriveTargetPromotionState(relevant, request)
  const cache = cachedByRequest ?? []
  cache.push([request, state])
  promotionStateByPrefix.set(records, cache)
  return state
}
