import type {
  CompletionClaimBoundaryResult,
  CompletionClaimProtocolStoryItem
} from "./integration-finality-protocol-cassette-domain.js"

type ClaimState = "Active" | "Completion" | "Foreign" | "MarkerAbsent" | "Unclaimed"
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
  ["Deletion:MarkerAbsent:ReadCompletionMarkerAbsent", "Success"]
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
  phase === "Replacement" ? "Completion" : "MarkerAbsent"

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

const consumeDeletionAuthorizationRead = (
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): readonly [BoundaryScriptCursor, boolean] | undefined => {
  const read = results[cursor.index]
  if (read === undefined) return undefined
  const disposition = readDisposition("Deletion", cursor.state, read)
  if (disposition === undefined) return undefined
  return [{ ...cursor, index: cursor.index + 1 }, disposition === "Mutate"]
}

const consumeAppliedDeletionObservation = (
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): BoundaryScriptCursor | undefined => {
  const read = results[cursor.index]
  return read !== undefined && readDisposition("Deletion", cursor.state, read) === "Success"
    ? { ...cursor, index: cursor.index + 1 }
    : undefined
}

interface ProtocolPhaseStart {
  readonly cursor: BoundaryScriptCursor
  readonly continues: boolean
}

const beginProtocolPhase = (
  phase: ProtocolPhase,
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): ProtocolPhaseStart | undefined => {
  if (phase === "Replacement") return { continues: true, cursor }
  const authorized = consumeDeletionAuthorizationRead(cursor, results)
  return authorized === undefined ? undefined : { continues: authorized[1], cursor: authorized[0] }
}

type ProtocolPhaseStep =
  | { readonly _tag: "Complete"; readonly cursor: BoundaryScriptCursor }
  | { readonly _tag: "Continue"; readonly attempts: number; readonly cursor: BoundaryScriptCursor }

const appliedMutationStep = (
  phase: ProtocolPhase,
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): ProtocolPhaseStep | undefined => {
  const completed = phase === "Deletion" ? consumeAppliedDeletionObservation(cursor, results) : cursor
  return completed === undefined ? undefined : { _tag: "Complete", cursor: completed }
}

const consumeProtocolPhaseStep = (
  phase: ProtocolPhase,
  cursor: BoundaryScriptCursor,
  attempts: number,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): ProtocolPhaseStep | undefined => {
  const read = results[cursor.index]
  if (read === undefined) return undefined
  const disposition = readDisposition(phase, cursor.state, read)
  if (disposition === undefined) return undefined
  const afterRead = { ...cursor, index: cursor.index + 1 }
  if (readEndsPhase(disposition, attempts)) return { _tag: "Complete", cursor: afterRead }
  const consumed = consumeMutation(phase, afterRead, results)
  if (consumed === undefined) return undefined
  const [afterMutation, mutationResult] = consumed
  if (mutationResult === "Applied") return appliedMutationStep(phase, afterMutation, results)
  if (mutationResult === "Failed") return { _tag: "Complete", cursor: afterMutation }
  return { _tag: "Continue", attempts: attempts + 1, cursor: afterMutation }
}

const consumeProtocolPhase = (
  phase: ProtocolPhase,
  cursor: BoundaryScriptCursor,
  results: ReadonlyArray<CompletionClaimBoundaryResult>
): BoundaryScriptCursor | undefined => {
  const start = beginProtocolPhase(phase, cursor, results)
  if (start === undefined) return undefined
  if (!start.continues) return start.cursor
  let next = start.cursor
  let attempts = 0
  for (let readOrdinal = 0; readOrdinal <= completionClaimMutationLimit; readOrdinal += 1) {
    const step = consumeProtocolPhaseStep(phase, next, attempts, results)
    if (step === undefined) return undefined
    if (step._tag === "Complete") return step.cursor
    next = step.cursor
    attempts = step.attempts
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
  story.filter(({ _tag }) => _tag === "ObserveFocusedTaskCompletionSuccess").length <= 1

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
