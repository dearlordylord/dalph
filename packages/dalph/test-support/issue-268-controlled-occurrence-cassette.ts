import { Effect } from "effect"
import { runIssue268Ds13Characterization } from "./issue-268-controlled-characterization.js"
import type { Issue268ObservedOccurrence } from "./issue-268-controlled-occurrences.js"
import {
  issue268AcceptedOccurrenceOrder,
  issue268AcceptedOccurrenceOrderDigest
} from "./issue-268-controlled-occurrence-cassette-data.js"

/** One accepted semantic boundary occurrence; array position owns its total order. */
export interface Issue268AcceptedOccurrence {
  readonly detail: string
  readonly kind: string
  readonly source: Issue268ObservedOccurrence["source"]
}

export type Issue268OccurrenceCassetteMismatch =
  | {
      readonly _tag: "DifferentOccurrence"
      readonly actual: Issue268AcceptedOccurrence
      readonly expected: Issue268AcceptedOccurrence
      readonly position: number
    }
  | { readonly _tag: "InvalidActualSequence"; readonly detail: string; readonly position: number }
  | {
      readonly _tag: "UnconsumedExpectedOccurrence"
      readonly expected: Issue268AcceptedOccurrence
      readonly position: number
    }
  | { readonly _tag: "UnexpectedOccurrence"; readonly actual: Issue268AcceptedOccurrence; readonly position: number }

export type Issue268OccurrenceCassetteResult =
  | { readonly _tag: "AcceptedOccurrenceOrderConsumed"; readonly occurrenceCount: number }
  | { readonly _tag: "OccurrenceOrderMismatch"; readonly mismatch: Issue268OccurrenceCassetteMismatch }

const acceptedSourceSha = "7100fe3af2103bba753e089e8ec78279c5426eb5"
const occurrenceIdentity = ({ detail, kind, source }: Issue268AcceptedOccurrence): Issue268AcceptedOccurrence => ({
  detail,
  kind,
  source
})

const identitiesEqual = (left: Issue268AcceptedOccurrence, right: Issue268AcceptedOccurrence): boolean =>
  left.detail === right.detail && left.kind === right.kind && left.source === right.source

const actualSequenceMismatch = (
  observed: Issue268ObservedOccurrence,
  position: number,
  nextSourceSequence: Map<Issue268ObservedOccurrence["source"], number>
): Issue268OccurrenceCassetteMismatch | undefined => {
  if (observed.ordinal !== position) {
    return {
      _tag: "InvalidActualSequence",
      detail: `expected global ordinal ${position}, received ${observed.ordinal}`,
      position
    }
  }
  const expectedSourceSequence = (nextSourceSequence.get(observed.source) ?? 0) + 1
  if (observed.sourceSequence !== expectedSourceSequence) {
    return {
      _tag: "InvalidActualSequence",
      detail: `expected ${observed.source} source sequence ${expectedSourceSequence}, received ${observed.sourceSequence}`,
      position
    }
  }
  // eslint-disable-next-line functional/immutable-data -- One bounded local cursor validates per-source order in O(n).
  nextSourceSequence.set(observed.source, expectedSourceSequence)
  return undefined
}

const presenceMismatch = (
  expected: Issue268AcceptedOccurrence | undefined,
  observed: Issue268ObservedOccurrence | undefined,
  position: number
): Issue268OccurrenceCassetteMismatch | undefined => {
  if (expected === undefined && observed !== undefined) {
    return { _tag: "UnexpectedOccurrence", actual: occurrenceIdentity(observed), position }
  }
  if (expected !== undefined && observed === undefined) {
    return { _tag: "UnconsumedExpectedOccurrence", expected, position }
  }
  return undefined
}

const occurrenceMismatchAt = (
  expected: Issue268AcceptedOccurrence | undefined,
  observed: Issue268ObservedOccurrence | undefined,
  position: number,
  nextSourceSequence: Map<Issue268ObservedOccurrence["source"], number>
): Issue268OccurrenceCassetteMismatch | undefined => {
  const absent = presenceMismatch(expected, observed, position)
  if (absent !== undefined) return absent
  if (expected === undefined || observed === undefined) return undefined
  const invalid = actualSequenceMismatch(observed, position, nextSourceSequence)
  if (invalid !== undefined) return invalid
  return identitiesEqual(expected, observed)
    ? undefined
    : { _tag: "DifferentOccurrence", actual: occurrenceIdentity(observed), expected, position }
}

/**
 * Compare-only C3 cassette. It observes the completed controlled run and cannot
 * authorize, delay, reorder, or otherwise influence production execution.
 */
export const consumeIssue268AcceptedOccurrenceOrder = (
  expectedOrder: ReadonlyArray<Issue268AcceptedOccurrence>,
  actual: ReadonlyArray<Issue268ObservedOccurrence>
): Issue268OccurrenceCassetteResult => {
  const nextSourceSequence = new Map<Issue268ObservedOccurrence["source"], number>()
  const comparedLength = Math.max(actual.length, expectedOrder.length)
  for (let index = 0; index < comparedLength; index++) {
    const expected = expectedOrder[index]
    const observed = actual[index]
    const position = index + 1
    const mismatch = occurrenceMismatchAt(expected, observed, position, nextSourceSequence)
    if (mismatch !== undefined) return { _tag: "OccurrenceOrderMismatch", mismatch }
  }
  return { _tag: "AcceptedOccurrenceOrderConsumed", occurrenceCount: actual.length }
}

/** Maintained provenance for the exact C2b observation accepted as the C3 oracle. */
export const issue268AcceptedOccurrenceCassette = {
  acceptedOrderDigest: issue268AcceptedOccurrenceOrderDigest,
  acceptedSourceSha,
  occurrenceCount: issue268AcceptedOccurrenceOrder.length,
  occurrences: issue268AcceptedOccurrenceOrder,
  readinessProfile: "R0ThroughR11",
  schemaVersion: 1,
  stop: "DS13Checkpoint"
} as const

export const issue268ControlledDeliveryCassetteCatalog = {
  issue268Ds01ThroughDs13: issue268AcceptedOccurrenceCassette
} as const

/** Runs the unchanged R0-R11 characterization and compares its DS-13 snapshot with the accepted order. */
export const runIssue268ControlledDeliveryCassette = (
  cassette: (typeof issue268ControlledDeliveryCassetteCatalog)["issue268Ds01ThroughDs13"]
) =>
  Effect.gen(function* () {
    const characterization = yield* runIssue268Ds13Characterization
    return {
      cassette,
      characterization,
      consumption: consumeIssue268AcceptedOccurrenceOrder(
        cassette.occurrences,
        characterization.occurrenceEvidence.observedOccurrences
      )
    }
  })
