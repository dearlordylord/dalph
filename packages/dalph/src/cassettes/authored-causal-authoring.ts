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
