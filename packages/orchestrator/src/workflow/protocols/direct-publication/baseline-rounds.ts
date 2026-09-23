import { Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { journalRecordsOfKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import {
  RemoteBaselineCorrelation,
  RemoteBaselineRound,
  type RemoteBaselineJournalEvent,
  automaticCompetingHeadRemoteBaselineCorrelationFor
} from "./baseline-events.js"
import { deriveRemoteBaselineState, RemoteBaselineState } from "./baseline-state.js"

const lastRecordOffset = -1
const maximumAutomaticSuccessorBaselineRounds = 2

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

export interface AutomaticRemoteBaselineRoundEvidence {
  readonly correlation: RemoteBaselineCorrelation
  readonly completedAt: JournalPosition | undefined
  readonly latestEvidenceAt: JournalPosition | undefined
  readonly readIntentAt: JournalPosition | undefined
  readonly round: RemoteBaselineRound
  readonly state: ReturnType<typeof deriveRemoteBaselineState>
}

/** Reconstructs automatic-successor rounds from their durable read-intent identities. */
export const automaticRemoteBaselineRoundsFor = (
  source: JournalHistorySource,
  firstRoundCorrelation: RemoteBaselineCorrelation
): ReadonlyArray<AutomaticRemoteBaselineRoundEvidence> => {
  const authorizationAt = firstRoundCorrelation.automaticCompetingHeadAuthorizationAt
  if (authorizationAt === undefined) return []
  const eventRecords = [
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
  const authorizedRoundRecords = eventRecords.filter(
    ({ event }) => event.correlation.automaticCompetingHeadAuthorizationAt === authorizationAt
  )
  const rounds = Array.from(
    new Set([
      1,
      ...authorizedRoundRecords.map(({ event }) => Number(event.correlation.automaticCompetingHeadBaselineRound ?? 1))
    ])
  ).sort((left, right) => left - right)
  const contiguousOrdinals = rounds.every((roundNumber, index) => roundNumber === index + 1)
  const withinBound =
    rounds.at(lastRecordOffset) !== undefined &&
    (rounds.at(lastRecordOffset) ?? 1) <= maximumAutomaticSuccessorBaselineRounds
  const correlationEquivalence = Schema.toEquivalence(RemoteBaselineCorrelation)
  return rounds
    .map((roundNumber) => {
      const round = RemoteBaselineRound.make(roundNumber)
      const correlation = automaticCompetingHeadRemoteBaselineCorrelationFor(
        firstRoundCorrelation.runId,
        firstRoundCorrelation.responsibility,
        firstRoundCorrelation.localTarget,
        firstRoundCorrelation.remoteTarget,
        authorizationAt,
        round
      )
      const roundRecords = eventRecords.filter(
        ({ event }) =>
          (event._tag === "RemoteBaselineReadIntended" ||
            event._tag === "RemoteBaselineObserved" ||
            event._tag === "LocalTargetCatchUpIntended" ||
            event._tag === "LocalTargetCatchUpObserved") &&
          event.correlation.baselineId === correlation.baselineId
      )
      const exactRoundBinding = authorizedRoundRecords.every(({ event }) => {
        if (Number(event.correlation.automaticCompetingHeadBaselineRound ?? 1) !== roundNumber) return true
        return correlationEquivalence(event.correlation, correlation)
      })
      const roundReadIntents = roundRecords.filter(({ event }) => event._tag === "RemoteBaselineReadIntended")
      const readIntentAt = roundReadIntents.at(0)?.position
      const validIntentMultiplicity = (roundRecords.length === 0 && roundNumber === 1) || roundReadIntents.length === 1
      let state = deriveRemoteBaselineState(remoteBaselineEventsFor(source, correlation))
      if (!contiguousOrdinals || !withinBound || !exactRoundBinding || !validIntentMultiplicity) {
        state = RemoteBaselineState.cases.Contradiction.make({
          detail: "automatic-successor baseline rounds must be contiguous and exactly correlated"
        })
      }
      const completedAt =
        state._tag === "Ready"
          ? roundRecords
              .filter(
                ({ event }) => event._tag === "RemoteBaselineObserved" || event._tag === "LocalTargetCatchUpObserved"
              )
              .at(lastRecordOffset)?.position
          : undefined
      return {
        correlation,
        completedAt,
        latestEvidenceAt: roundRecords.at(lastRecordOffset)?.position,
        readIntentAt,
        round,
        state
      }
    })
    .map((evidence, index, allRounds) => {
      const priorRound = allRounds[index - 1]
      if (
        priorRound === undefined ||
        evidence.state._tag === "Contradiction" ||
        (Number(evidence.round) === 1 && evidence.readIntentAt === undefined)
      ) {
        return evidence
      }
      if (
        priorRound.state._tag !== "Ready" ||
        priorRound.completedAt === undefined ||
        evidence.readIntentAt === undefined ||
        evidence.readIntentAt <= priorRound.completedAt
      ) {
        return {
          ...evidence,
          state: RemoteBaselineState.cases.Contradiction.make({
            detail: "automatic-successor baseline refresh must follow the exact ready prior round"
          })
        }
      }
      return evidence
    })
}
