import { Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { RunId } from "@dalph/contracts"
import { WorkflowActor } from "../../registry/actor.js"
import {
  TargetPromotionAttemptLimit,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCorrelation,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionReconciliationDeferral,
  TargetPromotionStaleObservation,
  TargetPromotionSuccessObservation,
  TargetPromotionTerminalBasis
} from "./events.js"

const initiatedByCoordinator = {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}

const nonAction = { occurrenceClassification: Schema.Literal("NonActionOccurrence") }

/** Dalph recorded the deterministic promotion request before any Git mutation. */
export const TargetPromotionRequested = Schema.TaggedStruct("TargetPromotionRequested", {
  ...initiatedByCoordinator,
  correlation: TargetPromotionCorrelation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionRequested = typeof TargetPromotionRequested.Type

/** Dalph recorded one numbered compare-and-set attempt before asking Git. */
export const TargetPromotionAttemptRequested = Schema.TaggedStruct("TargetPromotionAttemptRequested", {
  ...initiatedByCoordinator,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  reason: TargetPromotionAttemptReason,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionAttemptRequested = typeof TargetPromotionAttemptRequested.Type

/** One ambiguous promotion attempt is durably idle until exact retry authority returns. */
export const TargetPromotionReconciliationDeferred = Schema.TaggedStruct("TargetPromotionReconciliationDeferred", {
  afterAttemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  deferral: TargetPromotionReconciliationDeferral,
  ...nonAction,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionReconciliationDeferred = typeof TargetPromotionReconciliationDeferred.Type

/** Git proved the qualified candidate current or in target ancestry. */
export const TargetPromotionSucceeded = Schema.TaggedStruct("TargetPromotionSucceeded", {
  basis: TargetPromotionTerminalBasis,
  ...nonAction,
  correlation: TargetPromotionCorrelation,
  observation: TargetPromotionSuccessObservation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionSucceeded = typeof TargetPromotionSucceeded.Type

/** Git proved the expected head or candidate ancestry was stale. */
export const TargetPromotionStale = Schema.TaggedStruct("TargetPromotionStale", {
  basis: TargetPromotionTerminalBasis,
  ...nonAction,
  correlation: TargetPromotionCorrelation,
  observation: TargetPromotionStaleObservation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionStale = typeof TargetPromotionStale.Type

/** Three unresolved promotion attempts preserved the candidate and evidence. */
export const TargetPromotionNonConvergent = Schema.TaggedStruct("TargetPromotionNonConvergent", {
  attemptLimit: TargetPromotionAttemptLimit,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  lastObservation: TargetPromotionNonConvergenceObservation,
  ...nonAction,
  recordedAt: JournalPosition,
  runId: RunId
})
export type TargetPromotionNonConvergent = typeof TargetPromotionNonConvergent.Type
