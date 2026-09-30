import { Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { journalRecordsOfKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import {
  type AutomaticCompetingHeadRemoteBaselineCorrelation,
  maximumAutomaticSuccessorBaselineRound,
  RemoteBaselineCorrelation,
  RemoteBaselineRound,
  initialAutomaticCompetingHeadBaselineRound,
  type RemoteBaselineJournalEvent,
  automaticCompetingHeadRemoteBaselineCorrelationFor
} from "./baseline-events.js"
import { deriveRemoteBaselineState, RemoteBaselineState } from "./baseline-state.js"

const lastRecordOffset = -1

type AutomaticBaselineRecord = { readonly position: JournalPosition; readonly event: RemoteBaselineJournalEvent }

export const remoteBaselineEventsFor = (
  source: JournalHistorySource,
  correlation: RemoteBaselineCorrelation
): ReadonlyArray<RemoteBaselineJournalEvent> =>
  [
    ...journalRecordsOfKind(source, "RemoteBaselineReadIntended"),
    ...journalRecordsOfKind(source, "RemoteBaselineObserved"),
    ...journalRecordsOfKind(source, "LocalTargetCatchUpIntended"),
    ...journalRecordsOfKind(source, "LocalTargetCatchUpObserved")
  ]
    .sort((left, right) => Number(left.position) - Number(right.position))
    .flatMap(({ event }) =>
      (event._tag === "RemoteBaselineReadIntended" ||
        event._tag === "RemoteBaselineObserved" ||
        event._tag === "LocalTargetCatchUpIntended" ||
        event._tag === "LocalTargetCatchUpObserved") &&
      event.correlation.baselineId === correlation.baselineId
        ? [event]
        : []
    )

type DerivedRemoteBaselineState = ReturnType<typeof deriveRemoteBaselineState>

export type AutomaticRemoteBaselineRoundState =
  | (Extract<DerivedRemoteBaselineState, { readonly _tag: "Ready" }> & { readonly completedAt: JournalPosition })
  | (Exclude<DerivedRemoteBaselineState, { readonly _tag: "Ready" }> & { readonly completedAt?: never })

export interface AutomaticRemoteBaselineRoundEvidence {
  readonly correlation: AutomaticCompetingHeadRemoteBaselineCorrelation
  readonly latestEvidenceAt: JournalPosition | undefined
  readonly readIntentAt: JournalPosition | undefined
  readonly round: RemoteBaselineRound
  readonly state: AutomaticRemoteBaselineRoundState
}

const automaticBaselineEventRecordsFor = (source: JournalHistorySource): ReadonlyArray<AutomaticBaselineRecord> =>
  [
    ...journalRecordsOfKind(source, "RemoteBaselineReadIntended"),
    ...journalRecordsOfKind(source, "RemoteBaselineObserved"),
    ...journalRecordsOfKind(source, "LocalTargetCatchUpIntended"),
    ...journalRecordsOfKind(source, "LocalTargetCatchUpObserved")
  ]
    .flatMap(({ event, position }) =>
      event._tag === "RemoteBaselineReadIntended" ||
      event._tag === "RemoteBaselineObserved" ||
      event._tag === "LocalTargetCatchUpIntended" ||
      event._tag === "LocalTargetCatchUpObserved"
        ? [{ position, event }]
        : []
    )
    .sort((left, right) => Number(left.position) - Number(right.position))

const automaticAuthorizedBaselineRecordsFor = (
  records: ReadonlyArray<AutomaticBaselineRecord>,
  authorizationAt: JournalPosition
): ReadonlyArray<AutomaticBaselineRecord> =>
  records.filter(
    ({ event }) =>
      event.correlation._tag === "AutomaticCompetingHead" && event.correlation.authorizationAt === authorizationAt
  )

const exactAutomaticRoundBinding = (
  authorizedRecords: ReadonlyArray<AutomaticBaselineRecord>,
  roundNumber: number,
  correlation: AutomaticCompetingHeadRemoteBaselineCorrelation
): boolean => {
  const correlationEquivalence = Schema.toEquivalence(RemoteBaselineCorrelation)
  return authorizedRecords.every(
    ({ event }) =>
      event.correlation._tag !== "AutomaticCompetingHead" ||
      Number(event.correlation.baselineRound) !== roundNumber ||
      correlationEquivalence(event.correlation, correlation)
  )
}

const automaticBaselineRoundStateFor = (
  source: JournalHistorySource,
  correlation: AutomaticCompetingHeadRemoteBaselineCorrelation,
  records: ReadonlyArray<AutomaticBaselineRecord>,
  authorizedRecords: ReadonlyArray<AutomaticBaselineRecord>,
  roundNumber: number,
  ordinalSequenceValid: boolean,
  latestRoundWithinBound: boolean
): ReturnType<typeof deriveRemoteBaselineState> => {
  const exactRoundBinding = exactAutomaticRoundBinding(authorizedRecords, roundNumber, correlation)
  const roundRecords = records.filter(({ event }) => event.correlation.baselineId === correlation.baselineId)
  const roundReadIntents = roundRecords.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")
  const validIntentMultiplicity =
    (roundRecords.length === 0 && roundNumber === Number(initialAutomaticCompetingHeadBaselineRound)) ||
    roundReadIntents.length === 1
  const state = deriveRemoteBaselineState(remoteBaselineEventsFor(source, correlation))
  return ordinalSequenceValid && latestRoundWithinBound && exactRoundBinding && validIntentMultiplicity
    ? state
    : RemoteBaselineState.cases.Contradiction.make({
        detail: "automatic-successor baseline rounds must be contiguous and exactly correlated"
      })
}

const automaticBaselineRoundEvidenceFor = (
  source: JournalHistorySource,
  firstRoundCorrelation: AutomaticCompetingHeadRemoteBaselineCorrelation,
  authorizationAt: JournalPosition,
  records: ReadonlyArray<AutomaticBaselineRecord>,
  authorizedRecords: ReadonlyArray<AutomaticBaselineRecord>,
  roundNumber: number,
  ordinalSequenceValid: boolean,
  latestRoundWithinBound: boolean
): AutomaticRemoteBaselineRoundEvidence => {
  const round = RemoteBaselineRound.make(roundNumber)
  const correlation = automaticCompetingHeadRemoteBaselineCorrelationFor(
    firstRoundCorrelation.runId,
    firstRoundCorrelation.responsibility,
    firstRoundCorrelation.localTarget,
    firstRoundCorrelation.remoteTarget,
    authorizationAt,
    round
  )
  const roundRecords = records.filter(({ event }) => event.correlation.baselineId === correlation.baselineId)
  const readIntentAt = roundRecords.find(({ event }) => event._tag === "RemoteBaselineReadIntended")?.position
  const state = automaticBaselineRoundStateFor(
    source,
    correlation,
    records,
    authorizedRecords,
    roundNumber,
    ordinalSequenceValid,
    latestRoundWithinBound
  )
  const fields = { correlation, latestEvidenceAt: roundRecords.at(lastRecordOffset)?.position, readIntentAt, round }
  if (state._tag !== "Ready") return { ...fields, state }
  const completedAt = roundRecords
    .filter(({ event }) => event._tag === "RemoteBaselineObserved" || event._tag === "LocalTargetCatchUpObserved")
    .at(lastRecordOffset)?.position
  return completedAt === undefined
    ? {
        ...fields,
        state: RemoteBaselineState.cases.Contradiction.make({
          detail: "ready automatic-successor baseline round must have an exact completion position"
        })
      }
    : { ...fields, state: { ...state, completedAt } }
}

const validateAutomaticRoundRefreshOrder = (
  evidence: AutomaticRemoteBaselineRoundEvidence,
  previous: AutomaticRemoteBaselineRoundEvidence | undefined
): AutomaticRemoteBaselineRoundEvidence => {
  if (previous === undefined || evidence.state._tag === "Contradiction") return evidence
  if (
    previous.state._tag === "Ready" &&
    evidence.readIntentAt !== undefined &&
    evidence.readIntentAt > previous.state.completedAt
  ) {
    return evidence
  }
  return {
    correlation: evidence.correlation,
    latestEvidenceAt: evidence.latestEvidenceAt,
    readIntentAt: evidence.readIntentAt,
    round: evidence.round,
    state: RemoteBaselineState.cases.Contradiction.make({
      detail: "automatic-successor baseline refresh must follow the exact ready prior round"
    })
  }
}

/** Reconstructs automatic-successor rounds from their durable read-intent identities. */
export const automaticRemoteBaselineRoundsFor = (
  source: JournalHistorySource,
  firstRoundCorrelation: AutomaticCompetingHeadRemoteBaselineCorrelation
): ReadonlyArray<AutomaticRemoteBaselineRoundEvidence> => {
  const authorizationAt = firstRoundCorrelation.authorizationAt
  const eventRecords = automaticBaselineEventRecordsFor(source)
  const authorizedRoundRecords = automaticAuthorizedBaselineRecordsFor(eventRecords, authorizationAt)
  const observedRoundNumbers = authorizedRoundRecords.flatMap(({ event }) =>
    event.correlation._tag === "AutomaticCompetingHead" ? [Number(event.correlation.baselineRound)] : []
  )
  const rounds = Array.from(
    new Set([Number(initialAutomaticCompetingHeadBaselineRound), ...observedRoundNumbers])
  ).sort((left, right) => left - right)
  const contiguousOrdinals = rounds.every((roundNumber, index) => roundNumber === index + 1)
  const latestRoundNumber = rounds.at(lastRecordOffset)
  const withinBound =
    latestRoundNumber !== undefined && latestRoundNumber <= Number(maximumAutomaticSuccessorBaselineRound)
  return rounds
    .map((roundNumber) =>
      automaticBaselineRoundEvidenceFor(
        source,
        firstRoundCorrelation,
        authorizationAt,
        eventRecords,
        authorizedRoundRecords,
        roundNumber,
        contiguousOrdinals,
        withinBound
      )
    )
    .map((evidence, index, allRounds) => validateAutomaticRoundRefreshOrder(evidence, allRounds[index - 1]))
}
