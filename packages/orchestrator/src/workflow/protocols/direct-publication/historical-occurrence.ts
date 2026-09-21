import { GitCommitSha, RemotePublicationTarget, RunId } from "@dalph/contracts"
import { Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  RemotePublicationAdmissionId,
  RemotePublicationAdmissionObservation,
  RemotePublicationAttemptOrdinal,
  RemotePublicationCorrelation,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause
} from "./events.js"
import { LocalTargetCatchUpResult, RemoteBaselineCorrelation, RemoteBaselineObservation } from "./baseline-events.js"

const initiatedByCoordinator = {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}

const nonAction = { occurrenceClassification: Schema.Literal("NonActionOccurrence") }

/** The coordinator recorded the destination read required before publication work. */
export const RemotePublicationAdmissionReadInitiated = Schema.TaggedStruct("RemotePublicationAdmissionReadInitiated", {
  ...initiatedByCoordinator,
  admissionId: RemotePublicationAdmissionId,
  recordedAt: JournalPosition,
  runId: RunId,
  target: RemotePublicationTarget
})
export type RemotePublicationAdmissionReadInitiated = typeof RemotePublicationAdmissionReadInitiated.Type

/** Git returned the complete preclaim destination fact for the pinned Run target. */
export const RemotePublicationAdmissionObserved = Schema.TaggedStruct("RemotePublicationAdmissionObserved", {
  admissionId: RemotePublicationAdmissionId,
  ...nonAction,
  observation: RemotePublicationAdmissionObservation,
  recordedAt: JournalPosition,
  runId: RunId,
  target: RemotePublicationTarget
})
export type RemotePublicationAdmissionObserved = typeof RemotePublicationAdmissionObserved.Type

/** Dalph recorded the exact direct-publication request before any remote Git call. */
export const RemotePublicationRequested = Schema.TaggedStruct("RemotePublicationRequested", {
  ...initiatedByCoordinator,
  correlation: RemotePublicationCorrelation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type RemotePublicationRequested = typeof RemotePublicationRequested.Type

/** Dalph recorded one numbered direct-publication attempt before the push call. */
export const RemotePublicationAttemptRequested = Schema.TaggedStruct("RemotePublicationAttemptRequested", {
  ...initiatedByCoordinator,
  attemptOrdinal: RemotePublicationAttemptOrdinal,
  correlation: RemotePublicationCorrelation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type RemotePublicationAttemptRequested = typeof RemotePublicationAttemptRequested.Type

/** The receiving branch proved the exact candidate; the proof retains its causal attempt ordinal. */
export const RemotePublicationSucceeded = Schema.TaggedStruct("RemotePublicationSucceeded", {
  correlation: RemotePublicationCorrelation,
  ...nonAction,
  proof: RemotePublicationProofBasis,
  recordedAt: JournalPosition,
  runId: RunId
})
export type RemotePublicationSucceeded = typeof RemotePublicationSucceeded.Type

/** A conclusive remote result is retained as a typed wait until a later owner direction. */
export const RemotePublicationRetained = Schema.TaggedStruct("RemotePublicationRetained", {
  cause: RemotePublicationRetainedCause,
  correlation: RemotePublicationCorrelation,
  ...nonAction,
  recordedAt: JournalPosition,
  runId: RunId
})
export type RemotePublicationRetained = typeof RemotePublicationRetained.Type

/** Dalph recorded the exact remote-baseline read before local catch-up or publication. */
export const RemoteBaselineReadInitiated = Schema.TaggedStruct("RemoteBaselineReadInitiated", {
  ...initiatedByCoordinator,
  correlation: RemoteBaselineCorrelation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type RemoteBaselineReadInitiated = typeof RemoteBaselineReadInitiated.Type

/** Git returned the exact initial local/remote relation for the pinned baseline. */
export const RemoteBaselineObserved = Schema.TaggedStruct("RemoteBaselineObserved", {
  correlation: RemoteBaselineCorrelation,
  ...nonAction,
  observation: RemoteBaselineObservation,
  recordedAt: JournalPosition,
  runId: RunId
})
export type RemoteBaselineObserved = typeof RemoteBaselineObserved.Type

/** Dalph recorded local catch-up intent only after a LocalAncestor baseline proof. */
export const LocalTargetCatchUpInitiated = Schema.TaggedStruct("LocalTargetCatchUpInitiated", {
  ...initiatedByCoordinator,
  correlation: RemoteBaselineCorrelation,
  expectedLocalHead: GitCommitSha,
  recordedAt: JournalPosition,
  remoteHead: GitCommitSha,
  runId: RunId
})
export type LocalTargetCatchUpInitiated = typeof LocalTargetCatchUpInitiated.Type

/** Git returned the exact local catch-up result for the recorded baseline intent. */
export const LocalTargetCatchUpObserved = Schema.TaggedStruct("LocalTargetCatchUpObserved", {
  correlation: RemoteBaselineCorrelation,
  expectedLocalHead: GitCommitSha,
  ...nonAction,
  recordedAt: JournalPosition,
  remoteHead: GitCommitSha,
  result: LocalTargetCatchUpResult,
  runId: RunId
})
export type LocalTargetCatchUpObserved = typeof LocalTargetCatchUpObserved.Type
