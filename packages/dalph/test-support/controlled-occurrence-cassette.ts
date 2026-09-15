import { Effect } from "effect"
import { runControlledDs13Characterization } from "./controlled-characterization.js"
import type { ControlledObservedOccurrence } from "./controlled-occurrences.js"
import { acceptedOccurrenceOrder, acceptedOccurrenceOrderDigest } from "./controlled-occurrence-cassette-data.js"

/** One accepted semantic boundary occurrence; array position owns its total order. */
export interface ControlledAcceptedOccurrence {
  readonly detail: string
  readonly kind: string
  readonly source: ControlledObservedOccurrence["source"]
}

export type ControlledOccurrenceCassetteMismatch =
  | {
      readonly _tag: "DifferentOccurrence"
      readonly actual: ControlledAcceptedOccurrence
      readonly expected: ControlledAcceptedOccurrence
      readonly position: number
    }
  | { readonly _tag: "InvalidActualSequence"; readonly detail: string; readonly position: number }
  | {
      readonly _tag: "UnconsumedExpectedOccurrence"
      readonly expected: ControlledAcceptedOccurrence
      readonly position: number
    }
  | { readonly _tag: "UnexpectedOccurrence"; readonly actual: ControlledAcceptedOccurrence; readonly position: number }

export type ControlledOccurrenceCassetteResult =
  | { readonly _tag: "AcceptedOccurrenceOrderConsumed"; readonly occurrenceCount: number }
  | { readonly _tag: "OccurrenceOrderMismatch"; readonly mismatch: ControlledOccurrenceCassetteMismatch }

const acceptedSourceSha = "1e6b3f44bacc3cae6945823abc3d3f92e2a7a48d"
const occurrenceIdentity = ({ detail, kind, source }: ControlledAcceptedOccurrence): ControlledAcceptedOccurrence => ({
  detail,
  kind,
  source
})

const identitiesEqual = (left: ControlledAcceptedOccurrence, right: ControlledAcceptedOccurrence): boolean =>
  left.detail === right.detail && left.kind === right.kind && left.source === right.source

const actualSequenceMismatch = (
  observed: ControlledObservedOccurrence,
  position: number,
  nextSourceSequence: Map<ControlledObservedOccurrence["source"], number>
): ControlledOccurrenceCassetteMismatch | undefined => {
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
  expected: ControlledAcceptedOccurrence | undefined,
  observed: ControlledObservedOccurrence | undefined,
  position: number
): ControlledOccurrenceCassetteMismatch | undefined => {
  if (expected === undefined && observed !== undefined) {
    return { _tag: "UnexpectedOccurrence", actual: occurrenceIdentity(observed), position }
  }
  if (expected !== undefined && observed === undefined) {
    return { _tag: "UnconsumedExpectedOccurrence", expected, position }
  }
  return undefined
}

const occurrenceMismatchAt = (
  expected: ControlledAcceptedOccurrence | undefined,
  observed: ControlledObservedOccurrence | undefined,
  position: number,
  nextSourceSequence: Map<ControlledObservedOccurrence["source"], number>
): ControlledOccurrenceCassetteMismatch | undefined => {
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
export const consumeControlledAcceptedOccurrenceOrder = (
  expectedOrder: ReadonlyArray<ControlledAcceptedOccurrence>,
  actual: ReadonlyArray<ControlledObservedOccurrence>
): ControlledOccurrenceCassetteResult => {
  const nextSourceSequence = new Map<ControlledObservedOccurrence["source"], number>()
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
export const acceptedOccurrenceCassette = {
  acceptedOrderDigest: acceptedOccurrenceOrderDigest,
  acceptedSourceSha,
  occurrenceCount: acceptedOccurrenceOrder.length,
  occurrences: acceptedOccurrenceOrder,
  readinessProfile: "R0ThroughR11",
  schemaVersion: 1,
  stop: "DS13Checkpoint"
} as const

export const controlledDeliveryCassetteCatalog = { controlledDs01ThroughDs13: acceptedOccurrenceCassette } as const

/** Runs the unchanged R0-R11 characterization and compares its DS-13 snapshot with the accepted order. */
export const runControlledDeliveryCassette = (
  cassette: (typeof controlledDeliveryCassetteCatalog)["controlledDs01ThroughDs13"]
) =>
  Effect.gen(function* () {
    const characterization = yield* runControlledDs13Characterization
    return {
      cassette,
      characterization,
      consumption: consumeControlledAcceptedOccurrenceOrder(
        cassette.occurrences,
        characterization.occurrenceEvidence.observedOccurrences
      )
    }
  })
