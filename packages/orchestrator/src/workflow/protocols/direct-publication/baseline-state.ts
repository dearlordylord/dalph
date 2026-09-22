import { GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"
import {
  RemoteBaselineCorrelation,
  RemoteBaselineFailureReason,
  type RemoteBaselineJournalEvent,
  RemoteBaselineObservation
} from "./baseline-events.js"

export const RemoteBaselineState = Schema.TaggedUnion({
  Absent: {},
  CatchUpPending: { correlation: RemoteBaselineCorrelation, expectedLocalHead: GitCommitSha, remoteHead: GitCommitSha },
  CatchUpRequired: {
    correlation: RemoteBaselineCorrelation,
    expectedLocalHead: GitCommitSha,
    remoteHead: GitCommitSha
  },
  Contradiction: { detail: Schema.String },
  Ready: { correlation: RemoteBaselineCorrelation, remoteHead: GitCommitSha },
  Retained: {
    correlation: RemoteBaselineCorrelation,
    cause: Schema.TaggedUnion({
      CatchUpUnavailable: { reason: RemoteBaselineFailureReason },
      UnsafeObservation: { observation: RemoteBaselineObservation }
    })
  },
  ReadPending: { correlation: RemoteBaselineCorrelation }
})
export type RemoteBaselineState = typeof RemoteBaselineState.Type

const correlationEquals = Schema.toEquivalence(RemoteBaselineCorrelation)
const observedEventCount = 2
const completedCatchUpEventCount = 4

/** Reduces the exact initial baseline chronology without inferring local mutation from missing evidence. */
export const deriveRemoteBaselineState = (events: ReadonlyArray<RemoteBaselineJournalEvent>): RemoteBaselineState => {
  if (events.length === 0) return RemoteBaselineState.cases.Absent.make({})
  const readIntent = events[0]
  if (readIntent?._tag !== "RemoteBaselineReadIntended") {
    return RemoteBaselineState.cases.Contradiction.make({ detail: "baseline history must begin with read intent" })
  }
  if (events.some((event) => !correlationEquals(event.correlation, readIntent.correlation))) {
    return RemoteBaselineState.cases.Contradiction.make({ detail: "baseline history mixes distinct correlations" })
  }
  const observations = events.filter((event) => event._tag === "RemoteBaselineObserved")
  if (observations.length === 0) {
    return events.length === 1
      ? RemoteBaselineState.cases.ReadPending.make({ correlation: readIntent.correlation })
      : RemoteBaselineState.cases.Contradiction.make({ detail: "catch-up evidence precedes baseline observation" })
  }
  if (observations.length !== 1 || events[1]?._tag !== "RemoteBaselineObserved") {
    return RemoteBaselineState.cases.Contradiction.make({ detail: "baseline requires one exact read observation" })
  }
  const observation = observations[0]?.observation
  if (observation === undefined) {
    return RemoteBaselineState.cases.Contradiction.make({ detail: "baseline observation is missing" })
  }
  if (observation._tag === "Aligned") {
    return events.length === observedEventCount && observation.localHead === observation.remoteHead
      ? RemoteBaselineState.cases.Ready.make({
          correlation: readIntent.correlation,
          remoteHead: observation.remoteHead
        })
      : RemoteBaselineState.cases.Contradiction.make({ detail: "aligned baseline must name one exact head" })
  }
  if (observation._tag !== "LocalAncestor") {
    return events.length === observedEventCount
      ? RemoteBaselineState.cases.Retained.make({
          cause: { _tag: "UnsafeObservation", observation },
          correlation: readIntent.correlation
        })
      : RemoteBaselineState.cases.Contradiction.make({ detail: "unsafe baseline relation cannot authorize catch-up" })
  }
  const intent = events[2]
  if (intent === undefined) {
    return RemoteBaselineState.cases.CatchUpRequired.make({
      correlation: readIntent.correlation,
      expectedLocalHead: observation.localHead,
      remoteHead: observation.remoteHead
    })
  }
  if (
    intent._tag !== "LocalTargetCatchUpIntended" ||
    intent.expectedLocalHead !== observation.localHead ||
    intent.remoteHead !== observation.remoteHead
  ) {
    return RemoteBaselineState.cases.Contradiction.make({ detail: "catch-up intent does not bind the observed heads" })
  }
  const result = events[3]
  if (result === undefined) {
    return RemoteBaselineState.cases.CatchUpPending.make({
      correlation: readIntent.correlation,
      expectedLocalHead: intent.expectedLocalHead,
      remoteHead: intent.remoteHead
    })
  }
  if (
    result._tag !== "LocalTargetCatchUpObserved" ||
    events.length !== completedCatchUpEventCount ||
    result.expectedLocalHead !== intent.expectedLocalHead ||
    result.remoteHead !== intent.remoteHead
  ) {
    return RemoteBaselineState.cases.Contradiction.make({ detail: "catch-up result does not bind its exact intent" })
  }
  const applied = result.result
  if (
    (applied._tag === "Applied" && applied.newHead === intent.remoteHead) ||
    (applied._tag === "AlreadyCurrent" && applied.currentHead === intent.remoteHead)
  ) {
    return RemoteBaselineState.cases.Ready.make({ correlation: readIntent.correlation, remoteHead: intent.remoteHead })
  }
  return applied._tag === "Rejected"
    ? RemoteBaselineState.cases.Retained.make({
        cause: {
          _tag: "UnsafeObservation",
          observation: RemoteBaselineObservation.cases.Diverged.make({
            localHead: applied.observedHead,
            remoteHead: intent.remoteHead
          })
        },
        correlation: readIntent.correlation
      })
    : applied._tag === "Unavailable"
      ? RemoteBaselineState.cases.Retained.make({
          cause: { _tag: "CatchUpUnavailable", reason: applied.reason },
          correlation: readIntent.correlation
        })
      : RemoteBaselineState.cases.Contradiction.make({ detail: "catch-up success names a foreign head" })
}
