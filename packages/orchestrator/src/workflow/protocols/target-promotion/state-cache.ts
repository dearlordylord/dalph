/* eslint-disable functional/immutable-data -- Process-local memo indexes mutate only private maps; promotion state stays journal-derived. */
import { Schema } from "effect"
import { journalPrefixPredecessorOf } from "../../../workflow-journal/prefix-lineage.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  TargetPromotionJournalEvent,
  targetPromotionCorrelationEquals,
  targetPromotionCorrelationFor,
  type TargetPromotionCorrelation
} from "./events.js"
import { deriveTargetPromotionState, type JournalOccurrence, type TargetPromotionState } from "./state.js"

type PromotionStateCacheEntry = readonly [TargetPromotionCorrelation, TargetPromotionState | undefined]

const promotionStateByPrefix = new WeakMap<ReadonlyArray<JournalOccurrence>, Array<PromotionStateCacheEntry>>()

export const deriveTargetPromotionStateFor = (
  records: ReadonlyArray<JournalOccurrence>,
  candidate: IntegratorRunQualifiedCandidate
): TargetPromotionState | undefined => {
  const request = targetPromotionCorrelationFor(candidate)
  const cachedByRequest = promotionStateByPrefix.get(records)
  const cached = cachedByRequest?.find(([cachedRequest]) => targetPromotionCorrelationEquals(cachedRequest, request))
  if (cached !== undefined) return cached[1]
  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor !== undefined && !Schema.is(TargetPromotionJournalEvent)(predecessor.appended.event)) {
    const state = deriveTargetPromotionStateFor(predecessor.prior, candidate)
    const cache = cachedByRequest ?? []
    cache.push([request, state])
    promotionStateByPrefix.set(records, cache)
    return state
  }
  const state = deriveTargetPromotionState(records, request)
  const cache = cachedByRequest ?? []
  cache.push([request, state])
  promotionStateByPrefix.set(records, cache)
  return state
}
