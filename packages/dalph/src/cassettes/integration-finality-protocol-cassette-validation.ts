import type {
  CompletionClaimBoundaryResult,
  CompletionClaimProtocolStoryItem
} from "./integration-finality-protocol-cassette-domain.js"

type ClaimState = "Active" | "Completion" | "Foreign" | "Unclaimed"
type ProtocolPhase = "Deletion" | "Replacement"
type ReadDisposition = "Conflict" | "Failure" | "Mutate" | "Success"
interface BoundaryScriptCursor {
  readonly index: number
  readonly state: ClaimState
}

const completionClaimMutationLimit = 3
const readDispositionByPhaseAndState: ReadonlyMap<string, ReadDisposition> = new Map([
  ["Replacement:Foreign:ReadForeignClaim", "Conflict"],
  ["Replacement:Foreign:ReadActiveClaim", "Conflict"],
  ["Replacement:Active:ReadActiveClaim", "Mutate"],
  ["Replacement:Completion:ReadCompletionClaim", "Success"],
  ["Replacement:Unclaimed:ReadUnclaimed", "Conflict"],
  ["Deletion:Foreign:ReadForeignClaim", "Conflict"],
  ["Deletion:Foreign:ReadActiveClaim", "Conflict"],
  ["Deletion:Active:ReadActiveClaim", "Conflict"],
  ["Deletion:Completion:ReadCompletionClaim", "Mutate"],
  ["Deletion:Unclaimed:ReadUnclaimed", "Success"]
])

const readDisposition = (
  phase: ProtocolPhase,
  state: ClaimState,
  result: CompletionClaimBoundaryResult
): ReadDisposition | undefined => {
  if (result._tag === "ReadFailed") return "Failure"
  return readDispositionByPhaseAndState.get(`${phase}:${state}:${result._tag}`)
}

const mutationDisposition = (
  phase: ProtocolPhase,
  result: CompletionClaimBoundaryResult
): "Applied" | "Failed" | "Unknown" | "UnknownApplied" => {
  if (result._tag === `${phase}Applied`) return "Applied"
  if (result._tag === `${phase}UnknownApplied`) return "UnknownApplied"
  if (result._tag === `${phase}Unknown`) return "Unknown"
  return "Failed"
}

const stateAfterAppliedMutation = (phase: ProtocolPhase): ClaimState =>
  phase === "Replacement" ? "Completion" : "Unclaimed"

const consumeMutation = (
  phase: ProtocolPhase,
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): readonly [BoundaryScriptCursor, ReturnType<typeof mutationDisposition>] | undefined => {
  const mutation = results[cursor.index]
  if (mutation === undefined || !mutation._tag.startsWith(phase)) return undefined
  const disposition = mutationDisposition(phase, mutation)
  const state =
    disposition === "Applied" || disposition === "UnknownApplied" ? stateAfterAppliedMutation(phase) : cursor.state
  return [{ index: cursor.index + 1, state }, disposition]
}

const readEndsPhase = (disposition: ReadDisposition, attempts: number): boolean =>
  disposition !== "Mutate" || attempts === completionClaimMutationLimit

const consumeProtocolPhase = (
  phase: ProtocolPhase,
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): BoundaryScriptCursor | undefined => {
  let next = cursor
  let attempts = 0
  for (let readOrdinal = 0; readOrdinal <= completionClaimMutationLimit; readOrdinal += 1) {
    const read = results[next.index]
    if (read === undefined) return undefined
    const disposition = readDisposition(phase, next.state, read)
    if (disposition === undefined) return undefined
    next = { ...next, index: next.index + 1 }
    if (readEndsPhase(disposition, attempts)) return next
    const consumed = consumeMutation(phase, next, results)
    if (consumed === undefined) return undefined
    attempts += 1
    const [afterMutation, mutationResult] = consumed
    next = afterMutation
    if (mutationResult === "Applied" || mutationResult === "Failed") return next
  }
  return undefined
}

const isReplacementStep = (item: CompletionClaimProtocolStoryItem): boolean =>
  item._tag === "RunReplacement" || item._tag === "RestartReplacement"

const isDeletionStep = (item: CompletionClaimProtocolStoryItem): boolean =>
  item._tag === "RunDeletion" || item._tag === "RestartDeletion"

const phaseForStoryItem = (item: CompletionClaimProtocolStoryItem): ProtocolPhase | undefined => {
  if (isReplacementStep(item)) return "Replacement"
  if (isDeletionStep(item)) return "Deletion"
  return undefined
}

const storyCardinalityIsValid = (story: ReadonlyArray<CompletionClaimProtocolStoryItem>): boolean =>
  story.filter(isReplacementStep).length <= 1 &&
  story.filter(isDeletionStep).length <= 1 &&
  story.filter(({ _tag }) => _tag === "RecordFreshSuccess").length <= 1

export const boundaryScriptMatchesStory = (
  initialClaim: ClaimState,
  story: ReadonlyArray<CompletionClaimProtocolStoryItem>,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): boolean => {
  if (!storyCardinalityIsValid(story)) return false
  let cursor: BoundaryScriptCursor | undefined = { index: 0, state: initialClaim }
  for (const item of story) {
    if (cursor === undefined) return false
    const phase = phaseForStoryItem(item)
    if (phase !== undefined) cursor = consumeProtocolPhase(phase, cursor, results)
  }
  return cursor !== undefined && cursor.index === results.length
}
