import { Schema } from "effect"
import {
  AuthoredCausalWindow,
  type AuthoredCassetteStoryItem,
  type AuthoredCausalWindow as AuthoredCausalWindowType
} from "./authored-domain.js"
import {
  expandAuthoredOccurrencePlan,
  type AuthoredOccurrenceId,
  type AuthoredOccurrencePlan
} from "./authored-causal-graph.js"

export interface AuthoredCausalBoundaryNode {
  readonly item: AuthoredCassetteStoryItem
  /** The selection node whose exact operation owns this response. */
  readonly ownerRole?: AuthoredOccurrenceId
  readonly graphReadCause?: AuthoredCausalWindowType["occurrences"][number]["graphReadCause"]
}

/** Places a declared partial order in one contiguous authored story segment. */
export const authorCausalWindow = (
  startIndex: number,
  plan: AuthoredOccurrencePlan<AuthoredCausalBoundaryNode>
): { readonly story: ReadonlyArray<AuthoredCassetteStoryItem>; readonly window: AuthoredCausalWindowType } => {
  const occurrences = expandAuthoredOccurrencePlan(plan)
  const window = Schema.decodeUnknownSync(AuthoredCausalWindow)({
    startIndex,
    endIndex: startIndex + occurrences.length,
    occurrences: occurrences.map(({ id, predecessors, value }, offset) => ({
      id,
      storyIndex: startIndex + offset,
      predecessorIds: predecessors,
      ...(value.ownerRole === undefined ? {} : { ownerRole: value.ownerRole }),
      ...(value.graphReadCause === undefined ? {} : { graphReadCause: value.graphReadCause })
    }))
  })
  return { story: occurrences.map(({ value }) => value.item), window }
}

/** Relocates a causal segment when a fixture composes earlier story items around it. */
export const shiftAuthoredCausalWindow = (window: AuthoredCausalWindowType, offset: number): AuthoredCausalWindowType =>
  Schema.decodeUnknownSync(AuthoredCausalWindow)({
    startIndex: window.startIndex + offset,
    endIndex: window.endIndex + offset,
    occurrences: window.occurrences.map((occurrence) => ({ ...occurrence, storyIndex: occurrence.storyIndex + offset }))
  })
